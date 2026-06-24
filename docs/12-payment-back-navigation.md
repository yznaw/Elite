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
| Browser restores `/checkout` from bfcache on Back | `ngOnInit` does not re-run, recovery screen never shows | `pageshow` listener re-checks the flag on bfcache restore |
| Double-tap / retry / re-send of "Place Order" | Two (or more) orders created | Idempotency key dedupes — same order returned |
| Stray `GET /carts/shipping-quote` (POST-only route) | Postgres throws "invalid input syntax for uuid", logs spammed | UUID guard returns clean 404 |
| Pending orders from abandoned sessions | Stay as `pending` forever, pollute admin | Automatically cancelled after 6 hours by cleanup job |

---

## Part 1 — Back-Navigation Recovery

### Why it happens

The Sadad redirect is a full-page form POST. The browser replaces the history entry entirely. When the customer hits Back, Angular re-bootstraps from scratch — there is no in-memory state. `sessionStorage` is the only reliable cross-navigation store: it survives the Back navigation but is discarded when the tab is closed.

### The bfcache trap (important)

There are two ways the browser returns to `/checkout` on Back:

1. **Fresh load** — Angular re-bootstraps, `ngOnInit` runs, reads `sessionStorage`, shows the recovery screen. Works.
2. **bfcache restore** — the browser serves a frozen snapshot of `/checkout` from the back-forward cache. `ngOnInit` does **not** run, so the flag is never re-checked and the user sees the old checkout form.

Case 2 is common on mobile Safari and Chrome. The fix is a `pageshow` listener that fires on every restore; when `event.persisted` is `true` (bfcache), it re-runs the pending-order check. Both `ngOnInit` and `pageshow` call the same `checkPendingOrder()` method, and the listener is removed in `ngOnDestroy`.

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
| `client/.../checkout/checkout.component.ts` | Store flag before redirect; detect on init AND on bfcache restore (`pageshow`); `resumeCheckStatus()` and `resumeStartNew()` |
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

The threshold is configurable via the `PENDING_ORDER_ABANDON_HOURS` environment variable (default: `6`).

The job runs once 1 minute after boot (to let the DB settle), then every 30 minutes. Errors are logged as warnings and never crash the server.

### Files Changed (cleanup job)

| File | Change |
|---|---|
| `server/lib/pending-order-cleanup.js` | New file — `abandonStalePendingOrders()` + `startPendingOrderCleanup()` |
| `server/index.js` | `require` + `startPendingOrderCleanup()` called after DB bootstrap |

### Environment variable

| Variable | Default | Description |
|---|---|---|
| `PENDING_ORDER_ABANDON_HOURS` | `6` | Hours before a pending order is auto-cancelled |

> Requires the `cancelled` value on the `order_payment_status` enum (added by Migration 014 in `ensure-migrations.js`). See Part 6.

---

## Part 5 — Storefront Checkout Idempotency

### The bug

The "Place Order" button is disabled in the UI while a request is in flight, but the **server** had no protection. A fast double-tap, a retry after a flaky network, or a re-sent request could each create a separate duplicate order. The `orders.idempotency_key` column and its unique index already existed (Migration 013) but were only used by the admin order route — the storefront checkout ignored them.

### The fix

- The client mints a stable idempotency key (`crypto.randomUUID()`) on the first `placeOrder()` call and reuses it on retries. It is reset after "Start New Order" so a deliberately fresh attempt creates a fresh order.
- `checkout.service.createOrder()` forwards the key to `POST /api/carts/checkout`.
- The server checks `orders.idempotency_key` before inserting. If the key was already used, it returns the existing order instead of creating a duplicate.

This is stronger than the UI button-disable because it survives page reloads, network retries, and any client-side state loss.

### Files Changed (idempotency)

| File | Change |
|---|---|
| `client/.../checkout/checkout.component.ts` | Generate/reuse/reset stable `idempotencyKey`; send it with `createOrder` |
| `client/.../services/checkout.service.ts` | Accept and forward `idempotencyKey` |
| `server/routes/carts.route.js` | Dedup check against `idempotency_key`; store it on the new order |

---

## Part 6 — Migration Chain Robustness

A set of production errors (`cannot drop columns from view`, `invalid input value for enum: cancelled`, `column "size_chart" does not exist`) all traced back to **one** cause: `ensureAllMigrations` aborting partway, so later migrations never ran.

| Problem | Cause | Fix |
|---|---|---|
| `cannot drop columns from view` | `CREATE OR REPLACE VIEW` cannot change a view's column set; it threw and aborted the whole chain | `DROP VIEW IF EXISTS` + `CREATE VIEW` for `v_customer_order_stats` |
| `invalid input value for enum: cancelled` | `ALTER TYPE ... ADD VALUE` cannot run inside a `DO $$` block | Run it directly with `ADD VALUE IF NOT EXISTS`, catch duplicate-object `42710` (Migration 014) |
| `column "size_chart" does not exist` | Migration 015 never ran because the chain aborted at the view | Chain now completes; the `size_chart` step is also guarded against `42P01` (undefined_table) since the table is created later |

### Files Changed (migrations)

| File | Change |
|---|---|
| `server/db/ensure-migrations.js` | View DROP+CREATE; enum `ADD VALUE` outside DO block; guarded `size_chart` step |

---

## Part 7 — Cart Route UUID Guard

### The bug

`GET /api/carts/:id` matched any unmatched `/carts/*` GET, including a stray `GET /carts/shipping-quote` (the real route is POST). The non-UUID value reached Postgres and threw `invalid input syntax for type uuid`, spamming the error log.

### The fix

`GET /carts/:id` validates the param is a UUID before querying; non-UUID paths return a clean 404.

### Files Changed (route guard)

| File | Change |
|---|---|
| `server/routes/carts.route.js` | `isUuid` guard on `GET /carts/:id` |

---

## Why Not Block the Back Button?

`history.pushState` tricks to intercept the Back button are unreliable across browsers and break native mobile gestures. They fight the browser's built-in UX. The `sessionStorage` recovery screen works with the browser instead of against it.

## Why Not `abandoned` as a Separate Status?

Adding an `abandoned` status requires a new DB enum value, a network call on a user action that should feel instant, and handling the case where that call fails. The simpler model: `pending` orders older than a threshold are `cancelled` by the cleanup job. One mechanism handles all abandonment cases — back button, closed tab, network drop — without client coordination.

---

## Deployment Notes

Both server and client changed across these parts.

- **Server changes** (migrations, callback/webhook guards, cleanup job, idempotency check, route guard) take effect on `pm2 restart`. The migration chain self-heals the schema on boot.
- **Client changes** (recovery screen, bfcache listener, idempotency key) are part of the compiled Angular bundle. A `git pull` alone does **not** update what the browser serves — the storefront must be rebuilt:

```bash
cd /var/www/elite
git pull origin admin-bugs-fixes
cd client && npm run build:web      # rebuild storefront bundle
cd .. && pm2 restart elite-api
```

If the recovery screen does not appear after a confirmed rebuild, open DevTools → Application → Session Storage and confirm `elite_pending_order` is set — that isolates the write side from the read side.
