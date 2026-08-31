# Product Import Reliability Plan

Status: implementation plan — Template V2 foundation started 2026-08-31; security/functional
review pass completed 2026-08-31 (see [Section 11](#11-security-and-functional-review-2026-08-31)).

## 1. Target outcome

Build one dependable product source for Admin, Storefront, and POS where:

- Product and variant identity never depends on a mutable product name.
- Preview and commit apply the same parsed file and the same validation result.
- Empty cells, zero values, and explicit clears have documented, consistent meanings.
- Every stock write has an inventory movement and reaches connected POS registers.
- Product, price, image, name, and status changes also refresh POS catalogues.
- Every import is attributable, retryable, and auditable.
- Old CSV files remain readable during a controlled migration window.

## 2. Template V2 contract

### Required on every variant row

| Column | Type | Rule |
|---|---|---|
| Product SKU | text identifier | Stable product key. Repeat it on every row. |
| Variant SKU | text identifier | Unique sellable variant key. Repeat for every size/color combination. |
| English Name | text | Required product name. Repeat it on every row. |
| Selling Price | decimal QAR | Required for new products. Blank preserves the existing variant price on update. |
| Quantity | whole number | `0` means zero stock. Blank preserves existing stock on update and becomes zero for a new variant. |

### Optional product-level columns

| Column | Purpose | Blank on update |
|---|---|---|
| Arabic Name | POS receipt and Arabic product title source | Preserve |
| Brand | Product brand | Preserve; new product falls back to tenant name |
| Status | `active` or `hidden` | Preserve; new product defaults to `hidden` |
| Hook EN / Hook AR | Compact home/hero copy, recommended max 90 characters | Preserve |
| Short Description EN / AR | Copy under the PDP title, recommended max 160 characters | Preserve |
| Description EN / AR | Legacy long description/fallback content | Preserve |
| Product Note EN / AR | Product-wide fit or construction note | Preserve |
| Material Care EN / AR | Material and care section on PDP | Preserve |
| Collections | Exact collection titles separated with `|` | Preserve when blank; replace membership when supplied |
| Picture | Public image/folder URLs separated with `|` | Preserve existing gallery in current V2 foundation |
| Meta Title | SEO title | Preserve |
| Meta Description | SEO description, recommended max 160 characters | Preserve |
| Slug | Storefront handle | Preserve or derive from English name for new product |
| Related Product SKUs | Product SKUs separated with `|` | Preserve when blank; replace recommendations when supplied |

### Optional variant-level columns

| Column | Purpose | Blank on update |
|---|---|---|
| Barcode | Supplier barcode; otherwise Variant SKU is used | Preserve existing barcode |
| Size | Sellable size | Preserve policy to be enforced in validation phase |
| English Color | Sellable color and image association | May infer from SKU; warn when unknown |
| Material | Variant material | Preserve |
| Cost-QAR | Purchase/manufacturing cost | Preserve |
| Shipping Cost | Allocated inbound shipping cost | Preserve |
| Variant Note EN / AR | Size/color-specific note | Preserve |

### Deliberately excluded until behavior exists

- `Action` (`create`, `update`, `upsert`) will be added only when the server enforces each mode.
- `Clear Fields` will be added only with an explicit sentinel such as `__CLEAR__`; a normal blank must never mean both preserve and clear.
- `Image Mode` (`ignore`, `append`, `replace`) will be added with media rollback and validation support.

## 3. Phase 0 — Baseline and release safety

- Record current production counts: products, variants, duplicate names, missing SKUs, duplicate/empty barcodes, and products without variants.
- Run an inventory drift report before deployment and store the result.
- Back up the database and confirm restore procedure.
- Put Template V2 behind a server/config feature flag for the first production rollout.
- Publish the V1 retirement date; keep legacy header aliases during the migration window.

Acceptance:

- Baseline report and restorable backup exist.
- Feature can be disabled without redeploying.

## 4. Phase 1 — Stable import contract

- Use Product SKU for grouping and matching; use product name only for legacy files.
- Separate Product SKU and Variant SKU in the template.
- Reject a Variant SKU that belongs to another product instead of moving it silently.
- Store Hook, short description, bilingual descriptions, notes, care, material, cost, shipping, SEO, collections, and related products.
- Make new products hidden by default.
- Standardize Quantity: zero is zero, blank preserves on update.
- Preserve optional existing values when their cells are blank.
- Return shipping and total cost in all Admin product reads.
- Prefix CSV with UTF-8 BOM and send an explicit UTF-8 content type.

Acceptance:

- Re-importing the same V2 file is idempotent.
- Renaming English Name with the same Product SKU updates one product and creates no duplicate.
- Two products with the same name and different Product SKUs remain separate.
- Arabic text opens correctly in Excel and Google Sheets.
- A zero quantity reaches product total, inventory ledger, website, and connected POS.

## 5. Phase 2 — Validation and deterministic preview

- Parse the upload once and create an immutable import draft identified by checksum.
- Validate required headers before streaming begins.
- Validate every row with row number, column, raw value, error code, and suggested fix.
- Detect duplicate Product SKU, Variant SKU, barcode, and repeated variant rows inside the file.
- Validate numbers, status values, Slug format, URL format, color references, collection references, and related SKUs.
- Show a product/variant diff: create, update, unchanged, conflict.
- Dry run must not write database rows, download images, or create storage files.
- Commit must consume the exact validated draft, not re-read a changed file.

Acceptance:

- Preview and commit counts are identical unless the database version changed.
- **Done (2026-08-31).** A stale preview is rejected with a clear “catalog changed; preview
  again” message — `findStaleGroups()` in `admin-bulk-import.route.js` compares a snapshot of
  each matched product's `updated_at` taken at preview time against a fresh read at commit time.
- Invalid rows never reach SQL constraints as raw database errors.

## 6. Phase 3 — Import jobs, audit, permissions, and recovery

- Add `product_import_jobs` and `product_import_rows` tables.
- Store file checksum, filename, mode, user, timestamps, counts, status, and row results.
- Restrict product and stock imports to Owner/Admin; optionally grant a dedicated Catalog Manager permission later.
- Add idempotency keys so double-clicks and network retries cannot create duplicate jobs.
- Choose and document transaction policy:
  - default: atomic per product with resumable job;
  - optional strict mode: whole-file rollback for smaller files.
- Retry failed rows from stored normalized data, not a reconstructed CSV missing SKUs.
- Add safe cancellation between products and a downloadable error report.

Acceptance:

- Import history is shared across admins and survives browser clearing.
- **Partially done.** Two concurrent commits of the *same reviewed job* cannot both apply
  (2026-08-31: `SELECT ... FOR UPDATE` + atomic status transition in `admin-bulk-import.route.js`,
  covered by `catalog-import-security-e2e.test.js`). A double-click on **retry** still creates two
  independent job rows re-processing the same failed rows — not corrupting, but not deduplicated
  either; a client-supplied idempotency key (the original scope of this bullet) is still open.
- **Done (2026-08-31).** Unauthorized roles receive 403 from the server: `/api/admin/bulk-import`
  is now mounted with `requireAuth({ roles: ['owner', 'admin'] })` in `server/routes/index.js`,
  matching `/inventory` and `/expenses`. Previously any authenticated admin session (any role)
  could run a product or stock import.

## 7. Phase 4 — One catalog across Admin, Storefront, and POS

- Require at least one variant for POS-enabled products or auto-create a default variant.
- Add Arabic product name to the public product API and storefront model.
- Publish a versioned `catalog.changed` event for create/update/archive, price, name, barcode, image, and status changes.
- Keep `stock.updated` for lightweight stock-only changes.
- On `catalog.changed`, connected POS refreshes affected variants and updates its offline cache.
- Cache the complete POS catalogue, not only the first page, with a catalog version and refresh timestamp.
- Invalidate/revalidate storefront product cache after Admin commit.
- Define channel visibility separately: website active, POS sellable, and archived. Do not overload `hidden` for both.

Acceptance:

- A new product appears on a connected POS without full-page reload.
- Price/name/barcode changes update the open POS and offline cache.
- Arabic product title appears on Arabic storefront and bilingual receipt.
- A hidden website product follows the documented POS visibility rule.

## 8. Phase 5 — Media import reliability

- Add explicit Image Mode: ignore, append, replace.
- Validate Google Drive/API configuration before commit and surface missing-key errors.
- Download to temporary storage, validate MIME/size/dimensions, then promote after database commit.
- Remove temporary files on failure or cancellation.
- Store per-image error details and preserve color-to-image mappings.
- Limit concurrent downloads and total images per product/job.

Acceptance:

- Dry run creates zero permanent files.
- Failed product transactions leave no orphaned files.
- Existing gallery behavior matches the selected Image Mode.

## 9. Phase 6 — Admin import UX

- Separate Product Import and Stock Update tabs.
- Offer Basic and Advanced templates with template version shown on the page.
- Show required/optional/conditional fields in groups instead of one flat list.
- Add visible rules for blank, zero, `|` lists, supported statuses, file size, and UTF-8.
- Add upload → validate → review diff → commit → results flow.
- Include filters for errors/warnings/creates/updates and jump to source row.
- Replace the global Repair Colors action with a separate maintenance tool and audit trail.

Acceptance:

- A first-time catalog user can prepare a valid file without reading source code.
- The UI never labels a field optional when omission would create a zero-price active product.

## 10. Phase 7 — Automated verification and rollout

Server tests:

- RFC 4180 CSV quoting, commas, CRLF, BOM, Arabic, and empty trailing cells.
- Legacy and V2 header mapping.
- Multi-variant grouping and carry reset between products.
- Same-name/different-SKU and renamed-name/same-SKU cases.
- Blank/zero behavior for price, stock, cost, shipping, material, barcode, and notes.
- Duplicate SKU/barcode conflicts and collection/related-product replacement.
- Dry run produces no database, ledger, event, or storage side effects.
- Ledger delta and parent stock reconciliation.

Integration/E2E tests:

- Import → Admin drawer → Storefront PDP → POS search/barcode.
- Connected POS receives stock and catalog changes.
- Offline cache refreshes and checkout validates current price/stock on reconnect.
- Retry, cancellation, permission denial, and partial failure report.

Rollout:

1. Staging import using a copy of a real production sheet.
2. Re-import the same file and reconcile counts/stock/costs.
3. Pilot with 10–20 products while V1 remains available.
4. Enable V2 for all admins, monitor import failures and inventory drift.
5. Retire V1 aliases after the published migration window.

Go-live gate:

- Zero unexplained inventory drift after import.
- No duplicate product or variant SKUs.
- Admin, website, and POS show the same price and stock for sampled variants.
- Import audit, retry, and rollback/recovery procedures have been exercised by staff.

## 11. Security and functional review (2026-08-31)

A targeted review of the already-implemented Template V2 / import-reliability work, focused on
the five priorities below. This was a review-and-fix pass on existing code, not a re-implementation.

### 11.A Fixed

1. **Permissions — product/stock import was not role-restricted.**
   `server/routes/index.js` mounted `/api/admin/bulk-import` with only `requireAuth()` (any
   authenticated session), unlike every other financially-sensitive router in the file
   (`/inventory`, `/expenses`, `/pos-security`, …), which all specify `roles: ['owner', 'admin']`.
   Any admin-portal role — including a plain `viewer` or `cashier` account, if one somehow reached
   the admin portal — could overwrite the entire product catalog and every variant's stock. Fixed
   by adding `requireAuth({ roles: ['owner', 'admin'] })` to that mount, matching the plan's Phase
   3 requirement. Covered by `catalog-import-security-e2e.test.js` (a `manager` account gets 403
   from both `GET /history` and `POST /`).

2. **SSRF — the "Picture" column could make the server fetch an internal address.**
   `downloadBuffer()` in `admin-bulk-import.route.js` fetched whatever URL the CSV's Picture
   column contained, with no host restriction. Since the column is free text controlled by
   whoever uploads the file, a malicious or compromised admin file could point it at
   `http://169.254.169.254/...` (cloud instance metadata), `http://localhost:<port>/...`, or any
   other host on the private network, and the server would fetch it. Fixed with
   `assertPublicHost()` — resolves the hostname (or reads a literal IP) and rejects loopback,
   RFC 1918, link-local/cloud-metadata, and their IPv6 equivalents, checked before the initial
   request **and** before following each redirect hop (a public host can still 302 to a private
   one). Also fixed: `listFolderImages()` (the Google Drive folder listing call) had no timeout
   and could hang indefinitely while holding the per-group DB transaction open; it now times out
   at 15s like the image download path already did at 30s. Covered by unit tests in
   `admin-bulk-import.test.js` (`isPrivateIp`, `assertPublicHost`).

3. **Stale-review detection — commit could silently overwrite a concurrent edit.**
   The reviewId commit path re-matched products by SKU/slug at commit time with no check that the
   matched product was still in the state the preview showed. If a second admin edited or archived
   a product between preview and commit, the import would silently overwrite that edit with no
   warning. Fixed with `findStaleGroups()`: the preview run now stores each matched product's id
   and `updated_at` in the job's `summary.catalogSnapshot`; the commit re-reads the same products
   fresh and rejects with 409 "The catalog changed since this preview was generated" if anything
   moved — including the case where a group expected no match (new product) but one now exists.
   No schema migration needed (reuses the existing `summary jsonb` column). Covered by
   `catalog-import-security-e2e.test.js`.

4. **Idempotency — two concurrent commits of the same review could both apply.**
   The reviewId commit read the job's status with a plain, non-transactional `db.query`, then
   later flipped it to `running` — a window in which two concurrent commit requests (a
   double-click, a retried network request) could both observe `review_ready` and both proceed.
   The stock-import commit route (`/stock/:id/commit`) already guarded against exactly this with
   `SELECT ... FOR UPDATE` inside a transaction; the product-import commit path did not. Fixed by
   moving the job lookup, status check, stale-catalog check, and the transition to `running` into
   one `FOR UPDATE`-locked transaction: the losing request blocks on the row lock and then sees
   `status='running'` the instant the winner's claim commits, and 409s instead of re-committing.
   Covered by `catalog-import-security-e2e.test.js` (two concurrent commits of the same review →
   exactly one 200 and one 409; exactly one variant row and one `inventory_movements` row result).
   **Not covered:** a double-click on *retry* (`retryId`) still creates two independent job rows,
   each re-processing the same originally-failed rows — redundant but not corrupting, since every
   write in that path is itself idempotent by SKU. A client-supplied idempotency key for the
   initial upload/retry actions (the plan's original ask) is still open — see Phase 3 above.

5. **Product-without-variant.** Reviewed rather than changed: migration 034 deliberately drops a
   DB-level trigger that used to enforce "every product has ≥1 variant" (its comment explains it
   conflicted with idempotent `ALTER TABLE` guards elsewhere). The invariant is enforced at the API
   layer instead — `validateProduct()` in `admin-products.route.js` rejects an empty `variants[]`
   on both create (`POST /`) and update (`PATCH /:id`, including when the client omits `variants`
   entirely — falls back to the product's existing variants, which is checked). The bulk-import
   route can't produce a variant-less product either: `csvToObjects()` already drops any row
   without a Variant SKU, and product groups are built from those rows, so every group has ≥1
   variant by construction; bulk-import also never deletes existing variants (only upserts), so an
   update can't zero one out. This held up under review — no fix needed, and no test added beyond
   the existing `catalog-reliability.test.js` coverage of `validateProduct`.

### 11.B Verification

- `npm test` (server, PostgreSQL): **69/69 passing** (63 pre-existing + 6 new: 5 unit tests in
  `admin-bulk-import.test.js`, 1 E2E test in `catalog-import-security-e2e.test.js`).
- `npm run build:all` (client-web + admin-portal, production config): succeeded, no new warnings.
- `git diff --check`: clean.

### 11.C Remaining (honest gap list, not addressed in this pass)

- Phase 0 (baseline report, feature flag, published V1 retirement date) — not started.
- Phase 5's "limit concurrent downloads and total images per product/job" — still unbounded; each
  image is capped at 20 MB and downloads run sequentially per product, but there is no cap on how
  many images one product or one job can pull in total.
- A client-supplied idempotency key for the initial upload/dry-run/retry actions (double-click
  protection at the network-request layer, not just the reviewId-commit layer fixed above).
- Catalog Manager permission (a role narrower than `admin` but wider than the excluded roles) —
  the plan calls this optional; owner/admin-only was implemented instead.

