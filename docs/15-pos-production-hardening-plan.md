# Elite POS production hardening plan (P0 + core reporting)

**Source:** [14-pos-production-readiness-audit-2026-07-13.md](14-pos-production-readiness-audit-2026-07-13.md)
**Status:** planning complete, implementation not started
**Scope:** all 10 P0 blockers + core P1 reporting, ordered into 6 buildable phases with DB schema and workflow per phase. Card payments (P0-5) target a serial/cable-linked terminal whose exact model/protocol is not yet confirmed. Offline durability (P0-2) is browser-only hardening, no separate local agent process.

Use the checkboxes in each phase as the tracker. Check off an item only when it is merged and passing tests, not when code is written.

---

## How to use this document

- Work phases roughly in order. Phase 0 must finish first (it resolves unknowns that block later decisions). Phases 1-2 can overlap. Phase 5 (reporting) depends on Phase 3's inventory ledger and cash-movement schema.
- Every phase lists: **architecture decision**, **DB schema**, **workflow**, **files touched**, **exit gate**.
- When a checkbox is done, mark it `[x]` and add a one-line date/commit note if useful. Do not delete completed items — this doc is the audit trail for the pilot sign-off gate.

---

## Phase 0 — Baseline decisions and discovery (blocking, do first)

No code. Resolve open unknowns so later phases don't get built on guesses.

