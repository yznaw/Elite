-- Migration 009: Product reviews / feedback table
-- Reviews are private (admin-only), any visitor can submit, contact details optional.
CREATE TABLE IF NOT EXISTS product_reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating       smallint    CHECK (rating BETWEEN 1 AND 5),
  title        text,
  body         text        NOT NULL,
  author_name  text,
  author_email text,
  author_phone text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_reviews_product
  ON product_reviews (tenant_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS product_reviews_tenant
  ON product_reviews (tenant_id, created_at DESC);
