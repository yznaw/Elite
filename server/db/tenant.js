const bcrypt = require('bcryptjs');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'elite';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Elite';
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'QAR';
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@elite.local';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'elite-admin';
const DEFAULT_ADMIN_NAME = process.env.DEFAULT_ADMIN_NAME || 'Yusuf Hamad';

async function ensureDefaultTenant(client) {
  const result = await client.query(
    `
      INSERT INTO tenants (slug, name, currency)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name,
          currency = EXCLUDED.currency
      RETURNING id, slug, name, currency
    `,
    [DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME, DEFAULT_CURRENCY],
  );

  const tenant = result.rows[0];

  await client.query(
    `
      INSERT INTO store_settings (tenant_id, store_name, default_currency)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenant.id, tenant.name, tenant.currency],
  );

  await client.query(
    `
      INSERT INTO brand_profiles (tenant_id, tagline)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenant.id, 'Arabic Leather Artisans'],
  );

  await ensureDefaultAdminUser(client, tenant.id);

  // Ensure integration rows exist so config can be patched without INSERT logic elsewhere
  await client.query(
    `
      INSERT INTO integrations (tenant_id, integration_key, name, description, status)
      VALUES ($1, 'nbox', 'NBOX Logistics', 'NBOX last-mile delivery', 'disconnected')
      ON CONFLICT (tenant_id, integration_key) DO NOTHING
    `,
    [tenant.id],
  );

  await ensureAllProductsCollection(client, tenant.id);

  return tenant;
}

async function ensureAllProductsCollection(client, tenantId) {
  await client.query(
    `
      INSERT INTO collections (tenant_id, handle, title, description, status, sort_order, seo)
      VALUES ($1, 'all-products', 'All Products', 'Browse every product in the catalog.', 'active', 9999, '{}'::jsonb)
      ON CONFLICT (tenant_id, handle) DO UPDATE
      SET status = 'active'
    `,
    [tenantId],
  );
}

/** Ensure at least one admin user exists for the tenant so the login page is
    usable on a fresh install. Re-runs are no-ops thanks to `ON CONFLICT`. */
async function ensureDefaultAdminUser(client, tenantId) {
  const existing = await client.query(
    'SELECT id FROM admin_users WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  if (existing.rowCount > 0) return;

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  const initials = DEFAULT_ADMIN_NAME
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  await client.query(
    `
      INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status)
      VALUES ($1, $2, $3, $4, $5, 'owner', 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          status = 'active'
    `,
    [tenantId, DEFAULT_ADMIN_EMAIL, passwordHash, DEFAULT_ADMIN_NAME, initials || 'AD'],
  );
}

async function getTenant(client) {
  return ensureDefaultTenant(client);
}

module.exports = {
  DEFAULT_TENANT_SLUG,
  DEFAULT_TENANT_NAME,
  DEFAULT_CURRENCY,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_NAME,
  ensureDefaultTenant,
  ensureDefaultAdminUser,
  getTenant,
};
