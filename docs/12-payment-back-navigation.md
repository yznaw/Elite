# Payment Flow — Guards & Recovery

## Problem

The Elite checkout sends customers to an external Sadad payment page via a hidden HTML form POST. Once the browser navigates away, the SPA loses control entirely. If the customer presses the browser Back button (or swipes back on mobile) before completing payment, they land on `/checkout` again — but the order already exists in the database with `payment_status = pending`.

Without handling this, the customer could:
- Press **Pay** again and create a duplicate order.
- Leave the pending order orphaned in the database with no resolution.

Beyond the back-navigation problem, a full audit of the payment flow revealed additional correctness bugs in the callback and webhook handlers.

---

## Scenarios Covered

| Scenario | Before | After |
|---|---|---|
| Customer presses Back from Sadad page | Normal checkout form shown, can re-submit and duplicate order | Recovery screen shown instead |
| Customer presses Back then presses Pay again | Duplicate order created | Blocked — recovery screen forces a decision first |
| Mobile swipe-back gesture from Sadad | Same as browser Back | Recovery screen shown |
| Sadad callback arrives after webhook already marked order paid | Callback `UPDATE` downgrades `paid` to `pending`/`failed` | `WHERE payment_status != 'paid'` guard prevents any downgrade |
| Sadad sends duplicate webhook for same transaction | Full DB update runs again, timeline entry re-inserted | Early `return` on duplicate `transactionNumber` |
| Sadad redirects to `/checkout/failure` (root cancel) | Already handled by `sadadRootReturnGuard` | Unchanged, flag cleared on arrival |
| Successful payment → `/thank-you` | `sessionStorage` flag not cleared | Flag cleared on arrival |
| Failed/cancelled payment → `/checkout/failure` | `sessionStorage` flag not cleared | Flag cleared on arrival |
| Pending orders from abandoned sessions | Stay as `pending` forever, pollute admin | Automatically cancelled after 6 hours by cleanup job |

---

## Part 1 — Back-Navigation Recovery

### Why it happens

The Sadad redirect is a full-page form POST. The browser replaces the history entry entirely. When the customer hits Back, Angular re-bootstraps from scratch — there is no in-memory state. `sessionStorage` is the only reliable cross-navigation store: it survives the Back navigation but is discarded when the tab is closed.

### Storage Key

```
sessionStorage key: elite_pending_order
value: UUID of the pending order
```

### Flow

```
1. Customer reaches Step 3 (Payment) and presses "Place Order"
2. Order created in DB (payment_status = pending)
3. orderId written to sessionStorage['elite_pending_order']
4. Browser redirected to Sadad (full-page POST — SPA loses control)

── Happy path ──────────────────────────────────────────────────────
5a. Customer pays → Sadad POSTs to /api/payments/sadad/callback
6a. Order updated to payment_status = paid
7a. Customer redirected to /thank-you
8a. ThankYouComponent clears sessionStorage['elite_pending_order']

── Cancelled / failed ──────────────────────────────────────────────
5b. Customer cancels or payment fails
6b. Sadad redirects to /checkout/failure or root with ?order_id=...
7b. CheckoutResultComponent clears sessionStorage['elite_pending_order']

── Back button ─────────────────────────────────────────────────────
5c. Customer presses Back → lands on /checkout
6c. CheckoutComponent.ngOnInit reads sessionStorage['elite_pending_order']
7c. Recovery screen shown (normal form hidden)
8c. Customer chooses:
    A. "Check Payment Status" → GET /api/payments/order-status/:id
       → paid   → navigate to /thank-you
       → other  → navigate to /checkout/failure
       → either → sessionStorage cleared
    B. "Start New Order" → sessionStorage cleared, form shown
       Old pending order left to be cleaned up by the cleanup job
```

### Why the cart is NOT cleared on order creation

Clearing the cart when the order is created would mean: if the customer hits Back and chooses "Start New Order", they face an empty cart and have to re-add everything. For a luxury store this is unacceptable. The cart stays intact until `payment_status = paid` is confirmed — the cleanup job handles the orphaned order on the other side.

### Files Changed (back-navigation)

| File | Change |
|---|---|
| `client/.../checkout/checkout.component.ts` | Store flag before redirect; detect on init; `resumeCheckStatus()` and `resumeStartNew()` |
| `client/.../checkout/checkout.component.html` | Recovery screen rendered when `resumeOrderId()` is set |
| `client/.../thank-you/thank-you.component.ts` | Clear flag in constructor |
| `client/.../checkout-result/checkout-result.component.ts` | Clear flag in constructor |
| `server/routes/payments.route.js` | New `GET /api/payments/order-status/:orderId` endpoint |
| `client/.../i18n/strings.ts` | `checkout.resume.*` strings in English and Arabic |

### New API Endpoint

```
GET /api/payments/order-status/:orderId
```

