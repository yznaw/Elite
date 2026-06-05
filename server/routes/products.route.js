const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');
const { createRestockNotification, processRestockNotifications } = require('../lib/restock-notifications');

const router = Router();

const BUILT_IN_FALLBACK = '/assets/brand/elite-logo-green.png';

async function getDefaultImage(client, tenantId) {
  try {
    const r = await client.query('SELECT config FROM tenants WHERE id = $1', [tenantId]);
    return r.rows[0]?.config?.defaultImage || BUILT_IN_FALLBACK;
  } catch {
    return BUILT_IN_FALLBACK;
  }
}
const COLOR_IMAGES_SELECT = `
          COALESCE(
            (
              SELECT jsonb_object_agg(color_key, url)
              FROM (
                SELECT DISTINCT ON (color_key)
                  color_key,
                  url
                FROM (
                  SELECT
                    lower(trim(COALESCE(
                      NULLIF(trim(m.metadata->>'color'), ''),
                      linked_variant.color,
                      sku_variant.color
                    ))) AS color_key,
                    COALESCE(m.preview_url, m.storage_url) AS url,
                    CASE
                      WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                        OR m.metadata ? 'storagePath'
                      THEN 0
                      ELSE 1
                    END AS role_rank,
                    ml.sort_order
                  FROM media_links ml
                  JOIN media_assets m ON m.id = ml.media_id
                  LEFT JOIN product_variants linked_variant ON linked_variant.id = ml.variant_id
                  LEFT JOIN product_variants sku_variant ON sku_variant.product_id = p.id AND sku_variant.sku = m.metadata->>'variantSku'
                  WHERE ml.role IN ('gallery', 'primary')
                    AND (ml.product_id = p.id OR linked_variant.product_id = p.id)
                ) color_media
                WHERE color_key IS NOT NULL AND color_key <> '' AND url IS NOT NULL AND url <> ''
                ORDER BY color_key, role_rank, sort_order
              ) first_color_media
            ),
            '{}'::jsonb
          ) AS color_images`;

function mapRow(row, defaultImage = BUILT_IN_FALLBACK) {
  const sizes = Array.isArray(row.sizes) ? row.sizes.filter(Boolean) : [];
  const colors = Array.isArray(row.colors) ? row.colors.filter(Boolean) : [];
  const materials = Array.isArray(row.materials) ? row.materials.filter(Boolean) : [];
  const media = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
  const variants = Array.isArray(row.variants)
    ? row.variants
      .filter((variant) => variant && typeof variant === 'object')
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku || '',
        size: Number.isFinite(Number(variant.size)) ? Number(variant.size) : undefined,
        color: variant.color || '',
        material: variant.material || '',
        price: Math.round(Number(variant.price || 0)),
        stock: Math.max(0, Number.parseInt(variant.stock, 10) || 0),
      }))
    : [];
  const colorImages = row.color_images && typeof row.color_images === 'object'
    ? Object.entries(row.color_images).reduce((map, [color, url]) => {
      const key = String(color || '').trim().toLowerCase();
      const imageUrl = String(url || '').trim();
      if (key && imageUrl) map[key] = imageUrl;
      return map;
    }, {})
    : {};
  const image = row.image || media[0] || defaultImage;
  const images = [...new Set([image, ...media])];

  return {
    id: row.id,
    name: row.name,
    brand: row.brand || '',
    price: Math.round(Number(row.base_price_cents || 0) / 100),
    tag: row.tag || '',
    leather: row.leather || '',
    style: row.style || '',
    sizes: sizes.length > 0 ? sizes.map((s) => Number(s)).filter(Number.isFinite) : [40, 41, 42, 43, 44],
    colors,
    materials,
    image,
    images,
    colorImages,
    variants,
    relatedProductIds: row.related_product_ids || [],
  };
}

function variantsSelect() {
  return `
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
          ) AS variants`;
}

