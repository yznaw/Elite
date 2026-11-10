# 24 — Logging, Error Handling and Observability Plan

**Created:** 30 July 2026
**Source:** the POS readiness analysis of 2026-07-30, §6 "Error handling and logging". That review found the *functional* error model strong (`PosError` with semantic codes, `mapDatabaseError`, print-after-commit, staged QZ hardware logging) but the *operational* layer effectively absent: `morgan('dev')` in production, no correlation ID, no structured logs, no error persistence, no client-side error capture at all, drift detection that only `console.warn`s, a `/api/health` that never touches the database, and zero alerting apart from the backup script.

**Scope:** make a fault in the shop diagnosable remotely, after the fact, without SSH. Nothing in this document changes POS business logic, money math, stock math, or the transaction boundary. Every phase is additive and must be reversible.

**Tracker:** the checkboxes in each phase's exit gate are the source of truth. Tick an item only when it is implemented *and* verified (test run, or a real observed behaviour) — not when the code is merely written.

---

## Design decisions taken up front

### D1 — Three storage tiers, chosen by volume and audience

| Tier | Content | Where | Retention | Read by |
|---|---|---|---|---|
| 1 | Business/forensic events | Postgres `audit_events` (exists) | permanent | owner, accountant, manager |
| 1 | Errors and warnings worth a human | Postgres `app_errors` (new) | 90 days | developer, via admin UI |
| 2 | Every HTTP request, debug detail | JSON files on disk (pino → pm2-logrotate) | 14 days | developer, via `grep`/`jq` |
| 3 | Things needing action today | email (existing `mailer.js`) | n/a | owner, developer |

**Why not every request row in Postgres:** it is the *same* database that serves checkout. Thousands of log inserts a day compete for the same connection pool, disk and WAL as sales. A logging spike must never be able to slow a payment. Request-level logging therefore goes to disk only; the database holds only the bounded, queryable subset (errors, audit).

**Why not Loki/ELK/Datadog:** one VPS, one shop, one or two developers. A rotated JSON file plus `jq` gives ~95% of the value at zero operational cost.

**Why not Sentry on the register:** the register is a Celeron J1900 with ~786 MB free RAM on Windows 10 LTSB. A third-party SDK plus performance monitoring is a real cost there, and its offline story is weaker than what we need (a register can be offline for hours). We own a ~40-line endpoint instead. Sentry stays an option later for the storefront and admin portal on normal machines.

### D2 — Correlation ID is the backbone

One `requestId` per HTTP request, generated at the edge, and present in: the response header, the error response body, the pino line, the `app_errors` row, and the `audit_events` row. The last 6 characters are shown to the cashier in the error toast, so a phone call ("رمز المرجع a3f9c1") becomes a one-command lookup.

### D3 — Logging must never be able to break a sale

Enforced rules, applied in every phase below:
- `app_errors` writes are fire-and-forget inside `try/catch` that swallows everything, and no-op when `DATABASE_URL` is unset.
- The client shipper never `await`s inside a sale path, never throws upward, and drops its own oldest buffered lines rather than growing without bound.
- Failures of the logging endpoint are never themselves logged through the same path (explicit loop guard).
- Alerts are deduplicated, so a storm cannot produce hundreds of emails (which would train the owner to ignore the inbox — worse than no alerts).

### D4 — Client buffer lives in its own IndexedDB database

The POS store (`elite-pos`) holds unsynced money. Bumping its version for a logging feature puts a migration risk on financial data for zero business benefit. The shipper uses a separate `elite-logs` database, so the two lifecycles never interact, and admin-portal pages outside `/pos` get logging too.

### D5 — Never log secrets or PII

Redacted at the source: manager PIN, passwords, session cookie, CSRF token, authorization headers, customer contact data. Card data does not exist in this system and this must stay true.

---

## Phase A — Correlation ID foundation

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Architecture decision
A tiny middleware at the top of the stack. It honours an inbound `X-Request-Id` when the value looks safe (so a future reverse proxy or the client shipper can supply its own), otherwise generates one. Short IDs (12 hex chars) rather than full UUIDs, because a human reads them aloud.

### DB schema
`audit_events.request_id text` (migration 022, see Phase C — one migration file covers both).

### Integration impact analysis
- `server/index.js`: middleware must be registered **before** the logger, CSRF, session and routes, so every downstream line can see it. Placed immediately after `helmet`.
- `server/lib/pos/db.js`'s `audit()` reads `context.*` — adding `requestId` to the context objects means **no signature change** and no edits at the ~20 `audit(...)` call sites. This is why the field is threaded through context and not passed positionally.
- Context builders touched: `pos.route.js`'s `context(req)` is the only POS one; `admin-pos-*.route.js` builders get it too so their errors correlate.
- Only one place in the whole server writes `audit_events` (`server/lib/pos/db.js:46`), verified by grep, so the column has exactly one writer.
- Error response bodies gain a `requestId` field. Additive: the Angular `ApiClient` unwraps `data`, and the interceptor reads `err.error?.message`, so no existing client code breaks.

