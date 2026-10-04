# 10 - NBOX Integration

Elite integrates with NBOX in two directions:

1. Checkout asks NBOX for delivery availability and price after the customer enters the delivery address.
2. After automatic delivery setup, verified payment consumes reserved stock and creates one shipment per pickup origin. Legacy location-stock orders retain staff approval.
3. NBOX sends shipment status updates back to `https://elitecollections.qa/api/webhooks/nbox`.

## Required Environment

```bash
NBOX_WEBHOOK_SECRET=replace-with-nbox-webhook-secret

NBOX_API_BASE_URL=https://nbox.now/api
NBOX_API_TOKEN=replace-with-nbox-api-token
NBOX_SHOP_DOMAIN=elitecollections.qa
NBOX_API_KEY=
NBOX_AUTH_HEADER=x-nbox-shop-token
NBOX_AUTH_SCHEME=

NBOX_RATE_ENDPOINT=/rates
NBOX_SHIPMENT_ENDPOINT=/order

NBOX_DEFAULT_SERVICE_CODE=
NBOX_DEFAULT_ITEM_WEIGHT_GRAMS=1000
NBOX_DEFAULT_ITEM_LENGTH_CM=35
NBOX_DEFAULT_ITEM_WIDTH_CM=25
NBOX_DEFAULT_ITEM_HEIGHT_CM=15
NBOX_ORIGIN_NAME=Elite Collections
NBOX_ORIGIN_PHONE=
NBOX_ORIGIN_EMAIL=admin@elitecollections.qa
NBOX_ORIGIN_ADDRESS=replace-with-pickup-address
NBOX_ORIGIN_CITY=Doha
NBOX_ORIGIN_STATE=Doha
NBOX_ORIGIN_COUNTRY=QA
NBOX_ORIGIN_ZIP=0000
```

Use `https://staging.nbox.now/api` for NBOX staging/testing. The live NBOX Now endpoints are `/rates` for quotes and `/order` for order/shipment creation.

Do not use your webhook URL for any of these outbound API settings. `https://elitecollections.qa/api/webhooks/nbox` is only for NBOX to call back into Elite after a shipment changes status.

`NBOX_API_TOKEN` is sent as the raw `x-nbox-shop-token` header. `NBOX_SHOP_DOMAIN` is sent as `x-nbox-shop-domain`; it must match the domain/store attached to that token in NBOX.

## Testing NBOX staging on the deployed production site

This changes the carrier environment for the entire server, including background booking retries. Schedule a controlled test window with public checkout paused and no pending real booking/retry work. SADAD sandbox and NBOX staging still create real local orders, reserve/deduct production inventory and send configured notifications. Record the original settings and test SKU balances first. Do not switch environments while real orders are awaiting payment or booking.

Deploy the environment-scoped token cache before switching: cached tokens now belong to the API base URL, shop domain and login email. Unscoped legacy tokens are ignored and refreshed. Restarting alone on older builds does not clear the database token.

In the private server environment, retain the existing seller login credentials confirmed for staging and set:

```bash
NBOX_API_BASE_URL=https://staging.nbox.now/api
NBOX_AUTH_HEADER=x-nbox-token
NBOX_RATE_ENDPOINT=/rates
NBOX_SHIPMENT_ENDPOINT=/order
```

Keep `NBOX_SHOP_DOMAIN` at the confirmed shop identifier and set the staging webhook signing secret provided by NBOX. Login credentials take precedence over `NBOX_API_TOKEN`. Restart every API/worker process so all use the same configuration. The published specification duplicates `/api` between its server URL and operation paths; the adapter currently uses a single `/api/login`. Confirm login and quote responses before paying or attempting bookings, and confirm staging cannot trigger real collections/charges.

Use only staff test contacts. Verify Pearl-only, warehouse-only and split orders, paid stock movements, admin notifications and signed staging tracking updates. Finish/cancel test shipments while still connected to staging and reconcile local stock using the existing audited physical restoration action when applicable; do not both restore and manually add the same stock. Resolve all pending test payments, bookings and retries before restoring production settings, production webhook credentials and live SADAD. Restart every process again, verify production connectivity, then reopen checkout. Changing environments does not itself cancel test orders or restore stock. This runbook does not implement a maintenance switch or per-order provider-environment isolation.

## Automatic multi-location fulfillment

Owners/admins configure this flow under **Settings → Integrations → Automatic NBOX delivery**. There is no activation toggle: saving a valid configuration enables automatic fulfillment for new checkouts. Until configuration is saved, the existing order flow remains in place. Enable stock per location first, select the existing The Pearl and Al-Rayyan stock locations, enter their pickup addresses, and select Al-Rayyan under **Warehouse location**. Leave the unused empty Warehouse inventory record unselected. Entry order determines shop priority. A physical pickup address must have one stock location; reconcile any branch/warehouse stock duplication before enabling. Existing paid orders waiting for manual approval must be resolved first. NBOX credentials and its webhook signing secret are required.

Allocation is deterministic:

1. A regular shop with the entire order supplies it alone.
2. Otherwise, Al Rayyan supplies it alone if it has the entire order.
3. Otherwise, use the smallest feasible set of origins, preferring shops over fallback stock on a tie.

Every selected origin has a separate delivery quote and shipment. There is no pickup fee. Two origins mean two delivery charges; three origins can mean three. Branch names/contact details stay internal. Public checkout shows each shipment's items, charge and the combined total.

