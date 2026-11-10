# NBOX automatic fulfillment and multiple deliveries

Date: 2026-10-01 (Asia/Amman)
Status: local implementation and automated verification completed; production enablement and provider staging acceptance remain pending. See [NBOX integration runbook](10-nbox-integration.md).

## Implementation record

- Updated 2026-10-02: admin setup has no automatic-fulfillment toggle. Saving valid origins and a warehouse activates the flow by default after readiness validation. The user-facing label is **Warehouse**, mapped to the existing Al-Rayyan location. The unused empty Warehouse stock record is not an additional origin. An internal disable flag remains for technical rollback. This supersedes the activation-toggle steps in the original plan below.

- Migration 047 adds session-owned quotes, specific-location reservations, shipment allocations, provider transaction claims and deduplicated events. Existing orders retain their previous workflow.
- The allocator selects a complete shop first, then complete Al Rayyan, then the smallest feasible origin set. Checkout displays separately quoted deliveries and requires review after a quote change.
- Quotes expire after 15 minutes; stock reservations expire after 30 minutes. These lifetimes are currently fixed and must be checked against the actual SADAD session window before rollout.
- Verified payments consume reservations automatically. Persisted shipment booking states and a 15-second worker recover interruptions. Ambiguous external requests require reconciliation; no blind create retry is performed.
- Settings → Integrations configures origins. Order details expose each preparation list, tracking, exceptions and audited recovery actions. Existing configured admin recipients receive the order notification with source details; there is no new per-branch recipient routing.
- Physical stock restoration is shipment-specific and explicitly confirmed. Refund processing remains separate. Automatic orders cannot be manually marked paid to bypass gateway verification.
- Each configured stock location must represent a distinct pickup address. Shared branch/warehouse inventory must be reconciled into one location before enablement; automatic merging of multiple stock pools at one address is not implemented.
- Customer tracking is session-bound on the thank-you page. This change does not add new shipped/delivered email templates or an automatic NBOX `/fulfilled` readiness call. The carrier's collection/readiness process must be confirmed in staging before enabling dispatch.
- NBOX's public seller schema was inspected on 2026-10-01: string child references, `lat`/`lng` coordinates, customer `displayRate`, and cancellation using `orderNumber` are reflected in the adapter. Live provider behavior has not been verified.
- Automated validation: allocator and carrier adapter tests; isolated PostgreSQL stock, payment, ownership, booking, tracking and recovery scenarios; existing stock/approval/security/notification regressions; English/Arabic admin and storefront browser scenarios; both Angular production builds.

## Agreed outcome

- Notify admin when a website order is confirmed paid. Do not require admin approval for new orders using this flow.
- Keep accurate stock by size, colour, quantity, and location.
- Prefer a regular shop that can fulfill the complete order.
- If neither regular shop can fulfill the complete order but Al Rayyan can, fulfill the whole order from Al Rayyan.
- Otherwise split across the fewest necessary pickup origins; use Al Rayyan for shortages the shops cannot cover.
- Each origin-to-customer shipment has its own NBOX delivery quote and charge. There are no separate pickup fees or shared collection-batch fees.
- Show the combined delivery amount and shipment count before payment; automatically book after verified payment.
- Keep one customer order with separately tracked shipments. Complete the order only when all required quantities have been delivered.

## Baseline gaps used for the original plan

