const { PosError, assertPos } = require('./pos/errors');

/**
 * Per-location stock (migration 046). The single place location balances are
 * written.
 *
 * ## The model
 *
 *   product_variants.stock_quantity = SUM(variant_location_stock) - SUM(held)
 *
 * `stock_quantity` stays the sellable total that the storefront, carts,
 * restock alerts and reports already read. Every existing writer keeps
 * updating it exactly as before; when per-location stock is on it *also*
 * moves the matching location balance through this module, in the same
 * transaction. A website order is the one exception: it reduces the total at
 * payment and is recorded as a hold (no location yet) until staff approve it
 * and choose where it ships from.
 *
 * ## The switch
 *
 * `tenants.config.inventory.perLocation`. While it is off nothing here writes
 * anything and every caller behaves exactly as it did before 046.
 * `activatePerLocation` turns it on by seeding every variant's current total
 * into the warehouse in one transaction; the opening stocktake then moves
 * units to where they really are.
 *
 * ## Lock order
 *
 * Callers lock `product_variants` rows first (ordered by id), then call in
 * here, which locks location rows. Never the other way round.
 */

class LocationStockError extends PosError {}

async function perLocationEnabled(client, tenantId) {
  const { rows } = await client.query(
    `SELECT COALESCE((config->'inventory'->>'perLocation')::boolean, false) AS on
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return rows[0]?.on === true;
}

/**
 * Keep locations aligned with configured shops and guarantee one warehouse.
 * Moved here from inventory-ops-service.js so the stock writers can call it
 * without a circular require.
 */
async function syncLocations(client, tenantId) {
  await client.query(
    `INSERT INTO stocktake_locations (tenant_id, branch_id, name, location_type, sort_order)
     SELECT b.tenant_id, b.id, b.name, 'store',
            row_number() OVER (ORDER BY b.is_default DESC, b.created_at)::integer - 1
       FROM pos_branches b
      WHERE b.tenant_id = $1
     ON CONFLICT DO NOTHING`,
    [tenantId],
  );
  await client.query(
    `INSERT INTO stocktake_locations (tenant_id, name, location_type, sort_order)
     SELECT $1, 'Warehouse', 'warehouse', 100
      WHERE NOT EXISTS (
        SELECT 1 FROM stocktake_locations WHERE tenant_id = $1 AND location_type = 'warehouse'
      )`,
    [tenantId],
  );
  // A branch rename should be reflected wherever the location is shown.
  await client.query(
    `UPDATE stocktake_locations l SET name = b.name
       FROM pos_branches b
      WHERE l.tenant_id = $1 AND l.branch_id = b.id AND l.name <> b.name`,
    [tenantId],
  );
}

async function listLocations(client, tenantId) {
  const { rows } = await client.query(
    `SELECT id, branch_id, name, location_type, sort_order
       FROM stocktake_locations
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY sort_order, name`,
    [tenantId],
  );
  return rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    type: row.location_type,
  }));
}

/** The warehouse: where untargeted stock goes (catalog edits, imports, activation). */
async function defaultLocationId(client, tenantId) {
  let { rows } = await client.query(
    `SELECT id FROM stocktake_locations WHERE tenant_id = $1 AND location_type = 'warehouse' LIMIT 1`,
    [tenantId],
  );
  if (!rows.length) {
    await syncLocations(client, tenantId);
    ({ rows } = await client.query(
      `SELECT id FROM stocktake_locations WHERE tenant_id = $1 AND location_type = 'warehouse' LIMIT 1`,
      [tenantId],
    ));
  }
  return rows[0].id;
}

/** The store location for a POS branch (created on first use for a new branch). */
async function locationForBranch(client, tenantId, branchId) {
  if (!branchId) return defaultLocationId(client, tenantId);
  const find = () => client.query(
    `SELECT id FROM stocktake_locations WHERE tenant_id = $1 AND branch_id = $2 LIMIT 1`,
    [tenantId, branchId],
  );
  let { rows } = await find();
  if (!rows.length) {
    await syncLocations(client, tenantId);
    ({ rows } = await find());
  }
  assertPos(rows.length === 1, 409, 'LOCATION_NOT_FOUND', 'This branch has no stock location.');
  return rows[0].id;
}

/** Validates that a location id from a request belongs to this tenant. */
async function requireLocation(client, tenantId, locationId) {
  const { rows } = await client.query(
    `SELECT id, name, location_type FROM stocktake_locations
      WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
    [tenantId, locationId],
  );
  assertPos(rows.length === 1, 404, 'LOCATION_NOT_FOUND', 'That stock location does not exist.');
  return { id: rows[0].id, name: rows[0].name, type: rows[0].location_type };
}

/** Locks (creating at 0 if missing) and returns one location balance. */
async function lockLocationQuantity(client, tenantId, variantId, locationId) {
  await client.query(
    `INSERT INTO variant_location_stock (tenant_id, variant_id, location_id, quantity)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (variant_id, location_id) DO NOTHING`,
    [tenantId, variantId, locationId],
  );
  const { rows } = await client.query(
    `SELECT quantity FROM variant_location_stock
      WHERE variant_id = $1 AND location_id = $2
      FOR UPDATE`,
    [variantId, locationId],
  );
  return Number(rows[0].quantity);
}

