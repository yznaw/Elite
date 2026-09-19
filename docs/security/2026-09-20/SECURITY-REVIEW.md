# Elite Collection security review

**Remediation update:** the four issues selected by the owner have now been addressed in the local working tree. See [REMEDIATION.md](REMEDIATION.md) for changes, verification and rollout requirements. The findings and rechecks below are historical; the fixes have not been deployed.

## Latest-pull recheck: `930d9a4`

Rechecked on 20 September 2026 after the next user pull. A fresh fetch confirmed local HEAD and `origin/Elite-pos-fixes` match at `930d9a4` (zero commits ahead/behind). All 16 security-relevant files recorded in the original source manifest, including both dependency lockfiles, are byte-for-byte unchanged. The new commits concern colour/size selection, overlays, tests, and a small restock-notification selection fix; they do not address EC-01 through EC-12 below or the additional hardening findings.

All 12 isolated security assertions reproduced the same results against `930d9a4`, including the main-checkout protections and the remaining legacy price bypass, contact disclosure, ownership, inventory and upload flaws. Seven stock-availability unit tests passed. This is a local source recheck; deployment and production exploits were not tested again. No application code was edited or deployed. `offline-results.json` now records this latest revision; the original source manifest and live observations retain their original provenance.

**Date:** 20 September 2026, Asia/Amman. **Assessment:** significant security issues remain; remediation is needed before treating checkout and administration as secure.

**Reviewed repository:** `/Users/yazanmutlaq/Documents/GitHub/Elite`. Latest local and remote-tracking branch `Elite-pos-fixes` matched at `6926ad17641859e98a30098f7cd054a3e03355b2` after fetching origin. The working repository moved from `6f56ffe` to this revision during the review. Findings below describe the latest revision unless explicitly marked historical. The deployed backend revision was not independently established.

This was a review only. No application code was edited, no deployment was made, and no real order, payment, shipment, email, or customer-record mutation was submitted by this audit. The guest cart item added through the normal website was removed. Audit evidence and local-only verification scripts are saved beside this report.

## Scope and strength of evidence

- Source review: storefront carts, both checkout implementations, SADAD initiation/callback/webhook, contact submissions, admin route authorization, uploads, rich text, session/reset handling, customer matching, deployment headers, and dependency manifests.
- Twelve isolated checks ran against actual route/helper source, with database, payment signing, delivery, email and file writes replaced by test doubles. These establish application control flow; they do not establish full PostgreSQL integration, actual gateway acceptance, or live exploitability. The harness deliberately confirms both fixed behavior and remaining flaws; “verified” is not a security pass.
- Live checks: public pages; anonymous rejection on admin orders/customers and `/auth/me`; rejection of an untrusted Origin; empty-checkout validation; contact endpoint HEAD status without a response body; normal product selection, cart, checkout entry and removal.
- Production customer messages were **not downloaded**. No real order identifiers were enumerated. No brute force, load test, malicious upload, or payment forgery was attempted against production.
- Dependency counts describe the local lockfiles and current registry advisory results, not a verified inventory of production packages. Infrastructure, secrets, backups, payment-provider configuration, and authenticated production role behavior were not fully audited.

## Fixes present in the latest pull

Commit `6926ad1` fixes the main `/api/carts/checkout` path: it loads product/variant prices from the catalog, re-quotes delivery on the server, verifies variant relationships, and always creates the order as pending. The isolated tests confirmed that a supplied paid status is ignored, a QAR 0.01 price and zero delivery fee are overridden by fixture catalog/quote values, and a missing variant is rejected when the product has active variants.

The earlier findings that this **main** checkout could mark an unpaid order paid and trust submitted prices are historical at the reviewed revision. They must not be reported as still present on that path. However, the legacy checkout below bypasses these fixes.

## Remaining findings

### EC-01 — Critical: legacy checkout still permits price manipulation

**Evidence:** `server/routes/carts.route.js:802`, `:820`, `:859`, `:880`; `server/routes/payments.route.js:33` and `:62`.

The public `POST /api/carts/:id/items` route stores `req.body.price`. `POST /api/carts/:id/checkout` copies that cart subtotal into an order without calling the new catalog validation/pricing function. SADAD initiation then signs the stored order amount. The old route also bypasses the new delivery quote and variant/stock checks.

