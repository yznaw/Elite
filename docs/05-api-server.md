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
app.use(morgan('dev'));
```

Logs: `GET /api/health 200 3.421 ms`

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
| `GET` | `/api/health` | Server liveness check | `{ success, status, timestamp, uptime }` |

### Public — Config (`/api/config`)

See `server/routes/config.route.js`. No auth required.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns public tenant configuration — `{ defaultImage }`. `defaultImage` is stored in `tenants.config` JSONB and set via the media "Set as Default Fallback" button. The client-web reads this on init to use as a product image fallback. |

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

### Admin — Bulk Import (`/api/admin/bulk-import`)

See `server/routes/admin-bulk-import.route.js`. CSV upload → NDJSON streaming progress. See [Bulk Import endpoint](#bulk-import-endpoint-post-apiadminbulk-import) below.

### Admin — Reference Data (`/api/admin/ref/*`)

See `server/routes/admin-ref.route.js`. Colors, materials, size sets. See [Reference data endpoints](#reference-data-endpoints-apiadminref) below.

### POS (`/api/pos/*`)

See `server/routes/admin-pos.route.js`. All endpoints require an active admin/cashier session.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pos/products/search?q=` | Search products by name, SKU, or barcode (min 2 chars) |
| `GET` | `/api/pos/products/scan/:barcode` | Instant barcode lookup — returns variant + product |
| `POST` | `/api/pos/transactions` | Create & finalize a sale; atomically decrements stock |
| `GET` | `/api/pos/transactions` | Transaction history (`?from=&to=&cashierId=&page=`) |
| `GET` | `/api/pos/transactions/:id` | Single transaction with all line items |
| `GET` | `/api/pos/transactions/:id/receipt` | Receipt data for print / email |
| `POST` | `/api/pos/transactions/:id/email` | Email receipt — body: `{ email }` |
| `POST` | `/api/pos/transactions/:id/void` | Void open transaction — body: `{ managerPin }` |
| `POST` | `/api/pos/refunds` | Full or partial refund — body: `{ originalTxId, items[], managerPin }` |
| `GET` | `/api/pos/shift/summary` | Live shift totals (X Report data) — `?date=` |
| `POST` | `/api/pos/shift/z-report` | Close the day — generates immutable Z Report — body: `{ cashierCount, managerPin }` |
| `GET` | `/api/pos/shift/z-reports` | List past Z Reports — `?from=&to=` |
| `POST` | `/api/pos/print/receipt` | Build ESC/POS byte stream; send to thermal printer via TCP socket |
| `POST` | `/api/pos/print/labels` | Generate barcode labels (Code 128/EAN-13) — body: `{ variants: [{id, qty}] }` |
| `GET` | `/api/pos/parked` | List parked carts for current cashier |
| `POST` | `/api/pos/parked` | Save a parked cart — body: `{ items[], label? }` |
| `DELETE` | `/api/pos/parked/:id` | Delete a parked cart (on resume or expiry) |

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
| `NODE_ENV` | `development` | No | `development` or `production` |
| `SESSION_SECRET` | — | **Yes** | Long random string for signing the session cookie. Generate with `openssl rand -hex 32` |
| `SESSION_COOKIE_NAME` | `elite.sid` | No | Name of the session cookie |
| `SESSION_MAX_AGE_MS` | `43200000` | No | Session lifetime in ms (default 12 h) |
| `SESSION_COOKIE_SECURE` | `false` | No | Set `true` in production (requires HTTPS) |
| `SESSION_COOKIE_SAMESITE` | `lax` | No | Set `none` if admin and API are on different origins in prod |
| `GOOGLE_DRIVE_API_KEY` | — | No (folder imports only) | Google Cloud API key with Google Drive API enabled. Required for `POST /api/admin/media/gdrive` when importing a folder. Single-file imports work without it via public share URL. Accepts `GOOGLE_DRIVE_API_KEY` or `GOOGLE_API_KEY` (the latter as a fallback). |
| `NBOX_WEBHOOK_SECRET` | — | Yes for NBOX webhooks | Secret copied from the NBOX webhook page; used to verify inbound shipment updates |
| `NBOX_API_BASE_URL` | — | Yes for NBOX checkout | NBOX API base URL from the merchant portal |
| `NBOX_API_TOKEN` | — | Yes for NBOX checkout | NBOX API token used for outbound quote/shipment requests |
| `NBOX_API_KEY` | — | If provided by NBOX | Optional API key header value |
| `NBOX_AUTH_HEADER` | `Authorization` | No | Header used for `NBOX_API_TOKEN` |
| `NBOX_AUTH_SCHEME` | `Bearer` | No | Auth scheme prepended to `NBOX_API_TOKEN`; set empty if NBOX expects the raw token |
| `NBOX_RATE_ENDPOINT` | — | Yes for delivery quotes | NBOX endpoint path for delivery pricing/availability |
| `NBOX_SHIPMENT_ENDPOINT` | — | Yes for shipment booking | NBOX endpoint path for creating a shipment after payment is confirmed |
| `NBOX_DEFAULT_ITEM_WEIGHT_GRAMS` | `1000` | No | Fallback item weight used when product weight is not available |
| `NBOX_ORIGIN_*` | — | Yes for NBOX checkout | Pickup/origin contact and address fields sent to NBOX |
| `DEFAULT_ADMIN_EMAIL` | `admin@elite.local` | No | Email for the auto-seeded admin user (first boot only) |
| `DEFAULT_ADMIN_PASSWORD` | `elite-admin` | No | Password for the auto-seeded admin — **change immediately in production** |
| `DEFAULT_ADMIN_NAME` | `Yusuf Hamad` | No | Display name for the auto-seeded admin user |
| `PRINTER_HOST` | — | No | IP of Bixolon thermal printer for TCP socket printing |
| `PRINTER_PORT` | `9100` | No | TCP port for ESC/POS printer socket |

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

> **POS backend (`admin-pos.route.js`) is planned but not yet built.** The endpoint table above in the POS section describes the target API. Implementation follows the acceptance criteria in [`docs/pos-system-plan.html`](./pos-system-plan.html).

### Session & Auth

Admin authentication uses **server-side sessions** (no JWT):
- `express-session` with `connect-pg-simple` stores sessions in the `session` PostgreSQL table
- Login: `POST /api/auth/login` — checks `admin_users.password_hash` (bcrypt), sets `req.session.userId`
- All `/api/admin/*` routes are gated by `requireAuth` in `middleware/require-auth.js`, which reads `req.session.userId`
- Role-restricted routes (settings, reference) are additionally gated by `requireRole(['owner','admin'])`

### Bulk Import endpoint (`POST /api/admin/bulk-import`)

- Accepts a `multipart/form-data` CSV upload (field: `csv`, max 10 MB)
- **Dry-run mode:** pass `?dryRun=true` (or `?dryRun=1`). The full pipeline runs inside a DB transaction that is ROLLBACKed instead of COMMITted at the end. Preview results are identical to a real import. `productId` and `imagesUploaded` are `null`/`0` in dry-run items.
- Groups rows by **English Name** — each unique name becomes one `products` record
- Each color row within a group → one `product_variants` row (SKU + color + price)
- Images are downloaded from Google Drive folder links (`GOOGLE_API_KEY` env var required for folder listing). Images are **skipped** in dry-run mode.
- Streams progress as **NDJSON** (one JSON object per line, chunked transfer encoding):
  - `{ type:'start', total }` — number of unique products
  - `{ type:'processing', current, total, name, variantCount }` — before each product
  - `{ type:'item', current, total, name, status, variantsCreated, variantsUpdated, imagesUploaded, imagesFailed, error }` — after each product
  - `{ type:'done', summary }` — final counts
- Template download: `GET /api/admin/bulk-import/template`

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
