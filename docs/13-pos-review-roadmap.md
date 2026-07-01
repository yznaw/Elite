# POS Architecture Review and Hardening Roadmap

> **Status:** Review complete. Roadmap chunks 1 (Database Locking) and 2 (Offline Mode) specified in detail below; later chunks (hardware/error handling, conflict-review UX) sketched but not yet detailed.
> **Audience:** Backend developers working on `server/lib/pos/*`, frontend developers working on the Angular POS client.
> **Companion doc:** [12 — POS System and Integration](./12-pos-system.md) describes what the system does today. This document is an audit of *how well* the current implementation handles concurrency and offline failure, plus a prioritized fix list.
> **Scope of this review:** `server/lib/pos/sale-service.js`, `server/lib/pos/db.js`, `server/lib/pos/sync-service.js`, `client/projects/admin-portal/src/app/services/pos-local-store.service.ts`, `server/db/migrations/015_pos_foundation.sql`, `016_pos_operations.sql`.

---

## 1. Why this document exists

The POS feature was reviewed end-to-end for three specific failure classes that matter most in a real retail deployment:

1. **Race conditions** between multiple cashiers/registers operating on the same inventory at the same time.
2. **Offline resilience** — what happens when a register loses internet mid-shift, and how sales reconcile when it reconnects.
3. **General robustness** — transaction integrity, locking discipline, and durability of data that hasn't reached the server yet.

This is not a rebuild plan. The POS core (transactions, idempotency, receipt allocation, offline queueing) is already well designed. The findings below are about hardening the edges of a system that already gets the hard parts right.

---

## 2. Phase 1: Current State Analysis

### 2.1 What's good

- **Transactions are correct.** `sale-service.js:240` (`createSale`) wraps the entire sale in `inTransaction()`. `db.js:4-17` performs real `BEGIN` / `COMMIT` / `ROLLBACK` with `client.release()` guaranteed in a `finally` block. There is no path that leaves a partial write committed.
- **Pessimistic locking is used correctly where it matters.** `FOR UPDATE OF pv` on the product variants being sold (`sale-service.js:290`), `FOR UPDATE` on the shift (`sale-service.js:271`) and the register (`db.js:35`), and `FOR UPDATE` on the receipt-number block (`sale-service.js:120`). Two cashiers racing for the last unit of stock will correctly serialize at the database row lock: the second transaction blocks until the first commits, re-reads the now-updated stock, and fails cleanly with `INSUFFICIENT_STOCK`.
- **Idempotency is real, not decorative.** A unique `idempotency_key` per tenant is checked before any work happens (`sale-service.js:241`), and on a repeat request it returns the *existing* sale result rather than erroring — exactly the behavior needed for safely retried offline syncs.
- **Receipt numbering is belt-and-suspenders.** Pre-allocated number ranges per register, `FOR UPDATE` at claim time (`sale-service.js:115-131`), plus a database-level `EXCLUDE ... USING gist` constraint (`016_pos_operations.sql:14-20`) that makes overlapping ranges structurally impossible, not just application-enforced.
- **Offline vs. online logic is explicit, not bolted on.** The `offline` flag branches the stock-deduction SQL between a hard `>= quantity` guard (online) and `GREATEST(stock_quantity - qty, 0)` (offline), and produces `pos_sync_conflicts` rows instead of silently corrupting stock counts.

### 2.2 What's dangerous or weak

