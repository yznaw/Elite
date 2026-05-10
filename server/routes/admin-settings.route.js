const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, validationError } = require('./lib');

const router = Router();

router.get('/store', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT t.slug, t.name, t.currency, t.timezone, bp.*, ss.*
        FROM tenants t
        LEFT JOIN brand_profiles bp ON bp.tenant_id = t.id
        LEFT JOIN store_settings ss ON ss.tenant_id = t.id
        WHERE t.id = $1
      `,
      [tenant.id],
    );
    ok(res, result.rows[0]);
  } finally {
    client.release();
  }
}));

router.patch('/store', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    await client.query(
      `
        UPDATE tenants
        SET name = COALESCE($2, name),
            currency = COALESCE($3, currency),
            timezone = COALESCE($4, timezone),
            config = config || COALESCE($5::jsonb, '{}'::jsonb)
        WHERE id = $1
      `,
      [tenant.id, req.body.name, req.body.currency, req.body.timezone, req.body.config ? JSON.stringify(req.body.config) : null],
    );
    await client.query(
      `
        UPDATE store_settings
        SET store_name = COALESCE($2, store_name),
            contact_email = COALESCE($3, contact_email),
            support_phone = COALESCE($4, support_phone),
            checkout_enabled = COALESCE($5, checkout_enabled)
        WHERE tenant_id = $1
      `,
      [tenant.id, req.body.storeName || req.body.name, req.body.contactEmail, req.body.supportPhone, req.body.checkoutEnabled],
    );
    await client.query('COMMIT');
    ok(res, { tenantId: tenant.id }, 'Store settings updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/team', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'SELECT id, full_name AS name, email, role, initials, created_at AS joined, status FROM admin_users WHERE tenant_id = $1 ORDER BY created_at',
      [tenant.id],
    );
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

router.post('/team', asyncHandler(async (req, res) => {
  if (!req.body.email || !req.body.name) return validationError(res, ['Team member name and email are required.']);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO admin_users (tenant_id, email, full_name, initials, role, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET full_name = EXCLUDED.full_name, initials = EXCLUDED.initials, role = EXCLUDED.role
        RETURNING id, full_name AS name, email, role, initials, created_at AS joined, status
      `,
      [tenant.id, req.body.email, req.body.name, req.body.initials || initials(req.body.name), normalizeRole(req.body.role)],
    );
    created(res, result.rows[0], 'Team member saved.');
  } finally {
    client.release();
  }
}));

router.patch('/team/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        UPDATE admin_users
        SET full_name = COALESCE($3, full_name),
            email = COALESCE($4, email),
            role = COALESCE($5, role),
            status = COALESCE($6, status)
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, full_name AS name, email, role, initials, created_at AS joined, status
      `,
      [tenant.id, req.params.id, req.body.name, req.body.email, req.body.role ? normalizeRole(req.body.role) : null, req.body.status],
    );
    if (result.rowCount === 0) return notFound(res, 'Team member not found.');
    ok(res, result.rows[0], 'Team member updated.');
  } finally {
    client.release();
  }
}));

router.get('/integrations', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('SELECT id, integration_key, name, description AS desc, status, meta, config FROM integrations WHERE tenant_id = $1 ORDER BY name', [tenant.id]);
    ok(res, result.rows.map((r) => ({ ...r, connected: r.status === 'connected' })));
  } finally {
    client.release();
  }
}));

router.post('/integrations', asyncHandler(async (req, res) => {
  if (!req.body.key && !req.body.integrationKey) return validationError(res, ['Integration key is required.']);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO integrations (tenant_id, integration_key, name, description, status, meta, config, connected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CASE WHEN $5 = 'connected' THEN now() ELSE NULL END)
        ON CONFLICT (tenant_id, integration_key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, meta = EXCLUDED.meta, config = EXCLUDED.config
        RETURNING *
      `,
      [tenant.id, req.body.key || req.body.integrationKey, req.body.name || '', req.body.desc || req.body.description || '', req.body.status || (req.body.connected ? 'connected' : 'disconnected'), req.body.meta || '', JSON.stringify(req.body.config || {})],
    );
    created(res, result.rows[0], 'Integration saved.');
  } finally {
    client.release();
  }
}));

function initials(name) {
  return String(name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

function normalizeRole(role) {
  return String(role || 'viewer').toLowerCase();
}

module.exports = router;
