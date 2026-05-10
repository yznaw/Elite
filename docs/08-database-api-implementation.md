# 08 — Database & API Implementation

> **Audience:** Backend developers, frontend developers wiring pages to API  
> **Last updated:** May 10, 2026

---

## What Was Added

The project was moved from a mock-only prototype toward a PostgreSQL-backed ecommerce platform.

The implementation added:

- A professional PostgreSQL schema for all documented website/admin domains.
- A PostgreSQL database client for the Express server.
- A default tenant helper for white-label/multi-tenant data.
- Public storefront API routes.
- Admin API routes for catalog, collections, customers, orders, media, storefront editor, settings, sync, analytics, and integrations.
- Product save wiring from the admin portal to PostgreSQL.
- Storefront collection loading from the `products` table.
- Documentation for endpoint-to-SQL behavior.

---

## Database Files

| File | Purpose |
|---|---|
| `server/db/migrations/001_initial_schema.sql` | Full initial PostgreSQL schema |
| `server/db/client.js` | Shared `pg` connection pool |
| `server/db/tenant.js` | Creates/loads the default white-label tenant |
| `server/db/README.md` | Database setup notes |
| `server/db/API.md` | Endpoint-to-database command map |

---

## Schema Coverage

The initial schema includes tables for:

- Tenants and white-label brand profiles
- Admin users and team members
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
- Sync sources
- Sync logs
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
```

The API expects `DATABASE_URL` to be configured before database-backed routes can work.

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
| `GET` | `/api/admin/media` | `SELECT` media with product links |
| `POST` | `/api/admin/media` | `INSERT` media metadata |
| `PATCH` | `/api/admin/media/:id/link` | Transaction: replace `media_links` for asset |
| `DELETE` | `/api/admin/media/:id` | `DELETE` media asset |

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
| `GET` | `/api/admin/settings/integrations` | `SELECT` integrations |
| `POST` | `/api/admin/settings/integrations` | `INSERT ... ON CONFLICT DO UPDATE` integration |

### Sync

| Method | Endpoint | Database behavior |
|---|---|---|
| `GET` | `/api/admin/sync/sources` | `SELECT` sync sources |
| `POST` | `/api/admin/sync/sources` | `INSERT ... ON CONFLICT DO UPDATE` sync source |
| `GET` | `/api/admin/sync/logs` | `SELECT` sync logs |
| `POST` | `/api/admin/sync/sources/:sourceId/run` | Transaction: `INSERT` running sync log, `UPDATE` source status |
| `PATCH` | `/api/admin/sync/logs/:id/complete` | Transaction: `UPDATE` log, `UPDATE` source status |

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

Still mock-backed in many admin screens:

- Admin catalog initial list still starts from `data/mock.ts`
- Collections page still starts from `COLLECTIONS`
- Customers page still starts from `CUSTOMERS`
- Orders page still starts from `ORDERS`
- Media page still starts from `MEDIA_INIT`
- Analytics/dashboard still use mock rollups
- Storefront editor service still uses localStorage
- Settings/sync pages still use mock arrays

The API routes exist for these areas, so each page can now be migrated from mock data to HTTP services incrementally.

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
- `GET /api/admin/sync/sources`
- `GET /api/admin/analytics/overview`
- `POST /api/contact`
- `POST /api/admin/storefront/draft`
- `POST /api/carts`

Temporary smoke-test rows were removed after testing where appropriate.

---

## Notes For Next Implementation Pass

Recommended next steps:

1. Create Angular admin services for each API area:
   - `AdminCatalogService`
   - `AdminCollectionsService`
   - `AdminCustomersService`
   - `AdminOrdersService`
   - `AdminMediaService`
   - `AdminStorefrontApiService`
   - `AdminSettingsService`
   - `AdminSyncService`
   - `AdminAnalyticsService`

2. Replace page-level mock imports with service-backed signals.

3. Update drawer save/delete handlers to call:
   - `POST`
   - `PATCH`
   - `DELETE`

4. Add loading, empty, and error states to each page.

5. Add authentication and tenant resolution before production.

6. Add seed data scripts for local development.

7. Add migration tooling once there is more than one migration.

---

## Known Limitations

- Authentication is not implemented yet.
- Tenant selection is currently the default tenant from env variables.
- Media upload stores metadata/URLs only; binary upload storage is not implemented.
- Product image gallery is not fully persisted from the admin product drawer yet.
- Some frontend screens still read mock data until their services are swapped over.
- No automated backend test suite exists yet.

