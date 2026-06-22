# Elite POS Integration Implementation Plan

## 1. Goal

Elite POS will be implemented as a cashier module inside Elite, not as a separate disconnected system. Elite remains the source of truth for products, variants, inventory, customers, users, permissions, transactions, refunds, reports, and audit history.

The POS interface will run at `/pos` and will use the same Elite backend and database. The cashier screen should feel fast and local, but all completed business events must eventually be recorded in Elite.

The existing [POS System Acceptance Criteria](./pos-system-plan.html) describes the full product target, including features deferred beyond v1. It is not the v1 release gate. Section 17 of this document is the authoritative v1 acceptance gate. This document defines the implementation plan and integration rules.

**Scope constraints confirmed for v1:**
- Payment methods: cash and card only. Split payment is not in scope for v1.
- Discounts: not in scope for v1.
- Receipt language: English only.
- Tax: no VAT is charged in v1. Tax rate and tax amount fields remain configurable and are set to zero; this is an implementation setting, not a permanent legal assumption.
- Receipt numbering: tenant-wide numbers are reserved by the server in blocks and cached per register so online and offline receipts remain unique.
- Printer bridge: QZ Tray installed on the Posiflex terminal.

## 2. System Roles

| Component | Responsibility |
| --- | --- |
| Elite backend | Owns business rules, API validation, inventory updates, transactions, reports, and audit logs. |
| Elite database | Stores products, variants, barcodes, customers, POS transactions, refunds, parked carts, shifts, Z reports, and manager PIN hashes. |
| POS browser interface | Touch-first cashier UI at `/pos`; handles search, cart, checkout, offline queue, and hardware actions. |
| Posiflex terminal | Physical cashier device running Chrome in kiosk mode. |
| QZ Tray | Desktop bridge installed on the Posiflex terminal. The browser connects to it over secure localhost WebSocket to issue ESC/POS commands to the Bixolon printer and trigger the cash drawer. It must run at system startup. |
| POS device signer | Small localhost signing helper provisioned per register. Its private key is non-exportable or stored in the OS credential/key store. It signs approved QZ Tray requests while Elite is offline; Angular never receives the key. |
| Barcode scanner | USB HID scanner that behaves like keyboard input; optional camera scanner for fallback. |
| Bixolon receipt printer | Prints receipts and Z reports using ESC/POS commands sent through QZ Tray. |
| Cash drawer | Opens through the Bixolon printer RJ12 kick port, triggered via QZ Tray. |
| Payment terminal | Handles card payments externally for v1, with cashier confirming payment in POS. |

> **Arch note — Pre-implementation QZ Tray spike:** Before Phase 1, validate QZ Tray and the device signer on the exact Posiflex OS and Bixolon printer. Confirm startup behavior, localhost certificates, Chrome Local Network Access permission, online and offline message signing, ESC/POS printing, and cash-drawer triggering. Receipt rendering contracts must not be finalized until this spike passes.

## 3. Data Flow Overview

Elite sends operational data to POS:

```text
Elite DB -> Elite API -> POS /pos
products, variants, barcodes, prices, stock, customers, users, permissions, shift state
```

POS sends business events back to Elite:

```text
POS /pos -> Elite API -> Elite DB
sales, payments, refunds, voids, parked carts, Z reports, manager approvals, audit events
```

Live updates are pushed back to other POS terminals:

```text
Register A sale -> Elite API commits stock change -> SSE event -> Register B refreshes affected stock
```

Offline sales are queued locally first:

```text
POS offline -> IndexedDB queue -> reconnect -> sync endpoint -> Elite validates and commits
```

## 4. Core Architecture

| Area | Implementation |
| --- | --- |
| Normal reads/writes | REST APIs under `/api/pos/*`. |
| Live updates | Native `EventSource` over same-origin SSE. It uses Elite's existing secure session cookie. Each server event includes an `id:` field; the browser automatically sends `Last-Event-ID` when reconnecting so the server can replay missed events or request a full refresh. |
| Offline storage | IndexedDB queue for pending transactions and parked local state. |
| Offline app shell / PWA | The POS is built as a Progressive Web App. A service worker caches `/pos`, static assets, and last-known product data. A `manifest.json` makes it installable on the Posiflex as a standalone app (no browser chrome), which is the preferred kiosk deployment mode. If Chrome kiosk mode is already in use, the PWA install is additive and does not conflict. |
| Printing and drawer | QZ Tray secure WebSocket bridge on localhost. A shared deterministic receipt renderer converts canonical `receiptData` into ESC/POS bytes. Online requests use the Elite signing endpoint; offline requests use the provisioned POS device signer. Neither private key reaches Angular. |
| Idempotency | Client-generated idempotency keys for every sale, refund, void, sync attempt, and Z report. |
| Money | Integer minor units only. All API and database monetary fields use a `_cents` suffix; floating-point currency values are prohibited. |

For v1, keep all business rules on the backend. The frontend can calculate totals for speed, but the backend must recalculate and validate before saving.

> **Arch note — SSE vs WebSocket:** Use SSE (server-sent events) for the live update channel. SSE is simpler to implement, works over standard HTTP, and is sufficient for one-directional server-to-client push. The POS already uses REST for client-to-server communication. A full WebSocket upgrade is not needed for v1.

> **Arch note — Scalability:** The backend remains stateless behind a load balancer. SSE can later use Redis pub/sub without changing the event schema. Every POS table includes `tenant_id`. V1 uses one inventory location per tenant; multi-branch inventory is explicitly deferred and will require a location-level inventory model. Canonical `receiptData` keeps receipt content independent from QZ Tray so another print bridge can be added later.

## 5. Database Plan

Required POS data model:

