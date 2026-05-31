-- Elite initial PostgreSQL schema
-- Covers the white-label storefront, admin portal, catalog, orders, CRM,
-- storefront publishing, analytics, integrations, and sync engine.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'manager', 'viewer');
CREATE TYPE team_member_status AS ENUM ('invited', 'active', 'disabled');
CREATE TYPE product_status AS ENUM ('draft', 'active', 'hidden', 'archived');
CREATE TYPE media_kind AS ENUM ('image', 'video', 'model_3d', 'document');
CREATE TYPE collection_status AS ENUM ('draft', 'active', 'hidden', 'archived');
CREATE TYPE cart_status AS ENUM ('active', 'converted', 'abandoned');
CREATE TYPE order_status AS ENUM ('placed', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded', 'returned');
CREATE TYPE order_payment_status AS ENUM ('pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE order_fulfillment_status AS ENUM ('awaiting', 'processing', 'shipped', 'delivered', 'cancelled', 'returned');
CREATE TYPE order_timeline_kind AS ENUM ('placed', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'note');
CREATE TYPE storefront_snapshot_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE sync_status AS ENUM ('success', 'failed', 'partial', 'running', 'pending');
CREATE TYPE trigger_type AS ENUM ('manual', 'auto', 'system');
CREATE TYPE integration_status AS ENUM ('connected', 'disconnected', 'error', 'pending');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  default_locale text NOT NULL DEFAULT 'en',
  supported_locales text[] NOT NULL DEFAULT ARRAY['en', 'ar'],
  currency char(3) NOT NULL DEFAULT 'QAR',
  timezone text NOT NULL DEFAULT 'Asia/Qatar',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT tenants_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE brand_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tagline text,
  established_label text,
  copyright_text text,
  primary_domain text,
  admin_domain text,
  logo_url text,
  favicon_url text,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER brand_profiles_set_updated_at
BEFORE UPDATE ON brand_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email citext NOT NULL,
  password_hash text,
  full_name text NOT NULL,
  initials text NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  status team_member_status NOT NULL DEFAULT 'invited',
  last_login_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  CONSTRAINT admin_users_initials_len CHECK (char_length(initials) BETWEEN 1 AND 6)
);

CREATE INDEX admin_users_tenant_role_idx ON admin_users (tenant_id, role);

CREATE TRIGGER admin_users_set_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE store_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  contact_email citext,
  support_phone text,
  default_currency char(3) NOT NULL DEFAULT 'QAR',
  timezone text NOT NULL DEFAULT 'Asia/Qatar',
  locales text[] NOT NULL DEFAULT ARRAY['en', 'ar'],
  checkout_enabled boolean NOT NULL DEFAULT true,
  tax_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_settings_currency_format CHECK (default_currency ~ '^[A-Z]{3}$')
);

CREATE TRIGGER store_settings_set_updated_at
BEFORE UPDATE ON store_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email citext NOT NULL,
  full_name text NOT NULL,
  phone text,
  city text,
  country text,
  size_preference numeric(4,1),
  notes text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  marketing_opt_in boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_order_at timestamptz,
  ltv_cents bigint NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  CONSTRAINT customers_ltv_nonnegative CHECK (ltv_cents >= 0),
  CONSTRAINT customers_orders_count_nonnegative CHECK (orders_count >= 0)
);

CREATE INDEX customers_tenant_last_order_idx ON customers (tenant_id, last_order_at DESC);
CREATE INDEX customers_tenant_city_idx ON customers (tenant_id, city);

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_type text NOT NULL DEFAULT 'shipping',
  full_name text,
  phone text,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  country text NOT NULL DEFAULT 'QA',
  is_default_shipping boolean NOT NULL DEFAULT false,
  is_default_billing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_type_check CHECK (address_type IN ('shipping', 'billing', 'both'))
);

CREATE INDEX customer_addresses_customer_idx ON customer_addresses (customer_id);

