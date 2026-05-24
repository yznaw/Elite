const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, validationError } = require('./lib');

const router = Router();

function mapCollection(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || null,
    productIds: row.product_ids || [],
    hidden: row.status === 'hidden',
  };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT
          c.*,
          c.seo->>'imageUrl' AS image_url,
          COALESCE(array_agg(cp.product_id::text ORDER BY cp.sort_order) FILTER (WHERE cp.product_id IS NOT NULL), ARRAY[]::text[]) AS product_ids
        FROM collections c
        LEFT JOIN collection_products cp ON cp.collection_id = c.id
        WHERE c.tenant_id = $1 AND c.status <> 'archived'
        GROUP BY c.id
        ORDER BY c.sort_order, c.created_at DESC
      `,
      [tenant.id],
    );
    ok(res, result.rows.map(mapCollection));
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return validationError(res, ['Collection title is required.']);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const saved = await client.query(
      `
        INSERT INTO collections (tenant_id, handle, title, description, status, seo)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *
      `,
      [
        tenant.id,
        slugify(req.body.handle || title),
        title,
        String(req.body.description || ''),
        req.body.hidden ? 'hidden' : 'active',
        JSON.stringify({ imageUrl: req.body.imageUrl || null }),
      ],
    );

    const productIds = await replaceProducts(client, tenant.id, saved.rows[0].id, req.body.productIds || []);
    await client.query('COMMIT');
    created(res, mapCollection({ ...saved.rows[0], image_url: req.body.imageUrl || null, product_ids: productIds }), 'Collection saved.');
  } catch (err) {
    await client.query('ROLLBACK');
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
    const current = await client.query('SELECT * FROM collections WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Collection not found.');
    }

    const row = current.rows[0];
    const title = req.body.title ?? row.title;
    const saved = await client.query(
      `
        UPDATE collections
        SET title = $3,
            handle = $4,
            description = $5,
            status = $6,
            seo = $7::jsonb
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
      `,
      [
        tenant.id,
        req.params.id,
        title,
        slugify(req.body.handle || row.handle || title),
        req.body.description ?? row.description,
        (req.body.hidden ?? row.status === 'hidden') ? 'hidden' : 'active',
        JSON.stringify({ ...(row.seo || {}), imageUrl: req.body.imageUrl ?? row.seo?.imageUrl ?? null }),
      ],
    );

    const ids = Array.isArray(req.body.productIds)
      ? await replaceProducts(client, tenant.id, req.params.id, req.body.productIds)
      : (await client.query('SELECT product_id::text FROM collection_products WHERE collection_id = $1 ORDER BY sort_order', [req.params.id])).rows.map((r) => r.product_id);

    await client.query('COMMIT');
    ok(res, mapCollection({ ...saved.rows[0], image_url: req.body.imageUrl ?? saved.rows[0].seo?.imageUrl ?? null, product_ids: ids }), 'Collection updated.');
  } catch (err) {
    await client.query('ROLLBACK');
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
      "UPDATE collections SET status = 'archived' WHERE tenant_id = $1 AND id = $2 RETURNING id",
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Collection not found.');
    ok(res, { id: result.rows[0].id }, 'Collection archived.');
  } finally {
    client.release();
  }
}));

async function replaceProducts(client, tenantId, collectionId, productIds) {
  await client.query('DELETE FROM collection_products WHERE collection_id = $1', [collectionId]);
  const validProductIds = await filterExistingProductIds(client, tenantId, productIds);

  for (const [index, productId] of validProductIds.entries()) {
    await client.query(
      `
        INSERT INTO collection_products (tenant_id, collection_id, product_id, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (collection_id, product_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
      `,
      [tenantId, collectionId, productId, index],
    );
  }

  return validProductIds;
}

async function filterExistingProductIds(client, tenantId, productIds) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).filter((id) => uuidPattern.test(String(id))))];
  if (ids.length === 0) return [];

  const result = await client.query(
    `
      SELECT id::text
      FROM products
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status <> 'archived'
    `,
    [tenantId, ids],
  );
  const existing = new Set(result.rows.map((row) => row.id));
  return ids.filter((id) => existing.has(id));
}

module.exports = router;
