const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, toCents, validationError } = require('./lib');
const { upload } = require('../middleware/upload');
const { storage } = require('../lib/storage');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');
const { processRestockNotifications } = require('../lib/restock-notifications');
// Every stock_quantity write in this file posts a matching ledger row in the
// same transaction — see server/lib/inventory-ledger.js for why that invariant
// exists and what breaks when a write skips it (docs/25 Phase 1b).
const { recordMovement } = require('../lib/inventory-ledger');

const router = Router();

// Ensure SEO columns exist (migration 004 may not have run on all environments)
let seoColumnsReady = false;
async function ensureSeoColumns(client) {
  if (seoColumnsReady) return;
  await client.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS meta_title text,
      ADD COLUMN IF NOT EXISTS meta_desc  text
  `);
  seoColumnsReady = true;
}

// Ensure cost_price_cents exists (migration 006 may not have run on all environments)
let costPriceColumnReady = false;
async function ensureCostPriceColumn(client) {
  if (costPriceColumnReady) return;
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS cost_price_cents integer
  `);
  costPriceColumnReady = true;
}

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

async function replaceVariants(client, tenantId, productId, variants, { trustZeroStock = true, actorUserId = null } = {}) {
  // Resolve each variant's SKU up front. A variant saved without one (e.g. a
  // manually-added row the admin never typed a SKU for) falls back to a
  // generated-but-unique SKU instead of being silently dropped further down —
  // product_variants.sku is NOT NULL + UNIQUE(tenant_id, sku), so every row
  // needs one, and this list must match what's actually inserted below or the
  // "removed" cleanup query would delete rows we're about to re-insert.
  const resolved = variants.map((variant, index) => {
    const sku = String(variant.sku || '').trim() || `${productId}-V${index}`;
    // Barcode defaults to the variant's own SKU (printed as a Code128 label
    // and scanned back at POS) unless a real supplier-issued barcode was
    // entered — see docs/12-pos-system.md for the POS barcode lookup flow.
    const barcode = String(variant.barcode || '').trim() || sku;
    return { variant, sku, barcode };
  });
  const incomingSkus = resolved.map((r) => r.sku);

  // product_variants has a UNIQUE(tenant_id, barcode) partial index — check
  // for collisions up front so a duplicate manually-typed barcode surfaces as
  // a clear 400 instead of a raw Postgres constraint error.
  const seenBarcodes = new Map();
  for (const { barcode } of resolved) seenBarcodes.set(barcode, (seenBarcodes.get(barcode) || 0) + 1);
  const dupeInBatch = [...seenBarcodes.entries()].find(([, count]) => count > 1)?.[0];
  if (dupeInBatch) {
    const err = new Error(`Barcode "${dupeInBatch}" is used by more than one variant on this product. Barcodes must be unique.`);
    err.status = 400;
    throw err;
  }
  if (resolved.length > 0) {
    const clash = await client.query(
      `SELECT barcode FROM product_variants
       WHERE tenant_id = $1 AND product_id <> $2 AND barcode = ANY($3::text[])
       LIMIT 1`,
      [tenantId, productId, resolved.map((r) => r.barcode)],
    );
    if (clash.rowCount > 0) {
      const err = new Error(`Barcode "${clash.rows[0].barcode}" is already used by another product. Barcodes must be unique.`);
      err.status = 400;
      throw err;
    }
  }

  // Stock held by this product's variants before the save. Every change made
  // below is posted to inventory_movements as a signed delta against these
  // values (docs/25 Phase 1b) — including stock that disappears because a
  // variant was deleted, which would otherwise vanish with no trace and show
  // up later as unexplained drift.
  const previousStockBySku = new Map();
  const existingVariants = await client.query(
    'SELECT id, sku, stock_quantity FROM product_variants WHERE tenant_id = $1 AND product_id = $2',
    [tenantId, productId],
  );
  for (const row of existingVariants.rows) {
    previousStockBySku.set(row.sku, { id: row.id, stock: Number(row.stock_quantity) || 0 });
  }
  const removedVariants = existingVariants.rows.filter((row) => !incomingSkus.includes(row.sku));

  // Recorded BEFORE the delete, while the rows still exist — inventory_movements
  // has ON DELETE SET NULL on variant_id, so a movement written afterwards
  // would lose the link to what it described.
  for (const removed of removedVariants) {
    const stock = Number(removed.stock_quantity) || 0;
    if (stock === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await recordMovement(client, { tenantId, userId: actorUserId }, {
      productId,
      variantId: removed.id,
      delta: -stock,
      reason: 'catalog_edit',
      referenceType: 'product',
      referenceId: productId,
      metadata: { sku: removed.sku, action: 'variant_removed', previousStock: stock },
    });
  }

  // Null-out cart references for variants being removed (ON DELETE RESTRICT)
  if (incomingSkus.length > 0) {
    await client.query(
      `UPDATE cart_items SET variant_id = NULL
       WHERE variant_id IN (
         SELECT id FROM product_variants
         WHERE product_id = $1 AND sku <> ALL($2::text[])
       )`,
      [productId, incomingSkus],
    );
    await client.query(
      'DELETE FROM product_variants WHERE product_id = $1 AND sku <> ALL($2::text[])',
      [productId, incomingSkus],
    );
  } else {
    // No variants coming in — wipe all (product-level stock only)
    await client.query(
      'UPDATE cart_items SET variant_id = NULL WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)',
      [productId],
    );
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
  }

  for (const [index, { variant, sku, barcode }] of resolved.entries()) {
    const costCents = variant.costPrice != null && variant.costPrice !== ''
      ? Math.max(0, Math.round(Number(variant.costPrice) * 100))
      : null;

    const shippingCents = variant.shippingCost != null && variant.shippingCost !== ''
      ? Math.max(0, Math.round(Number(variant.shippingCost) * 100))
      : null;

    const colorText = String(variant.color || '').trim() || null;
    const incomingStock = Math.max(0, Number.parseInt(variant.stock, 10) || 0);

    const upserted = await client.query(
      `
        INSERT INTO product_variants (
          tenant_id, product_id, sku, barcode, size, color, material,
          price_cents, cost_price_cents, shipping_cost_cents, stock_quantity, sort_order, is_active,
          color_ref_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true,
          (SELECT id FROM ref_colors
           WHERE tenant_id = $1 AND lower(trim(name_en)) = lower(trim($6))
           LIMIT 1))
        ON CONFLICT (tenant_id, sku) DO UPDATE SET
          product_id         = EXCLUDED.product_id,
          barcode            = EXCLUDED.barcode,
          size               = EXCLUDED.size,
          color              = EXCLUDED.color,
          material           = EXCLUDED.material,
          price_cents        = EXCLUDED.price_cents,
          cost_price_cents   = EXCLUDED.cost_price_cents,
          shipping_cost_cents = EXCLUDED.shipping_cost_cents,
          sort_order         = EXCLUDED.sort_order,
          is_active          = true,
          color_ref_id       = EXCLUDED.color_ref_id,
          -- Preserve existing stock when the editor sends 0 but DB already has a real value
          -- (protects against a product save overwriting a bulk-stock-update)
          stock_quantity     = CASE
            WHEN ${trustZeroStock} THEN EXCLUDED.stock_quantity
            WHEN EXCLUDED.stock_quantity > 0 THEN EXCLUDED.stock_quantity
            ELSE product_variants.stock_quantity
          END,
          updated_at = NOW()
        RETURNING id, stock_quantity
      `,
      [
        tenantId,
        productId,
        sku,
        barcode,
        String(variant.size || '').trim() || null,
        colorText,
        String(variant.material || '').trim() || null,
        toCents(variant.price),
        costCents,
        shippingCents,
        incomingStock,
        index,
      ],
    );

    // The upsert's CASE means the stored stock is not always what was sent, so
    // the delta is computed from what the database actually ended up with.
    const saved = upserted.rows[0];
    if (saved) {
      const previous = previousStockBySku.get(sku)?.stock ?? 0;
      const delta = (Number(saved.stock_quantity) || 0) - previous;
      if (delta !== 0) {
        await recordMovement(client, { tenantId, userId: actorUserId }, {
          productId,
          variantId: saved.id,
          delta,
          reason: 'catalog_edit',
          referenceType: 'product',
          referenceId: productId,
          metadata: {
            sku,
            action: previousStockBySku.has(sku) ? 'variant_updated' : 'variant_created',
            previousStock: previous,
            newStock: Number(saved.stock_quantity) || 0,
          },
        });
      }
    }
  }
}

async function findOrCreateImageAsset(client, tenantId, url, index) {
  // The Angular client normalises /uploads/ paths to /api/uploads/ for proxy
  // routing, so strip that prefix before DB lookup to avoid duplicate assets.
  const rawUrl = url.startsWith('/api/') ? url.slice(4) : url;
  const existing = await client.query(
    `
      SELECT id
      FROM media_assets
      WHERE tenant_id = $1
        AND kind = 'image'
        AND (storage_url = $2 OR preview_url = $2
             OR storage_url = $3 OR preview_url = $3)
      ORDER BY created_at
      LIMIT 1
    `,
    [tenantId, url, rawUrl],
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

  // Dual-write: also populate product_color_images pivot (migration 010).
  // Falls back gracefully if the table doesn't exist yet on older environments.
  await replaceColorImages(client, tenantId, productId, urls, colorsByUrl);
}

async function replaceColorImages(client, tenantId, productId, urls, colorsByUrl) {
  try {
    await client.query(
      'DELETE FROM product_color_images WHERE tenant_id = $1 AND product_id = $2',
      [tenantId, productId],
    );

    for (const [url, color] of Object.entries(colorsByUrl)) {
      const colorKey = String(color).trim().toLowerCase();
      if (!colorKey) continue;

      // Strip /api/ prefix that the Angular client adds for proxy routing
      const rawUrl = url.startsWith('/api/') ? url.slice(4) : url;
      const { rows } = await client.query(
        `SELECT id FROM media_assets
         WHERE tenant_id = $1 AND (storage_url = $2 OR preview_url = $2
                                OR storage_url = $3 OR preview_url = $3)
         LIMIT 1`,
        [tenantId, url, rawUrl],
      );
      if (!rows[0]) continue;

      const sortOrder = urls.indexOf(url);
      await client.query(
        `INSERT INTO product_color_images (tenant_id, product_id, color, media_id, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, color, sort_order)
         DO UPDATE SET media_id = EXCLUDED.media_id`,
        [tenantId, productId, colorKey, rows[0].id, sortOrder >= 0 ? sortOrder : 999],
      );
    }
  } catch (err) {
    // Non-fatal: pivot table may not exist on environments that haven't run migration 010 yet.
    if (err.code !== '42P01') throw err; // 42P01 = undefined_table
  }
}

async function replaceRecommendations(client, tenantId, productId, relatedProductIds) {
  await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
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
  const desc = row.description || {};
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar || '',
    sku: row.sku,
    brand: row.brand,
    price: Math.round(Number(row.base_price_cents || 0) / 100),
    stock: Number(row.stock_quantity || 0),
    hidden: row.status === 'hidden',
    image: row.image || '',
    images: row.images || [],
    imageColors: normalizeImageColors(row.image_colors),
    variants: row.variants || [],
    enDesc: desc.en || '',
    arDesc: desc.ar || '',
    // Short marketing copy for compact surfaces (home hero, cards). The long
    // description stays for the product detail page.
    shortEn: desc.shortEn || '',
    shortAr: desc.shortAr || '',
    metaTitle: row.meta_title || '',
    metaDesc: row.meta_desc || '',
    slug: row.slug || '',
    relatedProductIds: row.related_product_ids || [],
  };
}

async function loadAdminProduct(client, tenantId, productId) {
  await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
  const result = await client.query(
    `
      SELECT
        p.*,
        COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pv.id,
            'sku', pv.sku,
            'barcode', pv.barcode,
            'size', pv.size,
            'color', pv.color,
            'material', pv.material,
            'price', round(pv.price_cents / 100.0),
            'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0) ELSE NULL END,
            'shippingCost', CASE WHEN pv.shipping_cost_cents IS NOT NULL THEN round(pv.shipping_cost_cents / 100.0) ELSE NULL END,
            'totalCost', CASE WHEN pv.total_cost_cents IS NOT NULL THEN round(pv.total_cost_cents / 100.0) ELSE NULL END,
            'stock', pv.stock_quantity
          ) ORDER BY pv.sort_order, pv.created_at)
          FROM product_variants pv
          WHERE pv.product_id = p.id
        ), '[]'::jsonb) AS variants,
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
        ), ARRAY[]::uuid[]) AS related_product_ids,
        pt_ar.name AS name_ar
      FROM products p
      LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
      LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
      WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
      GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
    `,
    [tenantId, productId],
  );
  return result.rowCount === 0 ? null : mapAdminProduct(result.rows[0]);
}

async function upsertProduct(client, tenant, product, { actorUserId = null } = {}) {
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
    shortEn: String(product.shortEn || '').trim(),
    shortAr: String(product.shortAr || '').trim(),
  };

  const metaTitle = String(product.metaTitle || '').trim() || null;
  const metaDesc = String(product.metaDesc || '').trim() || null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const stockQty = variants.length > 0
    ? variants.reduce((sum, v) => sum + (Math.max(0, Number.parseInt(v.stock, 10) || 0)), 0)
    : Math.max(0, Number.parseInt(product.stock, 10) || 0);

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
    stockQty,
    metaTitle,   // $11
    metaDesc,    // $12
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
            meta_title = $11,
            meta_desc = $12,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $13
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      [...params, product.id],
    )
    : await client.query(
      `
        INSERT INTO products (
          tenant_id, sku, brand, name, slug, status, description,
          base_price_cents, currency, stock_quantity,
          meta_title, meta_desc
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
            meta_title = EXCLUDED.meta_title,
            meta_desc = EXCLUDED.meta_desc
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      params,
    );

  const saved = upserted.rows[0];
  await replaceVariants(client, tenant.id, saved.id, variants, { actorUserId });
  // Re-sum variant stock onto the product row so the catalog total is always
  // accurate even when the stock-preservation branch kept a different value.
  if (variants.length > 0) {
    await client.query(
      'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants WHERE product_id = $1), updated_at = now() WHERE id = $1',
      [saved.id],
    );
  }
  await replaceImages(client, tenant.id, saved.id, images, imageColors);
  if (hasRelatedProductIds) {
    await replaceRecommendations(client, tenant.id, saved.id, product.relatedProductIds);
  }

  // Upsert Arabic name into product_translations
  const nameAr = String(product.nameAr || '').trim();
  if (nameAr) {
    await client.query(
      `
        INSERT INTO product_translations (product_id, locale, name)
        VALUES ($1, 'ar', $2)
        ON CONFLICT (product_id, locale) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      `,
      [saved.id, nameAr],
    );
  }

  return { ...saved, tenantId: tenant.id, imageCount: images.length };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
    const result = await client.query(
      `
        SELECT
          p.*,
          COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'barcode', pv.barcode,
              'size', pv.size,
              'color', pv.color,
              'material', pv.material,
              'price', round(pv.price_cents / 100.0),
              'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0) ELSE NULL END,
              'stock', pv.stock_quantity
            ) ORDER BY pv.sort_order, pv.created_at)
            FROM product_variants pv
            WHERE pv.product_id = p.id
          ), '[]'::jsonb) AS variants,
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
          ), ARRAY[]::uuid[]) AS related_product_ids,
          pt_ar.name AS name_ar
        FROM products p
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
        WHERE p.tenant_id = $1 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
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
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
    const result = await client.query(
      `
        SELECT
          p.*,
          COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'barcode', pv.barcode,
              'size', pv.size,
              'color', pv.color,
              'material', pv.material,
              'price', round(pv.price_cents / 100.0),
              'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0) ELSE NULL END,
              'stock', pv.stock_quantity
            ) ORDER BY pv.sort_order, pv.created_at)
            FROM product_variants pv
            WHERE pv.product_id = p.id
          ), '[]'::jsonb) AS variants,
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
          ), ARRAY[]::uuid[]) AS related_product_ids,
          pt_ar.name AS name_ar
        FROM products p
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
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
    const saved = await upsertProduct(client, tenant, req.body, { actorUserId: req.user?.id || null });
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
    const changedProductIds = new Set();

    for (const item of updates) {
      const sku = String(item.sku || '').trim();
      const stock = Math.max(0, Number.parseInt(item.stock, 10) || 0);
      if (!sku) continue;

      // Update the variant row first (preferred — variant SKUs are unique).
      // `stock_quantity` before the write is returned so the ledger records a
      // signed delta rather than an absolute value: the ledger's whole purpose
      // is that current stock must reconcile against baseline + sum(delta).
      const varResult = await client.query(
        `UPDATE product_variants pv
            SET stock_quantity = $1, updated_at = now()
           FROM (SELECT id, stock_quantity AS previous FROM product_variants
                  WHERE tenant_id = $2 AND sku = $3 FOR UPDATE) prev
          WHERE pv.id = prev.id
        RETURNING pv.product_id, pv.id AS variant_id, prev.previous`,
        [stock, tenant.id, sku],
      );

      if (varResult.rowCount > 0) {
        const row = varResult.rows[0];
        const delta = stock - Number(row.previous);
        if (delta !== 0) {
          // Without this the hourly drift job reports every legitimate manual
          // edit as drift, and an alert that fires on normal work is an alert
          // that gets ignored (docs/25 Phase 1b).
          await recordMovement(client, { tenantId: tenant.id, userId: req.user?.id || null }, {
            productId: row.product_id,
            variantId: row.variant_id,
            delta,
            reason: 'bulk_import',
            referenceType: 'bulk_stock_update',
            referenceId: null,
            metadata: { sku, previousStock: Number(row.previous), newStock: stock },
          });
        }
        // Re-sum all variant stock onto the parent product so the catalog stock total stays accurate
        const productId = varResult.rows[0].product_id;
        changedProductIds.add(productId);
        await client.query(
          'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants WHERE product_id = $1), updated_at = now() WHERE id = $1',
          [productId],
        );
        updated += varResult.rowCount;
      } else {
        // Fall back to product-level SKU (no-variant products)
        const prodResult = await client.query(
          "UPDATE products SET stock_quantity = $1, updated_at = now() WHERE tenant_id = $2 AND sku = $3 AND status <> 'archived' RETURNING id",
          [stock, tenant.id, sku],
        );
        if (prodResult.rowCount === 0) {
          notFound.push(sku);
        } else {
          changedProductIds.add(prodResult.rows[0].id);
          updated += prodResult.rowCount;
        }
      }
    }

    await client.query('COMMIT');
    for (const productId of changedProductIds) {
      await processRestockNotifications(client, tenant.id, productId);
    }
    ok(res, { updated, notFound }, `${updated} variant(s) updated.`);
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
    const patchVariants = req.body.variants;
    const patchStockRaw = req.body.stock ?? existing.stock_quantity;
    const patchStock = Array.isArray(patchVariants) && patchVariants.length > 0
      ? patchVariants.reduce((sum, v) => sum + (Math.max(0, Number.parseInt(v.stock, 10) || 0)), 0)
      : patchStockRaw;

    const payload = {
      name: req.body.name ?? existing.name,
      sku: req.body.sku ?? existing.sku,
      brand: req.body.brand ?? existing.brand,
      price: req.body.price ?? Math.round(Number(existing.base_price_cents) / 100),
      stock: patchStock,
      hidden: req.body.hidden ?? existing.status === 'hidden',
      enDesc: req.body.enDesc ?? existing.description?.en,
      arDesc: req.body.arDesc ?? existing.description?.ar,
      shortEn: req.body.shortEn ?? existing.description?.shortEn,
      shortAr: req.body.shortAr ?? existing.description?.shortAr,
      slug: req.body.slug ?? existing.slug,
      metaTitle: req.body.metaTitle ?? existing.meta_title,
      metaDesc: req.body.metaDesc ?? existing.meta_desc,
      id: req.params.id,
      nameAr: req.body.nameAr,
      variants: patchVariants,
      images: req.body.images,
      imageColors: req.body.imageColors,
      relatedProductIds: req.body.relatedProductIds,
    };

    const saved = await upsertProduct(client, tenant, payload, { actorUserId: req.user?.id || null });
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
              tenant_id, filename, kind, mime_type, size_bytes, width, height,
              storage_url, preview_url, uploaded_by_user_id, metadata
            )
            VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            RETURNING id
          `,
          [
            tenant.id, file.originalname, stored.mimeType, file.size,
            stored.width, stored.height,
            stored.url, stored.previewUrl, userId,
            JSON.stringify({
              storagePath: stored.storagePath,
              originalName: file.originalname,
              imageVariants: stored.variants || {},
            }),
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
        sku: v.sku.replaceAll(source.sku, newSku),
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
