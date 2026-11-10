BEGIN;

-- Storefront visibility and till visibility are independent business choices.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pos_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_pos_status_chk'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_pos_status_chk
      CHECK (pos_status IN ('active', 'hidden'));
  END IF;
END $$;

-- Durable import audit. source_rows is the parsed, immutable snapshot used by
-- Review -> Commit, so Commit never reparses a potentially changed browser file.
CREATE TABLE IF NOT EXISTS catalog_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'products' CHECK (kind IN ('products', 'stock')),
  filename text NOT NULL,
  file_sha256 text,
  image_mode text NOT NULL DEFAULT 'ignore' CHECK (image_mode IN ('ignore', 'append', 'replace')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'review_ready', 'completed', 'failed')),
  source_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS catalog_import_jobs_tenant_created_idx
  ON catalog_import_jobs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES catalog_import_jobs(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  original_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('created', 'updated', 'skipped', 'error')),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_import_items_job_idx
  ON catalog_import_items (job_id, created_at);

-- Cleanup for pre-release builds of this migration. Variant presence is
-- enforced by the admin API/import contract; a deferred trigger conflicted
-- with the route's idempotent ALTER TABLE guards.
DROP TRIGGER IF EXISTS products_require_variant ON products;
DROP TRIGGER IF EXISTS variants_keep_product_nonempty ON product_variants;
DROP FUNCTION IF EXISTS enforce_product_has_variant();

COMMIT;
