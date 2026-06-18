# Elite POS Integration Implementation Plan

## 1. Goal

Elite POS will be implemented as a cashier module inside Elite, not as a separate disconnected system. Elite remains the source of truth for products, variants, inventory, customers, users, permissions, transactions, refunds, reports, and audit history.

The POS interface will run at `/pos` and will use the same Elite backend and database. The cashier screen should feel fast and local, but all completed business events must eventually be recorded in Elite.

The existing [POS System Acceptance Criteria](./pos-system-plan.html) remains the sign-off checklist. This document defines the implementation plan and integration rules.

**Scope constraints confirmed for v1:**
- Payment methods: cash and card only. Split payment is not in scope for v1.
- Discounts: not in scope for v1.
- Receipt language: English only.
- Tax: Qatar, VAT currently 0%. Tax rate and tax amount fields are included in the schema for future compliance but will always be zero in v1.
- Receipt numbering: global auto-increment per tenant.
- Printer bridge: QZ Tray installed on the Posiflex terminal.

## 2. System Roles

| Component | Responsibility |
| --- | --- |
| Elite backend | Owns business rules, API validation, inventory updates, transactions, reports, and audit logs. |
| Elite database | Stores products, variants, barcodes, customers, POS transactions, refunds, parked carts, shifts, Z reports, and manager PIN hashes. |
| POS browser interface | Touch-first cashier UI at `/pos`; handles search, cart, checkout, offline queue, and hardware actions. |
| Posiflex terminal | Physical cashier device running Chrome in kiosk mode. |
| QZ Tray | Java desktop bridge installed on the Posiflex terminal. The browser connects to it via WebSocket on localhost to issue ESC/POS commands to the Bixolon printer and trigger the cash drawer. Must run as a system startup service so it is always available when Chrome launches. |
| Barcode scanner | USB HID scanner that behaves like keyboard input; optional camera scanner for fallback. |
| Bixolon receipt printer | Prints receipts and Z reports using ESC/POS commands sent through QZ Tray. |
| Cash drawer | Opens through the Bixolon printer RJ12 kick port, triggered via QZ Tray. |
| Payment terminal | Handles card payments externally for v1, with cashier confirming payment in POS. |

> **Arch note — QZ Tray validation:** QZ Tray must be validated on the exact Posiflex model before Phase 5 begins. Confirm the Posiflex OS supports Java and that QZ Tray can run as a startup service. The backend `printPayload` format must be designed around QZ Tray's expected input from Phase 2 onward so receipt generation is not rewritten later.

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
| Live updates | SSE channel for stock, shift, and transaction events. Authentication uses the same session token as REST. The SSE connection must send a `Last-Event-ID` header on reconnect so the server can replay missed events or signal that a full catalog refresh is needed. |
| Offline storage | IndexedDB queue for pending transactions and parked local state. |
| Offline app shell / PWA | The POS is built as a Progressive Web App. A service worker caches `/pos`, static assets, and last-known product data. A `manifest.json` makes it installable on the Posiflex as a standalone app (no browser chrome), which is the preferred kiosk deployment mode. If Chrome kiosk mode is already in use, the PWA install is additive and does not conflict. |
| Printing and drawer | QZ Tray WebSocket bridge on localhost. The browser opens a WebSocket connection to QZ Tray, sends a signed ESC/POS job, and QZ Tray writes to the Bixolon and triggers the cash drawer. The backend generates the complete print job and returns it as `printPayload`; the frontend passes it to QZ Tray without modification. |
| Idempotency | Client-generated idempotency keys for every sale, refund, void, sync attempt, and Z report. |

For v1, keep all business rules on the backend. The frontend can calculate totals for speed, but the backend must recalculate and validate before saving.

> **Arch note — SSE vs WebSocket:** Use SSE (server-sent events) for the live update channel. SSE is simpler to implement, works over standard HTTP, and is sufficient for one-directional server-to-client push. The POS already uses REST for client-to-server communication. A full WebSocket upgrade is not needed for v1.

> **Arch note — Scalability:** The architecture is designed so each layer can scale independently. The backend is stateless behind a load balancer. SSE connections can be backed by Redis pub/sub when horizontal scaling is needed — the event schema defined in Section 8 is compatible with this without changes to the POS frontend. The database uses `tenant_id` on every POS table from day one so multi-branch and multi-tenant expansion requires no schema changes. The `printPayload` abstraction means the printer bridge (QZ Tray today) can be swapped for a cloud print service in the future without touching the receipt generation logic.