CREATE TRIGGER customer_addresses_set_updated_at
BEFORE UPDATE ON customer_addresses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku text NOT NULL,
  brand text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  status product_status NOT NULL DEFAULT 'draft',
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  care_instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  leather text,
  style text,
  tag text,
  base_price_cents integer NOT NULL,
  compare_at_price_cents integer,
  currency char(3) NOT NULL DEFAULT 'QAR',
  stock_quantity integer NOT NULL DEFAULT 0,
  tracks_inventory boolean NOT NULL DEFAULT true,
  has_3d boolean NOT NULL DEFAULT false,
  views_3d integer NOT NULL DEFAULT 0,
  primary_media_id uuid,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku),
  UNIQUE (tenant_id, slug),
  CONSTRAINT products_price_nonnegative CHECK (base_price_cents >= 0),
  CONSTRAINT products_compare_price_nonnegative CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= 0),
  CONSTRAINT products_stock_nonnegative CHECK (stock_quantity >= 0),
  CONSTRAINT products_views_nonnegative CHECK (views_3d >= 0),
  CONSTRAINT products_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX products_tenant_status_idx ON products (tenant_id, status);
CREATE INDEX products_tenant_brand_idx ON products (tenant_id, brand);
CREATE INDEX products_tenant_style_idx ON products (tenant_id, style);
CREATE INDEX products_tenant_price_idx ON products (tenant_id, base_price_cents);

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale text NOT NULL,
  name text NOT NULL,
  description text,
  leather text,
  style text,
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, locale)
);

CREATE TRIGGER product_translations_set_updated_at
BEFORE UPDATE ON product_translations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  barcode text,
  size text,
  color text,
  material text,
  price_cents integer NOT NULL,
  compare_at_price_cents integer,
  stock_quantity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku),
  CONSTRAINT product_variants_price_nonnegative CHECK (price_cents >= 0),
  CONSTRAINT product_variants_compare_price_nonnegative CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= 0),
  CONSTRAINT product_variants_stock_nonnegative CHECK (stock_quantity >= 0)
);

CREATE INDEX product_variants_product_idx ON product_variants (product_id, sort_order);
CREATE INDEX product_variants_tenant_active_idx ON product_variants (tenant_id, is_active);

CREATE TRIGGER product_variants_set_updated_at
BEFORE UPDATE ON product_variants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename text NOT NULL,
  kind media_kind NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  width integer,
  height integer,
  storage_url text NOT NULL,
  preview_url text,
  alt_text jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text,
  uploaded_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_size_nonnegative CHECK (size_bytes >= 0),
  CONSTRAINT media_assets_dimensions_positive CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0))
);

CREATE INDEX media_assets_tenant_kind_idx ON media_assets (tenant_id, kind);
CREATE INDEX media_assets_tenant_uploaded_idx ON media_assets (tenant_id, uploaded_at DESC);
CREATE INDEX media_assets_checksum_idx ON media_assets (checksum);

CREATE TRIGGER media_assets_set_updated_at
BEFORE UPDATE ON media_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE products
ADD CONSTRAINT products_primary_media_fk
FOREIGN KEY (primary_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE media_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'gallery',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_links_target_required CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL),
  CONSTRAINT media_links_role_check CHECK (role IN ('gallery', 'primary', 'model_3d', 'cover', 'document'))
);

CREATE INDEX media_links_product_idx ON media_links (product_id, role, sort_order);
CREATE INDEX media_links_variant_idx ON media_links (variant_id, role, sort_order);
CREATE UNIQUE INDEX media_links_unique_product_role_order_idx
ON media_links (product_id, role, sort_order)
WHERE product_id IS NOT NULL;

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  reference_type text,
  reference_id uuid,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX inventory_movements_product_idx ON inventory_movements (product_id, occurred_at DESC);
CREATE INDEX inventory_movements_variant_idx ON inventory_movements (variant_id, occurred_at DESC);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  handle text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  status collection_status NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, handle),
  CONSTRAINT collections_handle_format CHECK (handle ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE INDEX collections_tenant_status_idx ON collections (tenant_id, status, sort_order);

CREATE TRIGGER collections_set_updated_at
BEFORE UPDATE ON collections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE collection_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  locale text NOT NULL,
  title text NOT NULL,
  description text,
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, locale)
);

