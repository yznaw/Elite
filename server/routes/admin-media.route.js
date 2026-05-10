const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, validationError } = require('./lib');

const router = Router();

function mapMedia(row) {
  return {
    id: row.id,
    name: row.filename,
    kind: row.kind === 'model_3d' ? 'glb' : row.kind,
    size: Number(row.size_bytes || 0),
    w: row.width || undefined,
    h: row.height || undefined,
    uploaded: row.uploaded_at,
    linkedTo: row.product_id || null,
    uploader: row.uploader || 'System',
    initials: row.initials || 'SY',
    preview: row.preview_url || row.storage_url,
  };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT m.*, ml.product_id, u.full_name AS uploader, u.initials
        FROM media_assets m
        LEFT JOIN media_links ml ON ml.media_id = m.id
        LEFT JOIN admin_users u ON u.id = m.uploaded_by_user_id
        WHERE m.tenant_id = $1
        ORDER BY m.uploaded_at DESC
      `,
      [tenant.id],
    );
    ok(res, result.rows.map(mapMedia));
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const filename = String(req.body.name || req.body.filename || '').trim();
  const url = String(req.body.url || req.body.storageUrl || req.body.preview || '').trim();
  if (!filename || !url) return validationError(res, ['Filename and URL are required.']);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const kind = req.body.kind === 'glb' ? 'model_3d' : req.body.kind || 'image';
    const result = await client.query(
      `
        INSERT INTO media_assets (tenant_id, filename, kind, mime_type, size_bytes, width, height, storage_url, preview_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [tenant.id, filename, kind, req.body.mimeType || null, req.body.size || 0, req.body.w || null, req.body.h || null, url, req.body.preview || url],
    );
    created(res, mapMedia(result.rows[0]), 'Media asset saved.');
  } finally {
    client.release();
  }
}));

router.patch('/:id/link', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    await client.query('DELETE FROM media_links WHERE media_id = $1', [req.params.id]);
    if (req.body.productId) {
      await client.query(
        'INSERT INTO media_links (tenant_id, media_id, product_id, role) VALUES ($1, $2, $3, $4)',
        [tenant.id, req.params.id, req.body.productId, req.body.role || 'gallery'],
      );
    }
    await client.query('COMMIT');
    ok(res, { id: req.params.id, productId: req.body.productId || null }, 'Media link updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('DELETE FROM media_assets WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenant.id, req.params.id]);
    if (result.rowCount === 0) return notFound(res, 'Media asset not found.');
    ok(res, { id: result.rows[0].id }, 'Media asset deleted.');
  } finally {
    client.release();
  }
}));

module.exports = router;
