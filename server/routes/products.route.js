const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');

const router = Router();

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=85&auto=format&fit=crop';
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

function mapRow(row) {
  const sizes = Array.isArray(row.sizes) ? row.sizes.filter(Boolean) : [];
  const colors = Array.isArray(row.colors) ? row.colors.filter(Boolean) : [];
  const materials = Array.isArray(row.materials) ? row.materials.filter(Boolean) : [];
  const media = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
  const colorImages = row.color_images && typeof row.color_images === 'object'
    ? Object.entries(row.color_images).reduce((map, [color, url]) => {
      const key = String(color || '').trim().toLowerCase();
      const imageUrl = String(url || '').trim();
      if (key && imageUrl) map[key] = imageUrl;
      return map;
    }, {})
    : {};
  const image = row.image || media[0] || DEFAULT_IMAGE;
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
    relatedProductIds: row.related_product_ids || [],
  };
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

    res.json({
      success: true,
      data: result.rows.map(mapRow),
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

    res.json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Product retrieved.',
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