## 5. Database Plan

Required POS data model:

| Table / Field | Purpose |
| --- | --- |
| `pos_registers` | One row per physical register. Stores register ID (stable UUID generated on first boot), display name, branch/location, and last-seen timestamp. The `registerId` in all transactions must be a foreign key to this table. |
| `pos_shifts` | One row per shift open/close cycle per register. Stores cashier, register, opening float, open time, close time, Z report link, and state (`open` / `closing` / `closed`). The `closing` state is set atomically at Z report start to prevent concurrent Z report creation on the same register. |
| `pos_transactions` | Stores completed sales, refunds, and voids. Includes payment breakdown (cash or card only), cashier, customer, shift, register, receipt number, and idempotency key. |
| `pos_transaction_items` | Immutable item snapshot: product, variant, SKU, barcode, quantity, unit price, `tax_rate` (0 for Qatar v1), `tax_amount` (0 for Qatar v1), and line total. No discount fields in v1. |
| `pos_z_reports` | Immutable end-of-day report records. Stores opening float, expected cash (float + cash sales − cash refunds), physical cash entered by manager, variance, cash totals, card totals, refund totals, void count, transaction count, and generated report data. |
| `pos_parked_carts` | Stores parked carts by tenant, register, cashier, and cart payload. No discount fields in v1. |
| `product_variants.barcode` | Variant-level barcode. Must be unique per tenant when present. |
| `admin_users.pos_pin_hash` | bcrypt hash for manager PIN. Plain text PIN must never be stored. |
| `audit_events` | Manager overrides, voids, refunds, Z reports, shift opens/closes, security failures, and all important POS actions. |
| `receipt_number_seq` | One global auto-increment sequence per tenant. Receipt numbers are globally unique within a tenant and never reset. Displayed as a zero-padded string (e.g., `000142`). |

> **Arch note — Tax fields:** `tax_rate` and `tax_amount` are included in `pos_transaction_items` from the start and will always be 0 in v1. Adding them now avoids a schema migration if Qatar introduces VAT. The backend must set these explicitly; the frontend does not calculate tax.

> **Arch note — Shift state machine:** The shift lifecycle is `open → closing → closed`. The `closing` state is set in the same database transaction as Z report creation. If the Z report fails, the shift rolls back to `open`. This prevents two concurrent Z report requests from both succeeding on the same register.

Migration rules:

- Run all migrations in staging before production.
- Add a rollback script for every POS migration.
- Validate that products, orders, customers, and existing admin flows still work after migration.
- Use non-destructive migrations where possible.
- Add indexes for barcode lookup, transaction lookup by receipt number, customer lookup, shift summaries, idempotency keys, and register ID.
- Use database constraints to prevent duplicate idempotency keys per tenant and register action.
- Add a unique constraint on the receipt number sequence per tenant.

## 6. API Contracts

The exact payloads can evolve during implementation, but these contracts define the first integration surface.

### `POST /api/pos/registers/check-in`

Purpose: register a terminal on first boot or after a restart, and confirm the register identity.

Request:

```json
{
  "registerId": "uuid",
  "displayName": "string"
}
```

Response:

```json
{
  "registerId": "uuid",
  "displayName": "string",
  "currentShiftId": "uuid|null",
  "currentShiftState": "open|closed|null"
}
```

Rules:

- If `registerId` does not exist, create it.
- If it already exists, update `last_seen_at` and return current shift state.
- `registerId` must be a stable UUID generated on first boot and stored locally on the terminal (localStorage or a config file).

---

### `POST /api/pos/shift/open`

Purpose: open a new shift for a register and record the opening cash float.

Request:

```json
{
  "registerId": "uuid",
  "cashierId": "uuid",
  "openingFloat": 500
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
- `openingFloat` is the physical cash counted and confirmed before trading starts.

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
      "price": 100,
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
- Include current stock and price.

---

### `POST /api/pos/transactions`

Purpose: create one online POS sale.

Request:

```json
{
  "idempotencyKey": "uuid",
  "registerId": "uuid",
  "shiftId": "uuid",
  "cashierId": "uuid",
  "customerId": "uuid|null",
  "items": [
    {
      "variantId": "uuid",
      "quantity": 1,
      "unitPrice": 100
    }
  ],
  "payment": {
    "method": "cash|card",
    "cashAmount": 100,
    "cardAmount": 0,
    "amountTendered": 100,
    "changeGiven": 0
  },
  "managerOverrideId": "uuid|null"
}
```

> **Removed from v1:** `discountAmount` per item, `orderDiscountAmount`, and split payment are not in scope.

Response:

```json
{
  "transactionId": "uuid",
  "receiptNumber": "string",
  "receipt": {
    "printPayload": "string",
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

- Backend recalculates line totals and the transaction total from `quantity × unitPrice` and rejects any mismatch.
- Backend decrements stock inside the same database transaction that creates the POS transaction.
- If stock is insufficient, reject the sale and return the affected variant IDs.
- Duplicate `idempotencyKey` must return the original saved transaction, not create a second sale.
- For cash payments: `cashAmount` must equal `amountTendered`. `changeGiven = amountTendered − total`. Backend validates this.
- For card payments: `cardAmount` must equal the transaction total. `amountTendered` and `changeGiven` are ignored.
- `shiftId` must reference an open shift for this register.
- `printPayload` is the QZ Tray-ready ESC/POS print job, generated entirely by the backend.

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
      "clientCreatedAt": "2026-06-17T10:00:00Z",
      "payload": {}
    }
  ]
}
```

> **Arch note — Timestamps:** The backend must record `clientCreatedAt` as provided by the device and stamp a separate `server_received_at` at the moment of sync. Only `server_received_at` is used in Z report totals. `clientCreatedAt` is stored for audit and dispute reference only. A manipulated client clock must not affect financial records.

Response:

```json
{
  "accepted": ["uuid"],
  "rejected": [
    {
      "idempotencyKey": "uuid",
      "reason": "INSUFFICIENT_STOCK|PRICE_CHANGED|INVALID_PAYLOAD",
      "message": "string"
    }
  ]
}
```

Rules:

- Sync must be idempotent.
- Accepted sales are removed from the local queue.
- Rejected sales stay visible to the cashier and manager with a clear reason.
- Backend must never silently modify an offline sale to make it fit.

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
  "cashierId": "uuid",
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

Rules:

- Requires manager approval for cashier role.
- Refund transaction must link to the original sale.
- Stock is restored only when physical items are returned.
- Partial refund cannot exceed `refundableQty` per line.
- Refunds appear in X and Z reports as negative amounts.
- Duplicate `idempotencyKey` must not create a duplicate refund.
- Refunded amount reduces customer LTV if the original sale was linked to that customer.

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
  "physicalCash": 650
}
```

Rules:

- Requires manager approval.
- Must use an idempotency key.
- Atomically sets shift state to `closing`, creates the Z report row, then sets state to `closed`. On any failure the transaction rolls back and the shift returns to `open`.
- Must store a permanent, immutable report row.
- Must include: opening float, expected cash (float + cash sales − cash refunds), physical cash entered, variance, cash totals, card totals, refund totals, void count, transaction count, and net sales.
- After Z report is closed, included transactions must not be counted in any new open shift report.

---

### `POST /api/pos/manager/verify-pin`

Purpose: verify manager PIN for restricted actions.

Rules:

- Never log plain PIN.
- Return an approval token scoped to one specific action type (`refund`, `void`, `z-report`, `drawer-open`).
- Approval token must be short-lived (maximum 5 minutes).
- Failed attempts must be rate-limited and audited.
- After a configurable number of consecutive failures, temporarily lock PIN verification and log an alert.

## 7. Offline Sync Rules

Offline POS must support a limited but reliable checkout mode.

Cached locally:

- POS app shell and static assets.
- Last-known active product/variant catalog.
- Last-known prices.
- Last-known stock values.
- Current cashier, register, and shift context.
- Pending sales queue.

Offline sale rules:

- Every offline sale gets a client-generated idempotency key.
- POS stores the complete transaction payload in IndexedDB.
- POS shows the number of pending sales.
- POS warns if stock data is stale.
- Cash manual confirmation can be recorded offline. Card confirmation can also be recorded offline, but the cashier must be shown a warning that card payment cannot be verified without connectivity.

Reconnect rules:

- POS attempts sync automatically after reconnection.
- Sync retries use exponential backoff.
- Accepted sales are removed from IndexedDB.
- Rejected sales require manager review.
- If stock changed while offline and a sale would oversell, the backend rejects that sale.
- The cashier must see which sale failed and why.