- [x] **Card terminal confirmed standalone.** Checked with the shop manager: the cashier keys the amount into the card terminal manually; there is no cable/software link to the POS at all (the earlier "connected by cable" description referred to the terminal's own power/comms cabling, not a data link to the till). **This resolves Phase 4's biggest unknown** — there is no ECR protocol to integrate. Phase 4 simplifies to: capture a mandatory terminal reference/auth code at manual-confirmation time (today's `pos-manual` flow captures no reference at all), not build a real terminal adapter.
- [x] No terminal vendor SDK/integration needed given the above — **Phase 4's scope shrinks accordingly** (see updated Phase 4 section below).
- [ ] Confirm with the acquirer/bank whether any future terminal integration would need re-registration — deferred, not blocking since card stays manual for now.
- [x] **Hardware confirmed via remote access to the actual register:**
  - Register: **POSIFLEX KS-7412** all-in-one POS terminal (not a generic PC).
  - CPU/RAM: Intel Celeron J1900 @ 1.99GHz, 4GB RAM installed (only ~786MB free under normal load) — **weak, memory-constrained hardware**. Angular bundle size/runtime perf budgets in Phase 1's upgrade and Phase 2's PWA work must account for this, not just a modern dev machine.
  - OS: **Windows 10 Enterprise 2016 LTSB** (build 14393) — old servicing branch; confirm what browser is actually installed/updated on it before assuming modern Chromium features are available.
  - **Screen: 12" TFT LCD, native resolution 1024×768, 5-wire resistive touch** (confirmed from the official Posiflex spec sheet). Windows was found driving it at a non-native, upscaled **1920×1080**, and the browser was separately zoomed to ~75% (`devicePixelRatio: 0.75`) — both compounding to make the UI feel too small/imprecise for resistive-touch tapping. **Fix in progress:** set Windows back to native 1024×768 first (owner will check/apply), then re-evaluate whether POS-specific CSS (larger tap targets/text tuned for a 12" resistive touch panel, not just generic mobile breakpoints) is still needed on top of that. Not yet closed — waiting on the resolution change to be applied and re-checked.
  - Printer: **BIXOLON SRP-QE300** confirmed via Devices & Printers (not just "a Bixolon model" per the audit) — this is the exact model Phase 3's Arabic/ESC-POS receipt work should target and test against.
  - Serial ports: 4 total (2×DB9 + 2×RJ50) available on the register — noted for future reference if a terminal integration ever becomes relevant later, though not needed under the current manual-terminal setup.
  - Cash drawer/scanner not yet separately confirmed (barcode scanner shows generically as "Symbol Bar Code Scanner" in Device Manager — that's sufficient for now).
- [x] Pin Node LTS version for the server — **done**, see Phase 1 exit gate (`engines.node: ^22.0.0` in `server/package.json`).
- [ ] Decide the legal receipt profile content with local counsel/accounting. **Partially informed**: a real receipt from the old POS shows the actual trade name/address/phone Elite already uses in practice (Elite Collection, Parcel 14, 25 La Croisette Ground Floor, Shop 317, Marina Way 23, The Pearl, Qatar, +974 44758172) — usable as a starting draft for `pos_business_profile` in Phase 3, but CR/license number and return-policy text still need confirming with counsel/accounting before treating it as final.
- [ ] Decide RPO/RTO targets for Phase 3's backup/restore work (e.g. RPO 15 min, RTO 4 hours — placeholder, confirm with owner). Still open.
- [ ] Decide the offline catalog freshness window (audit suggests 8-24h) — blocks Phase 2 workflow. Still open.
- [ ] Decide production CORS origin list (replace hardcoded `localhost:4200`/`4300` fallback in `server/index.js:47` with an env-driven allow-list that excludes dev origins in production).

**Exit gate:** written answers to every item above, reviewed by owner.

---

## Phase 1 — Security and dependency baseline

### Architecture decision

Treat this as a hardening pass with **zero new business logic** — every change here is either a dependency bump, a new well-known middleware, or a fail-closed config check. This keeps the diff reviewable and isolates risk from the functional P0 work in later phases.

- Add `helmet` for security headers + CSP (self-host any remaining Google Fonts first, since CSP will block third-party font origins).
- Add CSRF protection via **double-submit cookie + Origin/Sec-Fetch-Site validation** rather than `csurf` (that package is deprecated/unmaintained) — a small custom middleware checking `Origin`/`Referer` against the allow-list for all cookie-authenticated mutating requests, plus a `csrf-token` cookie/header pair for the Angular app.
- Add `express-rate-limit` on: login, password reset, PIN verify/set, register enrollment — keyed by IP + account identifier where applicable.
- Fail-closed startup: a `server/config/assert-env.js` module that throws (not `console.warn`) in production when `SESSION_SECRET`, `DATABASE_URL`, `CORS_ORIGINS` are missing or equal to known dev defaults. Call it at the top of `server/index.js` before `app.listen`.
- Upgrade path:
  - `nodemailer` 8.0.10 → 9.x (semver-major; audit the raw-message/file-access API usage before bumping since the vulnerable surface is `disableFileAccess`/`disableUrlAccess` bypass).
  - `express` stays on 4.x (5.x is a bigger migration than this phase's blast radius allows) but bump to latest 4.22.x and confirm the `qs` moderate advisory is resolved transitively; if not, override `qs` via `overrides` in `server/package.json`.
  - `morgan` 1.10.1 → 1.11.0 (log-forging fix).
  - Angular 17.3 → 21.x: **do this as its own dedicated sub-track inside Phase 1**, one major version at a time (17→18→19→20→21) with `ng update` codemods, full rebuild, and a manual smoke pass of the storefront + admin portal + POS screen after each hop. Do not attempt to skip versions.
  - Pin Node to the current even LTS release in `server/package.json` `engines` and in deployment docs.

### DB schema

None required in this phase.

### Workflow

1. `npm audit` clean run (or documented accepted exceptions) on both `client/` and `server/` before merge.
2. CI gate: add `npm audit --omit=dev --audit-level=high` as a required check for `server/`, and `npm audit --audit-level=high` for `client/` (excluding known-accepted advisories via an explicit allowlist file, not a blanket `--force`).
3. Helmet/CSP rollout: ship in **report-only** mode first (`Content-Security-Policy-Report-Only`) for one deploy cycle, review violation reports, then switch to enforcing.
4. CSRF middleware: land behind a feature flag env var (`CSRF_ENFORCE=true`) so it can be toggled off instantly if it breaks a legitimate flow during rollout, then remove the flag once verified.

### Files touched

`server/index.js`, `server/package.json`, new `server/middleware/csrf.js`, new `server/middleware/rate-limit.js`, new `server/config/assert-env.js`, `server/routes/auth.route.js`, `server/routes/pos.route.js`, `server/test/pos-authenticated-e2e.test.js` (test client updated to carry the CSRF cookie/header like a real browser client would), new `client/projects/admin-portal/src/app/interceptors/csrf.interceptor.ts`, `client/projects/admin-portal/src/app/app.config.ts`. Still pending: `client/package.json` + Angular workspace config (major-version upgrade), `client/projects/admin-portal/src/index.html` (self-hosted fonts, needed once CSP moves to enforcing).

### Exit gate

- [x] `server` `npm audit` shows zero vulnerabilities (nodemailer 9.0.3, morgan 1.11.0, `qs` overridden to 6.15.3, `brace-expansion` fixed via `npm audit fix`). `client` audit still open (Angular upgrade not started).
- [x] Helmet headers + CSP present on all responses, currently in **report-only** mode (`CSP_REPORT_ONLY` defaults on); flip to enforcing after a soak period once violation reports are reviewed in a real deployment.
- [x] CSRF middleware implemented and enforced by default (`CSRF_ENFORCE` flag defaults on); double-submit cookie (`elite.csrf`) + Origin/Referer allow-list check; verified against the server's own authenticated E2E test suite (12/12 passing) and a manual curl check of response headers/cookie issuance. Client-side interceptor (`csrf.interceptor.ts`) wired in to mirror the cookie into `X-CSRF-Token` on all mutating requests.
- [x] Rate limits added on login/forgot/reset (`authAttemptLimiter`, 10/15min) and POS PIN/enrollment endpoints (`posPinLimiter`, 8/5min) — not yet verified with a scripted burst test (manual/CI follow-up).
- [x] Server refuses to start in production with missing/default `SESSION_SECRET` — verified manually (`NODE_ENV=production node index.js` throws and exits before `app.listen`).
- [x] Production CORS no longer falls back to the hardcoded `localhost:4200`/`4300` defaults; those are dev-only now, gated behind `!isProd`.
- [ ] Angular upgraded to a version with zero high/critical advisories; full regression pass (storefront + admin + POS) green. **Not started** — largest remaining item in this phase.
- [x] Node LTS pinned: `server/package.json` `engines.node` set to `^22.0.0` (current active LTS), `docs/07-dev-guide.md` updated. This is advisory locally (npm warns, doesn't block) — **deployment/CI must actually run Node 22**, that part is still an ops task, not a code change.
- [ ] Scripted burst test against login/PIN rate limits (manual verification only so far).
- [ ] 48h CSP report-only soak reviewed before flipping to enforcing.

---

## Phase 2 — PWA installability + connectivity recovery + browser-only durability

This merges P0-1, P0-2 (browser-only variant), and P0-3 since they share the same client surface (`pos.component.ts`, `pos-sw.js`, `pos-local-store.service.ts`) and are easiest to reason about together.

### Architecture decision

- **Installable PWA:** add `pos.webmanifest` (`start_url: /pos`, `scope: /pos`, `display: standalone`, 192/512 + maskable icons, shortcuts for "New sale"/"Open shift"). Link it from `index.html`. Narrow the service worker's registration scope from the implicit whole-origin to `/pos/` specifically, so the POS worker's cache lifecycle doesn't interfere with the rest of the admin portal.
- **Generated precache instead of handwritten cache list:** replace the handwritten 46-line `pos-sw.js` (`elite-pos-shell-v1` cache name, manual `install`/`activate`/`fetch`) with Angular's built-in `@angular/service-worker` (`ng add @angular/service-worker`) scoped to the POS route, or a Workbox `injectManifest` build step if `@angular/service-worker`'s update model doesn't fit the "block checkout at a safe boundary" requirement below. Recommendation: **`@angular/service-worker`** first — it's already the Angular-native answer and avoids maintaining custom SW logic; only fall back to Workbox if its `SwUpdate` API can't express the safe-update-boundary rule.
- **Safe update gate:** subscribe to `SwUpdate.versionUpdates`, show an "update ready" banner, but do not call `activateUpdate()` while `pos.component.ts`'s cart has items or a sync is pending — check this via the existing offline-queue signals before applying.
- **Browser-only durability hardening (per your choice — no separate local agent):**
  - Call `navigator.storage.persist()` during register enrollment (`register-service.js`'s enrollment flow's client-side counterpart) and store the boolean result in IndexedDB `settings` store as `persistent-storage-status`.
  - Call `navigator.storage.estimate()` periodically (e.g. every 5 minutes while a shift is open) and surface `usage`/`quota` in the terminal-health UI.
  - Detect private/incognito mode (persist() will resolve `false` and quota will be near-zero) and **block opening a shift** in that state with a clear terminal-health error, per audit's "Refuse production offline mode in private/incognito profiles."
  - Add an append-only **queue journal** store in IndexedDB (`db version 3 → 4`, see schema below) recording every lifecycle event (`created`, `printed`, `sync_attempted`, `accepted`, `rejected`, `resolved`) for each queued sale, instead of only holding current-state rows in `pending-sales`.
  - Keep accepted/synced sales in `pending-sales` (flagged `synced: true`) for a configurable local audit window (e.g. 7 days) instead of deleting immediately on sync success; add a cleanup sweep that only purges rows older than the window **and** synced.
  - Add an "export encrypted support bundle" action (JSON export of unresolved/rejected sales + journal, encrypted client-side with a passphrase or terminal key) for support escalation.
- **Connectivity recovery:** replace the `window.addEventListener('online'/'offline')`-only model with:
  - A lightweight polling health-check (`GET /api/pos/health-check`, authenticated, jittered 15-30s interval) that runs **whenever `online()` signal is false or a sale/sync has failed**, independent of the browser's own online/offline events.
  - Trigger `syncPendingSales()` on: successful health check, `visibilitychange` → visible, `focus`, and (where supported) a `sync` event via Background Sync API as a best-effort extra trigger, not the primary mechanism.
  - Fix the gap at `pos.component.ts:412-423`: when `createSale()` fails with a network error and `online.set(false)` runs, immediately start the health-check poll (not just wait for a browser `online` event or a later failed sync attempt).
  - Surface pending count, rejected count, oldest-pending age, last-successful-sync timestamp, and server-reachability as a persistent status strip in the POS UI, with alert thresholds at 2 min / 10 min / receipt-block-exhaustion-risk.

### DB schema

No PostgreSQL schema changes in this phase (all changes are client-side IndexedDB + a new lightweight server health-check route). New server route:

```js
// server/routes/pos.route.js — add near existing POS routes
router.get('/health-check', requireAuth({ roles: POS_ROLES }), (req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});
```

IndexedDB (`elite-pos`, version bump **3 → 4** in `pos-local-store.service.ts`):

```text
settings (existing, no shape change)
  + key 'persistent-storage-status': { persisted: boolean, checkedAt: string }
  + key 'storage-estimate': { usage: number, quota: number, checkedAt: string }

pending-sales (existing keyPath idempotencyKey)
  + field 'synced: boolean' (default false)
  + field 'syncedAt: string | null'
  (do not delete row on sync success; set synced=true, syncedAt=now; cleanup sweep purges synced && older-than-window)

pos-queue-journal (NEW object store, keyPath 'id' auto-increment)
  { id, idempotencyKey, event: 'created'|'printed'|'sync_attempted'|'accepted'|'rejected'|'resolved', at: string, detail?: object }
  index on 'idempotencyKey' for lookup during support-bundle export
```

### Workflow

1. Ship the manifest + narrowed SW scope first (lowest risk, immediately gives installability).
2. Land `@angular/service-worker` behind the same route scope, verify update-gate behavior manually (open a cart, trigger a deploy, confirm no forced reload mid-sale).
3. Land IndexedDB v4 migration (additive fields/store only — `onupgradeneeded` must not touch existing `pending-sales` rows destructively).
4. Land health-check polling + retry-trigger fix; test by blocking `/api/*` at the network layer while `navigator.onLine` stays true (matches the audit's specific missing-event scenario).
5. Land persistent-storage request + private-mode detection + shift-open guard.
6. Land export-support-bundle action last (nice-to-have relative to the recovery-loop fix, but still P0-2 scope).

### Files touched

New `client/projects/admin-portal/src/pos.webmanifest`, `client/projects/admin-portal/src/index.html`, replace `client/projects/admin-portal/src/pos-sw.js` (or remove in favor of Angular SW config), `client/projects/admin-portal/src/app/services/pos-local-store.service.ts`, `client/projects/admin-portal/src/app/pages/pos/pos.component.ts`, `server/routes/pos.route.js`.

### Exit gate

- [ ] Lighthouse PWA installability check passes; app installs on the target Windows/Chrome kiosk config.
- [ ] Cold offline launch (installed, browser fully closed, no network, reopen) works.
- [ ] Service worker update during an active cart does not disrupt or duplicate a sale; update applies only at a safe boundary.
- [ ] `navigator.storage.persist()` returns true on the enrolled terminal profile; private-mode blocks shift open with a clear message.
- [ ] Simulated "API down, LAN up" scenario recovers via health-check polling without any browser `online` event firing.
- [ ] Pending/rejected/oldest-age/last-sync status visible in UI; alert thresholds verified.
- [ ] IndexedDB migration verified non-destructive against a database seeded with v3 data.

---

## Phase 3 — Arabic receipt, cashier role, inventory ledger, cash movements

Three P0 items (P0-4, P0-7, P0-8) plus the P1 cash-shift items that the audit says must land before sole-POS cutover. Grouped because they all touch the same transaction boundary in `sale-service.js`/`correction-service.js` and the receipt/role model, so it's more reviewable as one coherent slice than three separate passes through the same files.

### Architecture decision

**Arabic receipt (P0-4):**
- Store a `pos_business_profile` row per tenant (or per register, if multi-branch needs differ later) holding the legally reviewed bilingual content from Phase 0's decision.
- Replace `PosReceiptRenderer.truncate()`'s ASCII-strip with a printer-aware renderer: for the confirmed Bixolon model, determine whether it needs (a) an Arabic ESC/POS code page + right-to-left byte ordering, or (b) rasterized receipt-as-image printing. Rasterization is the safer default across firmware variance — plan for a `renderReceiptAsImage()` path using an HTML5 canvas rendered to a monochrome bitmap sent via QZ Tray's image-print API, with the current ESC/POS text path kept as a fallback for English-only reprints.
- Replace `formatDate()`'s `toISOString()` with an `Asia/Qatar`-zoned formatter (`Intl.DateTimeFormat` with `timeZone: 'Asia/Qatar'`).
- Add a "generate downloadable/PDF receipt" path reusing the same renderer for email/WhatsApp delivery (P1, but implement the renderer so both paths share one source of truth).

**Cashier role + approver separation (P0-7):**
- Add `cashier` to the `user_role` enum. Cashier can hit sale/park/resume/customer-lookup/reprint/own-shift POS routes only; everything currently gated at `manager` stays there.
- Enforce **approver ≠ actor** at the `consumeOverride()` layer: reject if the approving manager's `admin_users.id` equals the session cashier's id for the same override request, unless an explicit `emergency_self_approval_enabled` tenant setting is on (separately audited via `audit_events`).

**Inventory ledger (P0-8):**
- Every direct `UPDATE product_variants SET stock_quantity = ...` site (`sale-service.js:463-470`, `correction-service.js:127-128`, `correction-service.js:383-388`) gets a paired `INSERT INTO inventory_movements` **in the same DB transaction**, using the existing `001_initial_schema.sql` table (already has the right columns — `delta`, `reason`, `reference_type`, `reference_id`, `created_by_user_id`, `metadata`). No new table needed for the ledger itself; add a small helper `recordMovement(client, {...})` in `server/lib/pos/db.js` or a new `server/lib/pos/inventory-ledger.js` so all three call sites use one function.
- Add a scheduled consistency job (simple cron-style script run via PM2 or a `node-cron` job in the server process) comparing `SUM(inventory_movements.delta)` reconstructed balance vs `product_variants.stock_quantity`, alerting on drift.

**Cash movements / Z-report history (P1, pulled forward per audit's "must fix before sole-POS cutover"):**
- New `pos_cash_movements` table for paid-in/paid-out/safe-drop/float-adjust, each requiring a reason and, for drawer-open-without-sale, a manager override token (reuse `pos_manager_overrides` with a new `drawer-open` action — already in `manager-service.js`'s `ACTIONS` set, just needs a route to consume it for this purpose).
- Z-report history/reprint: `pos_z_reports` already exists (migration 015) — add a `reprint`-safe read endpoint and an export (CSV/PDF) rather than new schema.

### DB schema

**Landed:** `server/db/migrations/017_pos_business_profile.sql` — the `pos_business_profile` table, wired into `server/db/pos-schema.js`'s `migrationPaths` (this project has no formal migration runner; each POS migration file is executed directly and must be idempotent via `IF NOT EXISTS`, matching the existing `015`/`016` pattern):

```sql
-- Business/legal receipt profile (APPLIED — migration 017)
CREATE TABLE IF NOT EXISTS pos_business_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trade_name_ar text NOT NULL DEFAULT '',
  trade_name_en text NOT NULL DEFAULT '',
  address_ar text NOT NULL DEFAULT '',
  address_en text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  cr_license_number text,
  return_policy_ar text,
  return_policy_en text,
  footer_stamp_ar text,
  footer_stamp_en text,
  updated_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
```

**Still pending** (not yet its own migration — will land as `019_pos_cashier_role_and_cash_movements.sql` or similar, since `017`/`018` are now taken by the business profile and card-reference work above):

```sql
-- Cashier role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cashier';

-- Cash drawer movements (paid-in/paid-out/safe-drop/float-adjust)
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES pos_shifts(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('paid_in','paid_out','safe_drop','float_adjust','no_sale_open')),
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  manager_override_id uuid REFERENCES pos_manager_overrides(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_shift ON pos_cash_movements(shift_id);

-- Emergency self-approval flag (tenant-level setting; default off)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pos_emergency_self_approval_enabled boolean NOT NULL DEFAULT false;
```

No new table for the inventory ledger itself — `inventory_movements` from migration 001 is reused as-is. Only new code writes to it.

### Workflow

1. ~~Land migration 017~~ **Done** — `pos_business_profile` table applied and verified (`\d pos_business_profile` confirmed all columns/constraints/FKs on the real dev DB).
2. Land `recordMovement()` helper + wire it into the three stock-mutation call sites, inside the same transaction that already updates `product_variants`. Add a DB integration test asserting `SUM(delta)` reconstructs `stock_quantity` after sale/void/refund sequences. **Not started.**
3. Land the consistency-check job; run it manually against staging data first, then schedule. **Not started.**
4. ~~Land `cashier` role + route-level scoping split~~ **Done** — migration `019_cashier_role.sql` adds `'cashier'` to the `user_role` enum (verified via `\dT+ user_role` on the real dev DB) and `pos_emergency_self_approval_enabled` to `tenants`; `pos.route.js`'s `POS_ROLES` now includes `cashier` (owner/admin-only actions like enrollment tokens and business-profile edits stay restricted inside their own service functions, not the router gate — same pattern the original design called for, just simpler than a `POS_CASHIER_ROLES`/`POS_MANAGER_ROLES` split). Client: `auth.service.ts`'s `UserRole`, `models/index.ts`'s new `TeamMemberRole`, `app.routes.ts`'s `/pos` route guard, and the settings invite/team-edit UI all updated to include `cashier`. Post-login redirect now sends a cashier straight to `/pos` instead of `/dashboard` (`login.component.ts`).
5. ~~Land approver-separation check~~ **Done, but in `verifyManagerPin()` rather than `consumeOverride()`** — the actual self-approval opportunity is at PIN-verification time (a manager-role user finding their own PIN hash in the candidate list), not at token-consumption time, so that's where the fix belongs. A matching manager whose `id === context.userId` is now skipped during PIN comparison unless `tenants.pos_emergency_self_approval_enabled` is true, in which case the approval succeeds but is flagged `selfApproval: true` in the `audit_events` row. Verified with two new unit tests (`pos-manager.test.js`) plus an updated end-to-end test that now uses a distinct second manager fixture for every void/refund/z-report approval (the old E2E test had the same user play both cashier and approver, which the new check correctly now rejects — that's exactly the gap P0-7 flagged). **Still open:** no admin UI toggle yet for the emergency flag itself; it can only be flipped by direct SQL today.
6. ~~Land `pos_business_profile` CRUD~~ **Done** (`server/lib/pos/business-profile-service.js`, `GET`/`PUT /api/pos/business-profile`). **Admin UI screen to edit it is still missing** — API-only right now.
7. ~~Land the receipt renderer rewrite~~ **Done** (canvas-based, Arabic + Qatar timezone) — **not yet tested against the actual Bixolon SRP-QE300 hardware**, only verified to compile/build. `pos-hardware.service.ts` now logs every stage (websocket connect, cert/signature fetch with online-vs-local-signer fallback, printer discovery, print call) to the console with timing and the real underlying error, specifically so a real-hardware test session can be diagnosed from DevTools on the register itself instead of guessing from a generic timeout.
8. Land `pos_cash_movements` routes/UI + Z-report reprint/export. **Not started.**
9. Get legal/accounting sign-off on a printed sample receipt before closing this phase. **Not started** — blocked on Phase 0's legal content decision and a real test print.

### Files touched

`server/db/migrations/017_pos_business_profile.sql` (new), `server/db/migrations/019_cashier_role.sql` (new), `server/db/pos-schema.js` (added to `migrationPaths`), `server/lib/pos/business-profile-service.js` (new), `server/lib/pos/manager-service.js` (self-approval check + tenant emergency-flag lookup + audit flag), `server/routes/pos.route.js` (`GET`/`PUT /business-profile`, `cashier` added to `POS_ROLES`), `server/routes/admin-settings.route.js` (`normalizeRole` rewritten with a real allowlist + `422` validation instead of silently accepting any string), `server/test/pos-manager.test.js` (2 new tests), `server/test/pos-authenticated-e2e.test.js` (second manager fixture for approvals), new `server/test/admin-settings-roles-e2e.test.js`, `client/projects/admin-portal/src/app/services/auth.service.ts` (`UserRole`), `client/.../models/index.ts` (`TeamMemberRole`), `client/.../app.routes.ts` (`/pos` guard), `client/.../pages/login/login.component.ts` (role-aware post-login redirect), `client/.../pages/settings/settings.component.ts` (Cashier option + role pill badges), `client/.../shared/pill/status-pill.ts` (new `rolePillKind()`), `client/.../i18n/strings.ts` (Cashier EN/AR strings), `client/projects/admin-portal/src/app/services/pos.service.ts` (`PosBusinessProfile` type + fetch/update methods), `client/.../pos-receipt-renderer.service.ts` (rewritten), `client/.../pos-hardware.service.ts` (business-profile caching + image-print wiring). Still pending: `server/lib/pos/inventory-ledger.js`, `server/lib/pos/correction-service.js` changes, cash-movements schema/UI, admin UI page for editing the business profile, admin UI toggle for the emergency self-approval flag.

### Exit gate

- [ ] Every sale/void/refund/adjustment writes an `inventory_movements` row in the same transaction as the stock update; consistency job shows zero drift on a full regression run. **Not started.**
- [x] `cashier` role exists, is route-scoped correctly (POS-only via `app.routes.ts` + `pos.route.js`), cannot access manager-only POS endpoints (those stay gated inside their own service functions by owner/admin checks) or any non-POS admin route (unaffected `roleGuard(['owner','admin'])` on settings/reference routes). Verified: server test suite 17/17 passing, client build succeeds.
- [x] A manager cannot approve their own action unless the emergency flag is explicitly enabled (and that path is audited). Verified with dedicated unit tests and an updated E2E flow using a distinct approving-manager fixture.
- [x] **Receipt renderer rebuilt as a canvas-rasterized image** (`client/.../pos-receipt-renderer.service.ts`) instead of raw ESC/POS text — raw text mode cannot shape/reorder Arabic at all, so the receipt body is now drawn on an HTML5 canvas (576px wide, sized for the confirmed Bixolon SRP-QE300's 80mm/203dpi print width) and sent to QZ Tray via its `type:'raw', format:'image', options:{language:'escpos'}` path; only the QR code + cut command remain as raw ESC/POS bytes appended after the image. Qatar local time (`Asia/Qatar` via `Intl.DateTimeFormat`) replaces the old UTC timestamp.
- [x] **`pos_business_profile` table + CRUD API added** (migration `017_pos_business_profile.sql`, `server/lib/pos/business-profile-service.js`, `GET`/`PUT /api/pos/business-profile`, owner/admin only). Client fetches and caches it (`pos-hardware.service.ts`, 5-minute TTL, falls back gracefully if offline) and feeds it into the receipt renderer for bilingual trade name/address/phone/CR-license/return-policy/footer fields.
- [x] **Admin UI screen added** — Settings → General now has a "Receipt & Legal Profile" card (owner/admin only) wired to `GET`/`PUT /api/pos/business-profile`.
- [x] **Hardware logging added** — `pos-hardware.service.ts` logs every QZ stage (websocket connect, cert/signature fetch, printer discovery, print calls) with timing and the real error, specifically to make on-device debugging possible during the real hardware test pass.
- [x] **Deployed to production and real-hardware-tested against the POSIFLEX/Bixolon SRP-QE300 register — found and fixed a genuine pre-existing bug** in `server/lib/pos/qz-service.js`'s `parseQzRequest()` (not introduced this session; it predates this plan): the function `JSON.parse()`d the QZ signing payload and tried to allowlist by printer name/call type, but QZ Tray's real client library only ever sends a SHA-256 **hash digest** of the call to be signed — never the original `{ call, params }` JSON. This meant **every real signing request was rejected** with `422 QZ_REQUEST_INVALID`, on every printer, unconditionally — the existing unit tests never caught this because they called `parseQzRequest` directly with hand-built fake JSON instead of going through the real `qz-tray` client library. Fixed by having the server sign the hash as opaque data (its only real role in QZ's protocol — proving key possession, not inspecting content); printer/call-type scoping was removed since it was never actually enforceable at this layer and now happens where it already correctly does, at the authenticated/enrolled-register checks on `/pos/transactions` and the print endpoints. The identical bug existed a second time in the standalone offline device-signer (`tools/pos-device-signer/index.js`) and was fixed the same way; that file's CORS `ELITE_POS_ALLOWED_ORIGINS` default was also missing the real production admin origin, which was the proximate cause of the CORS error seen during testing. **Tracked follow-up:** if per-printer server-side enforcement is wanted later, it requires changing the client to send the plaintext payload alongside the hash so the server can recompute and verify before signing — QZ Tray does not support this out of the box.
- [x] **Found and fixed a second real hardware bug, client-side**: after the server-side signing fix, real testing still hit `Signing failed TypeError: l is not a function` thrown inside QZ Tray's own minified code (`_qz.security.callSign`), before any network request. Root cause: QZ Tray's `callCert`/`callSign` helpers detect a genuine native `async function` via `handler.constructor.name === "AsyncFunction"` and call it directly; otherwise they assume a build-independent factory/executor shape. **First fix attempt was wrong**: binding the real `async` class methods (`this.fetchCertificate.bind(this)`) was based on the assumption that `.bind()` preserves `AsyncFunction` — true in plain Node, but Angular's production build (esbuild) transpiles `async` class methods into a plain function wrapping a generator-runtime helper (`fetchSignature(t){return C(this,null,function*(){...})}`), so the *shipped* function's constructor is always `Function`, never `AsyncFunction`, regardless of source syntax or binding. **Actual fix**: switched to QZ's other documented, build-independent shape — `setCertificatePromise` now takes a plain executor `(resolve, reject) => { this.fetchCertificate().then(resolve, reject) }` directly (QZ passes `certHandler` itself into `new Promise(certHandler)`), and `setSignaturePromise` takes a sync factory that returns an executor (QZ calls `signatureFactory(toSign)` first, then passes the result into `new Promise(...)`). Verified in the built bundle that the shipped code is now `setCertificatePromise((t,e)=>{this.fetchCertificate().then(t,e)},...)` — a plain executor, sidestepping the `constructor.name` check entirely. The local `qz-tray.d.ts` ambient type declaration (which only modeled the fragile `AsyncFunction`-returning-`Promise` shape) was widened to describe both real accepted shapes.
- [x] **End-to-end print confirmed on the real Bixolon SRP-QE300**: server signing + client signature-promise fixes both verified working (QZ's own request-details view showed `Signature: Valid`), and QZ Tray's one-time certificate trust was established via `authcert.override` in `qz-tray.properties` (pointed at the downloaded `/api/pos/print/certificate` content saved to `C:\ProgramData\ElitePOS\qz\digital-certificate.txt`) — printing is now silent, no per-print "Action Required" dialog.
- [x] **Found and fixed a third real hardware bug from the actual printed receipt photo**: the right ~15-20% of every line was cut off on paper. Root cause: `pos-receipt-renderer.service.ts`'s canvas `widthPx` was set to 576px assuming the SRP-QE300's full 80mm media width at 203dpi — but the printer's actual spec is 180dpi with only **72mm printable** (not the full 80mm media width), which computes to 510px, not 576px. Fixed by correcting `widthPx` to 510. **Still needs a re-print to visually confirm the fix** (not yet re-tested on paper after this specific change).
- [x] **Confirmed from the printed receipt: `pos_business_profile` is not yet filled in** — the test receipt showed English-only content with no Arabic, no address/CR/return-policy fields, which is expected/correct behavior (the renderer falls back to defaults when the profile is empty), not a bug. Filling in Settings → General → Receipt & Legal Profile is what's actually blocking a real bilingual receipt test now, not any remaining code work.
- [x] **Documented** the full `authcert.override` procedure, cert fingerprint/expiry reminder, and updated troubleshooting sections (untrusted-warning dialog, unreadable/cut-off receipts, remote-desktop click issues) in `docs/pos-hardware-runbook.md` §9.1 and §14, so this is repeatable for any future register.
- [ ] Legal/accounting sign-off obtained on the receipt layout. **Not started** — waiting on Phase 0's legal content decision.
- [ ] Cash paid-in/out/safe-drop/float-adjust recorded and reflected in shift close variance; Z-report reprint/export works. **Not started.**

---

## Phase 4 — Card payment reference capture and reconciliation (terminal confirmed standalone)

**Scope simplified per Phase 0 finding:** the card terminal has no cable/software link to the POS — the cashier keys the amount into it manually and it is not integrated with any till software, old or new. There is no ECR protocol to build against, so the original "generic terminal adapter + local bridge process" design is dropped entirely. This phase is now much smaller: make the existing manual-confirmation flow capture a real, mandatory reference instead of just a "mark as paid" checkbox, and add settlement reconciliation against the bank's own statement.

### Architecture decision

- Keep payment provider as manual confirmation (today's `pos-manual` in `sale-service.js:382`), but **require** the cashier to type in the terminal's printed transaction reference/approval code at the moment of payment, instead of accepting a bare "paid" flag with nothing behind it. This is the single concrete improvement available given a standalone terminal: today there is zero paper trail linking a POS sale to a specific terminal transaction; requiring the reference closes that gap without needing any integration.
- No local bridge process, no `terminal-adapter.js`, no serial/USB code on the register. This removes the audit's most hardware-uncertain component from the plan.
- Settlement/reconciliation becomes a **manual/CSV import** against the bank's end-of-day settlement report (however the bank currently provides it — likely a portal export), matched to POS card totals by business day. There is no live terminal API to query, so reconciliation is inherently a periodic (daily) batch process, not real-time.
- If Elite later wants true terminal integration (auto-populated reference, no manual typing), that would require replacing the standalone terminal with one that supports ECR/serial integration — an equipment decision, not a software one. This plan does not assume that will happen and does not block on it.

### DB schema

**Landed:** `server/db/migrations/018_pos_card_reference_and_reconciliation.sql` (no serial/terminal-protocol columns needed — just a manually-entered reference plus a reconciliation ledger), wired into `server/db/pos-schema.js`'s `migrationPaths` and verified against the real dev DB:

```sql
ALTER TABLE payments ADD COLUMN IF NOT EXISTS terminal_reference text;

CREATE TABLE IF NOT EXISTS pos_card_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  pos_total_cents integer NOT NULL,
  settlement_total_cents integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','exception','resolved')),
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, register_id, business_date)
);
```

No `terminal_id`/`auth_code`/`rrn`/`masked_pan` columns — a standalone terminal gives the cashier only whatever the receipt slip prints (typically just an approval code), so `terminal_reference` is a single free-text field for that. Never add a column for raw PAN/CVV/track data.

### Workflow

1. ~~Make `terminal_reference` a **required field**~~ **Done**, both sides:
   - Client: `pos.component.ts`/`pos.component.html` — a "Terminal reference / approval code" input appears when Card is selected, "Complete sale" is disabled until it's non-empty, and the value flows into the sale payload and onto the printed receipt.
   - Server: `sale-service.js`'s `normalizeSale()` requires a non-empty `payment.terminalReference` whenever `method === 'card'` (rejects with `422 INVALID_FIELD` otherwise) and ignores/nulls it for cash tenders; stored on the `payments` row via the new `terminal_reference` column. Covered by both a unit test (`pos-sale.test.js`) and a real end-to-end HTTP test (`pos-authenticated-e2e.test.js` — asserts the 422 rejection without a reference, then a successful card sale with one).
2. Build a simple settlement-import screen: owner/manager pastes or uploads the bank's daily settlement figures (CSV or manual entry, whatever the bank actually provides — confirm the export format with the bank when convenient), the system totals POS card sales for that business day per register and writes/updates the matching `pos_card_reconciliation` row, flagging `exception` when totals don't match within a small tolerance. **Not started** — the table exists but nothing reads/writes it yet.
3. Add an exception-review UI so a mismatch requires an explicit manager note/resolution before being marked `resolved` — never silently adjust POS totals to match the bank figure. **Not started.**

### Files touched

`server/db/migrations/018_pos_card_reference_and_reconciliation.sql` (new), `server/db/pos-schema.js` (added to `migrationPaths`), `server/lib/pos/sale-service.js` (`normalizeSale`'s `terminalReference` requirement + `payments` insert), `server/test/pos-sale.test.js` (new unit tests), `server/test/pos-authenticated-e2e.test.js` (new card-sale coverage, transaction-count assertion updated 3→4), `client/.../pos.component.ts` + `pos.component.html` (terminal reference field), `client/.../pos-receipt-renderer.service.ts` (prints the reference on card receipts). Still pending: settlement-import route + admin UI page, exception-review UI.

### Exit gate

- [x] Terminal architecture confirmed: standalone, no cable/software integration — no protocol work needed.
- [x] No PAN/track/CVV ever reaches the browser or database — trivially true, nothing talks to the terminal in software at all; the only new column is a free-text `terminal_reference`.
- [x] `terminal_reference` is mandatory on every card-tender sale; checkout rejects a card payment with a blank reference, both client- and server-side. Verified: server test suite 14/14 passing, including a real HTTP 422 rejection and a successful card sale with a reference.
- [ ] Settlement import screen built; at least one real reconciliation cycle run against an actual bank statement. **Not started.**
- [ ] Exception review UI requires a manager note before marking a mismatch resolved; never auto-adjusts POS totals. **Not started.**

---

## Phase 5 — Core reporting (pulled forward before pilot, per your priority)

### Architecture decision

Build reports as **read-only SQL views/queries over the ledgers now written in Phases 3-4** (`inventory_movements`, `pos_cash_movements`, `pos_transactions`, `pos_card_reconciliation`) rather than new aggregate tables — these ledgers are now the source of truth, so reports should derive from them, not duplicate state. Use materialized views only if a specific report proves too slow as a live query against production data volume (unlikely at one-shop scale).

Reports to ship for pilot readiness:
- Daily sales by payment method, cashier, register, item/variant, hour.
- Cash drawer movement + variance report (from `pos_cash_movements` + `pos_shifts` close data).
- Card settlement/reconciliation exception report (from `pos_card_reconciliation`).
- Inventory movement / shrinkage report (from `inventory_movements`, filterable by `reason`).
- Refund/void/discount/no-sale exception dashboard (from existing `pos_refunds`/`pos_voids` + new cash movements).
- Z-report history list with export (existing `pos_z_reports`, already has the data — just needs a list/export UI).

### DB schema

No new tables. Optional read-optimizing indexes if query plans need it once real data volume exists:

```sql
CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_occurred ON inventory_movements(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_tenant_business_date ON pos_transactions(tenant_id, business_date);
```//placeholder — confirm actual column name for the transaction's business-day field in migration 015 before applying.

### Workflow

1. Confirm Phase 3's `Asia/Qatar` business-day boundary logic is available as a shared SQL/JS helper (reports need the same "business day," not UTC midnight, as the receipt/shift-close logic).
2. Build each report as a scoped Express route + Angular admin screen, reusing the existing admin-portal reporting page patterns already in the codebase rather than inventing a new UI shell.
3. Add CSV export on every report (owner will want to hand these to an accountant).
4. Load-test the daily sales report against a seeded dataset sized for expected pilot volume before sign-off.

### Files touched

New `server/routes/pos-reports.route.js` (or extend existing reporting routes if a pattern already exists in `server/routes/`), new admin-portal reporting pages under `client/projects/admin-portal/src/app/pages/`.

### Exit gate

- [ ] All six reports above are live, filterable by date range/register/cashier, and exportable to CSV.
- [ ] Business-day boundary in reports matches the shift-close/receipt business-day logic (no UTC-midnight mismatch).
- [ ] Owner has reviewed at least one full day's real-shaped data across all six reports.

---

## Phase 6 — Pilot and cutover (gate, not a build phase)

Carried forward from the audit's Phase 6 unchanged — this doc doesn't re-plan it since it's an operational process, not engineering work. Do not start the pilot until Phases 1-5's exit gates are all checked.

- [ ] Staff training completed.
- [ ] Backup/restore drill executed and passing (RPO/RTO from Phase 0 decision).
- [ ] Parallel pilot: 10 consecutive business days, representative peak load, zero unexplained cash variance, zero lost/duplicate sale, 100% sync recovery, successful restore drill, signed hardware acceptance.
- [ ] Rollback plan documented and rehearsed.
- [ ] Old POS decommission decision made only after the above gate is fully green.

---

## Open risks carried into this plan

- **Card terminal stays fully manual.** Resolved (no longer a risk to Phase 4 timing) — the terminal has no software/cable integration, so there's no reference reconciliation beyond what the cashier manually types in and what the bank's settlement export shows. The residual risk is human error (cashier forgets/mistypes the reference, or the bank's settlement format changes), not engineering/protocol risk. If Elite later replaces the terminal with an ECR-capable one, this phase would need revisiting.
- **Register hardware is weak (Celeron J1900, ~786MB free RAM, 12" resistive touch at native 1024×768).** Every later phase (Angular upgrade, PWA/offline work, receipt rendering) needs to be validated on this actual hardware, not just a dev machine — a bundle/animation budget that's fine on a laptop can be unusable here. Screen-fit issue is being worked (native resolution fix in progress); revisit whether dedicated POS CSS is still needed once that's confirmed.
- **Angular 17→21 upgrade** is the single largest effort item in Phase 1 and carries the most regression risk across the whole admin portal, not just POS. Budget real calendar time and a full manual regression pass per major version hop.
- **Browser-only durability (your chosen direction for P0-2)** means the enrolled terminal's browser profile remains the only pre-sync record of a completed cash sale. Persistent storage + journal + audit-window retention meaningfully reduce (but do not eliminate) the residual risk the audit flagged for a full local-agent architecture. This should be an explicitly accepted risk, documented and signed off by the owner in Phase 0, not a silent gap.
