const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, toCents, validationError } = require('./lib');
const { upload } = require('../middleware/upload');
const { storage } = require('../lib/storage');

const router = Router();

function validateProduct(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return ['Product payload is required.'];
  }
  if (!String(body.name || '').trim()) errors.push('Product name is required.');
  if (!String(body.sku || '').trim()) errors.push('SKU is required.');
  if (!String(body.brand || '').trim()) errors.push('Brand is required.');
  if (Number(body.price) < 0) errors.push('Price cannot be negative.');
  if (Number(body.stock) < 0) errors.push('Stock cannot be negative.');

  return errors;
}

async function replaceVariants(client, tenantId, productId, variants) {
  await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);

  for (const [index, variant] of variants.entries()) {
    const sku = String(variant.sku || '').trim();
    if (!sku) continue;

    await client.query(
      `
        INSERT INTO product_variants (
          tenant_id, product_id, sku, size, color, material,
          price_cents, stock_quantity, sort_order, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      `,
      [
        tenantId,
        productId,
        sku,
        String(variant.size || '').trim() || null,
        String(variant.color || '').trim() || null,
        String(variant.material || '').trim() || null,
        toCents(variant.price),
        Math.max(0, Number.parseInt(variant.stock, 10) || 0),
        index,
      ],
    );
  }
}

function mapAdminProduct(row) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    brand: row.brand,
    price: Math.round(Number(row.base_price_cents || 0) / 100),
    stock: Number(row.stock_quantity || 0),
    has3d: row.has_3d,
    views3d: Number(row.views_3d || 0),
    hidden: row.status === 'hidden',
    image: row.image || '',
    images: row.images || [],
    variants: row.variants || [],
  };
}

async function upsertProduct(client, tenant, product) {
  const name = String(product.name).trim();
  const sku = String(product.sku).trim();
  const brand = String(product.brand).trim();
  const currency = product.currency || tenant.currency;
  const status = product.hidden ? 'hidden' : 'active';
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const description = {
    en: String(product.enDesc || '').trim(),
    ar: String(product.arDesc || '').trim(),
  };

  const upserted = await client.query(
    `
      INSERT INTO products (
        tenant_id, sku, brand, name, slug, status, description,
        base_price_cents, currency, stock_quantity, has_3d, views_3d
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
      ON CONFLICT (tenant_id, sku) DO UPDATE
      SET brand = EXCLUDED.brand,
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          status = EXCLUDED.status,
          description = EXCLUDED.description,
          base_price_cents = EXCLUDED.base_price_cents,
          currency = EXCLUDED.currency,
          stock_quantity = EXCLUDED.stock_quantity,
          has_3d = EXCLUDED.has_3d,
          views_3d = EXCLUDED.views_3d
      RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity
    `,
    [
      tenant.id,
      sku,
      brand,
      name,
      slugify(product.slug || name),
      status,
      JSON.stringify(description),
      toCents(product.price),
      currency,
      Math.max(0, Number.parseInt(product.stock, 10) || 0),
      Boolean(product.has3d),
      Math.max(0, Number.parseInt(product.views3d, 10) || 0),
    ],
  );

  const saved = upserted.rows[0];
  await replaceVariants(client, tenant.id, saved.id, Array.isArray(product.variants) ? product.variants : []);
  return { ...saved, tenantId: tenant.id, imageCount: images.length };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT
          p.*,
          COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', pv.id,
                'sku', pv.sku,
                'size', pv.size,
                'color', pv.color,
                'material', pv.material,
                'price', round(pv.price_cents / 100.0),
                'stock', pv.stock_quantity
              )
            ) FILTER (WHERE pv.id IS NOT NULL),
            '[]'::jsonb
          ) AS variants,
          COALESCE(
            array_agg(DISTINCT COALESCE(media.preview_url, media.storage_url))
              FILTER (WHERE media.id IS NOT NULL),
            ARRAY[]::text[]
          ) AS images
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        LEFT JOIN media_links ml ON ml.product_id = p.id
        LEFT JOIN media_assets media ON media.id = ml.media_id
        WHERE p.tenant_id = $1 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url
        ORDER BY p.created_at DESC
      `,
      [tenant.id],
    );

    ok(res, result.rows.map(mapAdminProduct));
  } finally {
    client.release();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT p.*, COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image
        FROM products p
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
      `,
      [tenant.id, req.params.id],
    );

    if (result.rowCount === 0) return notFound(res, 'Product not found.');
    ok(res, mapAdminProduct(result.rows[0]));
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const errors = validateProduct(req.body);
  if (errors.length > 0) return validationError(res, errors);

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const saved = await upsertProduct(client, tenant, req.body);
    await client.query('COMMIT');
    created(res, saved, 'Product saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const current = await client.query('SELECT * FROM products WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Product not found.');
    }

    const existing = current.rows[0];
    const payload = {
      name: req.body.name ?? existing.name,
      sku: req.body.sku ?? existing.sku,
      brand: req.body.brand ?? existing.brand,
      price: req.body.price ?? Math.round(Number(existing.base_price_cents) / 100),
      stock: req.body.stock ?? existing.stock_quantity,
      hidden: req.body.hidden ?? existing.status === 'hidden',
      enDesc: req.body.enDesc ?? existing.description?.en,
      arDesc: req.body.arDesc ?? existing.description?.ar,
      slug: req.body.slug ?? existing.slug,
      variants: req.body.variants,
      has3d: req.body.has3d ?? existing.has_3d,
      views3d: req.body.views3d ?? existing.views_3d,
    };

    const saved = await upsertProduct(client, tenant, payload);
    await client.query('COMMIT');
    ok(res, saved, 'Product updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/admin/products/bulk-delete — permanently removes products by ID array
router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return validationError(res, ['ids must be a non-empty array of product IDs.']);
  }

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');

    // Remove media links, variants, then products — scoped to tenant
    await client.query(
      'DELETE FROM media_links WHERE product_id = ANY($1::uuid[])',
      [ids],
    );
    await client.query(
      'DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])',
      [ids],
    );
    const result = await client.query(
      'DELETE FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[]) RETURNING id',
      [tenant.id, ids],
    );

    await client.query('COMMIT');
    ok(res, { deleted: result.rowCount }, `${result.rowCount} product(s) deleted.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        UPDATE products
        SET status = 'archived'
        WHERE tenant_id = $1 AND id = $2
        RETURNING id
      `,
      [tenant.id, req.params.id],
    );

    if (result.rowCount === 0) return notFound(res, 'Product not found.');
    ok(res, { id: result.rows[0].id }, 'Product archived.');
  } finally {
    client.release();
  }
}));

