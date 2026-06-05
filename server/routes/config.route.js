const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

/**
 * GET /api/config
 * Public store configuration consumed by the customer-web.
 * Returns only safe, non-sensitive fields from tenant config.
 */
router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'SELECT config FROM tenants WHERE id = $1',
      [tenant.id],
    );
    const config = result.rows[0]?.config || {};
    ok(res, {
      defaultImage: config.defaultImage || null,
    });
  } finally {
    client.release();
  }
}));

module.exports = router;
