const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, validationError } = require('./lib');
const { upload, MAX_SIZE_BYTES } = require('../middleware/upload');
const { storage } = require('../lib/storage');

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
    storageUrl: row.storage_url,
    storagePath: row.metadata?.storagePath || null,
  };
}

function kindFromMime(mime, originalname) {
  if ((originalname || '').toLowerCase().endsWith('.glb')) return 'model_3d';
  if (mime && mime.startsWith('image/')) return 'image';
  if (mime === 'model/gltf-binary') return 'model_3d';
  return 'document';
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
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
  }),
);

/**
 * POST /api/admin/media
 *
 * Accepts EITHER:
 *   - multipart/form-data with one or more `files[]` (preferred — real upload)
 *   - application/json with `{ name, url, kind, size, w, h }` (legacy URL-only path)
 *
 * Returns the created media asset(s). Multi-file uploads return an array.
 */
router.post(
  '/',
  upload.array('files', 24),
  asyncHandler(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];

    // ── Multipart path ──────────────────────────────────────────────────
    if (files.length > 0) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const tenant = await ensureDefaultTenant(client);
        const userId = req.session?.user?.id || null;
        const productId = String(req.body.productId || '').trim() || null;
        const role = String(req.body.role || (productId ? 'gallery' : 'gallery')).trim();

        const inserted = [];
        for (const file of files) {
          const stored = await storage.save({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
          });
          const kind = kindFromMime(stored.mimeType, file.originalname);
          const result = await client.query(
            `
              INSERT INTO media_assets (
                tenant_id, filename, kind, mime_type, size_bytes,
                storage_url, preview_url, uploaded_by_user_id, metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
              RETURNING *
            `,
            [
              tenant.id,
              file.originalname,
              kind,
              stored.mimeType,
              file.size,
              stored.url,
              stored.url,
              userId,
              JSON.stringify({ storagePath: stored.storagePath, originalName: file.originalname }),
            ],
          );
          const mediaId = result.rows[0].id;

          // If the upload was scoped to a product, link it immediately. Sort
          // order = current max + 1 so the new image lands at the end.
          if (productId) {
            await client.query(
              `
                INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
                VALUES (
                  $1, $2, $3, $4,
                  COALESCE((SELECT MAX(sort_order) + 1 FROM media_links WHERE product_id = $3 AND role = $4), 0)
                )
              `,
              [tenant.id, mediaId, productId, role],
            );
          }

          inserted.push(mapMedia({ ...result.rows[0], product_id: productId }));
        }

        await client.query('COMMIT');
        return created(res, inserted, `Uploaded ${inserted.length} file${inserted.length === 1 ? '' : 's'}.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // ── Legacy JSON path ────────────────────────────────────────────────
    const filename = String(req.body.name || req.body.filename || '').trim();
    const url = String(req.body.url || req.body.storageUrl || req.body.preview || '').trim();
    if (!filename || !url) {
      return validationError(res, ['Either upload files (multipart) or provide name + url (JSON).']);
    }

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
  }),
);

router.patch(
  '/:id/link',
  asyncHandler(async (req, res) => {
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
  }),
);

router.delete(
  '/orphaned',
  asyncHandler(async (_req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await ensureDefaultTenant(client);

      // Find all unlinked assets (no entry in media_links for this tenant)
      const lookup = await client.query(
        `
          SELECT m.id, m.metadata
          FROM media_assets m
          LEFT JOIN media_links ml ON ml.media_id = m.id
          WHERE m.tenant_id = $1 AND ml.media_id IS NULL
        `,
        [tenant.id],
      );

      const ids = lookup.rows.map((r) => r.id);
      let deleted = 0;

      for (const row of lookup.rows) {
        const storagePath = row.metadata?.storagePath;
        await client.query('DELETE FROM media_assets WHERE tenant_id = $1 AND id = $2', [tenant.id, row.id]);
        if (storagePath) {
          await storage.remove(storagePath).catch(() => undefined);
        }
        deleted++;
      }

      await client.query('COMMIT');
      ok(res, { deleted, ids }, `${deleted} orphaned media asset${deleted === 1 ? '' : 's'} deleted.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await db.pool.connect();
    try {
      const tenant = await ensureDefaultTenant(client);
      const lookup = await client.query(
        'SELECT id, metadata FROM media_assets WHERE tenant_id = $1 AND id = $2',
        [tenant.id, req.params.id],
      );
      if (lookup.rowCount === 0) return notFound(res, 'Media asset not found.');

      const storagePath = lookup.rows[0].metadata?.storagePath;
      await client.query('DELETE FROM media_assets WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
      if (storagePath) {
        // Best-effort: a missing file shouldn't fail the API call.
        await storage.remove(storagePath).catch(() => undefined);
      }

      ok(res, { id: req.params.id }, 'Media asset deleted.');
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
module.exports.MAX_SIZE_BYTES = MAX_SIZE_BYTES;
