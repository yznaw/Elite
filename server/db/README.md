# Elite PostgreSQL Database

This folder contains the PostgreSQL schema for the Elite white-label ecommerce platform.

## Migration

Initial schema:

```bash
psql "$DATABASE_URL" -f server/db/migrations/001_initial_schema.sql
```

Or from the `server/` folder:

```bash
npm run db:migrate
```

## Design

- **White-label ready:** every business table is scoped by `tenant_id`.
- **Professional ecommerce core:** products, variants, media, inventory, collections, carts, orders, payments, shipments, and order timelines are relational.
- **Admin portal support:** customers, team members, notifications, integrations, sync sources/logs, storefront draft/publish, internal order notes, and contact submissions are included.
- **Storefront support:** published storefront snapshots and ordered blocks can drive the client-web home/editor experience.
- **Analytics support:** raw events plus daily rollups, traffic source rows, funnel steps, and product/3D interactions are available.
- **Operational safety:** UUID primary keys, foreign keys, scoped unique constraints, status enums, amount/quantity checks, useful indexes, and `updated_at` triggers are included.

## Important Tables

| Area | Tables |
|---|---|
| Tenancy & brand | `tenants`, `brand_profiles`, `store_settings` |
| Admin/team | `admin_users`, `notifications`, `audit_events` |
| Catalog | `products`, `product_translations`, `product_variants`, `media_assets`, `media_links`, `inventory_movements` |
| Collections | `collections`, `collection_translations`, `collection_products` |
| Checkout | `carts`, `cart_items`, `orders`, `order_items`, `payments`, `shipments` |
| CRM | `customers`, `customer_addresses`, `order_notes`, `contact_submissions` |
| Storefront editor | `storefront_snapshots`, `storefront_blocks`, `storefront_block_products` |
| Analytics | `analytics_events`, `daily_metrics`, `traffic_sources`, `conversion_funnel_steps`, `product_interactions` |
| Sync/integrations | `sync_sources`, `sync_logs`, `integrations` |

## Conventions

- Money is stored as integer cents, for example `280000` means `QAR 2,800.00`.
- User-facing IDs such as order numbers and SKUs are stored separately from UUID primary keys.
- Translatable content is stored either in translation tables or JSON objects keyed by locale.
- Keep API routes tenant-aware. Every query that reads business data should filter by `tenant_id`.