| Area | Current behavior | Required change |
| --- | --- | --- |
| `server/lib/location-stock.js`, `server/lib/order-stock.js` | Location balances exist; web stock is held after payment pending manual allocation. | Reserve specific locations before payment and consume reservations automatically after payment. |
| `server/lib/order-approval.js` | Staff choose one location that must contain every item. | New orders use automatic allocation, including split quantities. Preserve historical approvals. |
| `server/routes/carts.route.js` | Resolves prices server-side, checks stock, requests one quote; stock is not reserved before payment. | Generate and validate a fulfillment plan, quote its shipments, reserve inventory and freeze the accepted price. |
| `server/lib/nbox.js` | Uses global `NBOX_ORIGIN_*`; one products list and quote per order. | Accept a persisted origin and allocated products per shipment. |
| `server/lib/order-delivery.js` | Stops when any NBOX shipment exists for an order. | Book and retry at shipment level with separate provider references. |
| `server/routes/nbox-webhook.route.js` | Updates shipments by order and directly sets order fulfillment status. | Match one shipment, then derive order progress from all shipments. |
| `server/lib/staff-notify.js` | Paid-order bell/email exists; approval reminders also exist. | Reuse notifications, add allocation details for authorized staff and exception alerts; omit approval reminders for automatic orders. |
| `server/lib/order-confirmation.js` | Customer confirmation requires `approved_at`. | Trigger from automatic paid-order confirmation without inventing a staff approval. |
| `server/lib/pending-order-cleanup.js` | Assumes unpaid orders need no stock release. | Release expired reservations safely and reconcile late payments. |
| Admin APIs and clients | Single delivery summaries and manual approval UI. | Shipment arrays, partial progress, per-shipment recovery; historical compatibility. |

## Phase 1 — Configure stock locations and NBOX origins

1. Add persistent origin settings: display name, complete address, coordinates, contact, enabled status and NBOX mapping where applicable.
2. Link each eligible inventory location to an origin. Configure Al Rayyan by stable location ID as the fallback, not by matching its name.
3. Verify whether Al Rayyan branch and warehouse represent the same stock pool or separate stock pools at one address. Never count the same inventory twice. Combine allocated items at one origin into one shipment only when they can physically be prepared as one consignment and NBOX supports it.
4. Set deterministic shop priority when both shops can supply the whole order. Proposed default: configured priority, rather than changing origins on every request.
5. Validate configured addresses and stock balances before enabling automatic fulfillment. Missing origin configuration must produce a clear error, not silently use the old global address.

NBOX's published seller specification documents multiple shop locations and one origin per order request: https://nbox.now/api/seller/openapi-spec.json. Before enabling booking, verify the current seller contract in staging: origin selection, quote fields, string order references, cancellation/fulfillment identifiers, duplicate request behavior, and whether a separate ready/fulfilled call schedules collection. Do not infer those behaviors from the local adapter alone.

Deliverable: admin configuration for the two regular shops and Al Rayyan, with validated stock-to-origin mappings.

## Phase 2 — Add allocation and shipment records

Use additive, idempotent migrations registered in the existing boot migration mechanism. Select the migration number at implementation time.

Proposed records:

- A versioned fulfillment plan tied to the order, carrying its source rules, destination/cart fingerprint and lifecycle state.
- Allocation rows containing order item, variant, inventory location, origin, quantity, reservation expiry and state. Allow one order item to have quantities at multiple locations; the current unique `(order_id, variant_id)` hold model cannot represent that alone.
- Shipment records linked to the plan and origin, with immutable origin/destination snapshots, quote, customer delivery amount, carrier cost when returned, provider reference, provider shipment ID, tracking and booking state.
- Shipment-item rows identifying exactly which allocated quantities each shipment carries.
- Durable job/outbox records for booking and notifications, with unique business keys and recoverable worker claims.

Keep the customer's original order totals and line quantities authoritative. Allocations must sum exactly to the ordered quantity, and each allocation must belong to exactly one active shipment. Track money in integer minor units and verify currencies before summing quotes.

Maintain legacy fields for existing integrations while consumers move to shipment arrays. Do not overwrite the historical order-level NBOX metadata each time a child shipment changes.

Deliverable: a schema that supports multiple origins and reservations without changing existing orders.

## Phase 3 — Implement deterministic automatic allocation

Implement one reusable server-side allocator for quote, checkout validation and controlled recovery:

1. Resolve genuine product variants and requested quantities server-side.
2. Use available quantity after active reservations, respecting enabled locations and serviceable origins.
3. If a regular shop can supply every line in full, select that shop using configured priority.
4. Otherwise, if Al Rayyan can supply every line, select Al Rayyan alone.
5. Otherwise enumerate feasible origin subsets and choose the smallest number that covers the complete order. There are only three configured origins, so a general route optimizer is unnecessary.
6. Among equally small plans, prefer regular-shop stock before fallback stock, then configured location priority. Split a line's quantity when necessary.
7. Group all allocated items for each physical origin into its shipment. No empty shipment is allowed.
8. If total eligible availability is insufficient, return line-level shortages and do not start payment.

Do not silently bypass the agreed shop-first rule simply because another source has a lower delivery quote. If a chosen route cannot be quoted, report unavailability or present a newly calculated feasible plan for review before payment.

Deliverable: repeatable allocation with an explanation such as “Al Rayyan holds the whole order; two shop deliveries avoided.”

## Phase 4 — Quote, reserve and freeze before payment

1. Return a server-generated quote/plan identifier, expiry, shipment count, per-shipment item summary, fees, currency and total to checkout.
2. Quote each origin using only its allocated quantities and the customer's destination. Sum the customer-facing delivery amounts; keep carrier cost separate when the API returns both.
3. Display “This order arrives in 2 deliveries” and each delivery fee. Branch names and internal stock details remain staff-only.
4. On order submission, verify ownership and the cart/address/price fingerprint. Briefly lock inventory rows in a consistent order, revalidate the accepted plan, and persist reservations and the pending order atomically.
5. Do not make NBOX network calls while holding inventory locks. If stock, price or plan validity changed, leave the customer at checkout with a refreshed plan to accept before starting payment.
6. Reservations reduce sellable availability everywhere: storefront, POS, transfers, adjustments and other checkouts. Physical on-hand stock decreases only when reservations are consumed. Define and test that accounting invariant so payment cannot deduct stock twice.
7. Set a configurable reservation lifetime aligned with the SADAD payment session. Payment initiation rejects expired plans. Failed/abandoned payments release reservations once.
8. For payment confirmed after expiry, atomically attempt to recover the same fulfillment plan. If it cannot be recovered, record payment honestly and raise a paid-order exception; do not oversell, silently add fees, or book an unapproved replacement plan.

Deliverable: the amount charged by SADAD matches the delivery plan the customer accepted.

## Phase 5 — Confirm and book automatically

1. Route SADAD browser callbacks, SADAD webhooks and authorized manual paid transitions through one idempotent paid-order handler.
2. In a transaction, consume valid reservations, record location stock movements, confirm the order, and enqueue one booking task per shipment plus notification tasks.
3. Send the existing paid-order admin notification without an approval requirement. Provide each relevant branch its preparation list through configured recipients and existing access controls.
4. Send the customer receipt/confirmation without relying on `approved_at`. Record the automatic action as system-generated.
5. Book each shipment independently with its saved origin, items, shipping charge and stable unique external identifiers. For example, a parent order can have `-S1` and `-S2` references. Replace the current digit-stripping reference conversion so child references cannot collide.
6. Persist the provider shipment ID even when tracking is not yet returned. Store failures against the particular shipment.
7. Retry only known-safe failures. If NBOX may have accepted a request before a timeout or local save failure, reconcile by stable reference or confirmed provider idempotency; if that cannot be verified, flag it for investigation rather than blindly creating another shipment.
8. If one shipment books and the other fails, keep the successful booking and retry/reconcile only the failed one. Customer payment remains recorded as paid.
9. Separate shipment creation from readiness for collection if NBOX requires it. Automatic collection scheduling must follow agreed preparation timing; a packing/readiness status is not an order approval.

Deliverable: paid orders proceed without staff approval, with recovery limited to genuine exceptions.

## Phase 6 — Track shipments and handle cancellations independently

