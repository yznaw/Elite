# 25 — POS Readiness Master Plan (path to sole-POS)

**Created:** 30 July 2026 · **Last updated:** 1 August 2026
**Supersedes as the active tracker:** [16-launch-roadmap.md](16-launch-roadmap.md) (whose phases 0–9 are built and now need verification, not building). It does **not** supersede [14](14-pos-production-readiness-audit-2026-07-13.md) (the original audit) or [15](15-pos-production-hardening-plan.md) (the P0 hardening record) — those stay as the audit trail.
**Companion:** [24-logging-observability-plan.md](24-logging-observability-plan.md) is Phase 2 of this plan, tracked in its own document because it is already in flight.

## Verdict this plan is built on

Verified by reading the code and running the suites. As of 1 August 2026:

| Gate | Command | Result |
|---|---|---|
| Server suite | `cd server && npm test` | **33/33**, three consecutive runs |
| Browser release gate | `cd client && npm run test:e2e` | **8/8** against the production build |
| Admin production build | `cd client && npm run build:admin` | green |

Started at 21 server tests on 30 July; Phases 1, 2, 3, 5 and 8 added the rest.

- **The transactional core is genuinely strong** and is the hardest part to retrofit: single-transaction sales, `FOR UPDATE` locking on variant/shift/register/receipt-block, real idempotency with a database-level unique constraint, server-side totals in integer cents, receipt-block reservation, same-shift voids, partial refunds with over-refund prevention, enforced approver separation, an inventory ledger with baselines and drift detection, cash movements folded into shift variance, and a cashier role.
- **What was not ready was the ring around that core.** Since this plan was written, that ring has largely been built: stock integrity across every channel (Phase 1), observability and diagnosability (Phase 2), a working release gate (Phase 3), one customer identity shared with the website (Phase 5), verified concurrency on the same unit (Phase 5.5), and stock adjustments plus stocktake (Phase 8, steps 1–2).
- **What remains for a pilot is mostly not code**: receipt data entry, an on-site hardware acceptance day, and two open decisions.
- **What remains for sole-POS is real feature work**: discounts, exchanges, receiving, the margin report, card settlement against a real statement, offline/PWA completion and off-host backups.

**Therefore:** suitable today for a **supervised cash + manual-card pilot in parallel** with the existing POS. Not yet suitable as the shop's only system of record.

### Launch direction decided 2026-08-01

The owner has chosen to launch the existing product scope as the dependable POS for **two shops**, without waiting for discounts, exchanges, purchasing or additional management features.

Inventory is deliberately **one shared pool** across both shops, the stock room and the website. Physical replenishment between those places is an internal operating activity: it does not change the shared quantity and is therefore not a stock movement in Elite. The team owns the accepted operational risk that Elite shows total availability, not the physical place holding a unit. Sales, refunds, damage, corrections and the combined physical count still change the shared ledger exactly as they do today.

Registers and shifts remain separate, so cash accountability and register performance remain attributable even though stock is shared. Phase 15's location-stock model and transfer workflow are therefore not launch requirements. This is not a temporary shortcut awaiting automatic conversion: it is the chosen operating model unless the owner later asks for per-location availability.

The active objective is now **production launch readiness, not feature completeness**. Phases 6–10 and the unfinished purchasing portion of Phase 8 move to the post-launch backlog. The launch blockers are receipt acceptance, offline/PWA completion, production backup and restore, hardware acceptance on every production register, and a controlled go-live gate.

---

## How to use this document

- Phases are ordered by **dependency and risk**, not by convenience. Phase 1 comes first because every report, every drift alert and every stock decision downstream is only as trustworthy as the stock ledger underneath it.
- Every phase carries: **goal → architecture decision → DB schema → integration impact → workflow → exit gate → status**.
- **Integration impact is not optional reading.** It is the section that says which existing files change, what silently breaks if the change is made naively, and which other parties (storefront, admin portal, reports, offline queue, receipt renderer) must move at the same time. The failure mode this plan is written to prevent is "the wiring exists" without the logic being right end to end.
- Tick an exit-gate box only when it is implemented **and** verified. `[x]` means a test ran or a human watched the real thing work.

### Status legend
`⬜ not started` · `🚧 in progress` · `✅ done and verified` · `⛔ deliberately skipped`

---

## Phase 0 — Decisions still open (blocking, no code)

**Status:** 🚧 five of seven closed (2026-08-01); two still open.

Decisions that block a later phase from being built correctly rather than guessed at.

| Decision | Blocks | Current state |
|---|---|---|
| Final receipt content: trade name, address, CR/licence number, return-policy text | Phase 4 | **Language decided 2026-08-01: the receipt is English**, with the product name printed in Arabic above English on each item line. Address and phone confirmed from the shop's existing receipt; CR number and return-policy wording still unconfirmed. |
| RPO / RTO targets | Phase 12 | never set; current daily cron implies RPO ≈ 24h |
| ~~Offline catalog freshness window~~ | ~~Phase 11~~ | ✅ **Decided 2026-08-01: warn at 8 hours, block offline selling at 12.** Inside the audit's 8-24h range. 12 hours covers a full trading day but forces the register to have been online at some point since yesterday, so an evening price change cannot be sold at the old price the next morning. The 8-hour warning exists so the cashier sees it coming while there is still time to reconnect, rather than discovering it mid-queue. |
| ~~Accept, in writing, the browser-only durability risk for unsynced offline sales~~ | ~~Phase 11, Phase 14~~ | ✅ **Accepted 2026-08-01: the team owns and operates this residual risk.** Persistent storage, queue diagnostics, recovery procedures and backups remain mandatory mitigations. |
| ~~Cost basis for margin reporting~~ | ~~Phase 9~~ | ✅ **Decided 2026-08-01: costs are entered by hand, by the team, in the catalogue.** No weighted-average or last-cost calculation from receiving. This removes the dependency that made Phase 9 wait for Phase 8's receiving work — the margin report can be built now. It also sets the report's obligation: it must **state its cost basis on its face** and show how many variants carry no cost, so a number is never acted on without knowing where it came from. |
| ~~Tax model~~ | ~~Phase 6~~ | ✅ **Decided 2026-08-01: no tax, permanently.** Qatar has no sales tax, so the receipt carries no tax line and Phase 6 drops its entire tax sub-feature. |

**Exit gate**
- [x] Tax model — no tax, permanently.
- [x] Offline catalog freshness window — warn at 8h, block at 12h.
- [x] Cost basis — manual entry by the team.
- [x] Receipt language — English, with bilingual product names.
- [ ] CR/licence number and return-policy wording (the latter is optional and prints nothing if left empty).
- [ ] RPO / RTO targets.
- [x] Browser-only durability risk accepted; the team owns the residual risk operationally.

---

## Phase 1 — Stock integrity across every channel 🔴

**Status:** ✅ built and tested (2026-07-30). One item deferred: the one-off reconciliation of data that predates the ledger, which is a human decision.
**Why first:** this is the single most consequential defect found. It also invalidates work already built: the drift job and the inventory report are only meaningful once every stock mutation goes through the ledger.

### Two verified defects

**1a. Online store orders never decrement stock.** Grepping every `stock_quantity` write in `server/` returns POS services and `admin-products.route.js` / `admin-bulk-import.route.js` only. `payments.route.js`, `carts.route.js`, `sadad-webhook.route.js` and `admin-orders.route.js` contain no stock logic at all. A paid web order leaves inventory untouched, so the POS keeps offering a unit that is already sold and the shop oversells.

**1b. Admin catalog stock edits bypass the ledger.** `admin-products.route.js:496`, `:523`, `:727`, `:743` and `admin-bulk-import.route.js:442-448` set `stock_quantity` directly with no `inventory_movements` row. Consequence: the hourly drift job (`server/lib/pos/inventory-consistency-job.js`) reports every legitimate manual edit as drift. An alert that fires on normal work is an alert that gets ignored — which would waste the alerting added in docs/24 Phase E.

