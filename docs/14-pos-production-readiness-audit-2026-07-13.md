# Elite POS production-readiness audit and implementation plan

**Audit date:** 13 July 2026  
**Target:** one dependable physical retail shop in Qatar, with a path to more registers/branches  
**Scope:** Angular admin POS, Express API, PostgreSQL schema and transaction services, IndexedDB queue, custom service worker, QZ Tray/device signer, tests, deployment documentation, security dependencies, and shop operating features.

## Executive decision

**Elite POS has a strong transactional foundation, but it is not ready today to be the shop's only trusted POS.** It is suitable for a controlled pilot running in parallel with the current system after the P0 blockers in this report are closed.

The strongest parts are the parts that are hardest to retrofit later: atomic sales, row-level stock locking, server-side totals, receipt-number reservation, idempotent retries, durable database records, refunds/voids, shifts, manager approval, and an explicit offline queue. The API integration suite passes and the production Angular build succeeds.

The release blockers are operational rather than cosmetic:

1. The application is offline-capable but **not an installable PWA**: it has no web app manifest.
2. Unsynchronized money exists only in browser IndexedDB, without persistent-storage opt-in or a second durable local journal.
3. A transient API outage can put the UI into an offline state without starting a periodic recovery loop.
4. The receipt is English-only, strips Arabic characters, lacks required supplier details, and therefore does not meet the identified Qatar invoice requirement.
5. Card payments are manually declared paid; there is no terminal authorization, reference capture, settlement, or reconciliation.
6. There is no low-privilege cashier role or real separation between cashier and manager approval.
7. Production dependencies contain known high-severity advisories.
8. The server lacks a production security baseline: fail-closed secrets/cookies, CSRF protection, security headers/CSP, and explicit authentication rate limiting were not found.
9. POS sale/refund/void stock changes bypass the existing `inventory_movements` ledger.
10. Backup/restore drills, monitoring, alerting, and a tested disaster-recovery procedure were not found.

**Recommended launch rule:** do not remove the existing POS until Elite completes 10 consecutive business days in parallel with zero unexplained cash variance, zero lost/duplicate sale, 100% sync recovery, successful restore drill, and signed hardware acceptance.

## Audit method and evidence

This report uses four kinds of evidence:

- Static tracing of the critical paths in `server/lib/pos/*`, `server/routes/pos.route.js`, migrations 015/016, the Angular POS component/services, receipt renderer, service worker, and deployment/runbook documents.
- Runtime verification on 13 July 2026.
- Dependency advisory checks against the npm registry.
- Current primary guidance from browser/platform standards, PCI SSC, OWASP, PostgreSQL, and Qatar's Ministry of Commerce and Industry.

### Runtime verification result

| Check | Result | Meaning |
|---|---:|---|
| `server/npm test` | **Pass: 12/12** | Includes authenticated sale, idempotent replay, parked cart, void, refund, offline conflict, and Z close against PostgreSQL. |
| `client/npm run build:admin` | **Pass** | Production bundle builds. There is one unrelated storefront CSS budget warning and one CommonJS optimization warning. |
| Playwright POS browser test | **Fail** | The current UI now requires choosing a variant and clicking **Add to cart**, but the test still assumes clicking a product adds it directly. The test times out with **Take payment** disabled. This is test drift, but it means the browser release gate is currently red. |
| Server production dependency audit | **Fail** | 1 high and 3 moderate advisories: Nodemailer high; Express/`qs` and Morgan moderate. |
| Client production dependency audit | **Fail** | 8 high findings across the Angular 17 package family. A planned framework upgrade and regression pass is required. |

The browser test validates only one online cash sale and one offline cash sale. It does not currently prove installability, cold offline launch, reload during outage, timeout-after-commit recovery, two-register concurrency, print failure, session expiry, queue storage failure, update safety, refunds/voids in the browser, or hardware.

## Current implementation scorecard

Scores describe readiness to be the only production POS, not code style.

