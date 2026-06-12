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

  _done = true;
}

module.exports = { ensureAllMigrations };
