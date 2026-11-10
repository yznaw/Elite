const { Router } = require('express');
const db = require('../db/client');
const { asyncHandler, ok } = require('./lib');
const { requireAuth } = require('../middleware/require-auth');
const router = Router();
router.use(requireAuth({ roles: ['owner', 'admin', 'manager'] }));
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const result = await db.query(
    `SELECT id, name, email, phone, subject, message, status, locale, created_at
       FROM contact_submissions WHERE tenant_id = $1
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
    [req.user.tenantId, limit, offset],
  );
  res.set('Cache-Control', 'no-store');
  ok(res, result.rows);
}));
module.exports = router;
