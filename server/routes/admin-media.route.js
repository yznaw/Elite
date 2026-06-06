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
    imageVariants: row.metadata?.imageVariants || {},
  };
}

async function removeAssetFiles(metadata = {}) {
  const variantPaths = Object.values(metadata.imageVariants || {})
    .map((variant) => variant?.storagePath)
    .filter(Boolean);
  await storage.removeMany([metadata.storagePath, ...variantPaths]);
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
                tenant_id, filename, kind, mime_type, size_bytes, width, height,
                storage_url, preview_url, uploaded_by_user_id, metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
              RETURNING *
            `,
            [
              tenant.id,
              file.originalname,
              kind,
              stored.mimeType,
              file.size,
              stored.width,
              stored.height,
              stored.url,
              stored.previewUrl,
              userId,
              JSON.stringify({
                storagePath: stored.storagePath,
                originalName: file.originalname,
                imageVariants: stored.variants || {},
              }),
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
        const role = req.body.role || 'gallery';
        await client.query(
          `INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
           VALUES ($1, $2, $3, $4,
             COALESCE((SELECT MAX(sort_order) + 1 FROM media_links WHERE product_id = $3 AND role = $4), 0)
           )`,
          [tenant.id, req.params.id, req.body.productId, role],
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
        await client.query('DELETE FROM media_assets WHERE tenant_id = $1 AND id = $2', [tenant.id, row.id]);
        await removeAssetFiles(row.metadata).catch(() => undefined);
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

      const metadata = lookup.rows[0].metadata || {};
      await client.query('DELETE FROM media_assets WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
      // Best-effort: a missing file shouldn't fail the API call.
      await removeAssetFiles(metadata).catch(() => undefined);

      ok(res, { id: req.params.id }, 'Media asset deleted.');
    } finally {
      client.release();
    }
  }),
);

// ─── Google Drive import ──────────────────────────────────────────────────────
// ─── Google Drive import ──────────────────────────────────────────────────────
// POST /api/admin/media/gdrive  { url: "https://drive.google.com/..." }
// Supports publicly-shared files and (with GOOGLE_DRIVE_API_KEY) folders.
// Auto-links images to products when folder name or filename matches a SKU.

function parseGDriveUrl(raw) {
  const url = (raw || '').trim();
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { type: 'folder', id: folderMatch[1] };
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fileMatch) return { type: 'file', id: fileMatch[1] };
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return { type: 'file', id: url };
  return null;
}

/**
 * Try to find a product whose SKU matches either the folder name or the
 * filename (without extension). Match priority:
 *   1. Exact: folderName === SKU  (most reliable — named folder import)
 *   2. Exact: stem(filename) === SKU
 *   3. Contains: filename contains SKU (e.g. "EC-AMO-2026-front.jpg")
 *   4. Prefix: first two SKU segments found in filename
 *
 * Returns the product UUID on a match, or null.
 */
async function tryAutoLink(client, tenantId, mediaId, { filename = '', folderName = '', sortCounters = new Map() } = {}) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const candidates = [folderName.trim(), stem.trim()].filter(Boolean);

  if (candidates.length === 0) return null;

  // 1 + 2 — exact match against folder name or filename stem
  for (const name of candidates) {
    if (!name) continue;
    const exact = await client.query(
      `SELECT id FROM products
       WHERE tenant_id = $1 AND UPPER(sku) = UPPER($2) AND status <> 'archived'
       LIMIT 1`,
      [tenantId, name],
    );
    if (exact.rowCount > 0) {
      await linkMedia(client, tenantId, mediaId, exact.rows[0].id, sortCounters);
      return exact.rows[0].id;
    }
  }

  // 3 — filename contains the full SKU anywhere
  const nameUpper = filename.toUpperCase();
  const contains = await client.query(
    `SELECT id, sku FROM products
     WHERE tenant_id = $1 AND status <> 'archived' AND sku IS NOT NULL AND sku <> ''
       AND $2 LIKE '%' || UPPER(sku) || '%'
     ORDER BY length(sku) DESC
     LIMIT 1`,
    [tenantId, nameUpper],
  );
  if (contains.rowCount > 0) {
    await linkMedia(client, tenantId, mediaId, contains.rows[0].id, sortCounters);
    return contains.rows[0].id;
  }

  // 4 — first two hyphen-segments of filename match first two segments of a SKU
  //     e.g. filename "EC-AMO-2026-front" → prefix "EC-AMO" → matches SKU "EC-AMO-2026"
  const segments = stem.split(/[-_]/);
  if (segments.length >= 2) {
    const prefix = segments.slice(0, 2).join('-').toUpperCase();
    const prefixMatch = await client.query(
      `SELECT id FROM products
       WHERE tenant_id = $1 AND status <> 'archived' AND sku IS NOT NULL
         AND UPPER(sku) LIKE $2 || '%'
       ORDER BY length(sku) DESC
       LIMIT 1`,
      [tenantId, prefix],
    );
    if (prefixMatch.rowCount > 0) {
      await linkMedia(client, tenantId, mediaId, prefixMatch.rows[0].id, sortCounters);
      return prefixMatch.rows[0].id;
    }
  }

  return null;
}

/**
 * Insert a single media_link.
 * `sortCounters` is a Map(productId → nextSortOrder) shared across a
 * transaction loop so every insert in the loop gets a unique sort_order
 * (MAX() inside a transaction always reads the pre-transaction snapshot).
 */
async function linkMedia(client, tenantId, mediaId, productId, sortCounters = new Map()) {
  let sortOrder;
  if (sortCounters.has(productId)) {
    sortOrder = sortCounters.get(productId);
  } else {
    const r = await client.query(
      `SELECT COALESCE(MAX(sort_order) + 1, 0) AS n
       FROM media_links WHERE product_id = $1 AND role = 'gallery'`,
      [productId],
    );
    sortOrder = r.rows[0].n;
  }
  sortCounters.set(productId, sortOrder + 1);

  await client.query(
    `INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
     VALUES ($1, $2, $3, 'gallery', $4)
     ON CONFLICT DO NOTHING`,
    [tenantId, mediaId, productId, sortOrder],
  );
}

router.post(
  '/gdrive',
  asyncHandler(async (req, res) => {
    const rawUrl = String(req.body.url || '').trim();
    if (!rawUrl) return validationError(res, ['Google Drive URL is required.']);

    const parsed = parseGDriveUrl(rawUrl);
    if (!parsed) return validationError(res, ['Could not find a Google Drive file or folder ID in that URL.']);

    // Accept either name so existing GOOGLE_API_KEY setups work out of the box.
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY || '';

    if (parsed.type === 'folder' && !apiKey) {
      return validationError(res, [
        'Importing a folder requires a Google API key. ' +
        'Add GOOGLE_DRIVE_API_KEY or GOOGLE_API_KEY to your server .env file.',
      ]);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await ensureDefaultTenant(client);
      const userId = req.session?.user?.id || null;

      // ── 1. Resolve the list of files + folder name ──────────────────────
      let files = [];
      let folderName = '';

      if (parsed.type === 'folder') {
        // Fetch folder metadata (name) for SKU matching
        const folderMetaResp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${parsed.id}?fields=id,name&key=${apiKey}`,
        );
        if (folderMetaResp.ok) {
          folderName = (await folderMetaResp.json()).name || '';
        }

        const q = encodeURIComponent(`'${parsed.id}' in parents and mimeType contains 'image/' and trashed = false`);
        const listResp = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=100&key=${apiKey}`,
        );
        if (!listResp.ok) {
          const body = await listResp.json().catch(() => ({}));
          throw new Error(`Google Drive API error ${listResp.status}: ${body?.error?.message || listResp.statusText}`);
        }
        files = (await listResp.json()).files || [];
      } else {
        if (apiKey) {
          const metaResp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${parsed.id}?fields=id,name,mimeType,size&key=${apiKey}`,
          );
          if (metaResp.ok) {
            const meta = await metaResp.json();
            files = [{ id: meta.id, name: meta.name, mimeType: meta.mimeType }];
          }
        }
        if (files.length === 0) {
          files = [{ id: parsed.id, name: `gdrive-${parsed.id}.jpg`, mimeType: 'image/jpeg' }];
        }
      }

      if (files.length === 0) {
        await client.query('ROLLBACK');
        return ok(res, [], 'No images found.');
      }

      // ── 2. Download, save, and auto-link each file ──────────────────────
      const inserted = [];
      const sortCounters = new Map(); // tracks next sort_order per product within this transaction
      for (const file of files) {
        const downloadUrl = apiKey
          ? `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`
          : `https://drive.google.com/uc?export=download&id=${file.id}`;

        const fileResp = await fetch(downloadUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': 'EliteAdmin/1.0' },
        });
        if (!fileResp.ok) continue;

        const contentType = fileResp.headers.get('content-type') || file.mimeType || 'image/jpeg';
        if (!contentType.startsWith('image/')) continue;

        const buffer = Buffer.from(await fileResp.arrayBuffer());
        const filename = file.name || `gdrive-${file.id}.jpg`;
        const stored = await storage.save({ buffer, filename, mimeType: contentType });

        const result = await client.query(
          `INSERT INTO media_assets
             (tenant_id, filename, kind, mime_type, size_bytes, width, height, storage_url, preview_url, uploaded_by_user_id, metadata)
           VALUES ($1,$2,'image',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
          [
            tenant.id, filename, contentType, buffer.length,
            stored.width, stored.height,
            stored.url, stored.previewUrl, userId,
            JSON.stringify({
              storagePath: stored.storagePath,
              gdriveId: file.id,
              imageVariants: stored.variants || {},
            }),
          ],
        );

        // Auto-link: folder name takes priority, then filename patterns
        const linkedProductId = await tryAutoLink(client, tenant.id, result.rows[0].id, {
          filename,
          folderName,
          sortCounters,
        });

        inserted.push(mapMedia({ ...result.rows[0], product_id: linkedProductId }));
      }

      await client.query('COMMIT');
      const linked = inserted.filter(f => f.linkedTo).length;
      const msg = linked > 0
        ? `Imported ${inserted.length} image(s) — ${linked} auto-linked by SKU.`
        : `Imported ${inserted.length} image(s) from Google Drive.`;
      return created(res, inserted, msg);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
module.exports.MAX_SIZE_BYTES = MAX_SIZE_BYTES;
