const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, created, notFound, validationError } = require('./lib');

const router = Router();

const TYPE_DEFAULT_HANDLES = {
  privacy_policy:   'privacy-policy',
  terms_of_service: 'terms-of-service',
  refund_policy:    'refund-policy',
  shipping_policy:  'shipping-policy',
  cookie_policy:    'cookie-policy',
  contact_info:     'contact-information',
  custom:           null,
};

const VALID_TYPES = new Set(Object.keys(TYPE_DEFAULT_HANDLES));
const VALID_STATUSES = new Set(['active', 'draft']);

function slugify(str) {
  return String(str || '')
    .toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapPolicy(row) {
  return {
    id:         row.id,
    handle:     row.handle,
    title:      row.title,
    content:    row.content || '',
    policyType: row.policy_type,
    status:     row.status,
    sortOrder:  row.sort_order ?? 0,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

// GET /api/admin/policies
router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `SELECT * FROM policies WHERE tenant_id = $1 ORDER BY sort_order, created_at DESC`,
      [tenant.id],
    );
    ok(res, result.rows.map(mapPolicy));
  } finally {
    client.release();
  }
}));

// POST /api/admin/policies
router.post('/', asyncHandler(async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return validationError(res, ['Policy title is required.']);

  const policyType = VALID_TYPES.has(req.body.policyType) ? req.body.policyType : 'custom';
  const handle = slugify(req.body.handle || TYPE_DEFAULT_HANDLES[policyType] || title);
  if (!handle) return validationError(res, ['Could not generate a valid URL handle.']);

  const status = VALID_STATUSES.has(req.body.status) ? req.body.status : 'draft';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const count = await client.query(
      'SELECT COUNT(*) FROM policies WHERE tenant_id = $1',
      [tenant.id],
    );
    const sortOrder = Number(count.rows[0].count);

    const result = await client.query(
      `INSERT INTO policies (tenant_id, handle, title, content, policy_type, status, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenant.id, handle, title, req.body.content || '', policyType, status, sortOrder],
    );
    await client.query('COMMIT');
    created(res, mapPolicy(result.rows[0]), 'Policy saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return validationError(res, ['A policy with this URL handle already exists. Change the handle and try again.']);
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/admin/policies/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const current = await client.query(
      'SELECT * FROM policies WHERE tenant_id = $1 AND id = $2',
      [tenant.id, req.params.id],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Policy not found.');
    }

    const row = current.rows[0];
    const title      = String(req.body.title ?? row.title).trim() || row.title;
    const handle     = slugify(req.body.handle ?? row.handle) || row.handle;
    const policyType = VALID_TYPES.has(req.body.policyType)   ? req.body.policyType : row.policy_type;
    const status     = VALID_STATUSES.has(req.body.status)    ? req.body.status     : row.status;
    const content    = req.body.content   ?? row.content;
    const sortOrder  = req.body.sortOrder ?? row.sort_order;

    const result = await client.query(
      `UPDATE policies
          SET title = $3, handle = $4, content = $5, policy_type = $6,
              status = $7, sort_order = $8, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenant.id, req.params.id, title, handle, content, policyType, status, sortOrder],
    );
    await client.query('COMMIT');
    ok(res, mapPolicy(result.rows[0]), 'Policy updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return validationError(res, ['A policy with this URL handle already exists.']);
    throw err;
  } finally {
    client.release();
  }
}));

// DELETE /api/admin/policies/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'DELETE FROM policies WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Policy not found.');
    ok(res, { id: result.rows[0].id }, 'Policy deleted.');
  } finally {
    client.release();
  }
}));

module.exports = router;
