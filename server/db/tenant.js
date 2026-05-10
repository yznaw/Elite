const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'elite';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Elite';
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'QAR';

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

  return tenant;
}

async function getTenant(client) {
  return ensureDefaultTenant(client);
}

module.exports = {
  DEFAULT_TENANT_SLUG,
  DEFAULT_TENANT_NAME,
  DEFAULT_CURRENCY,
  ensureDefaultTenant,
  getTenant,
};
