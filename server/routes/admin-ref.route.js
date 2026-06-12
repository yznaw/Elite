// CRUD for reference lists: colors, materials, size sets.
// All endpoints are tenant-scoped via ensureDefaultTenant.
//
// Phase 2 additions:
//   - GET colors/materials include live variant_count
//   - GET/POST/PUT colors include swatch_image_url
//   - PUT colors/:id propagates name_en renames to product_variants.color
//   - DELETE colors/:id and materials/:id are guarded — 409 if in use, ?force=true to override
const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, created, notFound, validationError } = require('./lib');

const router = Router();

// ─── Colors ──────────────────────────────────────────────────────────────────

router.get('/colors', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT
       rc.id,
       rc.name_en,
       rc.name_ar,
       rc.hex,
       rc.swatch_image_url,
       rc.sort_order,
       COUNT(DISTINCT pv.id)::int AS variant_count
     FROM ref_colors rc
     LEFT JOIN product_variants pv
       ON pv.tenant_id = rc.tenant_id
      AND (pv.color_ref_id = rc.id
           OR lower(trim(pv.color)) = lower(trim(rc.name_en)))
     WHERE rc.tenant_id = $1
     GROUP BY rc.id
     ORDER BY rc.sort_order, rc.name_en`,
    [tenant.id],
  );
  ok(res, rows);
}));

router.post('/colors', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', hex = '#000000', swatch_image_url = null, sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Color name (EN) is required.']);
  const { rows } = await db.query(
    `INSERT INTO ref_colors (tenant_id, name_en, name_ar, hex, swatch_image_url, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name_en, name_ar, hex, swatch_image_url, sort_order, 0 AS variant_count`,
    [tenant.id, name_en.trim(), String(name_ar).trim(), hex, swatch_image_url || null, sort_order],
  );
  created(res, rows[0]);
}));

router.put('/colors/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { name_en, name_ar = '', hex = '#000000', swatch_image_url = null, sort_order = 0 } = req.body ?? {};
  if (!String(name_en ?? '').trim()) return validationError(res, ['Color name (EN) is required.']);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch current name to detect rename
    const prev = await client.query(
      'SELECT name_en FROM ref_colors WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenant.id],
    );
    if (!prev.rowCount) { await client.query('ROLLBACK'); return notFound(res); }
    const oldName = prev.rows[0].name_en;

    const { rows } = await client.query(
      `UPDATE ref_colors
       SET name_en=$3, name_ar=$4, hex=$5, swatch_image_url=$6, sort_order=$7
       WHERE id=$1 AND tenant_id=$2
       RETURNING id, name_en, name_ar, hex, swatch_image_url, sort_order`,
      [req.params.id, tenant.id, name_en.trim(), String(name_ar).trim(), hex, swatch_image_url || null, sort_order],
    );

    // Propagate rename to variant rows that are hard-linked via color_ref_id
    if (oldName !== name_en.trim()) {
      await client.query(
        `UPDATE product_variants
         SET color = $1
         WHERE tenant_id = $2 AND color_ref_id = $3`,
        [name_en.trim(), tenant.id, req.params.id],
      );
    }

    await client.query('COMMIT');
    ok(res, { ...rows[0], variant_count: 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Batch sort-order update — called after drag-to-reorder in admin UI
router.post('/colors/sort-orders', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await Promise.all(
    items.map(({ id, sort_order }) =>
      db.query(
        'UPDATE ref_colors SET sort_order=$3 WHERE id=$1 AND tenant_id=$2',
        [id, tenant.id, Number(sort_order) || 0],
      ),
    ),
  );
  ok(res, { updated: items.length });
}));

router.delete('/colors/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const force = req.query.force === 'true';

  // Count variants using this color via FK or text match
  const usage = await db.query(
    `SELECT COUNT(*)::int AS cnt
     FROM product_variants
     WHERE tenant_id = $1
       AND (color_ref_id = $2
            OR (color_ref_id IS NULL AND lower(trim(color)) = (
              SELECT lower(trim(name_en)) FROM ref_colors WHERE id = $2 AND tenant_id = $1
            )))`,
    [tenant.id, req.params.id],
  );
  const variantCount = usage.rows[0]?.cnt ?? 0;

  if (variantCount > 0 && !force) {
    return res.status(409).json({
      success: false,
      error: 'Color is used by variants. Pass ?force=true to delete anyway.',
      variantCount,
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (variantCount > 0) {
      // Clear the FK link but keep the variant and its free-text color value
      await client.query(
        'UPDATE product_variants SET color_ref_id = NULL WHERE tenant_id = $1 AND color_ref_id = $2',
        [tenant.id, req.params.id],
      );
    }
    const { rowCount } = await client.query(
      'DELETE FROM ref_colors WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenant.id],
    );
    await client.query('COMMIT');
    if (!rowCount) return notFound(res);
    ok(res, { deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ─── Materials ───────────────────────────────────────────────────────────────

router.get('/materials', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const { rows } = await db.query(
    `SELECT
       rm.id,
       rm.name_en,
       rm.name_ar,
       rm.sort_order,
       COUNT(DISTINCT pv.id)::int AS variant_count
     FROM ref_materials rm
     LEFT JOIN product_variants pv
       ON pv.tenant_id = rm.tenant_id
      AND lower(trim(pv.material)) = lower(trim(rm.name_en))
     WHERE rm.tenant_id = $1
     GROUP BY rm.id
     ORDER BY rm.sort_order, rm.name_en`,
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
     RETURNING id, name_en, name_ar, sort_order, 0 AS variant_count`,
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
  ok(res, { ...rows[0], variant_count: 0 });
}));

