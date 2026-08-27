const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

// Maps the UI range keys to a Postgres interval string.
const RANGE_INTERVALS = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '365 days',
};

// Stable palette for the event-type pie chart.
const EVENT_COLORS = ['#C8A35B', '#2F6F5E', '#5B8DEF', '#E07A5F', '#9B59B6', '#7F8C8D', '#16A085', '#D35400'];

/**
 * Real storefront analytics computed live from the `analytics_events` table
 * (the rows the public /api/analytics/collect endpoint ingests). Returns KPIs,
 * a daily time series, and top-N breakdowns shaped for the admin chart widgets.
 */
router.get('/storefront', asyncHandler(async (req, res) => {
  const interval = RANGE_INTERVALS[req.query.range] || RANGE_INTERVALS['30d'];
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const args = [tenant.id, interval];

    const [kpis, series, topPages, topClicks, topProducts, eventTypes, financial, revenueSeries, traffic] = await Promise.all([
      client.query(
        `
          SELECT
            count(DISTINCT metadata->>'visitorId')                  AS visitors,
            count(DISTINCT session_id)                              AS sessions,
            count(*) FILTER (WHERE event_type = 'pageview')         AS pageviews,
            count(*) FILTER (WHERE event_type = 'click')            AS clicks,
            count(*)                                                AS events
          FROM analytics_events
          WHERE tenant_id = $1 AND occurred_at >= now() - $2::interval
        `,
        args,
      ),
      client.query(
        `
          SELECT date_trunc('day', occurred_at)::date           AS day,
                 count(DISTINCT session_id)                      AS sessions,
                 count(*) FILTER (WHERE event_type = 'click')    AS clicks,
                 count(*) FILTER (WHERE event_type = 'pageview') AS pageviews
          FROM analytics_events
          WHERE tenant_id = $1 AND occurred_at >= now() - $2::interval
          GROUP BY 1
          ORDER BY 1
        `,
        args,
      ),
      client.query(
        `
          SELECT COALESCE(NULLIF(page_path, ''), '(unknown)') AS label, count(*)::int AS value
          FROM analytics_events
          WHERE tenant_id = $1 AND event_type = 'pageview' AND occurred_at >= now() - $2::interval
          GROUP BY 1 ORDER BY value DESC LIMIT 8
        `,
        args,
      ),
      client.query(
        `
          SELECT COALESCE(NULLIF(metadata->>'label', ''), '(unlabeled)') AS label, count(*)::int AS value
          FROM analytics_events
          WHERE tenant_id = $1 AND event_type = 'click' AND occurred_at >= now() - $2::interval
          GROUP BY 1 ORDER BY value DESC LIMIT 8
        `,
        args,
      ),
      client.query(
        `
          SELECT p.name AS label, count(*)::int AS value
          FROM analytics_events e
          JOIN products p ON p.id = e.product_id
          WHERE e.tenant_id = $1 AND e.product_id IS NOT NULL AND e.occurred_at >= now() - $2::interval
          GROUP BY p.name ORDER BY value DESC LIMIT 8
        `,
        args,
      ),
      client.query(
        `
          SELECT event_type AS source, count(*)::int AS count
          FROM analytics_events
          WHERE tenant_id = $1 AND occurred_at >= now() - $2::interval
          GROUP BY event_type ORDER BY count DESC
        `,
        args,
      ),
      // ── Real financial figures from the orders table ───────────────────
      client.query(
        `
          SELECT
            COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'paid'), 0)::bigint AS revenue_cents,
            COUNT(*) FILTER (WHERE payment_status = 'paid')::int                          AS paid_orders,
            COUNT(*)::int                                                                 AS total_orders
          FROM orders
          WHERE tenant_id = $1 AND COALESCE(paid_at, created_at) >= now() - $2::interval
        `,
        args,
      ),
      client.query(
        `
          SELECT date_trunc('day', COALESCE(paid_at, created_at))::date AS day,
                 ROUND(COALESCE(SUM(total_cents), 0) / 100.0)::int       AS revenue
          FROM orders
          WHERE tenant_id = $1 AND payment_status = 'paid'
            AND COALESCE(paid_at, created_at) >= now() - $2::interval
          GROUP BY 1 ORDER BY 1
        `,
        args,
      ),
      // ── Traffic sources, bucketed from the entry referrer ──────────────
      client.query(
        `
          SELECT bucket AS source, count(*)::int AS count
          FROM (
            SELECT CASE
              WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
              WHEN referrer ~* '(google|bing|yahoo|duckduckgo|ecosia|baidu)\\.' THEN 'Search'
              WHEN referrer ~* '(instagram|facebook|fb\\.com|tiktok|twitter|t\\.co|snapchat|linkedin|pinterest|youtube|whatsapp)' THEN 'Social'
              ELSE 'Referral'
            END AS bucket
            FROM analytics_events
            WHERE tenant_id = $1 AND event_type = 'session_start'
              AND occurred_at >= now() - $2::interval
          ) s
          GROUP BY bucket ORDER BY count DESC
        `,
        args,
      ),
    ]);

    const k = kpis.rows[0] || {};
    const visitors = Number(k.visitors || 0);
    const sessions = Number(k.sessions || 0);
    const clicks = Number(k.clicks || 0);
    const pageviews = Number(k.pageviews || 0);
    const events = Number(k.events || 0);

    const totalEvents = eventTypes.rows.reduce((sum, r) => sum + Number(r.count), 0) || 1;
    const eventBreakdown = eventTypes.rows.map((r, i) => ({
      source: r.source,
      count: Number(r.count),
      pct: Math.round((Number(r.count) / totalEvents) * 1000) / 10,
      color: EVENT_COLORS[i % EVENT_COLORS.length],
    }));

    // Real financial figures from orders.
    const fin = financial.rows[0] || {};
    const revenue = Math.round(Number(fin.revenue_cents || 0) / 100);
    const paidOrders = Number(fin.paid_orders || 0);
    const totalOrders = Number(fin.total_orders || 0);

    // Traffic sources, percentaged and coloured for the pie + legend.
    const totalTraffic = traffic.rows.reduce((sum, r) => sum + Number(r.count), 0) || 1;
    const trafficBreakdown = traffic.rows.map((r, i) => ({
      source: r.source,
      count: Number(r.count),
      pct: Math.round((Number(r.count) / totalTraffic) * 1000) / 10,
      color: EVENT_COLORS[i % EVENT_COLORS.length],
    }));

    ok(res, {
      kpis: {
        visitors,
        sessions,
        pageviews,
        clicks,
        events,
        pagesPerSession: sessions ? Math.round((pageviews / sessions) * 10) / 10 : 0,
      },
      financial: {
        revenue,
        orders: paidOrders,
        totalOrders,
        aov: paidOrders ? Math.round(revenue / paidOrders) : 0,
        // Conversion = paid orders ÷ tracked sessions (now genuinely meaningful).
        conversionRate: sessions ? Math.round((paidOrders / sessions) * 1000) / 10 : 0,
      },
      series: series.rows.map((r) => ({
        day: r.day,
        sessions: Number(r.sessions),
        clicks: Number(r.clicks),
        pageviews: Number(r.pageviews),
      })),
      revenueSeries: revenueSeries.rows.map((r) => ({ day: r.day, revenue: Number(r.revenue) })),
      topPages: topPages.rows,
      topClicks: topClicks.rows,
      topProducts: topProducts.rows,
      eventTypes: eventBreakdown,
      traffic: trafficBreakdown,
    });
  } finally {
    client.release();
  }
}));

