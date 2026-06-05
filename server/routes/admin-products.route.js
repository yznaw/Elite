const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, toCents, validationError } = require('./lib');
const { upload } = require('../middleware/upload');
const { storage } = require('../lib/storage');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');
const { processRestockNotifications } = require('../lib/restock-notifications');

const router = Router();
const IMAGE_COLORS_SELECT = `
        COALESCE((
          SELECT jsonb_object_agg(url, color)
          FROM (
            SELECT DISTINCT ON (url)
              url,
              color
            FROM (
              SELECT
                COALESCE(m.preview_url, m.storage_url) AS url,
                trim(m.metadata->>'color') AS color,
                ml.sort_order
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
            ) gallery_colors
            WHERE url IS NOT NULL AND url <> '' AND color IS NOT NULL AND color <> ''
            ORDER BY url, sort_order
          ) unique_gallery_colors
        ), '{}'::jsonb) AS image_colors`;

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
  // cart_items.variant_id is ON DELETE RESTRICT — null it out before deleting variants
  // so existing cart items aren't lost (they keep the product, just lose the variant ref)
  await client.query(
    'UPDATE cart_items SET variant_id = NULL WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)',
    [productId],
  );
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

async function findOrCreateImageAsset(client, tenantId, url, index) {
  const existing = await client.query(
    `
      SELECT id
      FROM media_assets
      WHERE tenant_id = $1
        AND kind = 'image'
        AND (storage_url = $2 OR preview_url = $2)
      ORDER BY created_at
      LIMIT 1
    `,
    [tenantId, url],
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const filename = String(url).split('/').pop()?.split('?')[0] || `product-image-${index + 1}`;
  const inserted = await client.query(
    `
      INSERT INTO media_assets (tenant_id, filename, kind, mime_type, storage_url, preview_url, metadata)
      VALUES ($1, $2, 'image', $3, $4, $4, $5::jsonb)
      RETURNING id
    `,
    [
      tenantId,
      filename,
      filename.startsWith('data:') ? 'image/preview' : null,
      url,
      JSON.stringify({ source: 'admin-product-save' }),
    ],
  );
  return inserted.rows[0].id;
}

function normalizeImageColors(imageColors) {
  if (!imageColors || typeof imageColors !== 'object' || Array.isArray(imageColors)) return {};
  return Object.entries(imageColors).reduce((map, [url, color]) => {
    const key = String(url || '').trim();
    const value = String(color || '').trim();
    if (key && value) map[key] = value;
    return map;
  }, {});
}

async function replaceImages(client, tenantId, productId, images, imageColors = {}) {
  const urls = [...new Set((Array.isArray(images) ? images : []).map((url) => String(url || '').trim()).filter(Boolean))];
  const colorsByUrl = normalizeImageColors(imageColors);

  await client.query("DELETE FROM media_links WHERE tenant_id = $1 AND product_id = $2 AND role IN ('gallery', 'primary')", [tenantId, productId]);

  const mediaIds = [];
  for (const [index, url] of urls.entries()) {
    const mediaId = await findOrCreateImageAsset(client, tenantId, url, index);
    const color = colorsByUrl[url] || '';
    if (color) {
      await client.query(
        'UPDATE media_assets SET metadata = metadata || $3::jsonb WHERE tenant_id = $1 AND id = $2',
        [tenantId, mediaId, JSON.stringify({ color })],
      );
    } else {
      await client.query(
        "UPDATE media_assets SET metadata = metadata - 'color' WHERE tenant_id = $1 AND id = $2",
        [tenantId, mediaId],
      );
    }
    mediaIds.push(mediaId);
    await client.query(
      `
        INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
        VALUES ($1, $2, $3, 'gallery', $4)
      `,
      [tenantId, mediaId, productId, index],
    );
  }

  await client.query(
    'UPDATE products SET primary_media_id = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3',
    [mediaIds[0] || null, tenantId, productId],
  );
}

async function replaceRecommendations(client, tenantId, productId, relatedProductIds) {
  await ensureProductRecommendationsSchema(client);
  const ids = [...new Set((Array.isArray(relatedProductIds) ? relatedProductIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && id !== productId))];

  await client.query('DELETE FROM product_recommendations WHERE tenant_id = $1 AND product_id = $2', [tenantId, productId]);
  if (ids.length === 0) return [];

  const valid = await client.query(
    `
      SELECT id
      FROM products
      WHERE tenant_id = $1
        AND status <> 'archived'
        AND id = ANY($2::uuid[])
      ORDER BY array_position($2::uuid[], id)
    `,
    [tenantId, ids],
  );
  const validIds = valid.rows.map((row) => row.id);

  for (const [index, recommendedProductId] of validIds.entries()) {
    await client.query(
      `
        INSERT INTO product_recommendations (tenant_id, product_id, recommended_product_id, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id, recommended_product_id) DO UPDATE
        SET sort_order = EXCLUDED.sort_order
      `,
      [tenantId, productId, recommendedProductId, index],
    );
  }

  return validIds;
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
    imageColors: normalizeImageColors(row.image_colors),
    variants: row.variants || [],
    metaTitle: row.meta_title || '',
    metaDesc: row.meta_desc || '',
    slug: row.slug || '',
    relatedProductIds: row.related_product_ids || [],
  };
}

