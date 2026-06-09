# 08 — Database & API Implementation

> **Audience:** Backend developers, frontend developers wiring pages to API  
> **Last updated:** June 2026 — StorageService tenant-scoped localStorage, StoreConfigService, migration 004 (meta_title/meta_desc), production FK bug fixes (bulk-delete + product save)

---

## What Was Added

The project was moved from a mock-only prototype toward a PostgreSQL-backed ecommerce platform.

The implementation added:

- A professional PostgreSQL schema for all documented website/admin domains.
- A PostgreSQL database client for the Express server.
- A default tenant helper for white-label/multi-tenant data.
- Public storefront API routes.
- Admin API routes for catalog, collections, customers, orders, media, storefront editor, settings, analytics, and integrations.
- Product save wiring from the admin portal to PostgreSQL (including `meta_title`/`meta_desc` SEO fields via migration 004).
- Storefront collection loading from the `products` table.
- `StorageService` — tenant-scoped `localStorage` wrapper (`elite:{tenantId}:{base}`). All client-side persistence now uses this service instead of raw `localStorage`.
- `StoreConfigService` — shared signal for `lowStockThreshold`, persisted via `StorageService`, read by dashboard, catalog, and settings.
- Production FK bug fixes: bulk-delete and product-save now correctly handle `cart_items.product_id` and `cart_items.variant_id` `ON DELETE RESTRICT` constraints.
- Documentation for endpoint-to-SQL behavior.

**June 2026 — Feature batch additions:**

- Migration `006_cost_price.sql` — `cost_price_cents integer` (nullable) added to `product_variants`. CHECK constraint `product_variants_cost_nonneg`.
- `nameAr` (Arabic product name) stored in `product_translations (locale='ar')`. Upserted on every product save via `admin-products.route.js`. Returned via LEFT JOIN in all product SELECT queries.
- Stock aggregation: when variants are present, `products.stock_quantity` is auto-computed as `SUM(variant.stock_quantity)` on every save. The product-level stock input is hidden in the admin UI when variants exist.
- 3D model feature removed from UI: `has3d`/`views3d` fields no longer sent or displayed. DB columns remain but are always set to `false`/`0`.
- Sidebar collapse: `SidebarToggleService.collapsed` signal added. App shell grid uses `--sidebar-w` CSS variable (240px ↔ 68px).
- Storefront content expanded: `storefront-content.route.js` now normalizes `heroSlider`, `promise`, `stats`, and `contact` sections. `store_settings.home_content` JSONB stores all of them.

**Previous June 2026 additions:**

- `ApiClient.mediaUrl()` — converts `/uploads/` → `/api/uploads/` so all media URLs route through the Nginx `/api` proxy in production. Used by `AdminMediaService`, `AdminProductsService`, `MediaUploadService`, and `HomeContentComponent`.
- Express now mounts uploads at **both** `/uploads/` (legacy) and `/api/uploads/` (proxy-friendly alias).
- `GET /api/config` — new public endpoint returning `{ defaultImage }` from `tenants.config` JSONB. The client-web reads this on init for product image fallback.
- `POST /api/admin/media/gdrive` — Google Drive import endpoint. Downloads images from a public Drive file or folder, saves to storage, and auto-links by SKU via 4-tier matching (folder name → filename stem → filename contains → two-segment prefix).
- `PATCH /api/admin/media/:id/link` — fixed duplicate key constraint: now sets `sort_order = COALESCE(MAX+1, 0)` (was missing; caused error when linking a second image to the same product).
- `linkMedia()` refactored to accept a shared `sortCounters` Map so multiple images linked to the same product within one transaction each get a unique `sort_order`.
- `AdminProductsService.normalizeProduct()` — added to all product API responses (list, get, save, update, duplicate); resolves `image` and `images[]` via `api.mediaUrl()`.
- `AdminMediaService.list()` — normalizes `preview` URLs via `api.mediaUrl()` on load.
- `MediaUploadService.uploadProductImages()` — normalizes returned `images[]` via `api.mediaUrl()` on the `done` event.
- Media picker in the product drawer — multi-select slide-in panel using `AdminMediaService`; cached for the drawer session.
- Collection drawer: editable URL Handle field, auto-slug from title, live preview.
- Storefront Featured Collections panel: collection picker chips, manual handle entry, `collectionId` persisted in block settings JSONB.
- Home Content tiles: Linked Collection dropdown (auto-fills title/link/image); media picker on all image slots.
- Google Drive auto-link: 4-tier SKU matching with `sortCounters` Map to prevent transaction-level sort_order conflicts.
- "Set as Default Fallback" in media detail drawer: saves to `tenants.config.defaultImage` via `PATCH /api/admin/settings/store`.
- Public products API: `BUILT_IN_FALLBACK` changed from Unsplash URL to `''`; hardcoded sizes fallback `[40,41,42,43,44]` removed — products with no size variants now return `sizes: []`.
- Client-web `resolveMediaUrl` bug fixed (was stripping `/api/` prefix in production); `ALL_PRODUCTS` mock data removed; size-optional product page support.