router.get('/overview', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const [metrics, traffic, funnel] = await Promise.all([
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
    ]);

    ok(res, {
      revenue30d: metrics.rows.reverse(),
      traffic: traffic.rows,
      funnel: funnel.rows,
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

// ── Shipping Cost Report ──────────────────────────────────────────────────────
// Every non-archived product with its shipping-cost coverage, including the
// ones that have none recorded.
//
// This is deliberately different from /cost-summary, which inner-joins on
// `total_cost_cents IS NOT NULL` and so hides exactly the products the shop
// owner needs to find — the ones still missing a shipping cost. Here the join
// is a LEFT JOIN and a product with no cost at all still comes back, with
// nulls, so the gap is visible instead of silently excluded.
router.get('/shipping-costs', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const [coverage, perProduct] = await Promise.all([
      client.query(
        `
          SELECT
            COUNT(*)::int                                                          AS total_variants,
            COUNT(*) FILTER (WHERE pv.shipping_cost_cents IS NOT NULL)::int        AS with_shipping,
            COUNT(*) FILTER (WHERE pv.shipping_cost_cents IS NULL)::int            AS without_shipping,
            round(AVG(pv.shipping_cost_cents) / 100.0, 2)::float                   AS avg_shipping,
            COALESCE(SUM(pv.shipping_cost_cents), 0)::bigint                       AS total_shipping_cents
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.tenant_id = $1 AND p.status <> 'archived'
        `,
        [tenant.id],
      ),
      client.query(
        `
          SELECT
            p.id                                                                   AS product_id,
            p.name,
            p.sku,
            COUNT(pv.id)::int                                                      AS variant_count,
            COUNT(pv.shipping_cost_cents)::int                                     AS variants_with_shipping,
            round(AVG(pv.shipping_cost_cents) / 100.0, 2)::float                   AS avg_shipping,
            round(MIN(pv.shipping_cost_cents) / 100.0, 2)::float                   AS min_shipping,
            round(MAX(pv.shipping_cost_cents) / 100.0, 2)::float                   AS max_shipping,
            round(AVG(pv.cost_price_cents)    / 100.0, 2)::float                   AS avg_cost,
            round(AVG(pv.price_cents)         / 100.0, 2)::float                   AS avg_price
          FROM products p
          JOIN product_variants pv ON pv.product_id = p.id
          WHERE p.tenant_id = $1 AND p.status <> 'archived'
          GROUP BY p.id, p.name, p.sku
          -- Products missing shipping data first: that is the list to act on.
          ORDER BY (COUNT(pv.shipping_cost_cents) = 0) DESC,
                   (COUNT(pv.id) - COUNT(pv.shipping_cost_cents)) DESC,
                   p.name
        `,
        [tenant.id],
      ),
    ]);

    const c = coverage.rows[0] || {};
    const totalVariants = Number(c.total_variants || 0);
    const withShipping = Number(c.with_shipping || 0);

    ok(res, {
      coverage: {
        totalVariants,
        withShipping,
        withoutShipping: Number(c.without_shipping || 0),
        coveragePct: totalVariants ? Math.round((withShipping / totalVariants) * 1000) / 10 : 0,
        avgShipping: c.avg_shipping,
        totalShipping: Math.round(Number(c.total_shipping_cents || 0)) / 100,
      },
      products: perProduct.rows.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        variantCount: r.variant_count,
        variantsWithShipping: r.variants_with_shipping,
        avgShipping: r.avg_shipping,
        minShipping: r.min_shipping,
        maxShipping: r.max_shipping,
        avgCost: r.avg_cost,
        avgPrice: r.avg_price,
      })),
    });
  } finally {
    client.release();
  }
}));