**Verification:** the isolated route sequence accepted a QAR 1 cart price, created an order at QAR 1, and passed QAR 1 to the payment-request builder despite the separate catalog fixture price being QAR 999. The real SADAD signature function was replaced; no payment was sent. The legacy order flow also does not insert the normal payments row, creating additional reconciliation inconsistency, but initiation does not require that row to exist.

**Remediation:** remove/disable obsolete checkout routes or make every cart/order creation path use the same authoritative pricing, product validation, stock, ownership and payment-ledger service. UI changes alone cannot close this route. Add integration tests that exercise every public checkout entry point.

### EC-02 — High: public contact endpoint exposes private enquiries

**Evidence:** `server/routes/contact.route.js:49` and `:53`; public mount in `server/routes/index.js`.

`GET /api/contact` returns all contact-submission columns and rows for the default tenant without authentication. Those records include names, email addresses, phones and message text. No identifier is needed.

**Verification:** the actual route returned a synthetic private message without authentication in the isolated harness. Anonymous production **HEAD** returned `200 application/json`; no production response body was requested. The number and contents of actual messages are unknown.

**Remediation:** retain public submission if required; move listing to an authenticated admin endpoint with an explicit permission check, pagination and a field allowlist.

### EC-03 — High: lower-privilege staff can mutate catalog, media and policies

**Evidence:** `server/routes/index.js:76`, `:85`, `:97`; mutation handlers in `admin-products.route.js`, `admin-media.route.js`, `admin-policies.route.js`.

These routers inherit `requireAuth()` but have no corresponding write-role gate. Unlike orders/customers, their mutation handlers do not restrict viewers. An active viewer can therefore reach product edits/deletions, media uploads/deletions and policy edits using API requests. Hiding controls in the frontend is insufficient. Several of these handlers also select the default tenant rather than the authenticated tenant, which needs correction before relying on multi-tenant isolation.

**Verification:** source authorization trace; not exercised with a production staff account.

**Remediation:** define a server-enforced role matrix, apply it to every mutation, and scope queries to the authenticated tenant. Test each route with viewer/cashier/manager/owner fixtures.

### EC-04 — High: image uploads can store active HTML on the application origin

**Evidence:** `server/middleware/upload.js:19`; `server/lib/storage.js:46` and `:50`; public static upload locations in `deploy/nginx/elite.conf`.

The file filter trusts the multipart MIME declaration. Storage preserves the user-supplied filename extension and writes raw bytes before image parsing; parsing failures do not reject the file. A file named `.html` and declared `image/png` passes this filter and remains HTML. Public static serving uses the file extension, permitting active content on the storefront/admin origin when opened. Upload requires a session, but EC-03 widens access to low-privilege staff.

**Verification:** actual filter and storage code accepted inert HTML bytes with an image declaration and produced a `.html` path in a virtual filesystem. No live upload or script execution was performed.

**Remediation:** validate decoded content; reject non-images; re-encode accepted images; derive extensions from trusted output formats; never publish original unvalidated bytes. Prefer a separate cookieless media origin and appropriate response restrictions.

### EC-05 — High: cart and payment access is not bound to the owning shopper

**Evidence:** `server/routes/carts.route.js:787`, `:802`, `:840`, `:859`; `server/routes/payments.route.js:33`, `:308`.

Legacy cart reads/writes/checkouts use a supplied cart UUID without checking the current session. Raw cart reads expose internal fields including `session_id`. Payment initiation selects an order solely by UUID and returns signed parameters containing its email and phone. Public payment-status lookup has the same ownership omission. Idempotency lookup is tenant/key scoped rather than session scoped.

**Verification:** an unrelated synthetic session could read a cart and initiate a payment response containing another synthetic customer's contact fields. **Exploiting a specific existing cart/order requires its identifier; UUID guessing was neither demonstrated nor attempted.** Leaked identifiers must not substitute for authorization.

**Remediation:** bind carts/orders to the initiating session or a purpose-specific, expiring, high-entropy capability; enforce it on all reads, writes and payment initiation. Return minimal public fields and never raw session identifiers.

### EC-06 — High: duplicate lines and concurrent checkouts can oversell stock

**Evidence:** `server/routes/carts.route.js:573` onward; `server/lib/order-stock.js`.

