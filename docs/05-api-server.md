# 05 — API Server

> **Audience:** Backend developers  
> **Reading time:** ~8 minutes

---

## Overview

The Express API server is the backend for both Angular applications. It runs at `http://localhost:3000` in development and is typically reverse-proxied behind Nginx in production.

- **Entry point:** `server/index.js`
- **Port:** 3000 (configurable via `PORT` env var)
- **Base path:** All routes are prefixed with `/api`

---

## Server Architecture

```
server/
├── index.js          ← Entry point — middleware, error handling, bootstrap
├── package.json      ← Server-only dependencies
├── .env.example      ← Environment variable template
└── routes/
    ├── index.js      ← Route aggregator — imports and mounts all route files
    └── health.route.js  ← GET /api/health — liveness check
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `express` | Web framework |
| `cors` | Cross-Origin Resource Sharing |
| `dotenv` | Environment variable loading |
| `morgan` | HTTP request logger |
| `pg` | PostgreSQL client |
| `connect-pg-simple` | PostgreSQL-backed session store |
| `express-session` | Cookie-based admin sessions |
| `bcrypt` | Password hashing (admin users + manager PINs) |
| `multer` | Multipart file uploads (product images, bulk CSV) |
| `csv-parse` | CSV parsing for bulk import |
| `nodemon` *(dev)* | Auto-restart on file changes |

---

## Middleware Stack

The middleware is applied in this exact order in `server/index.js`:

### 1. CORS

```javascript
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
```

- Origins are loaded from `CORS_ORIGINS` env var (comma-separated)
- Default allows `localhost:4200` and `localhost:4300`
- Requests with no origin (e.g., curl, Postman) are always allowed

### 2. Body Parsing

```javascript
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```

### 3. Request Logging

```javascript
app.use(requestId());            // before everything else
app.use(pinoHttp(httpLoggerOptions));
```

Structured logging via **pino** (`server/lib/logger.js`), replacing `morgan('dev')`, which carried no timestamp, request id, user or tenant and so could not be used to reconstruct an incident after the fact.

- **Production:** one JSON line per request on stdout, captured by pm2 and rotated by `pm2-logrotate` (see [DEPLOYMENT.md](./DEPLOYMENT.md)).
- **Development:** `pino-pretty`, human-readable.
- **Test:** silent (`NODE_ENV=test`), so `node --test` output stays readable.
- Level via `LOG_LEVEL`; secrets (cookies, CSRF/authorization headers, PIN, password, token) are redacted at both the bare key and nested paths.
- `/api/health` is excluded from request logging so an uptime monitor does not dominate the log.

Every line carries `requestId`, plus `userId`, `tenantId`, `role` and `registerId` when a session exists:

```json
{"level":30,"time":1785431188965,"requestId":"a3f9c1d40e12","userId":"…","route":"POST /api/pos/transactions","status":201,"msg":"request completed"}
```

**Correlation id (`server/middleware/request-id.js`).** One id per request, returned as `X-Request-Id` **and** in every JSON error body as `requestId`. The same value is written to the `audit_events` row and the `app_errors` row, and its last 6 characters are shown to the cashier in the POS error toast — so a phone call from the shop resolves to an exact request. A well-formed inbound `X-Request-Id` is honoured (proxy / client shipper), a malformed one is replaced.

### 3b. Error Handling and Persistence

All errors funnel through the single global handler in `server/index.js`. Router-local `PosError` responders were removed deliberately (`pos.route.js`, `admin-pos-security.route.js`, `admin-pos-reconciliation.route.js`) — they bypassed the correlation id, the error record and the log line. **Do not reintroduce them.**

- **Response hygiene:** in production a `5xx` returns a generic message plus `code` and `requestId`; the real message and stack go to the log and `app_errors`. Modelled errors (`PosError`, any explicit `status < 500`) keep their message, since those are written for a cashier to read.
- **Persistence:** `5xx` always, and `4xx` on `/api/pos/*` as `warn`, are recorded in `app_errors` (`server/lib/error-log.js`) — grouped by fingerprint, so a repeat increments `seen_count` instead of adding a row. Recording is fire-and-forget and can never delay or fail a response.

### 3c. Alerting

`server/lib/alerts.js` sends operational email through the existing mailer, deduplicated to one per key per hour, and no-ops entirely unless `ALERT_EMAIL` (or `BACKUP_ALERT_EMAIL`) is set:

| Alert | Trigger |
|---|---|
| `inventory-drift` | the hourly consistency job finds stock that does not reconcile against baseline + ledger |
| `server-error-surge` | more than 10 recorded 5xx in 5 minutes |
| `offline-queue-stuck` | a register reports pending offline sales unchanged for 15+ minutes, or any rejected sale (`server/lib/pos/queue-watch-job.js`) |
| `print-failures` | more than 5 receipt-print failures reported from one register within ~a shift |

### 4. Route Mounting

```javascript
app.use('/api', routes);
```

### 5. 404 Handler

```javascript
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});
```

### 6. Global Error Handler

```javascript
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});
```

---

## Current Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/api/health` | Liveness **and readiness** — performs a cached (5 s), timeout-bounded (3 s) `SELECT 1`. Returns **503** when the database is unreachable, so an uptime monitor stops going green during an outage. Original fields preserved for existing monitors. | `{ success, status, timestamp, uptime, database: { ok, latencyMs, error? } }` |
| `POST` | `/api/client-logs` | Authenticated batch ingest of browser-side errors (up to 20 per request, rate limited). Entries land in `app_errors` with `source` `pos-client`/`admin-client`. Secrets are redacted server-side regardless of what the client posted. | `{ success, data: { accepted } }` |
| `POST` | `/api/client-logs/csp` | CSP violation sink. Public and CSRF-exempt by necessity (the browser sends these with no session and no CSRF header), separately rate limited, always answers **204**. Wired to helmet's `report-uri`. | `204` |

### Public — Config (`/api/config`)

See `server/routes/config.route.js`. No auth required.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns public tenant configuration — `{ defaultImage }`. `defaultImage` is stored in `tenants.config` JSONB and set via the media "Set as Default Fallback" button. The client-web reads this on init to use as a product image fallback. |

### Public — Sitemap (`/api/sitemap.xml`)

See `server/routes/sitemap.route.js`. No auth required. Generated from live data on every request and cached for an hour at the edge.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sitemap.xml` | `application/xml` sitemap covering the storefront's indexable URLs: the static pages (`/`, `/collection`, `/story`, `/experience`, `/contact`), every `status = 'active'` collection (nested ones as `/collection/:parent/:child`), every `status = 'active'` product (`/product/:id`), and every `status = 'active'` policy (`/policy/:handle`). `<lastmod>` comes from each row's `updated_at`. |

Checkout, `/thank-you` and the checkout-result routes are deliberately excluded — transactional dead ends with nothing to index. Crawlers reach this at `https://elitecollections.qa/sitemap.xml`; nginx proxies that root path to this endpoint so the SPA fallback does not answer it with `index.html` (see `docs/09-nginx-https.md`). `robots.txt` ships as a static asset with the Angular bundle at `client/projects/client-web/src/robots.txt` and points at the same URL.

### Admin — Products (`/api/admin/products`)

See `server/routes/admin-products.route.js`. Full CRUD, bulk delete, media gallery management. All endpoints require an active admin session.

**Image normalization:** All responses (`list`, `get`, `saveProduct`, `update`, `duplicate`) now pass through `normalizeProduct()` in `AdminProductsService`, which resolves `image` and `images[]` via `api.mediaUrl()` — converting `/uploads/` → `/api/uploads/` for correct proxy routing.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/products` | List all products (tenant-scoped) |
| `GET` | `/api/admin/products/:id` | Single product with variants + images |
| `POST` | `/api/admin/products` | Create product (upsert by SKU) |
| `PUT` | `/api/admin/products/:id` | Replace product |
| `PATCH` | `/api/admin/products/bulk-stock` | **Bulk stock update** — body: `{ updates: [{ sku, stock }] }`. Must be registered BEFORE `PATCH /:id` to avoid route collision. Returns `{ updated, notFound[] }`. |
| `PATCH` | `/api/admin/products/:id` | Partial update (status, stock, SEO fields, etc.) |
| `DELETE` | `/api/admin/products/:id` | Soft-delete (archive) |
| `POST` | `/api/admin/products/bulk-delete` | Hard-delete multiple — body: `{ ids[] }` |
| `POST` | `/api/admin/products/:id/duplicate` | **Duplicate product** — creates hidden copy; auto-increments SKU suffix (`-COPY`, `-COPY-2`, …); copies variants with updated SKUs. Returns the new product. |
| `POST` | `/api/admin/products/:id/images` | **Multipart image upload** — stores files, appends to gallery, links via `media_links`. Returned `images[]` normalized via `api.mediaUrl()` so freshly-uploaded images display immediately. |

### Admin — Media (`/api/admin/media`)

See `server/routes/admin-media.route.js`. All endpoints require an active admin session.

**Static file serving:** Uploads are served at both `/uploads/` (legacy) and `/api/uploads/` (via proxy) so the Angular admin app at `admin.example.com` can reach files through the `/api` Nginx proxy without additional Nginx configuration.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/media` | List all media assets. Preview URLs normalized via `api.mediaUrl()`. |
| `POST` | `/api/admin/media` | Upload files (multipart `files[]`). Stores via the storage adapter, inserts `media_assets`, auto-links to a product if `productId` in body. |
| `POST` | `/api/admin/media/gdrive` | **Google Drive import** — body: `{ url }` (file or folder URL, or bare file ID). Downloads images, saves to storage, inserts `media_assets`. **Auto-links by SKU** via 4-tier matching: (1) folder name = SKU, (2) filename stem = SKU, (3) filename contains SKU, (4) two-segment prefix. Requires `GOOGLE_DRIVE_API_KEY` env var for folder operations. Returns `MediaFile[]` with `linkedTo` set when auto-linked. |
| `PATCH` | `/api/admin/media/:id/link` | Link/unlink media to a product. **Fixed:** now sets `sort_order = COALESCE(MAX+1, 0)` — the previous version omitted `sort_order` (got default 0) causing a duplicate key constraint when linking a second image to the same product. |
| `DELETE` | `/api/admin/media/orphaned` | Delete all unlinked media assets and their files. |
| `DELETE` | `/api/admin/media/:id` | Delete one media asset and its file. |

### Admin — Orders (`/api/admin/orders`)

See `server/routes/admin-orders.route.js`. All endpoints require an active admin session.

**Idempotency:** `POST /` accepts an optional `idempotencyKey` body field. If a key is supplied and an order with that key already exists for the tenant, the existing order is returned (HTTP 200) without creating a duplicate. The key is stored in `orders.idempotency_key` (unique per tenant, nullable — enforced by `idx_orders_idempotency`).

**Public number format:** `EC-YY-MMDD-{6-digit-ms-suffix}` (e.g. `EC-26-0619-123456`). A unique constraint `orders_tenant_public_number_key` on `(tenant_id, public_number)` prevents collisions at the DB level.

**Server-side pagination and filtering:** `GET /` now supports query parameters. All filters are applied in PostgreSQL before returning results. Response shape is `{ orders[], total, page, limit, pages }`.

**Product thumbnails:** `GET /:id` (and the list endpoint) includes `img` in each item object, sourced from `order_items.media_url`. The frontend renders a real `<img>` when present, falls back to a gradient placeholder otherwise.

**Performance index:** `idx_orders_tenant_placed ON orders (tenant_id, placed_at DESC)` ensures the list query uses an index scan on large datasets.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/orders` | List orders with server-side pagination and filtering. Query params: `page` (0-based, default 0), `limit` (default 50, max 200), `payment` (paid / pending / refunded / failed — maps to DB enum values automatically), `fulfillment` (awaiting / processing / shipped / delivered / returned), `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `q` (searches customer name, public number, email). Returns `{ orders[], total, page, limit, pages }`. |
| `GET` | `/api/admin/orders/:id` | Single order by DB UUID or `public_number`; includes items (with `img`), timeline, notes |
| `POST` | `/api/admin/orders` | Create order. Body: `{ customerName, items[], idempotencyKey?, customerId?, customerEmail?, customerPhone?, shippingAddress?, payment?, fulfillment?, total? }`. Validates `customerId` existence if provided. |
| `PATCH` | `/api/admin/orders/:id/status` | Update payment/fulfillment status; optionally sets `trackingNumber`. Appends timeline entry. If `payment=paid`, triggers NBOX shipment booking (non-fatal on failure — stored in `orders.metadata.nbox.bookingFailedAt` / `bookingError`). |
| `POST` | `/api/admin/orders/:id/rebook-delivery` | Retry NBOX delivery booking for a paid order. Clears previous `bookingFailedAt`/`bookingError` flags, then calls `bookNboxForPaidOrder`. Returns full updated order; 409 if not paid; 502 if NBOX call fails. |
| `POST` | `/api/admin/orders/:id/notes` | Add an internal note. Body: `{ body }`. Also appends a `note` timeline entry. |

### Admin — Customers (`/api/admin/customers`)

See `server/routes/admin-customers.route.js`. All endpoints require an active admin session.

**Soft-delete pattern:** Customers are never hard-deleted. `DELETE /:id` sets `deleted_at = now()`. All list and detail queries filter `deleted_at IS NULL`. Soft-deleted customers' order history is fully preserved. A `PATCH /:id/restore` endpoint un-deletes a customer.

**Live order stats:** Customer list and detail responses include `orders_count`, `ltv_cents`, and `last_order_at` from the `v_customer_order_stats` PostgreSQL view (created by migration 013). If the view is unavailable, a fallback COUNT/SUM query runs instead — any view error is logged to console but never propagated to the client.

**Order history by email and ID:** `GET /:id/orders` matches orders by both `customer_id` (FK) and `customer_email` so orders placed before a customer record existed are correctly attributed.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/customers` | List all active (non-deleted) customers with live order stats |
| `GET` | `/api/admin/customers/:id` | Single customer with live order stats |
| `GET` | `/api/admin/customers/:id/orders` | Customer's full order history (matches by `customer_id` OR `customer_email`) |
| `POST` | `/api/admin/customers` | Upsert customer by email. If email already exists with `deleted_at`, resets `deleted_at = NULL` (restore). Body: `{ name, email, city?, sizePref?, notes?, phone? }` |
| `PATCH` | `/api/admin/customers/:id` | Update customer. Body: `{ name?, email?, city?, sizePref?, notes?, phone? }` |
| `DELETE` | `/api/admin/customers/:id` | Soft-delete — sets `deleted_at = now()`. Order history preserved. |
| `PATCH` | `/api/admin/customers/:id/restore` | Restore a soft-deleted customer — sets `deleted_at = NULL` |

**Migration 013** (`server/db/migrations/013_orders_customers_production.sql`) must be applied before using these endpoints. It adds:
- `customers.deleted_at TIMESTAMPTZ NULL` + partial index `idx_customers_active`
- `customers.phone_number TEXT NULL`
- Unique constraint `orders_tenant_public_number_key` on `(tenant_id, public_number)`
- `orders.idempotency_key TEXT NULL` + unique partial index `idx_orders_idempotency`
- `v_customer_order_stats` view

**Applied post-013 index** (applied directly, not via migration file):
- `idx_orders_tenant_placed ON orders (tenant_id, placed_at DESC)` — speeds up the default list query ORDER BY

### Admin — Settings (`/api/admin/settings`)

See `server/routes/admin-settings.route.js`. All endpoints require an active admin session; team/invitation write operations require owner or admin role.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/settings/store` | Get store settings (name, currency, timezone, language) |
| `PATCH` | `/api/admin/settings/store` | Update store settings |
| `GET` | `/api/admin/settings/team` | List admin team members |
| `PATCH` | `/api/admin/settings/team/:id` | Update a team member (name, email, role, status) |
| `GET` | `/api/admin/settings/invitations` | List pending (non-expired) invitations |
| `POST` | `/api/admin/settings/invitations` | Create invitation — body: `{ email, role }`. Generates 32-byte hex token, stores SHA-256 hash, returns raw `inviteLink` URL. Token valid 48 h, single-use. |
| `DELETE` | `/api/admin/settings/invitations/:id` | Revoke a pending invitation |

### Public — Invitations (`/api/invitations`)

See `server/routes/invitations.route.js`. Mounted in the **public** routes section — no auth required.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/invitations/validate?token=` | Validate an invite token — returns `{ email, role }`. Returns 404 if expired/invalid. |
| `POST` | `/api/invitations/accept` | Accept invite — body: `{ token, password, name? }`. Creates `admin_users` row (bcrypt password), deletes invitation row. Returns `{ id, email, role }`. |

### Storefront Content (`/api/storefront-content`, `/api/admin/storefront-content`)

See `server/routes/storefront-content.route.js`. Exports a `publicRouter` and an `adminRouter`; the admin side requires an active admin session. Every write runs through `normalizeContent`, which fills missing keys from `DEFAULT_HOME_CONTENT` so a partial payload can never blank out a section.

**`mediaVariants` is a read-time projection, not stored content.** `loadContent` and `loadDraft` join `media_assets` on every hero image and attach the responsive sizes that were actually generated, keyed by `storage_url`:

```json
"mediaVariants": {
  "/uploads/abc123.webp": [
    { "url": "/uploads/abc123-thumb.webp", "width": 240 },
    { "url": "/uploads/abc123-card.webp",  "width": 640 }
  ]
}
```

It is deliberately absent from `normalizeContent`, so a client that PATCHes back content it just read cannot persist it. The storefront needs it because `createImageVariants` skips any size wider than roughly the source: an upload at 1200px genuinely has no `-zoom` sibling, and the client previously guessed the full set from the filename and advertised widths for files that were never written. Reporting the truth turns the client's `srcset` into a lookup — see `docs/03-client-web.md`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/storefront-content` | Published home content for the storefront. `Cache-Control: no-store`. |
| `GET` | `/api/storefront-content/draft?token=` | Draft preview. 401 on an invalid or expired preview token. |
| `PATCH` | `/api/admin/storefront-content` | Save published content. Normalizes, validates, then persists. |
| `POST` | `/api/admin/storefront-content/reset` | Restore `DEFAULT_HOME_CONTENT`. |
| `POST` | `/api/admin/storefront-content/draft` | Save a draft without publishing. |
| `DELETE` | `/api/admin/storefront-content/draft` | Discard the current draft. |

**`heroSlider.items[]` shape** (normalized by `normalizeHeroSlider`):

| Field | Notes |
|---|---|
| `id` | Required. Items without an id are dropped. |
| `name` | Product name, shown at the top of the hero. |
| `subtitle` | Bilingual, `"العربية / English"`, split on `/` by the client. |
| `descriptionEn` / `descriptionAr` | Short selling copy under the mobile slider. Keep to ~18 words. |
| `imageUrl` | **Derived, not edited.** The default colourway's hero shot. |
| `alt` | Alt text for the slide image. |
| `productId` | Product the colour swatches link to. Empty means no swatch row. |
| `colors[]` | Featured colourways, `{ label, slug, imageUrl }`, capped at 4 by `normalizeHeroColors`. |
| `defaultColorSlug` | Colourway the slide opens on. Normalised to a real colour, or the first one. |
| `callouts[]` | Per-slide craft callouts used by the desktop pills. |

When `descriptionEn` / `descriptionAr` are absent, `calloutSentence()` derives a fallback by joining the first three callout titles, so slides saved before these fields existed still render a description.

`normalizeHeroColors()` accepts either `{ label, imageUrl }` objects or bare strings, drops blanks, collapses case-duplicates (keeping the first), and caps the list at `HERO_MAX_COLORS` (4). Each entry gets a `slug` from the server-side mirror of `colorSlug()`; the storefront product page resolves `?color=` with the same rule.

`imageUrl` is the hero shot for that colourway, owned by the slide and distinct from the product's gallery images.

`resolveHeroSlideImage()` then sets the slide's own `imageUrl` from the default colourway, so the hero always opens on a real colour. Resolution order:

1. The colour matching `defaultColorSlug`, else the first colour in the list.
2. That colour's `imageUrl`; if it has none, the previously stored slide image.
3. With no colours at all, the stored slide image is kept unchanged and `defaultColorSlug` is `''`.

Step 3 is what keeps slides saved before this change rendering — the admin no longer exposes a slide-image field, but legacy values are never discarded.

**No colour value is stored** — hex and swatch dots resolve from `ref_colors` at render time, so `GET /api/ref/colors` remains the single source of truth for how a swatch looks.

### Product Descriptions

`products.description` and `products.care_instructions` are both JSONB columns holding bilingual copy. There is no separate table or migration for these.

| JSONB key | Column | Admin field | Public API field | Used by |
|---|---|---|---|---|
| `en` / `ar` | `description` | `enDesc` / `arDesc` | `descriptionEn` / `descriptionAr` | Legacy long copy. No longer editable; kept as a fallback source for the Material & Care section on products saved before `care_instructions` was activated. |
| `shortEn` / `shortAr` | `description` | `shortEn` / `shortAr` | `shortDescriptionEn` / `shortDescriptionAr` | **Hook.** Home hero and other compact surfaces. Plain text, ~90 chars. |
| `teaserEn` / `teaserAr` | `description` | `teaserEn` / `teaserAr` | `teaserEn` / `teaserAr` | Short description shown directly under the product name on the product detail page. Plain text, ~160 chars. |
| `noteEn` / `noteAr` | `description` | `noteEn` / `noteAr` | `noteEn` / `noteAr` | **Product note.** One short line true of every size, shown on the product page without waiting for a size to be picked. Stacks above the per-variant size note. Plain text, ~80 chars. |
| `en` / `ar` | `care_instructions` | `careEn` / `careAr` | `careInstructionsEn` / `careInstructionsAr` | Material & Care section on the product detail page. Rich text. Falls back to the legacy `description.en/ar` when empty. |

Adding a new key to either JSONB column needs no schema change: extend `mapAdminProduct()` (read), the relevant object literal in `upsertProduct()` (write), and the PATCH payload so a partial update does not blank it.

> [!WARNING]
> `PATCH /api/admin/products/:id` does **not** spread `req.body`. It builds an explicit merge object field by field (`req.body.x ?? existing.description?.x`) so a partial update cannot blank a field the caller omitted. A new JSONB key that is not added to that object saves on `POST` and silently drops on every `PATCH` — which, because the admin drawer uses `PATCH` for existing products, looks exactly like the field not saving at all.

### Product note and per-variant size note

Two separate notes that stack on the storefront, general first:

| | Stored | Shows |
|---|---|---|
| **Product note** | `products.description->>'noteEn'` / `noteAr` (JSONB, no migration) | Always, from page load |
| **Size note** | `product_variants.note_en` / `note_ar` (migration 031) | Only once a size carrying one is selected |

Keeping them apart is the point: "runs one size small" is true of the whole product, "back zipper" is true of three sizes out of nine, and collapsing both into one field would force the shop to either repeat the general line on every variant or lose it.


`product_variants.note_en` / `note_ar` (migration `031_variant_notes.sql`) hold one short bilingual line describing a construction detail that applies to some sizes and not others — the originating case was a garment with a back zipper on the 2-4 sizes but none on 6-10. Storing it on the variant rather than the product is what makes it a per-size fact; two plain text columns rather than JSONB keeps it queryable and mirrors the `ar`/`en` split already used by `product_translations`.

| Layer | Field | Notes |
|---|---|---|
| DB | `note_en`, `note_ar` | Nullable text on `product_variants`. Also created idempotently by `ensure-migrations.js` on boot, so a deploy that has not run the migration file self-heals. |
| Admin API | `noteEn` / `noteAr` on each variant | Read in all three admin variant selects, written by `replaceVariants()`. Empty string is stored as `NULL`, so clearing the field in the editor actually clears it rather than leaving the old value. |
| Public API | `noteEn` / `noteAr` on each variant of `GET /api/products` and `/api/products/:id` | Empty string when unset. |
| Storefront | `productNote()` and `selectedSizeNote()` in `product.component.ts` | `selectedSizeNote()` picks the note off the variant matching both the selected size and the selected colour; both resolve the locale with a fallback to the other language when only one is filled. Rendered stacked in `.gallery-bar` inside the gallery frame, with the size note repeated as a plain line under the size options. |

### Admin — Expenses (`/api/admin/expenses`)

See `server/routes/admin-expenses.route.js`. The operating-expense ledger — rent, salaries, utilities, marketing — which nothing tracked before migration `033_expenses.sql`. Mounted with `requireAuth({ roles: ['owner', 'admin'] })`: this is whole-business financial data, a narrower scope than `/pos-reports` (which managers can also reach).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/expenses` | Ledger for a window. Query: `from`, `to` (both `YYYY-MM-DD`, defaulting to the current month), `category`, `search` (matches vendor or note). |
| `GET` | `/api/admin/expenses/summary` | `{ total, byCategory[] }` for a window — the shape the Analytics page folds into net profit. |
| `GET` | `/api/admin/expenses/export.csv` | The filtered ledger as CSV, UTF-8 with a BOM so Excel reads Arabic vendor/note columns correctly. |
| `POST` \| `PATCH` \| `DELETE` | `/api/admin/expenses`, `/api/admin/expenses/:id` | Create / update / delete. `amount` is sent in QAR and stored via `toCents()`. |
| `POST` | `/api/admin/expenses/import-pos-cash-outs` | Mirrors `pos_cash_movements` rows of kind `paid_out` into the ledger as `source = 'pos_cash_out'`. |

**Recurrence is expanded on read, not scheduled.** A monthly or yearly bill is stored as one template row; `generate_series` projects its later occurrences across the requested window (a `none` row falls out of the same series as a single row, via a 1000-year step). There is no cron job to keep alive and no drift between what was scheduled and what the ledger says. Projected occurrences come back with `isProjected: true` and no row of their own; editing one materialises it as a real row carrying `recurrence_parent_id`, and the template's occurrence for that date is then suppressed, so only that period changes.

**The POS import is idempotent.** The partial unique index `expenses_pos_source_idx ON (tenant_id, source_ref_id) WHERE source = 'pos_cash_out'` plus `ON CONFLICT DO NOTHING` means re-running the import can never double-count a cash movement. Verified: first run imports, every subsequent run reports `imported: 0`.

**Dates are returned as plain `YYYY-MM-DD` strings.** A Postgres `date` arrives in Node as a Date at local midnight, which serialises to the *previous* day in UTC JSON (Qatar is UTC+3) — an expense dated the 5th would reach the edit form as the 4th. `toIsoDate()` in the route pulls the calendar date out in local terms instead.

### Admin — Shipping Cost Report (`/api/admin/analytics/shipping-costs`)

In `server/routes/admin-analytics.route.js`. Per-product shipping-cost coverage across the whole catalogue, plus a `coverage` block (`totalVariants`, `withShipping`, `withoutShipping`, `coveragePct`, `avgShipping`, `totalShipping`). Not range-scoped — the catalogue is a current-state question, not a time-series one.

The important difference from `/cost-summary`: that endpoint inner-joins on `total_cost_cents IS NOT NULL`, which hides exactly the products the shop owner needs to find. Here every non-archived product comes back regardless, with nulls where no shipping cost is recorded, and results are ordered **missing first** so the list doubles as a to-do. `variantsWithShipping` vs `variantCount` distinguishes a product with no data at all from one that is only partly filled in.

Note that shipping cost is already inside `product_variants.total_cost_cents` (a stored generated column, `cost_price_cents + shipping_cost_cents`, from migration `012_shipping_cost.sql`), so it is *already* subtracted by the COGS figure in `/profit-summary`. This report is for finding gaps in the data, not for adding shipping into profit a second time.

### Admin — Profit Summary (`/api/admin/analytics/profit-summary`)

Added to `server/routes/admin-analytics.route.js` alongside `/storefront`, `/overview`, and `/cost-summary`; takes the same `?range=7d|30d|90d|1y` key.

Returns `revenue`, `cogs`, `expenses`, `netProfit`, `netMarginPct`, `expensesByCategory[]`, and `cogsCoverage`.

This is a different — and truer — figure than `/cost-summary`. That endpoint averages catalogue margin percentages across variants, which says how profitable the products *could* be; this one computes COGS from what actually sold (`order_items.quantity * product_variants.total_cost_cents` over paid orders in the window) and then subtracts real operating expenses on top. `cogsCoverage.lineItemsWithoutCost` reports how many sold line items have no cost recorded, so the UI can warn rather than quietly overstate profit.

### Public — Policies (`/api/policies`) and Admin — Policies (`/api/admin/policies`)

See `server/routes/policies.route.js` (public) and `server/routes/admin-policies.route.js` (admin, requires session). Legal pages — Privacy Policy, Terms of Service, Shipping Policy, etc. — surfaced in the storefront footer and at `/policy/:handle`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/policies` | Active policies, list only (`id`, `handle`, `title`, `titleAr`, `policyType`, `updatedAt`) — no `content`, for nav/footer. |
| `GET` | `/api/policies/:handle` | Full content of one active policy, including `titleAr` and `contentAr`. |
| `GET` | `/api/admin/policies` | All policies regardless of status. |
| `POST` \| `PATCH` | `/api/admin/policies`, `/api/admin/policies/:id` | Create / update, accepting `titleAr` and `contentAr` alongside the existing `title`/`content`. |

`policies.title_ar` / `content_ar` (migration `032_policy_arabic.sql`) hold the Arabic title and rich-text body. Both nullable — a policy has always had one English title/content pair, so an Arabic column with no value must render the page rather than leave it blank. Also created idempotently by `ensure-migrations.js` on boot, so a deploy that has not run the migration file self-heals.

| Layer | Field | Notes |
|---|---|---|
| Admin API | `titleAr` / `contentAr` | Trimmed to `NULL` when empty on `PATCH`, matching how `noteEn`/`noteAr` are stored on variants. |
| Public API | `titleAr` / `contentAr` | Empty string (`''`) when unset, not `NULL` — the storefront never has to distinguish "unset" from "explicitly cleared". |
| Admin UI | `policy-drawer.component.ts` — "Title (Arabic)" input and a second `ap-rich-text` editor with `dir="rtl"`, directly under the English equivalents | Both optional; leaving them blank is the supported way to publish English-only. |
| Storefront | `policyTitle()` / `policyContent()` in `policy.component.ts`, `policyTitle()` in `footer.component.ts` | Same fallback shape as `Product.descriptionAr` elsewhere: Arabic locale shows `titleAr`/`contentAr` when set, otherwise falls back to the English value rather than rendering blank. |

### Admin — Bulk Import (`/api/admin/bulk-import`)

See `server/routes/admin-bulk-import.route.js`. CSV upload → NDJSON streaming progress. See [Bulk Import endpoint](#bulk-import-endpoint-post-apiadminbulk-import) below.

### Admin — Reference Data (`/api/admin/ref/*`)

See `server/routes/admin-ref.route.js`. Colors, materials, size sets. See [Reference data endpoints](#reference-data-endpoints-apiadminref) below.

### Admin — Diagnostics (`/api/admin/diagnostics/*`)

Owner/admin only. See `server/routes/admin-diagnostics.route.js` and `server/lib/diagnostics-service.js`. Backs the `/diagnostics` admin page.

| Method | Path | Description |
|---|---|---|
| `GET` | `/errors` | Grouped `app_errors` + a summary block. Filters: `status` (`open` default / `resolved` / `all`), `source`, `severity`, `search` (matches message, code, route, **or an exact reference code**), `limit`. |
| `POST` | `/errors/:id/resolve` | Marks one group resolved. A later recurrence opens a **new** row rather than reviving the closed one, so a regression after a fix stays visible. |
| `GET` | `/audit-events` | Reads `audit_events`, which had no UI before this. Filters: `action`, `entityType`, `requestId`, `from`, `to`, `limit`. Also returns the distinct action list for the filter dropdown. |

### POS (`/api/pos/*`)

See `server/routes/pos.route.js`. All endpoints require an authenticated owner/admin/manager/cashier session; operational endpoints also require an active enrolled register.

The register binding is resolved from `req.session.posRegisterId` first and then from the long-lived, httpOnly, HMAC-signed `elite.pos_device` cookie (`lib/pos/device-cookie.js`), so a till stays bound to its counter across logouts, session expiry, and a different admin signing in on the same machine. The cookie only names a register; `requireRegister()` still checks it exists, belongs to the tenant, and is active.

**No POS route may answer 401 for anything other than a missing login.** The admin portal turns a 401 into "Session expired" and redirects to `/login`, which redirects back to `/pos` when the session is valid — an infinite loop. A stale register credential is `409 REGISTER_CREDENTIAL_INVALID`; a failed takeover PIN is `403 MANAGER_PIN_REQUIRED` / `403 MANAGER_PIN_INVALID`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pos/registers` | List active registers for the "which till is this?" picker, scoped to the caller's `admin_users.pos_branch_id` when set |
| `POST` | `/api/pos/registers/claim` | Bind this browser to a register, or create one by name (owner/admin); a till with someone else's open shift needs `confirmTakeover` + `managerPin` |
| `POST` | `/api/pos/registers/enrollment-tokens` | Create one-time terminal enrollment token |
| `POST` | `/api/pos/registers/enroll` | Enroll and bind a physical register |
| `POST` | `/api/pos/registers/check-in` | Validate stored register credentials |
| `POST` | `/api/pos/registers/release` | Forget this machine's register binding (session + `elite.pos_device` cookie) |
| `POST` | `/api/pos/registers/receipt-number-blocks` | Reserve 100 tenant-wide receipt numbers |
| `GET` | `/api/pos/products/search?q=` | Search active variants by name, SKU, or barcode |
| `GET` | `/api/pos/products/barcode/:barcode` | Exact active barcode lookup |
| `POST` | `/api/pos/transactions` | Create/finalize a sale atomically |
| `POST` | `/api/pos/transactions/sync` | Synchronize offline sale batches |
| `GET` | `/api/pos/transactions/lookup/:lookup` | Resolve receipt, sale QR, refund QR, or transaction reference |
| `POST` | `/api/pos/transactions/:id/void` | Same-shift manager-approved void |
| `POST` | `/api/pos/refunds` | Full/partial manager-approved refund |
| `GET/POST/DELETE` | `/api/pos/parked-carts` | List, create, or consume parked carts |
| `GET` | `/api/pos/shifts/current` | Current X-style shift summary |
| `POST` | `/api/pos/shifts/z-report` | Manager-approved shift close and immutable Z report |
| `GET` | `/api/pos/events` | Authenticated SSE stock/event stream |
| `GET/POST` | `/api/pos/print/{certificate,sign}` | QZ certificate and restricted request signing |

The complete endpoint and payload reference is in [12 – POS System and Integration](./12-pos-system.md#11-pos-api-reference).

---

## Environment Variables

Create `server/.env` from the template:

```bash
cp server/.env.example server/.env
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | Server listening port |
| `DATABASE_URL` | — | **Yes** | PostgreSQL connection string, e.g. `postgresql://elite:pass@localhost:5432/elite` |
| `DEFAULT_TENANT_SLUG` | `elite` | No | Slug of the tenant row used for all queries |
| `DEFAULT_TENANT_NAME` | `Elite` | No | Human name of the tenant |
| `DEFAULT_CURRENCY` | `QAR` | No | Currency code shown in formatted prices |
| `CORS_ORIGINS` | `http://localhost:4200,http://localhost:4300` | No | Comma-separated allowed origins |
| `SITE_URL` | `https://elitecollections.qa` | No | Public origin of the storefront. Used to build absolute URLs in `/api/sitemap.xml`. Set this on any non-production deployment so the sitemap does not advertise the live domain. |
| `NODE_ENV` | `development` | No | `development` or `production` |
| `SESSION_SECRET` | — | **Yes** | Long random string for signing the session cookie. Generate with `openssl rand -hex 32` |
| `SESSION_COOKIE_NAME` | `elite.sid` | No | Name of the session cookie |
| `SESSION_MAX_AGE_MS` | `43200000` | No | Session lifetime in ms (default 12 h) |
| `SESSION_COOKIE_SECURE` | `false` | No | Set `true` in production (requires HTTPS) |
| `SESSION_COOKIE_SAMESITE` | `lax` | No | Set `none` if admin and API are on different origins in prod |
| `GOOGLE_DRIVE_API_KEY` | — | No (folder imports only) | Google Cloud API key with Google Drive API enabled. Required for `POST /api/admin/media/gdrive` when importing a folder. Single-file imports work without it via public share URL. Accepts `GOOGLE_DRIVE_API_KEY` or `GOOGLE_API_KEY` (the latter as a fallback). |
| `NBOX_WEBHOOK_SECRET` | — | Yes for NBOX webhooks | Secret copied from the NBOX webhook page; used to verify inbound shipment updates |
| `NBOX_API_BASE_URL` | `https://nbox.now/api` | Yes for NBOX checkout | NBOX API base URL; use `https://staging.nbox.now/api` for staging |
| `NBOX_API_TOKEN` | — | Yes for NBOX checkout | Raw token sent as `x-nbox-shop-token` |
| `NBOX_SHOP_DOMAIN` | `elitecollections.qa` | Yes for NBOX checkout | Shop/store domain sent as `x-nbox-shop-domain`; must match the token in NBOX |
| `NBOX_API_KEY` | — | If provided by NBOX | Optional API key header value |
| `NBOX_AUTH_HEADER` | `x-nbox-shop-token` | No | Header used for `NBOX_API_TOKEN` |
| `NBOX_AUTH_SCHEME` | empty | No | Auth scheme prepended to `NBOX_API_TOKEN`; keep empty for NBOX shop tokens |
| `NBOX_RATE_ENDPOINT` | `/rates` | Yes for delivery quotes | NBOX endpoint path for delivery pricing/availability |
| `NBOX_SHIPMENT_ENDPOINT` | `/order` | Yes for shipment booking | NBOX endpoint path for creating a shipment after payment is confirmed |
| `NBOX_DEFAULT_ITEM_WEIGHT_GRAMS` | `1000` | No | Fallback item weight used when product weight is not available |
| `NBOX_DEFAULT_ITEM_LENGTH_CM`, `NBOX_DEFAULT_ITEM_WIDTH_CM`, `NBOX_DEFAULT_ITEM_HEIGHT_CM` | `35`, `25`, `15` | No | Fallback product dimensions sent to NBOX when catalog dimensions are unavailable |
| `NBOX_ORIGIN_*` | — | Yes for NBOX checkout | Pickup/origin contact and address fields sent to NBOX |
| `DEFAULT_ADMIN_EMAIL` | `admin@elite.local` | No | Email for the auto-seeded admin user (first boot only) |
| `DEFAULT_ADMIN_PASSWORD` | `elite-admin` | No | Password for the auto-seeded admin — **change immediately in production** |
| `DEFAULT_ADMIN_NAME` | `Yusuf Hamad` | No | Display name for the auto-seeded admin user |
| `QZ_SIGNING_CERT_PATH` | — | Yes for online POS printing | Path to the public QZ signing certificate |
| `QZ_SIGNING_KEY_PATH` | — | Yes for online POS printing | Path to the restricted PKCS#8 QZ private key. **Must be persistent storage — never under `/run`, which is tmpfs and is wiped on reboot.** Losing this key means re-trusting QZ on every register; see the [hardware runbook](./pos-hardware-runbook.md) |
| `POS_PRINTER_ALLOWLIST` | — | Yes for POS printing | Comma-separated exact QZ printer queue names |

---

## Response Format

All API responses follow this standard shape (defined in `shared/interfaces/api-response.interface.ts`):

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error Response

```json
{
  "success": false,
  "message": "What went wrong",
  "errors": ["Field-level error 1", "Field-level error 2"]
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

---

## How To: Add a New Route

### Step 1: Create the Route File

```javascript
// server/routes/products.route.js
const { Router } = require('express');

const router = Router();

/**
 * GET /api/products
 * Returns all products.
 */