| Table / Field | Purpose |
| --- | --- |
| `pos_registers` | One row per physical register. Stores server-generated ID, hashed device credential, status, display name, device signing certificate fingerprint/status, and last-seen timestamp. |
| `pos_register_enrollment_tokens` | Hashed, tenant-scoped, single-use enrollment tokens with creator, expiry, consumed time, and resulting register ID. |
| `pos_shifts` | One row per shift per register. Stores cashier, register, `opening_float_cents`, open/close times, Z report link, and state (`open` / `closing` / `closed`). |
| `pos_transactions` | POS sale record linked one-to-one to `orders` through `order_id`. Stores payment breakdown, cashier, shift, register, receipt number, idempotency key, void status/reason, and POS audit metadata. Refunds are not stored here. |
| `pos_transaction_items` | Immutable sold-item snapshot linked to the matching `order_items` row. Stores product, variant, SKU, barcode, positive quantity, `unit_price_cents`, `tax_rate`, `tax_amount_cents`, and `line_total_cents`. |
| `pos_refunds` | Positive credit record linked to the original `pos_transactions`, `orders`, and `payments` rows. Stores current shift/register, manager approval, refund receipt number, method, positive `amount_cents`, status, reason, and idempotency key. It does not create a negative order. |
| `pos_refund_items` | Positive refund quantities and amounts linked to original `pos_transaction_items`; stores `quantity`, `refund_amount_cents`, and whether physical stock was restored. |
| `payment_refunds` | Positive payment-credit record linked to the original `payments` row and `pos_refunds` row. Stores method/provider reference, positive `amount_cents`, status, and processed time. Supports multiple partial refunds without inserting a negative payment. |
| `pos_z_reports` | Immutable end-of-day report records. All monetary columns use `_cents`, including opening float, expected cash, physical cash, variance, cash/card/refund totals, voided-cash total, and net sales. |
| `pos_parked_carts` | Stores parked carts by tenant, register, cashier, and cart payload. No discount fields in v1. |
| `pos_sync_conflicts` | Records accepted offline sales whose captured price or stock no longer matches current server state. Stores conflict type, affected variant, shortage/difference, manager resolution, and audit timestamps. |
| `product_variants.barcode` | Already exists in Elite. Add a unique partial index per tenant when the barcode is present. Do not recreate the column. |
| `admin_users.pos_pin_hash` | bcrypt hash for manager PIN. Plain text PIN must never be stored. |
| `audit_events` | Already exists in Elite. Reuse it for manager overrides, voids, refunds, Z reports, shift changes, register enrollment, security failures, and other POS actions. |
| `pos_receipt_number_blocks` | Server-reserved tenant receipt ranges assigned to one register. Tracks range start/end, next number, allocation time, and exhaustion. Numbers are globally unique per tenant; unused reserved numbers may create acceptable gaps but are never reassigned. |

> **Arch note — Elite integration:** A completed POS sale creates `orders`, `order_items`, `payments`, `pos_transactions`, and `pos_transaction_items` in one database transaction. The order uses `metadata.source = 'pos'`, zero shipping, paid status, and completed/fulfilled store-pickup semantics. A refund creates positive `pos_refunds`, `pos_refund_items`, and `payment_refunds` records linked to the original sale; it updates the original order's payment status to `partially_refunded` or `refunded` and adds an order timeline entry. A void updates the original order/payment and sale record without creating a new order. No negative `orders`, `order_items`, or `payments` rows are created.

> **Arch note — CRM and LTV:** Migrate `v_customer_order_stats` so LTV equals paid original order totals minus completed `payment_refunds`, clamped at zero. Order count continues to count original orders only. Keep the denormalized customer LTV/order counters synchronized in the same sale/refund/void transaction for the existing fallback path.

> **Arch note — Inventory source of truth:** POS sells variants only. `product_variants.stock_quantity` is authoritative. `products.stock_quantity` is treated as a derived aggregate and updated in the same transaction or replaced by a database view. Products without a variant must receive a default variant before they can be sold through POS.

> **Arch note — Tax fields:** `tax_rate` and `tax_amount_cents` are included from the start and configured as zero in v1. The backend sets them explicitly. Future tax behavior must be enabled through reviewed configuration and compliance requirements.

> **Arch note — Shift state machine:** The shift lifecycle is `open → closing → closed`. The `closing` state is set in the same database transaction as Z report creation. If the Z report fails, the shift rolls back to `open`. This prevents two concurrent Z report requests from both succeeding on the same register.

Migration rules:

- Run all migrations in staging before production.
- Add a rollback script for every POS migration.
- Validate that products, orders, customers, and existing admin flows still work after migration.
- Use non-destructive migrations where possible.
- Add indexes for barcode lookup, transaction lookup by receipt number, customer lookup, shift summaries, idempotency keys, and register ID.
- Use database constraints to prevent duplicate idempotency keys per tenant and register action.
- Add a unique constraint on `(tenant_id, receipt_number)` and exclusion/uniqueness rules preventing overlapping receipt-number blocks.
- Use `bigint` integer cents for POS totals and payment amounts, matching Elite's existing money convention.
- Require positive refund quantities and amounts; enforce cumulative refunded quantity/amount no greater than the original sold line/payment.

## 6. API Contracts

The exact payloads can evolve during implementation, but these contracts define the first integration surface.

### `POST /api/pos/registers/enroll`

Purpose: enroll a terminal using a one-time token created by an authorized Elite administrator.

Request:

```json
{
  "enrollmentToken": "one-time-secret",
  "deviceLabel": "Front Counter"
}
```

Response:

```json
{
  "registerId": "uuid",
  "displayName": "string",
  "registerCredential": "opaque-secret"
}
```

Rules:

- The server creates the register ID; the browser cannot choose it.
- The enrollment token is single-use, short-lived, tenant-scoped, and stored only as a hash.
- The returned register credential is stored in IndexedDB or protected device configuration, never `localStorage`.
- Re-enrollment after browser/device reset requires a new admin-generated token.
- Administrators can disable or revoke a register without disabling the cashier account.
- All enrollment, revocation, and failed enrollment attempts are audited.

---

### `POST /api/pos/registers/check-in`

Purpose: authenticate an enrolled register after startup and retrieve its current state.

Request:

```json
{
  "registerId": "uuid",
  "registerCredential": "opaque-secret"
}
```

Response:

```json
{
  "registerId": "uuid",
  "displayName": "Front Counter",
  "currentShiftId": "uuid|null",
  "currentShiftState": "open|closed|null",
  "receiptNumbersRemaining": 84
}
```

Rules:

