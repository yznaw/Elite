const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

function mapCollection(row) {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || null,
    productIds: row.product_ids || [],
    parentId: row.parent_id || null,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 3, 1), 12);
    const client = await db.pool.connect();

    try {
      const tenant = await ensureDefaultTenant(client);
      const systemResult = await client.query(
        `
          SELECT
            c.id,
            c.handle,
            c.title,
            c.description,
            c.seo->>'imageUrl' AS image_url,
            ARRAY[]::text[] AS product_ids
          FROM collections c
          WHERE c.tenant_id = $1 AND c.status = 'active' AND c.handle = 'all-products'
          LIMIT 1
        `,
        [tenant.id],
      );

      const systemProductIds = systemResult.rowCount > 0
        ? (await client.query(
            `
              SELECT id::text
              FROM products
              WHERE tenant_id = $1 AND status <> 'archived'
              ORDER BY created_at DESC
            `,
            [tenant.id],
          )).rows.map((row) => row.id)
        : [];

      const result = await client.query(
        `
          SELECT
            c.id,
            c.handle,
            c.title,
            c.description,
            c.seo->>'imageUrl' AS image_url,
            c.parent_id,
            COALESCE(
              array_agg(cp.product_id::text ORDER BY cp.sort_order) FILTER (WHERE cp.product_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS product_ids
          FROM collections c
          LEFT JOIN collection_products cp ON cp.collection_id = c.id
          WHERE c.tenant_id = $1 AND c.status = 'active' AND c.handle <> 'all-products'
          GROUP BY c.id
          ORDER BY c.sort_order, c.created_at DESC
          LIMIT $2
        `,
        [tenant.id, Math.max(limit - (systemResult.rowCount > 0 ? 1 : 0), 0)],
      );

      const rows = result.rows.map(mapCollection);
      if (systemResult.rowCount > 0) {
        rows.push({ ...mapCollection(systemResult.rows[0]), productIds: systemProductIds });
      }

      ok(res, rows);
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
