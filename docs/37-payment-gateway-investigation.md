# Payment gateway investigation — 18 September 2026

## Confirmed live findings

Checks ran at approximately 10:31–10:34 UTC against `elitecollections.qa`.

- `/api/health` returned HTTP 200 and reported a healthy database.
- SADAD's `https://sadadqa.com/webpurchase` returned an auto-submitting form
  forwarding the request to `https://payment.sadadqa.com/webpurchase`.
- An unsigned POST to `/api/payments/sadad/callback` with
  `Origin: https://payment.sadadqa.com` returned HTTP 403,
  `CORS_ORIGIN_DENIED`, and the message
  `CORS blocked: origin https://payment.sadadqa.com not allowed`.
  Request reference: `a8ee1e2cfedb`.
- The same callback endpoint accepts the original `https://sadadqa.com`
  origin and redirects an unsigned request to `reason=invalid_signature`,
  as expected. The failure with the new host therefore occurs before payment
  signature verification or order processing.
- POST `/webhooks/sadad` returned HTTP 404 with the storefront's HTML error
  page. The checked-in nginx configuration lacks a route for that endpoint,
  although Express registers it. Notifications sent to this public URL
  cannot reach the payment handler.

These are payment-confirmation defects. Without an affected transaction or
production logs, neither proves where the reported customer's attempt failed.
The webhook URL saved in the SADAD merchant panel remains unverified.

## Additional findings requiring live configuration access

A diagnostic payment-page request signed using the **local** `.env` settings
was rejected by SADAD with `Checksumhash did not match.` Both lowercase and
uppercase signatures were rejected. No card details were entered, no payment
was completed, and no storefront order was created. The diagnostic reference
began with `DIAGNOSTIC`; the requested amount was QAR 1.

The local settings may differ from production. Confirm the live merchant ID,
secret key, registered website and test/live mode in the merchant panel before
attributing this rejection to a specific credential or code defect. SADAD's
current request-signature guide specifies uppercase output; changing case
alone did not resolve this diagnostic rejection.

The local `SERVER_URL` is `https://api.elitecollections.qa`, which did not
resolve in DNS during this check. The payment code uses this value for its
callback unless `SADAD_CALLBACK_BASE` overrides it. Verify production has:

```dotenv
SADAD_CALLBACK_BASE=https://elitecollections.qa
STOREFRONT_URL=https://elitecollections.qa
```

Do not assume the local environment is the production environment.

## Prepared local fixes

- Add the exact `https://payment.sadadqa.com` origin to the existing SADAD
  allowlist; signature checks remain required.
- Document the additional origin in `.env.example`.
- Route the exact `/webhooks/sadad` path through nginx to the API, preserving
  the original path and request body.
- Extend regression coverage to exercise callback POSTs from the payment host,
  with and without a CSRF cookie, and reject a lookalike untrusted hostname.

Validation: `node --test server/test/cors.test.js` passed all five reported
tests; `git diff --check` passed. nginx is not installed locally, so the
production configuration still requires `nginx -t` before reload.

## Remaining production work

SSH authentication to the documented server IP was denied. No server files,
runtime configuration or live orders were changed.

1. Review the running environment and recent payment errors; compare the
   merchant configuration with SADAD without printing secrets.
2. Deploy the API allowlist fix. Merge the exact webhook location into the
   active storefront nginx server block; validate with `nginx -t` before
   reloading. Follow the existing deployment runbook.
3. Confirm the callback base above and the merchant-panel webhook URL
   `https://elitecollections.qa/webhooks/sadad`.
4. Repeat the unsigned probes: the payment-host callback should redirect to
   `invalid_signature` rather than return 403; the webhook should return
   HTTP 200 and `{"status":"success"}` without changing any order.
5. Resolve the signed-request rejection using the verified credentials, then
   verify checkout end to end in SADAD test mode. A real charge was not part
   of this investigation.

References:

- [SADAD request signature](https://developer.sadad.qa/web-checkout_2.1/signature-generation/)
- [SADAD callback verification](https://developer.sadad.qa/web-checkout_2.1/callback-verification/)
- [SADAD webhook requirements](https://developer.sadad.qa/web-checkout_2.1/webhook/)