1. **Lock-holding window is too large.** The `FOR UPDATE OF pv` lock taken at `sale-service.js:290` is held through customer lookup, receipt claim, order insert, payment insert, per-line-item inserts, a `pos_events` insert per line, product-total rollup, and customer LTV update — roughly 15+ sequential round-trips before `COMMIT` releases the lock. Under real concurrent load on a popular SKU (multiple registers ringing up the same bestseller during a rush), transactions queue behind each other for the *entire chain*, not just the stock check. This is a throughput risk, not a correctness bug.
2. **`pos_events` writes happen inside the hot, lock-holding transaction.** `sale-service.js:471-475` inserts a `stock.updated` event per line item, in the same transaction as the stock update, extending lock duration for what is essentially fire-and-forget telemetry for SSE fan-out to other registers.
3. **No visible lock timeout.** Without an explicit `lock_timeout`, a stuck or slow transaction (a hung connection, a slow customer/audit query) can block every other register selling the same SKU indefinitely rather than failing fast.
4. **Offline sales trusted the client's price on conflict.** `sale-service.js:329` previously did `unitPriceCents = offline ? item.unitPriceCents : catalogPriceCents` — meaning a stale offline register could charge whatever price it had cached, with the mismatch only *logged*, not corrected. This is a revenue-integrity gap, not a race condition, but it's the offline analogue of one: stale client state was allowed to win.
5. **The offline queue's only durability is the browser's IndexedDB.** `pos-local-store.service.ts` (`elite-pos` database, `pending-sales` store) is the sole record of an unsynced sale until sync succeeds. If the tab is killed, the browser evicts storage under disk pressure, the OS crashes, or a user clears site data, the sale is gone with no trace anywhere — not even a partial record that it happened. This is the single biggest point of failure in the offline story.
6. **No enforced conflict-review workflow.** `pos_sync_conflicts` rows are created (`sale-service.js:480-501`) but nothing in the current code path surfaces them for a manager to act on. A logged conflict that nobody looks at is a silent write-off.
7. **Sync batches process sequentially with no per-register serialization guarantee** beyond array order in `sync-service.js`. Not a currently observed bug, but worth keeping in mind if multi-device sync per shift is ever allowed.

---

## 3. Phase 2, Chunk 1: Database Locking & Concurrency Hardening

### Step 1.1 — Shrink the lock-holding window on `product_variants`

**The Problem:** The variant row lock is acquired early and held through the entire sale — customer lookup, receipt claim, order/payment inserts, item inserts, the `pos_events` insert, product-total rollup, and the customer LTV update. Every one of those round-trips extends how long every other register selling that SKU has to wait.

**Why It's Needed:** Correctness is already solved. The remaining risk is throughput: with 3+ registers ringing up the same bestseller during a rush, checkout latency compounds because everyone queues behind the same lock for far longer than the actual stock check requires.

**How to Implement It:**
- Reorder `createSale` so cheap, non-locking validation (does the customer exist, is the receipt block available, does payment math check out) happens *before* the variant `FOR UPDATE` is acquired.
- Take the variant lock as late as possible, do the price/stock validation and the `UPDATE ... RETURNING` immediately, then move slower/variable-latency work (customer LTV update, order timeline entry, audit log) to *after* the stock write, still inside the same transaction (atomicity is still required) but no longer gating on it being fast.
- Move the `pos_events` insert out of the locked path entirely — see Step 1.3.

### Step 1.2 — Add a bounded lock timeout for variant locks

**The Problem:** There is no explicit `lock_timeout`. A slow or hung transaction (a stalled connection, a laptop that freezes mid-sale with the DB connection still open) can block every other register on that SKU indefinitely.

**Why It's Needed:** A POS cannot let one register's stall freeze checkout for the whole store. A fast, predictable failure ("try again") is strictly better than an indefinite hang.

**How to Implement It:**

```sql
-- first statement inside inTransaction(), right after BEGIN
SET LOCAL lock_timeout = '3s';
```

Add this to `inTransaction()` in `db.js` immediately after `BEGIN`. A lock that can't be acquired in time raises Postgres error code `55P03`, which should be mapped in `mapDatabaseError` (`db.js:19`) to a retryable 409:

```javascript
if (error?.code === '55P03') {
  return new PosError(409, 'LOCK_TIMEOUT', 'Another sale is updating this item. Please retry.');
}
```

The frontend can auto-retry once on `LOCK_TIMEOUT` or surface "another sale in progress, retry" to the cashier.

### Step 1.3 — Move `pos_events` writes out of the critical transaction

**The Problem:** `sale-service.js:471-475` writes a `stock.updated` event per line item inside the same transaction holding the variant lock, for data that exists to notify other registers via SSE — it doesn't need to share atomicity with the sale itself.

