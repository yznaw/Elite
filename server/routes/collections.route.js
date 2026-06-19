const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

function mapCollection(row, children = []) {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || null,
    productIds: row.product_ids || [],
    parentId: row.parent_id || null,
    children,
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

      // ── System "all-products" collection ──────────────────────────────────
      const systemResult = await client.query(
        `
          SELECT c.id, c.handle, c.title, c.description,
                 c.seo->>'imageUrl' AS image_url,
                 NULL::uuid AS parent_id,
                 ARRAY[]::text[] AS product_ids
          FROM collections c
          WHERE c.tenant_id = $1 AND c.status = 'active' AND c.handle = 'all-products'
          LIMIT 1
        `,
        [tenant.id],
      );

      const systemProductIds = systemResult.rowCount > 0
        ? (await client.query(
            `SELECT id::text FROM products WHERE tenant_id = $1 AND status <> 'archived' ORDER BY created_at DESC`,
            [tenant.id],
          )).rows.map((r) => r.id)
        : [];

      // ── Top-level collections only (parent_id IS NULL) ────────────────────
      const topResult = await client.query(
        `
          SELECT
            c.id, c.handle, c.title, c.description,
            c.seo->>'imageUrl' AS image_url,
            c.parent_id,
            COALESCE(
              array_agg(cp.product_id::text ORDER BY cp.sort_order)
              FILTER (WHERE cp.product_id IS NOT NULL),
              ARRAY[]::text[]
            ) AS product_ids
          FROM collections c
          LEFT JOIN collection_products cp ON cp.collection_id = c.id
          WHERE c.tenant_id = $1
            AND c.status = 'active'
            AND c.handle <> 'all-products'
            AND c.parent_id IS NULL
          GROUP BY c.id
          ORDER BY c.sort_order, c.created_at DESC
          LIMIT $2
        `,
        [tenant.id, Math.max(limit - (systemResult.rowCount > 0 ? 1 : 0), 0)],
      );

      // ── Sub-collections for the parents we just fetched ───────────────────
      const parentIds = topResult.rows.map((r) => r.id);
      let childRows = [];

      if (parentIds.length > 0) {
        const childResult = await client.query(
          `
            SELECT
              c.id, c.handle, c.title, c.description,
              c.seo->>'imageUrl' AS image_url,
              c.parent_id,
              COALESCE(
                array_agg(cp.product_id::text ORDER BY cp.sort_order)
                FILTER (WHERE cp.product_id IS NOT NULL),
                ARRAY[]::text[]
              ) AS product_ids
            FROM collections c
            LEFT JOIN collection_products cp ON cp.collection_id = c.id
            WHERE c.tenant_id = $1
              AND c.status = 'active'
              AND c.parent_id = ANY($2::uuid[])
            GROUP BY c.id
            ORDER BY c.sort_order, c.created_at DESC
          `,
          [tenant.id, parentIds],
        );
        childRows = childResult.rows;
      }

      // ── Attach children to parents ────────────────────────────────────────
      const childrenByParent = {};
      for (const row of childRows) {
        const pid = row.parent_id;
        if (!childrenByParent[pid]) childrenByParent[pid] = [];
        childrenByParent[pid].push(mapCollection(row));
      }

      const rows = topResult.rows.map((row) =>
        mapCollection(row, childrenByParent[row.id] || []),
      );

      if (systemResult.rowCount > 0) {
        rows.push({ ...mapCollection(systemResult.rows[0]), productIds: systemProductIds, children: [] });
      }

      ok(res, rows);
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
