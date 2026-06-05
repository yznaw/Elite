# 10 - NBOX Integration

Elite integrates with NBOX in two directions:

1. Checkout asks NBOX for delivery availability and price after the customer enters the delivery address.
2. Once payment is confirmed as `paid`, Elite creates a shipment in NBOX.
3. NBOX sends shipment status updates back to `https://elitecollections.qa/api/webhooks/nbox`.

## Required Environment

```bash
NBOX_WEBHOOK_SECRET=replace-with-nbox-webhook-secret

NBOX_API_BASE_URL=https://uat.portal.nbox.qa
NBOX_API_TOKEN=replace-with-nbox-api-token
NBOX_API_KEY=
NBOX_AUTH_HEADER=Authorization
NBOX_AUTH_SCHEME=Bearer

NBOX_RATE_ENDPOINT=replace-with-rate-endpoint-path
NBOX_SHIPMENT_ENDPOINT=replace-with-create-shipment-endpoint-path

NBOX_DEFAULT_SERVICE_CODE=
NBOX_DEFAULT_ITEM_WEIGHT_GRAMS=1000
NBOX_ORIGIN_NAME=Elite Collections
NBOX_ORIGIN_PHONE=
NBOX_ORIGIN_EMAIL=admin@elitecollections.qa
NBOX_ORIGIN_ADDRESS=
NBOX_ORIGIN_CITY=Doha
NBOX_ORIGIN_COUNTRY=QA
```

`NBOX_RATE_ENDPOINT` and `NBOX_SHIPMENT_ENDPOINT` must come from NBOX's merchant/API documentation. The app keeps them configurable because NBOX may expose account-specific endpoint paths.

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