router.get('/', async (_req, res, next) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
    const result = await client.query(
      `
        SELECT
          p.id,
          p.name,
          p.brand,
          p.base_price_cents,
          p.tag,
          p.leather,
          p.style,
          COALESCE(
            array_agg(DISTINCT pv.size ORDER BY pv.size)
              FILTER (WHERE pv.size IS NOT NULL AND pv.size <> ''),
            ARRAY[]::text[]
          ) AS sizes,
          COALESCE(
            array_agg(DISTINCT pv.color ORDER BY pv.color)
              FILTER (WHERE pv.color IS NOT NULL AND pv.color <> ''),
            ARRAY[]::text[]
          ) AS colors,
          COALESCE(
            array_agg(DISTINCT pv.material ORDER BY pv.material)
              FILTER (WHERE pv.material IS NOT NULL AND pv.material <> ''),
            ARRAY[]::text[]
          ) AS materials,
          ${variantsSelect()},
          COALESCE(
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role = 'gallery'
              ORDER BY
                CASE
                  WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                    OR m.metadata ? 'storagePath'
                  THEN 0
                  ELSE 1
                END,
                ml.sort_order
              LIMIT 1
            ),
            primary_media.preview_url,
            primary_media.storage_url,
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role = 'primary'
              ORDER BY ml.sort_order
              LIMIT 1
            )
          ) AS image,
          COALESCE(
            ARRAY(
              SELECT url
              FROM (
                SELECT DISTINCT ON (url) url, role_rank, sort_order
                FROM (
                  SELECT
                    COALESCE(m.preview_url, m.storage_url) AS url,
                    CASE
                      WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                        OR m.metadata ? 'storagePath'
                      THEN 0
                      ELSE 1
                    END AS role_rank,
                    ml.sort_order
                  FROM media_links ml
                  JOIN media_assets m ON m.id = ml.media_id
                  WHERE ml.product_id = p.id AND ml.role = 'gallery'
                  UNION ALL
                  SELECT COALESCE(primary_media.preview_url, primary_media.storage_url) AS url, 2 AS role_rank, 0 AS sort_order
                  WHERE primary_media.id IS NOT NULL
                  UNION ALL
                  SELECT COALESCE(m.preview_url, m.storage_url) AS url, 2 AS role_rank, ml.sort_order
                  FROM media_links ml
                  JOIN media_assets m ON m.id = ml.media_id
                  WHERE ml.product_id = p.id AND ml.role = 'primary'
                ) product_media
                WHERE url IS NOT NULL AND url <> ''
                ORDER BY url, role_rank, sort_order
              ) deduped_product_media
              ORDER BY role_rank, sort_order
            ),
            ARRAY[]::text[]
          ) AS images,
          ${COLOR_IMAGES_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status = 'active'
          ), ARRAY[]::uuid[]) AS related_product_ids
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.tenant_id = $1 AND p.status = 'active'
        GROUP BY p.id, primary_media.id, primary_media.preview_url, primary_media.storage_url
        ORDER BY p.created_at DESC
      `,
      [tenant.id],
    );

    const defaultImage = await getDefaultImage(client, tenant.id);
    res.json({
      success: true,
      data: result.rows.map(row => mapRow(row, defaultImage)),
      message: 'Products retrieved.',
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.get('/:id', async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
    const result = await client.query(
      `
        SELECT
          p.id,
          p.name,
          p.brand,
          p.base_price_cents,
          p.tag,
          p.leather,
          p.style,
          COALESCE(
            array_agg(DISTINCT pv.size ORDER BY pv.size)
              FILTER (WHERE pv.size IS NOT NULL AND pv.size <> ''),
            ARRAY[]::text[]
          ) AS sizes,
          COALESCE(
            array_agg(DISTINCT pv.color ORDER BY pv.color)
              FILTER (WHERE pv.color IS NOT NULL AND pv.color <> ''),
            ARRAY[]::text[]
          ) AS colors,
          COALESCE(
            array_agg(DISTINCT pv.material ORDER BY pv.material)
              FILTER (WHERE pv.material IS NOT NULL AND pv.material <> ''),
            ARRAY[]::text[]
          ) AS materials,
          ${variantsSelect()},
          COALESCE(
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role = 'gallery'
              ORDER BY
                CASE
                  WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                    OR m.metadata ? 'storagePath'
                  THEN 0
                  ELSE 1
                END,
                ml.sort_order
              LIMIT 1
            ),
            primary_media.preview_url,
            primary_media.storage_url,
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role = 'primary'
              ORDER BY ml.sort_order
              LIMIT 1
            )
          ) AS image,
          COALESCE(
            ARRAY(
              SELECT url
              FROM (
                SELECT DISTINCT ON (url) url, role_rank, sort_order
                FROM (
                  SELECT
                    COALESCE(m.preview_url, m.storage_url) AS url,
                    CASE
                      WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                        OR m.metadata ? 'storagePath'
                      THEN 0
                      ELSE 1
                    END AS role_rank,
                    ml.sort_order
                  FROM media_links ml
                  JOIN media_assets m ON m.id = ml.media_id
                  WHERE ml.product_id = p.id AND ml.role = 'gallery'
                  UNION ALL
                  SELECT COALESCE(primary_media.preview_url, primary_media.storage_url) AS url, 2 AS role_rank, 0 AS sort_order
                  WHERE primary_media.id IS NOT NULL
                  UNION ALL
                  SELECT COALESCE(m.preview_url, m.storage_url) AS url, 2 AS role_rank, ml.sort_order
                  FROM media_links ml
                  JOIN media_assets m ON m.id = ml.media_id
                  WHERE ml.product_id = p.id AND ml.role = 'primary'
                ) product_media
                WHERE url IS NOT NULL AND url <> ''
                ORDER BY url, role_rank, sort_order
              ) deduped_product_media
              ORDER BY role_rank, sort_order
            ),
            ARRAY[]::text[]
          ) AS images,
          ${COLOR_IMAGES_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status = 'active'
          ), ARRAY[]::uuid[]) AS related_product_ids
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.status = 'active'
        GROUP BY p.id, primary_media.id, primary_media.preview_url, primary_media.storage_url
        LIMIT 1
      `,
      [tenant.id, req.params.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const defaultImage = await getDefaultImage(client, tenant.id);
    res.json({
      success: true,
      data: mapRow(result.rows[0], defaultImage),
      message: 'Product retrieved.',
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.post('/:id/restock-notifications', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim() || email.split('@')[0] || 'Customer';
  const phone = String(req.body.phone || '').trim() || null;
  const size = String(req.body.size || '').trim();
  const color = String(req.body.color || '').trim();
  const locale = String(req.body.locale || 'en').trim() || 'en';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'A valid email address is required.',
    });
  }

  if (!size) {
    return res.status(400).json({
      success: false,
      message: 'Size is required.',
    });
  }

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const product = await client.query(
      `
        SELECT id, name
        FROM products
        WHERE tenant_id = $1 AND id = $2 AND status = 'active'
        LIMIT 1
      `,
      [tenant.id, req.params.id],
    );

    if (product.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const inserted = await createRestockNotification(client, tenant.id, {
      productId: product.rows[0].id,
      email,
      name,
      phone,
      size,
      color,
      locale,
    });
    await processRestockNotifications(client, tenant.id, product.rows[0].id);

    res.status(201).json({
      success: true,
      data: inserted.rows[0],
      message: 'Restock notification saved.',
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