- The cashier authenticates first via the existing Elite admin auth, which establishes the secure Elite session cookie. Register check-in then binds the authenticated register to that same session.
- Compare only the stored credential hash.
- Reject disabled, revoked, unknown, or mismatched registers.
- Update `last_seen_at` only after successful authentication.
- Bind the authenticated register ID to the cashier's server session; all later POS requests reject a different request-body/query register ID.
- Cashier identity is always derived from the authenticated server session. POS APIs do not accept `cashierId` in request bodies or query parameters.

---

### `POST /api/pos/registers/:id/receipt-number-blocks`

Purpose: reserve the next tenant-wide block of receipt numbers for online and offline sales.

Response:

```json
{
  "blockId": "uuid",
  "start": 1000,
  "end": 1099,
  "next": 1000
}
```

Rules:

- Allocate blocks atomically from the tenant sequence; default block size is 100.
- Only the authenticated enrolled register can request its block.
- Cache the active block in IndexedDB and consume one number for every attempted completed sale.
- A used or abandoned number is never reassigned; gaps are acceptable and auditable.
- If the register is offline and has no reserved numbers left, checkout is blocked until connectivity returns.

---

### `POST /api/pos/shift/open`

Purpose: open a new shift for a register and record the opening cash float.

Request:

```json
{
  "registerId": "uuid",
  "openingFloatCents": 50000
}
```

Response:

```json
{
  "shiftId": "uuid",
  "openedAt": "2026-06-18T08:00:00Z"
}
```

Rules:

- A register cannot open a new shift if it already has an `open` shift.
- Manager approval is not required to open a shift, but the event is audited.
- `openingFloatCents` is the physical cash counted and confirmed before trading starts.

---

### `GET /api/pos/products/search`

Purpose: search products and variants for POS.

Query:

```json
{
  "q": "string",
  "limit": 50,
  "includeOutOfStock": false
}
```

Response:

```json
{
  "products": [
    {
      "productId": "uuid",
      "variantId": "uuid",
      "name": "string",
      "sku": "string",
      "barcode": "string",
      "priceCents": 10000,
      "stock": 5,
      "imageUrl": "string",
      "isActive": true
    }
  ],
  "serverTimestamp": "2026-06-18T10:00:00Z"
}
```

Rules:

- Only active, sellable variants appear by default.
- Search must support name, SKU, and barcode.
- `serverTimestamp` lets the POS know when cached data was last refreshed.

---

### `GET /api/pos/products/barcode/:barcode`

Purpose: resolve one scanned barcode to one variant.

Rules:

- Return exactly one variant or a clear `404` not found error.
- Duplicate barcode data must be prevented by database constraint.
- Include current stock and `priceCents`.

---

### `POST /api/pos/transactions`

Purpose: create one online POS sale.

Request:

```json
{
  "idempotencyKey": "uuid",
  "receiptNumber": 1000,
  "registerId": "uuid",
  "shiftId": "uuid",
  "customerId": "uuid|null",
  "items": [
    {
      "variantId": "uuid",
      "quantity": 1,
      "unitPriceCents": 10000
    }
  ],
  "payment": {
    "method": "cash|card",
    "cashAmountCents": 10000,
    "cardAmountCents": 0,
    "amountTenderedCents": 10000,
    "changeGivenCents": 0
  },
  "managerOverrideId": "uuid|null"
}
```

> **Removed from v1:** `discountAmount` per item, `orderDiscountAmount`, and split payment are not in scope.

Response:

```json
{
  "transactionId": "uuid",
  "orderId": "uuid",
  "receiptNumber": "string",
  "receipt": {
    "receiptData": {},
    "qrCodeValue": "string"
  },
  "stockUpdates": [
    {
      "variantId": "uuid",
      "stock": 4
    }
  ]
}
```

Rules:

- Backend loads authoritative variant prices and recalculates line totals from `quantity × unitPriceCents`; it rejects stale/tampered prices.
- Backend creates the Elite order/payment records, POS records, and inventory changes in one database transaction.
- If stock is insufficient, reject the sale and return the affected variant IDs.
- Duplicate `idempotencyKey` must return the original saved transaction, not create a second sale.
- For cash payments: `cashAmountCents` equals the sale total. `changeGivenCents = amountTenderedCents - totalCents`. Backend validates all values.
- For card payments: `cardAmountCents` equals `totalCents`. Tendered/change fields are zero.
- `shiftId` must reference an open shift for this register.
- `receiptNumber` must belong to an unused reserved block assigned to this register and is consumed atomically with the sale.
- `receiptData` is canonical structured content. The shared client renderer creates the ESC/POS job locally.

---

### `POST /api/pos/transactions/sync`

Purpose: upload queued offline sales.

Request:

```json
{
  "registerId": "uuid",
  "transactions": [
    {
      "idempotencyKey": "uuid",
      "receiptNumber": 1001,
      "clientCreatedAt": "2026-06-17T10:00:00Z",
      "payload": {}
    }
  ]
}
```

> **Arch note — Timestamps:** The backend records `clientCreatedAt` as provided by the device and stamps `server_received_at` at sync. The sale remains assigned to its supplied open `shiftId`; Z report closure is blocked until every sale for that shift is synced and resolved. `server_received_at` is the authoritative posting timestamp, while `clientCreatedAt` is retained for receipt display and audit.

Response:

```json
{
  "accepted": ["uuid"],
  "acceptedWithConflicts": [
    {
      "idempotencyKey": "uuid",
      "conflictId": "uuid",
      "reason": "INSUFFICIENT_STOCK|PRICE_CHANGED"
    }
  ],
  "rejected": [
    {
      "idempotencyKey": "uuid",
      "reason": "INVALID_PAYLOAD|INVALID_RECEIPT_NUMBER|UNAUTHORIZED_REGISTER",
      "message": "string"
    }
  ]
}
```

Rules:

