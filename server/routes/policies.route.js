const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, notFound } = require('./lib');

const router = Router();

// GET /api/policies — active policies list (no content — for nav/footer)
router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `SELECT id, handle, title, policy_type, updated_at
         FROM policies
        WHERE tenant_id = $1 AND status = 'active'
        ORDER BY sort_order, created_at`,
      [tenant.id],
    );
    ok(res, result.rows.map((r) => ({
      id:         r.id,
      handle:     r.handle,
      title:      r.title,
      policyType: r.policy_type,
      updatedAt:  r.updated_at,
    })));
  } finally {
    client.release();
  }
}));

// GET /api/policies/:handle — full content, active only
router.get('/:handle', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `SELECT id, handle, title, content, policy_type, updated_at
         FROM policies
        WHERE tenant_id = $1 AND handle = $2 AND status = 'active'`,
      [tenant.id, req.params.handle],
    );
    if (result.rowCount === 0) return notFound(res, 'Policy not found.');
    const r = result.rows[0];
    ok(res, {
      id:         r.id,
      handle:     r.handle,
      title:      r.title,
      content:    r.content || '',
      policyType: r.policy_type,
      updatedAt:  r.updated_at,
    });
  } finally {
    client.release();
  }
}));

module.exports = router;