router.post('/materials/sort-orders', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await Promise.all(
    items.map(({ id, sort_order }) =>
      db.query(
        'UPDATE ref_materials SET sort_order=$3 WHERE id=$1 AND tenant_id=$2',
        [id, tenant.id, Number(sort_order) || 0],
      ),
    ),
  );
  ok(res, { updated: items.length });
}));

router.delete('/materials/:id', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const force = req.query.force === 'true';

  const usage = await db.query(
    `SELECT COUNT(*)::int AS cnt
     FROM product_variants pv
     JOIN ref_materials rm ON rm.id = $2 AND rm.tenant_id = $1
     WHERE pv.tenant_id = $1
       AND lower(trim(pv.material)) = lower(trim(rm.name_en))`,
    [tenant.id, req.params.id],
  );
  const variantCount = usage.rows[0]?.cnt ?? 0;

  if (variantCount > 0 && !force) {
    return res.status(409).json({
      success: false,
      error: 'Material is used by variants. Pass ?force=true to delete anyway.',
      variantCount,
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (variantCount > 0) {
      // Get name before deletion so we can clear variants
      const nameRow = await client.query(
        'SELECT name_en FROM ref_materials WHERE id=$1 AND tenant_id=$2',
        [req.params.id, tenant.id],
      );
      if (nameRow.rowCount) {
        await client.query(
          `UPDATE product_variants SET material = NULL
           WHERE tenant_id = $1 AND lower(trim(material)) = lower(trim($2))`,
          [tenant.id, nameRow.rows[0].name_en],
        );
      }
    }
    const { rowCount } = await client.query(
      'DELETE FROM ref_materials WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenant.id],
    );
    await client.query('COMMIT');
    if (!rowCount) return notFound(res);
    ok(res, { deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ─── Size Sets ───────────────────────────────────────────────────────────────

router.get('/size-sets', asyncHandler(async (_req, res) => {
  const tenant = await ensureDefaultTenant(db);
  // usage_hint: count distinct products that have at least one variant
  // whose size appears in this size set's sizes array (heuristic — no FK).
  const { rows } = await db.query(
    `SELECT
       ss.id, ss.name, ss.sizes, ss.sort_order,
       (
         SELECT COUNT(DISTINCT pv.product_id)::int
         FROM product_variants pv
         WHERE pv.tenant_id = ss.tenant_id
           AND pv.size IS NOT NULL
           AND pv.size = ANY(ARRAY(SELECT jsonb_array_elements_text(ss.sizes)))
       ) AS usage_hint
     FROM ref_size_sets ss
     WHERE ss.tenant_id = $1
     ORDER BY ss.sort_order, ss.name`,
    [tenant.id],
  );
  ok(res, rows);
}));

// Duplicate a size set — creates a copy with "Copy of X" name
router.post('/size-sets/:id/duplicate', asyncHandler(async (req, res) => {
  const tenant = await ensureDefaultTenant(db);
  const src = await db.query(
    'SELECT name, sizes, sort_order FROM ref_size_sets WHERE id=$1 AND tenant_id=$2',
    [req.params.id, tenant.id],
  );
  if (!src.rowCount) return notFound(res);
  const { name, sizes, sort_order } = src.rows[0];
  const { rows } = await db.query(
    `INSERT INTO ref_size_sets (tenant_id, name, sizes, sort_order)
     VALUES ($1,$2,$3,$4)
     RETURNING id, name, sizes, sort_order, 0 AS usage_hint`,
    [tenant.id, `Copy of ${name}`, sizes, sort_order + 1],
  );
  created(res, rows[0]);
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