> **Arch note — Timestamps:** Every offline sale includes `clientCreatedAt` (the device clock at time of sale). The backend records this alongside `server_received_at` (the server clock at sync time). Only `server_received_at` is used for financial reports. `clientCreatedAt` is stored for audit and dispute resolution. The backend must never use a client-supplied timestamp as the authoritative financial timestamp.

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
GET /api/pos/events?registerId=<uuid>
```

Authentication: same session token as REST requests, passed as a cookie or `Authorization: Bearer` header. The connection must send `Last-Event-ID` on reconnect to allow the server to replay missed events or signal that a full refresh is needed.

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
- QZ Tray must be configured with a self-signed certificate to allow `wss://` from Chrome kiosk mode.
- The backend generates the complete ESC/POS print job and returns it as `printPayload` in the transaction response.
- The frontend passes `printPayload` to QZ Tray without modification.
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

> **Arch note — QZ Tray setup spike:** Before Phase 5 begins, run a one-day spike: install QZ Tray on the Posiflex, configure `wss://localhost:8181`, generate and trust the self-signed certificate in Chrome, and send one test ESC/POS print job to the Bixolon. This validates the entire hardware path before any receipt generation code is written and avoids discovering hardware incompatibility late.

## 11. Receipts, Refunds, And Reports

Receipt requirements (English only):

- Receipt number (global auto-increment, zero-padded).
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
- Refunds create negative transactions linked to the original sale.
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

Staging tests:

- Run migration and rollback.
- Load realistic product and customer data.
- Test product search performance with expected catalog size.
- Test customer lookup performance.
- Test offline sync with accepted and rejected transactions.
- Test Z report closure and shift state transition under concurrent requests.
- Test QZ Tray print job delivery on staging hardware.

Physical hardware tests:

- Posiflex terminal in Chrome kiosk mode.
- QZ Tray installed and confirmed running as a startup service.
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
- Verify receipt printing via QZ Tray.
- Verify cash drawer behavior.
- Verify X and Z reports.
- Monitor logs for sync, printer, and transaction errors.

## 15. Phased Implementation Roadmap

Each phase builds on the previous one. A phase is considered complete only when its automated tests pass and the feature can be demonstrated end-to-end. No phase skips are allowed — later phases depend on the correctness of earlier ones.

1. **DB and API foundation**

   Everything that follows depends on the data model being correct from the start. Get this right before any UI is built.

   - Add all POS tables: `pos_registers`, `pos_shifts`, `pos_transactions`, `pos_transaction_items`, `pos_z_reports`, `pos_parked_carts`.
   - Add `admin_users.pos_pin_hash`, `product_variants.barcode`, and the global receipt number sequence.
   - Add `tenant_id` on every POS table for future multi-branch and multi-tenant expansion.
   - Add all indexes, unique constraints (idempotency keys, barcodes, receipt numbers), and rollback scripts.
   - Add base API routes: register check-in, shift open, product search, barcode lookup, and manager PIN verify.
   - No frontend work in this phase.

2. **Register identity and shift management**

   Sales cannot be recorded without an open shift. This phase establishes the shift lifecycle before any transaction code is written.

   - Implement `POST /api/pos/registers/check-in` and register persistence.
   - Implement `POST /api/pos/shift/open` with opening float recording.
   - Implement shift state machine (`open → closing → closed`) at the database level.
   - Implement `GET /api/pos/shift/summary` (X report, read-only, no-op safe).
   - Implement `POST /api/pos/shift/z-report` with atomic state transition and immutable report creation.
   - Implement manager PIN verification with rate limiting and audit logging.
   - All shift and PIN logic must have automated tests before Phase 3 begins.

3. **POS core interface and sale creation**

   The first complete user-facing workflow: cashier opens a shift, builds a cart, takes payment, and gets a receipt payload.

   - Build the `/pos` Angular module and routing.
   - Product search UI (text and barcode input), cart, and checkout flow.
   - Cash and card payment only. No discounts, no split.
   - Backend generates a QZ Tray-compatible `printPayload` in the transaction response from this phase. The receipt format is finalized here so it does not need to change in Phase 6.
   - Receipt language: English only.
   - Backend recalculates all totals and rejects mismatches.
   - Atomic sale + stock decrement in a single database transaction.
   - End-to-end test: open shift → search product → checkout → verify transaction in DB and stock decremented.

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
   - Record `clientCreatedAt` (device clock) and `server_received_at` (server clock) separately on sync. Only `server_received_at` is used in reports.
   - Show cashier-visible pending sale count and stale-stock warning.
   - Test: go offline mid-session, complete two sales, reconnect, verify both sync correctly and stock is accurate.

