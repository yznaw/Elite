# Elite POS Integration Implementation Plan

## 1. Goal

Elite POS will be implemented as a cashier module inside Elite, not as a separate disconnected system. Elite remains the source of truth for products, variants, inventory, customers, users, permissions, transactions, refunds, reports, and audit history.

The POS interface will run at `/pos` and will use the same Elite backend and database. The cashier screen should feel fast and local, but all completed business events must eventually be recorded in Elite.

The existing [POS System Acceptance Criteria](./pos-system-plan.html) remains the sign-off checklist. This document defines the implementation plan and integration rules.

## 2. System Roles

| Component | Responsibility |
| --- | --- |
| Elite backend | Owns business rules, API validation, inventory updates, transactions, reports, and audit logs. |
| Elite database | Stores products, variants, barcodes, customers, POS transactions, refunds, parked carts, shifts, Z reports, and manager PIN hashes. |
| POS browser interface | Touch-first cashier UI at `/pos`; handles search, cart, checkout, offline queue, and hardware actions. |
| Posiflex terminal | Physical cashier device running Chrome/kiosk mode. |
| Barcode scanner | USB HID scanner that behaves like keyboard input; optional camera scanner for fallback. |
| Bixolon receipt printer | Prints receipts and Z reports using ESC/POS commands. |
| Cash drawer | Opens through the Bixolon printer RJ12 kick port. |
| Payment terminal | Handles card payments externally for v1, with cashier confirming payment in POS. |

## 3. Data Flow Overview

Elite sends operational data to POS:

```text
Elite DB -> Elite API -> POS /pos
products, variants, barcodes, prices, stock, customers, users, permissions, shift state
```

POS sends business events back to Elite:

```text
POS /pos -> Elite API -> Elite DB
sales, payments, refunds, voids, discounts, parked carts, Z reports, manager approvals, audit events
```

Live updates are pushed back to other POS terminals:

```text
Register A sale -> Elite API commits stock change -> SSE/WebSocket event -> Register B refreshes affected stock
```

Offline sales are queued locally first:

```text
POS offline -> IndexedDB queue -> reconnect -> sync endpoint -> Elite validates and commits
```

## 4. Core Architecture

The POS module should use these integration pieces:

| Area | Implementation |
| --- | --- |
| Normal reads/writes | REST APIs under `/api/pos/*`. |
| Live updates | SSE or WebSocket channel for stock, shift, and transaction events. |
| Offline storage | IndexedDB queue for pending transactions and parked local state. |
| Offline app shell | Service worker/PWA cache for `/pos`, static assets, and last-known product data. |
| Printing and drawer | Local hardware bridge or browser-compatible ESC/POS path. |
| Idempotency | Client-generated idempotency keys for every sale, refund, sync attempt, and Z report. |

For v1, prefer keeping business rules on the backend. The frontend can calculate totals for speed, but the backend must recalculate and validate before saving.

## 5. Database Plan

Required POS data model:

| Table/Field | Purpose |
| --- | --- |
| `pos_transactions` | Stores completed sales, refunds, voids, payment breakdowns, cashier, customer, shift, register, and idempotency key. |
| `pos_transaction_items` | Stores immutable item snapshot: product, variant, SKU, barcode, quantity, unit price, discounts, tax if applicable, and line total. |
| `pos_z_reports` | Stores immutable end-of-day report records with expected cash, physical cash, variance, totals, and generated receipt/report data. |
| `pos_parked_carts` | Stores parked carts by tenant, register, cashier, and cart payload. |
| `product_variants.barcode` | Stores variant-level barcode. Must be unique per tenant when present. |
| `admin_users.pos_pin_hash` | Stores bcrypt hash for manager PIN. Plain text PIN must never be stored. |
| `audit_events` | Stores manager overrides, voids, refunds, Z reports, security failures, and important POS actions. |

Migration rules:

- Run all migrations in staging before production.
- Add a rollback script for every POS migration.
- Validate that products, orders, customers, and existing admin flows still work after migration.
- Use non-destructive migrations where possible.
- Add indexes for barcode lookup, transaction lookup, customer lookup, shift summaries, and idempotency keys.
- Use database constraints to prevent duplicate idempotency keys per tenant/register action.

