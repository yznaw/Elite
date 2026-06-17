-- Migration 012: Add shipping_cost_cents and total_cost_cents to product_variants
-- total_cost_cents is a stored generated column = product cost + shipping cost
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS shipping_cost_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_shipping_cost_nonneg'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_shipping_cost_nonneg
        CHECK (shipping_cost_cents IS NULL OR shipping_cost_cents >= 0);
  END IF;
END$$;

-- total_cost_cents: stored generated column for analytics/dashboards
-- NULL only when both cost components are NULL; otherwise sums with COALESCE fallback to 0
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS total_cost_cents integer
    GENERATED ALWAYS AS (
      CASE
        WHEN cost_price_cents IS NULL AND shipping_cost_cents IS NULL THEN NULL
        ELSE COALESCE(cost_price_cents, 0) + COALESCE(shipping_cost_cents, 0)
      END
    ) STORED;
