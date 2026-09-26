const crypto = require('node:crypto');
const db = require('../db/client');
const { kickRestockDispatch } = require('./restock-dispatch-job');
const { recordMovement, publishStockEvent } = require('./inventory-ledger');
const { assertPos, nonEmpty, uuid } = require('./pos/errors');
const {
  perLocationEnabled,
  syncLocations,
  listLocations,
  requireLocation,
  applyLocationDelta,
} = require('./location-stock');

/**
 * Admin operations on per-location stock (plan Phase 3): the stock table,
 * adding stock to a location, and moving stock between locations.
 *
 * Both writes keep the invariant from location-stock.js in one transaction:
 * adding stock raises the location and the sellable total together; a
 * transfer lowers one location and raises another, leaving the total alone.
 * Every unit moved posts an inventory_movements row naming its location.
 */

const RECEIVE_REASONS = new Set(['received', 'found', 'returned', 'correction']);
const MAX_LINES = 200;
const MAX_QUANTITY = 100000;

async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertEnabled(client, tenantId) {
  assertPos(
    await perLocationEnabled(client, tenantId),
    409,
    'PER_LOCATION_OFF',
    'Stock per location is not turned on yet. Turn it on from the Inventory page first.',
  );
}

/** Merges duplicate variants and validates quantities. */
function normalizeLines(input) {
  assertPos(Array.isArray(input) && input.length > 0, 422, 'INVALID_FIELD', 'Add at least one item.');
  assertPos(input.length <= MAX_LINES, 422, 'INVALID_FIELD', `Up to ${MAX_LINES} items per entry.`);
  const merged = new Map();
  for (const line of input) {
    const variantId = uuid(line?.variantId, 'variantId');
    const quantity = Number(line?.quantity);
    assertPos(Number.isSafeInteger(quantity) && quantity > 0, 422, 'INVALID_QUANTITY', 'Quantities must be whole numbers above zero.');
    assertPos(quantity <= MAX_QUANTITY, 422, 'INVALID_QUANTITY', 'That quantity is implausibly large.');
    merged.set(variantId, (merged.get(variantId) || 0) + quantity);
  }
  // Variant-id order: the lock order every stock writer uses.
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, quantity]) => ({ variantId, quantity }));
}

/** Locks the variants in id order and proves they all belong to this tenant. */
async function lockVariants(client, tenantId, variantIds) {
  const { rows } = await client.query(
    `SELECT pv.id, pv.product_id, pv.sku, pv.stock_quantity, p.name AS product_name
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
      WHERE pv.tenant_id = $1 AND pv.id = ANY($2::uuid[])
      ORDER BY pv.id
      FOR UPDATE OF pv`,
    [tenantId, variantIds],
  );
  assertPos(rows.length === variantIds.length, 404, 'VARIANT_NOT_FOUND', 'One or more items no longer exist.');
  return new Map(rows.map((row) => [row.id, row]));
}

async function recomputeProductTotals(client, productIds) {
  if (!productIds.size) return;
  await client.query(
    `UPDATE products p
        SET stock_quantity = totals.stock, updated_at = now()
       FROM (SELECT product_id, COALESCE(sum(stock_quantity), 0)::int AS stock
               FROM product_variants WHERE product_id = ANY($1::uuid[]) GROUP BY product_id) totals
      WHERE p.id = totals.product_id`,
    [[...productIds]],
  );
}

