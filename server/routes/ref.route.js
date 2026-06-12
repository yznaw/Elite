const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

router.get('/colors', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name_en, name_ar, hex, swatch_image_url, sort_order
     FROM ref_colors
     WHERE tenant_id = $1
     ORDER BY sort_order, name_en`,
    [tenant.id],
  );

  ok(res, rows);
}));

router.get('/size-sets', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name, sizes, sort_order
     FROM ref_size_sets
     WHERE tenant_id = $1
     ORDER BY sort_order, name`,
    [tenant.id],
  );

  ok(res, rows);
}));

module.exports = router;
