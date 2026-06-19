const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, validationError } = require('./lib');

const router = Router();

function mapCollection(row) {
  return {
    id: row.id,
    handle: row.handle || '',
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || null,
    productIds: row.product_ids || [],
    hidden: row.status === 'hidden',
    parentId: row.parent_id || null,
    system: row.handle === 'all-products',
  };
}

async function loadAllActiveProductIds(client, tenantId) {
  const products = await client.query(
    `
      SELECT id::text
      FROM products
      WHERE tenant_id = $1 AND status <> 'archived'
      ORDER BY created_at DESC
    `,
    [tenantId],
  );
  return products.rows.map((row) => row.id);
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
          c.parent_id,
          COALESCE(array_agg(cp.product_id::text ORDER BY cp.sort_order) FILTER (WHERE cp.product_id IS NOT NULL), ARRAY[]::text[]) AS product_ids
        FROM collections c
        LEFT JOIN collection_products cp ON cp.collection_id = c.id
        WHERE c.tenant_id = $1 AND c.status <> 'archived'
        GROUP BY c.id
        ORDER BY c.sort_order, c.created_at DESC
      `,
      [tenant.id],
    );
    const systemProductIds = result.rows.some((row) => row.handle === 'all-products')
      ? await loadAllActiveProductIds(client, tenant.id)
      : [];

    ok(res, result.rows.map((row) => (
      row.handle === 'all-products'
        ? { ...mapCollection(row), productIds: systemProductIds }
        : mapCollection(row)
    )));
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
    const parentId = await resolveParentId(client, tenant.id, req.body.parentId, null);
    const saved = await client.query(
      `
        INSERT INTO collections (tenant_id, handle, title, description, status, seo, parent_id)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        RETURNING *
      `,
      [
        tenant.id,
        slugify(req.body.handle || title),
        title,
        String(req.body.description || ''),
        req.body.hidden ? 'hidden' : 'active',
        JSON.stringify({ imageUrl: req.body.imageUrl || null }),
        parentId,
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
    const parentId = 'parentId' in req.body
      ? await resolveParentId(client, tenant.id, req.body.parentId, req.params.id)
      : row.parent_id;

    const isSystem = row.handle === 'all-products';
    const nextStatus = isSystem ? 'active' : ((req.body.hidden ?? row.status === 'hidden') ? 'hidden' : 'active');
    const saved = await client.query(
      `
        UPDATE collections
        SET title = $3,
            handle = $4,
            description = $5,
            status = $6,
            seo = $7::jsonb,
            parent_id = $8
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
      `,
      [
        tenant.id,
        req.params.id,
        title,
        isSystem ? 'all-products' : slugify(req.body.handle || row.handle || title),
        req.body.description ?? row.description,
        nextStatus,
        JSON.stringify({ ...(row.seo || {}), imageUrl: req.body.imageUrl ?? row.seo?.imageUrl ?? null }),
        parentId,
      ],
    );

    const ids = isSystem
      ? (await loadAllActiveProductIds(client, tenant.id))
      : Array.isArray(req.body.productIds)
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
      const current = await client.query('SELECT id, handle FROM collections WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
      if (current.rowCount === 0) return notFound(res, 'Collection not found.');
      if (current.rows[0].handle === 'all-products') {
        return validationError(res, ['The All Products collection cannot be deleted.']);
      }
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

/** Validate parentId — must belong to this tenant, not be the collection itself,
 *  not create a cycle, and must itself be a top-level collection (max 2 levels). */
async function resolveParentId(client, tenantId, parentId, selfId) {
  if (!parentId) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(String(parentId))) return null;
  if (selfId && parentId === selfId) return null;

  // Walk up the ancestor chain to detect cycles.
  if (selfId) {
    let cursor = parentId;
    const visited = new Set();
    while (cursor) {
      if (cursor === selfId) return null;
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const row = await client.query(
        'SELECT parent_id FROM collections WHERE tenant_id = $1 AND id = $2',
        [tenantId, cursor],
      );
      cursor = row.rows[0]?.parent_id ?? null;
    }
  }

  const check = await client.query(
    "SELECT id, parent_id FROM collections WHERE tenant_id = $1 AND id = $2 AND status <> 'archived'",
    [tenantId, parentId],
  );
  if (check.rowCount === 0) return null;

  // Enforce max 2 levels: the proposed parent must itself be top-level (no parent).
  if (check.rows[0].parent_id) return null;

  return parentId;
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