async function writeAudit(client, context, action, entityId, afterState) {
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, after_state, ip_address, user_agent, request_id)
     VALUES ($1, $2, $3, 'stock_location', $4, $5::jsonb, $6, $7, $8)`,
    [context.tenantId, context.userId, action, entityId, JSON.stringify(afterState),
      context.ip || null, context.userAgent || null, context.requestId || null],
  );
}

/**
 * The stock table: one row per active variant with its balance at every
 * location, the unallocated website holds and the sellable total.
 */
async function listStock(context, query = {}) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const search = String(query.search || '').trim().slice(0, 100);
  const lowThreshold = Math.min(1000, Math.max(1, Number.parseInt(query.lowThreshold, 10) || 3));
  const state = ['low', 'out', 'in'].includes(query.state) ? query.state : null;

  const client = await db.pool.connect();
  try {
    await syncLocations(client, context.tenantId);
    const enabled = await perLocationEnabled(client, context.tenantId);
    const locations = await listLocations(client, context.tenantId);
    let locationId = null;
    if (query.locationId) {
      locationId = uuid(query.locationId, 'locationId');
      assertPos(locations.some((l) => l.id === locationId), 404, 'LOCATION_NOT_FOUND', 'That stock location does not exist.');
    }

    // The quantity filters apply to one location when one is chosen, and to
    // the sellable total otherwise.
    const params = [context.tenantId];
    const bind = (value) => { params.push(value); return `$${params.length}`; };
    const where = ['pv.tenant_id = $1', 'pv.is_active', "p.status <> 'archived'"];
    if (search) {
      const exact = bind(search);
      const like = bind(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(p.name ILIKE ${like} OR pv.sku ILIKE ${like} OR pv.barcode = ${exact} OR pv.color ILIKE ${like})`);
    }
    const qtyExpr = locationId && enabled
      ? `COALESCE((SELECT vls.quantity FROM variant_location_stock vls WHERE vls.variant_id = pv.id AND vls.location_id = ${bind(locationId)}), 0)`
      : 'pv.stock_quantity';
    if (state === 'out') where.push(`${qtyExpr} <= 0`);
    if (state === 'low') where.push(`${qtyExpr} BETWEEN 1 AND ${bind(lowThreshold)}`);
    if (state === 'in') where.push(`${qtyExpr} > 0`);
    const limitSql = bind(limit);
    const offsetSql = bind(offset);

    const { rows } = await client.query(
      `SELECT pv.id, pv.product_id, p.name AS product_name, pv.sku, pv.barcode, pv.color, pv.size,
              pv.stock_quantity,
              COALESCE((SELECT jsonb_object_agg(vls.location_id, vls.quantity)
                          FROM variant_location_stock vls
                         WHERE vls.variant_id = pv.id AND vls.quantity > 0), '{}'::jsonb) AS by_location,
              COALESCE((SELECT sum(h.quantity) FROM order_stock_holds h
                         WHERE h.variant_id = pv.id AND h.status = 'held'), 0)::int AS held,
              count(*) OVER () AS total_rows
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.name, pv.color NULLS FIRST,
                 CASE WHEN pv.size ~ '^[0-9]+(\\.[0-9]+)?$' THEN pv.size::numeric END NULLS LAST, pv.size
        LIMIT ${limitSql} OFFSET ${offsetSql}`,
      params,
    );
    return {
      enabled,
      locations,
      total: rows.length ? Number(rows[0].total_rows) : 0,
      items: rows.map((row) => ({
        variantId: row.id,
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        barcode: row.barcode,
        color: row.color,
        size: row.size,
        total: Number(row.stock_quantity),
        held: Number(row.held),
        byLocation: Object.fromEntries(Object.entries(row.by_location || {}).map(([k, v]) => [k, Number(v)])),
      })),
    };
  } finally {
    client.release();
  }
}

/** Adds stock to one location: raises that location and the sellable total. */
async function receiveStock(context, body) {
  const lines = normalizeLines(body?.lines);
  const reason = String(body?.reason || 'received');
  assertPos(RECEIVE_REASONS.has(reason), 422, 'INVALID_FIELD', `reason must be one of: ${[...RECEIVE_REASONS].join(', ')}.`);
  const note = body?.note ? nonEmpty(body.note, 'note', 300) : null;
  const locationInput = uuid(body?.locationId, 'locationId');

  const result = await inTransaction(async (client) => {
    await assertEnabled(client, context.tenantId);
    const location = await requireLocation(client, context.tenantId, locationInput);
    const variants = await lockVariants(client, context.tenantId, lines.map((l) => l.variantId));
    const receiptId = crypto.randomUUID();
    const products = new Set();
    const applied = [];

    for (const line of lines) {
      const variant = variants.get(line.variantId);
      const updated = await client.query(
        `UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now()
          WHERE id = $1 RETURNING stock_quantity`,
        [line.variantId, line.quantity],
      );
      const after = Number(updated.rows[0].stock_quantity);
      const loc = await applyLocationDelta(client, context.tenantId, {
        variantId: line.variantId, locationId: location.id, delta: line.quantity, sku: variant.sku,
      });
      await recordMovement(client, context, {
        productId: variant.product_id,
        variantId: line.variantId,
        delta: line.quantity,
        reason: 'manual_adjustment',
        referenceType: 'stock_receipt',
        referenceId: receiptId,
        metadata: { adjustmentReason: reason, note, sku: variant.sku, locationName: location.name, before: Number(variant.stock_quantity), after },
        locationId: location.id,
      });
      await publishStockEvent(client, context.tenantId, line.variantId, after);
      products.add(variant.product_id);
      applied.push({ variantId: line.variantId, sku: variant.sku, quantity: line.quantity, locationQuantity: loc.after, total: after });
    }
    await recomputeProductTotals(client, products);
    await writeAudit(client, context, 'inventory.received', location.id, {
      receiptId, reason, note, location: location.name, lines: applied.map(({ sku, quantity }) => ({ sku, quantity })),
    });
    return { receiptId, location, reason, lines: applied, products };
  });
  kickRestockDispatch([...result.products]);
  delete result.products;
  return result;
}