| Area | Score | Audit conclusion |
|---|---:|---|
| Transaction atomicity and idempotency | **A-** | Strong. Sale/order/payment/receipt/stock writes are transactional and retry-safe. Add concurrency/timeout tests and bounded DB timeouts. |
| Online inventory correctness | **B+** | Variant rows are locked and stock cannot go below zero online. Inventory movement history is missing. |
| Offline sales and reconciliation | **C** | Good queue and conflict model, but browser-only durability, recovery-loop gaps, stale-price policy, and weak forensic recovery remain. |
| PWA/installability/update safety | **D** | Custom service worker exists, but no manifest, no install flow, no generated precache manifest, no update gate, and no persistent-storage request. |
| Cash handling and shifts | **B-** | Opening float, X-style summary, close count, variance, voids/refunds exist. Cash paid-in/out, safe drops, drawer audit, Z history/print, and blind-close options are missing. |
| Card payments | **D** | Manual confirmation only; no authorization or reconciliation. The software must never collect PAN/PIN itself. |
| Receipts and Qatar compliance | **F** | Receipt is not Arabic-capable and lacks the required business/supplier content. |
| Roles and fraud controls | **D+** | Manager PIN tokens are well scoped, single use, expiring, hashed, and audited. There is no cashier role or enforced approver separation. |
| Refunds, voids, and returns | **B** | Partial/full refund and same-shift void are strong. Exchanges, store credit, return disposition, and terminal refund integration are missing. |
| Catalog and barcode | **B** | Product/variant search, HID barcode scanning, stock visibility, and catalog cache exist. Label printing/camera scan and cache-age policy are missing. |
| Inventory operations | **C-** | Stock sale/restock works. Receiving, suppliers, purchase orders, transfers, stocktake, adjustments, shrinkage reasons, and movement-ledger writes are absent. |
| Customer/CRM at checkout | **D+** | Backend customer linkage/search exists, but checkout always sends `customerId: null`. Loyalty and customer-facing receipt delivery are absent. |
| Discounts/promotions/tax | **D** | Not implemented. Promotions in Qatar require an operational approval process as well as software controls. |
| Security | **D** | Good parameterized SQL, tenant scoping, session auth, hashed secrets, and audit events. Known vulnerable dependencies and missing web hardening block release. |
| Observability/backup/disaster recovery | **D** | Health endpoint and PM2 logs exist; business metrics, alerts, backups, restore testing, and incident runbooks are not demonstrated. |
| Automated verification | **C-** | Useful API integration coverage, but only 12 server tests and one currently failing browser scenario are too small for a money system. |
| Hardware readiness | **C** | QZ integration, signer isolation, allowlist, receipt rendering, and an excellent field runbook exist. No exact production hardware has been certified in this audit. |

## What is already well implemented

### 1. Sale integrity

- `createSale()` runs inside a real PostgreSQL `BEGIN/COMMIT/ROLLBACK` boundary.
- Register, shift, receipt block, and product variants are checked under database locks.
- Online sales reject stale prices and insufficient stock.
- Server code calculates authoritative totals and validates cash/card allocations using integer cents.
- One transaction creates the core order, order items, payment, POS transaction/items, receipt, stock updates, timeline, and audit event.
- Printing happens after the sale has committed, so printer failure does not undo or duplicate the financial transaction.

### 2. Retry and duplicate prevention

- Sales, refunds, voids, and Z close use idempotency keys.
- `UNIQUE (tenant_id, idempotency_key)` constraints provide a final database guard.
- A repeated sale returns the existing canonical transaction.
- A network timeout after commit can safely fall back to the local queue with the same key and later synchronize without creating a second sale.

### 3. Receipt numbering

- Receipt blocks are allocated server-side per tenant and register.
- Database constraints prevent overlapping blocks and duplicate tenant receipt numbers.
- Offline queue insertion and local receipt-number advancement occur in one IndexedDB transaction.
- Rejected receipt numbers are retained in the rejected queue instead of silently being reused.

### 4. Corrections and audit

- Same-shift voids restore stock and update the linked order/payment.
- Partial and full refunds prevent over-refunding and can optionally restock.
- Manager approvals are bcrypt checked, rate/lock protected, action scoped, register/cashier bound, single use, and short lived.
- Sensitive actions write `audit_events`.
- Conflict review endpoints and UI are present.

### 5. Offline and hardware baseline

- IndexedDB stores register identity, open shift, receipt block, catalog, hardware settings, queued sales, and parked carts.
- The service worker avoids generically caching authenticated API responses.
- Offline sales keep an immutable sale/receipt snapshot and synchronize in batches.
- Stock/price conflicts preserve the accepted financial fact for manager review instead of dropping a paid sale.
- QZ printing is signed and printer operations are allowlisted; the local signer binds to loopback and supports offline printing.