async function loadAdminProduct(client, tenantId, productId) {
  await ensureProductRecommendationsSchema(client);
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
        COALESCE((
          SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
          FROM media_links ml
          JOIN media_assets m ON m.id = ml.media_id
          WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
        ), ARRAY[]::text[]) AS images,
        ${IMAGE_COLORS_SELECT},
        COALESCE((
          SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
          FROM product_recommendations pr
          JOIN products rp ON rp.id = pr.recommended_product_id
          WHERE pr.tenant_id = p.tenant_id
            AND pr.product_id = p.id
            AND rp.status <> 'archived'
        ), ARRAY[]::uuid[]) AS related_product_ids
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
      WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
      GROUP BY p.id, primary_media.preview_url, primary_media.storage_url
    `,
    [tenantId, productId],
  );
  return result.rowCount === 0 ? null : mapAdminProduct(result.rows[0]);
}

async function upsertProduct(client, tenant, product) {
  const name = String(product.name).trim();
  const sku = String(product.sku).trim();
  const brand = String(product.brand).trim();
  const currency = product.currency || tenant.currency;
  const status = product.hidden ? 'hidden' : 'active';
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const imageColors = normalizeImageColors(product.imageColors);
  const hasRelatedProductIds = Object.prototype.hasOwnProperty.call(product, 'relatedProductIds');
  const description = {
    en: String(product.enDesc || '').trim(),
    ar: String(product.arDesc || '').trim(),
  };

  const metaTitle = String(product.metaTitle || '').trim() || null;
  const metaDesc = String(product.metaDesc || '').trim() || null;

  const params = [
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
    metaTitle,   // $13
    metaDesc,    // $14
  ];

  const upserted = product.id
    ? await client.query(
      `
        UPDATE products
        SET sku = $2,
            brand = $3,
            name = $4,
            slug = $5,
            status = $6,
            description = $7::jsonb,
            base_price_cents = $8,
            currency = $9,
            stock_quantity = $10,
            has_3d = $11,
            views_3d = $12,
            meta_title = $13,
            meta_desc = $14,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $15
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      [...params, product.id],
    )
    : await client.query(
      `
        INSERT INTO products (
          tenant_id, sku, brand, name, slug, status, description,
          base_price_cents, currency, stock_quantity, has_3d, views_3d,
          meta_title, meta_desc
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)
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
            views_3d = EXCLUDED.views_3d,
            meta_title = EXCLUDED.meta_title,
            meta_desc = EXCLUDED.meta_desc
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      params,
    );

  const saved = upserted.rows[0];
  await replaceVariants(client, tenant.id, saved.id, Array.isArray(product.variants) ? product.variants : []);
  await replaceImages(client, tenant.id, saved.id, images, imageColors);
  if (hasRelatedProductIds) {
    await replaceRecommendations(client, tenant.id, saved.id, product.relatedProductIds);
  }
  return { ...saved, tenantId: tenant.id, imageCount: images.length };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
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
          COALESCE((
            SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
            FROM media_links ml
            JOIN media_assets m ON m.id = ml.media_id
            WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
          ), ARRAY[]::text[]) AS images,
          ${IMAGE_COLORS_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status <> 'archived'
          ), ARRAY[]::uuid[]) AS related_product_ids
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
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
    await ensureProductRecommendationsSchema(client);
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
          COALESCE((
            SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
            FROM media_links ml
            JOIN media_assets m ON m.id = ml.media_id
            WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
          ), ARRAY[]::text[]) AS images,
          ${IMAGE_COLORS_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status <> 'archived'
          ), ARRAY[]::uuid[]) AS related_product_ids
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url
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
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    await processRestockNotifications(client, tenant.id, saved.id);
    created(res, product, 'Product saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /bulk-stock must be registered before PATCH /:id to avoid route collision
router.patch('/bulk-stock', asyncHandler(async (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return validationError(res, ['updates must be a non-empty array of { sku, stock } objects.']);
  }

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');

    let updated = 0;
    const notFound = [];

    for (const item of updates) {
      const sku = String(item.sku || '').trim();
      const stock = Math.max(0, Number.parseInt(item.stock, 10) || 0);
      if (!sku) continue;

      const result = await client.query(
        "UPDATE products SET stock_quantity = $1, updated_at = now() WHERE tenant_id = $2 AND sku = $3 AND status <> 'archived' RETURNING id",
        [stock, tenant.id, sku],
      );
      if (result.rowCount === 0) {
        notFound.push(sku);
      } else {
        updated += result.rowCount;
      }
    }

    await client.query('COMMIT');
    ok(res, { updated, notFound }, `${updated} product(s) updated.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
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
      metaTitle: req.body.metaTitle ?? existing.meta_title,
      metaDesc: req.body.metaDesc ?? existing.meta_desc,
      id: req.params.id,
      variants: req.body.variants,
      images: req.body.images,
      relatedProductIds: req.body.relatedProductIds,
      has3d: req.body.has3d ?? existing.has_3d,
      views3d: req.body.views3d ?? existing.views_3d,
    };

    const saved = await upsertProduct(client, tenant, payload);
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    await processRestockNotifications(client, tenant.id, saved.id);
    ok(res, product, 'Product updated.');
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

    // cart_items has ON DELETE RESTRICT — must be removed before products/variants
    await client.query(
      'DELETE FROM cart_items WHERE product_id = ANY($1::uuid[])',
      [ids],
    );
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

      // Promote the first uploaded file so the storefront API and admin list
      // show the catalog upload immediately instead of an older seed image.
      if (newMediaIds.length > 0) {
        await client.query('UPDATE products SET primary_media_id = $1 WHERE id = $2', [newMediaIds[0], productId]);
      }

      // Compose the returned `images[]` so the client can patch in place.
      const allImages = await client.query(
        `
          SELECT COALESCE(m.preview_url, m.storage_url) AS url
          FROM media_links ml
          JOIN media_assets m ON m.id = ml.media_id
          WHERE ml.product_id = $1 AND ml.role IN ('gallery', 'primary')
          ORDER BY
            CASE
              WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                OR m.metadata ? 'storagePath'
              THEN 0
              ELSE 1
            END,
            ml.sort_order
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

router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const source = await loadAdminProduct(client, tenant.id, req.params.id);
    if (!source) return notFound(res, 'Product not found.');

    // Build unique SKU: append -COPY, or -COPY-N if collision
    let newSku = source.sku + '-COPY';
    const existing = await client.query(
      "SELECT sku FROM products WHERE tenant_id = $1 AND sku LIKE $2 AND status <> 'archived'",
      [tenant.id, source.sku + '-COPY%'],
    );
    if (existing.rowCount > 0) {
      const nums = existing.rows.map(r => {
        const m = r.sku.match(/-COPY-?(\d+)$/);
        return m ? parseInt(m[1], 10) : 1;
      });
      newSku = source.sku + '-COPY-' + (Math.max(...nums) + 1);
    }

    await client.query('BEGIN');
    const saved = await upsertProduct(client, tenant, {
      ...source,
      id: undefined,
      sku: newSku,
      slug: newSku,
      hidden: true,
      stock: 0,
      variants: (source.variants || []).map(v => ({
        ...v,
        sku: v.sku.replace(source.sku, newSku),
      })),
    });
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    created(res, product, 'Product duplicated.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