/**
 * Moves one location balance by `delta`. Does NOT touch stock_quantity: the
 * caller owns the total, exactly as before 046.
 *
 * `strict`: refuse (409) when the location cannot cover a negative delta.
 * Otherwise the balance floors at zero (offline POS sales, which must never
 * be rejected after the customer has left) and the shortfall is returned.
 */
async function applyLocationDelta(client, tenantId, { variantId, locationId, delta, strict = true, sku = null }) {
  const before = await lockLocationQuantity(client, tenantId, variantId, locationId);
  let after = before + delta;
  let shortage = 0;
  if (after < 0) {
    if (strict) {
      throw new LocationStockError(409, 'LOCATION_INSUFFICIENT_STOCK',
        `${sku || 'This item'} has only ${before} at this location.`,
        { variantId, locationId, available: before });
    }
    shortage = -after;
    after = 0;
  }
  if (after !== before) {
    await client.query(
      `UPDATE variant_location_stock SET quantity = $3, updated_at = now()
        WHERE variant_id = $1 AND location_id = $2`,
      [variantId, locationId, after],
    );
  }
  return { locationId, before, after, applied: after - before, shortage };
}

/** Balances per location for a set of variants, plus the unallocated holds. */
async function getAvailability(client, tenantId, variantIds) {
  const result = new Map(variantIds.map((id) => [id, { held: 0, locations: {} }]));
  if (!variantIds.length) return result;
  const balances = await client.query(
    `SELECT variant_id, location_id, quantity FROM variant_location_stock
      WHERE tenant_id = $1 AND variant_id = ANY($2::uuid[]) AND quantity > 0`,
    [tenantId, variantIds],
  );
  for (const row of balances.rows) result.get(row.variant_id).locations[row.location_id] = Number(row.quantity);
  const holds = await client.query(
    `SELECT variant_id, sum(quantity)::int AS held FROM order_stock_holds
      WHERE tenant_id = $1 AND variant_id = ANY($2::uuid[]) AND status = 'held'
      GROUP BY variant_id`,
    [tenantId, variantIds],
  );
  for (const row of holds.rows) result.get(row.variant_id).held = Number(row.held);
  return result;
}

// ── Web-order holds ─────────────────────────────────────────────────────────

async function addHold(client, tenantId, { orderId, variantId, quantity }) {
  if (!variantId || quantity <= 0) return;
  await client.query(
    `INSERT INTO order_stock_holds (tenant_id, order_id, variant_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id, variant_id)
       DO UPDATE SET quantity = order_stock_holds.quantity + EXCLUDED.quantity`,
    [tenantId, orderId, variantId, quantity],
  );
}

/**
 * Undoes an order's holds when it is cancelled/refunded. Held units simply
 * stop being held (the caller adds the total back); allocated units go back
 * to the location they were taken from. Returns, per variant, how many units
 * each path covered so the caller can place any remainder.
 *
 * Callers must already hold the variant row locks (lock order).
 */
