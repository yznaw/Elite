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
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 3, 1), 12);
    const client = await db.pool.connect();

    try {
      const tenant = await ensureDefaultTenant(client);
      const result = await client.query(
        `
          SELECT
            c.id,
            c.handle,
            c.title,
            c.description,
            c.seo->>'imageUrl' AS image_url,
            COALESCE(
              array_agg(cp.product_id::text ORDER BY cp.sort_order) FILTER (WHERE cp.product_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS product_ids
          FROM collections c
          LEFT JOIN collection_products cp ON cp.collection_id = c.id
          WHERE c.tenant_id = $1 AND c.status = 'active'
          GROUP BY c.id
          ORDER BY c.sort_order, c.created_at DESC
          LIMIT $2
        `,
        [tenant.id, limit],
      );

      ok(res, result.rows.map(mapCollection));
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
