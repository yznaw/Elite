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

### Admin — Products (`/api/admin/products`)

See `server/routes/admin-products.route.js`. Full CRUD, bulk delete, media gallery management. All endpoints require an active admin session.

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
│       └── 003_ref_tables.sql       ← ref_colors, ref_materials, ref_size_sets
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
    ├── admin-collections.route.js   ← Collections CRUD
    ├── admin-orders.route.js        ← Orders + status workflow + notes + timeline
    ├── admin-customers.route.js     ← Customers CRUD + order history
    ├── admin-analytics.route.js     ← KPI + chart data
    ├── admin-storefront.route.js    ← Storefront snapshots + publish
    ├── admin-settings.route.js      ← Store settings + team
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
- Groups rows by **English Name** — each unique name becomes one `products` record
- Each color row within a group → one `product_variants` row (SKU + color + price)
- Images are downloaded from Google Drive folder links (`GOOGLE_API_KEY` env var required for folder listing)
- Streams progress as **NDJSON** (one JSON object per line, chunked transfer encoding):
  - `{ type:'start', total }` — number of unique products
  - `{ type:'processing', current, total, name, variantCount }` — before each product
  - `{ type:'item', current, total, name, status, variantsCreated, variantsUpdated, imagesUploaded, imagesFailed, error }` — after each product
  - `{ type:'done', summary }` — final counts
- Template download: `GET /api/admin/bulk-import/template`

### Bulk Delete endpoint (`POST /api/admin/products/bulk-delete`)

- Body: `{ ids: string[] }` — array of product UUIDs
- Permanently deletes `media_links`, `product_variants`, then `products` rows
- Scoped to the tenant — other tenants' products are never touched
- Returns `{ deleted: number }`

### Reference data endpoints (`/api/admin/ref/*`)

Full CRUD for all three reference tables. All endpoints are tenant-scoped.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/ref/colors` | List all brand colors (id, name_en, name_ar, hex, sort_order) |
| `POST` | `/api/admin/ref/colors` | Create color — body: `{ name_en, name_ar?, hex?, sort_order? }` |
| `PUT` | `/api/admin/ref/colors/:id` | Replace a color |
| `DELETE` | `/api/admin/ref/colors/:id` | Delete a color |
| `GET` | `/api/admin/ref/materials` | List all materials (id, name_en, name_ar, sort_order) |
| `POST` | `/api/admin/ref/materials` | Create material |
| `PUT` | `/api/admin/ref/materials/:id` | Replace a material |
| `DELETE` | `/api/admin/ref/materials/:id` | Delete a material |
| `GET` | `/api/admin/ref/size-sets` | List all size sets (id, name, sizes JSON array, sort_order) |
| `POST` | `/api/admin/ref/size-sets` | Create size set — body: `{ name, sizes: string[], sort_order? }` |
| `PUT` | `/api/admin/ref/size-sets/:id` | Replace a size set |
| `DELETE` | `/api/admin/ref/size-sets/:id` | Delete a size set |

**DB tables:** `ref_colors`, `ref_materials`, `ref_size_sets` — created by migration `003_ref_tables.sql`. Seeded with 13 colors, 8 materials, and 5 size sets for the `elite` tenant.

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
