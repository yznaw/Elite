const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok } = require('./lib');

const router = Router();

// Event types the storefront tracker is allowed to send. Anything else is
// dropped so a malicious or buggy client can't pollute the table with junk.
const ALLOWED_EVENT_TYPES = new Set([
  'session_start',
  'pageview',
  'click',
  'product_view',
  'add_to_cart',
  'begin_checkout',
  'search',
]);

const MAX_BATCH = 50;          // cap events per request
const MAX_STR = 512;           // trim long text fields defensively

function clamp(value, max = MAX_STR) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Public, unauthenticated ingestion endpoint for the storefront tracker.
 * Accepts a batch: { events: [{ type, sessionId, pagePath, productId, ... }] }
 * (also tolerates a single bare event object). Inserts valid rows into
 * analytics_events in one multi-row statement. Always replies 200 quickly so
 * `navigator.sendBeacon` never blocks the customer's page.
 */
router.post('/collect', asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.events)
    ? req.body.events
    : (req.body && typeof req.body === 'object' ? [req.body] : []);

  const events = raw.slice(0, MAX_BATCH).filter((e) => {
    const type = e?.eventType || e?.type;
    return type && ALLOWED_EVENT_TYPES.has(type);
  });

  if (events.length === 0) {
    return ok(res, { accepted: 0 });
  }

  const userAgent = clamp(req.get('user-agent'));

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const cols = 11; // tenant_id is fixed, the rest come per-row below
    const values = [tenant.id];
    const placeholders = events.map((e, i) => {
      const base = i * cols + 2; // $1 is tenant.id
      values.push(
        clamp(e.sessionId || e.session_id, 128),
        e.eventType || e.type,
        clamp(e.pagePath || e.page_path),
        isUuid(e.productId || e.product_id) ? (e.productId || e.product_id) : null,
        isUuid(e.collectionId || e.collection_id) ? (e.collectionId || e.collection_id) : null,
        clamp(e.locale, 8),
        userAgent,
        // Real entry referrer from the client (document.referrer); null = direct.
        // The HTTP Referer header is our own page, so it's deliberately ignored.
        clamp(e.referrer ?? e.referer),
        JSON.stringify(e.metadata && typeof e.metadata === 'object' ? e.metadata : {}),
        // occurred_at: trust client timestamp if sane, else DB now()
        Number.isFinite(e.ts) ? new Date(e.ts).toISOString() : null,
      );
      return `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, `
        + `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, `
        + `COALESCE($${base + 9}::timestamptz, now()))`;
    });

    await client.query(
      `
        INSERT INTO analytics_events (
          tenant_id, session_id, event_type, page_path, product_id,
          collection_id, locale, user_agent, referrer, metadata, occurred_at
        )
        VALUES ${placeholders.join(', ')}
      `,
      values,
    );

    ok(res, { accepted: events.length });
  } finally {
    client.release();
  }
}));

module.exports = router;