- Sync must be idempotent.
- Accepted sales are removed from the local queue only after the response is durably recorded locally.
- A completed offline sale that was tendered and receipted is financially accepted even when stock or price changed. It is returned as `acceptedWithConflicts` and creates a manager reconciliation record.
- For insufficient stock, variant stock is reduced no lower than zero and the unfulfilled shortage quantity is stored in `pos_sync_conflicts`; the manager must reconcile physical stock later.
- For changed price, the captured receipt price remains authoritative for that completed sale and the difference is audited.
- Rejection is reserved for corrupt/invalid payloads, invalid receipt reservations, or unauthorized register identity. Rejected items remain visible and block shift closure until resolved.
- Backend must never silently modify an offline sale to make it fit.
- The backend verifies that every uploaded receipt number belongs to the syncing register's reserved block.

---

### `GET /api/pos/transactions/:id`

Purpose: load a transaction for receipt reprint, refund, void, or audit review.

Response must include:

- Original line items.
- Payment breakdown (cash or card).
- Customer and cashier details.
- All refunds already applied.
- Per-line `refundableQty` (original quantity minus the sum of all prior refund quantities for that line).
- Void status and void reason if voided.

Rules:

- Must enforce tenant and permission boundaries.
- Any authenticated POS role may reprint a receipt. Void and refund actions require manager approval before they can be initiated.

---

### `POST /api/pos/transactions/:id/void`

Purpose: cancel a completed transaction that is still within the same open shift.

Request:

```json
{
  "idempotencyKey": "uuid",
  "registerId": "uuid",
  "managerOverrideId": "uuid",
  "voidReason": "string"
}
```

Response:

```json
{
  "voidId": "uuid",
  "transactionId": "uuid",
  "stockRestored": [
    {
      "variantId": "uuid",
      "stock": 5
    }
  ]
}
```

Rules:

- Manager approval is mandatory for void. No exceptions.
- Void is only allowed on transactions in the same open shift as the request.
- Void restores stock for all items in the original transaction.
- Voided transactions appear in X and Z reports as a separate void count with total voided value. They must not be counted in net sales.
- A transaction that has already been fully or partially refunded cannot be voided.
- `voidReason` is required and stored permanently on the record.
- Duplicate `idempotencyKey` must return the original void record, not create a second void.

---

### `POST /api/pos/refunds`

Purpose: create a full or partial refund.

Request:

```json
{
  "idempotencyKey": "uuid",
  "receiptNumber": 1002,
  "registerId": "uuid",
  "shiftId": "uuid",
  "managerOverrideId": "uuid",
  "originalTransactionId": "uuid",
  "lines": [
    {
      "transactionItemId": "uuid",
      "quantity": 1,
      "restock": true
    }
  ],
  "refundMethod": "cash|card",
  "reason": "string"
}
```

Response:

```json
{
  "refundId": "uuid",
  "refundReceiptNumber": "001002",
  "amountCents": 10000,
  "orderPaymentStatus": "partially_refunded|refunded",
  "receipt": {
    "receiptData": {},
    "qrCodeValue": "string"
  },
  "stockUpdates": [
    {
      "variantId": "uuid",
      "stock": 5
    }
  ]
}
```

Rules:

- Requires manager approval for cashier role.
- Create positive `pos_refunds`, `pos_refund_items`, and `payment_refunds` records linked to the original sale/order/payment; do not create a negative order or payment.
- All refund quantities and amounts are positive integer values. Reports apply them as deductions based on record type, not negative storage.
- Stock is restored only when physical items are returned.
- Partial refund cannot exceed `refundableQty` per line.
- Cumulative completed refunds cannot exceed the original payment amount.
- The refund amount is calculated from the original captured sale prices, not current catalog prices.
- Update the original order's `payment_status` to `partially_refunded` or `refunded` and add an order timeline entry in the same database transaction.
- Refunds appear as deductions in X and Z reports.
- Duplicate `idempotencyKey` must not create a duplicate refund.
- Completed `payment_refunds` reduce customer LTV through the updated aggregate view and synchronized fallback counters.
- Cash refunds reduce expected cash for the current refund shift. Card refunds do not change the cash drawer.
- `receiptNumber` must belong to the current register's reserved block and is used for the refund receipt.

---

### `GET /api/pos/customers/search`

Purpose: find customers by phone number during checkout.

Rules:

- Search by normalized phone number.
- Return minimal customer details needed for cashier selection.
- Response must be fast and safe for repeated typing.

---

### `GET /api/pos/shift/summary`

Purpose: X report — mid-shift read-only summary.

Rules:

- Read-only. Running multiple times must not reset counters.
- Totals must include: opening float, gross sales, refunds, voids, cash collected, card collected, and net sales.

---

### `POST /api/pos/shift/z-report`

Purpose: close the shift and create an immutable Z report.

Request:

```json
{
  "idempotencyKey": "uuid",
  "registerId": "uuid",
  "shiftId": "uuid",
  "managerOverrideId": "uuid",
  "physicalCashCents": 65000
}
```

Rules:

- Requires manager approval.
- Must use an idempotency key.
- Atomically sets shift state to `closing`, creates the Z report row, then sets state to `closed`. On any failure the transaction rolls back and the shift returns to `open`.
- Must store a permanent, immutable report row.
- Must include: opening float, expected cash (float + cash sales − cash refunds − voided cash sales), physical cash entered, variance, cash totals, card totals, refund totals, voided-cash total, void count, transaction count, and net sales. A same-shift void of a cash sale returns physical cash to the customer, so its cash value must be removed from expected cash; the value of voided card sales does not affect the cash drawer.
- After Z report is closed, included transactions must not be counted in any new open shift report.
- Z report creation requires an online register, zero pending IndexedDB sales, and zero unresolved rejected sync entries for the shift.
- If another device reports pending work for the same register/shift, closure is rejected with `SHIFT_SYNC_INCOMPLETE`.

---

### `POST /api/pos/manager/verify-pin`

Purpose: verify manager PIN for restricted actions.

Rules:

- Never log plain PIN.
- Return an approval token scoped to one specific action type (`refund`, `void`, `z-report`, `drawer-open`, `sync-conflict-override`). The set of action types must stay in sync with the restricted actions listed in Section 13.
- Approval token must be short-lived (maximum 5 minutes).
- Failed attempts must be rate-limited and audited.
- After a configurable number of consecutive failures, temporarily lock PIN verification and log an alert.

---

### `GET /api/pos/print/certificate`

