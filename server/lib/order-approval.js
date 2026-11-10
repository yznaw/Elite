const db = require('../db/client');
const { recordMovement } = require('./inventory-ledger');
const { PosError, assertPos, uuid } = require('./pos/errors');
const {
  perLocationEnabled, listLocations, requireLocation, lockLocationQuantity, applyLocationDelta, getAvailability,
} = require('./location-stock');

/**
 * Website-order approval (plan Phase 5), only while stock per location is on.
 *
 * A paid website order reduces the sellable total and is *held*
 * (order-stock.js) because nobody has chosen where it ships from yet. Staff
 * approve it and pick ONE pickup location; every item must be there (move
 * missing items with a transfer first). Approval then deducts that location,
 * marks the holds allocated, confirms the order, and (after commit, in the
 * route) books the courier and emails the customer.
 *
 * Ledger: the hold was already recorded as -qty with no location. Approval
 * posts a pair per line, -qty at the location and +qty with no location, so
 * the location's history shows the units leaving while the ledger total
 * (which the drift job reconciles) is unchanged.
 */

const APPROVAL_REASON = 'web_order_allocated';

async function findOrderId(client, tenantId, ref) {
  const { rows } = await client.query(
    `SELECT id FROM orders WHERE tenant_id = $1 AND (id::text = $2 OR public_number = $2)`,
    [tenantId, String(ref || '')],
  );
  assertPos(rows.length === 1, 404, 'ORDER_NOT_FOUND', 'Order not found.');
  return rows[0].id;
}

/** Per location: can it ship the whole order, and if not, what is missing. */
async function getAllocation(context, orderRef) {
  const client = await db.pool.connect();
  try {
    const orderId = await findOrderId(client, context.tenantId, orderRef);
    const enabled = await perLocationEnabled(client, context.tenantId);
    const order = await client.query(
      `SELECT o.approved_at, l.name AS pickup_name
         FROM orders o LEFT JOIN stocktake_locations l ON l.id = o.fulfillment_location_id
        WHERE o.id = $1`,
      [orderId],
    );
    const holds = await client.query(
      `SELECT h.variant_id, h.quantity, h.status, pv.sku, pv.size, pv.color, p.name AS product_name
         FROM order_stock_holds h
         JOIN product_variants pv ON pv.id = h.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE h.tenant_id = $1 AND h.order_id = $2 AND h.status IN ('held', 'allocated')
        ORDER BY p.name, pv.sku`,
      [context.tenantId, orderId],
    );
    const held = holds.rows.filter((h) => h.status === 'held');
    const base = {
      enabled,
      needsApproval: enabled && held.length > 0,
      approvedAt: order.rows[0]?.approved_at || null,
      pickupLocation: order.rows[0]?.pickup_name || null,
      lines: held.map((h) => ({
        variantId: h.variant_id, sku: h.sku, productName: h.product_name, size: h.size, color: h.color, quantity: Number(h.quantity),
      })),
      locations: [],
    };
    if (!base.needsApproval) return base;

    const locations = await listLocations(client, context.tenantId);
    const availability = await getAvailability(client, context.tenantId, held.map((h) => h.variant_id));
    base.locations = locations.map((loc) => {
      const missing = [];
      for (const line of base.lines) {
        const here = availability.get(line.variantId)?.locations[loc.id] || 0;
        if (here < line.quantity) {
          missing.push({
            ...line,
            available: here,
            elsewhere: locations
              .filter((other) => other.id !== loc.id && (availability.get(line.variantId)?.locations[other.id] || 0) > 0)
              .map((other) => ({ locationId: other.id, name: other.name, quantity: availability.get(line.variantId).locations[other.id] })),
          });
        }
      }
      return { id: loc.id, name: loc.name, type: loc.type, allAvailable: missing.length === 0, missing };
    });
    // Locations that can ship everything first; the warehouse first among equals.
    base.locations.sort((a, b) => Number(b.allAvailable) - Number(a.allAvailable)
      || Number(b.type === 'warehouse') - Number(a.type === 'warehouse'));
    return base;
  } finally {
    client.release();
  }
}