## Confirmed release blockers and required fixes

### P0-1 — Complete the PWA, not just offline caching

**Evidence:** `client/projects/admin-portal/src/index.html` has no manifest link and the assets contain no `.webmanifest`. `pos-sw.js` is a handwritten 46-line network-first cache.

Current browser guidance requires a web app manifest for an installable PWA and identifies `name`, 192/512 icons, `start_url`, and `display` among Chromium's required members. See [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Required implementation:

1. Add `pos.webmanifest` with a `/pos` start URL, `scope: /pos`, `display: standalone`, brand colors, 192/512 icons including maskable variants, and POS shortcuts.
2. Link it from the admin index and add an in-app install/status experience for the terminal setup screen.
3. Prefer a generated asset manifest (Angular service worker or Workbox inject-manifest) so every required shell chunk is known at build time.
4. Add an offline cold-start test after installation, not merely an offline transition while the page is already open.
5. Version updates atomically. Do not activate/delete the current cache while a sale is in progress or pending sync.
6. Show **update ready**, block checkout briefly at a safe boundary, reload, verify schema migration, and allow rollback.
7. Narrow the POS worker's effective responsibilities. The current `/` scope covers the whole admin origin even though its behavior is POS-specific.

### P0-2 — Make unsynchronized sales durable enough for money

**Evidence:** the only pre-server record is `elite-pos` IndexedDB, store `pending-sales`. No call to `navigator.storage.persist()` or `navigator.storage.estimate()` exists.