async function releaseOrderHolds(client, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT id, variant_id, quantity, status, location_id FROM order_stock_holds
      WHERE tenant_id = $1 AND order_id = $2 AND status IN ('held', 'allocated')
      ORDER BY variant_id
      FOR UPDATE`,
    [tenantId, orderId],
  );
  const byVariant = new Map();
  for (const hold of rows) {
    const entry = byVariant.get(hold.variant_id) || { held: 0, allocated: 0, locationId: null };
    if (hold.status === 'allocated') {
      await applyLocationDelta(client, tenantId, {
        variantId: hold.variant_id, locationId: hold.location_id, delta: Number(hold.quantity),
      });
      entry.allocated += Number(hold.quantity);
      entry.locationId = hold.location_id;
    } else {
      entry.held += Number(hold.quantity);
    }
    byVariant.set(hold.variant_id, entry);
    await client.query(
      `UPDATE order_stock_holds SET status = 'released', released_at = now() WHERE id = $1`,
      [hold.id],
    );
  }
  return byVariant;
}

// ── Switch and integrity ────────────────────────────────────────────────────

/**
 * Variants whose sellable total disagrees with their locations and holds.
 * Only meaningful while per-location stock is on. Alert-only: an offline POS
 * sale that oversold is the one legitimate way to land here, and it is
 * already recorded as a sync conflict.
 */
async function findLocationDrift(client, tenantId, limit = 50) {
  const { rows } = await client.query(
    `SELECT pv.id AS variant_id, pv.sku, pv.stock_quantity,
            COALESCE(l.total, 0)::int AS location_total,
            COALESCE(h.held, 0)::int AS held
       FROM product_variants pv
       LEFT JOIN (
         SELECT variant_id, sum(quantity) AS total FROM variant_location_stock
          WHERE tenant_id = $1 GROUP BY variant_id
       ) l ON l.variant_id = pv.id
       LEFT JOIN (
         SELECT variant_id, sum(quantity) AS held FROM order_stock_holds
          WHERE tenant_id = $1 AND status = 'held' GROUP BY variant_id
       ) h ON h.variant_id = pv.id
      WHERE pv.tenant_id = $1
        AND pv.stock_quantity <> COALESCE(l.total, 0) - COALESCE(h.held, 0)
      ORDER BY pv.sku
      LIMIT $2`,
    [tenantId, limit],
  );
  return rows.map((row) => ({
    variantId: row.variant_id,
    sku: row.sku,
    stock: Number(row.stock_quantity),
    locationTotal: row.location_total,
    held: row.held,
  }));
}

/**
 * Turns per-location stock on: every variant's current total goes into the
 * warehouse, in one transaction, under a lock on the tenant row so no two
 * activations interleave. Stock writers that run concurrently still hold
 * their own variant locks and either finish before (their change is in the
 * snapshot) or after (they see the flag and write the location). The
 * go-live runbook still freezes selling for the switch.
 */
async function activatePerLocation(client, context) {
  const tenant = await client.query('SELECT config FROM tenants WHERE id = $1 FOR UPDATE', [context.tenantId]);
  assertPos(tenant.rowCount === 1, 404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  if (tenant.rows[0].config?.inventory?.perLocation === true) return { alreadyOn: true, seeded: 0 };

  await syncLocations(client, context.tenantId);
  const warehouseId = await defaultLocationId(client, context.tenantId);

  // Lock every variant, ordered like every other writer, so the snapshot is
  // consistent with the totals it copies.
  await client.query(
    'SELECT id FROM product_variants WHERE tenant_id = $1 ORDER BY id FOR UPDATE',
    [context.tenantId],
  );
  // A previous activation's balances are stale by definition.
  await client.query('DELETE FROM variant_location_stock WHERE tenant_id = $1', [context.tenantId]);
  // Holds from a previous activation no longer mean anything either: the
  // totals they reduced are the snapshot now.
  await client.query(
    `UPDATE order_stock_holds SET status = 'released', released_at = now()
      WHERE tenant_id = $1 AND status = 'held'`,
    [context.tenantId],
  );
  const seeded = await client.query(
    `INSERT INTO variant_location_stock (tenant_id, variant_id, location_id, quantity)
     SELECT tenant_id, id, $2, stock_quantity FROM product_variants
      WHERE tenant_id = $1 AND stock_quantity > 0`,
    [context.tenantId, warehouseId],
  );
  await client.query(
    `UPDATE tenants
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{inventory}',
              COALESCE(config->'inventory', '{}'::jsonb) || '{"perLocation": true}'::jsonb, true)
      WHERE id = $1`,
    [context.tenantId],
  );
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, after_state, ip_address, user_agent, request_id)
     VALUES ($1, $2, 'inventory.per_location.activate', 'tenant', $1, $3::jsonb, $4, $5, $6)`,
    [context.tenantId, context.userId || null, JSON.stringify({ warehouseId, seededVariants: seeded.rowCount }),
      context.ip || null, context.userAgent || null, context.requestId || null],
  );
  return { alreadyOn: false, seeded: seeded.rowCount, warehouseId };
}

/**
 * Emergency switch back to one shared figure. Balances stay in the table but
 * stop being maintained; a later activation rebuilds them from the totals.
 */
async function deactivatePerLocation(client, context) {
  await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [context.tenantId]);
  await client.query(
    `UPDATE tenants
        SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{inventory}',
              COALESCE(config->'inventory', '{}'::jsonb) || '{"perLocation": false}'::jsonb, true)
      WHERE id = $1`,
    [context.tenantId],
  );
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, after_state, ip_address, user_agent, request_id)
     VALUES ($1, $2, 'inventory.per_location.deactivate', 'tenant', $1, '{}'::jsonb, $3, $4, $5)`,
    [context.tenantId, context.userId || null, context.ip || null, context.userAgent || null, context.requestId || null],
  );
}

/**
 * Guard for writers not yet converted to location-aware input. While the
 * switch is on they must not change the total without saying which location,
 * or the balances drift. Converted in plan Phase 3.
 */
async function assertTotalOnlyWriteAllowed(client, tenantId, what) {
  if (await perLocationEnabled(client, tenantId)) {
    throw new LocationStockError(409, 'LOCATION_REQUIRED',
      `Stock is tracked per location now. ${what} must say which location to change.`);
  }
}

module.exports = {
  LocationStockError,
  perLocationEnabled,
  syncLocations,
  listLocations,
  defaultLocationId,
  locationForBranch,
  requireLocation,
  lockLocationQuantity,
  applyLocationDelta,
  getAvailability,
  addHold,
  releaseOrderHolds,
  findLocationDrift,
  activatePerLocation,
  deactivatePerLocation,
  assertTotalOnlyWriteAllowed,
};