/** Moves stock between two locations. The sellable total does not change. */
async function transferStock(context, body) {
  const lines = normalizeLines(body?.lines);
  const fromInput = uuid(body?.fromLocationId, 'fromLocationId');
  const toInput = uuid(body?.toLocationId, 'toLocationId');
  assertPos(fromInput !== toInput, 422, 'INVALID_FIELD', 'Choose two different locations.');
  const note = body?.note ? nonEmpty(body.note, 'note', 300) : null;

  return inTransaction(async (client) => {
    await assertEnabled(client, context.tenantId);
    const from = await requireLocation(client, context.tenantId, fromInput);
    const to = await requireLocation(client, context.tenantId, toInput);
    const variants = await lockVariants(client, context.tenantId, lines.map((l) => l.variantId));

    const header = await client.query(
      `INSERT INTO stock_transfers (tenant_id, from_location_id, to_location_id, note, line_count, unit_count, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [context.tenantId, from.id, to.id, note, lines.length, lines.reduce((sum, l) => sum + l.quantity, 0), context.userId],
    );
    const transferId = header.rows[0].id;

    const moved = [];
    for (const line of lines) {
      const variant = variants.get(line.variantId);
      // Strict: a transfer cannot send what the source does not hold.
      const out = await applyLocationDelta(client, context.tenantId, {
        variantId: line.variantId, locationId: from.id, delta: -line.quantity, sku: `${variant.product_name} (${variant.sku})`,
      });
      const into = await applyLocationDelta(client, context.tenantId, {
        variantId: line.variantId, locationId: to.id, delta: line.quantity,
      });
      const common = {
        productId: variant.product_id,
        variantId: line.variantId,
        reason: 'transfer',
        referenceType: 'transfer',
        referenceId: transferId,
      };
      await recordMovement(client, context, {
        ...common, delta: -line.quantity, locationId: from.id, metadata: { sku: variant.sku, direction: 'out', to: to.name },
      });
      await recordMovement(client, context, {
        ...common, delta: line.quantity, locationId: to.id, metadata: { sku: variant.sku, direction: 'in', from: from.name },
      });
      await publishStockEvent(client, context.tenantId, line.variantId, Number(variant.stock_quantity));
      moved.push({ variantId: line.variantId, sku: variant.sku, quantity: line.quantity, fromQuantity: out.after, toQuantity: into.after });
    }
    await writeAudit(client, context, 'inventory.transferred', transferId, {
      from: from.name, to: to.name, note, lines: moved.map(({ sku, quantity }) => ({ sku, quantity })),
    });
    return { transferId, createdAt: header.rows[0].created_at, from, to, note, lines: moved };
  });
}

async function listTransfers(context, query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 30));
  const { rows } = await db.pool.query(
    `SELECT t.id, t.created_at, t.note, t.line_count, t.unit_count,
            f.name AS from_name, d.name AS to_name, u.full_name AS created_by_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'sku', pv.sku, 'productName', p.name, 'color', pv.color, 'size', pv.size, 'quantity', m.delta)
                     ORDER BY p.name, pv.sku)
                FROM inventory_movements m
                JOIN product_variants pv ON pv.id = m.variant_id
                JOIN products p ON p.id = pv.product_id
               WHERE m.tenant_id = t.tenant_id AND m.reference_type = 'transfer'
                 AND m.reference_id = t.id AND m.delta > 0
            ), '[]'::jsonb) AS lines
       FROM stock_transfers t
       JOIN stocktake_locations f ON f.id = t.from_location_id
       JOIN stocktake_locations d ON d.id = t.to_location_id
       LEFT JOIN admin_users u ON u.id = t.created_by_user_id
      WHERE t.tenant_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2`,
    [context.tenantId, limit],
  );
  return rows.map((row) => ({
    transferId: row.id,
    createdAt: row.created_at,
    note: row.note,
    lineCount: Number(row.line_count),
    unitCount: Number(row.unit_count),
    from: row.from_name,
    to: row.to_name,
    createdByName: row.created_by_name,
    lines: row.lines,
  }));
}

module.exports = { RECEIVE_REASONS, listStock, receiveStock, transferStock, listTransfers };
