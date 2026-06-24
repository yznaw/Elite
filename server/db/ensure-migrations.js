/**
 * ensure-migrations.js
 *
 * Idempotent schema bootstrap for migrations that are NOT yet applied on all
 * environments. Each function uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so
 * it is safe to run on both fresh and already-migrated databases.
 *
 * Call ensureAllMigrations(client) once inside the server bootstrap() function
 * (see index.js) so every production deploy self-heals missing schema.
 */

let _done = false;

async function ensureAllMigrations(client) {
  if (_done) return;

  // ── Migration 002: password_reset_tokens ──────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id         UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      token_hash      TEXT NOT NULL,
      requested_ip    INET,
      requested_user_agent TEXT,
      expires_at      TIMESTAMPTZ NOT NULL,
      used_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
      ON password_reset_tokens (user_id, created_at DESC)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_uq
      ON password_reset_tokens (token_hash)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_active_idx
      ON password_reset_tokens (tenant_id, expires_at)
      WHERE used_at IS NULL
  `);

  // ── Migration 004: SEO columns on products ────────────────────────────────
  await client.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS meta_title TEXT,
      ADD COLUMN IF NOT EXISTS meta_desc  TEXT,
      ADD COLUMN IF NOT EXISTS slug       TEXT
  `);

  // ── Migration 005: team_invitations ──────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS team_invitations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'viewer',
      token_hash  TEXT NOT NULL,
      invited_by  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
      expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, email)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invitations_token_hash
      ON team_invitations(token_hash)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invitations_tenant
      ON team_invitations(tenant_id)
  `);

  // ── Migration 006: cost_price_cents on product_variants ───────────────────
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS cost_price_cents INTEGER
  `);

  // ── Migration 010: color-image pivot + swatch image + color FK ─────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_color_images (
      id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    uuid        NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
      product_id   uuid        NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
      color        text        NOT NULL,
      media_id     uuid        NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      sort_order   integer     NOT NULL DEFAULT 0,
      created_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT product_color_images_unique UNIQUE (product_id, color, sort_order)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_color_images_product_idx
      ON product_color_images (product_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_color_images_tenant_idx
      ON product_color_images (tenant_id)
  `);
  await client.query(`
    ALTER TABLE ref_colors
      ADD COLUMN IF NOT EXISTS swatch_image_url text
  `);
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS color_ref_id uuid REFERENCES ref_colors(id) ON DELETE SET NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_variants_color_ref_idx
      ON product_variants (color_ref_id)
      WHERE color_ref_id IS NOT NULL
  `);
  await client.query(`
    UPDATE product_variants pv
    SET    color_ref_id = rc.id
    FROM   ref_colors rc
    WHERE  rc.tenant_id = pv.tenant_id
      AND  lower(trim(pv.color)) = lower(trim(rc.name_en))
      AND  pv.color IS NOT NULL
      AND  pv.color_ref_id IS NULL
  `);

  // ── Migration 009: product_reviews table ─────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id   uuid        REFERENCES products(id) ON DELETE CASCADE,
      rating       smallint    CHECK (rating BETWEEN 1 AND 5),
      title        text,
      body         text,
      author_name  text,
      author_email text,
      author_phone text,
      source       text        DEFAULT 'storefront',
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_reviews_product
      ON product_reviews (tenant_id, product_id, created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_reviews_tenant
      ON product_reviews (tenant_id, created_at DESC)
  `);

  // ── Migration 010: source column (already included above for fresh installs) ─
  await client.query(`
    ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS source text DEFAULT 'storefront'
  `);

  // ── Migration 011: allow general (non-product) feedback ───────────────────
  await client.query(`ALTER TABLE product_reviews ALTER COLUMN product_id DROP NOT NULL`);
  await client.query(`ALTER TABLE product_reviews ALTER COLUMN body DROP NOT NULL`);

  // ── Migration 012: shipping_cost_cents + total_cost_cents on product_variants ─
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS shipping_cost_cents integer
  `);
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS total_cost_cents integer
        GENERATED ALWAYS AS (
          CASE
            WHEN cost_price_cents IS NULL AND shipping_cost_cents IS NULL THEN NULL
            ELSE COALESCE(cost_price_cents, 0) + COALESCE(shipping_cost_cents, 0)
          END
        ) STORED
  `);

  // ── Migration 013: orders & customers production hardening ───────────────
  await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customers_active
      ON customers (tenant_id, deleted_at)
      WHERE deleted_at IS NULL
  `);
  await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_number TEXT NULL`);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_tenant_public_number_key'
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_tenant_public_number_key
          UNIQUE (tenant_id, public_number);
      END IF;
    END $$
  `);
  await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
      ON orders (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);
  // DROP + CREATE (not CREATE OR REPLACE): the latter fails with
  // "cannot drop columns from view" when the existing view in production has a
  // different column set. Dropping first sidesteps that and is safe — the view
  // is derived, holds no data.
  await client.query(`DROP VIEW IF EXISTS v_customer_order_stats`);
  await client.query(`
    CREATE VIEW v_customer_order_stats AS
    SELECT
      customer_id,
      COUNT(*)::int                                            AS orders_count,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END), 0)::bigint
                                                               AS ltv_cents,
      MAX(placed_at)                                           AS last_order_at
    FROM orders
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
  `);

  // ── Migration 014: policies (legal pages) ────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS policies (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      handle      TEXT        NOT NULL,
      title       TEXT        NOT NULL,
      content     TEXT        NOT NULL DEFAULT '',
      policy_type TEXT        NOT NULL DEFAULT 'custom',
      status      TEXT        NOT NULL DEFAULT 'draft',
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT policies_tenant_handle_uq UNIQUE (tenant_id, handle),
      CONSTRAINT policies_status_chk CHECK (status IN ('active', 'draft')),
      CONSTRAINT policies_type_chk   CHECK (policy_type IN (
        'privacy_policy','terms_of_service','refund_policy',
        'shipping_policy','cookie_policy','contact_info','custom'
      ))
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS policies_tenant_status_idx
      ON policies (tenant_id, status)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS policies_tenant_sort_idx
      ON policies (tenant_id, sort_order, created_at)
  `);

  // ── Migration 014: add 'cancelled' to order_payment_status enum ─────────────
  // Required by the pending-order cleanup job.
  // ALTER TYPE ... ADD VALUE cannot run inside a DO/transaction block, so it is
  // issued directly. IF NOT EXISTS makes it idempotent (PostgreSQL 12+); on
  // older versions the duplicate-object error (42710) is caught and ignored.
  try {
    await client.query(`ALTER TYPE order_payment_status ADD VALUE IF NOT EXISTS 'cancelled'`);
  } catch (err) {
    if (err.code !== '42710') {
      console.warn('[migrations] Could not add cancelled to order_payment_status:', err.message);
    }
  }

  // ── Migration 015: size_chart column on ref_size_sets ──────────────────────
  // Store UK/EU/US conversion rows. Each row: { uk: string, eu: string, us: string }
  // sizes array is kept for backward compat (variants match by EU size value).
  // tip: optional text shown below the chart (e.g. "If between sizes, select larger").
  // Guarded: ref_size_sets is created in reference-schema.js (runs after this).
  // If it does not exist yet, reference-schema.js adds these columns itself —
  // so a failure here is non-fatal and must not abort the migration chain.
  try {
    await client.query(`
      ALTER TABLE ref_size_sets
        ADD COLUMN IF NOT EXISTS size_chart jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS tip        text
    `);
  } catch (err) {
    if (err.code !== '42P01') { // 42P01 = undefined_table (created later)
      console.warn('[migrations] size_chart migration skipped:', err.message);
    }
  }

  _done = true;
}

module.exports = { ensureAllMigrations };
