# Security remediation — requested four findings

Implemented locally on top of `930d9a4`; not committed, pushed or deployed by this task. The earlier audit describes the pre-fix code and remains historical evidence.

## Changes

| Finding | Resolution |
| --- | --- |
| Legacy checkout accepts customer prices | Retired `POST /api/carts` and all ID-based cart endpoints with 410. The storefront retains one authoritative checkout path that loads catalog prices, re-quotes delivery and creates pending orders only. No order can be created through the old client-priced cart path. |
| Public enquiry listing | Removed public GET/HEAD listing. Added `/api/admin/contact` with owner/admin/manager access, authenticated-tenant filtering, a field allowlist, pagination and no-store responses. Public form submission remains available. |
| Staff mutation permissions | Added a shared server-side write gate across all admin routers. Viewer/cashier cannot mutate catalog, collections, media, policies or new admin routes. Existing stricter owner/admin gates remain effective. Read-only catalog access is preserved. |
| Unsafe uploaded content | Actual raster decoding and WebP rewriting before any file write; random storage names independent of input extension; SVG, HTML and corrupt content rejected. Metadata/trailing content stripped. Limits: 50 MB input, 40 million total pixels, 100 frames. Supported animation preserved. Sharp updated to 0.35.4. Express and nginx deny active legacy upload extensions and set nosniff/sandbox headers. |
| Missing cart/payment ownership | The surviving cart endpoints derive their cart from the signed session. Checkout persists that session before creating the order and stores a one-way ownership binding. Public payment initiation/status require the same session and a storefront-origin order. A UUID alone grants no access. Retry keys are session-scoped and concurrent retries serialized. Same-email submissions cannot cancel a different session's orders. Sensitive cart/payment responses use no-store. |
| Duplicate-line stock bypass | UUIDs are canonicalized before aggregation. Quantities are summed per inventory identity, independent of duplicate lines, letter case and equivalent size strings. Aggregate stock and quantity limits are checked under ordered row locks; base products are checked too. Cart additions aggregate existing quantities without using size spelling as a separate stock bucket. Invalid quantities are rejected, not silently clamped. |

The implementation follows [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) on server-side permission checks and [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) on content validation, rewriting and safe storage names. Sharp behavior was checked against its [input](https://sharp.pixelplumbing.com/api-constructor/) and [output](https://sharp.pixelplumbing.com/api-output/) documentation.

## Verification

- Node 22.23.2, disposable local PostgreSQL 14 over a Unix socket, separate uploads directory. Local environment credentials were blanked; no production database or payment/delivery service was used.
- **19 tests passed, zero failures/skips** across the new security and image tests plus existing cart pricing/stock, catalog save, logo, media preview/orphan handling, staff role gates and multi-owner tests.
- Integration tests exercise the actual Express middleware, signed cookies, CSRF headers and SQL. They cover cross-session reads/payment initiation, unbound historical orders, retries, email-scoped cancellation regression, duplicate UUID/size spellings, forged prices/paid status/delivery charges, base-product stock and viewer/cashier mutations.
- File tests exercise real Sharp decoding: HTML/SVG/truncated inputs fail; JPEG/PNG/GIF/WebP/AVIF work; animated GIF remains animated after rewriting; an image named `.html` is stored as actual WebP; trailing content is discarded; pre-existing `.html` uploads are refused by Express.
- Storefront production build passed, including SSR. Existing stylesheet-size warnings remain.
- `git diff --check` passed. The dependency audit no longer flags Sharp. Unrelated Nodemailer/ip-address advisories remain outside this requested remediation.
- nginx is not installed locally; its deployment configuration has been edited and reviewed but must pass `nginx -t` on the deployment host before reload. Production behavior has not been re-tested because no deployment was authorized.

Regression entry points: `server/test/storefront-security-e2e.test.js`, `server/test/storage-security.test.js`, and the updated `server/test/cart-pricing-e2e.test.js`. Use a fully migrated disposable test database and disable external integrations before running database-backed tests; never aim these tests at production.

## Rollout requirements and limits

1. Install the updated locked server dependencies and deploy API and storefront together. Keep the normal production session secret stable and configure Secure cookies/HTTPS correctly.
2. Apply the reviewed nginx upload rules for both storefront and admin hosts, validate with `nginx -t`, then reload. nginx directly serves production media, so deploying only Express would not block pre-existing active uploads there.
3. Existing orders do not have the new ownership binding. Their public payment initiation/status will fail closed; affected shoppers must start a fresh checkout. Existing signed provider callbacks continue to work, including callbacks for payment attempts already in progress. Do not fabricate session bindings for old orders or reset paid orders.
4. Validate checkout and media behavior with payment-provider sandbox credentials before production rollout. The tests verify generated signing parameters, not an actual SADAD transaction.

This fixes the selected **duplicate-line** bypass; separate pending checkouts still do not reserve inventory across customers/POS. A full reservation/payment-reconciliation redesign remains separate work. Other audit topics, including rich-text sanitization, complete tenant-isolation review of legacy admin handlers, reset-session lifecycle, HTML page headers and durable webhook processing, are not represented as resolved by this change.