6. **Hardware integration (QZ Tray)**

   Hardware integration is isolated in its own phase so a QZ Tray problem does not block core POS functionality.

   - **Run the QZ Tray spike first** (one day): install on Posiflex, configure `wss://localhost:8181` with a self-signed cert trusted by Chrome, send one ESC/POS test job to the Bixolon. If this fails, investigate before writing any printing code.
   - Connect the browser to QZ Tray via `wss://localhost:8181`.
   - Pass the `printPayload` (already generated by the backend since Phase 3) to QZ Tray for receipt printing.
   - Trigger cash drawer via kick-port command through QZ Tray on cash sales only.
   - Integrate USB barcode scanner global listener and camera fallback.
   - Label printing (Code 128, product name, variant, SKU, price).
   - If printing fails, the transaction remains saved. The cashier retries from the transaction lookup screen.

7. **Voids, refunds, and CRM**

   Post-sale correction flows. These depend on Phase 6 (reprint receipts) and Phase 2 (manager PIN) being complete.

   - Implement `POST /api/pos/transactions/:id/void` with manager approval, same-shift restriction, stock restoration, and audit event.
   - Implement full and partial refunds with `refundableQty` enforcement per line.
   - Customer phone-number search and attachment to POS sales.
   - Linked POS sales appear in Elite CRM order history, clearly labelled as POS-originated.
   - LTV calculation: net sales only; refunds reduce LTV; voids are excluded.
   - Refund and void receipts print via QZ Tray using the same `printPayload` pattern.

8. **Security hardening and final QA**

   This phase does not add new features. It raises the security and reliability bar across everything built in Phases 1–7.

   - Manager PIN: enforce configurable retry limit, temporary lockout, and admin-only PIN reset.
   - Scoped approval tokens: verify token action type matches the requested action before proceeding.
   - Full audit event coverage audit: walk every restricted action and confirm audit rows are written correctly.
   - Race condition tests: concurrent last-unit sales, concurrent Z report attempts, concurrent refund on the same line.
   - Load test: product search and barcode lookup at expected catalog size.
   - Full hardware test on the real Posiflex terminal with real Bixolon printer.
   - Production rollout checklist execution (see Section 14).
   - After this phase, the system is ready for production sign-off against the POS System Acceptance Criteria.

## 16. Open Decisions

| Decision | Status | Direction |
| --- | --- | --- |
| Card payment | **Decided** | Manual terminal confirmation in POS for v1. |
| Split payment | **Decided** | Not in v1. Revisit alongside gateway integration. |
| Discounts | **Decided** | Not in v1. |
| Receipt language | **Decided** | English only. |
| Tax | **Decided** | Qatar, VAT 0%. Schema includes `tax_rate` and `tax_amount` set to 0. |
| Receipt number format | **Decided** | Global auto-increment per tenant, zero-padded display. |
| Printer bridge | **Decided** | QZ Tray on Posiflex via `wss://localhost:8181`. Validate with a spike before Phase 5. |
| Offline stock | **Decided** | Allow offline sales with stale-stock warning; backend rejects oversells during sync. |
| LTV behavior | **Decided** | Net sales; refunds reduce customer LTV; voids do not increase LTV. |
| Real Sadad/QPay/NAPS integration | **Deferred** | Later phase after manual POS is stable. |
| Store/branch model | **Open** | Confirm whether POS is single-store or multi-branch from day one. Affects `pos_registers` schema and SSE event routing. |
| Shift model | **Open** | Confirm whether shifts are per register, per cashier, or store-wide. Affects `pos_shifts` schema, Z report scope, and opening float ownership. |
| Void scope | **Open** | Confirm whether void is strictly same-shift-only or allowed across shifts (e.g., next-day correction). Same-shift is the safer default and is what this plan assumes. |
| Register identity management | **Open** | Confirm whether `registerId` is pre-configured by an admin or auto-generated on first boot and stored locally. |