Browser storage is best effort by default and may be evicted under pressure. Persistent storage can be requested using `navigator.storage.persist()`. See [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Minimum PWA fix:

- Request and display persistent-storage status during terminal enrollment.
- Refuse production offline mode in private/incognito profiles.
- Monitor quota/usage and show a blocking terminal-health error on IndexedDB write, corruption, or quota failure.
- Store queue lifecycle events in an append-only local journal: created, printed, sync attempted, accepted, rejected, resolved.
- Keep the immutable sale after acceptance for a configurable local audit window; mark it synced instead of immediately deleting the only local copy.
- Export an encrypted support bundle for unresolved sales.

Recommended fixed-terminal architecture:

- Extend the existing local signer into a restricted **POS local agent** with SQLite or an append-only journal.
- The browser writes each offline financial sale to both IndexedDB and the local agent before printing/opening the drawer.
- The agent can sync independently after the browser closes and can prove unsynced receipt numbers during close.
- Use per-terminal encryption keys and OS service permissions; never store payment card data.

This still permits a PWA UI, but removes the browser profile as the only record of cash already accepted.

### P0-3 — Fix connectivity recovery and queue health

**Evidence:** when `createSale()` receives HTTP status `0`, the component sets its own `online` signal to false and queues the sale. It does not schedule a sync retry at that point. A retry timer is started only when `syncPendingSales()` itself throws. If the API is down while `navigator.onLine` remains true, the browser may never fire a new `online` event.

Required implementation:

- Treat `navigator.onLine` only as a hint.
- Poll a lightweight authenticated POS health/check-in endpoint with jitter every 15–30 seconds while degraded.
- Run queue sync periodically while the page is open, on focus/visibility return, on service-worker/background-sync events where supported, and immediately after a successful health check.
- Show pending count, rejected count, oldest pending age, last successful sync, and server reachability separately.
- Alert at thresholds such as 2 minutes, 10 minutes, and receipt-block exhaustion risk.
- Add timeout-after-server-commit and API-down-with-network-up browser tests.

### P0-4 — Produce a legally usable Arabic invoice/receipt

Qatar MOCI states that merchants must provide detailed consumer invoices and that the invoice must be in Arabic, optionally alongside another language. The official consumer guide lists supplier name/address/date, commodity/service details, unit, quantity, condition, QAR price, delivery date where applicable, signature/stamp, and serial/part details. See [MOCI obligations](https://www.moci.gov.qa/en/our-services/investor/obligations/) and the [MOCI Consumer Rights Guide](https://www.moci.gov.qa/wp-content/uploads/2024/10/A5-Consumer-Rights-Guide-20240918-EN-AR4391.pdf).

**Evidence:** `PosReceiptRenderer.truncate()` replaces every character outside printable ASCII with `?`. The header is hard-coded `ELITE`; all labels are English; no supplier address, contact, commercial/license information, or configurable stamp/footer is included; the timestamp is UTC rather than Qatar local time.

Required implementation:

- Store verified legal receipt profile: Arabic/English trade name, supplier address, phone, CR/license details as advised by local counsel, return policy, and optional stamp/footer.
- Render Arabic with a printer-certified method. Many ESC/POS printers need an Arabic code page, shaping/bidi support, or rasterized receipt image; test the exact Bixolon model.
- Print bilingual product description, quantity, unit price, total, QAR currency, local Qatar date/time, payment method, receipt number, cashier/register, and return/refund references.
- Generate an identical downloadable/email/WhatsApp PDF or image receipt when configured.
- Obtain local legal/accounting sign-off on the final layout before launch.

This report is technical, not legal advice; the cited MOCI material makes Arabic support a clear engineering requirement, while counsel/accounting should confirm the exact final fields.

### P0-5 — Integrate and reconcile card payments safely

**Evidence:** card is recorded as provider `pos-manual`, status `paid`, solely from cashier confirmation. No terminal transaction reference, authorization code, reversal, settlement import, or reconciliation exists.

Required implementation:

- Select the Qatar acquirer/terminal first and integrate through its approved ECR/terminal protocol or cloud API.
- Use terminal-presented amount, approval/decline, terminal ID, masked reference, authorization code, RRN/STAN where supplied, and idempotent payment correlation.
- Never collect or store PAN, track data, CVV, or PIN in the PWA.
- Implement cancel/reversal for timeout ambiguity and terminal-driven refunds.
- Import or query settlement totals and reconcile POS card totals by terminal, shift, and business day.
- Keep manual card confirmation only as a manager-approved fallback with mandatory terminal reference and a reconciliation exception.

PCI SSC notes that payment terminals are in scope for PCI DSS, require correct configuration/device management, and must not retain sensitive authentication data after authorization. See [PCI SSC FAQ 1300](https://www.pcisecuritystandards.org/faqs/1300/). The final scope must be agreed with the acquirer/QSA; using an approved isolated terminal/P2PE path is preferable to bringing card data into Elite.

### P0-6 — Close dependency and web-security gaps

Required before production:

- Upgrade Angular through supported versions to a release that resolves the audited advisories; do it incrementally with full regression and visual checks.
- Upgrade Nodemailer and the server packages that resolve the Express/`qs` and Morgan findings.
- Pin and test an even-numbered Node LTS release. The audit ran on Node 25 and both Angular commands warn that it is not LTS.
- In production, fail startup when `SESSION_SECRET`, database URL, allowed origins, and signing secrets are missing or default.
- Default production session cookies to secure; set explicit domain/path/SameSite policy; document idle and absolute POS session limits.
- Add CSRF tokens or strict Origin/Fetch-Metadata validation for cookie-authenticated mutations.
- Add Helmet-equivalent headers and a tested Content Security Policy. Self-host the remaining Google fonts so offline behavior and CSP do not depend on third parties.
- Add login/password-reset/PIN/enrollment rate limits and security alerting.
- Validate against [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/) at an agreed level, then run an independent penetration test.
- Harden the Windows kiosk: dedicated non-admin account, browser policy, no extensions/devtools, automatic OS/security updates, encrypted disk, POS VLAN, USB policy, and remote support controls.

### P0-7 — Add a real cashier role and enforced separation

Required implementation:

- Add a `cashier` role limited to POS sale, park/resume, permitted customer lookup, receipt reprint, and own open shift.
- Owner/admin manages terminals, prices, users, exports, and policies outside the POS.
- Manager approves void, refund, no-sale drawer open, discount override, price override, conflict resolution, and variance close.
- An approver must not approve their own protected action unless an explicit emergency policy is enabled and separately audited.
- Use unique manager identity/PIN, not a shared store PIN. Show approver name on the audit event and correction receipt.
- Add shift handoff/logout and fast cashier switch without sharing admin accounts.

### P0-8 — Make inventory changes reconcilable

**Evidence:** `inventory_movements` exists in migration 001, but no server JavaScript writes it. Sale, void, and refund update `product_variants.stock_quantity` directly.

Required implementation:

- Every sale, void, refund/restock, manual adjustment, receipt, transfer, damage, and stocktake posts an immutable inventory movement in the same database transaction as the stock update.
- Record tenant, location, product/variant, signed quantity delta, before/after quantity, reason, source entity, register, shift, actor, manager approval, and timestamp.
- Derive inventory history and discrepancy reports from this ledger.
- Add a consistency job that compares variant balance with movement totals and alerts on drift.

### P0-9 — Establish backup, recovery, and observability

Required implementation:

- Automated encrypted PostgreSQL backups with point-in-time recovery where supported, off-host copy, retention policy, and access control.
- Monthly restore test into an isolated environment; record RPO/RTO and evidence. A backup that has never been restored is not a release control.
- Structured request/business logs with correlation IDs; redact secrets, cookies, PINs, and customer data.
- Metrics and alerts: API/DB latency, error rate, lock timeout/deadlock, sale failure, duplicate/idempotent replay, pending oldest age, rejected queue, conflicts, receipt-block remaining, SSE lag, printer/signing failures, card reconciliation mismatch, cash variance, backup age, disk, and certificate expiry.
- Store dashboard plus operator-readable incident runbooks: internet outage, API outage, DB outage, printer failure, terminal loss, queue corruption, rejected sync, payment ambiguity, and rollback.

## P1 — Features required for a dependable one-shop operation

These follow immediately after the P0 foundation and should be completed before declaring the solution feature-complete.

### Checkout and customer

- Wire the existing phone customer search into checkout; support create/link customer with consent and guest sale.
- Email/SMS/WhatsApp receipt only through approved providers and consent rules.
- Line and basket discounts with reason codes, manager thresholds, maximum margin protection, and immutable original/list price.
- Promotion engine with date/store/product/customer constraints and Qatar promotion-license workflow/metadata.
- Exchange workflow as linked return plus replacement sale, including price difference and split refund/collection.
- Store credit/gift card only with a proper liability ledger, unique secure token, balance history, expiry/legal policy, and idempotency.
- Split tender (cash + card, multiple card) after payment integration supports partial authorization and reversal.
- Configurable tax model with effective dates and tax-inclusive/exclusive prices. Keep tax at zero until Qatar/accounting configuration explicitly enables it.
- Sale notes, salesperson attribution, and controlled price override.

### Cash and shifts

- Cash paid-in, paid-out, safe drop, float add/remove, and manager-approved no-sale drawer open.
- Cash denomination count; optional blind close to reduce bias.
- X report print and Z report history/reprint/export.
- Business-day boundary independent of UTC; use `Asia/Qatar` for shop reporting.
- Shift handoff and forced-close recovery with dual approval.
- Variance thresholds, mandatory reason, and escalation.

### Inventory operations

- Supplier and purchase-order records.
- Receiving with over/short/damaged quantities and cost capture.
- Manual stock adjustment with reason/approval.
- Stocktake/cycle count with blind count, recount, variance approval, and immutable posting.
- Low-stock/reorder report and reorder points per variant.
- Barcode label printing using the existing label service, with collision validation.
- Damaged/quarantine/return-to-vendor disposition so a refund does not automatically make every item sellable.

### Reporting

- Daily sales by payment, cashier, register, item, variant, hour, discount, return, and gross margin.
- Cash drawer movement and variance report.
- Card settlement/reconciliation exception report.
- Inventory movement, shrinkage, stock valuation, sell-through, and aged stock.
- Refund/void/discount/no-sale exception dashboard.
- Z report history with immutable source data and export.

## P2 — Scale and advanced capability

- Multi-location inventory model; do not fake branches with one tenant-wide stock number.
- Location transfers with ship/receive states and in-transit inventory.
- Central catalog/price books and location-specific availability.
- Loyalty earn/redeem with fraud and liability controls.
- Purchase planning and supplier performance.
- Ecommerce/POS omnichannel returns, pickup, reservation, and unified customer history.
- Central device management, register revocation, remote health, certificate rotation, and staged app rollout.
- High-availability API/database design and Redis/PostgreSQL notification replacement for one-second SSE polling when scale requires it.

## Offline/PWA target architecture

```text
Cashier PWA
  |-- generated/versioned app shell cache
  |-- IndexedDB catalog + UI state + queue mirror
  |-- persistent-storage/quota health
  |
  | localhost, authenticated per terminal
  v
POS local agent (Windows service)
  |-- encrypted SQLite/append-only sale journal
  |-- print/sign bridge and hardware health
  |-- independent retry worker
  |
  | HTTPS + register credential + idempotency key
  v
Elite API
  |-- transaction inbox/idempotency
  |-- receipt ownership
  |-- authoritative catalog/price/conflict policy
  |-- observability and reconciliation
  v
PostgreSQL + backups/PITR
```

### Offline sale state machine

`draft -> locally_committed -> printed -> syncing -> accepted | accepted_with_conflict | rejected -> resolved`

Rules:

- Drawer/receipt action occurs only after `locally_committed` succeeds.
- State transitions are append-only and idempotent.
- A timeout never changes the idempotency key.
- Accepted sales are retained locally for an audit window.
- Rejected sales are never silently edited or deleted; resolution creates a linked corrective action and preserves the original receipt number.
- Shift close displays local-agent and server queue facts and refuses to close on disagreement.

### Offline price/stock policy

The current implementation accepts the price actually shown/tendered offline and records a conflict when the server price differs. That is internally consistent with the printed receipt and cash already collected, but it exposes the shop to stale-price loss.

Recommended policy:

- Display catalog age continuously.
- Permit offline sale only while the catalog is within a configurable freshness window (for example, 8–24 hours based on business policy).
- Block offline sale for recalled/disabled catalog versions when the server has previously delivered a revocation.
- Auto-accept small configured price deltas as the sold financial fact; require manager review for high-value/high-percentage deltas.
- Never silently rewrite a completed customer's total during later sync.
- Stock shortages create reconciliation tasks and never create negative sellable stock.

## Test and acceptance plan

### Automated unit/property tests

- Money limits, invalid/overflow quantities, duplicate lines, zero/negative values, rounding, discounts, taxes, and split tender.
- State-machine transition tests for sales, refunds, voids, payments, shifts, receipts, conflicts, and updates.
- Inventory movement balance invariants.
- Receipt renderer golden tests for Arabic/English content and exact printer widths.

### Database/integration tests

- Two registers sell the last unit concurrently: exactly one online sale succeeds.
- Same idempotency key with same/different payload and different register/cashier.
- Timeout/deadlock/lock-timeout behavior and retry classification.
- Receipt block overlap, exhaustion, gaps, rejected sync, and replay.
- Partial refund races and duplicate refund/void requests.
- Shift close racing a sale/refund/sync.
- Tenant isolation for every POS endpoint and lookup.
- Inventory movement and aggregate consistency after sale/void/refund.

### Browser/PWA tests

- Repair the current variant-picker E2E first.
- Installability/manifest validation and standalone launch.
- First install, warm offline, cold offline, refresh offline, browser restart, and Windows restart.
- API down while LAN remains up; recover without an `online` browser event.
- Network drops before request, during request, after server commit, during response, and during sync.
- Service-worker update with empty cart, active cart, payment open, pending queue, and local DB migration.
- IndexedDB quota/write failure, corrupt record, storage not persistent, and private mode.
- Session expires online and while offline; reauthenticate without losing queued sales.
- Accessibility/keyboard-only/scanner focus and rapid repeated scan.

### Hardware and field tests

- Execute every item in `docs/pos-hardware-runbook.md` on the exact terminal, Windows build, browser version, printer firmware/driver, drawer, scanner, QZ version, and local agent.
- Arabic receipt, cutter, QR scan, long names/SKUs, paper-out, cover-open, spooler stopped, QZ stopped, signer stopped, USB reconnect, and power loss.
- Card approve/decline/cancel/timeout/reversal/refund and end-of-day settlement.
- UPS/power-loss recovery while locally committing, printing, and synchronizing.

### Operational acceptance gates

- 100% automated P0 suite green on the release artifact.
- Independent security test has no unresolved critical/high finding.
- Restore drill meets agreed RPO/RTO.
- Exact hardware acceptance signed by operations.
- Arabic receipt signed off by local legal/accounting.
- Card settlement matches POS across a full test cycle.
- Parallel pilot: at least 10 business days and representative peak load, with no unexplained sale, receipt, stock, payment, or drawer variance.

## Delivery plan

Assumption: two engineers (one full-stack/offline, one backend/payments), part-time QA, store operator, and access to the actual hardware/acquirer. Acquirer certification or legal review can extend calendar time.

| Phase | Duration | Deliverable | Exit gate |
|---|---:|---|---|
| 0. Baseline and decisions | 2–3 days | Freeze supported terminal/browser/hardware; choose acquirer; define legal receipt profile, offline price policy, RPO/RTO, and launch metrics. | Written decisions and acceptance matrix. |
| 1. Security and green baseline | 1–2 weeks | Dependency/framework upgrade, Node LTS, fail-closed config, headers/CSRF/rate limits, fixed browser E2E, CI gates. | Build, API, browser, audit, and security baseline green. |
| 2. Production PWA/offline | 2–3 weeks | Manifest/install flow, generated cache, persistent storage, periodic health/sync, queue journal/status, safe updates; local agent journal strongly recommended. | Cold-offline/restart/update/failure suite green. |
| 3. Legal receipt, roles, inventory ledger | 2–3 weeks | Arabic/English receipt, business profile, cashier role/separation, inventory movements, cash movements, Z history/print. | Legal/accounting and hardware sign-off; stock/cash invariants green. |
| 4. Card integration and reconciliation | 2–4+ weeks | Approved terminal link, reversals/refunds, references, settlement reconciliation, exception UI. | Acquirer test/certification and settlement match. |
| 5. One-shop completeness | 2–4 weeks | Customer link, discounts/promotions, exchanges, stocktake/adjustments, suppliers/receiving, operational reports. | End-to-end store UAT. |
| 6. Pilot and cutover | 2 weeks minimum | Parallel run, staff training, support rota, restore drill, controlled cutover and rollback plan. | 10-day zero-unexplained-variance gate. |

**Practical estimate:** 8–14 weeks to a dependable one-shop release if payment integration and hardware access proceed normally. A narrower cash-only pilot can be earlier, but it should not be called the complete production POS.

## Prioritized engineering backlog

### Must fix before pilot (P0)

- [ ] Repair and expand browser E2E; add CI release gate.
- [ ] Upgrade vulnerable Angular/server dependencies and use Node LTS.
- [ ] Add fail-closed production config, CSRF/origin protection, security headers/CSP, and rate limits.
- [ ] Add installable manifest, generated/versioned offline shell, persistent storage, quota health, and update workflow.
- [ ] Add periodic reachability and queue sync independent of browser `online` events.
- [ ] Implement Arabic-capable, legally reviewed receipt with supplier profile and Qatar local time.
- [ ] Add cashier role and approver separation.
- [ ] Write POS stock changes to immutable inventory movements.
- [ ] Add backup/restore, metrics, alerts, and incident procedures.
- [ ] Complete exact hardware field acceptance.

### Must fix before sole-POS cutover

- [ ] Durable local-agent journal or an explicitly accepted residual browser-only data-loss risk.
- [ ] Integrated card authorization/refund/reconciliation or restrict the release to cash-only.
- [ ] Cash movements, Z history/print, variance workflow, and shift handoff.
- [ ] Customer link/create at checkout.
- [ ] Exchanges, discounts/promotion controls, and stock adjustment/stocktake.
- [ ] Parallel pilot and reconciliation gates passed.

### Next operational value

- [ ] Suppliers, purchase orders, receiving, reorder planning.
- [ ] Gift/store credit and loyalty ledgers.
- [ ] Advanced reporting and exception dashboards.
- [ ] Multi-location inventory and transfers only when a second location is real.

## Final recommendation

Continue with Elite POS—the core is worth hardening. Do not replace it or rewrite it around a generic offline cache. Preserve the current transactional/idempotency/receipt design, then build a production shell around it: durable local journal, installable/version-safe PWA, legal bilingual receipt, least-privilege staff model, integrated payments, inventory/cash ledgers, monitoring, and proven recovery.

The correct next implementation slice is **Phase 1 + Phase 2 together**: make the build secure and green, then make offline operation observable and durable. Receipt compliance, roles, and inventory ledger should follow immediately, before any live pilot takes real customer payments.
