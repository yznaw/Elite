const db = require('../db/client');
const { recordMovement } = require('./inventory-ledger');
const { logger } = require('./logger');
const { sendAlert } = require('./alerts');

const PAID_REASON = 'web_order';
const REVERSAL_REASON = 'web_order_reversed';

/**
 * Stock accounting for storefront orders.
 *
 * ## The defect this closes
 *
 * Until docs/25 Phase 1, **a paid web order never touched inventory.** Every
 * `stock_quantity` write in the server belonged to the POS or to a manual
 * catalog edit; `payments.route.js`, `sadad-webhook.route.js`, `carts.route.js`
 * and `admin-orders.route.js` contained no stock logic at all. The shop could
 * therefore sell the same unit online and again at the till.
 *
 * ## Why this is idempotent and self-healing rather than transactional
 *
 * The cross-cutting rule for this codebase is "money and stock move in one
 * transaction". That is achievable in the POS because `createSale` owns its
 * whole transaction. It is **not** safely achievable in the Sadad callback and
 * webhook handlers as they are written: both perform several updates whose
 * failure is deliberately tolerated with `.catch()` (metadata, payments row,
 * timeline, NBOX booking, receipt email). Inside one transaction a single
 * failed statement aborts the whole transaction in Postgres, so wrapping those
 * handlers would turn a currently-harmless metadata failure into a lost
 * payment flag. That would be strictly worse than the problem being solved.
 *
 * The design instead makes stock application:
 *   - **idempotent** — keyed on an existing `inventory_movements` row for the
 *     order, so a duplicate webhook (Sadad delivers them more than once)
 *     cannot decrement twice;
 *   - **safe to re-run** — callers invoke it on every observation that the
 *     order is paid, including the "already paid" branches, so a crash between
 *     the paid flag and the decrement is repaired by the next delivery;
 *   - **backstopped** — `applyMissingPaidOrderStock()` sweeps paid orders with
 *     no movement, so the guarantee does not depend on a webhook arriving twice.
 *
 * ## Overselling policy
 *
 * If stock is insufficient at payment time the sale is **not** rejected: the
 * money has already been taken. Stock floors at zero, the shortage is recorded
 * on the movement row, an order timeline note makes it visible to whoever
 * fulfils the order, and an alert is raised. This mirrors the policy the POS
 * already applies to offline sales — never silently discard a completed
 * financial fact.
 */