### Exit gate
- [x] Every response carries `X-Request-Id`.
- [x] Every JSON error body carries `requestId`.
- [x] An inbound `X-Request-Id` is honoured when well-formed and replaced when not.
- [x] `audit_events.request_id` is populated for a POS sale, verified by test.

---

## Phase B — Structured logging (pino) replacing morgan

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Architecture decision
`pino` + `pino-http`. JSON one line per request in production, `pino-pretty` in dev, fully silent under test. Each line carries `requestId`, `userId`, `tenantId`, `registerId`, method, route, status, and duration — the fields that make a POS incident reconstructable. Log files are handled by `pm2-logrotate`, not by the app.

### Integration impact analysis
- Replaces `app.use(morgan('dev'))` at `server/index.js:127`. `morgan` is removed from `server/package.json`; nothing else in the codebase requires it (verified by grep).
- **Test suite risk:** the 21 existing tests boot the real app. Unstructured request noise would flood the output, and pino's default transport can keep the process alive. Mitigated by `level: 'silent'` whenever `NODE_ENV === 'test'` and by using no transport in that mode.
- **Dev DX risk:** developers currently rely on morgan's coloured single line. `pino-pretty` (devDependency) reproduces that; if it is not installed, the logger degrades to JSON instead of crashing.
- `console.*` calls elsewhere in the codebase are left alone deliberately. Converting all of them is a large, low-value diff; pm2 captures them on the same stream. New code uses the logger.

### Exit gate
- [x] Production emits one JSON line per request including `requestId` and duration.
- [x] `npm test` output is not polluted and all previously passing tests still pass.
- [x] Dev mode remains human-readable.
- [x] `pm2-logrotate` setup documented in the deployment runbook.

---

## Phase C — `app_errors` persistence with fingerprint dedup

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Architecture decision
One bounded table. Identical errors collapse onto one row via a `fingerprint` (hash of source + code + first stack frame + route), incrementing `seen_count` and moving `last_seen_at` instead of inserting again. This is what keeps "3 problems" from looking like "1200 log lines", and keeps the table small enough to live in the operational database.

Grouping window: the same fingerprint collapses while it is unresolved. Resolving a row starts a new group on the next occurrence, so a regression after a fix is visible rather than silently folded into the old row.

### DB schema — migration `022_observability.sql`
```sql
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text;

CREATE TABLE IF NOT EXISTS app_errors (
  id bigserial PRIMARY KEY,
  fingerprint text NOT NULL,
  source text NOT NULL CHECK (source IN ('server','pos-client','admin-client','csp')),
  severity text NOT NULL CHECK (severity IN ('error','warn')),
  code text,
  message text NOT NULL,
  stack text,
  route text,
  http_status integer,
  request_id text,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  register_id uuid,
  shift_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  seen_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL
);
```
Partial unique index on `(fingerprint)` where `resolved_at IS NULL`, so the dedup upsert is enforced by the database rather than by a read-then-write race.

### Integration impact analysis
- Wired into the existing global error handler in `server/index.js`, after the friendly multer/payload branches so their expected 413/415 responses are not recorded as incidents.
- Recording policy: `>= 500` always (severity `error`); `4xx` on `/api/pos/*` as `warn`, because a cashier hitting `INSUFFICIENT_STOCK` or `RECEIPT_NUMBER_TAKEN` is exactly the forensic trail we want; other `4xx` are ignored as normal client validation noise.
- `register_id`/`shift_id` come from the session and the POS context, giving "show me everything from yesterday's evening shift on the front register".
- Added to `server/db/pos-schema.js`'s `migrationPaths`, matching the project's existing idempotent-`IF NOT EXISTS` convention (there is no formal migration runner).

### Exit gate
- [x] A 500 writes exactly one row; a second identical 500 increments `seen_count` instead of inserting.
- [x] A POS 4xx writes a `warn` row carrying register and shift.
- [x] A failure inside the recorder cannot change the HTTP response — forced by stubbing the pool to throw (`observability-unit.test.js`).
- [x] Everything no-ops cleanly with no `DATABASE_URL`.

---

## Phase D — Client log ingestion and offline-safe shipper

**Status:** ✅ implemented; exit gate below records what is verified vs still open

This is the phase that closes the gap that matters most: today, an error on the register's screen leaves no trace anywhere.

