-- Migration 006: Add cost_price_cents to product_variants
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS cost_price_cents integer;

-- Add check constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_cost_nonneg'
  ) THEN
    ALTER TABLE product_variants
      ADD CONSTRAINT product_variants_cost_nonneg
        CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0);
  END IF;
END$$;