async function approveOrder(context, orderRef, body) {
  const locationInput = uuid(body?.locationId, 'locationId');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    assertPos(await perLocationEnabled(client, context.tenantId), 409, 'PER_LOCATION_OFF', 'Order approval is only used with stock per location.');
    const orderId = await findOrderId(client, context.tenantId, orderRef);
    const order = await client.query(
      `SELECT id, public_number, payment_status, status, approved_at FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const row = order.rows[0];
    assertPos(row.payment_status === 'paid', 409, 'ORDER_NOT_PAID', 'Only paid orders can be approved.');
    assertPos(row.status !== 'cancelled', 409, 'ORDER_CANCELLED', 'This order was cancelled.');
    assertPos(!row.approved_at, 409, 'ALREADY_APPROVED', 'This order was already approved.');

    const location = await requireLocation(client, context.tenantId, locationInput);
    const holds = await client.query(
      `SELECT id, variant_id, quantity FROM order_stock_holds
        WHERE tenant_id = $1 AND order_id = $2 AND status = 'held'
        ORDER BY variant_id
        FOR UPDATE`,
      [context.tenantId, orderId],
    );
    assertPos(holds.rowCount > 0, 409, 'NOTHING_TO_APPROVE', 'This order has no items waiting for approval.');

    // Variant rows first (same lock order as every stock writer), then locations.
    const variants = await client.query(
      `SELECT pv.id, pv.product_id, pv.sku, p.name AS product_name
         FROM product_variants pv JOIN products p ON p.id = pv.product_id
        WHERE pv.id = ANY($1::uuid[]) ORDER BY pv.id FOR UPDATE OF pv`,
      [holds.rows.map((h) => h.variant_id)],
    );
    const variantById = new Map(variants.rows.map((v) => [v.id, v]));
    const shortages = [];
    for (const hold of holds.rows) {
      const here = await lockLocationQuantity(client, context.tenantId, hold.variant_id, location.id);
      if (here < Number(hold.quantity)) {
        const v = variantById.get(hold.variant_id);
        shortages.push({ sku: v?.sku, productName: v?.product_name, needed: Number(hold.quantity), available: here });
      }
    }
    if (shortages.length) {
      throw new PosError(409, 'LOCATION_SHORT',
        `${location.name} does not have every item: ${shortages.map((s) => `${s.productName} (${s.sku}) needs ${s.needed}, has ${s.available}`).join('; ')}. Move the missing items there first, or pick another location.`,
        { shortages });
    }

    for (const hold of holds.rows) {
      const v = variantById.get(hold.variant_id);
      const quantity = Number(hold.quantity);
      await applyLocationDelta(client, context.tenantId, { variantId: hold.variant_id, locationId: location.id, delta: -quantity, sku: v.sku });
      const common = {
        productId: v.product_id,
        variantId: hold.variant_id,
        reason: APPROVAL_REASON,
        referenceType: 'order',
        referenceId: orderId,
      };
      await recordMovement(client, context, {
        ...common, delta: -quantity, locationId: location.id, metadata: { sku: v.sku, orderNumber: row.public_number, location: location.name },
      });
      await recordMovement(client, context, {
        ...common, delta: quantity, metadata: { sku: v.sku, orderNumber: row.public_number, releasesHold: true },
      });
      await client.query(
        `UPDATE order_stock_holds SET status = 'allocated', location_id = $2, allocated_at = now() WHERE id = $1`,
        [hold.id, location.id],
      );
    }

    await client.query(
      `UPDATE orders
          SET status = 'confirmed', fulfillment_status = 'processing',
              fulfillment_location_id = $2, approved_at = now(), approved_by_user_id = $3, updated_at = now()
        WHERE id = $1`,
      [orderId, location.id, context.userId],
    );
    await client.query(
      `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, actor_user_id, metadata)
       VALUES ($1, $2, 'processing', $3, $4, $5::jsonb)`,
      [context.tenantId, orderId, `Approved. Pickup: ${location.name}.`, context.userId, JSON.stringify({ locationId: location.id })],
    );
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, after_state, ip_address, user_agent, request_id)
       VALUES ($1, $2, 'order.approved', 'order', $3, $4::jsonb, $5, $6, $7)`,
      [context.tenantId, context.userId, orderId, JSON.stringify({ location: location.name, lines: holds.rowCount }),
        context.ip || null, context.userAgent || null, context.requestId || null],
    );
    await client.query('COMMIT');
    return { orderId, publicNumber: row.public_number, location };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** True when a paid order is still waiting for approval (fulfilment is blocked). */
async function orderAwaitsApproval(client, tenantId, orderId) {
  if (!(await perLocationEnabled(client, tenantId))) return false;
  const { rowCount } = await client.query(
    `SELECT 1 FROM order_stock_holds WHERE tenant_id = $1 AND order_id = $2 AND status = 'held' LIMIT 1`,
    [tenantId, orderId],
  );
  return rowCount > 0;
}

module.exports = { APPROVAL_REASON, getAllocation, approveOrder, orderAwaitsApproval };
