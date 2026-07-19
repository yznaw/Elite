# Elite POS — Path to Official Launch: Roadmap & Test Gates

**Status as of 2026-07-19.** This picks up where [15-pos-production-hardening-plan.md](15-pos-production-hardening-plan.md) left off — that doc tracks *what's been built*; this one sequences *what's left* into shippable phases with explicit test gates, so each phase is provably done before starting the next.

**Confirmed working today** (hardware-tested on the real POSIFLEX/Bixolon SRP-QE300 register): security baseline, cashier role + approver separation, card terminal-reference capture, bilingual canvas receipt renderer (redesigned with the real Elite logo and premium typography), QZ Tray signing end-to-end, business-profile editing UI, "Go to POS" link in the admin topbar.

**Not yet started**: inventory ledger, cash movements/Z-report history, card settlement reconciliation, Angular security upgrade, PWA/offline hardening, legal receipt sign-off, backups/DR, multi-branch data model.

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

## Phase 2 — Cashier role hardening follow-ups (small, already mostly done)

**Why here:** this session already shipped the cashier role and approver-separation fix. This phase is just closing the two small gaps that were explicitly deferred.

### What to build
- Admin UI toggle for `pos_emergency_self_approval_enabled` (currently SQL-only).
- Confirm no regression on the already-decided scope: cashiers see nothing outside `/pos`.

### Test gate
- [ ] Manual: an owner can flip the emergency-approval flag from the UI, and doing so writes an audit event (already coded server-side — just needs a UI hook, verify it round-trips correctly).
- [ ] Manual: a cashier account, freshly created, can log in and reach `/pos` and nothing else — attempting to navigate directly to `/settings` or `/catalog` by URL redirects/blocks correctly.

---

## Phase 3 — Cash movements & Z-report history

**Why now:** depends on nothing from Phase 1 structurally, but sequenced here because it's the other half of "can we trust the numbers at end of day" — inventory ledger for stock, cash movements for cash. Doing them back-to-back means one hardware/UI testing session covers both money trails.