The latest checkout checks each line separately. Two lines for the same variant, each requesting one unit, both pass when only one unit exists. Stock is not reserved at checkout, so separate transactions can also pass before either payment is confirmed. A product with no active variants can take the base-product path without a product-stock check. The cart's “PIECE RESERVED” wording does not represent an actual inventory reservation.

**Verification:** two duplicate fixture lines were accepted with stock equal to one. Concurrent real transactions and the base-product case were reviewed in source, not database-tested.

**Remediation:** aggregate by variant, validate the aggregate, handle base-product stock explicitly, and use atomic expiring reservations across online and POS inventory. Release reservations on expiry/failure and consume them on verified payment.

### EC-07 — Medium: submitted email can cancel another shopper's pending orders

**Evidence:** `server/routes/carts.route.js:665` onward; customer resolution in `server/lib/customer-identity.js`.

New checkout cancels other pending orders matching the submitted email, without proving ownership of that email or the prior checkout session. Customer matching also updates name/city/country and can fill identifiers using unverified phone/email matches. This permits order disruption and customer-profile contamination; it is not evidence of customer account takeover.

**Verification:** isolated checkout executed the email-only cancellation query. No production cancellation or profile mutation was attempted.

**Remediation:** scope retry/supersession to the same authenticated session or checkout capability; verify identifiers before allowing them to update established customer identity. Keep unverified order contact details separate from trusted customer fields.

### EC-08 — High: stored rich text is inserted directly into the admin DOM

**Evidence:** `client/projects/admin-portal/src/app/shared/rich-text/rich-text.component.ts:162`; `server/routes/admin-policies.route.js:89` and `:127`; policy drawer uses `ap-rich-text`.

Policy content is stored without HTML sanitization and assigned using `nativeElement.innerHTML`, bypassing Angular template sanitization. Malicious event-handler markup could execute when another staff member opens the editor. EC-03 allows a viewer to write such content, making the potential impact greater than self-XSS.

**Verification:** source-to-DOM dataflow confirmed; browser execution with malicious content was not attempted.

**Remediation:** sanitize rich text with a maintained allowlist at ingestion and before direct DOM insertion. Restrict URLs, SVG and event attributes; add an enforced compatible CSP as defense in depth.

### EC-09 — Medium: payment confirmation does not reconcile settlement fields

**Evidence:** `server/routes/payments.route.js:103`; `server/routes/sadad-webhook.route.js:16`.

Both handlers verify a checksum, which is a positive control. However, they then map a status to paid without reconciling expected amount, currency, merchant and unique transaction ownership against the stored payment attempt. The signature implementation itself was not demonstrated bypassable.

**Verification:** after a deliberately successful signature test double, the callback accepted an amount-mismatched synthetic event without reading the expected amount. This proves a missing check, **not** that an attacker can forge a valid SADAD event.

**Remediation:** use the provider's documented authenticated settlement fields or server-to-server verification, compare them to the immutable attempt, and enforce uniqueness/state transitions atomically.

### EC-10 — Medium: webhook acknowledgment precedes durable processing

**Evidence:** `server/routes/sadad-webhook.route.js:18` and `:71`.

The handler acknowledges success before verification or durable event recording. A crash/database failure after acknowledgment can lose the payment update. Duplicate detection checks transaction number rather than a durable event/state record; an already-paid order path returns without reliably replaying all fulfillment/stock side effects. A separate browser callback may repair some cases, but cannot be assumed to arrive.

**Remediation:** durably record verified events before acknowledgment, process through an idempotent worker, and reconcile pending payments with SADAD. Test crashes between status, ledger, stock, receipt and delivery steps.

### EC-11 — Medium: HTML pages lack browser security headers

**Live evidence:** homepage, checkout and admin HTML responses lack CSP, frame restrictions, `nosniff` and Referrer-Policy. They also omit HSTS, although same-host API responses do send it; therefore this is inconsistent coverage, not an assertion that HSTS is absent everywhere. The API CSP is report-only.

API response headers do not apply a CSP to the separate HTML documents. This leaves the admin document without clickjacking protection and weakens defense against EC-04/EC-08.

**Remediation:** set appropriate headers on the actual nginx/SSR HTML responses, including error/fallback paths. Design the storefront CSP for Angular and the observed SADAD form destination before enforcement. Do not blindly copy the API's `form-action 'self'`, which would prevent external payment submission.

