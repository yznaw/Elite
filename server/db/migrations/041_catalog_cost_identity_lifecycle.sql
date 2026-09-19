-- Catalog cost defaults + safe identifier lifecycle.
--
-- This migration is deliberately additive. It does not rewrite a current SKU,
-- barcode, or historical order. Application code can start using the new
-- columns while older clients continue to read/write the existing shape.

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS default_cost_price_cents integer,
  ADD COLUMN IF NOT EXISTS default_shipping_cost_cents integer,
  ADD COLUMN IF NOT EXISTS duplicated_from_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS catalog_revision bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_default_cost_nonnegative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_default_cost_nonnegative
      CHECK (default_cost_price_cents IS NULL OR default_cost_price_cents >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_default_shipping_nonnegative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_default_shipping_nonnegative
      CHECK (default_shipping_cost_cents IS NULL OR default_shipping_cost_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_duplicated_from_idx
  ON products (duplicated_from_product_id)
  WHERE duplicated_from_product_id IS NOT NULL;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS barcode_source text;

UPDATE product_variants
   SET barcode_source = CASE
     WHEN NULLIF(btrim(barcode), '') IS NULL OR btrim(barcode) = btrim(sku) THEN 'auto'
     ELSE 'manual'
   END
 WHERE barcode_source IS NULL;

ALTER TABLE product_variants
  ALTER COLUMN barcode_source SET DEFAULT 'auto',
  ALTER COLUMN barcode_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_barcode_source_check'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_barcode_source_check
      CHECK (barcode_source IN ('auto', 'manual'));
  END IF;
END $$;

-- Old SKUs/barcodes remain resolvable after an intentional re-key. Aliases are
-- display-inactive: product and variant tables remain the source of truth.
CREATE TABLE IF NOT EXISTS catalog_identifier_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  identifier_type text NOT NULL,
  value text NOT NULL,
  normalized_value text GENERATED ALWAYS AS (lower(btrim(value))) STORED,
  reason text NOT NULL DEFAULT 'catalog_rekey',
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_identifier_alias_target_check CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL AND identifier_type = 'product_sku')
    OR
    (product_id IS NULL AND variant_id IS NOT NULL AND identifier_type IN ('variant_sku', 'barcode'))
  ),
  CONSTRAINT catalog_identifier_alias_type_check CHECK (
    identifier_type IN ('product_sku', 'variant_sku', 'barcode')
  ),
  CONSTRAINT catalog_identifier_alias_value_check CHECK (btrim(value) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_identifier_aliases_value_uq
  ON catalog_identifier_aliases (tenant_id, identifier_type, normalized_value);
CREATE INDEX IF NOT EXISTS catalog_identifier_aliases_product_idx
  ON catalog_identifier_aliases (tenant_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_identifier_aliases_variant_idx
  ON catalog_identifier_aliases (tenant_id, variant_id)
  WHERE variant_id IS NOT NULL;

-- A sale needs the cost that was true when it happened. Joining an old order
-- to today's catalog cost makes historical profit change after a catalog edit.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS unit_cost_cents integer,
  ADD COLUMN IF NOT EXISTS shipping_cost_cents integer,
  ADD COLUMN IF NOT EXISTS total_cost_cents integer,
  ADD COLUMN IF NOT EXISTS cost_snapshot_source text NOT NULL DEFAULT 'missing';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_cost_snapshot_nonnegative'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_cost_snapshot_nonnegative CHECK (
        (unit_cost_cents IS NULL OR unit_cost_cents >= 0)
        AND (shipping_cost_cents IS NULL OR shipping_cost_cents >= 0)
        AND (total_cost_cents IS NULL OR total_cost_cents >= 0)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_cost_snapshot_source_check'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_cost_snapshot_source_check
      CHECK (cost_snapshot_source IN ('captured', 'legacy_estimate', 'missing'));
  END IF;
END $$;

-- Freeze the best available estimate for legacy sales at migration time. It
-- cannot reconstruct the true historical cost, so the source is explicit and
-- reporting can distinguish it from a cost captured when the sale happened.
UPDATE order_items oi
   SET unit_cost_cents = pv.cost_price_cents,
       shipping_cost_cents = pv.shipping_cost_cents,
       total_cost_cents = pv.total_cost_cents,
       cost_snapshot_source = CASE
         WHEN pv.total_cost_cents IS NULL THEN 'missing'
         ELSE 'legacy_estimate'
       END
  FROM product_variants pv
 WHERE oi.variant_id = pv.id
   AND oi.total_cost_cents IS NULL;

-- A default is safe to infer only when every active variant has the same,
-- non-null value. Mixed/partial products intentionally remain NULL.
WITH uniform_cost AS (
  SELECT product_id, min(cost_price_cents) AS value
    FROM product_variants
   WHERE is_active
   GROUP BY product_id
  HAVING count(*) = count(cost_price_cents)
     AND count(DISTINCT cost_price_cents) = 1
)
UPDATE products p
   SET default_cost_price_cents = u.value
  FROM uniform_cost u
 WHERE p.id = u.product_id
   AND p.default_cost_price_cents IS NULL;

WITH uniform_shipping AS (
  SELECT product_id, min(shipping_cost_cents) AS value
    FROM product_variants
   WHERE is_active
   GROUP BY product_id
  HAVING count(*) = count(shipping_cost_cents)
     AND count(DISTINCT shipping_cost_cents) = 1
)
UPDATE products p
   SET default_shipping_cost_cents = u.value
  FROM uniform_shipping u
 WHERE p.id = u.product_id
   AND p.default_shipping_cost_cents IS NULL;

COMMIT;