---

## Database Files

| File | Purpose |
|---|---|
| `server/db/migrations/001_initial_schema.sql` | Full initial PostgreSQL schema |
| `server/db/migrations/002_password_reset_tokens.sql` | Password reset tokens (SHA-256 hashed, one-shot, 30m TTL) |
| `server/db/migrations/003_ref_tables.sql` | `ref_colors`, `ref_materials`, `ref_size_sets` — brand reference data |
| `server/db/migrations/004_product_seo_fields.sql` | `ALTER TABLE products ADD COLUMN meta_title text, meta_desc text` |
| `server/db/migrations/005_team_invitations.sql` | `team_invitations` table — UUID PK, `token_hash` TEXT, 48h `expires_at`, single-use |
| `server/db/migrations/006_cost_price.sql` | `ALTER TABLE product_variants ADD COLUMN cost_price_cents integer` (nullable) + CHECK constraint |
| `server/db/client.js` | Shared `pg` connection pool |
| `server/db/tenant.js` | Creates/loads the default white-label tenant + seeds the default admin user |
| `server/db/seed.js` | Idempotent fixture (8 products + variants, 3 collections, 6 customers, 8 orders) |
| `server/db/seed-admins.js` | One admin per role; writes credentials to `server/admins.local.txt` (gitignored) |
| `server/lib/storage.js` | Storage adapter — disk driver now, S3/Supabase-ready interface |
| `server/middleware/upload.js` | Shared `multer` config (memory storage, 50 MB cap, mimetype filter) |
| `server/db/README.md` | Database setup notes |
| `server/db/API.md` | Endpoint-to-database command map |

---

## Schema Coverage

The initial schema includes tables for:

- Tenants and white-label brand profiles
- Admin users and team members
- Team invitations (token_hash, role, 48h TTL)
- Store settings
- Products
- Product translations
- Product variants
- Media assets
- Media links
- Inventory movements
- Collections
- Collection/product ordering
- Customers
- Customer addresses
- Carts
- Cart items
- Orders
- Order items
- Payments
- Shipments
- Order timeline entries
- Order notes
- Storefront draft/published snapshots
- Storefront blocks
- Analytics events
- Daily metrics
- Traffic sources
- Conversion funnel steps
- Product interactions / 3D views
- Integrations
- Notifications
- Contact submissions
- Audit events

The schema uses UUID primary keys, foreign keys, enums, indexes, check constraints, and `updated_at` triggers.

---

## Environment Variables

Added to `server/.env.example`:

```bash
DATABASE_URL=postgresql://elite:elite_password@localhost:5432/elite
DEFAULT_TENANT_SLUG=elite
DEFAULT_TENANT_NAME=Elite
DEFAULT_CURRENCY=QAR

# Session-based auth
SESSION_SECRET=dev-session-secret-change-me-in-production
SESSION_COOKIE_NAME=elite.sid
SESSION_MAX_AGE_MS=43200000      # 12h
SESSION_COOKIE_SECURE=false      # set true in production (https)
SESSION_COOKIE_SAMESITE=lax      # 'none' if admin runs on a different origin in prod

# Default admin user (seeded on first boot if none exist for the tenant)
DEFAULT_ADMIN_EMAIL=admin@elite.local
DEFAULT_ADMIN_PASSWORD=elite-admin
DEFAULT_ADMIN_NAME=Yusuf Hamad

# Google Drive media import (optional — required for folder imports)
# Accepts GOOGLE_DRIVE_API_KEY or GOOGLE_API_KEY as fallback
GOOGLE_DRIVE_API_KEY=

# NBOX delivery integration
NBOX_WEBHOOK_SECRET=replace-with-nbox-webhook-secret
NBOX_API_BASE_URL=https://uat.portal.nbox.qa
NBOX_API_TOKEN=replace-with-nbox-api-token
NBOX_RATE_ENDPOINT=replace-with-rate-endpoint-path
NBOX_SHIPMENT_ENDPOINT=replace-with-create-shipment-endpoint-path
NBOX_ORIGIN_NAME=Elite Collections
NBOX_ORIGIN_PHONE=
NBOX_ORIGIN_EMAIL=admin@elitecollections.qa
NBOX_ORIGIN_ADDRESS=
NBOX_ORIGIN_CITY=Doha
NBOX_ORIGIN_COUNTRY=QA
```

The API expects `DATABASE_URL` to be configured before database-backed routes can work.

---

## Authentication (session-based)

Sessions are stored server-side in PostgreSQL via `connect-pg-simple`. The cookie is `HttpOnly` and `SameSite=Lax` (configurable). JWT was considered but rejected — a first-party admin tool benefits more from cheap revocation than from stateless tokens.

| Endpoint | Behaviour |
|---|---|
| `POST /api/auth/login` | Look up `admin_users` by `(tenant_id, email)`, `bcrypt.compare` the password, write `req.session.user`, return the public user profile. |
| `GET /api/auth/me` | Return `req.session.user` (401 if absent). |
| `POST /api/auth/logout` | `req.session.destroy()` + clear cookie. |
| `POST /api/auth/forgot` | Always returns 200 (no account-existence leak). If the email matches an active user, writes a SHA-256 hashed token to `password_reset_tokens` (30-min TTL) and prints the reset URL to the server console. Wire to a real email transport in production. |
| `POST /api/auth/reset` | Validates `{token, password ≥ 8 chars}`, updates `admin_users.password_hash` and marks the token used. One-shot — replaying the same token returns 400. |

Every `/api/admin/*` route is gated by the `requireAuth()` middleware ([server/middleware/require-auth.js](../server/middleware/require-auth.js)) which 401s without a session and 403s when a role filter doesn't match.

On first boot, [server/db/tenant.js](../server/db/tenant.js) calls `ensureDefaultAdminUser` which inserts the user from `DEFAULT_ADMIN_*` env vars (bcrypt-hashed). Re-runs are no-ops thanks to `ON CONFLICT (tenant_id, email)`.

The session store auto-creates an `admin_sessions` table (via `createTableIfMissing: true`) — see `\d admin_sessions` for shape.

### Client wiring

| Piece | File |
|---|---|
| Auth state + `login` / `logout` / `me` / `forgotPassword` / `resetPassword` | [client/projects/admin-portal/src/app/services/auth.service.ts](../client/projects/admin-portal/src/app/services/auth.service.ts) |
| HttpClient wrapper with `withCredentials: true` | [services/api-client.service.ts](../client/projects/admin-portal/src/app/services/api-client.service.ts) |
| Route guards | [guards/auth.guard.ts](../client/projects/admin-portal/src/app/guards/auth.guard.ts), [guards/role.guard.ts](../client/projects/admin-portal/src/app/guards/role.guard.ts) |
| Login page | [pages/login/login.component.ts](../client/projects/admin-portal/src/app/pages/login/login.component.ts) |
| Forgot-password page | [pages/login/forgot-password.component.ts](../client/projects/admin-portal/src/app/pages/login/forgot-password.component.ts) |
| Reset-password page (`/reset-password?token=…`) | [pages/login/reset-password.component.ts](../client/projects/admin-portal/src/app/pages/login/reset-password.component.ts) |
| Live signed-in user (sidebar footer card) | [shared/sidebar/sidebar.component.ts](../client/projects/admin-portal/src/app/shared/sidebar/sidebar.component.ts) |

