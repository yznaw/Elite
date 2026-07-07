// Cancels orders that were created but never paid (e.g. the customer closed the
// tab, hit Back, or the payment gateway timed out). Runs every 30 minutes.
// Threshold is configurable via PENDING_ORDER_ABANDON_HOURS (default: 6).
const db = require('../db/client');

const ABANDON_AFTER_HOURS = Number(process.env.PENDING_ORDER_ABANDON_HOURS || 6);
const INTERVAL_MS = 30 * 60 * 1000; // run every 30 minutes

async function abandonStalePendingOrders() {
  const { rowCount } = await db.pool.query(
    `UPDATE orders
        SET payment_status = 'cancelled',
            updated_at     = NOW()
      WHERE payment_status = 'pending'
        AND created_at < NOW() - ($1 || ' hours')::interval`,
    [ABANDON_AFTER_HOURS],
  );

  if (rowCount > 0) {
    console.log(`[pending-cleanup] Cancelled ${rowCount} stale pending order(s) older than ${ABANDON_AFTER_HOURS}h`);
  }
}

function startPendingOrderCleanup() {
  if (!process.env.DATABASE_URL) return;

  // Run once shortly after boot, then on the interval.
  setTimeout(() => {
    abandonStalePendingOrders().catch((err) =>
      console.warn('[pending-cleanup] Initial run failed:', err.message),
    );
  }, 60_000); // 1 minute after boot

  setInterval(() => {
    abandonStalePendingOrders().catch((err) =>
      console.warn('[pending-cleanup] Scheduled run failed:', err.message),
    );
  }, INTERVAL_MS);

  console.log(`[pending-cleanup] Scheduler started — abandons pending orders after ${ABANDON_AFTER_HOURS}h, runs every 30 min`);
}

module.exports = { startPendingOrderCleanup, abandonStalePendingOrders };
