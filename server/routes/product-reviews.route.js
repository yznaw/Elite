const { Router } = require('express');
const { asyncHandler, ok, created, notFound, validationError } = require('./lib');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');

// ── Public: POST /api/products/:id/reviews ────────────────────────────────────
const router = Router();

router.post('/:id/reviews', asyncHandler(async (req, res) => {
  const { body, rating, title, authorName, authorEmail, authorPhone, source } = req.body;

  if (!body || typeof body !== 'string' || !body.trim()) {
    return validationError(res, { body: 'A message is required.' });
  }
  if (rating !== undefined && rating !== null) {
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return validationError(res, { rating: 'Rating must be 1–5.' });
    }
  }

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const prod = await client.query(
      'SELECT id FROM products WHERE id = $1 AND tenant_id = $2',
      [req.params.id, tenant.id],
    );
    if (prod.rowCount === 0) return notFound(res, 'Product not found.');

    const result = await client.query(
      `INSERT INTO product_reviews
         (tenant_id, product_id, rating, title, body, author_name, author_email, author_phone, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [
        tenant.id,
        req.params.id,
        rating ?? null,
        title?.trim() || null,
        body.trim(),
        authorName?.trim()  || null,
        authorEmail?.trim() || null,
        authorPhone?.trim() || null,
        source === 'kiosk' ? 'kiosk' : 'storefront',
      ],
    );

    created(res, { id: result.rows[0].id, createdAt: result.rows[0].created_at });
  } finally {
    client.release();
  }
}));

// ── Admin routes ──────────────────────────────────────────────────────────────
const adminRouter = Router();

// GET /admin/reviews — products with review counts + avg rating
adminRouter.get('/reviews', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const products = await client.query(
      `SELECT
         p.id                                                        AS product_id,
         p.name                                                      AS product_name,
         COALESCE(pm.preview_url, pm.storage_url, '')               AS product_image,
         COUNT(r.id)::int                                            AS review_count,
         ROUND(AVG(r.rating)::numeric, 1)                           AS avg_rating,
         MAX(r.created_at)                                          AS latest_at
       FROM products p
       JOIN product_reviews r
         ON r.product_id = p.id AND r.tenant_id = $1
       LEFT JOIN media_assets pm ON pm.id = p.primary_media_id
       WHERE p.tenant_id = $1
       GROUP BY p.id, p.name, pm.preview_url, pm.storage_url
       ORDER BY MAX(r.created_at) DESC`,
      [tenant.id],
    );

    const totals = await client.query(
      `SELECT COUNT(*)::int                       AS total,
              ROUND(AVG(rating)::numeric, 1)      AS avg_all
       FROM product_reviews
       WHERE tenant_id = $1`,
      [tenant.id],
    );

    ok(res, {
      summary: {
        totalReviews:  totals.rows[0].total,
        avgRating:     totals.rows[0].avg_all ? Number(totals.rows[0].avg_all) : null,
        productCount:  products.rowCount,
      },
      products: products.rows.map((r) => ({
        productId:    r.product_id,
        productName:  r.product_name,
        productImage: r.product_image,
        reviewCount:   r.review_count,
        avgRating:     r.avg_rating ? Number(r.avg_rating) : null,
        latestAt:      r.latest_at,
      })),
    });
  } finally {
    client.release();
  }
}));

// GET /admin/reviews/:productId — all reviews for one product
adminRouter.get('/reviews/:productId', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const prod = await client.query(
      `SELECT p.id, p.name, COALESCE(pm.preview_url, pm.storage_url, '') AS image
       FROM products p
       LEFT JOIN media_assets pm ON pm.id = p.primary_media_id
       WHERE p.id=$1 AND p.tenant_id=$2`,
      [req.params.productId, tenant.id],
    );
    if (prod.rowCount === 0) return notFound(res, 'Product not found.');

    const reviews = await client.query(
      `SELECT id, rating, title, body,
              author_name, author_email, author_phone,
              source, created_at
       FROM product_reviews
       WHERE tenant_id=$1 AND product_id=$2
       ORDER BY created_at DESC`,
      [tenant.id, req.params.productId],
    );

    const stats = await client.query(
      `SELECT COUNT(*)::int AS count,
              ROUND(AVG(rating)::numeric,1) AS avg
       FROM product_reviews
       WHERE tenant_id=$1 AND product_id=$2`,
      [tenant.id, req.params.productId],
    );

    ok(res, {
      product: {
        id:    prod.rows[0].id,
        name:  prod.rows[0].name,
        image: prod.rows[0].image,
        reviewCount: stats.rows[0].count,
        avgRating:   stats.rows[0].avg ? Number(stats.rows[0].avg) : null,
      },
      reviews: reviews.rows.map((r) => ({
        id:          r.id,
        rating:      r.rating,
        title:       r.title,
        body:        r.body,
        authorName:  r.author_name,
        authorEmail: r.author_email,
        authorPhone: r.author_phone,
        source:      r.source || 'storefront',
        createdAt:   r.created_at,
      })),
    });
  } finally {
    client.release();
  }
}));

// DELETE /admin/reviews/:id — delete a single review
adminRouter.delete('/reviews/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'DELETE FROM product_reviews WHERE id=$1 AND tenant_id=$2 RETURNING id',
      [req.params.id, tenant.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Review not found.');
    ok(res, null, 'Review deleted.');
  } finally {
    client.release();
  }
}));

module.exports = { router, adminRouter };