router.get('/', (req, res) => {
  // TODO: replace with database query
  res.json({
    success: true,
    data: [],
    message: 'Products retrieved',
  });
});

/**
 * GET /api/products/:id
 * Returns a single product by ID.
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  // TODO: replace with database query
  res.json({
    success: true,
    data: { id },
  });
});

/**
 * POST /api/products
 * Creates a new product.
 */
router.post('/', (req, res) => {
  const body = req.body;
  // TODO: validate and persist
  res.status(201).json({
    success: true,
    data: body,
    message: 'Product created',
  });
});

module.exports = router;
```

### Step 2: Register in Route Aggregator

```javascript
// server/routes/index.js
const { Router } = require('express');
const healthRouter   = require('./health.route');
const productsRouter = require('./products.route');  // ← add import

const router = Router();

router.use('/health',   healthRouter);
router.use('/products', productsRouter);  // ← mount at /api/products

module.exports = router;
```

### Step 3: Test

```bash
curl http://localhost:3000/api/products
```

---

## Server Structure

```
server/
├── index.js                         ← Entry point — middleware, session, bootstrap
├── .env.example                     ← Environment variable template
├── db/
│   ├── client.js                    ← pg Pool singleton
│   ├── tenant.js                    ← ensureDefaultTenant() helper + admin seed
│   ├── seed.js                      ← Idempotent fixture data (products, customers, orders)
│   ├── seed-admins.js               ← One admin per role; writes credentials to admins.local.txt
│   └── migrations/
│       ├── 001_initial_schema.sql   ← Full schema (tenants, products, orders, …)
│       ├── 002_password_reset_tokens.sql ← Reset tokens (SHA-256 hashed, one-shot, 30m TTL)
│       ├── 003_ref_tables.sql       ← ref_colors, ref_materials, ref_size_sets
│       ├── 004_product_meta_seo.sql   ← ADD COLUMN meta_title, meta_desc to products
│       └── 005_team_invitations.sql ← team_invitations table (UUID PK, token_hash, 48h TTL)
├── middleware/
│   ├── require-auth.js              ← requireAuth + requireRole helpers
│   └── upload.js                    ← Shared multer config (50 MB cap, mimetype filter)
├── lib/
│   └── storage.js                   ← Disk storage adapter (multer dest + delete helper)
└── routes/
    ├── index.js                     ← Route aggregator
    ├── lib.js                       ← Shared helpers: asyncHandler, ok, created, notFound, …
    ├── health.route.js              ← GET /api/health
    ├── auth.route.js                ← POST /api/auth/login, /logout, /forgot, /reset
    ├── admin-products.route.js      ← Product CRUD + bulk-delete
    ├── admin-bulk-import.route.js   ← CSV upload → NDJSON streaming
    ├── admin-ref.route.js           ← Colors, materials, size sets CRUD
    ├── admin-media.route.js         ← Media library upload/delete
    ├── admin-collections.route.js   ← Collections CRUD + sub-collection hierarchy (parentId)
    ├── admin-orders.route.js        ← Orders + status workflow + notes + timeline
    ├── admin-customers.route.js     ← Customers CRUD + order history
    ├── admin-analytics.route.js     ← KPI + chart data
    ├── admin-storefront.route.js    ← Storefront snapshots + publish
    ├── admin-settings.route.js      ← Store settings + team + invitations CRUD
    ├── invitations.route.js         ← Public: validate token + accept invite (creates admin_user)
    ├── products.route.js            ← Public storefront product listing
    ├── carts.route.js               ← Public storefront cart
    └── contact.route.js             ← Public contact form