The HTTP error interceptor redirects 401 → `/login` (with `returnUrl=…`) and suppresses toasts when the failing call is the auth probe itself. The shell (`AppComponent`) hides sidebar + topbar on every auth route (`/login`, `/forgot-password`, `/reset-password`).

### Reset password flow (end-to-end)

1. User clicks **"Forgot password?"** on `/login` → lands on `/forgot-password`.
2. Submits their email → `POST /api/auth/forgot`. Server always responds 200; if the account exists it inserts a token row and prints the URL to the API console (`[auth] Reset URL (valid 30m): http://localhost:4300/reset-password?token=…`).
3. User opens the URL → `/reset-password?token=…` page validates the token client-side (presence) and prompts for a new password (≥ 8 chars, must match confirmation).
4. Submit → `POST /api/auth/reset`. Server bcrypt-hashes the password, updates `admin_users`, marks the token `used_at = now()`. Replaying the same token returns 400.
5. Toast confirms success → user is bounced to `/login` to sign in.

> Email transport is intentionally not plumbed (no SMTP creds in the repo). Production deployments must send the URL via an email/SMS provider rather than `console.log`.

---

## Database Seeding

```bash
cd server
npm run db:migrate   # one-time (or after schema changes)
npm run db:seed      # idempotent — safe to re-run
```

`server/db/seed.js` writes a small but realistic fixture: 8 products with 2–3 variants each, 3 collections, 6 customers, 8 orders (with line items, shipments where applicable, timeline entries, and a few internal notes). It is not a copy of `data/mock.ts` — IDs are server-generated UUIDs, but `public_number`, SKU, and customer email act as natural idempotency keys so re-running the seed is non-destructive.

### Multi-role admin seeding

```bash
npm run db:seed:admins
```

Creates one admin per role — `owner`, `admin`, `manager`, `viewer` — and writes their credentials to `server/admins.local.txt` (gitignored). Re-running rotates the passwords and rewrites the file, so the file and the database can never drift.

| Role | Email | Test what |
|---|---|---|
| `owner`   | `owner@elite.local`   | Full access — including `/settings` (team management). |
| `admin`   | `admin@elite.local`   | Day-to-day admin — can also access `/settings`. |
| `manager` | `manager@elite.local` | Catalog + orders + customers; `/settings` is blocked by the role guard and redirects to `/dashboard`. |
| `viewer`  | `viewer@elite.local`  | Read-only role for stakeholder demos. |

> The credentials file is a plain text dev helper. It is `chmod 600` and listed in `.gitignore`. Never commit it. Production credentials must come from a secrets manager and pass through bcrypt.

---

## Media Uploads (Storage Adapter)

`multer` parses multipart requests in memory; the buffer is then handed to a pluggable storage adapter. The adapter shape (`save({ buffer, filename, mimeType }) → { url, storagePath, mimeType }` + `remove(storagePath)`) is the same one S3 / Supabase / R2 drivers will implement, so the route code never knows which provider is wired up.

| Concern | Where |
|---|---|
| Driver selection | `STORAGE_DRIVER=disk` (default). New drivers register in `server/lib/storage.js`. |
| Local disk path | `server/uploads/` — gitignored. Served as `/uploads/*` via `express.static`. |
| Max file size | `UPLOAD_MAX_SIZE_BYTES` env (default `52428800` = 50 MB). 413 returned on overflow. |
| Allowed types | `image/{jpeg,png,webp,gif,avif}` + `.glb` (model/gltf-binary). 415 on mismatch. |
| Filenames on disk | `<base36-timestamp>-<8 hex>.<ext>` — collision-free and never exposes the user-supplied name. |
| Tracking on disk | `media_assets.metadata->>'storagePath'` stores the absolute path so DELETE can clean up the file. |

### Swapping to S3 / Supabase

1. `npm install @aws-sdk/client-s3` (or `@supabase/supabase-js`).
2. Add a new driver in `server/lib/storage.js` implementing `save()` + `remove()`.
3. Set `STORAGE_DRIVER=s3` (plus `STORAGE_BUCKET=…`, AWS credentials, etc.). No route code changes.