/**
 * POST /api/admin/products/:id/images
 *
 * Multipart upload of one or more images for a product. Each file is stored
 * via the storage adapter, then `media_assets` + `media_links` rows are
 * written so the gallery shows up in /api/admin/products list responses.
 *
 * On the first image upload (or when ?primary=true), the product's
 * `primary_media_id` is updated so list views and storefront use the new
 * image as the thumbnail.
 *
 * Returns the resulting `images: string[]` array (URLs in display order)
 * so the frontend can patch its local form state with one assignment.
 */
router.post(
  '/:id/images',
  upload.array('files', 12),
  asyncHandler(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) return validationError(res, ['No files received.']);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await ensureDefaultTenant(client);
      const userId = req.session?.user?.id || null;
      const productId = req.params.id;

      const exists = await client.query('SELECT id FROM products WHERE tenant_id = $1 AND id = $2', [tenant.id, productId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return notFound(res, 'Product not found.');
      }

      const startOrderRes = await client.query(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM media_links WHERE product_id = $1 AND role = 'gallery'",
        [productId],
      );
      let sortOrder = Number(startOrderRes.rows[0].next || 0);

      const newMediaIds = [];
      for (const file of files) {
        const stored = await storage.save({
          buffer: file.buffer,
          filename: file.originalname,
          mimeType: file.mimetype,
        });
        const inserted = await client.query(
          `
            INSERT INTO media_assets (
              tenant_id, filename, kind, mime_type, size_bytes,
              storage_url, preview_url, uploaded_by_user_id, metadata
            )
            VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING id
          `,
          [
            tenant.id, file.originalname, stored.mimeType, file.size,
            stored.url, stored.url, userId,
            JSON.stringify({ storagePath: stored.storagePath, originalName: file.originalname }),
          ],
        );
        const mediaId = inserted.rows[0].id;
        await client.query(
          `
            INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
            VALUES ($1, $2, $3, 'gallery', $4)
          `,
          [tenant.id, mediaId, productId, sortOrder],
        );
        newMediaIds.push(mediaId);
        sortOrder += 1;
      }

      // If the product had no primary image yet, promote the first uploaded
      // file to primary so list/heatmap thumbs work immediately.
      const primaryCheck = await client.query('SELECT primary_media_id FROM products WHERE id = $1', [productId]);
      if (!primaryCheck.rows[0].primary_media_id && newMediaIds.length > 0) {
        await client.query('UPDATE products SET primary_media_id = $1 WHERE id = $2', [newMediaIds[0], productId]);
      }

      // Compose the returned `images[]` so the client can patch in place.
      const allImages = await client.query(
        `
          SELECT COALESCE(m.preview_url, m.storage_url) AS url
          FROM media_links ml
          JOIN media_assets m ON m.id = ml.media_id
          WHERE ml.product_id = $1 AND ml.role IN ('gallery', 'primary')
          ORDER BY ml.sort_order
        `,
        [productId],
      );

      await client.query('COMMIT');
      created(res, {
        productId,
        uploaded: newMediaIds.length,
        images: allImages.rows.map((r) => r.url),
      }, `Uploaded ${newMediaIds.length} image${newMediaIds.length === 1 ? '' : 's'}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