CREATE TRIGGER collection_translations_set_updated_at
BEFORE UPDATE ON collection_translations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE collection_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, product_id)
);

CREATE INDEX collection_products_collection_order_idx ON collection_products (collection_id, sort_order);
CREATE INDEX collection_products_product_idx ON collection_products (product_id);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  session_id text,
  status cart_status NOT NULL DEFAULT 'active',
  currency char(3) NOT NULL DEFAULT 'QAR',
  subtotal_cents integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_subtotal_nonnegative CHECK (subtotal_cents >= 0),
  CONSTRAINT carts_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX carts_active_session_uq
ON carts (tenant_id, session_id)
WHERE session_id IS NOT NULL AND status = 'active';
CREATE INDEX carts_customer_idx ON carts (customer_id, created_at DESC);

CREATE TRIGGER carts_set_updated_at
BEFORE UPDATE ON carts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text NOT NULL,
  size text,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'QAR',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id, variant_id, size),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT cart_items_price_nonnegative CHECK (unit_price_cents >= 0),
  CONSTRAINT cart_items_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX cart_items_cart_idx ON cart_items (cart_id);

CREATE TRIGGER cart_items_set_updated_at
BEFORE UPDATE ON cart_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  public_number text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_email citext,
  customer_name text NOT NULL,
  customer_phone text,
  status order_status NOT NULL DEFAULT 'placed',
  payment_status order_payment_status NOT NULL DEFAULT 'pending',
  fulfillment_status order_fulfillment_status NOT NULL DEFAULT 'awaiting',
  currency char(3) NOT NULL DEFAULT 'QAR',
  subtotal_cents integer NOT NULL DEFAULT 0,
  shipping_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  discount_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  shipping_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  placed_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, public_number),
  CONSTRAINT orders_amounts_nonnegative CHECK (
    subtotal_cents >= 0 AND shipping_cents >= 0 AND tax_cents >= 0
    AND discount_cents >= 0 AND total_cents >= 0
  ),
  CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX orders_tenant_placed_idx ON orders (tenant_id, placed_at DESC);
CREATE INDEX orders_tenant_payment_idx ON orders (tenant_id, payment_status);
CREATE INDEX orders_tenant_fulfillment_idx ON orders (tenant_id, fulfillment_status);
CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at DESC);

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  variant_title text,
  size text,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  total_cents integer NOT NULL,
  media_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_amounts_nonnegative CHECK (unit_price_cents >= 0 AND total_cents >= 0)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_payment_id text,
  method text,
  status order_payment_status NOT NULL DEFAULT 'pending',
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'QAR',
  processed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_nonnegative CHECK (amount_cents >= 0),
  CONSTRAINT payments_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_provider_idx ON payments (provider, provider_payment_id);

CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier text,
  service text,
  tracking_number text,
  tracking_url text,
  status order_fulfillment_status NOT NULL DEFAULT 'awaiting',
  shipped_at timestamptz,
  delivered_at timestamptz,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipments_order_idx ON shipments (order_id);
CREATE INDEX shipments_tracking_idx ON shipments (tracking_number);

CREATE TRIGGER shipments_set_updated_at
BEFORE UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_timeline_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind order_timeline_kind NOT NULL,
  detail text,
  actor_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX order_timeline_entries_order_idx ON order_timeline_entries (order_id, occurred_at);

CREATE TABLE order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_notes_order_idx ON order_notes (order_id, created_at DESC);

CREATE TABLE storefront_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status storefront_snapshot_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  title text,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  published_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  published_at timestamptz,
  preview_token_hash text,
  preview_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version),
  CONSTRAINT storefront_snapshots_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX storefront_snapshots_one_draft_idx
ON storefront_snapshots (tenant_id)
WHERE status = 'draft';
CREATE INDEX storefront_snapshots_published_idx ON storefront_snapshots (tenant_id, published_at DESC)
WHERE status = 'published';