/** True when this order already has stock movements recorded. */
async function hasStockMovements(client, tenantId, orderId, reason = PAID_REASON) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM inventory_movements
      WHERE tenant_id = $1 AND reference_type = 'order' AND reference_id = $2 AND reason = $3
      LIMIT 1`,
    [tenantId, orderId, reason],
  );
  return rowCount > 0;
}

/**
 * Ordered by `variant_id`, not by line order.
 *
 * Every path in the system that locks stock rows must take those locks in the
 * same sequence, or two writers holding one lock each and waiting for the
 * other's deadlock. `sale-service.js` and `correction-service.js` sort by the
 * same key for the same reason. Lines with no variant sort last and take no
 * lock at all.
 */
async function loadOrderLines(client, tenantId, orderId) {
  const { rows } = await client.query(
    `SELECT id, product_id, variant_id, sku, product_name, quantity
       FROM order_items
      WHERE tenant_id = $1 AND order_id = $2
      ORDER BY variant_id NULLS LAST, id`,
    [tenantId, orderId],
  );
  return rows;
}

async function recomputeProductTotals(client, productIds) {
  for (const productId of productIds) {
    // eslint-disable-next-line no-await-in-loop -- one statement per product,
    // and a product list from a single order is short.
    await client.query(
      `UPDATE products
          SET stock_quantity = (
                SELECT COALESCE(SUM(stock_quantity), 0)
                  FROM product_variants
                 WHERE product_id = $1
              ),
              updated_at = now()
        WHERE id = $1
          AND EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1)`,
      [productId],
    );
  }
}

/**
 * Applies the stock effect of a paid order exactly once.
 *
 * Acquires its own connection and transaction, so it is safe to call from a
 * handler that is not itself transactional. Never throws: a stock failure must
 * not turn a successful payment into an error response to the gateway, which
 * would make the gateway retry a payment that actually succeeded.
 *
 * @returns {Promise<{applied: boolean, reason?: string, shortages?: Array}>}
 */
async function ensurePaidOrderStock(tenantId, orderId, options = {}) {
  const { actorUserId = null, source = 'web' } = options;
  let client;
  try {
    client = await db.pool.connect();
  } catch (error) {
    logger.error({ orderId, err: error.message }, 'order stock: could not acquire a connection');
    return { applied: false, reason: 'no_connection' };
  }

  const shortages = [];
  try {
    await client.query('BEGIN');
    // Bounded so a stuck transaction cannot block checkout at the till, which
    // locks the same variant rows.
    await client.query("SET LOCAL lock_timeout = '5s'");

    // Lock the order row first: two concurrent deliveries of the same webhook
    // serialize here, and the second one sees the movements the first wrote.
    const orderResult = await client.query(
      `SELECT id, payment_status, public_number, metadata
         FROM orders
        WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, orderId],
    );
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'order_not_found' };
    }
    const order = orderResult.rows[0];
    if (order.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'order_not_paid' };
    }
    if (await hasStockMovements(client, tenantId, orderId)) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'already_applied' };
    }

    const lines = await loadOrderLines(client, tenantId, orderId);
    if (!lines.length) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'no_order_items' };
    }

    const touchedProducts = new Set();
    for (const line of lines) {
      if (!line.variant_id || !line.product_id) {
        // A line whose variant was deleted cannot be reconciled against stock;
        // recorded on the order rather than silently ignored.
        shortages.push({ sku: line.sku, requested: line.quantity, missing: line.quantity, unlinked: true });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop -- rows must be locked and
      // decremented in order; an order has few lines.
      const variantResult = await client.query(
        `SELECT id, stock_quantity FROM product_variants
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [tenantId, line.variant_id],
      );
      if (!variantResult.rowCount) {
        shortages.push({ sku: line.sku, requested: line.quantity, missing: line.quantity, unlinked: true });
        continue;
      }

      const available = Number(variantResult.rows[0].stock_quantity) || 0;
      const applied = Math.min(available, line.quantity);
      const missing = line.quantity - applied;
      if (missing > 0) shortages.push({ sku: line.sku, requested: line.quantity, missing });

      if (applied > 0) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `UPDATE product_variants
              SET stock_quantity = stock_quantity - $3, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.variant_id, applied],
        );
      }

      // The ledger row is written even for a zero-quantity application, so the
      // order's stock effect is always explicit rather than inferred from an
      // absence. Idempotency above keys on the presence of these rows.
      // eslint-disable-next-line no-await-in-loop
      await recordMovement(client, { tenantId, userId: actorUserId }, {
        productId: line.product_id,
        variantId: line.variant_id,
        delta: -applied,
        reason: PAID_REASON,
        referenceType: 'order',
        referenceId: orderId,
        metadata: {
          source,
          sku: line.sku,
          orderNumber: order.public_number,
          requestedQuantity: line.quantity,
          ...(missing > 0 ? { shortageQuantity: missing } : {}),
        },
      });
      touchedProducts.add(line.product_id);
    }

    await recomputeProductTotals(client, touchedProducts);

    if (shortages.length) {
      // Visible to whoever fulfils the order, which is exactly who needs to
      // know that something was sold that the shop does not physically have.
      await client.query(
        `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
         VALUES ($1, $2, 'note', $3, $4::jsonb)`,
        [
          tenantId,
          orderId,
          'Paid order exceeded available stock. Stock floored at zero; physical availability needs checking before fulfilment.',
          JSON.stringify({ shortages, source: 'inventory' }),
        ],
      );
    }

    await client.query('COMMIT');

    if (shortages.length) {
      logger.warn({ orderId, orderNumber: order.public_number, shortages }, 'paid order oversold available stock');
      void sendAlert(
        `order-oversold:${orderId}`,
        `Order ${order.public_number} was paid but exceeds available stock`,
        `Order: ${order.public_number}\n\n`
        + shortages.map((s) => `${s.sku}: ordered ${s.requested}, short by ${s.missing}`).join('\n')
        + '\n\nThe payment was kept and stock floored at zero — money already taken is never discarded. '
        + 'Check physical availability before fulfilling, and reconcile the count.',
      );
    }
    return { applied: true, shortages };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Deliberately swallowed: the caller is a payment gateway handler, and
    // throwing here would make the gateway retry a payment that succeeded.
    // The backlog sweep below repairs anything missed.
    logger.error({ orderId, err: error.message }, 'order stock application failed');
    return { applied: false, reason: 'error' };
  } finally {
    client.release();
  }
}

