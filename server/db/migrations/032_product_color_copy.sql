-- Per-colour marketing copy (owner request, 2026-08-23).
--
-- Hook and short-description text previously lived once per product. Colours
-- of the same product can warrant different copy (e.g. a black Oxford pitched
-- as boardroom-ready, the same shoe in tan pitched as weekend-casual), the
-- same way each colour already carries its own photo via product_color_images
-- (migration 010). This table mirrors that one exactly, minus the media/
-- sort_order columns that only make sense for images.
--
-- A missing row for a given colour is not an error — the storefront and admin
-- both fall back to the product-level Hook/Short description in that case.

BEGIN;

CREATE TABLE product_color_copy (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  product_id uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color      text        NOT NULL,   -- lower(trim(name_en)), same convention as product_color_images
  hook_en    text,
  hook_ar    text,
  teaser_en  text,
  teaser_ar  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_color_copy_unique UNIQUE (product_id, color)
);

CREATE INDEX product_color_copy_product_idx ON product_color_copy (product_id);
CREATE INDEX product_color_copy_tenant_idx  ON product_color_copy (tenant_id);

COMMIT;
