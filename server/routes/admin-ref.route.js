// CRUD for reference lists: colors, materials, size sets.
// All endpoints are tenant-scoped via ensureDefaultTenant.
const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, created, notFound, validationError } = require('./lib');

const router = Router();

// ─── Colors ──────────────────────────────────────────────────────────────────

router.get('/colors', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name_en, name_ar, hex, sort_order
     FROM ref_colors WHERE tenant_id = $1
     ORDER BY sort_order, name_en`,
    [tenant.id],
  );
  ok(res, rows);
}));

router.post('/colors', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', hex = '#000000', sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Color name (EN) is required.']);
  const { rows } = await db.query(
    `INSERT INTO ref_colors (tenant_id, name_en, name_ar, hex, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name_en, name_ar, hex, sort_order`,
    [tenant.id, name_en.trim(), String(name_ar).trim(), hex, sort_order],
  );
  created(res, rows[0]);
}));

router.put('/colors/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', hex = '#000000', sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Color name (EN) is required.']);
  const { rows } = await db.query(
    `UPDATE ref_colors
     SET name_en=$3, name_ar=$4, hex=$5, sort_order=$6
     WHERE id=$1 AND tenant_id=$2
     RETURNING id, name_en, name_ar, hex, sort_order`,
    [req.params.id, tenant.id, name_en.trim(), String(name_ar).trim(), hex, sort_order],
  );
  if (!rows.length) return notFound(res);
  ok(res, rows[0]);
}));

router.delete('/colors/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rowCount } = await db.query(
    'DELETE FROM ref_colors WHERE id=$1 AND tenant_id=$2',
    [req.params.id, tenant.id],
  );
  if (!rowCount) return notFound(res);
  ok(res, { deleted: true });
}));

// ─── Materials ───────────────────────────────────────────────────────────────

router.get('/materials', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name_en, name_ar, sort_order
     FROM ref_materials WHERE tenant_id = $1
     ORDER BY sort_order, name_en`,
    [tenant.id],
  );
  ok(res, rows);
}));

router.post('/materials', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Material name (EN) is required.']);
  const { rows } = await db.query(
    `INSERT INTO ref_materials (tenant_id, name_en, name_ar, sort_order)
     VALUES ($1,$2,$3,$4)
     RETURNING id, name_en, name_ar, sort_order`,
    [tenant.id, name_en.trim(), String(name_ar).trim(), sort_order],
  );
  created(res, rows[0]);
}));

router.put('/materials/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Material name (EN) is required.']);
  const { rows } = await db.query(
    `UPDATE ref_materials
     SET name_en=$3, name_ar=$4, sort_order=$5
     WHERE id=$1 AND tenant_id=$2
     RETURNING id, name_en, name_ar, sort_order`,
    [req.params.id, tenant.id, name_en.trim(), String(name_ar).trim(), sort_order],
  );
  if (!rows.length) return notFound(res);
  ok(res, rows[0]);
}));

router.delete('/materials/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rowCount } = await db.query(
    'DELETE FROM ref_materials WHERE id=$1 AND tenant_id=$2',
    [req.params.id, tenant.id],
  );
  if (!rowCount) return notFound(res);
  ok(res, { deleted: true });
}));

// ─── Size Sets ───────────────────────────────────────────────────────────────

router.get('/size-sets', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT id, name, sizes, sort_order
     FROM ref_size_sets WHERE tenant_id = $1
     ORDER BY sort_order, name`,
    [tenant.id],
  );
  ok(res, rows);
}));

router.post('/size-sets', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name, sizes = [], sort_order = 0 } = req.body ?? {};
  if (!String(name ?? '').trim()) return validationError(res, ['Size set name is required.']);
  if (!Array.isArray(sizes)) return validationError(res, ['sizes must be an array.']);
  const { rows } = await db.query(
    `INSERT INTO ref_size_sets (tenant_id, name, sizes, sort_order)
     VALUES ($1,$2,$3,$4)
     RETURNING id, name, sizes, sort_order`,
    [tenant.id, name.trim(), JSON.stringify(sizes), sort_order],
  );
  created(res, rows[0]);
}));

router.put('/size-sets/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name, sizes, sort_order = 0 } = req.body ?? {};
  if (!String(name ?? '').trim()) return validationError(res, ['Size set name is required.']);
  if (!Array.isArray(sizes)) return validationError(res, ['sizes must be an array.']);
  const { rows } = await db.query(
    `UPDATE ref_size_sets
     SET name=$3, sizes=$4, sort_order=$5
     WHERE id=$1 AND tenant_id=$2
     RETURNING id, name, sizes, sort_order`,
    [req.params.id, tenant.id, name.trim(), JSON.stringify(sizes), sort_order],
  );
  if (!rows.length) return notFound(res);
  ok(res, rows[0]);
}));

router.delete('/size-sets/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rowCount } = await db.query(
    'DELETE FROM ref_size_sets WHERE id=$1 AND tenant_id=$2',
    [req.params.id, tenant.id],
  );
  if (!rowCount) return notFound(res);
  ok(res, { deleted: true });
}));

module.exports = router;