**Why It's Needed:** Every extra write inside the critical section directly extends the lock-duration problem from Step 1.1. This table also has no clearly reliable pruning strategy (currently described elsewhere as "pruned on connect" in `pos.route.js`, which is not a dependable trigger for an unbounded, ever-growing table).

**How to Implement It:**
- After the sale's `COMMIT` succeeds, fire the `pos_events` insert (or the SSE push directly, bypassing Postgres if durability isn't required beyond the live session) outside the original transaction — either in its own small transaction, or via `NOTIFY`/`LISTEN`.
- Replace the "prune on connect" trigger with a real scheduled job (`pg_cron` or an external cron) running `DELETE FROM pos_events WHERE created_at < now() - interval '2 days'` on a fixed schedule, independent of route traffic.

### Step 1.4 — Offline price trust: server price always wins

**Decision made:** flagged conflicts auto-accept using the server's current price/stock at sync time, with a conflict record created for a manager to review later (rather than gating the sale behind manager PIN reconciliation, or a hybrid threshold).

**The Problem:** `sale-service.js:329` charged the customer at the *offline client's* cached price when it differed from the server's current price, only logging the mismatch. A register offline for hours during a price change should never be the source of truth for what the customer is actually billed.

**How to Implement It:**

```javascript
// sale-service.js line 329 — was:
const unitPriceCents = offline ? item.unitPriceCents : catalogPriceCents;
// now:
const unitPriceCents = catalogPriceCents; // server price always wins, online or offline
```

The existing `pendingConflicts.push({ type: 'price_changed', expectedValue, actualValue, ... })` block (`sale-service.js:321-327`) is unchanged — it already records what the client thought vs. what the server charged, which is the audit trail a manager needs. Online behavior is unchanged: a price mismatch is still a hard reject there (`assertPos(offline, ...)` at line 317), since a live POS session showing stale pricing should be rare and rejecting is the safer default when the register is actually connected.

---

## 4. Phase 2, Chunk 2: Offline-First Resilience Hardening

### Step 2.1 — Ship the Step 1.4 fix (server price always wins for offline sales)

Covered above; listed here too since it is as much an offline-resilience fix as a locking fix — it's the point where "offline queue reconciles" and "revenue integrity" intersect.

### Step 2.2 — Reduce the exposure window on the IndexedDB-only offline queue

**The Problem:** The entire unsynced sale lives only in the browser's IndexedDB (`elite-pos` → `pending-sales`) until sync succeeds. Tab closure, storage eviction under disk pressure, an OS crash, or a cleared site data event destroys the sale with no trace anywhere else.

**Why It's Needed:** This is the single point of failure in the offline story. Every other safeguard (locking, idempotency, conflict resolution) assumes the sale eventually reaches the server. If local storage is wiped first, there is nothing left to reconcile — inventory looks fine, but real revenue is gone with no way to even prove the sale happened beyond a printed paper receipt.

**How to Implement It (mitigate exposure, since full elimination requires a local server process which is out of scope for a browser POS):**
1. **Background auto-sync loop.** Attempt sync every 15–30 seconds while `navigator.onLine`, rather than relying solely on the browser's `online` event (which is unreliable). This minimizes how long any sale sits unsynced.
2. **Visible pending-sales indicator.** Surface "N sales pending, oldest queued X min ago" in the POS UI so cashiers and managers see risk accumulating instead of it being invisible.
3. **Best-effort heartbeat on queue write.** On every `queueOfflineSale`, send a `navigator.sendBeacon` ping to the server recording just the idempotency key, receipt number, and register — no full payload required. Even this bare record gives forensic evidence to reconcile against a physical cash count during Z-report close, if the full sale is ever lost locally.
4. **Longer-term, hardware-dependent option (not built yet):** if registers are fixed terminals with persistent local disks rather than arbitrary browser tabs, evaluate a local write-ahead file via the File System Access API instead of relying purely on IndexedDB's eviction-prone quota model. Flagged for future consideration only — don't build until there's an actual observed data-loss incident to justify it.

### Step 2.3 — Confirm receipt-number/queue rejection handling stays audit-safe

