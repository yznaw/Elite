// Compares each variant's current stock_quantity against its recorded
// baseline (pos_inventory_baselines, migration 020) plus the sum of every
// inventory_movements delta since. A non-zero drift means stock changed
// through a path that doesn't write to the ledger (a direct catalog edit,
// a bug, a migration) — this only reports drift, it never repairs
// anything automatically, since only a human with the real sales history
// can judge what the correct value should be.
const db = require('../../db/client');

const INTERVAL_MS = 60 * 60 * 1000; // run hourly

const DRIFT_QUERY = `
  SELECT
    pv.tenant_id,
    pv.id AS variant_id,
    pv.sku,
    pv.stock_quantity AS current_stock,
    b.baseline_stock,
    COALESCE(SUM(im.delta), 0)::integer AS ledger_delta_total,
    COUNT(im.id)::integer AS movement_count,
    pv.stock_quantity - b.baseline_stock - COALESCE(SUM(im.delta), 0)::integer AS drift
  FROM pos_inventory_baselines b
  JOIN product_variants pv ON pv.id = b.variant_id AND pv.tenant_id = b.tenant_id
  LEFT JOIN inventory_movements im ON im.variant_id = b.variant_id AND im.tenant_id = b.tenant_id
  WHERE b.tenant_id = $1
  GROUP BY pv.tenant_id, pv.id, pv.sku, pv.stock_quantity, b.baseline_stock
  HAVING pv.stock_quantity - b.baseline_stock - COALESCE(SUM(im.delta), 0)::integer != 0
`;

/** Returns every variant with a captured baseline whose current stock
 *  doesn't reconcile against baseline + ledger deltas, for one tenant. */
async function findDrift(tenantId) {
  const { rows } = await db.pool.query(DRIFT_QUERY, [tenantId]);
  return rows;
}

async function runConsistencyCheck() {
  const tenants = await db.pool.query('SELECT id, slug FROM tenants WHERE is_active = true');
  for (const tenant of tenants.rows) {
    const drifted = await findDrift(tenant.id);
    if (drifted.length > 0) {
      console.warn(
        `[inventory-consistency] tenant=${tenant.slug}: ${drifted.length} variant(s) with stock drift ` +
        '(current stock does not match baseline + ledger history — likely a stock change that bypassed the ledger):',
        drifted.map((r) => `${r.sku}: current=${r.current_stock} baseline=${r.baseline_stock} ledgerDelta=${r.ledger_delta_total} drift=${r.drift}`),
      );
    }
  }
}

function startInventoryConsistencyJob() {
  if (!process.env.DATABASE_URL) return () => {};

  let stopped = false;

  const initialTimer = setTimeout(() => {
    if (stopped) return;
    runConsistencyCheck().catch((err) =>
      console.warn('[inventory-consistency] Initial run failed:', err.message),
    );
  }, 90_000); // stagger after other boot-time jobs
  initialTimer.unref();

  const intervalTimer = setInterval(() => {
    if (stopped) return;
    runConsistencyCheck().catch((err) =>
      console.warn('[inventory-consistency] Scheduled run failed:', err.message),
    );
  }, INTERVAL_MS);
  intervalTimer.unref();

  console.log('[inventory-consistency] Scheduler started — checks stock-vs-ledger drift hourly');

  return function stopInventoryConsistencyJob() {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}

module.exports = { startInventoryConsistencyJob, runConsistencyCheck, findDrift };
