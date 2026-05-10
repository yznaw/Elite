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