CREATE TRIGGER storefront_snapshots_set_updated_at
BEFORE UPDATE ON storefront_snapshots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE storefront_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES storefront_snapshots(id) ON DELETE CASCADE,
  block_key text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  config text NOT NULL DEFAULT '',
  subtitle text,
  cta_text text,
  cta_link text,
  image_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  item_limit integer,
  sort_by text,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, block_key),
  CONSTRAINT storefront_blocks_item_limit_positive CHECK (item_limit IS NULL OR item_limit > 0),
  CONSTRAINT storefront_blocks_sort_by_check CHECK (
    sort_by IS NULL OR sort_by IN ('newest', 'bestseller', 'price-asc', 'price-desc', 'manual')
  )
);

CREATE INDEX storefront_blocks_snapshot_order_idx ON storefront_blocks (snapshot_id, sort_order);

CREATE TRIGGER storefront_blocks_set_updated_at
BEFORE UPDATE ON storefront_blocks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE storefront_block_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES storefront_blocks(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (block_id, product_id)
);

CREATE INDEX storefront_block_products_block_order_idx ON storefront_block_products (block_id, sort_order);

CREATE TABLE contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  email citext NOT NULL,
  phone text,
  subject text,
  message text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'new',
  assigned_to_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_submissions_status_check CHECK (status IN ('new', 'open', 'resolved', 'spam'))
);

CREATE INDEX contact_submissions_tenant_status_idx ON contact_submissions (tenant_id, status, created_at DESC);

CREATE TRIGGER contact_submissions_set_updated_at
BEFORE UPDATE ON contact_submissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE restock_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email citext NOT NULL,
  name text,
  phone text,
  size text NOT NULL,
  color text,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restock_notifications_status_check CHECK (status IN ('pending', 'notified', 'cancelled'))
);

CREATE INDEX restock_notifications_pending_product_idx
ON restock_notifications (tenant_id, product_id, size, status, requested_at)
WHERE status = 'pending';

CREATE UNIQUE INDEX restock_notifications_pending_unique_idx
ON restock_notifications (tenant_id, product_id, email, size, lower(COALESCE(color, '')))
WHERE status = 'pending';

CREATE TRIGGER restock_notifications_set_updated_at
BEFORE UPDATE ON restock_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  session_id text,
  event_type text NOT NULL,
  page_path text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  locale text,
  user_agent text,
  referrer text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_tenant_time_idx ON analytics_events (tenant_id, occurred_at DESC);
CREATE INDEX analytics_events_type_time_idx ON analytics_events (tenant_id, event_type, occurred_at DESC);
CREATE INDEX analytics_events_session_idx ON analytics_events (tenant_id, session_id);

CREATE TABLE daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  revenue_cents bigint NOT NULL DEFAULT 0,
  sessions integer NOT NULL DEFAULT 0,
  visitors integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  product_views integer NOT NULL DEFAULT 0,
  add_to_carts integer NOT NULL DEFAULT 0,
  checkouts integer NOT NULL DEFAULT 0,
  three_d_views integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_date),
  CONSTRAINT daily_metrics_nonnegative CHECK (
    revenue_cents >= 0 AND sessions >= 0 AND visitors >= 0 AND conversions >= 0
    AND orders_count >= 0 AND product_views >= 0 AND add_to_carts >= 0
    AND checkouts >= 0 AND three_d_views >= 0
  )
);

CREATE INDEX daily_metrics_tenant_date_idx ON daily_metrics (tenant_id, metric_date DESC);

CREATE TRIGGER daily_metrics_set_updated_at
BEFORE UPDATE ON daily_metrics
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE traffic_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  source text NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  revenue_cents bigint NOT NULL DEFAULT 0,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_date, source),
  CONSTRAINT traffic_sources_nonnegative CHECK (sessions >= 0 AND conversions >= 0 AND revenue_cents >= 0)
);

CREATE INDEX traffic_sources_tenant_date_idx ON traffic_sources (tenant_id, metric_date DESC);

