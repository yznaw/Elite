const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const DEFAULT_HOME_LAYOUT = [
  {
    id: 'home-hero',
    type: 'Landing Hero',
    title: 'Landing Hero',
    visible: true,
    config: 'Interactive model hero',
  },
  {
    id: 'home-collections',
    type: 'Featured Collections',
    title: 'Featured Collections',
    visible: true,
    config: '3 admin collections',
  },
  {
    id: 'home-discount',
    type: 'Promotion Section',
    title: 'Promotion Section',
    visible: true,
    config: 'Promotional split section',
  },
  {
    id: 'home-promise',
    type: 'Craft Promise',
    title: 'Craft Promise',
    visible: true,
    config: 'Stats and atelier promise',
  },
];

const router = Router();

async function loadSnapshot(client, tenantId, status) {
  const snap = await client.query(
    `
      SELECT *
      FROM storefront_snapshots
      WHERE tenant_id = $1 AND status = $2
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT 1
    `,
    [tenantId, status],
  );
  if (snap.rowCount === 0) return null;

  const blocks = await client.query(
    `
      SELECT *
      FROM storefront_blocks
      WHERE snapshot_id = $1
      ORDER BY sort_order
    `,
    [snap.rows[0].id],
  );

  return {
    id: snap.rows[0].id,
    status: snap.rows[0].status,
    savedAt: snap.rows[0].updated_at,
    publishedAt: snap.rows[0].published_at,
    blocks: blocks.rows.map((row) => ({
      id: row.block_key,
      type: row.type,
      title: row.title,
      visible: row.visible,
      config: row.config,
    })),
  };
}

router.get(
  '/published',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    const client = await db.pool.connect();

    try {
      const tenant = await ensureDefaultTenant(client);
      const snapshot = await loadSnapshot(client, tenant.id, 'published');
      ok(res, snapshot || {
        id: 'default-home-layout',
        status: 'published',
        savedAt: null,
        publishedAt: null,
        blocks: DEFAULT_HOME_LAYOUT,
      });
    } finally {
      client.release();
    }
  }),
);

module.exports = {
  DEFAULT_HOME_LAYOUT,
  router,
};
