const db = require('../../db/client');
const { logger } = require('../logger');
const { sendAlert, isTestTenant } = require('../alerts');

const INTERVAL_MS = 5 * 60 * 1000;   // check every 5 minutes
const STUCK_AFTER_MS = 15 * 60 * 1000; // pending and unchanged for 15 minutes

/**
 * Watches for a register whose offline sale queue has stopped draining.
 *
 * Why this matters more than it looks: an offline sale is real cash already
 * in the drawer, and until it syncs the only record of it is the register's
 * own IndexedDB. The POS UI already shows a pending count to the cashier, but
 * nobody outside the shop can see it. A register left with pending sales
 * overnight, or one whose browser profile is later wiped, is exactly the
 * scenario that loses money with no trail.
 *
 * Reads `pos_sync_states`, which the client already maintains via
 * `PUT /api/pos/sync-state` (the same rows the shift-close gate trusts) — no
 * new client work and no new table. Two conditions raise an alert:
 *   - pending_count > 0 and the register has not reported in for 15+ minutes
 *     (either the queue is stuck, or the terminal went away entirely)
 *   - rejected_count > 0 at all: a rejected sale never resolves itself and
 *     blocks shift close until a human deals with it.
 */
const STUCK_QUERY = `
  SELECT s.tenant_id,
         t.slug AS tenant_slug,
         s.register_id,
         r.display_name AS register_name,
         s.shift_id,
         s.pending_count,
         s.rejected_count,
         s.last_reported_at,
         EXTRACT(EPOCH FROM (now() - s.last_reported_at))::bigint AS stale_seconds
  FROM pos_sync_states s
  JOIN tenants t ON t.id = s.tenant_id
  JOIN pos_registers r ON r.id = s.register_id
  JOIN pos_shifts sh ON sh.id = s.shift_id AND sh.state = 'open'
  WHERE s.rejected_count > 0
     OR (s.pending_count > 0 AND s.last_reported_at < now() - ($1::bigint * interval '1 millisecond'))
`;

async function findStuckQueues() {
  const { rows } = await db.pool.query(STUCK_QUERY, [STUCK_AFTER_MS]);
  return rows;
}

async function runQueueWatch() {
  const stuck = await findStuckQueues();
  for (const row of stuck) {
    const staleMinutes = Math.round(Number(row.stale_seconds || 0) / 60);
    logger.warn(
      {
        tenant: row.tenant_slug,
        registerId: row.register_id,
        shiftId: row.shift_id,
        pendingCount: row.pending_count,
        rejectedCount: row.rejected_count,
        staleMinutes,
      },
      'offline sale queue is not draining',
    );
    // A disposable test tenant deliberately parks sales in the offline queue;
    // that is the browser gate working, not an incident worth an email.
    if (isTestTenant(row.tenant_slug)) continue;

    // Keyed per register so two registers alert independently, but one
    // register cannot email every 5 minutes for hours.
    await sendAlert(
      `offline-queue-stuck:${row.register_id}`,
      `Register "${row.register_name}" has unsynced sales`,
      `Register: ${row.register_name}\n`
      + `Pending offline sales: ${row.pending_count}\n`
      + `Rejected offline sales: ${row.rejected_count}\n`
      + `Last reported by the terminal: ${staleMinutes} minute(s) ago\n\n`
      + 'Unsynced sales exist only in that terminal\'s browser storage until they reach the server. '
      + 'Check the register is on, online, and signed in. Do not clear its browser data.',
    );
  }
  return stuck.length;
}

function startQueueWatchJob() {
  if (!process.env.DATABASE_URL) return () => {};

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    runQueueWatch().catch((err) => logger.warn({ err: err.message }, 'queue watch run failed'));
  };

  // Staggered so it does not collide with the inventory consistency job's own
  // boot-time run (90s) or with migration work still finishing.
  const initialTimer = setTimeout(tick, 120_000);
  initialTimer.unref();
  const intervalTimer = setInterval(tick, INTERVAL_MS);
  intervalTimer.unref();

  logger.info('[queue-watch] Scheduler started — checks for stuck offline sale queues every 5 minutes');

  return function stopQueueWatchJob() {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}

module.exports = { startQueueWatchJob, runQueueWatch, findStuckQueues, STUCK_AFTER_MS };