Quotes are stored server-side for 15 minutes and bound to the visitor's session, catalog prices, quantities, address and configuration. Checkout rechecks location stock, atomically reserves it for 30 minutes and freezes the accepted delivery total. A stale plan requires customer review before payment. Product prices, dimensions, fees, origins and payment state cannot be overridden by browser fields.

Reservations reduce sellable stock but leave physical on-hand quantities unchanged until verified payment. POS/transfer/adjustment paths cannot consume those reserved units. Expired/failed payments release reservations once. A late payment may recover only its original plan; if stock is gone, the paid order is flagged for staff resolution without booking or charging extra.

SADAD callbacks/webhooks must pass signature verification, match the full order amount/currency, and include a transaction reference that has not paid another order. Missing amount/reference fails closed with a verification alert. A duplicate success cannot reverse a recorded refund. Manual “mark paid” is blocked for automatic orders.

The browser may return SADAD's form POST with the literal `Origin: null`. Only `POST /api/payments/sadad/callback` (including its trailing-slash form) bypasses that CORS rejection and session CSRF checks, so the existing checksum verification can authenticate it. The exception sends no CORS access/credential headers for null origins. Other routes/methods retain their origin and CSRF policies. Do not add `null` to `CORS_ORIGINS` or disable CSRF globally to accommodate this callback.

## Customer Checkout Flow

- Step 1 collects name, email, and phone.
- Step 2 collects delivery address.
- When the customer continues from delivery, the storefront calls `POST /api/carts/shipping-quote`.
- The server calls NBOX for each selected origin and returns the delivery fees and shipment item summaries.
- The checkout total becomes `subtotal + NBOX delivery amount`.
- The order cannot be submitted without an available NBOX quote.

## Shipment booking and recovery

For automatic orders, signed, amount-verified SADAD confirmation drives reservation consumption without admin approval. The admin bell/email includes the new order and its source preparation lists. Notification recipients use the existing Settings → Notifications configuration. The customer receives payment/confirmation emails.

Migration `047_automatic_fulfillment.sql` is registered in the existing boot migration runner. New orders carry `fulfillment_version=1`. Durable booking states live on each shipment; a worker sweeps every 15 seconds and continues existing automatic orders even if new automatic checkouts are disabled operationally. The internal `enabled` flag remains available for technical rollback; it is not an admin setting.

Each shipment freezes its origin, destination, items and quote and uses a stable child reference such as `EC-…-S1`. It stores its own provider ID, tracking and booking outcome. Advisory locks and idempotent allocations prevent duplicate local work. Explicit API rejection can be retried from order details. Timeout, lost response or interrupted booking becomes **uncertain**: staff must reconcile the child reference with NBOX and either attach the existing shipment or confirm it was not created, with an audit note. A successful sibling shipment is preserved.

Signed NBOX events update exactly one child shipment. Deduplication and monotonic status handling reject repeats/regressions. The order displays partial progress and completes only when all active shipments are delivered. Customer tracking is available on the thank-you page to the checkout session; admin details and invoices list each shipment.

Cancellation is per shipment and only before collection. A booked shipment needs NBOX cancellation confirmation. Stock is restored only after staff explicitly confirm the items are physically at the original location, once per allocation. Cancellation does not issue a monetary refund; refunds do not automatically restore stock or change the original delivery charges.

### Access boundaries

- Origin settings and recovery actions require an owner/admin session, tenant scoping and the existing CSRF protections.
- Quote and checkout rate limits, session-scoped retry keys, bounded pending reservations and stock locks limit duplicate/competing requests.
- NBOX credentials stay on the server. Request headers and customer payloads are omitted from adapter logs; public shipment responses omit origin/contact data and booking errors.
- `GET/PUT /api/admin/inventory/automatic-fulfillment` manages configuration.
- `POST /api/admin/orders/:order/deliveries/:shipment/action` handles retry, reconciliation, cancellation and physical restoration.
- `GET /api/payments/delivery-status/:publicNumber` returns shipment tracking only for its owning checkout session.

### Enablement gate

Local automated tests use an isolated PostgreSQL database, mocked carrier/payment data, and intercepted English/Arabic browser APIs. They do not prove live provider compatibility. Before saving the activating configuration, verify actual origin balances/addresses and notification recipients, then exercise NBOX and SADAD staging with single/split deliveries, signed payment amount/reference fields, late payments and cancellation/reconciliation.

The [NBOX seller specification](https://nbox.now/api/seller/openapi-spec.json), inspected 2026-10-01, defines one origin per order, string `orderNumber` identifiers, `lat`/`lng` coordinates and `displayRate` as the customer charge. Creation is asynchronous acceptance. It also exposes `/fulfilled`; confirm whether your account requires that separate readiness step to schedule collection and agree the packing timing before rollout. This implementation does not automatically call `/fulfilled`. Origin phone/contact are stored for staff; the published address schema has no carrier pickup-contact fields. Verify NBOX's account/location setup supplies the right contact at each branch.

Confirm SADAD's signed payload includes one of the supported amount fields (`TXN_AMOUNT`, `TXNAMOUNT`, `transactionAmount`, `transaction_amount`, `amount`) and the transaction reference used by the existing callback/webhook adapter. Missing or incompatible fields intentionally stop automatic fulfillment. No live staging transactions or deployment have been performed as part of this implementation.

## Webhook URL

```text
https://elitecollections.qa/api/webhooks/nbox
```

Subscribe to:

```text
shipment.update
```
