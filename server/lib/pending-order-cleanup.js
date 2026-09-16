// Cancels orders that were created but never paid (e.g. the customer closed the
// tab, hit Back, or the payment gateway timed out). Runs every 30 minutes.
// Threshold is configurable via PENDING_ORDER_ABANDON_HOURS (default: 6).
const db = require('../db/client');
const { logger } = require('./logger');

const ABANDON_AFTER_HOURS = Number(process.env.PENDING_ORDER_ABANDON_HOURS || 6);
const INTERVAL_MS = 30 * 60 * 1000; // run every 30 minutes

// NOTE: 'cancelled' is NOT a member of the order_payment_status enum
// (pending | authorized | paid | failed | refunded | partially_refunded), so
// writing it threw on every single run and nothing was ever cleaned up. An
// abandoned checkout is a payment that never completed: that is 'failed'.
// The order-level status carries the 'cancelled' meaning instead.
const ABANDONED_PAYMENT_STATUS = 'failed';

async function abandonStalePendingOrders() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Never touch an order that already moved on (paid, shipped, cancelled).
    // No stock reversal is needed: stock is only decremented once an order is
    // paid, and these never were.
    const { rows } = await client.query(
      `UPDATE orders
          SET payment_status = $2::order_payment_status,
              status         = 'cancelled',
              fulfillment_status = 'cancelled',
              cancelled_at   = COALESCE(cancelled_at, NOW()),
              updated_at     = NOW()
        WHERE payment_status = 'pending'
          AND status NOT IN ('cancelled', 'completed', 'refunded', 'returned')
          AND created_at < NOW() - ($1 || ' hours')::interval
        RETURNING id, tenant_id, public_number`,
      [ABANDON_AFTER_HOURS, ABANDONED_PAYMENT_STATUS],
    );

    // Leave an audit trail so the cancellation is explainable later.
    for (const order of rows) {
      await client.query(
        `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
         VALUES ($1, $2, 'cancelled', $3, $4::jsonb)`,
        [
          order.tenant_id,
          order.id,
          `Automatically cancelled: payment never completed within ${ABANDON_AFTER_HOURS}h.`,
          JSON.stringify({ source: 'pending-order-cleanup', abandonAfterHours: ABANDON_AFTER_HOURS }),
        ],
      );
    }

    await client.query('COMMIT');

    if (rows.length > 0) {
      logger.info(
        { count: rows.length, abandonAfterHours: ABANDON_AFTER_HOURS, orders: rows.map((r) => r.public_number) },
        'pending-order-cleanup: cancelled stale unpaid orders',
      );
    }
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function startPendingOrderCleanup() {
  if (!process.env.DATABASE_URL) return;

  const run = (phase) =>
    abandonStalePendingOrders().catch((err) =>
      logger.error({ err: err.message, phase }, 'pending-order-cleanup: run failed'),
    );

  // Run once shortly after boot, then on the interval.
  setTimeout(() => void run('initial'), 60_000); // 1 minute after boot
  setInterval(() => void run('scheduled'), INTERVAL_MS);

  logger.info(
    { abandonAfterHours: ABANDON_AFTER_HOURS, intervalMinutes: INTERVAL_MS / 60000 },
    'pending-order-cleanup: scheduler started',
  );
}

module.exports = { startPendingOrderCleanup, abandonStalePendingOrders };