### Architecture decision
One rule, no exceptions: **`product_variants.stock_quantity` is only ever written together with an `inventory_movements` row, in the same transaction.** The existing `recordMovement()` helper (`server/lib/pos/inventory-ledger.js`) already does exactly this and already captures the baseline on first touch, so this phase is about routing three more call-site families through it, not about new infrastructure.

Move `inventory-ledger.js` out of `server/lib/pos/` to `server/lib/inventory-ledger.js`: once the storefront and the catalog write to it, "pos" in the path is misleading about ownership.

Web-order reservation model: decrement **on payment confirmation**, not on cart add. This shop's order volume does not justify a reservation/expiry system, and the existing pending-order cleanup already handles abandoned orders. Recorded as a deliberate choice: a customer can still lose a race between adding to cart and paying, and will get an out-of-stock message rather than a silently oversold order.

### DB schema
None. `inventory_movements` (migration 001) and `pos_inventory_baselines` (migration 020) already have the needed columns. New `reason` values only: `web_order`, `web_order_cancelled`, `catalog_edit`, `bulk_import`, `manual_adjustment`.

### Integration impact
- **`server/lib/pos/inventory-ledger.js` → `server/lib/inventory-ledger.js`:** three current importers must be updated (`sale-service.js`, `correction-service.js`, and the consistency job's sibling import). Keep a thin re-export at the old path for one release only if it reduces churn.
- **Payment confirmation path is the risky edit.** `payments.route.js` and `sadad-webhook.route.js` mark an order paid; the decrement must join that **existing** transaction. If it is added as a separate query afterwards, a crash between the two produces a paid order with untouched stock, which is the exact class of bug this phase exists to remove. The webhook is also retried by the provider, so the decrement must be **idempotent per order** (guard on an existing `inventory_movements` row with `reference_type='order'` and that `reference_id`), otherwise a duplicate webhook double-decrements.
- **Insufficient stock at payment time cannot reject the payment** (the money is already taken). It records the sale, decrements to a floor of zero, and raises a reconciliation task.
  - **Correction made during implementation:** this plan originally said to reuse `pos_sync_conflicts`. That is not possible — its `transaction_id` is `NOT NULL` and foreign-keyed to `pos_transactions`, so a web order cannot be recorded there at all. Implemented instead as: the shortage on the `inventory_movements` row's metadata (for the ledger and the shrinkage report), an `order_timeline_entries` note (so whoever fulfils the order sees it, which is where the human actually looks), and an operational alert. No new table.
- **Order cancellation / refund of a web order** must post the reverse movement, or every cancellation becomes permanent phantom shrinkage. `admin-orders.route.js` is where this lands.
- **`admin-products.route.js` bulk paths** update many variants at once. Writing one ledger row per variant inside those loops is correct but must stay inside the existing transaction, and the bulk import path needs a batch guard so a 5,000-row import does not emit 5,000 individual round-trips.
- **`pos_inventory_baselines` interaction:** `recordMovement()` back-computes the baseline as `current - delta` on first touch of a variant. Once catalog edits start writing movements, the first edit after this phase ships captures the baseline correctly — but any variant whose stock was edited manually *before* this phase and *after* its baseline was captured will show pre-existing drift. That is real drift, not a false positive, and needs a one-off reconciliation pass before the alert is trusted.
- **Reports:** `reports-service.js`'s `inventoryMovements` groups by `reason`; the new reasons appear automatically in the report and its CSV, no report change needed. The `driftAlerts` block becomes meaningful for the first time.
- **Storefront:** none. It reads stock through `products.route.js`, which already projects `stock_quantity`.

### Workflow
1. Move the ledger helper, update importers, run the suite.
2. Add the idempotent decrement to the payment-confirmation transaction; add the reverse on cancel/refund.
3. Route every `admin-products` / `admin-bulk-import` stock write through the helper with `catalog_edit` / `bulk_import`.
4. One-off reconciliation: run the drift query, resolve every pre-existing discrepancy with the owner, re-baseline.
5. Only then let the drift alert be treated as actionable.

### What was actually built

`server/lib/inventory-ledger.js` (moved out of `lib/pos/`, now the single writer for every channel) and a new `server/lib/order-stock.js` with three entry points: `ensurePaidOrderStock`, `reversePaidOrderStock`, and `applyMissingPaidOrderStock`. Wired into `payments.route.js` (both the winning branch **and** the already-paid branch), `sadad-webhook.route.js`, and `admin-orders.route.js` (transition-driven: paid → apply, cancelled/refunded → reverse). Catalog writes in `admin-products.route.js` now post `catalog_edit` / `bulk_import` movements, including stock that disappears when a variant is deleted.

**Design decision that differs from the original plan — read this before changing it.** The plan said to put the decrement in the same transaction as the paid flag. That is not safely achievable in the Sadad handlers: both perform several updates whose failure is deliberately tolerated with `.catch()` (metadata, payments row, timeline, NBOX booking, receipt email). Inside one transaction a single failed statement aborts the whole transaction in Postgres, so wrapping them would turn a currently-harmless metadata failure into a **lost payment flag** — strictly worse than the problem being solved. The stock application is therefore idempotent (keyed on an existing ledger row for the order), called on every observation that the order is paid, and backstopped by `applyMissingPaidOrderStock()` so the guarantee does not depend on a webhook arriving twice.

### Exit gate
- [x] A paid web order decrements variant and parent-product stock, and posts a ledger row (`inventory-integrity-e2e.test.js`).
- [x] A duplicated payment webhook decrements exactly once.
- [x] An unpaid order is never applied.
- [x] Overselling keeps the payment, floors stock at zero, records the shortage on the movement, and flags the order timeline.
- [x] Cancelling reverses exactly what was applied (7 taken, not 12 ordered), and reversal is idempotent.
- [x] The backlog sweep repairs a paid order that missed its decrement.
- [x] Admin bulk-stock edits produce a ledger row with the correct signed delta.
- [x] Drift query returns zero rows after a mixed order/oversell/reversal/catalog-edit sequence.
- [ ] **One-off reconciliation of data that predates the ledger, completed and signed off.** Any variant edited manually before this phase shipped will show real (not false) drift until a human decides the correct value.

---

## Phase 2 — Observability, error handling, alerting

**Status:** ✅ built and tested (2026-07-30) — 3 browser-run gates remain, see [24-logging-observability-plan.md](24-logging-observability-plan.md)

Summary of why it sits this high: the register runs in a browser inside the shop. Before this phase an error on the cashier's screen left no trace anywhere, so every fault reported by phone was unreproducible. Nothing later in this plan can be operated safely without it.

Delivers: correlation id end to end, structured pino logs, a bounded `app_errors` store with grouping, client-error ingestion that survives being offline, deduplicated email alerts (stock drift, 5xx surge, stuck offline queue, repeated print failures), a truthful `/api/health`, production error-message hygiene, and a Diagnostics page that also gives `audit_events` its first UI.

**Delivered 2026-07-30:** migration `022_observability.sql`, `middleware/request-id.js`, `lib/logger.js` (pino, replacing morgan), `lib/error-log.js`, `lib/alerts.js`, `lib/diagnostics-service.js`, `lib/pos/queue-watch-job.js`, `routes/client-logs.route.js`, `routes/admin-diagnostics.route.js`, a truthful `/api/health`, client `ClientLoggerService` + `GlobalErrorHandler`, and the `/diagnostics` admin page. Server suite 29/29 green; admin production build green.

**Found and fixed while building it:** the POS, POS-security and POS-reconciliation routers each answered `PosError`s themselves and never reached the global handler — so every POS failure had no correlation id, no error record and no structured log line, on the exact surface where a cashier is standing in front of a customer. Also: pino's `*.key` redaction wildcard matches one level only, so a top-level `managerPin` was being written to disk in clear text until the paths were widened.

### Exit gate
- [ ] The 3 remaining browser-run gates in docs/24 (offline buffering, no-retry-storm, nav/role visibility).

---

## Phase 3 — Restore the automated release gate

**Status:** ✅ built and green (2026-08-01) — expanded from 3 to 8 production-build scenarios; 8/8 passing
**Why here:** every phase after this one changes checkout. Without a working browser gate, each change is verified by hand or not at all.

### The defect
`client/e2e/pos-checkout.spec.ts:22` clicks a product tile and expects it in the cart. The UI has required a variant picker (colour → size → **Add to cart**) since commit `224c72a`, so the test times out with **Take payment** disabled. The browser release gate has been red since 13 July 2026.

### Architecture decision
Repair the existing Playwright spec rather than replace it — its fixture setup (`server/scripts/prepare-pos-browser-e2e.js`) already provisions a disposable tenant, register and shift, which is the expensive part. Then widen coverage to the scenarios that actually protect money, and put it in CI.

Scenarios to add, in priority order: offline sale then reconnect then verify exactly one server transaction; a sale that fails after server commit (network dropped on the response) resolving to one transaction, not two; refund and void through the browser with a second account's PIN; print failure leaves the sale saved; session expiry mid-shift without losing the queue.

### Integration impact
- **CSRF:** the Playwright client drives a real browser, so the `csrfInterceptor` covers it. The direct-HTTP test client in `server/test/` already carries the cookie/header pair; keep both paths in mind when adding cases.
- **The variant picker is now conditional** (`138af93` hides the size step for colour-only products), so a selector written against one product shape will silently pass or fail depending on fixture data. The fixture must pin an explicit variant shape.
- **Phase 2's client logger will now capture browser errors during E2E runs**, which is useful, but the test tenant should be filtered out of alert thresholds so CI noise does not email the owner.

### What was actually built

- **Fixture widened deliberately** (`server/scripts/prepare-pos-browser-e2e.js`): two colours by two sizes, plus a second manager with a PIN. The picker is conditional — the size step is hidden for colour-only products — so a one-variant fixture would have exercised a different code path than a real product, and approver separation makes void/refund untestable without a distinct approver.
- **Spec rewritten** (`client/e2e/pos-checkout.spec.ts`), three scenarios: an online sale through the real colour-then-size picker; an offline sale that reconnects; and a network failure injected **after** the server commits. Each asserts the transaction count from the API, not the toast — "SALE COMPLETE" says nothing about how many rows were written.
- **CI created** (`.github/workflows/ci.yml`). There was no CI at all, so the gate did not exist as a mechanism, not merely as a red run. Four jobs: server tests against a real Postgres service, admin production build, the browser suite (gated behind the first two), and a production dependency audit.
- **Test tenants excluded from alerting** (`isTestTenant` in `server/lib/alerts.js`, applied in the drift and queue-watch jobs). The suite provokes offline queues and failed sales on purpose; without this a CI run emails the owner about the test doing its job. Keyed on the tenant rather than on `NODE_ENV` so the alerting code stays testable and a staging box with `ALERT_EMAIL` set is still protected.

### Five defects the gate found on its first real run

Each was invisible for as long as the suite was red, and none would have been caught by the server tests:

1. **The setup screen opens on the "I have a token" tab.** The old spec filled the terminal-name field without switching tabs. The field is under the other tab, so the fill silently did nothing, enrolment never ran, and the failure surfaced much later as a missing product tile.
2. **Those tabs are `role="tab"`, not `role="button"`.** A button-role selector matched nothing and, combined with a conditional step, skipped enrolment without a word.
3. **`isVisible()` does not wait.** The POS opens in a loading phase while it checks for a register, so every "if visible" branch evaluated against a screen that had not rendered. Both conditional steps were replaced with unconditional ones — each test starts from a clean browser context, so enrolment and shift-open are always required.
4. **`hasText` matches concatenated text.** A size tile reads `MIn stockQAR 25.00` with no separators, so `/^M\b/` could never match. Matching the accessible name (`M In stock QAR 25.00`) is both readable and stable.
5. **A duplicate register name produced an unactionable error.** `pos_registers` has `UNIQUE (tenant_id, display_name)`, and the collision surfaced at enrolment as a bare `409 — Conflict` that told the operator nothing. **Fixed in the product, not the test:** `createEnrollmentToken` now checks the name up front and returns `REGISTER_NAME_TAKEN` naming the conflict and what to do about it, while the name is still on screen.

### Exit gate
- [x] Repaired and expanded spec passes: **8/8 green against the production build** (`cd client && npm run test:e2e`).
- [x] An online sale completes through the real colour-then-size picker, twice with different variants.
- [x] Offline sale then reconnect asserts exactly one server-side transaction (three rung up, three written).
- [x] A network failure injected **after** the server commits still reconciles to one transaction, not two.
- [x] Walk-in is reachable with zero taps, and a customer created at the till links to the sale.
- [x] No unexpected HTTP failures during a full run (only the expected `401 /auth/me` and `428` register probes).
- [x] CI workflow exists and blocks a merge on a red server, build, or browser job.
- [x] A test tenant cannot trigger an operational alert email.
- [ ] CI has not been executed on a real runner — the workflow is new and this repository has never run one.

---

## Phase 4 — Receipt compliance and customer copy

**Status:** ⬜ not started (technical pipeline built; content, legal sign-off and two gaps outstanding)

### What is already true
The renderer is canvas-rasterised (the only approach that can shape Arabic correctly), prints through QZ Tray with signing working end to end on the real Bixolon SRP-QE300, uses `Asia/Qatar` local time, and reads a `pos_business_profile` row that has an admin editing screen.

### What is missing
1. **`pos_business_profile` is empty**, so the printed receipt is English-only with no address, CR number or return policy. Until it is filled, the receipt does not meet the MOCI Arabic-invoice requirement identified in docs/14 §P0-4.
2. **The 510px width fix has never been re-printed.** The last physical receipt was cut off on the right; the fix (576 → 510px, correcting a 203dpi assumption to the real 180dpi/72mm printable width) is committed but unverified on paper.
3. ~~**A void produces no printed receipt.**~~ ✅ Implemented 2026-08-01: the original immutable sale snapshot is rendered through the same receipt renderer with a `VOID` heading, void time, reason and amount. It keeps the original receipt number and lookup QR, opens the drawer only for a cash void, and treats print failure as post-commit (`Sale voided, receipt not printed`) with a `PRINT_FAILED` diagnostic.
4. **No customer copy by email or WhatsApp.** The plumbing exists — `sale-service.js` calls `sendReceiptForPaidOrder` after commit — but `order-receipt.js:24` returns `customer_email_missing` on **every POS sale**, because checkout always sends `customerId: null`. The feature is wired and permanently inert. It only becomes real after Phase 5.

### Architecture decision
Keep one renderer as the single source of truth for all three outputs (thermal, PDF/image, email). A second layout for email would drift from the printed one within a release, and the printed one is the legal document.

### Integration impact
- **Void receipt** reuses the sale/refund renderer with a `VOID` header; there is no third layout. It is a cancellation copy of the original receipt, not a new financial document, so it retains the original receipt number and QR rather than consuming a new sequence number.
- **Business-profile caching:** `pos-hardware.service.ts` caches the profile for 5 minutes and falls back gracefully offline. Filling the profile therefore takes up to 5 minutes to appear on a register, and a register that has never been online since the profile was set prints the fallback. Worth stating in the operator runbook so an empty test print is not misdiagnosed as a bug.
- **Email/PDF receipt** depends on Phase 5 for an address, and on consent rules. It must not be sent to a customer record that was created at the till without explicit consent.
- **Legal sign-off is a gate, not a task.** It cannot start before the content decision in Phase 0.

### Exit gate
- [ ] Real business content entered; a printed receipt shows correct Arabic and English trade name, address, phone, CR number, return policy.
- [ ] Five consecutive prints with no clipping on any edge and an intact QR.
- [ ] Printed QR scans with a phone camera and with the shop's scanner.
- [ ] A void prints a customer-facing void receipt. **Implemented and Angular-compiled; one physical cash void and one card void still need printer verification.**
- [ ] Written legal/accounting sign-off on the layout, filed.

---

## Phase 4.5 — Receipt language decision ✅

**Status:** ✅ decided and implemented (2026-08-01).

**The decision.** The receipt is **English**: headers, labels, totals, footer. The one bilingual element is the item line, where the product's Arabic name prints above its English name so a customer reading either language recognises what they bought. Tax is gone entirely (Qatar has no sales tax).

**Correcting this plan's earlier claim.** Phases above originally treated an Arabic receipt as a hard MOCI compliance requirement, inherited from docs/14 §P0-4. Checked again: Qatari commercial practice allows a consumer receipt in English **or** Arabic; the Arabic-mandatory rule attaches to *tax invoices*, and Qatar levies no sales tax, so there is no tax invoice to issue. The owner's decision is therefore consistent with the rule, not an exception to it. This remains a technical reading — the CR number and return-policy wording still want the accountant's confirmation, and that is what the Phase 4 sign-off is for.

**Where Arabic does belong.** Not on the receipt, but in the interface: the admin portal and POS already carry a full Arabic string table (`i18n/strings.ts`, `AR` typed as `Record<keyof typeof EN, string>` so an untranslated key fails the build). That is the surface where Arabic reduces training time and input errors for staff, which is the actual argument for POS localisation in the Gulf.

**Implementation:** migration `024_pos_item_arabic_name.sql` adds `pos_transaction_items.product_name_ar`, snapshotted at sale time from `product_translations` — never joined at print time, so reprinting a year-old receipt shows what was sold, not what the catalogue says today. The catalogue projection carries `nameAr` too, so an offline sale still prints the bilingual line from its cached copy.

---

## Phase 5 — Customer at checkout 🔴

**Status:** ✅ built and tested (2026-07-31)
**Blocks:** email/WhatsApp receipts, loyalty, customer-linked returns, any customer reporting from POS sales.

### The defect
`pos.component.ts:556` sends `customerId: null` unconditionally. The backend has accepted an optional `customerId` since the first POS release, `GET /api/pos/customers/search` exists, and `sale-service.js` already links the order, sets `customer_email`/`customer_name`/`customer_phone` and updates LTV when one is supplied. **Only the UI is missing.** This is the cheapest high-value gap in the whole plan.

### Architecture decision
Phone-number-first lookup at the payment step, with three outcomes: match → link; no match → optional quick-create (name + phone, consent checkbox); skip → walk-in, exactly as today. Walk-in must stay the zero-friction default: a queue at the till must never wait on data entry.

### DB schema
None. `customers` and the order columns already exist.

### Integration impact
- **Offline:** a customer linked while offline is sent as a `customerId` in the queued payload and validated at sync. A customer *created* offline cannot get a server id, so quick-create must be **online-only**, with the offline path degrading to walk-in. Anything else invents a client-side identity that later has to be merged — the exact class of problem the receipt-number design was built to avoid.
- **Sync validation:** `sale-service.js` resolves the customer inside the transaction; a customer deleted between the offline sale and its sync must not reject a completed financial sale. It must fall back to walk-in and record a conflict, consistent with the existing stale-price/stock policy.
- **LTV and refunds:** `correction-service.js` already reverses LTV on refund/void. Linking customers means that code path starts doing real work for POS sales for the first time — it needs a test, not just an assumption.
- **Reports:** no report currently groups by customer. Adding the link makes that possible later (Phase 9) but changes no existing report.
- **Consent:** capturing a phone number at a till is personal data. Quick-create must record consent, and the receipt-delivery feature in Phase 4 must respect it.
- **Cashier role:** `POS_ROLES` already includes `cashier`, and customer search is inside the POS router, so a cashier can already reach it. Confirm that is intended (it is: linking a customer is core cashier work) and that a cashier still cannot list or export the customer database.

### What was actually built

`server/lib/customer-identity.js` is now the single matcher for both channels, migration `023_pos_customer_link.sql` makes `customers.email` optional and adds a generated `phone_key`, `POST /api/pos/customers` quick-creates or links at the till, `GET /pos/customers/search` matches phone, name **or** email, and the POS payment sheet carries a customer block that keeps walk-in as the zero-tap default. `loadSale` now projects the linked customer, so the sale result and receipt can show it.

**Correction to this plan's original design.** The plan assumed a customer could simply be created at the till. `customers.email` was `NOT NULL`, so a walk-in with only a phone number could not be recorded at all without inventing a fake address — which would then become a real recipient for receipt email. Email is now nullable.

**The linkage problem the plan under-stated.** The storefront matched on email, the POS on phone, so the same person buying in both places became two rows with split history and split LTV. Both channels now go through one matcher: email wins, phone is adopted, and a phone-only till customer has its email filled in on the **existing** row the first time that person orders online.

### Exit gate
- [x] A cashier links an existing customer; the sale reaches that customer's order history and lifetime value.
- [x] Quick-create at the till produces a linked sale; entering a phone already known to the website links to that person instead of duplicating them.
- [x] Walk-in remains the default and costs zero taps.
- [x] Quick-create is unavailable offline and the flow degrades to walk-in without blocking the sale.
- [x] A refund of a customer-linked sale reverses LTV back to zero.
- [x] An offline sale whose customer was deleted before sync falls back to walk-in instead of rejecting a tendered sale.
- [ ] Consent wording for capturing a phone at the till, reviewed by the owner. Deferred: it is copy, not code.

---

## Phase 5.5 — Concurrency on the same unit ✅

**Status:** ✅ verified and hardened (2026-07-31), during Phase 5.

Not a planned phase. It was checked because Phase 1 introduced a **second** writer of stock (the web order path) alongside the POS, and two individually-correct decrement paths are not automatically correct against each other.

### What was verified, with real concurrent transactions against a real database
- Two till sales going for the same last unit: exactly one succeeds, stock never goes negative (`customer-link-and-race-e2e.test.js`, with the winning transaction deliberately held open so the loser is guaranteed to be waiting on the lock rather than passing by timing luck).
- A web-order payment racing a till sale on the same variant: stock never goes negative, and either the till is refused or the web order records a shortage. Both silently succeeding is asserted impossible.

### Two real defects found and fixed
1. **Non-deterministic lock order.** `sale-service.js` locked variants with `WHERE pv.id = ANY($2) FOR UPDATE OF pv` and no `ORDER BY`, so two concurrent multi-line sales could take the same rows in opposite orders and deadlock. This was pre-existing and latent; adding a second writer made it reachable. All three stock-locking paths (`sale-service`, `correction-service`, `order-stock`) now sort by variant id, so every writer in the system queues in one sequence. Reproduced as a real `40P01 deadlock detected` in the suite before the fix, gone after it.
2. **A background sweep that could fight a live sale.** `applyMissingPaidOrderStock()` selected candidate orders across **all** tenants and then locked them. It is now tenant-scopable and uses `FOR UPDATE ... SKIP LOCKED`, so a repair pass steps over an order a webhook is currently handling instead of queueing behind it.

### Residual, and deliberate
Two customers can still both pay for the last unit seconds apart: the storefront checks stock before payment (a 409 with the shortfall, added in this phase) but stock is only decremented at payment confirmation. Closing that fully needs a reservation/expiry model, which this shop's volume does not justify. The case is handled where the money already moved: the sale is kept, stock floors at zero, the order timeline is flagged, and an alert fires.

---

## Phase 6 — Discounts, tax model, split tender 🟠

**Status:** ⬜ not started

### The gap
`sale-service.js:443` inserts orders with `tax_cents` and `discount_cents` hard-coded to `0`, and `validatePayment` (`:658`) requires exactly one payment method whose amount equals the total. So: no line or basket discount, no tax, and a customer who wants to pay 200 in cash and the rest by card cannot be served.

### Architecture decision
Three separate sub-features, shipped in this order, because each one raises the risk of the next:
1. **Discounts** — line and basket, reason code required, manager override above a configurable threshold, and the original list price preserved immutably on the line. Discount is stored as an amount in cents (percentages are a UI convenience only), so a receipt can never disagree with the ledger by a rounding cent.
2. ~~**Tax**~~ — ⛔ **cut entirely (owner decision, 2026-08-01).** Qatar has no sales tax, so there is no rate to configure and no effective-dating to model. The `tax_cents` columns stay in the schema at zero (dropping them would be a destructive migration for no benefit) but no user-facing surface mentions tax, and the `tax_rates` table below is **not** to be built.
3. **Split tender** — cash + card in one sale. Deliberately last: it changes `validatePayment`, the `payments` row model, refund allocation across tenders, and the drawer-pulse decision, all at once.

### DB schema
```sql
-- discounts (new migration)
ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS list_price_cents bigint;
ALTER TABLE pos_transaction_items ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE pos_transactions      ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE pos_transactions      ADD COLUMN IF NOT EXISTS discount_reason text;
ALTER TABLE pos_transactions      ADD COLUMN IF NOT EXISTS discount_manager_id uuid REFERENCES admin_users(id);

-- (the tax_rates table originally planned here was cut — see above)

-- split tender: payments already model one row per sale, so a second
-- tender needs its own row keyed to the same order
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tender_sequence integer NOT NULL DEFAULT 1;
```

### Integration impact
- **`order_items` already has `tax_rate` and `tax_amount_cents`** (used by `sale-service.js:536`); the tax work must populate those rather than adding parallel columns, or the storefront and POS will disagree.
- **Receipt renderer** must show list price, discount and tax lines. Any receipt printed before this phase must keep rendering correctly from its stored data — the renderer reads `receiptData` returned by the server, so old transactions must not start rendering a `0.00` discount line that was never there.
- **Refunds are where split tender actually hurts.** `correction-service.js` computes refundable amounts per transaction and creates `payment_refunds`. With two tenders, a partial refund has to decide which tender it comes back to, and over-refund prevention must hold per tender. This is the single riskiest change in the phase and needs property-based tests, not examples.
- **Offline:** discounts are computed client-side and must survive sync. Since Chunk 1.4 made the **server price authoritative** on sync, a discount has to be transmitted as an explicit amount rather than recomputed from a stale catalog price, otherwise an offline discounted sale silently changes total at sync — the one thing the offline policy forbids.
- **Reports:** `dailySales` sums `total_cents` and would need a discount column to stay explicable; the refund/void exception dashboard should gain discounts, since discount abuse is a standard shrinkage vector.
- **Manager override:** reuse `pos_manager_overrides` with a `discount` action rather than adding a second approval mechanism. `manager-service.js`'s `ACTIONS` set already anticipates this pattern.

### Exit gate
- [ ] Line and basket discounts require a reason, and above the threshold a manager PIN, with the approver recorded and audited.
- [ ] Original list price is preserved immutably on the transaction item (test).
- [ ] Split tender totals reconcile, and a partial refund across two tenders cannot over-refund either (property test).
- [ ] An offline discounted sale syncs at exactly the printed total (test).
- [ ] Receipts printed before the phase still render identically.

---

## Phase 7 — Exchanges and store credit 🟠

**Status:** ⬜ not started

### The gap
No exchange, no store credit, no gift cards (grep: zero occurrences). In a clothing shop an exchange is daily work; today staff must run a refund and a separate unlinked sale, so the pair is invisible to reporting and to the customer's history.

### Architecture decision
An exchange is **not** a new financial primitive. It is a linked return plus a replacement sale, plus at most one balancing movement (customer pays the difference, or receives it back). Modelling it as one atomic operation that references both sides keeps all existing refund and sale guarantees intact instead of writing a third money path.

Store credit is a **liability ledger**, not a number on a customer row: issue, redeem, expire and adjust are all append-only rows with a computed balance. Anything less produces a balance nobody can explain, and store credit is the classic internal-fraud target.

### DB schema
```sql
CREATE TABLE IF NOT EXISTS pos_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  refund_id uuid NOT NULL REFERENCES pos_refunds(id) ON DELETE RESTRICT,
  replacement_transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  difference_cents bigint NOT NULL,
  settlement text NOT NULL CHECK (settlement IN ('customer_paid','customer_refunded','store_credit','even')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS store_credit_ledger (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  delta_cents bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('issued_refund','issued_goodwill','redeemed','expired','adjustment')),
  reference_type text,
  reference_id uuid,
  manager_id uuid REFERENCES admin_users(id),
  idempotency_key text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
```

### Integration impact
- **Requires Phase 5.** Store credit without an identified customer is a bearer instrument, which needs a token, anti-fraud controls and a legal policy — deliberately out of scope. Store credit here is customer-attached only.
- **Both sides must be one transaction.** A refund that commits without its replacement sale, or vice versa, produces exactly the kind of half-state the POS core was designed to prevent. `correction-service.js` and `sale-service.js` each own their own `inTransaction()` boundary today; the exchange service must compose them inside **one** boundary, which means refactoring both to accept an existing client. That refactor touches the most sensitive code in the system and needs its own review pass.
- **Stock:** the returned item restocks (with a disposition decision — sellable vs damaged) and the replacement decrements. Both post ledger rows via Phase 1's helper.
- **Receipt:** one exchange receipt showing both sides and the balance, not two disconnected slips.
- **Reports:** an exchange must not inflate both gross sales and refunds as if they were unrelated events; `dailySales` and the refund/void dashboard need to recognise the link or the day's numbers overstate both.
- **Redemption is a tender**, so it interacts with Phase 6's split-tender work. Sequencing Phase 6 first is deliberate.

### Exit gate
- [ ] An exchange creates a linked refund + sale in one transaction; killing the process mid-way leaves neither (test).
- [ ] Even-money, customer-pays and customer-refunded settlements all reconcile.
- [ ] Store credit balance always equals the sum of its ledger rows (property test).
- [ ] Store credit cannot be redeemed twice with the same idempotency key, or beyond its balance (test).
- [ ] Returned stock disposition (sellable / damaged) is recorded and respected.
- [ ] Daily sales and refund reports do not double-count an exchange.

---

## Phase 8 — Inventory operations 🟠

**Status:** 🚧 steps 1–2 built and tested (2026-08-01); suppliers, purchase orders, receiving and the reorder report are still open.

### The gap
Stock can be sold, voided and refunded; it cannot be **managed**. No suppliers, purchase orders, receiving, stocktake, or reason-coded manual adjustment. Practically: the only way to correct a wrong stock number today is a direct catalog edit, which is precisely what Phase 1 turns into a logged event and what a stocktake should replace.

### Architecture decision
Ship in dependency order, and ship the smallest useful thing first:
1. **Manual adjustment with reason + manager approval** — this is what makes Phase 1's drift resolvable *legitimately* instead of by editing a number. Smallest change, largest immediate benefit.
2. **Stocktake / cycle count** — blind count, recount on variance, manager approval, then an immutable posting that writes ledger rows. Blind counting (counter cannot see the expected figure) is the control that makes the count worth doing.
3. **Suppliers and purchase orders**, then **receiving** with over/short/damaged quantities and cost capture. **Lower priority as of 2026-08-01:** the cost-capture argument for receiving is gone (costs are entered by hand), and it is not yet known whether this shop restocks through formal purchase orders at all. Building that machinery before knowing the real restocking workflow risks shipping something nobody uses. Ask first.
4. **Low-stock and reorder report** — trivial once the above exists, and the thing the owner will actually use weekly.

### DB schema
```sql
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, contact_name text, phone text, email text, notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  public_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partially_received','received','cancelled')),
  expected_at date, notes text,
  created_by_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, public_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_damaged integer NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  unit_cost_cents bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','review','posted','cancelled')),
  blind boolean NOT NULL DEFAULT true,
  started_by_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);

CREATE TABLE IF NOT EXISTS stocktake_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  expected_quantity integer NOT NULL,
  counted_quantity integer,
  recount_quantity integer,
  UNIQUE (stocktake_id, variant_id)
);

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS reorder_point integer;
```

### Integration impact
- **Everything here writes through Phase 1's ledger helper.** A stocktake posting that sets `stock_quantity` directly would reintroduce the exact defect Phase 1 fixes.
- **A stocktake races live selling.** Counting takes time; sales continue. `expected_quantity` must be snapshotted at count time and the posted delta computed against **current** stock, not against the snapshot, or every sale made during the count is silently reversed. This is the subtle bug that makes naive stocktake implementations destroy inventory.
- **Cost capture on receiving** touches `cost_price_cents` (migration 006), which is what makes Phase 9's margin report possible. Decide explicitly: last cost, or weighted average. Recommendation: weighted average, recorded on receipt, because last-cost margins swing wildly on a single unusual purchase.
- **Damaged / return-to-vendor disposition** connects to Phase 7's return disposition; use one shared vocabulary of reasons rather than two.
- **Admin portal:** three or four new pages. Follow the existing page conventions (`app.routes.ts` with `roleGuard`, sidebar **and** bottom-nav entries, EN + AR strings) — missing the bottom-nav is how a page becomes unreachable on the register's touch screen.
- **Barcode labels** already exist (`label-printer.service.ts`) and should be reachable from receiving, so newly received stock can be labelled in the same flow.

### What was actually built (steps 1–2)

Migration `025_inventory_operations.sql` (`stocktakes`, `stocktake_lines`), `server/lib/inventory-ops-service.js`, `server/routes/admin-inventory.route.js`, and a `/stocktake` admin page (owner/admin, in both nav surfaces, EN + AR).

Manual adjustments need **no table of their own** — an adjustment is one signed movement, and `inventory_movements` already records delta, reason, actor and metadata. A parallel `stock_adjustments` table would create a second place where stock history lives, which is the problem Phase 1 spent its effort removing.

**Deviation from this plan, deliberate: no manager-approval token on adjustments.** The plan called for one. This runs in the admin portal, where the actor is already an owner or admin — the highest privilege in the system — so asking that person to approve their own action with a second credential from the same pool is theatre, not separation of duties. The real controls are: the reason comes from a closed list (so the shrinkage report can group on it, rather than "damaged"/"Damaged"/"broken" being three categories), the actor is recorded, it writes `audit_events`, and it appears in the shrinkage report under its reason. The POS manager-override system is register-bound and does not apply outside a till session.

**The arithmetic that carries the risk.** A count takes time and the shop keeps selling. Writing the counted number back as an absolute would undo every sale made in between — the classic way a naive stocktake destroys inventory. What is applied is the *discrepancy*: `counted − expected_at_count_time`, added to **current** stock. Shelf held 10, system expected 12, 3 sold during the count → discrepancy −2, current 9, new 7. The two missing units are written off; the three sales survive. The movement records `soldDuringCount` so a later reader can see why the applied delta is not simply counted-minus-expected.

**Found while testing:** the drift job caught an unledgered write in the test itself (it simulated a sale with a bare `UPDATE product_variants`). The invariant is doing its job on the people writing tests, not only on the application.

**Also fixed here (pre-existing, surfaced by the new tests):** the suite failed differently on every run — deadlocks and `25P02 current transaction is aborted`. Cause: every test file boots a server that applies DDL while other files are running queries, and `CREATE TABLE IF NOT EXISTS` is not safe against itself running concurrently. An advisory lock now covers the whole bootstrap in `prepareDatabase` (an earlier attempt guarding only `ensurePosSchema` made it worse — that process held the advisory lock while waiting on a table lock held by a process waiting for the advisory lock), and the suite runs with `--test-concurrency=1`. **33/33 three runs in a row.**

### Exit gate
- [x] Manual adjustment requires a reason from a closed list, records the actor, writes a ledger row and an audit event (test).
- [x] A write-off reason cannot be used to invent stock, and no adjustment can drive stock below zero (test).
- [x] A stocktake posted while sales happen mid-count produces the arithmetically correct result — sales survive, the discrepancy is written off (test).
- [x] Blind count hides expected quantities from the counter (test).
- [x] A recount that disagrees with the first count blocks posting until it is explicitly accepted (test).
- [x] A posted stocktake is immutable, and only one stocktake may be open at a time (test).
- [x] The ledger invariant holds after a mixed adjustment/stocktake/sale sequence — zero drift (test).
- [ ] Suppliers, purchase orders and receiving (steps 3–4) — not started.
- [ ] Low-stock/reorder report matches hand-checked data for one real category — not started.

---

## Phase 9 — Reporting completeness

**Status:** ⬜ post-launch backlog. It is no longer gated on Phase 8's receiving work, but it no longer sits on the critical launch path either.

### The gap
`server/lib/pos/reports-service.js` ships six correct reports (daily sales, cash movements, card exceptions, inventory movement + drift, refund/void exceptions, Z-report history), all with the correct `Asia/Qatar` business-day handling. Missing:

1. **Profit and margin** — `cost_price_cents` has existed since migration 006 and no report uses it. For a shop owner this is the single most wanted report and it is absent.
2. Stock valuation, sell-through, aged/slow-moving stock.
3. Customer reporting from POS sales (needs Phase 5), discount reporting (needs Phase 6).
4. **X-report print** — the shift summary exists on screen; only the Z report prints.

### Integration impact
- **Cost basis is settled: manual entry by the team** (owner decision, 2026-08-01). There is therefore no weighted-average calculation to build and no wait for receiving. What this does *not* remove is the obligation to be honest about provenance: the report states on its face that costs are hand-entered, and shows the count of variants with no cost at all — prominently, not tucked away. A margin report that silently ignores half the catalogue is more dangerous than no report, because the number still looks authoritative.
- Follow the established pattern exactly: read-only queries over the ledgers, no aggregate tables, sequential `await`s on one client (never `Promise.all` on a shared `pg` client — that bug was already found and fixed once in this file), business dates via the double-UTC conversion, CSV with a BOM so Arabic opens correctly in Excel.
- These add tabs to the existing `/reports` page; no new route or nav entry needed.

### Exit gate
- [ ] Margin report ties to hand-calculated margin for one real day, with its cost basis stated.
- [ ] Valuation, sell-through and aged-stock reports reviewed by the owner against reality.
- [ ] X report prints on the real printer.
- [ ] Every new report exports CSV that opens cleanly with Arabic intact.

---

## Phase 10 — Card settlement completion

**Status:** ⬜ not started (entry + matching + exception flow built; never run against a real statement)

### State
The terminal is standalone with no data link, confirmed with the shop. `terminal_reference` is mandatory on card sales, enforced both client and server side, and covered by tests. `pos_card_reconciliation` supports per-register/business-day matching within a QAR 1.00 tolerance, and resolving an exception requires a manager note (enforced server-side).

Missing: CSV bulk import (only single-day manual entry was built), and **one real reconciliation cycle against an actual bank statement** — the entire feature has never met real data.

### Integration impact
- Confirm the bank's actual export format before building an importer; building against a guessed format is how import features get written twice.
- Business-date bucketing must use the same double-UTC-conversion pattern already used here and in reports, or a transaction near local midnight lands on the wrong day and manufactures an exception.
- Split tender (Phase 6) changes what "the POS card total" means for a day. If Phase 6 lands first, the reconciliation query must sum card **tenders**, not card **sales**.

### Exit gate
- [ ] One real business day reconciled against a real bank statement, matching a hand calculation.
- [ ] CSV import (if the bank provides one) handles a real file, including a duplicate re-import.
- [ ] An exception cannot be resolved without a note, and POS totals are never auto-adjusted to the bank figure.

---

## Phase 11 — Offline and PWA completion

**Status:** 🚧 in progress (catalog freshness, POS-scoped production precache, safe update gate and till-first manifest built 2026-08-01; physical/cold browser verification remains)

### What is built
`manifest.webmanifest` linked from `index.html`; the service worker registers app-wide from `main.ts`; health-check polling with 15–30s jitter independent of the browser's `online` event; IndexedDB v4 with an append-only `pos-queue-journal`; synced sales retained for a 7-day local audit window; `navigator.storage.persist()` requested; quota polled; a status strip showing pending count, oldest-pending age, last sync and server reachability.

### What is missing, and why each matters
1. ~~**No precache.**~~ ✅ Production builds now identify the hashed POS route chunk by stable UI content, follow only its static dependencies, and inject that exact list into `pos-sw.js`. The first generated audit contained 14 files, including the POS chunk and its four dependencies, rather than all admin lazy routes. `build:admin` fails if it cannot identify the POS chunk or inject the worker, so a release cannot silently ship without the offline package.
2. **Cold-offline launch has never been tested** — installed, browser fully closed, no network, reopen.
3. ~~**`start_url` is `/dashboard`.**~~ ✅ The installed app now starts at `/pos` and is named Elite POS (2026-08-01). Maskable icons remain open.
4. ~~**No catalog freshness limit.**~~ ✅ Implemented 2026-08-01: warn at 8 hours and block offline payment at 12 hours. The guard is checked when payment opens, again when it completes, and again if an apparently-online request fails and falls back to the offline queue.
5. **Browser-only durability** remains the accepted residual risk; it must be signed, not assumed.

### Integration impact
- **Service-worker replacement built 2026-08-01.** Registration stays app-wide from `main.ts`, while the navigate fallback remains `/pos`-only. A new worker installs and precaches but deliberately does not call `skipWaiting`; the POS permits activation only after IndexedDB has been read and the cart, payment, sync, pending queue and rejected queue are all empty. A controller change then reloads once onto the new build.
- The installed app is now explicitly Elite POS and starts at `/pos`. It retains app-wide scope because the same deployed admin shell owns authentication and shared services; physical install verification remains in Phase 13.
- **Bundle size is a hardware constraint, not a preference:** Celeron J1900, ~786 MB free RAM. A precache manifest that eagerly caches the whole admin portal will hurt this register. Scope the precache to the POS route's chunks.
- **IndexedDB v4 → v5** may be needed for a freshness policy field; upgrades must stay additive and non-destructive, as v3 → v4 was.
- Phase 2's client logger will finally make offline failures visible after the fact, which is what makes testing this phase meaningful rather than anecdotal.

### Exit gate
- [ ] Cold offline launch works after a full browser restart with no network.
- [ ] Every POS screen and dialog opens offline on a profile that never visited them online. **Production precache built and audited; clean-browser execution remains.**
- [ ] A service-worker update does not activate while a cart is open or sales are pending. **Gate implemented and Angular-compiled; browser execution remains.**
- [ ] Offline sale during a real cable-pull, then sync, produces exactly one transaction with no receipt-number gap.
- [ ] Catalog older than 12 hours blocks offline selling with a clear message; 8–12 hours warns the cashier. **Implemented and Angular-compiled 2026-08-01; the browser case is written but still needs a clean E2E run before this gate is checked.**
- [x] Installed app manifest opens the till, not the dashboard (build/manifest verification; physical installed-app check remains part of Phase 13).
- [ ] Browser-only durability risk signed off in writing.

---

## Phase 12 — Backup, restore, disaster recovery

**Status:** ⬜ not started (scripts written and drilled against dev data only)

### State
`scripts/backup-database.sh` (pg_dump + uploads → one GPG AES256 bundle → retention prune → email on failure, refuses a suspiciously small dump) and `scripts/restore-database.sh` (verifies the uploads manifest and refuses to target the production database name unless explicitly overridden) both exist. The older database-only format was drilled end to end against a local dev database; the new combined bundle still needs the production drill. `docs/18-backup-restore-runbook.md` documents setup and the drill.

### What is missing
- Not installed or run on the production VPS.
- **Local VPS disk only, no offsite copy** — a total VPS loss takes the backups with it. Documented, owner-accepted, still a real single point of failure.
- ~~Uploads directory was not backed up.~~ The scripts now include and verify it in the encrypted bundle; production installation and a real restore remain.
- RPO/RTO never agreed (Phase 0).
- Failure alerting verified only in code, never against production SMTP.

### Integration impact
- Phase 2 adds `app_errors`, and Phases 6–8 add several tables. A restore drill run before those exist proves less than one run after; re-drill at the end, not only now.
- The GPG passphrase becomes a critical secret. If it is lost, every backup is unusable — its storage location must be part of the sign-off, not an implementation detail.
- Offsite copy should reuse the existing alerting so a failed upload is loud.

### Exit gate
- [ ] Cron installed on the VPS; a real production backup exists.
- [ ] A production backup restored into a disposable database with row counts verified.
- [ ] Measured RPO/RTO recorded against the Phase 0 target.
- [ ] Offsite copy configured, or the residual risk re-signed with the uploads gap named.
- [ ] Uploads directory included in the production backup set. **Combined bundle implemented; real local pg_dump/encrypt/decrypt/upload-restore smoke passed 2026-08-01. Production run and full disposable-database restore still required.**
- [ ] One real failure alert email received in an inbox.

---

## Phase 13 — Hardware acceptance and kiosk hardening

**Status:** ⬜ not started

Software cannot certify hardware. Every item in `docs/pos-hardware-runbook.md` must be executed on the exact production combination: POSIFLEX KS-7412, Windows 10 Enterprise 2016 LTSB, the installed browser version, Bixolon SRP-QE300 firmware, the drawer, the Symbol scanner, the QZ Tray version, and the offline device signer.

Beyond the runbook:
- Screen set to native 1024×768 with browser zoom at 100%, then a decision on whether POS-specific touch-target CSS is still needed for a 12" resistive panel. Left open in docs/15 Phase 0.
- Windows kiosk hardening: dedicated non-admin account, browser policy, no extensions or devtools for staff, automatic security updates, disk encryption, USB policy, remote-support controls.
- Paper-out, cover-open, spooler stopped, QZ stopped, signer stopped, USB reconnect, power loss during local commit / printing / sync.
- QZ signing certificate expiry recorded with a renewal reminder — a silent expiry stops all printing.

### Exit gate
- [ ] Full hardware runbook executed and signed by operations.
- [ ] Drawer pulses on cash and does not on card.
- [ ] Scanner suffix and keyboard layout verified, including rapid repeated scans.
- [ ] Power-loss recovery verified in all three states.
- [ ] Kiosk hardening checklist complete.
- [ ] Certificate expiry date recorded with an owner-visible reminder.

---

## Phase 14 — Production launch and cutover (gate, not a feature phase)

**Status:** ⬜ not started. Feature completeness is not the gate. Start only after the launch-path items in Phases 4, 11, 12 and 13 are green.

- [ ] Staff trained on the shipped cashier flow, refunds, cash movements, offline status and shift close.
- [ ] Documented manual fallback procedure for a full outage.
- [ ] A controlled go-live rehearsal is completed on each production register before it accepts customers.
- [ ] Daily cash, card and shared-stock checks are assigned to named operators for launch week.
- [ ] Zero lost or duplicated sale.
- [ ] 100% offline-sync recovery.
- [ ] Restore drill on file (Phase 12).
- [ ] Signed hardware acceptance (Phase 13).
- [ ] Rollback plan documented and rehearsed.

**Only then:** decide with the owner whether to decommission the old POS.

---

## Phase 15 — Per-location stock (deliberately skipped)

**Status:** ⛔ deliberately skipped for the chosen operating model (2026-08-01).

The two shops, stock room and website use one shared inventory pool. Moving a unit between physical places does not change that total and is intentionally not recorded as a sale, adjustment or transfer. The team handles the accepted limitation that the system answers “is this available anywhere?” rather than “which place currently holds it?”.

If the business later needs branch-level availability, reserve-online-pickup by shop, or location stock valuation, that is a new scope decision. Only then add locations, per-location quantities and transfers. Registers and shifts are already separate for cash accountability and do not require splitting inventory.

---

## Sequencing at a glance

```
Phase 0   Open decisions                  🚧  5 of 7 closed; 2 open
Phase 1   Stock integrity (all channels)  ✅  built + tested 2026-07-30
Phase 2   Observability                   ✅  built + tested (docs/24)
Phase 3   Release gate (E2E + CI)         ✅  green 8/8, 2026-08-01
Phase 4   Receipt compliance              ⬜  needs data entry + one real print; on the pilot path
Phase 4.5 Receipt language (English)      ✅  decided + built 2026-08-01
Phase 5   Customer at checkout            ✅  built + tested 2026-07-31
Phase 5.5 Concurrency on the same unit    ✅  verified + hardened 2026-07-31
Phase 6   Discounts / split tender        ⬜  post-launch backlog
Phase 7   Exchanges / store credit        ⬜  post-launch backlog
Phase 8   Inventory operations            🚧  launch scope done; purchasing is post-launch
Phase 9   Reporting completeness          ⬜  post-launch backlog
Phase 10  Card settlement completion      ⬜  post-launch backlog; manual process at launch
Phase 11  Offline / PWA completion        🚧  implementation done; clean-browser/cable-pull verification remains
Phase 12  Backup / DR completion          ⬜       re-drill after 6-8 add tables
Phase 13  Hardware acceptance             ⬜  on the pilot path; needs on-site time
Phase 14  Production launch / cutover     ⬜  gated on 4, 11, 12 and 13
Phase 15  Per-location stock              ⛔  skipped: shared pool is the chosen model
```

### Active release cut

**Production launch — two shops, shared stock.** The POS and website all decrement the same inventory ledger. Each register and shift remains independently accountable, while internal physical replenishment is outside the stock ledger because it does not change the shared total.

Remaining launch work:
1. Execute the remaining **physical** Phase 11 checks on each register: cold-offline Windows/browser restart and a real cable-pull sale/print/sync. The production-build browser suite is now 8/8, including the automated freshness, update-safety, and exactly-once cases.
2. Enter the receipt profile and physically verify five prints, QR scanning and void copy.
3. Install production backup, offsite copy and uploads backup; restore a real backup into a disposable database.
4. Execute the hardware runbook on every production register and harden the Windows kiosk accounts.
5. Set RPO/RTO, train the team, rehearse outage/rollback, then execute the Phase 14 controlled cutover.

Discounts, exchanges, purchasing, advanced reporting and statement import do not block this cut. They remain explicit post-launch work so feature development cannot displace reliability work.

---

## Change log

Kept so the plan can be audited against what actually happened, rather than
read as if it had always said this.

**1 August 2026**
- Launch scope changed by owner decision: two shops plus stock room and website use one shared stock pool; per-location stock and transfers are deliberately skipped. Feature phases 6–10 moved off the launch path. Production launch now gates on receipt, offline/PWA, backup/restore, hardware acceptance and controlled cutover.
- Browser-only offline durability risk accepted with the team as operational owner. Catalog freshness enforcement built: warning at 8 hours, offline payment blocked at 12 hours, including the online-request-failed fallback path.
- POS production precache and safe-update gate built. The generator identified a 14-file POS-only offline package from the hashed build instead of caching every admin page; worker activation now waits for an empty cart/payment/queue. The installed app starts at `/pos`.
- Morning readiness and hardware persistence completed: saved register/hardware restore, QZ reconnect, signer reachability, stale prior-day shift and different-cashier recovery, plus API-reachability fallback even when Wi-Fi still reports connected.
- Durable register-side diagnostics completed: browser QZ/printer/drawer events upload to Diagnostics; the Windows signer installer starts at logon, restarts after failure, and retains rotating JSON logs under `C:\ProgramData\ElitePOS\device-signer\logs`.
- Final automated release verification expanded to `8/8` POS browser tests against the real production build and `33/33` PostgreSQL-backed server tests. Physical cable-pull/restart and full two-register acceptance remain operational gates.
- Void customer copy built through the existing renderer: original receipt identity, `VOID` heading, reason/amount, cash-only drawer pulse, and post-commit print-failure logging. Physical printer verification remains.
- Backup format widened from database-only to one encrypted database + uploads bundle. Restore verifies upload count, supports an empty restore target, and remains backward-compatible with retained `.dump.gpg` files. A real local pg_dump/encrypt/decrypt/upload-restore smoke passed; production installation and a full disposable-database restore remain.
- Phase 8 steps 1–2 built and tested: manual adjustments (closed reason list, audited) and stocktake (blind count, recount, race-safe posting). Deviated from the plan by dropping the manager-approval token on adjustments — reasoning recorded in that phase.
- Phase 3 first went green at 3/3 and was then expanded to 8/8. Its first real run found five defects, four in the spec and one in the product (a duplicate register name returned an unactionable `409`, now `REGISTER_NAME_TAKEN`).
- Phase 4.5 added: the receipt is English, with the product name bilingual on each item line. Tax removed from every surface. Corrected this plan's earlier claim that an Arabic receipt was a hard MOCI requirement — that rule attaches to tax invoices, and Qatar has no sales tax.
- Decisions closed: tax model, catalogue freshness window, cost basis, receipt language.
- Test suite made deterministic. It had been failing differently on each run; cause was concurrent boot-time DDL across parallel test files, a pre-existing weakness that more migrations made reachable. Advisory lock over the whole bootstrap plus `--test-concurrency=1`. 33/33, three runs in a row.

**31 July 2026**
- Phase 5 built and tested: customer linking at the till, and one customer identity shared with the website. Found that `customers.email` was `NOT NULL`, so a phone-only walk-in could not be recorded at all, and that the two channels matched on different keys and so split the same person into two rows.
- Phase 5.5 added, unplanned: concurrency on the same unit verified with real concurrent transactions. Found and fixed non-deterministic variant lock ordering (a latent deadlock that Phase 1's second writer made reachable) and a background sweep that could lock rows across tenants.

**30 July 2026**
- Plan written, from the readiness analysis of the same day.
- Phase 1 built and tested: paid web orders had never decremented stock, and catalogue edits bypassed the ledger. Both fixed, with an idempotent and self-healing design rather than the single-transaction one this plan first proposed — reasoning recorded in that phase.
- Phase 2 (docs/24) built and tested.

---

## Cross-cutting rules for every phase

These are the invariants the existing POS core already respects. Every phase above must keep them true, and a change that breaks one is wrong regardless of what it delivers.

1. **Money and stock move in one database transaction, or not at all.**
2. **Integer cents everywhere.** No floating-point currency crosses any boundary.
3. **Every mutating operation carries an idempotency key** with a database-level unique constraint behind it.
4. **The server is authoritative** on price, stock, totals, receipt ownership and shift state. A client never decides these.
5. **A completed customer sale is never silently rewritten.** A later conflict creates a reconciliation record; it does not change what the customer paid.
6. **Stock only changes together with a ledger row** (from Phase 1 onward, without exception).
7. **Approvals are single-use, action-scoped, time-limited, and never self-approved.**
8. **Printing and emailing happen after commit** and can never reverse or duplicate a financial fact.
9. **Offline is a first-class state**, not an error path.
10. **Logging must never be able to fail a sale** (docs/24 D3).