Purpose: provide the public QZ Tray signing certificate to the authenticated POS client.

Rules:

- Return only the public certificate expected by QZ Tray.
- Require an authenticated cashier session bound to an active enrolled register.
- Never return private signing key material.

### `POST /api/pos/print/sign`

Purpose: sign the exact QZ Tray request string supplied by the authenticated POS client.

Rules:

- Require an authenticated cashier session bound to an active enrolled register.
- Sign only allowed QZ operations and configured printer/drawer targets.
- Apply request size limits and rate limiting.
- Keep the private key in server-side secret storage.
- Audit rejected signing attempts and sensitive drawer commands.
- When Elite is unreachable, the same allowlist and size rules are enforced by the provisioned POS device signer using a unique revocable register certificate.

## 7. Offline Sync Rules

Offline POS must support a limited but reliable checkout mode.

Cached locally:

- POS app shell and static assets.
- Last-known active product/variant catalog.
- Last-known prices.
- Last-known stock values.
- Current cashier, register, and shift context.
- Pending sales queue.
- Active reserved receipt-number block.
- Canonical receipt template and renderer required for offline printing.

Offline sale rules:

- Every offline sale gets a client-generated idempotency key.
- Every offline sale consumes one number from the register's server-reserved block.
- POS stores the complete transaction payload in IndexedDB.
- POS shows the number of pending sales.
- POS warns if stock data is stale.
- Cash manual confirmation can be recorded offline. Card confirmation can also be recorded offline, but the cashier must be shown a warning that card payment cannot be verified without connectivity.
- POS creates canonical `receiptData` locally from the immutable cart/payment snapshot and can print through QZ Tray while Elite is unreachable.
- Checkout is blocked if the register has no unused reserved receipt numbers.
- Shift/Z-report closure is unavailable while offline or while pending/rejected sales exist.
- Voids and refunds are online-only in v1. They require manager PIN verification and atomic server-side order/payment/credit updates, so they are disabled while offline and become available again on reconnect.

Reconnect rules:

- POS attempts sync automatically after reconnection.
- Sync retries use exponential backoff.
- Accepted sales are removed from IndexedDB only after the response is durably recorded.
- Rejected sales require manager review.
- If stock or price changed, the backend accepts the completed financial sale with an explicit reconciliation conflict.
- The cashier and manager must see every conflict and its resolution status.

> **Arch note — Offline reporting:** A shift cannot close around unsynced work. Accepted offline sales remain assigned to their original open shift and are posted before the Z report is produced. `server_received_at` is the authoritative posting time; `clientCreatedAt` remains visible for audit and on the customer receipt.

## 8. Multi-Register Sync Rules

Live sync must keep terminals aligned without trusting the frontend as the source of truth.

Rules:

- The backend commits the sale and stock update first.
- After commit, the backend publishes a stock update SSE event.
- Other registers update affected variants within a target window of under 2 seconds from commit.
- If two terminals sell the last unit at the same time, only one database transaction may succeed. The failed terminal receives an insufficient stock response and must update its cart.
- Stale carts must display a clear warning when stock changes.

SSE endpoint:

```
GET /api/pos/events
```

Authentication: native same-origin `EventSource` using Elite's existing secure session cookie. The server derives the register from the cashier session established by register check-in; no register query parameter is accepted. Every event contains an `id:` line; on automatic reconnect the browser supplies `Last-Event-ID`. If the ID predates the replay buffer, the server emits `catalog.refresh-required` and the client performs a REST refresh.

Heartbeat: the server sends a comment (`: heartbeat`) every 30 seconds. If the client does not receive a heartbeat within 60 seconds, it must reconnect.

Suggested live events:

```json
{ "type": "stock.updated", "variantId": "uuid", "stock": 4, "sourceRegisterId": "uuid" }
```

```json
{ "type": "shift.closed", "shiftId": "uuid", "zReportId": "uuid" }
```

```json
{ "type": "transaction.voided", "transactionId": "uuid", "voidId": "uuid" }
```

```json
{ "type": "transaction.refunded", "transactionId": "uuid", "refundId": "uuid" }
```

## 9. Payment Flow

V1 payment methods: **cash and card only**. Split payment is not in scope for v1.

| Method | Behavior |
| --- | --- |
| Cash | POS calculates change from the tendered amount, records both, prints receipt, and opens the cash drawer. |
| Card | Cashier charges the customer on the external terminal, then taps `Confirm Paid` in POS. No drawer opens for card payments. |

Manual card confirmation rules:

- The POS must clearly show the total amount to enter on the external terminal.
- The cashier confirms only after the external terminal approves the payment.
- The transaction is saved after confirmation.
- If the cashier cancels, no transaction is saved.
- If printing fails after a card payment is confirmed, the transaction remains saved and the receipt can be retried.

Future payment integration:

- Sadad/QPay/NAPS integration is a later phase after the manual POS is stable.
- Real gateway integration will require authorization, capture, failure handling, timeout, webhook/callback, reconciliation, and reversal handling.
- Split payment can be considered at the same time as gateway integration.

## 10. Hardware Integration

Barcode scanner:

- USB HID scanner focuses the POS barcode input field or uses a global scan listener.
- Unknown barcode shows a clear error and does not change the cart.
- Camera scanner can use browser camera APIs as fallback.

Receipt printer (Bixolon 80mm via QZ Tray):

- The browser connects to QZ Tray via WebSocket at `wss://localhost:8181` (QZ Tray default port).
- Use QZ Tray's install-generated localhost certificate; do not create an unrelated browser self-signed certificate.
- Provision Chrome Local Network Access permission for the Elite origin during terminal setup and verify it after Chrome upgrades.
- The shared POS receipt renderer converts canonical `receiptData` to ESC/POS bytes locally, including while offline.
- While online, QZ Tray certificate/signature callbacks call the authenticated Elite signing endpoint.
- While offline, callbacks use the localhost POS device signer with a unique per-register certificate/key provisioned during setup. The key stays in the OS key store and can be revoked with the register.
- No signing private key is bundled into Angular, stored in IndexedDB, or returned by an Elite API.
- Print and drawer commands are signed. Production must not depend on QZ Tray's unsigned warning-dialog mode.
- Receipts are in English only.
- Browser print dialogs must not be used for checkout receipts.
- If QZ Tray is not reachable, the transaction still saves. The cashier can retry printing from the transaction lookup screen.