### Architecture decision
Server: `POST /api/client-logs` (authenticated, batched, rate-limited, size-capped) plus `POST /api/client-logs/csp` (public, for the browser's own CSP violation reports, which cannot carry a CSRF header).

Client: a service that buffers into `elite-logs` IndexedDB and flushes in batches. Buffering first is what makes it work offline — and errors that happen while offline are precisely the ones we cannot otherwise see.

### Integration impact analysis
- **CSRF:** `/api/client-logs` is a cookie-authenticated mutation, so it passes through the existing `csrfInterceptor` unchanged. The CSP sink cannot, so it is explicitly exempted in `server/middleware/csrf.js` by path, and mounted as a public route — hence a dedicated rate limiter and a hard body cap on it.
- **Loop guard:** the shipper's own failures must never re-enter the shipper, and `httpErrorInterceptor` must skip requests to the client-log paths. Without both, one endpoint failure becomes an infinite retry storm on a register.
- **`ErrorHandler` override:** Angular's default rethrows to the console. The custom one must still `console.error` (so DevTools on the register keeps working, which is how three real hardware bugs were found) and then ship. It must never throw.
- **CSP report-uri:** helmet currently runs `reportOnly` with **no** report destination, so the "review CSP reports before enforcing" gate in docs/15 Phase 1 is impossible to satisfy today. Pointing `report-uri` at the new sink makes that gate satisfiable as a side effect.
- **POS hardware logging:** `pos-hardware.service.ts`'s existing `logError` keeps its console output and additionally ships. This preserves the on-device debugging workflow rather than replacing it.
- **Payload discipline:** batch capped, per-message length capped, buffer capped with oldest-dropped-first. A register that crash-loops must not be able to flood the API or fill its own disk.

### Exit gate
- [x] An uncaught client error reaches `app_errors` with `source='pos-client'`.
- [ ] Errors raised while offline are buffered and delivered after reconnect. **Needs a browser run** (implemented: IndexedDB `elite-logs` buffer, flush on `online`/visibility-hidden).
- [ ] A failing log endpoint produces no retry storm and no toast. **Needs a browser run** (implemented: `fetch` instead of HttpClient so the error interceptor never sees it, plus a `suspended` loop guard consulted by the interceptor and the ErrorHandler).
- [x] PIN/password/token/cookie fields are redacted before leaving the browser.
- [x] The endpoint rejects oversized and malformed batches without 500ing.
- [x] CSP violations land as `source='csp'`.

---

## Phase E — Alerting with deduplication

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Architecture decision
`server/lib/alerts.js` wrapping the existing `mailer.js`. Silent no-op unless `ALERT_EMAIL` is configured, so nothing breaks in dev or test. Deduplicated per alert key with a 1-hour window.

Alerts are deliberately few. An alert means *act today*; everything else belongs in `app_errors`.

| Alert | Trigger | Why |
|---|---|---|
| `inventory-drift` | drift job finds any drifted variant | today this only `console.warn`s, so "alerting on drift" was not real |
| `server-error-surge` | > 10 recorded 5xx in 5 minutes | catches a deploy that broke checkout |
| `offline-queue-stuck` | a register reports pending sales unchanged for > 15 min | unsynced money sitting in a browser is the top offline risk |
| `print-failures` | > 5 print failures reported from one register in a shift | a jammed printer at the counter |

### Integration impact analysis
- Dedup state is in-memory, therefore per-process and reset on restart. Acceptable at one pm2 instance and documented; a restart at worst re-sends one alert.
- `mailer.js` **throws** when `SMTP_HOST` is unset — every call site must catch. Failing to alert must never fail the thing that triggered it.
- The stuck-queue checker reads `pos_sync_states` (`pending_count`, `last_reported_at`), which the client already maintains via `PUT /api/pos/sync-state`. No new client work and no new table.
- The surge and print-failure counters are fed from Phase C/D recording, so no new instrumentation points.

### Exit gate
- [x] One email per alert key per window; a repeat inside the window does not send, a different key is independent, and a transient SMTP failure does not burn the window (`observability-unit.test.js`).
- [x] Every alert path is safe with SMTP unconfigured.
- [x] The stuck-queue checker uses the same `pos_sync_states` rows the shift-close gate already trusts.

---

## Phase F+G — Health depth and error-response hygiene

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Architecture decision
`/api/health` performs a real `SELECT 1` with a short timeout and returns `503` when the database is unreachable, so an external uptime monitor stops being blind. The result is cached for 5 seconds so a monitor (or a scraper) cannot turn the health check into database load.

Production `5xx` responses stop returning raw `err.message` (which can carry SQL text and internal paths). The client sees a generic message plus the machine-readable `code` and the `requestId`; the real message goes to pino and `app_errors`. Deliberate, already-modelled errors (`PosError`, and any error with an explicit `status < 500`) keep their message, since those are written for the cashier to read.

### Integration impact analysis
- Health response stays backward compatible: existing `success`/`status`/`timestamp`/`uptime` fields are preserved, new fields added. Any current monitor keeps working, but a DB outage now flips it.
- **Behavioural change to watch:** anything that surfaced a raw 500 message to a developer now shows a generic string in production. The message is not lost — it moves to the logs and the diagnostics screen, keyed by the same `requestId` shown in the toast.
- Cashier-facing POS error codes get EN/AR strings, with the reference code appended to the toast. `pos.component.ts`'s `errorMessage()` is the single funnel for this, so it is one edit, not one per call site.

### Exit gate
- [x] Health returns 503 with a clear reason when the database is down, 200 otherwise.
- [x] A production 500 leaks no internal message but carries `code` + `requestId`.
- [x] A 422 `PosError` still shows its own actionable message to the cashier.
- [x] The cashier's toast shows a short reference code matching the server log.

---

## Phase H — Diagnostics admin page

**Status:** ✅ implemented; exit gate below records what is verified vs still open

Also closes a separate gap found in the 2026-07-30 review: `audit_events` had **no UI at all**, so the audit trail required `psql` and was effectively unreachable for the owner.

### Architecture decision
One page, two tabs: **Errors** (grouped `app_errors`, filterable by source/severity/unresolved, with a resolve action) and **Audit trail** (`audit_events`, filterable by action/entity, correlated by `request_id`). Owner/admin only.

### Integration impact analysis
- Server route mounted next to the other POS back-office routers in `server/routes/index.js` with `requireAuth({ roles: ['owner','admin'] })`, matching how `pos-security` is already gated.
- Route added under the authenticated shell in `app.routes.ts` with `roleGuard(['owner','admin'])`, mirroring `/reference` and `/settings`.
- **Nav visibility:** `sidebar.component.ts` shows all groups to every non-manager role, so appending unconditionally would show a link a `viewer` cannot open. Follows the existing `myPinLink` precedent instead: appended conditionally for owner/admin only. The same treatment is applied to `bottom-nav.component.ts`, which keeps its own parallel list — missing it would have made the page unreachable on the register's touch screen and on mobile.
- Strings added to both `EN` and `AR` in `i18n/strings.ts`; the `StringKey` type is derived from `EN`, so an EN key missing its AR twin is a type error, not a silent English fallback.
- Icon: reuses the existing `warning` glyph. No new SVG hand-rolled.

### Exit gate
- [ ] Owner/admin reach the page from sidebar and bottom-nav; a manager/viewer does not see the link and is redirected on direct URL entry. **Needs a browser run** (implemented: `roleGuard(['owner','admin'])` on the route, conditional link in both nav surfaces).
- [x] Errors tab lists grouped rows with counts and can resolve one.
- [x] Audit tab lists real `audit_events` rows and can filter by action.
- [x] No missing Arabic keys — `AR` is typed `Record<keyof typeof EN, string>`, so an untranslated key fails the build; the production build is green. **Visual RTL check of the rendered page still pending.**

---

## Phase I — Tests, build, documentation

**Status:** ✅ implemented; exit gate below records what is verified vs still open

### Integration impact analysis
- New tests must be self-contained and skip cleanly without `DATABASE_URL`, matching the existing suite's behaviour.
- The admin production build must stay green — new page, service and strings all participate in type checking.
- Docs updated: `05-api-server.md` (new endpoints, logging, env vars), `04-admin-portal.md` (new page row), `07-dev-guide.md` (how to read logs, find a request by reference code), `DEPLOYMENT.md` (pm2-logrotate, new env vars), and `16-launch-roadmap.md` (observability phase status).

### Exit gate
- [x] Full server suite green, including the new observability tests.
- [x] `npm run build:admin` green.
- [x] Docs updated.

---

## What this plan explicitly does not do

- No change to sale/refund/void/shift logic, money math, stock math, or transaction boundaries.
- No conversion of the existing hundreds of `console.*` calls; new code uses the logger, old calls keep flowing to pm2.
- No third-party error-tracking SDK on the register (see D1).
- No log shipping infrastructure (Loki/ELK); revisit only if a second branch and a second server appear.
- No metrics/dashboard system (Prometheus/Grafana). The alerts in Phase E cover the "act today" set; a metrics stack is Phase 11-era work.

## Residual risks after this plan

1. **Alert dedup is per-process and in-memory.** A pm2 restart can re-send one alert per kind. Accepted; a table would add write load for little gain at one instance.
2. **Client logs are best-effort.** A register whose browser profile is wiped loses its unsent buffer, exactly like the offline sale queue does. This narrows but does not remove the browser-only-durability risk already accepted by the owner.
3. **`app_errors` has no automatic pruning job yet.** 90-day retention is a documented policy; the delete is not yet scheduled. Volume at one shop makes this safe for now, and it is a one-line addition to the existing hourly job when wanted.
4. **No uptime monitor is configured.** Phase F makes `/api/health` truthful, but something external still has to poll it.