// ── Profit Summary ────────────────────────────────────────────────────────────
// Revenue minus cost of goods sold minus operating expenses, over the same
// range keys the rest of the page uses.
//
// Note this is a different (and truer) figure than /cost-summary above:
// /cost-summary averages catalogue margin percentages across variants, which
// says how profitable the products *could* be. This computes COGS from what
// actually sold, and then subtracts real operating expenses on top.
router.get('/profit-summary', asyncHandler(async (req, res) => {
  const interval = RANGE_INTERVALS[req.query.range] || RANGE_INTERVALS['30d'];
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const args = [tenant.id, interval];

    const [revenue, cogs, expenses] = await Promise.all([
      client.query(
        `
          SELECT COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'paid'), 0)::bigint AS revenue_cents
          FROM orders
          WHERE tenant_id = $1 AND COALESCE(paid_at, created_at) >= now() - $2::interval
        `,
        args,
      ),
      // Cost of goods actually sold. Line items whose variant was deleted, or
      // whose variant never had a cost entered, contribute 0 to COGS but are
      // counted so the UI can warn that coverage is partial.
      client.query(
        `
          SELECT
            COALESCE(SUM(oi.quantity * pv.total_cost_cents), 0)::bigint            AS cogs_cents,
            COUNT(*)::int                                                          AS line_items,
            COUNT(*) FILTER (WHERE pv.total_cost_cents IS NULL)::int               AS line_items_without_cost
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE o.tenant_id = $1
            AND o.payment_status = 'paid'
            AND COALESCE(o.paid_at, o.created_at) >= now() - $2::interval
        `,
        args,
      ),
      // Mirrors the recurrence expansion in admin-expenses.route.js so a
      // recurring bill counts once per period inside the window.
      client.query(
        `
          WITH occ AS (
            SELECT e.*, g.d::date AS occurrence_date
            FROM expenses e
            CROSS JOIN LATERAL generate_series(
              e.expense_date::timestamp,
              now()::timestamp,
              CASE e.recurrence
                WHEN 'monthly' THEN interval '1 month'
                WHEN 'yearly'  THEN interval '1 year'
                ELSE interval '1000 years'
              END
            ) AS g(d)
            WHERE e.tenant_id = $1 AND e.expense_date <= now()::date
          ),
          expanded AS (
            SELECT occ.* FROM occ
            WHERE occ.occurrence_date >= (now() - $2::interval)::date
              AND NOT EXISTS (
                SELECT 1 FROM expenses child
                WHERE child.tenant_id = occ.tenant_id
                  AND child.recurrence_parent_id = occ.id
                  AND child.expense_date = occ.occurrence_date
              )
          )
          SELECT category,
                 COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
          FROM expanded
          GROUP BY category
          ORDER BY total_cents DESC
        `,
        args,
      ),
    ]);

    const revenueCents = Number(revenue.rows[0]?.revenue_cents || 0);
    const cogsRow = cogs.rows[0] || {};
    const cogsCents = Number(cogsRow.cogs_cents || 0);
    const expenseRows = expenses.rows;
    const expensesCents = expenseRows.reduce((sum, r) => sum + Number(r.total_cents), 0);

    const toQar = (cents) => Math.round(Number(cents || 0)) / 100;
    const totalExpenses = expensesCents;

    ok(res, {
      revenue:   toQar(revenueCents),
      cogs:      toQar(cogsCents),
      expenses:  toQar(expensesCents),
      netProfit: toQar(revenueCents - cogsCents - expensesCents),
      // Net margin against revenue, one decimal, matching the rest of the page.
      netMarginPct: revenueCents
        ? Math.round(((revenueCents - cogsCents - expensesCents) / revenueCents) * 1000) / 10
        : 0,
      // Lets the UI say "cost data missing for N items" instead of quietly
      // overstating profit.
      cogsCoverage: {
        lineItems: Number(cogsRow.line_items || 0),
        lineItemsWithoutCost: Number(cogsRow.line_items_without_cost || 0),
      },
      expensesByCategory: expenseRows.map((r, i) => ({
        category: r.category,
        total: toQar(r.total_cents),
        pct: totalExpenses ? Math.round((Number(r.total_cents) / totalExpenses) * 1000) / 10 : 0,
        color: EVENT_COLORS[i % EVENT_COLORS.length],
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