Cash drawer:

- Open through printer kick-port command sent via QZ Tray.
- Open only for cash transactions.
- Do not open for card-only sales.
- Log drawer open failures for troubleshooting.

Label printing:

- Generate Code 128 barcode labels for product variants.
- Label must include product name, variant, SKU/barcode, and price.
- Printed labels must scan back to the exact variant.
- Label printing can use QZ Tray or a separate label printer driver depending on the label printer model.

> **Arch note — QZ Tray setup spike:** Before Phase 1, run a spike on the exact Posiflex: install QZ Tray and the device signer, verify localhost certificates and Chrome Local Network Access, print and trigger the drawer using server-side signing, disconnect Elite, then repeat using device-local signing. Failure of either path blocks offline receipt scope.

## 11. Receipts, Refunds, And Reports

Receipt requirements (English only):

- Receipt number from the register's server-reserved tenant block, zero-padded for display.
- Date and time.
- Cashier name and register ID.
- Line items: product name, variant, SKU, quantity, unit price, line total.
- Grand total.
- Payment method (Cash or Card).
- For cash payments: amount tendered and change given.
- QR code or lookup code for refund.

> **Note — No discount lines in v1.** Receipts do not include any discount fields. If discounts are added in a later phase, the receipt format and `pos_transaction_items` schema must be extended at that time.

Refund rules:

- Full refund returns all refundable items and restores stock when items are physically returned.
- Partial refund allows selected items and quantities.
- Refunded quantity per line cannot exceed `refundableQty` (original quantity minus all prior refunds on that line).
- Refunds create positive credit records linked to the original sale, items, and payment. Report calculations subtract completed credits by record type.
- Refunds affect X and Z report totals.
- Refund receipts follow the same format as sale receipts with a clear `REFUND` header.

X report:

- Mid-shift report. Read-only.
- Can be run multiple times without resetting anything.
- Shows: opening float, gross sales, refunds, voids, cash collected, card collected, and net sales.

Z report:

- End-of-shift closure. Requires manager approval.
- Stores immutable report data.
- Prints a Z report receipt.
- Once closed, included transactions are locked from normal POS edits.
- Report includes: opening float, expected closing cash, physical cash counted, variance, and all X report totals.

## 12. Customer And CRM Integration

Customer lookup:

- Cashier can search by phone number.
- A POS sale can be linked to a customer at checkout.
- Linked POS sales appear in the customer order history in Elite CRM.

LTV rules:

- Customer LTV is based on net completed sales (cash and card combined).
- Refunds reduce customer LTV.
- Voided transactions do not increase LTV.

Customer history:

- POS transactions appear alongside online and admin orders where applicable.
- The UI clearly labels POS-originated transactions.

## 13. Security And Audit

Manager PIN:

- Store only bcrypt hash in `admin_users.pos_pin_hash`.
- Never store or log plain PIN.
- Apply retry limits; temporarily lock PIN verification after repeated consecutive failures.
- Allow authorized admins to reset PIN.
- Manager approval tokens are short-lived and scoped to one specific action type.

Restricted actions requiring manager PIN:

- Refund.
- Void.
- Z report.
- Manual cash drawer open (if supported).
- Offline sync conflict override (if supported).

> **Note — Discounts:** Discount approval is not a restricted action in v1 because discounts are not in scope.

Audit log must include:

- Tenant/store.
- Register ID.
- Cashier ID.
- Manager ID (when applicable).
- Action type.
- Target transaction, refund, void, or report ID.
- Timestamp.
- Result: success or failure.
- Failure reason where safe to log.
- Shift open and close events.

## 14. Testing And Sign-Off

Automated tests:

- API validation.
- Transaction total recalculation.
- Inventory decrement and restore.
- Idempotency for sales, refunds, voids, and Z reports.
- Insufficient stock race prevention (concurrent sales of the last unit).
- Manager PIN verification and lockout.
- Refund quantity limits (cannot exceed `refundableQty` per line).
- Void restricted to transactions within the same open shift.
- X and Z report totals including opening float, variance, and void count.
- Shift state machine transitions.
- Integer-cent validation; decimal/floating monetary payloads are rejected.
- Atomic creation of linked `orders`, `payments`, and POS records.
- Positive refund-credit constraints, cumulative refund limits, original order status updates, and LTV subtraction.
- Receipt-number block allocation, uniqueness, exhaustion, and replay prevention.
- Register enrollment token expiry, single use, revocation, and credential mismatch.
- Z report rejection while pending or unresolved offline sales exist.

Staging tests:

- Run migration and rollback.
- Load realistic product and customer data.
- Test product search performance with expected catalog size.
- Test customer lookup performance.
- Test offline sync with accepted and rejected transactions.
- Test offline receipt rendering (canonical `receiptData` → ESC/POS bytes) with a reserved receipt number; physical print delivery is covered by the QZ Tray hardware tests.
- Test Z report closure and shift state transition under concurrent requests.
- Test QZ Tray print job delivery on staging hardware.

Physical hardware tests:

- Posiflex terminal in Chrome kiosk mode.
- QZ Tray installed and confirmed running as a startup service.
- QZ Tray localhost certificate, message signing, and Chrome Local Network Access permission verified.
- Online server signing and disconnected device-local signing both print without warning dialogs; register revocation disables the local signing identity.
- USB barcode scanner.
- Bixolon receipt printer via QZ Tray.
- Cash drawer via RJ12 kick port triggered through QZ Tray.
- Label printer.
- English receipt output verified end-to-end.

Production rollout checklist:

- Backup database.
- Confirm rollback script.
- Run migration during approved window.
- Verify admin product/order/customer flows.
- Verify one test POS sale (cash and one card).
- Verify both sales create linked Elite order/payment and POS records.
- Verify receipt printing via QZ Tray.
- Verify cash drawer behavior.
- Verify X and Z reports.
- Monitor logs for sync, printer, and transaction errors.

