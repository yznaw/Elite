# Elite API Database Command Map

All endpoints use PostgreSQL through `server/db/client.js` and scope business data to the default tenant from `server/db/tenant.js`.

## Public Storefront

| Endpoint | DB command purpose |
|---|---|
| `GET /api/products` | `SELECT` active/hidden products with variant sizes and primary media |
| `GET /api/products/:id` | `SELECT` one storefront product |
| `POST /api/contact` | `INSERT` contact form submission |
| `POST /api/carts` | `INSERT ... ON CONFLICT` active cart by session |
| `GET /api/carts/:id` | `SELECT` cart and cart items |
| `POST /api/carts/:id/items` | `INSERT ... ON CONFLICT DO UPDATE` cart item quantity, then `UPDATE` subtotal |
| `DELETE /api/carts/:id/items/:itemId` | `DELETE` cart item, then `UPDATE` subtotal |
| `POST /api/carts/:id/checkout` | transaction: `INSERT` order, `INSERT` order items, `UPDATE` cart converted |

## Admin Portal

| Endpoint | DB command purpose |
|---|---|
| `GET /api/admin/products` | `SELECT` admin catalog with variants/media |
| `GET /api/admin/products/:id` | `SELECT` one product |
| `POST /api/admin/products` | transaction: `INSERT ... ON CONFLICT DO UPDATE` product, replace variants |
| `PATCH /api/admin/products/:id` | transaction: `SELECT` current product, `UPDATE` via upsert, replace variants when supplied |
| `DELETE /api/admin/products/:id` | soft delete with `UPDATE status = 'archived'` |
| `GET /api/admin/collections` | `SELECT` collections and ordered product IDs |
| `POST /api/admin/collections` | transaction: `INSERT` collection, `INSERT` collection-product rows |
| `PATCH /api/admin/collections/:id` | transaction: `UPDATE` collection, optionally replace product links |
| `DELETE /api/admin/collections/:id` | soft delete with `UPDATE status = 'archived'` |
| `GET /api/admin/customers` | `SELECT` customers joined to order stats view |
| `POST /api/admin/customers` | `INSERT ... ON CONFLICT DO UPDATE` customer |
| `PATCH /api/admin/customers/:id` | `UPDATE` customer profile |
| `DELETE /api/admin/customers/:id` | `DELETE` customer |
| `GET /api/admin/orders` | `SELECT` orders with item JSON aggregation |
| `GET /api/admin/orders/:id` | `SELECT` order detail, timeline, notes |
| `POST /api/admin/orders` | transaction: `INSERT` order, `INSERT` items, `INSERT` timeline entry |
| `PATCH /api/admin/orders/:id/status` | transaction: `UPDATE` statuses, `INSERT` timeline entry |
| `POST /api/admin/orders/:id/notes` | `INSERT` internal note |
| `GET /api/admin/media` | `SELECT` media with product links |
| `POST /api/admin/media` | `INSERT` media metadata |
| `PATCH /api/admin/media/:id/link` | transaction: replace `media_links` for asset |
| `DELETE /api/admin/media/:id` | `DELETE` media asset |
| `GET /api/admin/storefront/draft` | `SELECT` draft snapshot and ordered blocks |
| `GET /api/admin/storefront/published` | `SELECT` latest published snapshot and ordered blocks |
| `POST /api/admin/storefront/draft` | transaction: upsert draft snapshot, replace blocks and block products |
| `POST /api/admin/storefront/publish` | transaction: copy draft into new published snapshot |
| `GET /api/admin/settings/store` | `SELECT` tenant, brand profile, store settings |
| `PATCH /api/admin/settings/store` | transaction: `UPDATE` tenant and store settings |
| `GET /api/admin/settings/team` | `SELECT` admin users |
| `POST /api/admin/settings/team` | `INSERT ... ON CONFLICT DO UPDATE` admin user |
| `PATCH /api/admin/settings/team/:id` | `UPDATE` admin user |
| `GET /api/admin/settings/integrations` | `SELECT` integrations |
| `POST /api/admin/settings/integrations` | `INSERT ... ON CONFLICT DO UPDATE` integration |
| `GET /api/admin/sync/sources` | `SELECT` sync sources |
| `POST /api/admin/sync/sources` | `INSERT ... ON CONFLICT DO UPDATE` sync source |
| `GET /api/admin/sync/logs` | `SELECT` sync logs |
| `POST /api/admin/sync/sources/:sourceId/run` | transaction: `INSERT` running sync log, `UPDATE` source status |
| `PATCH /api/admin/sync/logs/:id/complete` | transaction: `UPDATE` log, `UPDATE` source status |
| `GET /api/admin/analytics/overview` | `SELECT` metric rollups, traffic, funnel, top 3D products |
| `POST /api/admin/analytics/events` | `INSERT` analytics event |