**The Problem:** `pos-local-store.service.ts:111-131` correctly performs the receipt-block increment and the queued-sale write inside a single IndexedDB transaction, so those two are atomic relative to each other. The open question is what happens to a receipt number whose queued sale is later rejected at sync time (e.g., `INVALID_RECEIPT_NUMBER` from `sync-service.js:46`).

**Why It's Needed:** Receipt numbers are audit-significant (expected to be sequential, gapless-ish for tax/accounting purposes). Silently reclaiming or reusing a rejected sale's number would create ambiguity; silently losing track of it would create unexplained gaps.

**How to Implement It:**
- Do **not** reclaim a rejected sale's receipt number for reuse — treat it like a voided receipt, which already "used" the number for audit purposes.
- If a rejected offline sale is manually re-attempted, it must go through with a **new** idempotency key and a **new** receipt number, never reusing the rejected one, to avoid duplicate physical receipts referencing the same content.
- No code change required here beyond verifying this is the actual behavior end-to-end; this step is a confirmation/test-coverage item, not a new feature.

### Step 2.4 — Give conflicts an actual review workflow

**The Problem:** `pos_sync_conflicts` rows are created but nothing currently surfaces them for action. "Auto-accept and flag for review" (the chosen policy) only works if review actually happens.

**Why It's Needed:** Otherwise the conflicts table quietly becomes a place where revenue drift and stock discrepancies are recorded but never seen, which defeats the purpose of flagging them at all.

**How to Implement It:**
- Add a manager-facing endpoint, e.g. `GET /api/pos/sync-conflicts?status=open`, scoped to tenant, joined to the originating transaction/receipt for context.
- Add `resolved_at` / `resolved_by` columns to `pos_sync_conflicts`.
- Surface open conflicts during shift close (`shift-service.js`) so a manager sees "N unresolved pricing/stock conflicts from today" before finalizing the Z report, even if it doesn't hard-block the close.

---

## 5. Summary: concrete changes, ready to implement

| # | Change | File(s) | Ambiguity remaining |
|---|--------|---------|----------------------|
| 1.1 | Reorder `createSale` so cheap validation runs before the variant lock, and slow post-stock-write work (LTV, timeline, audit) happens after the stock `UPDATE` | `server/lib/pos/sale-service.js` | None |
| 1.2 | `SET LOCAL lock_timeout = '3s'` + map `55P03` to retryable `LOCK_TIMEOUT` 409 | `server/lib/pos/db.js` | None |
| 1.3 | Move `pos_events` insert out of the locked transaction; replace "prune on connect" with a scheduled job | `server/lib/pos/sale-service.js`, `server/routes/pos.route.js` | None |
| 1.4 / 2.1 | Offline sales always charge server's current price; conflict still logged | `server/lib/pos/sale-service.js:329` | None — decided: auto-accept + flag |
| 2.2 | Background auto-sync loop (15-30s), pending-sales UI banner, best-effort `sendBeacon` heartbeat on queue write | `pos-local-store.service.ts`, `pos.component.ts`, `pos.service.ts` | None for auto-sync/banner; heartbeat endpoint needs a lightweight new server route |
| 2.3 | Verify rejected receipt numbers are never reused; add test coverage | `pos-local-store.service.ts`, integration tests | None — confirmation, not new logic |
| 2.4 | New conflict-review endpoint + shift-close surfacing | new route in `pos.route.js`, `pos_sync_conflicts` schema addition, `shift-service.js` | Needs a small migration for `resolved_at`/`resolved_by` |

## 6. Not yet detailed (future chunks)

These were named in the original review scope but intentionally left unexpanded until Chunks 1 and 2 are implemented and validated:

- **Hardware & error handling:** printer/scanner disconnect handling, corrupted local data recovery, logging/fallback conventions beyond what's already in the [hardware runbook](./pos-hardware-runbook.md).
- **Full conflict-resolution UX:** beyond the read-only review endpoint in Step 2.4 — actual in-app workflows for a manager to annotate or dispute a conflict.
- **Multi-device-per-shift sync ordering:** only relevant if hardware/process changes ever allow more than one device to sync against the same shift concurrently.