## 15. Phased Implementation Roadmap

Each phase builds on the previous one. A phase is considered complete only when its automated tests pass and the feature can be demonstrated end-to-end. No phase skips are allowed — later phases depend on the correctness of earlier ones.

**Pre-implementation hardware gate:** complete the QZ Tray spike described in Section 10 before Phase 1. Do not finalize receipt or drawer contracts until the exact Posiflex/Bixolon path, signing, and browser permissions pass.

1. **DB and API foundation**

   Everything that follows depends on the data model being correct from the start. Get this right before any UI is built.

   - Add POS tables: `pos_registers`, `pos_register_enrollment_tokens`, `pos_shifts`, `pos_transactions`, `pos_transaction_items`, `pos_refunds`, `pos_refund_items`, `payment_refunds`, `pos_z_reports`, `pos_parked_carts`, `pos_receipt_number_blocks`, and `pos_sync_conflicts`.
   - Add `admin_users.pos_pin_hash`; reuse existing `audit_events` and existing `product_variants.barcode`.
   - Add the unique partial barcode index and tenant receipt-number allocator.
   - Add `tenant_id` on every new POS table.
   - Define and migrate the one-to-one POS transaction to Elite order linkage.
   - Migrate `v_customer_order_stats` and customer fallback counters to subtract completed positive refund credits.
   - Add all indexes, unique constraints (idempotency keys, barcodes, receipt numbers), and rollback scripts.
   - Add base API routes: register enrollment/check-in, receipt-number reservation, shift open, product search, barcode lookup, and manager PIN verify.
   - No frontend work in this phase.

2. **Register identity and shift management**

   Sales cannot be recorded without an open shift. This phase establishes the shift lifecycle before any transaction code is written.

   - Implement admin-issued register enrollment, register credential verification, revocation, and check-in.
   - Implement `POST /api/pos/shift/open` with opening float recording.
   - Implement shift state machine (`open → closing → closed`) at the database level.
   - Implement `GET /api/pos/shift/summary` (X report, read-only, no-op safe).
   - Implement `POST /api/pos/shift/z-report` with atomic state transition and immutable report creation.
   - Implement manager PIN verification with rate limiting and audit logging.
   - All shift and PIN logic must have automated tests before Phase 3 begins.

3. **POS core interface and sale creation**

   The first complete user-facing workflow: cashier opens a shift, builds a cart, takes payment, and gets canonical receipt data.

   - Build the `/pos` Angular module and routing.
   - Product search UI (text and barcode input), cart, and checkout flow.
   - Cash and card payment only. No discounts, no split.
   - Build the shared deterministic receipt renderer from canonical `receiptData`; it must work without a network connection.
   - Receipt language: English only.
   - Use integer `_cents` fields for all monetary values; backend rejects floating values and recalculates all totals.
   - Atomically create Elite order/payment records, POS records, and variant stock decrement.
   - End-to-end test: open shift → search product → checkout → verify linked Elite/POS records and stock decrement.

4. **Inventory integrity and live sync**

   With real sales happening, stock accuracy across terminals becomes critical.

   - Verify oversell prevention under concurrent load (two terminals, one unit).
   - Implement the SSE endpoint (`GET /api/pos/events`) with session auth, 30-second heartbeat, and `Last-Event-ID` reconnect support.
   - Publish `stock.updated` events after every committed sale.
   - POS frontend subscribes to SSE and updates cart quantities in real time.
   - Add `shift.closed`, `transaction.voided`, and `transaction.refunded` event publishing (consumed in later phases, emitted from now on).
   - If horizontal scaling is needed later: the SSE endpoint is backed by Redis pub/sub. The event schema defined here must not change when Redis is added.

5. **Offline resilience and PWA**

   The POS must survive connectivity loss without losing a sale.

   - Register a service worker that caches the `/pos` app shell, static assets, and last-known product catalog.
   - Add `manifest.json` so the POS is installable as a standalone PWA on the Posiflex (removes browser chrome, behaves like a native app).
   - Implement IndexedDB transaction queue for offline sales.
   - Implement `POST /api/pos/transactions/sync` with idempotency enforcement.
   - Cache and consume server-reserved receipt-number blocks; block offline checkout when exhausted.
   - Render offline receipts locally from canonical `receiptData` to ESC/POS bytes (no network). Physical printing through QZ Tray, online and offline, is wired up in Phase 6 — this phase verifies the renderer output only.
   - Record `clientCreatedAt` and `server_received_at` separately; retain shift assignment and use the server posting time as authoritative.
   - Show cashier-visible pending sale count and stale-stock warning.
   - Block Z report while offline or while any pending/rejected shift sale exists.
   - Test: go offline mid-session, complete two sales, reconnect, verify both sync correctly and stock is accurate.

6. **Hardware integration (QZ Tray)**

   Hardware integration is isolated in its own phase so a QZ Tray problem does not block core POS functionality.

   - Connect the browser to QZ Tray via `wss://localhost:8181`.
   - Configure the install-generated localhost certificate, Chrome Local Network Access permission, and authenticated signing callbacks.
   - Send locally rendered ESC/POS data to QZ Tray. Use the Elite-held signing key online and the separate per-register OS-protected key through the local device signer offline; neither key is exposed to Angular.
   - Provision, start, rotate, revoke, and health-check the device signer with the register lifecycle.
   - Trigger cash drawer via kick-port command through QZ Tray on cash sales only.
   - Integrate USB barcode scanner global listener and camera fallback.
   - Label printing (Code 128, product name, variant, SKU, price).
   - If printing fails, the transaction remains saved. The cashier retries from the transaction lookup screen.

7. **Voids, refunds, and CRM**

   Post-sale correction flows. These depend on Phase 6 (reprint receipts) and Phase 2 (manager PIN) being complete.

   - Implement `POST /api/pos/transactions/:id/void` with manager approval, same-shift restriction, stock restoration, and audit event.
   - Implement full and partial refunds as positive `pos_refunds`, `pos_refund_items`, and `payment_refunds` credits with cumulative quantity/amount enforcement.
   - Update the original order payment status/timeline and subtract completed refund credits from CRM LTV without creating negative orders or payments.
   - Customer phone-number search and attachment to POS sales.
   - Linked POS sales appear in Elite CRM order history, clearly labelled as POS-originated.
   - LTV calculation: net sales only; refunds reduce LTV; voids are excluded.
   - Refund and void receipts use the same canonical `receiptData` renderer and QZ Tray path.