```

> **POS backend is implemented in `pos.route.js` and `server/lib/pos/*`.** See [12 – POS System and Integration](./12-pos-system.md) for the canonical architecture and API guide.

### Session & Auth

Admin authentication uses **server-side sessions** (no JWT):
- `express-session` with `connect-pg-simple` stores sessions in the `session` PostgreSQL table
- Login: `POST /api/auth/login` — checks `admin_users.password_hash` (bcrypt), sets `req.session.userId`
- All `/api/admin/*` routes are gated by `requireAuth` in `middleware/require-auth.js`, which reads `req.session.userId`
- Role-restricted routes (settings, reference) are additionally gated by `requireRole(['owner','admin'])`

### Bulk Import endpoint (`POST /api/admin/bulk-import`)

- Accepts a `multipart/form-data` CSV upload (field: `csv`, max 10 MB)
- **Dry-run mode:** pass `?dryRun=true` (or `?dryRun=1`). The full pipeline runs inside a DB transaction that is ROLLBACKed instead of COMMITted at the end. Preview results are identical to a real import. `productId` and `imagesUploaded` are `null`/`0` in dry-run items.
- Groups rows by **English Name** — each unique name becomes one `products` record. Internal whitespace is normalized (`\s+` → single space) before grouping to prevent duplicate products from formatting differences in the CSV.
- Each color row within a group → one `product_variants` row (SKU + color + price)
- Images are downloaded from Google Drive folder links (`GOOGLE_API_KEY` env var required for folder listing). Images are **skipped** in dry-run mode.
- Streams progress as **NDJSON** (one JSON object per line, chunked transfer encoding):
  - `{ type:'start', total }` — number of unique products
  - `{ type:'processing', current, total, name, variantCount }` — before each product
  - `{ type:'item', current, total, name, status, variantsCreated, variantsUpdated, imagesUploaded, imagesFailed, error }` — after each product
  - `{ type:'done', summary }` — final counts
- Template download: `GET /api/admin/bulk-import/template`

**June 2026 bulk import fixes:**
- **Arabic description preservation:** On re-import, the existing `description.ar` value is read from the DB and kept. Previously re-importing always wrote `ar: ''`, erasing Arabic descriptions set by the editor.
- **Brand from tenant config:** `brand` is now set to `tenant.name` (not the hardcoded string `'Elite'`) so white-label tenants get the correct brand on bulk import.
- **Base SKU updated on re-import:** The `UPDATE` branch now also sets `products.sku = $3` so re-importing a product updates its base SKU if it changed.
- **`color_ref_id` set on variant upsert:** Both the `INSERT` and the `ON CONFLICT DO UPDATE` branches now set `color_ref_id` via an inline subquery against `ref_colors`, linking the variant to the normalized color reference.
- **Stock preserved on re-import:** Variants with `stock_quantity = 0` in the CSV no longer zero out existing stock. Only positive CSV stock values overwrite; zero is treated as "no data".
- **SKU normalization fix:** `v.sku.replace()` changed to `v.sku.replaceAll()` so all hyphens are replaced when constructing variant SKUs, not just the first one.
- **Inventory ledger + live sync (2026-08-18):** the variant upsert previously wrote `stock_quantity` directly with no `inventory_movements` row and never recomputed the parent product's total — every stock change made through this endpoint was invisible to the hourly drift job and could leave `products.stock_quantity` disagreeing with its variants. Fixed: a `previousStockBySku` snapshot is taken per product group (same pattern as `replaceVariants()`), each variant delta posts a `bulk_import` ledger movement via `recordMovement()`, `publishStockEvent()` pushes a `stock.updated` row onto `pos_events` so connected POS registers see it live, and `products.stock_quantity` is recomputed from the variant sum before commit (rolled back with everything else on a dry run).

### Bulk Delete endpoint (`POST /api/admin/products/bulk-delete`)

- Body: `{ ids: string[] }` — array of product UUIDs
- Transaction order (FK-safe): `cart_items` → `media_links` → `product_variants` → `products`
  - `cart_items` must be deleted first — `cart_items.product_id` is `ON DELETE RESTRICT`
- Scoped to the tenant — other tenants' products are never touched
- Returns `{ deleted: number }`

### Product save (`PATCH /api/admin/products/:id`)

- Calls `replaceVariants()` internally, which deletes all old variants and re-inserts them
- **FK safety:** Before deleting variants, `cart_items.variant_id` is set to `NULL` for any cart items referencing those variants (`cart_items.variant_id` is `ON DELETE RESTRICT`). Cart items survive with their product reference intact.
- **SEO fields:** `meta_title` and `meta_desc` are included in the `UPDATE` query (added by migration `004_product_meta_seo.sql`). Returned in the response via `mapAdminProduct()`.
- **Description fields (June 2026):** `mapAdminProduct()` extracts `enDesc` and `arDesc` from the `description` JSONB column (`{ en, ar }`) so the front end receives them as flat strings. Duplicate response keys (`metaTitle`, `metaDesc`, `slug`, `relatedProductIds`) removed from `mapAdminProduct()`.
- **Stock auto-sum (June 2026):** After `replaceVariants()`, `products.stock_quantity` is recomputed as `SUM(product_variants.stock_quantity)` so the product-level stock stays in sync with variants.
- **`trustZeroStock` flag (June 2026):** `replaceVariants()` accepts `{ trustZeroStock }`. When `true` (editor save), zero stock always overwrites. When `false` (bulk import), existing non-zero stock is preserved if the incoming value is 0.
- **Variant ordering fix (June 2026):** All product queries use a correlated subquery with `ORDER BY sort_order, created_at` instead of `jsonb_agg(DISTINCT ...)`. PostgreSQL does not support `ORDER BY` inside `DISTINCT` aggregate — this was causing variants to come back in unpredictable order.
- **Color image URL fix (June 2026):** `replaceColorImages()` normalizes `/api/`-prefixed image URLs before looking them up in `media_assets`.
- **Barcode default (2026-07):** `replaceVariants()` resolves `barcode = trim(variant.barcode) || sku` for every row before insert/update, and throws a 400 if two variants in the save (or an existing variant on a different product) would resolve to the same barcode — `product_variants` has a `UNIQUE(tenant_id, barcode)` partial index (`015_pos_foundation.sql`). `admin-bulk-import.route.js` applies the same default (optional CSV `barcode`/`ean`/`upc` column, else falls back to SKU). Pre-existing variants are backfilled once via `ensure-migrations.js` (`UPDATE product_variants SET barcode = sku WHERE barcode IS NULL OR blank`, idempotent).

### Reference data endpoints (`/api/admin/ref/*`)

Full CRUD for all three reference tables. All endpoints are tenant-scoped. Requires active admin session.

**Colors** — response shape: `{ id, name_en, name_ar, hex, swatch_image_url, sort_order, variant_count }`.  
`variant_count` is a live JOIN count of `product_variants` rows using this color (via `color_ref_id` FK or name match).  
`swatch_image_url` is optional — when set, UIs render a texture thumbnail instead of the flat hex circle (for exotic leathers: suede, croc, ostrich).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/ref/colors` | List all brand colors with live `variant_count` and `swatch_image_url` |
| `POST` | `/api/admin/ref/colors` | Create color — body: `{ name_en, name_ar?, hex?, swatch_image_url?, sort_order? }` |
| `PUT` | `/api/admin/ref/colors/:id` | Replace a color. **Name propagation:** if `name_en` changes, all `product_variants.color` rows linked via `color_ref_id` are updated in the same transaction. |
| `DELETE` | `/api/admin/ref/colors/:id` | **Usage guard:** returns `409 { error, variantCount }` if any variants use this color. Pass `?force=true` to override — clears `color_ref_id` on affected variants but does NOT delete the variants. |

**Materials** — response shape: `{ id, name_en, name_ar, sort_order, variant_count }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/ref/materials` | List all materials with live `variant_count` |
| `POST` | `/api/admin/ref/materials` | Create material — body: `{ name_en, name_ar?, sort_order? }` |
| `PUT` | `/api/admin/ref/materials/:id` | Replace a material |
| `DELETE` | `/api/admin/ref/materials/:id` | **Usage guard:** returns `409 { error, variantCount }` if in use. `?force=true` clears the material field on affected variants. |

**Size Sets**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/ref/size-sets` | List all size sets (id, name, sizes JSON array, sort_order) |
| `POST` | `/api/admin/ref/size-sets` | Create size set — body: `{ name, sizes: string[], sort_order? }` |
| `PUT` | `/api/admin/ref/size-sets/:id` | Replace a size set |
| `DELETE` | `/api/admin/ref/size-sets/:id` | Delete a size set |

**DB tables:** `ref_colors`, `ref_materials`, `ref_size_sets` — created by `003_ref_tables.sql`. `ref_colors` extended by `010_color_images.sql` with `swatch_image_url`. Seeded with 13 colors, 8 materials, and 5 size sets.

**Color-image pivot** (`product_color_images`) — created by `010_color_images.sql`. Written by `replaceColorImages()` in `admin-products.route.js` on every product save alongside the legacy `media_assets.metadata.color` path (dual-write for zero-downtime rollout). Public `products.route.js` prefers the pivot JOIN; falls back to metadata JSONB for products not yet re-saved.

---

## Running the Server

### Development (with auto-restart)

```bash
cd server && npm run dev
# or from root:
npm run server
```

### Production

```bash
cd server && npm start
# or use PM2:
pm2 start server/index.js --name elite-api
```

---

## Related Documents

- [02 – Architecture](./02-architecture.md) — Full system architecture
- [07 – Developer Guide](./07-dev-guide.md) — Local setup instructions