### What to build
- `pos_cash_movements` table (migration) — paid-in, paid-out, safe-drop, float-adjust, no-sale-drawer-open, each requiring a reason and (for drawer-open) a manager override.
- UI in the POS shift screen for cashiers/managers to log these.
- Z-report history list + reprint/export (the underlying `pos_z_reports` table already exists from earlier work — this is just the UI + reprint route).
- Wire cash movements into the shift-close variance calculation (`shift-service.js`'s `loadShiftSummary`).

### Test gate
- [ ] Unit test: shift-close expected-cash calculation correctly includes/nets out paid-in and paid-out amounts.
- [ ] Unit test: a no-sale drawer-open without a manager override is rejected; with one, it's recorded and audited.
- [ ] Manual: open a shift, do a real cash paid-out (e.g. "petty cash for supplies"), close the shift, and confirm the variance report on the printed/on-screen Z-report reflects it correctly — verify by hand-counting the actual drawer against the expected total.
- [ ] Manual: reprint an old Z-report from history and confirm it matches what was originally printed (no silent data drift on reprint).

---

## Phase 4 — Card settlement reconciliation

**Why now:** depends on nothing else, but lower urgency than Phases 1-3 since the terminal-reference capture (already shipped) is the acute fix; full settlement matching is a "close the books cleanly" feature, not a transaction-integrity one.

**Context:** the old POS system's own function-key menu has a "Close Batch" concept (likely end-of-day card batch settlement) and an "Audit Report" (likely a transaction/void/refund audit trail). Worth confirming with staff whether "Close Batch" on the old system actually talks to the card terminal/acquirer or is purely an internal record — that's real evidence about how card settlement already works day-to-day at this shop, and should inform this phase's design instead of guessing.

### What to build
- Settlement-import screen: manual/CSV entry of the bank's daily settlement total per register/business-day.
- Matching job against `pos_card_reconciliation` (table already exists), flagging `exception` on mismatch beyond a small tolerance.
- Exception-review UI requiring a manager note before marking resolved.

### Test gate
- [ ] Unit test: a settlement total that matches POS card totals within tolerance is marked `matched` automatically.
- [ ] Unit test: a mismatch is flagged `exception` and cannot be marked `resolved` without a note.
- [ ] Manual: run one real reconciliation cycle against an actual bank statement for a completed business day, confirm the numbers the system shows match what you'd calculate by hand.

---

## Phase 5 — Core reporting

**Why now, not earlier:** this is explicitly gated on Phases 1, 3, and 4 — reports read from `inventory_movements`, `pos_cash_movements`, and `pos_card_reconciliation`, so building reports before those ledgers exist would mean reporting on incomplete/wrong data.

### What to build
(As already scoped in docs/15 Phase 5 — unchanged, just confirming its real dependency here)
- Daily sales by payment/cashier/register/item/hour.
- Cash drawer movement + variance report.
- Card settlement exception report.
- Inventory movement/shrinkage report.
- Refund/void/discount exception dashboard.
- Z-report history list with export.

### Test gate
- [ ] Each report's numbers cross-checked by hand against raw ledger queries for one real business day.
- [ ] Business-day boundary in every report uses `Asia/Qatar`, not UTC midnight — verified with a sale made between midnight UTC and 3am Qatar time landing on the correct day.
- [ ] CSV export opens cleanly in Excel/Google Sheets with correct encoding (no mangled Arabic text in exported CR/business-name fields, if included).
- [ ] Manual: owner reviews one full real day's data across all six reports and confirms it "looks right" against their own memory of that day's sales.

---

## Phase 6 — Angular 17→19 security upgrade

**Why here, not first:** this is pure dependency hygiene with no user-facing behavior change — sequencing it after the money-critical phases means it doesn't block real progress, but it must land before Phase 10 (pilot) since it closes real CVEs in the framework the whole app runs on.

### What to build
- Incremental `ng update` 17→18→19, one hop at a time, with a full regression pass after each hop (storefront + admin + POS).
- Re-run `npm audit` after each hop to confirm advisories actually close.

### Test gate
- [ ] `npm audit` on `client/` shows zero unresolved high/critical after reaching 19.
- [ ] Full manual click-through of storefront (browse, cart, checkout), admin portal (catalog, orders, settings, the new receipt-profile page), and POS (sale, void, refund, cashier login) — nothing visually or functionally regressed.
- [ ] Automated Playwright suite (once fixed — see Phase 7) passes on the upgraded build.

---

## Phase 7 — PWA / offline resilience hardening

**Why here:** this was Phase 2 in the original audit and hasn't been touched this session at all. It's real, separate work — installable manifest, generated service-worker precache, persistent storage request, connectivity-recovery polling, offline queue journal.

### What to build
(As scoped in the original audit's Phase 2 / docs/15's Phase 2 section)
- Web app manifest + narrowed service-worker scope.
- `navigator.storage.persist()` + quota monitoring + private-mode detection.
- Periodic health-check polling independent of the browser's `online` event.
- Append-only IndexedDB queue journal with an audit-window retention policy.

### Test gate
- [ ] Lighthouse PWA installability check passes; app actually installs on the target Windows/Chrome kiosk setup.
- [ ] Cold offline launch (installed, browser fully closed, no network, reopen) works.
- [ ] Simulated "API down, LAN up" scenario recovers without any browser `online` event firing.
- [ ] A sale made fully offline, then synced once connectivity returns, produces exactly one server-side transaction (no duplicate).
- [ ] Manual: unplug the register's network cable mid-shift, ring up 2 real sales, plug the cable back in, confirm both sync correctly and the receipt-number sequence has no gaps or collisions.

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

## Phase 9 — Backup, restore drill, and disaster recovery

**Why here:** genuinely independent of all the above phases technically, but should land before the pilot since "we've never tested a restore" is not an acceptable state to enter a real money-handling pilot with.

### What to build
- Automated encrypted PostgreSQL backups with a defined retention policy.
- A written, rehearsed restore procedure.
- Monitoring/alerting on backup job failures.

### Test gate
- [ ] A real restore drill: take a backup, restore it into an isolated environment, confirm the restored data is complete and correct.
- [ ] Recorded actual RPO/RTO from the drill, compared against Phase 0's target (from the original audit — confirm what was decided).
- [ ] Backup failure alerting actually fires when tested (e.g. temporarily break the backup job and confirm someone gets notified).

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
Phase 0  "Go to POS" admin link         ✅ done, needs a manual click-through
Phase 1  Inventory ledger              ─┐
Phase 2  Cashier follow-ups             │  can run in parallel with 1
Phase 3  Cash movements + Z-history     │  (independent of 1, but grouped
Phase 4  Card settlement reconciliation ┘  for one hardware-test session)
Phase 5  Core reporting                    ← depends on 1, 3, 4
Phase 6  Angular upgrade                   ← independent, do anytime before 10
Phase 7  PWA/offline hardening              ← independent, do anytime before 10
Phase 8  Legal sign-off                    ← depends on business-profile being final
Phase 9  Backup/DR                          ← independent, do anytime before 10
Phase 10 Pilot & cutover                   ← gated on ALL of 1–9
Phase 11 Multi-branch                      ← deferred until AFTER Phase 10
```
