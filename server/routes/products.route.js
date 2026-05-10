const { Router } = require('express');
const db = require('../db/client');

const router = Router();

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1519415943484-9fa1873496d4?w=600&q=85&auto=format&fit=crop';

function mapRow(row) {
  const sizes = Array.isArray(row.sizes) ? row.sizes.filter(Boolean) : [];

  return {
    id: row.id,
    name: row.name,
    price: Math.round(Number(row.base_price_cents || 0) / 100),
    tag: row.tag || '',
    leather: row.leather || '',
    style: row.style || '',
    sizes: sizes.length > 0 ? sizes.map((s) => Number(s)).filter(Number.isFinite) : [40, 41, 42, 43, 44],
    image: row.image || DEFAULT_IMAGE,
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const result = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.base_price_cents,
          p.tag,
          p.leather,
          p.style,
          COALESCE(
            array_agg(DISTINCT pv.size ORDER BY pv.size)
              FILTER (WHERE pv.size IS NOT NULL AND pv.size <> ''),
            ARRAY[]::text[]
          ) AS sizes,
          COALESCE(primary_media.preview_url, primary_media.storage_url) AS image
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url
        ORDER BY p.created_at DESC
      `,
    );

    res.json({
      success: true,
      data: result.rows.map(mapRow),
      message: 'Products retrieved.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.base_price_cents,
          p.tag,
          p.leather,
          p.style,
          COALESCE(
            array_agg(DISTINCT pv.size ORDER BY pv.size)
              FILTER (WHERE pv.size IS NOT NULL AND pv.size <> ''),
            ARRAY[]::text[]
          ) AS sizes,
          COALESCE(primary_media.preview_url, primary_media.storage_url) AS image
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        WHERE p.id = $1 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url
        LIMIT 1
      `,
      [req.params.id],
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
  }
});

module.exports = router;
