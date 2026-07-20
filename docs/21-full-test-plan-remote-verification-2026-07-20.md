# Full Test Plan — Remote Verification (2026-07-20)

Follow-up to `docs/19-full-test-plan.md`. This covers everything that could be verified remotely against `https://admin.elitecollections.qa/` and `https://elitecollections.qa/` today, using the Owner account. Sections requiring physical POS hardware or VPS SSH access were not run — see the flagged list at the bottom.

## 0. Deployment status

Earlier today the live site was still running the build from before commit `6dba5c6`'s successors — no "Reports" nav item, no "Documentation Guide" link, and a direct hit on `/reports` silently redirected to `/dashboard`. Partway through this session a new deploy went out. Re-checking confirmed:

- Sidebar now shows **Reports** (Sales & Ledgers) and **Documentation Guide** (Staff Handbook), in addition to the previously-verified Reconciliation.
- `/reports` loads the real page instead of redirecting.
- `assets/docs/staff-guide.html` serves the staff guide correctly.

This confirms everything through commit `8d13dc5` (Phase 9 backups) — including `9437a13` (Phase 5 Reports) and `84e72d6` (Phase 6, Angular 17→22) — is now live.

## 5. Core reporting suite (Phase 5)

All six Reports tabs were opened and cross-checked against known transactions from this session's and prior sessions' testing:

| Tab | Result |
|---|---|
| Daily Sales | QAR 16,900 / 11 transactions for Jul 19, broken down correctly by day, payment method, cashier, register, and hour. A cash sale created and then voided during this session's regression test did **not** inflate the total — confirms voids are correctly excluded from sales totals. |
| Cash Movements | Shows Paid In, Paid Out, and No-Sale Drawer Open entries from earlier retests with correct human-readable labels (confirms the label-formatting fix shipped). Shift-close variance row: QAR 0.00 (matches). |
| Card Settlement | Loads correctly; empty for the current date window since no settlement was entered in that range. Not a bug — just no data for these dates. |
| Inventory | Shows `pos_sale`, `pos_refund`, `pos_void` movements matching the ledger from earlier retest sessions, net deltas correct. |
| Refunds & Voids | Shows the void, partial refund, and full refund test transactions from the prior cross-account PIN retest, with correct amounts, reasons, cashier, and approving manager. |
| Z-Reports | Shows the closed shift with Net Sales, Expected, Physical, and Variance all QAR-correct (QAR 0.00 variance). |

**CSV export**: present on every tab and triggers a client-side download without console errors. I could not inspect the downloaded file's contents (including Arabic-character encoding) from this remote session, since the file lands in your local Downloads folder rather than anywhere I can read. Worth a quick manual open-in-Excel check on your end for at least one Arabic-heavy export (e.g., a reason field with Arabic text).

**Gap**: there's still no single consolidated "financial summary" report — each tab is scoped narrowly, as already noted in the staff guide.

## 6. Angular 17 → 22 upgrade regression check

**6.1 Storefront** (`elitecollections.qa`): Homepage, Collections listing, product detail page, add-to-cart drawer, and checkout (through the Details step) all rendered and functioned correctly. No console errors. Product images on the listing grid render a beat after the rest of the page (lazy-load behavior) rather than being broken — confirmed by watching a couple of them resolve on a follow-up screenshot and by checking the network log (all image requests returned 200). Did not submit an actual checkout/order — that would place a real order and needs your go-ahead first.

**6.2 Admin portal**: Catalog (grid + product edit drawer), Orders list, Settings (General, Manager PIN card, POS Registers card), and Reconciliation all rendered correctly with the Angular 22 build. Dashboard loads cleanly with no flash of unstyled/empty content.

**6.3 POS**: Logged into the register, added a product to cart via the variant picker, completed a QAR 1,200 cash sale (order POS-00000605), then voided it through Returns/voids using the Owner's own manager PIN — void succeeded and the transaction status flipped to VOIDED. Confirms the sale → payment → post-sale-correction → PIN-approval pipeline all still work end to end after the framework upgrade.

No regressions found anywhere in Sections 6.1–6.3.

## Not run — needs hardware or SSH access

Per docs/19, the following remain outside what I can test from this remote session and need you (or someone on-site / with VPS access):

- **Section 1** — Receipt printing: text legibility, QR print x5, QR scan, reprint-from-lookup, register enrollment. Needs a physical receipt printer.
- **Section 2.1/2.3** — Inventory ledger DB verification and drift-job log check. Needs `psql`/SSH on the VPS (the UI-side actions were already completed in earlier sessions).
- **Section 3.2/3.3** — Physical Z-report printing and the physical cash-count step of shift close. Needs hardware.
- **Section 7** — PWA/offline resilience: installability, cold offline launch, real network-cable-unplug test. Needs a physical register.
- **Section 8** — Backup & restore drill. Needs SSH access to the VPS; references `docs/18-backup-restore-runbook.md`.
- **CSV Arabic-encoding spot check** (Section 5) — needs a local file open, as noted above.

## Bottom line

Deployment is confirmed live and correct through Phase 9. Every remotely-testable check in docs/19 Sections 5 and 6 passed with no regressions. The staff guide and docs/17 both remain accurate and don't need further updates from today's findings, aside from noting this file as the new verification record.