## 6. API Contracts

The exact payloads can evolve during implementation, but these contracts define the first integration surface.

### `GET /api/pos/products/search`

Purpose: search products and variants for POS.

Query:

```json
{
  "q": "string",
  "limit": 50,
  "includeOutOfStock": true
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
  ]
}
```

Rules:

- Only active sellable variants should appear by default.
- Search must support name, SKU, and barcode.
- Backend response should include a server timestamp so POS can know when cached data was last refreshed.

### `GET /api/pos/products/barcode/:barcode`

Purpose: resolve one scanned barcode to one variant.

Rules:

- Return exactly one variant or a clear `404` not found error.
- Duplicate barcode data must be prevented by database constraint.
- Include current stock and price.

### `POST /api/pos/transactions`

Purpose: create one online POS sale.

Request:

```json
{
  "idempotencyKey": "uuid",
  "registerId": "string",
  "cashierId": "uuid",
  "customerId": "uuid|null",
  "items": [
    {
      "variantId": "uuid",
      "quantity": 1,
      "unitPrice": 100,
      "discountAmount": 0
    }
  ],
  "payment": {
    "method": "cash|card|split",
    "cashAmount": 100,
    "cardAmount": 0,
    "amountTendered": 100,
    "changeGiven": 0
  },
  "orderDiscountAmount": 0,
  "managerOverrideId": "uuid|null"
}
```

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

- Backend recalculates totals and rejects mismatches.
- Backend decrements stock inside the same database transaction that creates the POS transaction.
- If stock is insufficient, reject the sale and return the affected variant IDs.
- Duplicate `idempotencyKey` must return the original saved transaction, not create a second sale.

### `POST /api/pos/transactions/sync`

Purpose: upload queued offline sales.

Request:

```json
{
  "registerId": "string",
  "transactions": [
    {
      "idempotencyKey": "uuid",
      "clientCreatedAt": "2026-06-17T10:00:00Z",
      "payload": {}
    }
  ]
}
```

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
- Rejected sales stay visible to the cashier/manager with a clear reason.
- Backend must never silently modify an offline sale to make it fit.

### `GET /api/pos/transactions/:id`

Purpose: load a transaction for receipt reprint, refund, or audit review.

Rules:

- Must include original line items, payment breakdown, customer, cashier, discounts, refunds already applied, and refundable remaining quantities.
- Must enforce tenant and permission boundaries.

### `POST /api/pos/refunds`

Purpose: create a full or partial refund.

Rules:

- Requires manager approval for cashier role.
- Refund transaction must link to the original sale.
- Stock is restored only for returned physical items.
- Partial refund cannot exceed remaining refundable quantity.
- Refunds must appear in X and Z reports.
- Duplicate `idempotencyKey` must not create a duplicate refund.

### `GET /api/pos/customers/search`

Purpose: find customers by phone number during checkout.

Rules:

- Search by normalized phone number.
- Return minimal customer details needed for cashier selection.
- Response should be fast and safe for repeated typing.

### `GET /api/pos/shift/summary`

Purpose: X report/current shift summary.

Rules:

- Read-only.
- Running multiple times must not reset counters.
- Totals must include gross sales, discounts, refunds, cash, card, split payments, voids, and net sales.

### `POST /api/pos/shift/z-report`

Purpose: close the shift/day and create immutable Z report.

Rules:

- Requires manager approval.
- Must use an idempotency key.
- Must store a permanent report row.
- Must include expected cash, physical cash, variance, payment totals, refund totals, and transaction count.
- After Z report, included transactions should not be counted in a new open shift report.

### `POST /api/pos/manager/verify-pin`

Purpose: verify manager PIN for restricted actions.

Rules:

- Never log plain PIN.
- Return an approval token or override ID, not the PIN.
- Approval token should be short-lived and scoped to one action.
- Failed attempts should be rate-limited and audited.

## 7. Offline Sync Rules

Offline POS must support a limited but reliable checkout mode.

Cached locally:

- POS app shell and static assets.
- Last-known active product/variant catalog.
- Last-known prices.
- Last-known stock values.
- Current cashier/register context.
- Pending sales queue.