CREATE TABLE conversion_funnel_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  label text NOT NULL,
  step_order integer NOT NULL,
  value integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT 'green',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_date, step_order),
  CONSTRAINT conversion_funnel_value_nonnegative CHECK (value >= 0),
  CONSTRAINT conversion_funnel_color_check CHECK (color IN ('green', 'gold', 'blue', 'grey'))
);

CREATE TABLE product_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  session_id text,
  interaction_type text NOT NULL,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_interactions_duration_nonnegative CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX product_interactions_product_time_idx ON product_interactions (product_id, occurred_at DESC);
CREATE INDEX product_interactions_type_idx ON product_interactions (tenant_id, interaction_type, occurred_at DESC);

CREATE TABLE sync_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_bg text,
  status sync_status NOT NULL DEFAULT 'pending',
  schedule_label text,
  cron_expression text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  records_today integer NOT NULL DEFAULT 0,
  updated_today integer NOT NULL DEFAULT 0,
  avg_duration_ms integer NOT NULL DEFAULT 0,
  success_rate numeric(5,2) NOT NULL DEFAULT 0,
  paused boolean NOT NULL DEFAULT false,
  error_message text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_key),
  CONSTRAINT sync_sources_counts_nonnegative CHECK (records_today >= 0 AND updated_today >= 0 AND avg_duration_ms >= 0),
  CONSTRAINT sync_sources_success_rate_range CHECK (success_rate >= 0 AND success_rate <= 100)
);

CREATE INDEX sync_sources_tenant_status_idx ON sync_sources (tenant_id, status);

CREATE TRIGGER sync_sources_set_updated_at
BEFORE UPDATE ON sync_sources
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sync_source_id uuid NOT NULL REFERENCES sync_sources(id) ON DELETE CASCADE,
  run_type text NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  status sync_status NOT NULL DEFAULT 'running',
  duration_ms integer NOT NULL DEFAULT 0,
  error_message text NOT NULL DEFAULT '',
  triggered_by trigger_type NOT NULL DEFAULT 'system',
  triggered_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  trigger_context text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sync_logs_counts_nonnegative CHECK (processed_count >= 0 AND updated_count >= 0 AND duration_ms >= 0)
);

CREATE INDEX sync_logs_source_time_idx ON sync_logs (sync_source_id, started_at DESC);
CREATE INDEX sync_logs_tenant_status_idx ON sync_logs (tenant_id, status, started_at DESC);

CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status integration_status NOT NULL DEFAULT 'disconnected',
  meta text NOT NULL DEFAULT '',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_ref text,
  connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, integration_key)
);

CREATE INDEX integrations_tenant_status_idx ON integrations (tenant_id, status);

CREATE TRIGGER integrations_set_updated_at
BEFORE UPDATE ON integrations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES admin_users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
WHERE read_at IS NULL;
CREATE INDEX notifications_tenant_created_idx ON notifications (tenant_id, created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_tenant_time_idx ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (tenant_id, entity_type, entity_id);

CREATE VIEW v_product_inventory AS
SELECT
  p.tenant_id,
  p.id AS product_id,
  p.sku,
  p.name,
  p.status,
  p.stock_quantity AS product_stock_quantity,
  COALESCE(SUM(v.stock_quantity), 0)::integer AS variant_stock_quantity,
  CASE
    WHEN COUNT(v.id) = 0 THEN p.stock_quantity
    ELSE COALESCE(SUM(v.stock_quantity), 0)::integer
  END AS available_stock
FROM products p
LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
GROUP BY p.tenant_id, p.id, p.sku, p.name, p.status, p.stock_quantity;

CREATE VIEW v_customer_order_stats AS
SELECT
  c.tenant_id,
  c.id AS customer_id,
  c.full_name,
  c.email,
  COUNT(o.id)::integer AS orders_count,
  COALESCE(SUM(o.total_cents), 0)::bigint AS ltv_cents,
  MAX(o.placed_at) AS last_order_at
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.tenant_id, c.id, c.full_name, c.email;

COMMIT;