### Client side

| Piece | File |
|---|---|
| `MediaUploadService` (XHR-based, real progress events) | [client/projects/admin-portal/src/app/services/media-upload.service.ts](../client/projects/admin-portal/src/app/services/media-upload.service.ts) |
| Product drawer gallery → batch upload + per-file progress | [pages/catalog/product-drawer.component.ts](../client/projects/admin-portal/src/app/pages/catalog/product-drawer.component.ts) |
| Media library drop zone → real upload + auto-refresh | [pages/media/media.component.ts](../client/projects/admin-portal/src/app/pages/media/media.component.ts) |

Validation runs locally first (same rules the server enforces) so the UI rejects obvious mismatches without a round-trip; the server check is the authority.

Touch UX: every upload trigger is a `<label>` wrapping a hidden `<input type="file">`, so phones get the OS file picker on tap without needing drag/drop.

---

## Setup Commands

Install dependencies:

```bash
cd server
npm install
```

Apply the schema:

```bash
cd server
npm run db:migrate
```

Start the API:

```bash
cd server
npm run dev
```

Start all apps from the repo root:

```bash
npm run dev
```

---

## Added Server Dependency

Added:

```json
"pg": "^8.20.0"
```

This is used by `server/db/client.js` to connect Express routes to PostgreSQL.

---

