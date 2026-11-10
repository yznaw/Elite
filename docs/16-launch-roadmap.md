# Elite POS — Path to Official Launch: Roadmap & Test Gates

**Status as of 2026-07-19.** This picks up where [15-pos-production-hardening-plan.md](15-pos-production-hardening-plan.md) left off — that doc tracks *what's been built*; this one sequences *what's left* into shippable phases with explicit test gates, so each phase is provably done before starting the next.

**Confirmed working today** (hardware-tested on the real POSIFLEX/Bixolon SRP-QE300 register): security baseline, cashier role + approver separation, card terminal-reference capture, bilingual canvas receipt renderer (redesigned with the real Elite logo and premium typography), QZ Tray signing end-to-end, business-profile editing UI, "Go to POS" link in the admin topbar.

**Not yet started**: Phase 2 (cashier follow-ups, explicitly skipped per owner — client doesn't need it), legal receipt sign-off, multi-branch data model.

**In progress** (committed, not yet deployed to VPS / not yet fully verified): Phase 0.5 receipt print fixes + reprint/remote-enrollment UI (commit `d4c9b62`), Phase 1 inventory ledger (commit `10ba2be`), printer auto-discovery + site-data-wipe fix (commit `6ce8fc8`), Phase 3 cash movements + Z-report history (commit `f13b295`), manager-PIN self-service + false-session-expiry + dashboard-flash fixes (commit `dec6a58`), Phase 4 card settlement reconciliation (commit `23d46ad`), Manager-PIN-access + hardcoded-invite-link fixes (commit `6dba5c6`), Phase 7 PWA installability (commit `856a74b`) + offline resilience (commit `635dac1`), Phase 6 Angular 17→22 upgrade (commit `84e72d6`), Phase 5 core reporting suite (commit `9437a13`), Phase 9 backup/restore scripts (drilled against dev data, not yet installed on the VPS). All 21 server tests passing, client build green, `npm audit` clean.

Every phase through 9 is now built except Phase 2 (intentionally skipped). What's left is verification (hardware/manual/real-data testing across everything above, plus running the Phase 9 scripts for real on the VPS) plus Phase 8 (legal sign-off, not code) and Phase 10 (pilot, gated on everything else).

---

## How to use this roadmap

- Phases are ordered by **dependency**, not just priority — Phase 1 (inventory ledger) unblocks Phase 5 (reporting); Phase 10 (pilot) cannot start until Phases 1-9 are all green.
- Every phase ends with an explicit **Exit gate**: a checklist that must be 100% true before moving on. Don't skip ahead because a later phase "seems more urgent" — an ungated skip is how silent data corruption creeps into a money system.
- "Tested" means: automated test passing AND (where hardware/UI is involved) a human manually exercised the real flow and watched it work — not just "the code compiles."

---

## Phase 0 — Quick win: "Go to POS" link in the admin portal ✅ Done

**Why first:** trivial, zero dependencies, immediate daily-use improvement — there was no direct navigation from the admin portal to `/pos`; an owner/manager had to know the URL or bookmark it.

### What was built
- A "Go to POS" link with a store icon in the admin portal's topbar (`client/projects/admin-portal/src/app/shared/topbar/topbar.component.ts`), visible to owner/admin/manager roles (cashier never sees the admin shell at all, per the existing route split — no cashier-facing change needed).
- Opens `/pos` in a new tab, so a manager checking reports mid-shift doesn't lose their admin session state by navigating away.
- Uses the project's existing icon component (`ap-icon name="store"`) — no hand-rolled SVG.
- Bilingual label (`topbar.goToPos` i18n key, English + Arabic).

### Test gate
- [x] Button visible for owner/admin/manager roles via `AuthService.hasRole()`.
- [ ] Manual: confirmed clickable on both desktop admin browser and, if relevant, the same browser profile used on a register — **still needs a real click-through check**, only build-verified so far.

---

## Phase 0.5 — Receipt print-quality fixes + reprint + remote enrollment ✅ Built, needs hardware verification

**Why here:** found during real hardware testing on 2026-07-19 (see printed receipt review). Small, independent, no DB migration required for the print fixes — should land before Phase 8's legal sign-off since that phase requires a legible real receipt, and this phase is what makes it legible.

**Status:** all four fixes below are implemented and pushed (commit `d4c9b62`), client build + full server test suite green. **Not yet confirmed on the real printer** — every item in the test gate still needs a hands-on check on the actual SRP-QE300.

### What to build

**A. QR code clipped top/bottom on the printed receipt**
- Root cause: the QR is **not** part of the canvas image — it's generated printer-side via raw ESC/POS `GS ( k` commands in `pos-receipt-renderer.service.ts`'s `qrCode()` (`footerCommands()`), sent as a separate print job appended after the receipt image. The code only reserves ~60px (~8.5mm) of blank space below the image for it, and the auto-cut command fires immediately after, with no explicit margin — the physical QR (module size 4, level-M correction) is very likely taller than the reserved space, so the cutter can cut through it before it's fully clear.
- Fix: increase the reserved vertical space before the cut to comfortably exceed the real printed QR height for the actual payload length, and add an explicit feed/margin command between the QR print command and the cut command so there's guaranteed blank paper between them.
- Verify module size (4) and error-correction level (M) are being kept — these are fine and not the cause; don't change them without reason.

**B. Garbled/missing letters in printed text ("Net Cream" → "N t C  am 5", cashier name, etc.)**
- Root cause: QZ Tray's default print quantization (`quantization: "alpha"`, `threshold: 127`) applies a hard black/white cutoff to the whole canvas image. The logo is already explicitly pre-thresholded to survive this (`drawThresholdedImage()`), but body/meta text is drawn with normal anti-aliased `ctx.fillText()` and never gets the same treatment — small font sizes (11-13px) and thin serif strokes (Georgia) lose faint anti-aliased edge pixels under a hard 50% cutoff, which drops letter fragments.
- Fix (two complementary options, do both):
  1. Pass an explicit `quantization`/`threshold` option in the QZ print call (`pos-hardware.service.ts`) tuned for this printer instead of relying on the silent default — try `dither` mode first since it's generally friendlier to anti-aliased source images than a hard alpha threshold.
  2. Apply the same threshold-before-render treatment already used for the logo (`drawThresholdedImage()`) to the text layer, or bump the minimum font size for anything under ~13px so strokes survive thresholding at 180dpi.
- Test by printing the exact same receipt content (with today's problem words: "Net Cream", a cashier's real name, "test-fit-print") after each fix and visually confirming full, legible characters — not just "looks better."

**C. No durable reprint path for a saved-but-failed-to-print receipt**
- Currently: if `hardware.printReceipt()` throws after a sale, the sale is safely in the DB but the only reprint UI (`reprintLastSale()` / "Print again" on the Sale Complete modal) is backed by an in-memory Angular signal (`lastSale`) — wiped on page reload, tab close, or once the next sale completes. There is no queue, no persistence, and no way to reprint an older transaction from the UI.
- Server side already supports it: `GET /api/pos/transactions/:id` and the lookup-by-receipt-number variant both return full `receipt.receiptData` ready to feed straight into the existing render/print pipeline.
- Fix: add a "Reprint receipt" action to the existing transaction lookup panel (`lookupTransaction()` / `operationTransaction()` in `pos.component.ts`, already used for void/refund) that calls `hardware.printReceipt()` with the looked-up transaction's `receipt.receiptData` — reuses code that already exists, no new server work needed.

**D. No remote/admin UI to generate a POS enrollment token**
- Currently: `createEnrollmentToken()` requires being physically at (or remoted into) the specific register at the moment of setup — token creation and consumption happen back-to-back in the same click (`enrollTerminal()` in `pos.component.ts`). There's no admin-portal "Settings → Registers" page to pre-generate a token remotely for a register being set up elsewhere (e.g. a new branch/location).
- Server API already supports splitting these (`POST /pos/registers/enrollment-tokens` is already decoupled from `POST /pos/registers/enroll` server-side; the client just always calls both together).
- Fix: add a small "Registers" section somewhere in Settings (owner/admin only) that calls `pos.service.ts`'s existing `createEnrollmentToken()` on its own, displays the resulting token/code (15-minute TTL, single-use — already enforced server-side), for a manager to relay to whoever is physically setting up the new register.

### Test gate
- [ ] Manual: print a real receipt containing "Net Cream", a real cashier name, and the CR/license footer line — every character legible, zero dropped letters, compared side-by-side against today's problem receipt.
- [ ] Manual: print a receipt and confirm the QR code prints fully intact (not clipped top/bottom or left/right) on at least 5 consecutive prints (auto-cut timing can be marginal/intermittent, so one clean print isn't enough evidence).
- [ ] Manual: scan the printed QR with an actual phone camera and, separately, a dedicated barcode/QR scanner if the shop has one — confirm both read it correctly.
- [ ] Manual: look up a transaction from an hour/day ago in the POS lookup panel and successfully reprint its receipt.
- [ ] Manual: an owner/admin generates a registration token from Settings without touching the target register, and a second person on a different device/register successfully enrolls using that token before it expires.

---

## Phase 1 — Inventory ledger (writes to `inventory_movements`)

**Why first (of the remaining work):** every later phase that touches money/stock (reporting, reconciliation, cash movements) needs a trustworthy stock trail to build on. Right now sales/voids/refunds silently mutate `product_variants.stock_quantity` with zero audit trail — if stock is ever wrong, there's no way to find out why.

### What to build
- `recordMovement()` helper in `server/lib/pos/inventory-ledger.js`, called inside the same DB transaction as every stock-mutating call:
  - `sale-service.js:463-470` (sale decrements stock)
  - `correction-service.js` void-restock and refund-restock sites
- A scheduled consistency job comparing `SUM(inventory_movements.delta)` per variant against `product_variants.stock_quantity`, alerting on drift.

### Test gate (must all pass before Phase 2)
- [ ] Unit test: a sale writes exactly one `inventory_movements` row with the correct signed delta, `reason`, `reference_type`, `reference_id`.
- [ ] Unit test: a void restores stock AND writes a second ledger row (not just an update).
- [ ] Unit test: a partial refund's restock writes a ledger row scaled to the refunded quantity, not the full original sale quantity.
- [ ] Integration test: two concurrent sales against the last unit of stock — exactly one succeeds, and the ledger has exactly one debit row (no double-write, no missing write).
- [ ] Consistency job run against a seeded dataset with a deliberately corrupted `stock_quantity` — confirms it actually detects and reports the drift (not just "runs without erroring").
- [ ] Manual: ring up 5 real sales + 1 void + 1 partial refund on the actual register, then query `inventory_movements` directly and confirm the running balance matches what's shown in the product's stock count in the admin catalog.

---

## Phase 2 — Cashier role hardening follow-ups ⛔ Skipped (owner decision, 2026-07-20)

**Why here:** this session already shipped the cashier role and approver-separation fix. This phase is just closing the two small gaps that were explicitly deferred.

**Status:** explicitly skipped — owner doesn't expect the client to need this. `pos_emergency_self_approval_enabled` remains SQL-only (no UI toggle); if a genuinely one-person-shop scenario comes up later where self-approval is needed, this can be picked back up then.

### What to build
- Admin UI toggle for `pos_emergency_self_approval_enabled` (currently SQL-only).
- Confirm no regression on the already-decided scope: cashiers see nothing outside `/pos`.

### Test gate
- [ ] Manual: an owner can flip the emergency-approval flag from the UI, and doing so writes an audit event (already coded server-side — just needs a UI hook, verify it round-trips correctly).
- [ ] Manual: a cashier account, freshly created, can log in and reach `/pos` and nothing else — attempting to navigate directly to `/settings` or `/catalog` by URL redirects/blocks correctly.

---

## Phase 3 — Cash movements & Z-report history ✅ Built, needs hardware verification

**Why now:** depends on nothing from Phase 1 structurally, but sequenced here because it's the other half of "can we trust the numbers at end of day" — inventory ledger for stock, cash movements for cash. Doing them back-to-back means one hardware/UI testing session covers both money trails.

**Status:** built and pushed (commit `f13b295`). All 19 server tests pass, client builds clean. **Not yet confirmed on the real register** — every item in the test gate below still needs a hands-on check.

### What was built
- `pos_cash_movements` table (migration 021) — paid-in, paid-out, safe-drop, float-adjust, no-sale-drawer-open, each requiring a reason. Cash-out kinds (paid-out, safe-drop, no-sale-drawer-open) require a manager override (reuses the existing `drawer-open` override action); paid-in and float-adjust don't.
- UI in the POS shift screen (`pos.component.ts`/`.html`) for cashiers/managers to log these, with a running list for the current shift.
- Z-report printing, built for the first time — previously a Z-report was generated on shift close but never printed at all. New `renderZReport()` layout in `pos-receipt-renderer.service.ts`, printed via a new `printZReport()` on the hardware service.
- Z-report history list (`GET /pos/shifts/z-reports`, `/pos/shifts/z-reports/:id`) with reprint and CSV export in the shift dialog.
- Cash movements wired into the shift-close variance calculation (`shift-service.js`'s `loadShiftSummary`): `expectedCashCents` now nets cash-in against cash-out. `pos_z_reports` gained `cash_in_cents`/`cash_out_cents` columns so this is queryable directly, not just buried in `report_data` jsonb.

### Test gate
- [ ] Manual: open a shift, do a real cash paid-out (e.g. "petty cash for supplies") with a real manager PIN approval, close the shift, and confirm the variance report reflects it correctly — verify by hand-counting the actual drawer against the expected total.
- [ ] Manual: do a no-sale drawer-open from the POS and confirm the physical drawer actually pulses open (not just recorded in the DB).
- [ ] Manual: print a Z-report for the first time on the real printer and visually confirm the layout is legible and complete (never printed on real hardware before this phase).
- [ ] Manual: reprint an old Z-report from history and confirm it matches what was originally printed (no silent data drift on reprint).
- [ ] Manual: export Z-report history to CSV and open it in Excel/Google Sheets, confirm all columns are present and readable.

---

## Phase 4 — Card settlement reconciliation ✅ Built, needs hardware/real-data verification

**Why now:** depends on nothing else, but lower urgency than Phases 1-3 since the terminal-reference capture (already shipped) is the acute fix; full settlement matching is a "close the books cleanly" feature, not a transaction-integrity one.

**Context:** the old POS system's own function-key menu has a "Close Batch" concept (likely end-of-day card batch settlement) and an "Audit Report" (likely a transaction/void/refund audit trail). Worth confirming with staff whether "Close Batch" on the old system actually talks to the card terminal/acquirer or is purely an internal record — that's real evidence about how card settlement already works day-to-day at this shop, and should inform this phase's design instead of guessing.

**Status:** built and pushed (commit `23d46ad`). All 20 server tests pass (including a new dedicated E2E test covering matched/exception/resolve-requires-note), client builds clean.

### What was built
- New admin-only "Reconciliation" page (Settings-adjacent nav item, owner/admin/manager only — `pos-reconciliation.component.ts`), reachable at `/reconciliation`.
- Manual entry of the bank's daily settlement total per register/business-day, matched against the POS's own card total within a QAR 1.00 tolerance (`card-reconciliation-service.js`).
- A "Check POS total" button that recomputes the live POS-side card total for a register/day before a settlement figure is entered.
- Exception-review flow: marking an exception `resolved` requires a manager note (enforced server-side, not just in the UI — verified by test).
- Reconciliation history list with a status filter (pending/matched/exception/resolved).
- **CSV bulk-import specifically was descoped** — the roadmap allowed "manual/CSV entry"; only manual single-day entry was built. If the bank consistently exports a CSV with many business-days' settlement totals at once, a bulk-import path can be added later without changing the underlying service.

**Significant bug found and fixed while building this:** the production Postgres session runs with `TimeZone = Asia/Qatar` already configured (confirmed via `SHOW TIMEZONE` — not something this app sets, it's server/database-level config). This means a single `timestamptz AT TIME ZONE 'Asia/Qatar'` double-converts — the session already displays the value shifted to Qatar time, and applying `AT TIME ZONE` again shifts it a second time, landing on the wrong calendar day for anything computed near local midnight. Fixed in this phase's business-date bucketing by normalizing through UTC first: `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Qatar'`, which is correct regardless of the session's own timezone setting. **This is exactly the trap Phase 5's test gate below already anticipated** — any other business-date bucketing added in Phase 5 (or anywhere else) must use this same double-conversion pattern, not a single `AT TIME ZONE`.

### Test gate
- [x] Unit/integration test: a settlement total that matches POS card totals within tolerance is marked `matched` automatically. (Automated E2E test, `pos-card-reconciliation-e2e.test.js`.)
- [x] Unit/integration test: a mismatch is flagged `exception` and cannot be marked `resolved` without a note. (Same test file — also confirms resolving twice doesn't create a duplicate row.)
- [ ] Manual: run one real reconciliation cycle against an actual bank statement for a completed business day, confirm the numbers the system shows match what you'd calculate by hand.

---

## Phase 5 — Core reporting ✅ Built, needs real-data verification

**Why now, not earlier:** this is explicitly gated on Phases 1, 3, and 4 — reports read from `inventory_movements`, `pos_cash_movements`, and `pos_card_reconciliation`, so building reports before those ledgers exist would mean reporting on incomplete/wrong data.

**Status:** built and pushed (commit `9437a13`). All 21 server tests pass (including a new dedicated E2E test that seeds a full sale/void/refund/cash-movement/settlement/Z-close sequence and checks all six report endpoints' numbers directly against it), client builds clean.

### What was built
- Single "Reports" admin page (`/reports`, owner/admin/manager — same access scope as `/reconciliation`) with a tab per report and a shared date-range + register filter bar, rather than six separate pages/routes.
- All six reports are **read-only queries over existing ledger tables** — no new tables, per the original architecture decision in docs/15:
  - Daily sales — by day, payment method, cashier, register, hour, and item.
  - Cash drawer movements + shift-close variance (`pos_cash_movements` + `pos_z_reports`).
  - Card settlement exceptions (`pos_card_reconciliation`).
  - Inventory movement/shrinkage, grouped by reason (`pos_sale`/`pos_void`/`pos_refund`), plus a live drift-alert query reusing the same baseline-vs-ledger comparison as Phase 1's hourly consistency job.
  - Refund/void exception dashboard (`pos_voids` + `pos_refunds`, with manager-approval names joined in).
  - Z-report history, filterable by date range/register.
- CSV export per report, BOM-prefixed for Excel compatibility with Arabic cashier/product names (matches the pattern already used in `customers`/`catalog`/`orders` CSV exports, not `pos.component.ts`'s non-BOM variant).
- Every business-date computation uses the double-UTC-conversion pattern from Phase 4 (`(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Qatar'`) — verified correct end-to-end by the new E2E test, not just by inspection.

**Bug found and fixed while building this:** three of the six report functions (`dailySales`, `inventoryMovements`, `refundVoidExceptions`) originally ran their multiple queries via `Promise.all()` against one shared `pg` client. A single database connection cannot run concurrent queries — `pg` only tolerates it today via deprecated internal queueing, and a real deprecation warning appeared in the test output the first time this ran. Fixed by converting to sequential `await`s in all three functions. Worth checking any future multi-query report/service code in this codebase for the same mistake.

### Test gate
- [ ] Each report's numbers cross-checked by hand against raw ledger queries for one real business day. (Automated equivalent done — the E2E test seeds known data and checks exact numbers — but a human hasn't yet checked it against one real day's actual data.)
- [x] Business-day boundary in every report uses `Asia/Qatar`, not UTC midnight — verified by the E2E test using the same double-UTC-conversion pattern as Phase 4.
- [ ] CSV export opens cleanly in Excel/Google Sheets with correct encoding (no mangled Arabic text in exported CR/business-name fields, if included) — needs a human to actually open an exported file.
- [ ] Manual: owner reviews one full real day's data across all six reports and confirms it "looks right" against their own memory of that day's sales.

---

## Phase 6 — Angular 17→22 security upgrade ✅ Built, needs manual click-through verification

**Why here, not first:** this is pure dependency hygiene with no user-facing behavior change — sequencing it after the money-critical phases means it doesn't block real progress, but it must land before Phase 10 (pilot) since it closes real CVEs in the framework the whole app runs on.

**Status:** built and pushed (commit `84e72d6`). Went further than the original 17→19 target — Angular had moved on to v22 by the time this phase started, and npm's own advisory data showed the XSS CVEs this phase exists to close are only actually fixed at ≥19.3/21.x, not 19.2. Stopping at 19 as originally scoped would have finished the phase with the vulnerabilities still present, so this went 17→18→19→20→21→22, one hop at a time, with a type-check + production build of both projects + full server test-suite run after each hop.

### What was built
- `npm audit --production` on `client/`: 8 high-severity Angular XSS/sanitization CVEs → **0 vulnerabilities**.
- All file changes are from Angular's own `ng update` migration schematics (standalone-component flag cleanup at v19, `ChangeDetectionStrategy.Eager` + `$safeNavigationMigration()` at v22, tsconfig lib/diagnostics updates) plus five components' genuinely-dead imports that Angular 19's stricter unused-import diagnostic caught (removed, not suppressed).
- TypeScript 5.4 → 6.0, zone.js 0.14 → 0.15.
- Confirmed both dev servers (`admin-portal`, `client-web`) boot and serve HTTP 200 on Angular 22.
- One optional v21 migration failed with a path-resolution error specific to this workspace's multi-project layout — confirmed inconsequential (both `main.ts` files already use the modern form the migration targets, so it had nothing to change).

### Test gate
- [x] `npm audit` on `client/` shows zero unresolved high/critical after reaching 22 (went further than the original v19 target since v19 alone didn't close the CVEs).
- [ ] Full manual click-through of storefront (browse, cart, checkout), admin portal (catalog, orders, settings, the new receipt-profile page), and POS (sale, void, refund, cashier login) — nothing visually or functionally regressed. **Not yet done by a human** — only automated build/test/audit checks and a basic dev-server boot check have been run.
- [ ] Automated Playwright suite (once fixed — see Phase 7) passes on the upgraded build.

---

## Phase 7 — PWA / offline resilience hardening ✅ Built, needs hardware/kiosk verification

**Why here:** this was Phase 2 in the original audit and hasn't been touched this session at all. It's real, separate work — installable manifest, generated service-worker precache, persistent storage request, connectivity-recovery polling, offline queue journal.

**Status:** built and pushed across two commits — installability (`856a74b`): web app manifest + app-wide service-worker registration; offline resilience (`635dac1`): health-check polling, IndexedDB v4 journal, persistent storage. All 20 server tests pass, client builds clean.

### What was built
- `manifest.webmanifest` (name, 192/512 icons, `start_url: /dashboard`, `display: standalone`) linked from `index.html`. Note this deviates from docs/15's original narrower spec (`pos.webmanifest` scoped to `/pos` only) — the user's actual ask was "make the browser's install prompt appear" for the admin portal generally, not POS-specifically, so the manifest covers the whole app. If a separate POS-only installable experience is wanted later, this can be split.
- Service-worker registration moved from `pos.component.ts`'s `ngOnInit` to `main.ts`, so it registers on first load of ANY page, not only after a user happens to visit `/pos` first (a manifest alone isn't enough for the install prompt — a fetch-handling SW must also be active).
- **Fixed a regression this uncovered:** `pos-sw.js`'s navigate handler used to fall back to the cached `/pos` shell for any failed navigation. Harmless while POS-scoped; would have silently served the wrong page for an offline `/dashboard` or `/catalog` visit now that the worker is app-wide. Scoped the fallback to `/pos` paths only.
- `GET /pos/health-check` (authenticated), polled with 15-30s jitter whenever offline or after a failed sale/sync — independent of the browser's `online`/`offline` events, which only reflect the network interface, not real API reachability. Fixes the exact gap docs/15 flagged (`pos.component.ts`'s sale-failure path only used to wait for a browser event or the next manual sync).
- IndexedDB bumped 3→4 (additive only): new `pos-queue-journal` store logging `created`/`printed`/`sync_attempted`/`accepted`/`rejected` lifecycle events per offline sale, for a future support-bundle export. `pending-sales` rows are kept for a 7-day local audit window after syncing (`status: 'synced'`) instead of being deleted immediately; a cleanup sweep purges only synced rows past the window.
- `navigator.storage.persist()` requested on POS init; a `false` result **warns** rather than hard-blocking shift-open (docs/15 specified a hard block, but `persist()`/quota heuristics are known to be unreliable across browsers — a false-positive block on a legitimate register would be worse than the offline-data-loss risk it guards against). Quota estimate polled every 5 minutes while the POS is open.
- Status strip in the POS UI: pending count with oldest-pending age (2min/10min severity thresholds), last-sync time, and a distinct "server unreachable" indicator.

### Test gate
- [ ] Lighthouse PWA installability check passes; app actually installs on the target Windows/Chrome kiosk setup.
- [ ] Cold offline launch (installed, browser fully closed, no network, reopen) works.
- [ ] Simulated "API down, LAN up" scenario recovers without any browser `online` event firing.
- [ ] A sale made fully offline, then synced once connectivity returns, produces exactly one server-side transaction (no duplicate).
- [ ] Manual: unplug the register's network cable mid-shift, ring up 2 real sales, plug the cable back in, confirm both sync correctly and the receipt-number sequence has no gaps or collisions.
- [ ] Manual: confirm the install/download prompt actually appears in the browser's address bar or menu on the production admin portal URL.
- [ ] Manual: verify an offline navigation to `/dashboard` (not `/pos`) shows a normal browser offline error, not the POS shell — this is the regression the `pos-sw.js` fix targets.

---

## Phase 8 — Legal & compliance sign-off

**Why here:** this is a process gate, not an engineering one, but it blocks the pilot — Qatar MOCI requires the receipt content to be legally reviewed, and that can only happen once real business content is entered.

### What to do
- [ ] Fill in `pos_business_profile` with the tenant's real, final trade name (Arabic + English), address, phone, CR/license number, and return policy — not the placeholder/test data used during this session's hardware testing.
- [ ] Print a real receipt with that final content and get explicit sign-off from local legal/accounting that it satisfies MOCI's consumer-invoice requirements.
- [ ] Confirm the Arabic text on the physical printed receipt is legible and correctly shaped (visual check — the rendering pipeline is confirmed technically working, but nobody has yet looked at real Arabic business content on paper).

### Test gate
- [ ] Written sign-off obtained and filed (email or physical signature — this is a legal/audit-trail requirement, not just a verbal "looks fine").

---

## Phase 9 — Backup, restore drill, and disaster recovery ✅ Built + drilled against dev data, needs production install + real drill

**Why here:** genuinely independent of all the above phases technically, but should land before the pilot since "we've never tested a restore" is not an acceptable state to enter a real money-handling pilot with.

**Status:** scripts written and pushed. **Actually tested end-to-end** (backup → GPG-encrypt → decrypt → `pg_restore` → row-count verification) against a local dev database in this session — real drill, real data, not a dry read of the code. Not yet installed or run on the production VPS (this session has no SSH access there) — see `docs/18-backup-restore-runbook.md` for the full setup and drill procedure someone with server access needs to run once.

### What was built
- `scripts/backup-database.sh` — `pg_dump -Fc` → GPG symmetric AES256 encryption → dated file in `BACKUP_DIR` → prunes anything older than `BACKUP_RETENTION_DAYS` → emails `BACKUP_ALERT_EMAIL` via the app's existing `server/lib/mailer.js`/SMTP config on any failure. Refuses to treat a suspiciously small dump as valid rather than silently "succeeding" with a broken backup.
- `scripts/restore-database.sh` — decrypts and `pg_restore`s into a target database, with a hard safety check that refuses to run against a database literally named `elite` (the production name) unless explicitly overridden — restore drills must always target a disposable, differently-named database.
- `docs/18-backup-restore-runbook.md` — full setup (cron install, passphrase storage, env file), the restore-drill procedure step by step, an honest RPO/RTO discussion (see below), a drill log table, and explicitly-flagged follow-ups that are NOT yet done (offsite copy, uploads-directory backup, a real production failure-alert test).
- **Scope decision (owner confirmed):** local-VPS-disk backups only, no offsite copy yet. This is a real, documented gap — a total VPS loss takes the backups down with it — tracked in the runbook's follow-ups rather than silently glossed over.

**RPO/RTO — still an open decision, not newly invented here.** The original audit ([14](14-pos-production-readiness-audit-2026-07-13.md)) and hardening plan ([15](15-pos-production-hardening-plan.md)) both left this as a placeholder, never actually confirmed with the owner. What the current daily-cron design implies: **RPO ≈ 24 hours** (worst case, a failure right before the nightly backup loses up to a day of transactions), **RTO** measured at **under 5 seconds** for the decrypt+restore step alone on a small dev database (will scale with real data volume, and doesn't include time to provision a working Postgres instance if the VPS itself is gone). The owner should explicitly confirm or tighten these before Phase 10.

### Test gate
- [x] A real restore drill: take a backup, restore it into an isolated environment, confirm the restored data is complete and correct. **Done against dev data** (row counts matched exactly for `tenants`, `admin_users`, `products`) — **still needs to be repeated once against a real production backup** by whoever has VPS access.
- [ ] Recorded actual RPO/RTO from the drill, compared against Phase 0's target — no target was ever actually set (see above); the owner needs to confirm one.
- [x] Backup failure alerting actually fires when tested. Tested the failure path itself (unreachable database → script correctly fails, cleans up, and attempts the alert) and the mailer code path in isolation (correctly attempts to send, falls back to a dev-preview log without real SMTP configured) — **still needs one real test against production SMTP** to confirm an actual email lands in an inbox, not just that the code path is wired correctly.

---

## Phase 10 — Pilot and cutover

**Gate:** does not start until Phases 1-9 are ALL green. This is the original audit's cutover criteria, unchanged:

- [ ] 10 consecutive business days running in parallel with the existing POS.
- [ ] Zero unexplained cash variance across all 10 days.
- [ ] Zero lost or duplicate sale.
- [ ] 100% offline-sync recovery (every offline sale eventually reconciled correctly).
- [ ] Successful restore drill on file (from Phase 9).
- [ ] Signed hardware acceptance for every register in use.
- [ ] Staff trained and comfortable with the cashier-role flow, refunds, and shift close.

**Only after all of the above:** decide, with the owner, whether to decommission the old POS.

---

## Phase 11 (deferred, do not start yet) — Multi-branch support

Confirmed as real future work, not started, since a second physical branch is planned. **Do not begin this until Phase 10's single-shop pilot is actually complete** — building a second data dimension (locations) on top of an unproven single-shop system compounds risk instead of reducing it.

### What it will need (for future scoping, not action now)
- `locations` table; `product_variants` stock becomes per-location, not tenant-wide.
- Registers assigned to a location; enrollment token scoped accordingly.
- Location-aware reporting (every report in Phase 5 needs a location filter).
- Transfer-between-locations workflow (stock moving from branch A to branch B).
- Decide: does each branch get its own receipt-number sequence, or shared? (Recommend per-location, to keep audit trails cleanly separable.)

### Test gate (for when this phase actually starts)
- [ ] Stock at branch A selling out does not affect branch B's displayed stock.
- [ ] A register enrolled to branch A cannot be accidentally used to fulfill/report against branch B's data.
- [ ] Reports filtered by location show only that location's real numbers, verified by hand against each branch's actual register tapes.

---

## Summary sequencing (at a glance)

```
Phase 0    "Go to POS" admin link         ✅ done, needs a manual click-through
Phase 0.5  Receipt print fixes + reprint/remote-enrollment UI  ✅ built, needs hardware verification
Phase 1  Inventory ledger              ─┐ ✅ built, needs hardware verification
Phase 2  Cashier follow-ups             │  ⛔ skipped (owner decision, 2026-07-20)
Phase 3  Cash movements + Z-history     │  ✅ built, needs hardware verification
Phase 4  Card settlement reconciliation ┘  ✅ built, needs real-data verification (independent of 1, but grouped for one hardware-test session)
Phase 5  Core reporting                    ✅ built, needs real-data verification
Phase 6  Angular upgrade (17→22)            ✅ built, needs manual click-through
Phase 7  PWA/offline hardening              ✅ built, needs hardware/kiosk verification
Phase 8  Legal sign-off                    ← depends on business-profile being final
Phase 9  Backup/DR                          ✅ built + drilled vs dev data, needs production install + real drill
Phase 10 Pilot & cutover                   ← gated on ALL of 1–9
Phase 11 Multi-branch                      ← deferred until AFTER Phase 10
```