Offline sale rules:

- Every offline sale gets a client-generated idempotency key.
- POS stores the complete transaction payload in IndexedDB.
- POS shows the number of pending sales.
- POS should warn if stock data is stale.
- Cash/card manual confirmation can be recorded offline, but real online gateway authorization cannot happen offline.

Reconnect rules:

- POS attempts sync automatically after reconnection.
- Sync retries should use backoff.
- Accepted sales are removed from IndexedDB.
- Rejected sales require manager review.
- If stock changed while offline and a sale would oversell, the backend rejects that sale.
- The cashier must see which sale failed and why.

## 8. Multi-Register Sync Rules

Live sync should keep terminals aligned without trusting the frontend as the source of truth.

Rules:

- The backend commits the sale and stock update first.
- After commit, backend publishes a stock update event.
- Other registers update affected variants within the target window.
- If two terminals sell the last unit at the same time, only one database transaction may succeed.
- The failed terminal receives an insufficient stock response and updates its cart.
- Stale carts should display a clear warning when stock or price changed.

Suggested live events:

```json
{
  "type": "stock.updated",
  "variantId": "uuid",
  "stock": 4,
  "sourceRegisterId": "register-1"
}
```

```json
{
  "type": "shift.closed",
  "shiftId": "uuid",
  "zReportId": "uuid"
}
```

```json
{
  "type": "transaction.refunded",
  "transactionId": "uuid",
  "refundId": "uuid"
}
```

## 9. Payment Flow

V1 payment scope:

| Method | Behavior |
| --- | --- |
| Cash | POS calculates change, records tendered amount, prints receipt, opens drawer. |
| Card | Cashier charges customer on external terminal, then taps `Confirm Paid` in POS. |
| Split | POS records exact cash/card amounts; cash portion can trigger drawer opening. |

Manual card confirmation rules:

- The POS must clearly show the amount to enter on the external terminal.
- The cashier confirms only after the terminal approves payment.
- The transaction is saved after confirmation.
- If the cashier cancels, no transaction is saved.
- If printing fails after payment, the transaction remains saved and receipt can be retried.

Future gateway integration:

- Sadad/QPay/NAPS integration should be treated as a later phase unless confirmed for v1.
- Real gateway integration will need authorization, capture, failure, timeout, callback/webhook, reconciliation, and reversal handling.

## 10. Hardware Integration

Barcode scanner:

- USB HID scanner should focus the POS barcode input or use a global scan listener.
- Unknown barcode shows a clear error and does not change the cart.
- Camera scanner can use browser camera APIs as fallback.

Receipt printer:

- Use ESC/POS-compatible printing for Bixolon 80mm.
- Avoid browser print dialogs for checkout receipts.
- Receipts must support English and Arabic text.
- If Arabic shaping is unreliable through raw ESC/POS, render Arabic receipt sections as a raster image before printing.

Cash drawer:

- Open through printer kick-port command.
- Open only for cash and split transactions with a cash component.
- Do not open for card-only sales.
- Log drawer open failures for troubleshooting.

Label printing:

- Generate Code 128 barcode labels for product variants.
- Label must include product name, variant, SKU/barcode, and price.
- Printed labels must scan back to the exact variant.

## 11. Receipts, Refunds, And Reports

Receipt requirements:

- Receipt number.
- Date/time.
- Cashier/register.
- Line items.
- Discounts.
- Total.
- Payment method and split amounts.
- Cash tendered and change due for cash payments.
- QR code or lookup code for refund.

Refund rules:

- Full refund returns all refundable items and restores stock when items are physically returned.
- Partial refund allows selected items and quantities.
- Refunded quantity cannot exceed original sold quantity minus previous refunds.
- Refunds create negative transactions linked to the original sale.
- Refunds must affect X and Z report totals.

X report:

- Mid-shift report.
- Read-only.
- Can be run multiple times.
- Does not close or reset anything.

Z report:

- End-of-day/shift closure.
- Requires manager approval.
- Stores immutable report data.
- Prints a report receipt.
- Once closed, included transactions must not be editable from normal POS flows.

## 12. Customer And CRM Integration

Customer lookup:

- Cashier can search by phone number.
- POS sale can be linked to a customer at checkout.
- Linked POS sale appears in the customer order history in Elite CRM.

LTV rules:

- Customer LTV should be based on net completed sales.
- Refunds should reduce LTV if the refunded sale was linked to that customer.
- Voided transactions should not increase LTV.
- If business wants gross historical spend instead, that should be a separate metric from LTV.

Customer history:

- POS transactions should be shown alongside online/admin orders where appropriate.
- The UI should clearly label POS-originated transactions.

## 13. Security And Audit

Manager PIN:

- Store only bcrypt hash in `admin_users.pos_pin_hash`.
- Never store or log plain PIN.
- Apply retry limits.
- Temporarily lock manager PIN verification after repeated failures.
- Allow authorized admins to reset PIN.
- Manager approval tokens should be short-lived and scoped to one action.

Restricted actions:

- Refund.
- Void.
- Z report.
- Discount above cashier limit.
- Cash drawer manual open if supported.
- Offline sync conflict override if supported.

Audit log must include:

- Tenant/store.
- Register ID.
- Cashier ID.
- Manager ID when applicable.
- Action type.
- Target transaction/refund/report ID.
- Timestamp.
- Result: success/failure.
- Failure reason where safe.

## 14. Testing And Sign-Off

Automated tests:

- API validation.
- transaction total recalculation.
- inventory decrement and restore.
- idempotency.
- insufficient stock race prevention.
- manager PIN verification and lockout.
- refund quantity limits.
- X/Z report totals.

Staging tests:

- Run migration and rollback.
- Load realistic product and customer data.
- Test product search performance with expected catalog size.
- Test customer lookup performance.
- Test offline sync with accepted and rejected transactions.

Physical hardware tests:

- Posiflex terminal in Chrome kiosk mode.
- USB barcode scanner.
- Bixolon receipt printer.
- Cash drawer via RJ12 kick port.
- Label printer.
- Arabic/English receipt output.

Production rollout checklist:

- Backup database.
- Confirm rollback script.
- Run migration during approved window.
- Verify admin product/order/customer flows.
- Verify one test POS sale.
- Verify receipt printing.
- Verify cash drawer behavior.
- Verify reports.
- Monitor logs for sync, printer, and transaction errors.

## 15. Phased Implementation Roadmap

1. DB and API foundation
   - Add POS tables, indexes, migrations, rollback scripts, and base API routes.

2. POS interface and sale creation
   - Build `/pos`, product search, barcode input, cart, cash/card/split checkout, and receipt payload generation.

3. Inventory and live sync
   - Add transactional stock updates, oversell prevention, and SSE/WebSocket stock events.

4. Offline queue
   - Add service worker cache, IndexedDB transaction queue, sync endpoint, idempotency handling, and cashier-visible sync status.

5. Hardware printing/scanning/drawer
   - Integrate USB scanner behavior, receipt printing, cash drawer trigger, camera scanner, and label printing.

6. Reports and shifts
   - Add X report, Z report, cash float, variance, immutable report records, and report printing.

7. Refunds and CRM
   - Add QR/manual transaction lookup, full/partial refunds, stock restoration, customer attachment, order history, and LTV updates.

8. Security hardening and final QA
   - Add manager PIN retry limits, lockouts, scoped override tokens, audit events, hardware tests, race tests, and production rollout checks.

## 16. Open Decisions

These decisions should be confirmed before implementation starts:

| Decision | Recommended v1 Direction |
| --- | --- |
| Card payment | Manual terminal confirmation in POS for v1. |
| Real Sadad/QPay/NAPS integration | Later phase after manual POS is stable. |
| Printer bridge | Confirm exact connection method on the Posiflex terminal before coding. |
| Store model | Confirm whether POS is single-store or multi-branch from day one. |
| Offline stock | Allow offline sales with stale-stock warning, but let backend reject conflicts during sync. |
| LTV behavior | Use net sales; refunds reduce customer LTV. |
| Arabic receipts | Test raw ESC/POS first; fallback to rasterized receipt sections if shaping fails. |
| Shift model | Confirm whether shifts are per register, per cashier, or store-wide. |

