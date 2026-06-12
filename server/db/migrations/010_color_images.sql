-- Migration 010: Color-image pivot + swatch image + color FK on variants
-- Replaces fragile media_assets.metadata->>'color' JSON blob with a proper
-- relational table. Adds optional swatch_image_url to ref_colors for textured
-- leathers (suede, croc, ostrich) that need a thumbnail instead of a flat hex.
-- Also adds a soft FK (color_ref_id) to product_variants so color renames and
-- delete-guards can operate reliably without breaking existing free-text rows.

BEGIN;

-- ── 1. product_color_images pivot ────────────────────────────────────────────
-- One row per (product, color) pair. sort_order allows multiple images per
-- color in future (front / back / detail), first row (sort_order=0) is primary.
CREATE TABLE product_color_images (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES products(id)      ON DELETE CASCADE,
  color        text        NOT NULL,          -- lower(trim(name_en)) — always lowercase
  media_id     uuid        NOT NULL REFERENCES media_assets(id)  ON DELETE CASCADE,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_color_images_unique UNIQUE (product_id, color, sort_order)
);

CREATE INDEX product_color_images_product_idx ON product_color_images (product_id);
CREATE INDEX product_color_images_tenant_idx  ON product_color_images (tenant_id);

-- ── 2. Swatch image on ref_colors ─────────────────────────────────────────────
-- NULL = use hex circle (default for smooth/box leather).
-- Set to a 48×48 texture crop URL for exotic leathers (suede, croc, ostrich).
ALTER TABLE ref_colors
  ADD COLUMN IF NOT EXISTS swatch_image_url text;

-- ── 3. Soft FK: color_ref_id on product_variants ──────────────────────────────
-- Nullable so no existing rows are broken. ON DELETE SET NULL means deleting a
-- ref_color clears this pointer but keeps the variant and its free-text color.
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS color_ref_id uuid REFERENCES ref_colors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS product_variants_color_ref_idx
  ON product_variants (color_ref_id)
  WHERE color_ref_id IS NOT NULL;

-- ── 4. Backfill color_ref_id for existing variants ───────────────────────────
-- Match on lower(trim()) so "Camel", "camel", " Camel " all resolve correctly.
UPDATE product_variants pv
SET    color_ref_id = rc.id
FROM   ref_colors rc
WHERE  rc.tenant_id = pv.tenant_id
  AND  lower(trim(pv.color)) = lower(trim(rc.name_en))
  AND  pv.color IS NOT NULL
  AND  pv.color_ref_id IS NULL;

COMMIT;
