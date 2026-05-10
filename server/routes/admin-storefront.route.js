const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok } = require('./lib');

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
      SELECT b.*, COALESCE(array_agg(sbp.product_id::text ORDER BY sbp.sort_order) FILTER (WHERE sbp.product_id IS NOT NULL), ARRAY[]::text[]) AS product_ids
      FROM storefront_blocks b
      LEFT JOIN storefront_block_products sbp ON sbp.block_id = b.id
      WHERE b.snapshot_id = $1
      GROUP BY b.id
      ORDER BY b.sort_order
    `,
    [snap.rows[0].id],
  );

  return {
    id: snap.rows[0].id,
    status: snap.rows[0].status,
    savedAt: snap.rows[0].updated_at,
    publishedAt: snap.rows[0].published_at,
    blocks: blocks.rows.map(mapBlock),
  };
}

function mapBlock(row) {
  return {
    id: row.block_key,
    type: row.type,
    title: row.title,
    visible: row.visible,
    config: row.config,
    subtitle: row.subtitle || undefined,
    ctaText: row.cta_text || undefined,
    ctaLink: row.cta_link || undefined,
    collectionId: row.collection_id || undefined,
    itemLimit: row.item_limit || undefined,
    sortBy: row.sort_by || undefined,
    body: row.body || undefined,
    productIds: row.product_ids || [],
  };
}

router.get('/draft', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    ok(res, await loadSnapshot(client, tenant.id, 'draft'));
  } finally {
    client.release();
  }
}));

router.get('/published', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    ok(res, await loadSnapshot(client, tenant.id, 'published'));
  } finally {
    client.release();
  }
}));

router.post('/draft', asyncHandler(async (req, res) => {
  const blocks = Array.isArray(req.body.blocks) ? req.body.blocks : [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const snap = await client.query(
      `
        INSERT INTO storefront_snapshots (tenant_id, status, version, title)
        VALUES ($1, 'draft', COALESCE((SELECT max(version) + 1 FROM storefront_snapshots WHERE tenant_id = $1), 1), $2)
        ON CONFLICT (tenant_id) WHERE status = 'draft'
        DO UPDATE SET updated_at = now(), title = EXCLUDED.title
        RETURNING *
      `,
      [tenant.id, req.body.title || 'Draft'],
    );

    await client.query('DELETE FROM storefront_blocks WHERE snapshot_id = $1', [snap.rows[0].id]);
    await insertBlocks(client, tenant.id, snap.rows[0].id, blocks);
    await client.query('COMMIT');
    created(res, await loadSnapshot(client, tenant.id, 'draft'), 'Storefront draft saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.post('/publish', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const draft = await loadSnapshot(client, tenant.id, 'draft');
    if (!draft) {
      await client.query('ROLLBACK');
      return notFound(res, 'No draft storefront snapshot found.');
    }
    const snap = await client.query(
      `
        INSERT INTO storefront_snapshots (tenant_id, status, version, title, published_at)
        VALUES ($1, 'published', COALESCE((SELECT max(version) + 1 FROM storefront_snapshots WHERE tenant_id = $1), 1), 'Published', now())
        RETURNING *
      `,
      [tenant.id],
    );
    await insertBlocks(client, tenant.id, snap.rows[0].id, draft.blocks);
    await client.query('COMMIT');
    created(res, await loadSnapshot(client, tenant.id, 'published'), 'Storefront published.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

async function insertBlocks(client, tenantId, snapshotId, blocks) {
  for (const [index, block] of blocks.entries()) {
    const saved = await client.query(
      `
        INSERT INTO storefront_blocks (
          tenant_id, snapshot_id, block_key, type, title, visible, config,
          subtitle, cta_text, cta_link, collection_id, item_limit, sort_by, body, settings, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)
        RETURNING id
      `,
      [
        tenantId,
        snapshotId,
        block.id || `block-${index}`,
        block.type,
        block.title || '',
        block.visible !== false,
        block.config || '',
        block.subtitle || null,
        block.ctaText || null,
        block.ctaLink || null,
        block.collectionId || null,
        block.itemLimit || null,
        block.sortBy || null,
        JSON.stringify(block.body || {}),
        JSON.stringify(block.settings || {}),
        index,
      ],
    );

    for (const [productIndex, productId] of (block.productIds || []).entries()) {
      await client.query(
        'INSERT INTO storefront_block_products (block_id, product_id, sort_order) VALUES ($1, $2, $3)',
        [saved.rows[0].id, productId, productIndex],
      );
    }
  }
}

module.exports = router;
