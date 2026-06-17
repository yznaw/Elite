const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

router.get('/overview', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const [metrics, traffic, funnel, top3d] = await Promise.all([
      client.query(
        `
          SELECT metric_date AS day, round(revenue_cents / 100.0)::integer AS rev, sessions, conversions, orders_count
          FROM daily_metrics
          WHERE tenant_id = $1
          ORDER BY metric_date DESC
          LIMIT 30
        `,
        [tenant.id],
      ),
      client.query(
        `
          SELECT source, sessions AS count, color,
            CASE WHEN sum(sessions) OVER () = 0 THEN 0 ELSE round((sessions::numeric / sum(sessions) OVER ()) * 100, 1) END AS pct
          FROM traffic_sources
          WHERE tenant_id = $1 AND metric_date >= current_date - interval '30 days'
          ORDER BY sessions DESC
        `,
        [tenant.id],
      ),
      client.query(
        `
          SELECT label, value, color
          FROM conversion_funnel_steps
          WHERE tenant_id = $1
          ORDER BY metric_date DESC, step_order
          LIMIT 10
        `,
        [tenant.id],
      ),
      client.query(
        `
          SELECT name AS label, views_3d AS value
          FROM products
          WHERE tenant_id = $1
          ORDER BY views_3d DESC
          LIMIT 10
        `,
        [tenant.id],
      ),
    ]);

    ok(res, {
      revenue30d: metrics.rows.reverse(),
      traffic: traffic.rows,
      funnel: funnel.rows,
      top3d: top3d.rows,
    });
  } finally {
    client.release();
  }
}));

// ── Cost & Margin Summary ─────────────────────────────────────────────────────
// Returns catalog-level KPIs + per-product margin breakdown.
// Only considers variants where total_cost_cents is not null.
router.get('/cost-summary', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const [catalog, perProduct] = await Promise.all([
      client.query(
        `
          SELECT
            COUNT(*)::integer                                             AS variants_with_cost,
            round(AVG(pv.cost_price_cents)    / 100.0, 2)::float         AS avg_cost,
            round(AVG(pv.shipping_cost_cents) / 100.0, 2)::float         AS avg_shipping,
            round(AVG(pv.total_cost_cents)    / 100.0, 2)::float         AS avg_total_cost,
            round(AVG(pv.price_cents)         / 100.0, 2)::float         AS avg_price,
            round(
              AVG(CASE WHEN pv.price_cents > 0
                THEN (pv.price_cents - pv.total_cost_cents)::numeric / pv.price_cents * 100
              END), 1
            )::float                                                      AS avg_margin_pct
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.tenant_id = $1
            AND pv.total_cost_cents IS NOT NULL
            AND pv.price_cents > 0
            AND p.status <> 'archived'
        `,
        [tenant.id],
      ),
      client.query(
        `
          SELECT
            p.id                                                                AS product_id,
            p.name,
            COUNT(pv.id)::integer                                               AS variant_count,
            round(AVG(pv.price_cents)         / 100.0, 2)::float               AS avg_price,
            round(AVG(pv.cost_price_cents)    / 100.0, 2)::float               AS avg_cost,
            round(AVG(pv.shipping_cost_cents) / 100.0, 2)::float               AS avg_shipping,
            round(AVG(pv.total_cost_cents)    / 100.0, 2)::float               AS avg_total_cost,
            round(
              AVG(CASE WHEN pv.price_cents > 0
                THEN (pv.price_cents - pv.total_cost_cents)::numeric / pv.price_cents * 100
              END), 1
            )::float                                                            AS margin_pct
          FROM products p
          JOIN product_variants pv ON pv.product_id = p.id
          WHERE p.tenant_id = $1
            AND pv.total_cost_cents IS NOT NULL
            AND pv.price_cents > 0
            AND p.status <> 'archived'
          GROUP BY p.id, p.name
          ORDER BY margin_pct ASC
        `,
        [tenant.id],
      ),
    ]);

    const c = catalog.rows[0];
    ok(res, {
      catalog: {
        variantsWithCost: c.variants_with_cost,
        avgCost:          c.avg_cost,
        avgShipping:      c.avg_shipping,
        avgTotalCost:     c.avg_total_cost,
        avgPrice:         c.avg_price,
        avgMarginPct:     c.avg_margin_pct,
      },
      products: perProduct.rows.map(r => ({
        productId:    r.product_id,
        name:         r.name,
        variantCount: r.variant_count,
        avgPrice:     r.avg_price,
        avgCost:      r.avg_cost,
        avgShipping:  r.avg_shipping,
        avgTotalCost: r.avg_total_cost,
        marginPct:    r.margin_pct,
      })),
    });
  } finally {
    client.release();
  }
}));

router.post('/events', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO analytics_events (
          tenant_id, customer_id, session_id, event_type, page_path, product_id,
          collection_id, order_id, locale, user_agent, referrer, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING id
      `,
      [
        tenant.id,
        req.body.customerId || null,
        req.body.sessionId || null,
        req.body.eventType || req.body.type || 'event',
        req.body.pagePath || null,
        req.body.productId || null,
        req.body.collectionId || null,
        req.body.orderId || null,
        req.body.locale || null,
        req.get('user-agent') || null,
        req.get('referer') || null,
        JSON.stringify(req.body.metadata || {}),
      ],
    );
    ok(res, { id: result.rows[0].id }, 'Event recorded.');
  } finally {
    client.release();
  }
}));

module.exports = router;