/**
 * Reverses a paid order's stock effect when it is cancelled or refunded.
 *
 * Without this, every cancellation is permanent phantom shrinkage: the units
 * come back to the shelf physically but never to the system. Reverses exactly
 * what was applied (a shortage that floored at zero returns only what was
 * actually taken), and is idempotent on the reversal reason.
 */
async function reversePaidOrderStock(tenantId, orderId, options = {}) {
  const { actorUserId = null, reason = 'cancelled' } = options;
  let client;
  try {
    client = await db.pool.connect();
  } catch (error) {
    logger.error({ orderId, err: error.message }, 'order stock reversal: could not acquire a connection');
    return { reversed: false, reason: 'no_connection' };
  }

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT id FROM orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, orderId]);

    if (await hasStockMovements(client, tenantId, orderId, REVERSAL_REASON)) {
      await client.query('ROLLBACK');
      return { reversed: false, reason: 'already_reversed' };
    }

    // Reverse the actual applied deltas, not the ordered quantities.
    const { rows: applied } = await client.query(
      `SELECT product_id, variant_id, delta, metadata
         FROM inventory_movements
        WHERE tenant_id = $1 AND reference_type = 'order' AND reference_id = $2 AND reason = $3`,
      [tenantId, orderId, PAID_REASON],
    );
    if (!applied.length) {
      await client.query('ROLLBACK');
      return { reversed: false, reason: 'nothing_to_reverse' };
    }

    const touchedProducts = new Set();
    for (const movement of applied) {
      const quantity = Math.abs(Number(movement.delta) || 0);
      if (!quantity || !movement.variant_id) continue;
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `UPDATE product_variants
            SET stock_quantity = stock_quantity + $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, movement.variant_id, quantity],
      );
      // eslint-disable-next-line no-await-in-loop
      await recordMovement(client, { tenantId, userId: actorUserId }, {
        productId: movement.product_id,
        variantId: movement.variant_id,
        delta: quantity,
        reason: REVERSAL_REASON,
        referenceType: 'order',
        referenceId: orderId,
        metadata: { reversalOf: PAID_REASON, trigger: reason, sku: movement.metadata?.sku },
      });
      touchedProducts.add(movement.product_id);
    }

    await recomputeProductTotals(client, touchedProducts);
    await client.query('COMMIT');
    logger.info({ orderId, trigger: reason, lines: applied.length }, 'order stock reversed');
    return { reversed: true, lines: applied.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error({ orderId, err: error.message }, 'order stock reversal failed');
    return { reversed: false, reason: 'error' };
  } finally {
    client.release();
  }
}

/**
 * Backstop sweep: paid orders that have no stock movement.
 *
 * This is what makes the guarantee independent of a webhook arriving twice.
 * It only looks at orders paid in the recent past, so it can never "re-apply"
 * historical orders that predate the ledger — those are handled by the one-off
 * reconciliation in docs/25 Phase 1, deliberately by a human.
 */
async function applyMissingPaidOrderStock({ sinceHours = 48, limit = 100, tenantId = null } = {}) {
  if (!process.env.DATABASE_URL) return { checked: 0, repaired: 0 };
  const { rows } = await db.pool.query(
    `SELECT o.tenant_id, o.id, o.public_number
       FROM orders o
      WHERE o.payment_status = 'paid'
        AND ($3::uuid IS NULL OR o.tenant_id = $3)
        AND o.paid_at > now() - ($1::int * interval '1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM inventory_movements m
           WHERE m.tenant_id = o.tenant_id
             AND m.reference_type = 'order'
             AND m.reference_id = o.id
        )
        AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)
      ORDER BY o.paid_at
      LIMIT $2
      -- A background repair must never queue behind, or block, a live sale.
      -- SKIP LOCKED means an order currently being processed by a webhook is
      -- simply left for the next pass instead of being waited on.
      FOR UPDATE OF o SKIP LOCKED`,
    [sinceHours, limit, tenantId],
  );

  let repaired = 0;
  for (const order of rows) {
    // eslint-disable-next-line no-await-in-loop
    const result = await ensurePaidOrderStock(order.tenant_id, order.id, { source: 'backlog-sweep' });
    if (result.applied) {
      repaired += 1;
      logger.warn({ orderId: order.id, orderNumber: order.public_number }, 'repaired a paid order that had no stock movement');
    }
  }
  return { checked: rows.length, repaired };
}

module.exports = {
  ensurePaidOrderStock,
  reversePaidOrderStock,
  applyMissingPaidOrderStock,
  PAID_REASON,
  REVERSAL_REASON,
};