8. **Security hardening and final QA**

   This phase does not add new features. It raises the security and reliability bar across everything built in Phases 1–7.

   - Manager PIN: enforce configurable retry limit, temporary lockout, and admin-only PIN reset.
   - Scoped approval tokens: verify token action type matches the requested action before proceeding.
   - Full audit event coverage audit: walk every restricted action and confirm audit rows are written correctly.
   - Race condition tests: concurrent last-unit sales, concurrent Z report attempts, concurrent refund on the same line.
   - Load test: product search and barcode lookup at expected catalog size.
   - Full hardware test on the real Posiflex terminal with real Bixolon printer.
   - Production rollout checklist execution (see Section 14).
   - After this phase, the system is ready for production sign-off against the v1 gate in Section 17. The separate full-product checklist remains a later roadmap target.

## 16. Scope Decisions

| Decision | Status | Direction |
| --- | --- | --- |
| Card payment | **Decided** | Manual terminal confirmation in POS for v1. |
| Split payment | **Decided** | Not in v1. Revisit alongside gateway integration. |
| Discounts | **Decided** | Not in v1. |
| Receipt language | **Decided** | English only. |
| Tax | **Decided** | No VAT charged in v1. Configurable `tax_rate` and `tax_amount_cents` are set to zero; future changes require compliance review. |
| Money representation | **Decided** | Integer cents only across API, database, receipts, and reports. |
| Receipt number format | **Decided** | Tenant sequence reserved in blocks of 100 per register; globally unique, zero-padded display, gaps allowed but no reuse. |
| Printer bridge | **Decided** | QZ Tray via secure localhost WebSocket. Use server-side signing online and an OS-protected, per-register local signer offline. Pre-implementation spike required. |
| SSE authentication | **Decided** | Native same-origin `EventSource` using Elite's existing secure session cookie; browser-managed `Last-Event-ID`. |
| Offline conflicts | **Decided** | Completed offline sales are financially accepted. Stock/price conflicts create manager reconciliation records; only invalid or unauthorized payloads are rejected. |
| LTV behavior | **Decided** | Net sales; refunds reduce customer LTV; voids do not increase LTV. |
| Real Sadad/QPay/NAPS integration | **Deferred** | Later phase after manual POS is stable. |
| Store/branch model | **Decided** | One store/inventory location per tenant in v1. Multi-branch inventory is deferred and will require a location-level stock model. |
| Shift model | **Decided** | One shift per register with one responsible cashier. Cashier handoff requires closing and opening a new shift. |
| Void scope | **Decided** | Void only in the same open shift. Later corrections use the refund flow. |
| Register identity management | **Decided** | Server-generated register ID enrolled with a one-time admin token; hashed device credential, revocation, and re-enrollment after reset. |
| POS/Elite order integration | **Decided** | Every POS sale creates linked Elite `orders`, `order_items`, and `payments` records in the same transaction. |
| Refund accounting | **Decided** | Store positive `pos_refunds`, `pos_refund_items`, and `payment_refunds`; update the original order status/timeline and subtract completed credits from LTV. Never insert negative orders/payments. |
| Inventory ownership | **Decided** | `product_variants.stock_quantity` is authoritative; product stock is derived. POS requires a variant ID. |

## 17. V1 Acceptance Gate

V1 is releasable only when every criterion below passes. Split payments, discounts, Arabic receipts, and direct Sadad/QPay/NAPS integration belong to the full-product checklist and are not v1 blockers.

Foundation and integration:

- Migrations and rollback run successfully in staging without recreating existing barcode or audit fields.
- Every monetary API/database value uses integer cents.
- Every completed POS sale atomically creates linked Elite order, item, payment, POS transaction, and POS item records.
- Variant inventory changes exactly once; duplicate idempotency requests return the original transaction.
- POS-linked sales appear in existing Elite CRM customer history and LTV calculations.

Register and shift:

- A terminal can enroll only with a valid one-time admin token; expired/reused tokens fail and are audited.
- Disabled/revoked register credentials cannot check in.
- One register can have only one open shift, owned by one cashier.
- Z report is rejected while offline, while a local sale is pending, or while a rejected sync item remains unresolved.

Online and offline checkout:

- Cash and manually confirmed card sales complete with correct totals and stock changes.
- Receipt numbers are unique across two registers and cannot be reused.
- An offline sale consumes a reserved receipt number, prints locally, survives restart, and syncs exactly once after reconnection.
- Offline checkout is blocked when the reserved number block is exhausted.
- An offline oversell syncs once as `acceptedWithConflicts`, preserves the financial sale, and creates a visible manager stock-reconciliation record.

Live sync and concurrency:

- Other registers receive committed stock changes within two seconds.
- Two simultaneous attempts to sell the last unit produce exactly one successful sale.
- SSE reconnects with browser-managed `Last-Event-ID`; an expired replay position triggers a full catalog refresh.

Hardware and security:

- QZ Tray starts with the terminal, connects over secure localhost WebSocket, and prints through signed requests without warning dialogs.
- With Elite disconnected, the device signer produces a valid signed receipt request without exposing private key material to Angular.
- Chrome Local Network Access is provisioned for the Elite origin.
- Cash receipts print and the drawer opens; card receipts print and the drawer remains closed.
- Printer failure never rolls back an already committed sale, and receipt retry works.
- Manager PIN retry limits, temporary lockout, scoped approvals, and audit records pass automated and physical tests.

Corrections and reporting:

- Same-shift void restores stock, excludes the value from net sales, updates the linked Elite order/payment, and is audited.
- Full and partial refunds use positive credit records, enforce remaining quantity/payment limits, restore returned stock, update the original order status, subtract completed credits from LTV/reports, and never create negative orders or payments.
- X report is repeatable and non-destructive.
- Z report totals match known cash/card/refund/void transactions, stores an immutable record, and closes the shift once.