- Match webhooks using provider shipment ID or the unique child reference, scoped to the correct tenant. Never update all shipments using only the parent order ID.
- Deduplicate events and prevent stale events from regressing status. Preserve the provider's event ordering information where available.
- Distinguish scheduled collection from physically collected items.
- Expose partially shipped/partially delivered progress explicitly in APIs and both clients. Completion requires delivery of every required, non-cancelled quantity.
- Show shipment-specific items, fees, tracking, status and booking errors in admin; show customer-friendly delivery progress in order pages and emails.
- Make admin retry, tracking edits, cancellation and return actions shipment-specific. Update order lists, invoices/printing and any customer-history endpoint that currently selects one shipment with `LIMIT 1`.
- Pending-order cancellation releases reservations exactly once. After allocation, restore stock only when cancellation/physical return justifies it, to the correct location. Refunding money does not automatically prove stock has returned.
- Record refunds and changes to shipping charges explicitly under the agreed refund policy; do not silently rewrite the original paid amount.

Deliverable: one parcel can be delivered while the other remains in transit without completing the entire order.

## Phase 7 — Test and roll out

Required acceptance scenarios:

| Scenario | Expected result |
| --- | --- |
| Shop A has every item | One shipment from A, one quote. |
| Both shops have every item | Configured priority selects one; no split. |
| Shops would require a split; Al Rayyan has everything | One shipment from Al Rayyan. |
| Only A + B can cover the order | Two shipment quotes; checkout charges their sum. |
| Only A + Al Rayyan can cover the order | Two shipments with correct quantities. |
| All three origins are necessary | Three deliveries shown and charged before payment; no hardcoded maximum of two. |
| One variant's quantity spans locations | Correct quantity per shipment, no duplication. |
| Stock is insufficient everywhere | Checkout stops before payment. |
| Two checkouts or a POS sale compete for the last unit | Reservation/locking rules prevent both allocating the same unit. |
| Quote expires or address/cart changes | Requote before payment; reject the stale plan. |
| Payment fails, expires, or confirms late | Reservations and paid-order exceptions handled without negative stock. |
| Callback and webhook arrive repeatedly/concurrently | One stock consumption and one set of shipment jobs. |
| One booking fails or times out ambiguously | Successful shipment is retained; no duplicate booking. |
| Webhooks arrive duplicated or out of order | Only the matching shipment changes; no status regression. |
| First of two shipments is delivered | Order displays partial delivery. |
| Last required shipment is delivered | Order becomes fully delivered. |
| Cancellation, return or partial refund | Correct quantities and money recorded once. |
| Historical single-shipment/manual orders | Remain readable and usable without rebooking. |

Run meaningful allocator unit tests, database/payment/webhook integration tests, and checkout/admin browser scenarios in English and Arabic. Run the relevant existing stock, POS and order regressions, both Angular production builds, then NBOX staging contract tests.

Rollout sequence:

1. Deploy additive schema and code with new automatic fulfillment disabled.
2. Configure origins, stock mappings, fallback, recipients, and payment reservation timing; reconcile location balances.
3. Exercise single-origin and split-origin workflows in staging, including cancellation and timeout recovery.
4. Enable for new checkouts behind a tenant-level feature flag. Persist the flow version on each order so disabling the flag later does not strand in-flight automatic orders.
5. Preserve existing shipment bookings. Review legacy paid/unapproved orders separately; transition an unbooked order only when stock and its already-paid delivery charge support the change, without charging more automatically.
6. Monitor reservation expiry, paid exceptions, booking failures, duplicate references, notification failures and stock drift.
7. Rollback stops admission of new automatic orders while existing plans, reservations, jobs and webhooks continue safely.

## Implementation order and completion gate

Build in dependency order: origin configuration/schema → allocator → reservations and quotes → payment handler and booking jobs → shipment webhooks and UI → staging verification → controlled enablement.

Do not enable automatic confirmation independently of stock reservation and multi-shipment tracking. The feature is complete when the accepted checkout total, consumed stock, NBOX shipment items, and final delivery progress agree end to end for all supported allocation paths.