**Auth:** none (public — orderId is a UUID, not guessable)

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentStatus": "pending | paid | failed | cancelled",
    "publicNumber": "EC-1234"
  }
}
```

### Recovery Screen i18n

| Key | EN | AR |
|---|---|---|
| `checkout.resume.kicker` | Payment In Progress | دفع قيد التنفيذ |
| `checkout.resume.title` | You left a payment unfinished | غادرت عملية دفع لم تكتمل |
| `checkout.resume.body` | An order was created but the payment was not completed... | تم إنشاء طلب لكن الدفع لم يكتمل... |
| `checkout.resume.checkStatus` | Check Payment Status | تحقق من حالة الدفع |
| `checkout.resume.newOrder` | Start New Order | ابدأ طلباً جديداً |
| `checkout.resume.checking` | Checking status... | جارٍ التحقق... |
| `checkout.resume.error` | Could not retrieve order status... | تعذّر الحصول على حالة الطلب... |

---

## Part 2 — Callback Race Condition Fix

### The bug

Sadad has two parallel notification paths:
1. **Webhook** — async server-to-server POST to `/webhooks/sadad`
2. **Callback redirect** — browser-based POST to `/api/payments/sadad/callback`

The webhook typically arrives first. If it marks the order `paid`, the callback arriving seconds later would run an unconditional `UPDATE orders SET payment_status = ...` — potentially downgrading `paid` to `pending` or `failed` depending on timing.

### The fix

Added `AND payment_status != 'paid'` to the `UPDATE WHERE` clause in both the callback handler and the webhook handler.

```sql
-- Before
WHERE id = $2::uuid

-- After
WHERE id = $2::uuid
  AND payment_status != 'paid'
```

When `rowCount = 0` because the order is already paid, the callback now reads the current `public_number` and redirects to `/thank-you` instead of `/checkout/failure`.

The same guard was applied to the webhook `UPDATE` so neither path can ever downgrade a confirmed payment.

### Files Changed (race condition)

| File | Change |
|---|---|
| `server/routes/payments.route.js` | `AND payment_status != 'paid'` on callback `UPDATE`; graceful redirect when already paid |
| `server/routes/sadad-webhook.route.js` | `AND payment_status != 'paid'` on webhook `UPDATE` |

---

## Part 3 — Webhook Idempotency Short-Circuit

### The bug

In `sadad-webhook.route.js`, when a duplicate `transactionNumber` was detected the code logged the message but continued executing the full `UPDATE orders` block below. The early-exit `return` was missing.

### The fix

```js
// Before
if (existing.rows[0]?.provider_payment_id === transactionNumber) {
  console.log('[sadad-webhook] Duplicate — already processed', { transactionNumber });
}
// execution continued...

// After
if (existing.rows[0]?.provider_payment_id === transactionNumber) {
  console.log('[sadad-webhook] Duplicate — already processed', { transactionNumber });
  return; // ← added
}
```

### Files Changed (idempotency)

| File | Change |
|---|---|
| `server/routes/sadad-webhook.route.js` | Added `return` after duplicate detection log |

---

## Part 4 — Pending Order Cleanup Job

### Why

Any order that stays `pending` indefinitely represents a session that was abandoned — tab closed, network dropped, back button pressed and "Start New Order" chosen. These orders should not stay as `pending` forever in the admin panel.

### How it works

A lightweight in-process scheduler runs every **30 minutes** and marks any order older than **6 hours** with `payment_status = pending` as `cancelled`.

```sql
UPDATE orders
   SET payment_status = 'cancelled',
       updated_at     = NOW()
 WHERE payment_status = 'pending'
   AND created_at < NOW() - '6 hours'::interval  -- default, override via PENDING_ORDER_ABANDON_HOURS
```

The threshold is configurable via the `PENDING_ORDER_ABANDON_HOURS` environment variable (default: `2`).

The job runs once 1 minute after boot (to let the DB settle), then every 30 minutes. Errors are logged as warnings and never crash the server.

### Files Changed (cleanup job)

| File | Change |
|---|---|
| `server/lib/pending-order-cleanup.js` | New file — `abandonStalePendingOrders()` + `startPendingOrderCleanup()` |
| `server/index.js` | `require` + `startPendingOrderCleanup()` called after DB bootstrap |

### Environment variable

| Variable | Default | Description |
|---|---|---|
| `PENDING_ORDER_ABANDON_HOURS` | `2` | Hours before a pending order is auto-cancelled |

---

## Why Not Block the Back Button?

`history.pushState` tricks to intercept the Back button are unreliable across browsers and break native mobile gestures. They fight the browser's built-in UX. The `sessionStorage` recovery screen works with the browser instead of against it.

## Why Not `abandoned` as a Separate Status?

Adding an `abandoned` status requires a new DB enum value, a network call on a user action that should feel instant, and handling the case where that call fails. The simpler model: `pending` orders older than a threshold are `cancelled` by the cleanup job. One mechanism handles all abandonment cases — back button, closed tab, network drop — without client coordination.
