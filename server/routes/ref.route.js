const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

router.get('/colors', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name_en, name_ar, hex, sort_order
     FROM ref_colors
     WHERE tenant_id = $1
     ORDER BY sort_order, name_en`,
    [tenant.id],
  );

  ok(res, rows);
}));

module.exports = router;
