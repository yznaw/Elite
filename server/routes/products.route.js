const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');

const router = Router();

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=85&auto=format&fit=crop';

function mapRow(row) {
  const sizes = Array.isArray(row.sizes) ? row.sizes.filter(Boolean) : [];
  const colors = Array.isArray(row.colors) ? row.colors.filter(Boolean) : [];
  const materials = Array.isArray(row.materials) ? row.materials.filter(Boolean) : [];
  const media = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
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
  };
}

router.get('/', async (_req, res, next) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
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
            primary_media.preview_url,
            primary_media.storage_url,
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
              ORDER BY ml.sort_order
              LIMIT 1
            )
          ) AS image,
          COALESCE(
            ARRAY(
              SELECT url
              FROM (
                SELECT COALESCE(primary_media.preview_url, primary_media.storage_url) AS url, -1 AS sort_order
                WHERE primary_media.id IS NOT NULL
                UNION
                SELECT COALESCE(m.preview_url, m.storage_url) AS url, ml.sort_order
                FROM media_links ml
                JOIN media_assets m ON m.id = ml.media_id
                WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
              ) product_media
              WHERE url IS NOT NULL AND url <> ''
              ORDER BY sort_order
            ),
            ARRAY[]::text[]
          ) AS images
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
            primary_media.preview_url,
            primary_media.storage_url,
            (
              SELECT COALESCE(m.preview_url, m.storage_url)
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
              ORDER BY ml.sort_order
              LIMIT 1
            )
          ) AS image,
          COALESCE(
            ARRAY(
              SELECT url
              FROM (
                SELECT COALESCE(primary_media.preview_url, primary_media.storage_url) AS url, -1 AS sort_order
                WHERE primary_media.id IS NOT NULL
                UNION
                SELECT COALESCE(m.preview_url, m.storage_url) AS url, ml.sort_order
                FROM media_links ml
                JOIN media_assets m ON m.id = ml.media_id
                WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
              ) product_media
              WHERE url IS NOT NULL AND url <> ''
              ORDER BY sort_order
            ),
            ARRAY[]::text[]
          ) AS images
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