### EC-12 — High advisory exposure: outdated production dependencies

Registry audit reports **5 affected server dependency entries (3 high, 2 moderate)** and **10 client dependency entries (1 high, 9 moderate)** with development dependencies omitted. These are package entries, not 15 proven website exploits.

- Angular platform-server `22.0.7` is in affected ranges for [SSR XSS](https://github.com/angular/angular/security/advisories/GHSA-v3p8-whq6-r5jg) and [SSR URL-resolution/credential disclosure](https://github.com/angular/angular/security/advisories/GHSA-f6mr-pjwc-34m4). The referenced fixes start at `22.1.4` for that major; audit recommends a newer compatible release. Upgrade the Angular packages consistently. These attacks require the conditions described by the advisories; site-specific exploitability was not demonstrated.
- Sharp `0.35.3` is below the `0.35.4` fix for the [libheif-related advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- Nodemailer `9.0.3` has several reported advisories, including [address-parser denial of service](https://github.com/advisories/GHSA-2x7j-588g-ccc2). Upgrade to a release clearing all current advisories, not just one threshold. Its `ip-address` dependency also has high entries.

**Remediation:** update in a branch, rebuild web/admin/SSR, rerun audit and the image/email/payment regression suite, then verify deployed versions. No dependency update was applied during this review.

## Additional hardening and correctness findings

- **Session/reset lifecycle — Medium, source-confirmed:** login assigns `session.user` without session regeneration (`auth.route.js:73`); password reset does not revoke existing sessions (`:219`); usable reset URLs are printed to logs (`:167`) without a production guard. Reset tokens should be consumed atomically, existing sessions invalidated, session IDs rotated at login, and reset links delivered privately rather than logged. A session-fixation exploit was not demonstrated.
- **Abuse limits — Medium, source-confirmed:** cart/checkout/payment initiation/contact routes have no route-specific rate limit in the reviewed app/nginx configuration. Contact can trigger mail; checkout can occupy database connections and call a delivery API. Add bounded request sizes, item/quantity limits, session/IP throttles and idempotency. No production load testing was performed; external controls may exist.
- **Money rounding — Low, reproduced:** shared `fromCents(1050)` returns `11`, not `10.5` (`server/routes/lib.js:19`). This can make displayed/returned amounts differ from charged minor-unit amounts. Preserve two-decimal precision throughout conversion and test fractional prices/delivery fees.

## Positive controls observed

Anonymous production calls to admin orders, admin customers and `/auth/me` returned 401. An untrusted Origin was rejected with 403. Empty checkout returned 422. The normal browser flow displayed an in-stock size, prevented increasing the last-unit selection, showed matching QAR 980 cart/checkout totals, and disabled continuation after the audit item was removed. Relevant SQL values are generally parameterized. Session cookies are configured HttpOnly in source, and authenticated authorization rechecks active status/role against the database. These controls do not close the findings above.

## Recommended order of work

1. Close the legacy price/checkout bypass and public contact listing; confirm the main checkout fix is deployed.
2. Enforce mutation roles, harden image uploads/rich text, and bind carts/orders/payment initiation to owners.
3. Fix aggregate inventory checks/reservations, email-only cancellation and payment event durability/reconciliation.
4. Upgrade affected dependencies, apply HTML response headers, and improve session/reset/abuse controls and decimal handling.
5. Validate in an isolated PostgreSQL environment with provider sandbox credentials, including duplicate lines, concurrent checkouts, cross-session access, low-privilege mutation attempts, replayed events and failure recovery. This report is not a certification that all other vulnerabilities are absent.

## Evidence files

- `offline-proofs.cjs` — local-only reproduction harness; run with `node docs/security/2026-09-20/offline-proofs.cjs` from the repository. Optional `--baseline` reads historical source through local git only.
- `offline-results.json` — 12 checks on the latest reviewed revision; `historical-results.json` — clearly separated historical checks.
- `live-checks.json`, `live-boundary-checks.json` — response observations with cookie values excluded and no contact-message bodies.
- `server-dependencies.json`, `client-dependencies.json` — registry advisory evidence.
- `source-manifest.json` — revision identifiers and SHA-256 hashes of relevant reviewed files.