## Public Storefront API

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/products` | `SELECT` products with variant sizes and primary media |
| `GET` | `/api/products/:id` | `SELECT` one product by UUID |
| `POST` | `/api/contact` | `INSERT` contact submission |
| `POST` | `/api/carts` | `INSERT ... ON CONFLICT` active cart by session |
| `GET` | `/api/carts/:id` | `SELECT` cart and cart items |
| `POST` | `/api/carts/:id/items` | `INSERT ... ON CONFLICT DO UPDATE` cart item quantity, then `UPDATE` cart subtotal |
| `DELETE` | `/api/carts/:id/items/:itemId` | `DELETE` cart item, then `UPDATE` cart subtotal |
| `POST` | `/api/carts/:id/checkout` | Transaction: `INSERT` order, `INSERT` order items, `UPDATE` cart status |

---

## Admin API

> All `/api/admin/*` endpoints require an active session cookie. Anonymous requests get `401 Authentication required`.

### Products

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/products` | `SELECT` products with variants/media |
| `GET` | `/api/admin/products/:id` | `SELECT` one product |
| `POST` | `/api/admin/products` | Transaction: `INSERT ... ON CONFLICT DO UPDATE` product, replace variants |
| `PATCH` | `/api/admin/products/:id` | Transaction: `SELECT` current product, `UPDATE` via upsert, replace variants when supplied |
| `DELETE` | `/api/admin/products/:id` | Soft delete using `UPDATE status = 'archived'` |

### Collections

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/collections` | `SELECT` collections and ordered product IDs |
| `POST` | `/api/admin/collections` | Transaction: `INSERT` collection, `INSERT` product links |
| `PATCH` | `/api/admin/collections/:id` | Transaction: `UPDATE` collection, optionally replace product links |
| `DELETE` | `/api/admin/collections/:id` | Soft delete using `UPDATE status = 'archived'` |

### Customers

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/customers` | `SELECT` customers joined with order stats |
| `GET` | `/api/admin/customers/:id` | `SELECT` one customer |
| `POST` | `/api/admin/customers` | `INSERT ... ON CONFLICT DO UPDATE` customer |
| `PATCH` | `/api/admin/customers/:id` | `UPDATE` customer profile |
| `DELETE` | `/api/admin/customers/:id` | `DELETE` customer |

### Orders

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/orders` | `SELECT` orders with item aggregation |
| `GET` | `/api/admin/orders/:id` | `SELECT` order detail, timeline, and notes |
| `POST` | `/api/admin/orders` | Transaction: `INSERT` order, `INSERT` order items, `INSERT` timeline entry |
| `PATCH` | `/api/admin/orders/:id/status` | Transaction: `UPDATE` statuses, `INSERT` timeline entry |
| `POST` | `/api/admin/orders/:id/notes` | `INSERT` internal order note |

### Media

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET`    | `/api/admin/media`           | `SELECT` media with product links + uploader info. All `preview` URLs normalized via `api.mediaUrl()`. |
| `POST`   | `/api/admin/media`           | **Multipart**: store each `files[]` via the storage adapter, `INSERT media_assets`, optionally `INSERT media_links` if `productId` is in the form. Returns array. **JSON fallback**: legacy URL-only `INSERT`. |
| `POST`   | `/api/admin/media/gdrive`    | **NEW**: Download images from a Google Drive file or folder URL, `INSERT media_assets` for each, then auto-link by SKU via 4-tier matching. Uses a shared `sortCounters` Map within the transaction to prevent `sort_order` duplicate key conflicts. Requires `GOOGLE_DRIVE_API_KEY` (or `GOOGLE_API_KEY`) for folder listing. |
| `PATCH`  | `/api/admin/media/:id/link`  | Transaction: delete existing `media_links` for asset, then `INSERT` with `sort_order = COALESCE(MAX+1, 0)`. **Fix:** previous version omitted `sort_order`, which defaulted to 0 and caused a unique constraint violation when linking a second image to the same product. |
| `DELETE` | `/api/admin/media/orphaned`  | Find all assets with no `media_links` entries, `DELETE media_assets`, call `storage.remove()` for each file. |
| `DELETE` | `/api/admin/media/:id`       | `DELETE media_assets` row + `storage.remove()` to clear the file on disk. |
| `POST`   | `/api/admin/products/:id/images` | **Multipart**: batch-uploads images for a product. Transaction writes `media_assets` + `media_links` (role=`gallery`, `sort_order` continuing from current max) and promotes the first new image to `products.primary_media_id` if none was set. Returns `images: string[]` normalized via `api.mediaUrl()` so freshly-uploaded images display immediately. |

### Storefront Editor

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/storefront/draft` | `SELECT` draft snapshot and ordered blocks |
| `GET` | `/api/admin/storefront/published` | `SELECT` latest published snapshot and ordered blocks |
| `POST` | `/api/admin/storefront/draft` | Transaction: upsert draft snapshot, replace blocks and block products |
| `POST` | `/api/admin/storefront/publish` | Transaction: copy draft into a new published snapshot |

### Settings, Team, Integrations

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/settings/store` | `SELECT` tenant, brand profile, store settings |
| `PATCH` | `/api/admin/settings/store` | Transaction: `UPDATE` tenant and store settings |
| `GET` | `/api/admin/settings/team` | `SELECT` admin users |
| `POST` | `/api/admin/settings/team` | `INSERT ... ON CONFLICT DO UPDATE` admin user |
| `PATCH` | `/api/admin/settings/team/:id` | `UPDATE` admin user |
| `GET` | `/api/admin/settings/invitations` | `SELECT` from `team_invitations` where not expired |
| `POST` | `/api/admin/settings/invitations` | `INSERT` into `team_invitations` with SHA-256 hashed token; returns raw token in `inviteLink` |
| `DELETE` | `/api/admin/settings/invitations/:id` | `DELETE` from `team_invitations` |
| `GET` | `/api/invitations/validate?token=` | Hash-lookup in `team_invitations`, return `{ email, role }` |
| `POST` | `/api/invitations/accept` | Transaction: `INSERT` admin_users (bcrypt password), `DELETE` invitation row |
| `GET` | `/api/admin/settings/integrations` | `SELECT` integrations |
| `POST` | `/api/admin/settings/integrations` | `INSERT ... ON CONFLICT DO UPDATE` integration |

### Analytics

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/analytics/overview` | `SELECT` metric rollups, traffic, funnel, top 3D products |
| `POST` | `/api/admin/analytics/events` | `INSERT` analytics event |

---

## Frontend Work Completed

### Admin Portal

The product drawer Save Changes action now calls:

```http
POST /api/admin/products
```

This inserts/updates the product row in `products` and replaces variants in `product_variants`.

Files changed:

- `client/projects/admin-portal/src/app/services/admin-products.service.ts`
- `client/projects/admin-portal/src/app/pages/catalog/product-drawer.component.ts`

### Client Web

The storefront product service now calls:

```http
GET /api/products
```

This lets the collection page show rows from the real `products` table.

Files changed:

- `client/projects/client-web/src/app/services/products.service.ts`
- `client/projects/client-web/src/app/pages/collection/collection.component.ts`
- `client/projects/client-web/src/app/pages/product/product.component.ts`
- `client/projects/client-web/src/app/models/product.model.ts`
- `client/projects/client-web/src/app/services/cart.service.ts`

Product IDs were changed from `number` to `string` because PostgreSQL uses UUIDs.

---

## Important Current State

The backend database/API layer is now available across all major domains.

Already wired to the UI:

- Admin product save
- Storefront product collection loading

Still mock-backed:

- Analytics charts still use `mock.ts` rollups — `GET /api/admin/analytics/overview` exists but is not yet wired to the analytics component
- `data/mock.ts` is imported only by the analytics page now; all other pages use real API services

All other major admin pages (catalog, orders, customers, media, storefront, settings) are fully wired to PostgreSQL via their respective `Admin*Service` classes.

---

## Verification Performed

Commands run successfully:

```bash
node -c server/routes/*.js
npm run build:admin
npm run build:web
```

Smoke-tested endpoints:

- `GET /api/health`
- `GET /api/products`
- `GET /api/admin/products`
- `GET /api/admin/collections`
- `POST /api/admin/collections`
- `GET /api/admin/customers`
- `POST /api/admin/customers`
- `GET /api/admin/orders`
- `GET /api/admin/media`
- `GET /api/admin/settings/store`
- `POST /api/admin/settings/team`
- `GET /api/admin/analytics/overview`
- `POST /api/contact`
- `POST /api/admin/storefront/draft`
- `POST /api/carts`

Temporary smoke-test rows were removed after testing where appropriate.

---

## Remaining Work

- **Analytics** — wire `AnalyticsComponent` to `GET /api/admin/analytics/overview`; remove remaining `mock.ts` import
- **Password reset emails** — `POST /api/auth/forgot` currently logs the reset URL to stdout; wire a real email transport (Resend / SES / SendGrid) in production
- **Team invitation emails** — `POST /api/admin/settings/invitations` returns `inviteLink` in the response body; the admin copies it manually. Wire email delivery in production
- **POS backend** — `admin-pos.route.js` is planned but not yet built; see `docs/pos-system-plan.html`
- **S3 / Supabase storage** — currently disk-only; add driver in `server/lib/storage.js` and set `STORAGE_DRIVER` env

---

## Admin Portal → Schema Mapping (May 2026 updates)

This section maps the admin-portal features shipped in May 2026 onto the tables/columns that back them. The schema already covers each feature — wiring the admin services from mock-in-memory to real `pg` queries is the remaining work.

| Admin portal feature | Tables / columns used | Notes |
|---|---|---|
| Product variants (size / color / material) | `product_variants` (`sku`, `size`, `color`, `material`, `price_cents`, `stock_quantity`, `sort_order`, `is_active`) | One row per variant; `UNIQUE (tenant_id, sku)`. Replace-on-save semantics already documented for `POST /api/admin/products`. |
| Product create flow ("New Product") | `products` (`INSERT … ON CONFLICT DO UPDATE` by `(tenant_id, sku)`) + `product_variants` | The drawer posts the full draft on first save. Until then the stub lives in the catalog signal only. |
| Product image gallery (drag-reorder, primary, upload) | `media_assets` + `media_links` (`product_id`, `role`, `sort_order`) | `role='primary'` for the first image, `role='gallery'` for the rest; `sort_order` drives display order. `products.primary_media_id` mirrors the primary. |
| Rich-text descriptions (EN + AR) | `product_translations` (`description` text) — one row per locale | Editor emits HTML; persist as-is. Sanitise on render for the storefront. |
| Order detail drawer (replaces modal) | `orders` + `order_items` + `shipments` (`tracking_number`) + `order_timeline_entries` + `order_notes` | All four sections in the drawer map to these tables. |
| Order status workflow (awaiting → processing → shipped → delivered, cancel/refund) | `orders.fulfillment_status` / `orders.payment_status` + `shipments` + `order_timeline_entries` | Each transition writes one row into `order_timeline_entries` with `kind` matching the workflow step. Tracking number lives on `shipments.tracking_number`; mark-as-shipped writes shipments + timeline together. |
| Order internal notes | `order_notes` (`body`, `author_user_id`, `created_at`) | Notes also surface as a `kind='note'` row in `order_timeline_entries` so the audit log is unified. |
| Customer edit / create + "Add Customer" | `customers` (`INSERT … ON CONFLICT DO UPDATE` on `(tenant_id, email)`) | `orders_count` / `ltv_cents` / `last_order_at` are denormalised; refresh from `v_customer_order_stats` after order changes. |
| Customer order history with click-to-navigate | `orders` filtered by `customer_id` (or by name in the mock); navigation uses `/orders?id=…` | Admin orders route reads `?id=` query param and auto-opens that order's drawer. |
| Collection cover image upload (drag-drop) | `collections.cover_media_id` + `media_assets` | Upload first inserts a `media_assets` row, then sets `cover_media_id`. Drag-drop path uses FileReader → data URL in the mock prototype; the real path is multipart upload then `INSERT media_assets`. |
| Collection drag-to-reorder of products | `collection_products.sort_order` | Save writes `productIds` order back as `sort_order = 0..N`. `collection_products_collection_order_idx` already indexes this. |
| Sidebar/Dashboard/etc. transcreated Arabic | n/a (frontend `i18n/strings.ts`) | DB content uses `*_translations` tables for product/collection bodies; UI chrome is bundled in the SPA. |
| Dashboard i18n + `routerLink="/orders"` | n/a (frontend only) | KPI labels driven by `dash.*` keys; "View All" navigates with Angular Router. |
| Dashboard live KPIs + revenue chart + heatmap + Recent Orders | `orders`, `order_items`, `products`, `customers` | Loads in parallel from `/api/admin/orders`, `/api/admin/products`, `/api/admin/customers`. Today's revenue, active-orders count, recent customers, and the 30-day revenue series are all derived from real DB rows — no `mock.ts` import in the dashboard. |
| Password reset flow | `password_reset_tokens` (SHA-256 hashed `token_hash`, `expires_at`, `used_at`) | `POST /api/auth/forgot` writes a row; `POST /api/auth/reset` validates + flips `used_at`. One-shot, 30-min TTL, replay-protected. |
| Live signed-in user (sidebar) | `admin_users` (via `/api/auth/me`) | The sidebar footer reads `auth.user()` to render avatar initials, full name, role, and email. Sign-out lives next to the user card; the topbar avatar/logout were removed to eliminate the duplicate. |
| Real file uploads (product images + media library) | `media_assets` (rows + `metadata.storagePath`) + `media_links` (role/sort_order) + `products.primary_media_id` | `POST /api/admin/media` (multipart, returns array) and `POST /api/admin/products/:id/images` (multipart, returns ordered `images[]`). Storage adapter writes to disk locally; swap to S3/Supabase via `STORAGE_DRIVER` env. `DELETE` removes file from disk too. |

> Notation: `INSERT … ON CONFLICT DO UPDATE` patterns reuse the existing routes documented in [Admin API](#admin-api).

---

## Known Limitations

- Tenant selection is still the default tenant — multi-tenant routing (subdomain or header-based) is not wired yet.
- Production storage driver: currently disk-only. S3 / Supabase / R2 adapters need to be added in `server/lib/storage.js` and selected via `STORAGE_DRIVER`.
- Collection cover upload: schema is ready (`collections.cover_media_id`); wire the drag-drop upload to `POST /api/admin/media` then `PATCH /api/admin/collections/:id` with the new media id.
- Admin pages still on mock data: Media, Storefront, Analytics, Settings. Their services need to be created following the existing `Admin*Service` pattern.
- Password reset emails: `POST /api/auth/forgot` currently logs the URL to stdout. Wire a real email transport (Resend / SES / SendGrid) and replace the `console.log` in [server/routes/auth.route.js](../server/routes/auth.route.js).
- No automated backend test suite exists yet.
