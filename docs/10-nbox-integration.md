# 10 - NBOX Integration

Elite integrates with NBOX in two directions:

1. Checkout asks NBOX for delivery availability and price after the customer enters the delivery address.
2. Once payment is confirmed as `paid`, Elite creates a shipment in NBOX.
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

## Customer Checkout Flow

- Step 1 collects name, email, and phone.
- Step 2 collects delivery address.
- When the customer continues from delivery, the storefront calls `POST /api/carts/shipping-quote`.
- The server calls NBOX and returns the selected delivery service, ETA, and amount.
- The checkout total becomes `subtotal + NBOX delivery amount`.
- The order cannot be submitted without an available NBOX quote.

## Shipment Booking Flow

The server creates the NBOX shipment only after payment is confirmed as `paid`.

Current triggers:

- A future payment gateway can call `POST /api/carts/checkout` with `payment.status = paid`.
- SADAD callback/webhook confirms payment and books NBOX delivery.
- The admin portal can mark an order as paid; `PATCH /api/admin/orders/:id/status` then attempts NBOX booking.

If NBOX booking succeeds, Elite stores:

- Shipment carrier `nbox`
- Tracking number and tracking URL if returned by NBOX
- NBOX raw response in order metadata
- Timeline entry on the order

If NBOX later sends updates, the webhook updates fulfillment status and tracking history.

## Webhook URL

```text
https://elitecollections.qa/api/webhooks/nbox
```

Subscribe to:

```text
shipment.update
```
