const db = require('../db/client');
const { recordMovement } = require('./inventory-ledger');
const { PosError, assertPos, nonEmpty, uuid } = require('./pos/errors');
const { logger } = require('./logger');

/**
 * Inventory operations: manual adjustments and stocktakes (docs/25 Phase 8).
 *
 * ## Why this exists
 *
 * Phase 1 made every stock change post an `inventory_movements` row, which
 * made drift detectable. But it left no *legitimate* way to correct a wrong
 * number: the only tool was editing the figure in the catalogue, which is now
 * logged as `catalog_edit` with no reason attached. "Someone changed it" is
 * not an explanation. These two operations are how a stock number gets
 * corrected on purpose, with a reason that survives.
 *
 * ## The rule everything here obeys
 *
 * `product_variants.stock_quantity` is only ever written together with an
 * `inventory_movements` row, in the same transaction (see inventory-ledger.js).
 * A stocktake that wrote stock directly would reintroduce exactly the defect
 * Phase 1 removed.
 */

const ADJUSTMENT_REASONS = new Set([
  'damaged',
  'lost',
  'found',
  'returned_to_supplier',
  'sample',
  'correction',
]);

/** Reasons that always remove stock, used to sanity-check the sign. */
const NEGATIVE_ONLY = new Set(['damaged', 'lost', 'returned_to_supplier', 'sample']);

function parseQuantity(value, field) {
  const quantity = Number.parseInt(value, 10);
  assertPos(Number.isSafeInteger(quantity), 422, 'INVALID_QUANTITY', `${field} must be a whole number.`);
  return quantity;
}

/**
 * Applies a single deliberate stock correction.
 *
 * `delta` is signed: negative writes stock off, positive puts it back. The
 * reason is mandatory and comes from a fixed list rather than free text, so
 * the shrinkage report can group by it — free-text reasons produce a report
 * where "damaged", "Damaged" and "broken" are three different categories.
 *
 * **No manager-approval token here, deliberately.** docs/25 originally called
 * for one, but this runs in the admin portal where the actor is already an
 * owner or admin — the highest privilege in the system. Asking that person to
 * approve their own action with a second credential from the same pool is
 * theatre, not separation of duties. The real controls are: the reason is
 * mandatory, the actor is recorded, it lands in `audit_events`, and it shows
 * up in the shrinkage report under its reason. (The POS manager-override
 * system is register-bound and does not apply outside a till session.)
 */
async function adjustStock(context, body) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can adjust stock.',
  );

  const variantId = uuid(body?.variantId, 'variantId');
  const delta = parseQuantity(body?.delta, 'delta');
  assertPos(delta !== 0, 422, 'INVALID_QUANTITY', 'An adjustment of zero changes nothing.');
  assertPos(Math.abs(delta) <= 100000, 422, 'INVALID_QUANTITY', 'That adjustment is implausibly large.');

  const reason = nonEmpty(body?.reason, 'reason', 40);
  assertPos(
    ADJUSTMENT_REASONS.has(reason),
    422,
    'INVALID_FIELD',
    `reason must be one of: ${[...ADJUSTMENT_REASONS].join(', ')}.`,
  );
  assertPos(
    !(NEGATIVE_ONLY.has(reason) && delta > 0),
    422,
    'INVALID_FIELD',
    `"${reason}" removes stock, so the quantity must be negative.`,
  );
  const note = body?.note ? nonEmpty(body.note, 'note', 300) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");

    const variant = await client.query(
      `SELECT pv.id, pv.product_id, pv.sku, pv.stock_quantity, p.name AS product_name
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.tenant_id = $1 AND pv.id = $2
        FOR UPDATE OF pv`,
      [context.tenantId, variantId],
    );
    assertPos(variant.rowCount === 1, 404, 'VARIANT_NOT_FOUND', 'That product variant does not exist.');

    const before = Number(variant.rows[0].stock_quantity) || 0;
    const after = before + delta;
    assertPos(
      after >= 0,
      422,
      'INSUFFICIENT_STOCK',
      `${variant.rows[0].sku} holds ${before}; removing ${Math.abs(delta)} would take it below zero.`,
    );

    await client.query(
      'UPDATE product_variants SET stock_quantity = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, variantId, after],
    );
    await recordMovement(client, context, {
      productId: variant.rows[0].product_id,
      variantId,
      delta,
      reason: 'manual_adjustment',
      referenceType: 'adjustment',
      referenceId: null,
      // The specific reason lives in metadata rather than in the ledger's
      // `reason` column, which stays a small closed set naming the *mechanism*
      // (pos_sale, web_order, manual_adjustment). The shrinkage report groups
      // on this.
      metadata: { adjustmentReason: reason, note, sku: variant.rows[0].sku, before, after },
    });
    await recomputeProductTotal(client, variant.rows[0].product_id);
    await writeAudit(client, context, 'inventory.adjusted', 'product_variant', variantId, {
      delta, reason, note, before, after, sku: variant.rows[0].sku,
    });

    await client.query('COMMIT');
    logger.info({ variantId, delta, reason, before, after }, 'stock adjusted');
    return {
      variantId,
      sku: variant.rows[0].sku,
      productName: variant.rows[0].product_name,
      before,
      after,
      delta,
      reason,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Opens a stocktake over a set of variants, snapshotting what the system
 * currently believes. Nothing is written to stock here.
 *
 * `scope` is either an explicit list of variant ids, or `all` for every active
 * variant. A stocktake of everything is the normal end-of-season case; a
 * partial one is a cycle count of a single shelf.
 */
async function startStocktake(context, body) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can start a stocktake.',
  );

  const reference = nonEmpty(body?.reference, 'reference', 60);
  const blind = body?.blind !== false;
  const note = body?.note ? nonEmpty(body.note, 'note', 300) : null;
  const variantIds = Array.isArray(body?.variantIds) ? body.variantIds.map((id) => uuid(id, 'variantIds[]')) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const open = await client.query(
      `SELECT id FROM stocktakes WHERE tenant_id = $1 AND status IN ('counting', 'review')`,
      [context.tenantId],
    );
    // One at a time. Two overlapping counts of the same shelf produce two
    // different discrepancies for the same physical fact, and whichever posts
    // second silently overwrites the first's reasoning.
    assertPos(open.rowCount === 0, 409, 'STOCKTAKE_IN_PROGRESS', 'Finish or cancel the open stocktake first.');

    const created = await client.query(
      `INSERT INTO stocktakes (tenant_id, reference, blind, note, started_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, reference, status, blind, started_at`,
      [context.tenantId, reference, blind, note, context.userId],
    );
    const stocktakeId = created.rows[0].id;

    const lines = await client.query(
      `INSERT INTO stocktake_lines (stocktake_id, tenant_id, variant_id, expected_quantity)
       SELECT $1, $2, pv.id, pv.stock_quantity
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.tenant_id = $2
          AND pv.is_active = true
          AND p.status = 'active'
          AND ($3::uuid[] IS NULL OR pv.id = ANY($3::uuid[]))
       RETURNING id`,
      [stocktakeId, context.tenantId, variantIds],
    );
    assertPos(lines.rowCount > 0, 422, 'NO_VARIANTS', 'That scope matched no active product variants.');

    await writeAudit(client, context, 'inventory.stocktake.started', 'stocktake', stocktakeId, {
      reference, blind, lineCount: lines.rowCount,
    });
    await client.query('COMMIT');

    return { ...mapStocktake(created.rows[0]), lineCount: lines.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Records a counted quantity for one line. A second count on the same line is
 *  stored separately as a recount, so the disagreement stays visible. */
async function saveCount(context, stocktakeId, body) {
  const id = uuid(stocktakeId, 'stocktakeId');
  const variantId = uuid(body?.variantId, 'variantId');
  const counted = parseQuantity(body?.quantity, 'quantity');
  assertPos(counted >= 0, 422, 'INVALID_QUANTITY', 'A counted quantity cannot be negative.');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const stocktake = await client.query(
      'SELECT id, status FROM stocktakes WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [context.tenantId, id],
    );
    assertPos(stocktake.rowCount === 1, 404, 'STOCKTAKE_NOT_FOUND', 'Stocktake not found.');
    assertPos(
      ['counting', 'review'].includes(stocktake.rows[0].status),
      409,
      'STOCKTAKE_CLOSED',
      'This stocktake has already been posted or cancelled.',
    );

    const line = await client.query(
      'SELECT id, counted_quantity FROM stocktake_lines WHERE stocktake_id = $1 AND variant_id = $2 FOR UPDATE',
      [id, variantId],
    );
    assertPos(line.rowCount === 1, 404, 'LINE_NOT_FOUND', 'That variant is not part of this stocktake.');

    // First number goes in `counted_quantity`; a later one is a recount and is
    // kept alongside rather than overwriting it. Overwriting would erase the
    // fact that two people counted the same shelf differently, which is the
    // single most useful signal a stocktake produces.
    const isRecount = line.rows[0].counted_quantity !== null;
    await client.query(
      isRecount
        ? `UPDATE stocktake_lines SET recount_quantity = $2, counted_by_user_id = $3, counted_at = now(), note = $4 WHERE id = $1`
        : `UPDATE stocktake_lines SET counted_quantity = $2, counted_by_user_id = $3, counted_at = now(), note = $4 WHERE id = $1`,
      [line.rows[0].id, counted, context.userId, body?.note ? String(body.note).slice(0, 300) : null],
    );

    await client.query('COMMIT');
    return { stocktakeId: id, variantId, quantity: counted, recount: isRecount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Posts a stocktake: turns every counted discrepancy into a ledger movement.
 *
 * **The arithmetic that matters.** A count takes time, and the shop keeps
 * selling while it happens. Writing the counted number back as an absolute
 * would undo every sale made between the count and the posting — the classic
 * way a naive stocktake destroys inventory.
 *
 * So what gets applied is the *discrepancy*, not the count:
 *
 *   discrepancy = counted - expected_at_count_time
 *   new stock   = current_stock_now + discrepancy
 *
 * If the shelf held 10, the system expected 12, and 3 sold during the count,
 * then: discrepancy = -2, current = 9, new = 7. The two missing units are
 * written off; the three sales survive.
 *
 * Lines that were never counted are skipped, not treated as zero. An uncounted
 * shelf is unknown, not empty.
 */
async function postStocktake(context, stocktakeId, body = {}) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can post a stocktake.',
  );
  const id = uuid(stocktakeId, 'stocktakeId');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");

    const stocktake = await client.query(
      'SELECT * FROM stocktakes WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [context.tenantId, id],
    );
    assertPos(stocktake.rowCount === 1, 404, 'STOCKTAKE_NOT_FOUND', 'Stocktake not found.');
    assertPos(
      stocktake.rows[0].status !== 'posted',
      409,
      'STOCKTAKE_POSTED',
      'This stocktake has already been posted.',
    );
    assertPos(
      stocktake.rows[0].status !== 'cancelled',
      409,
      'STOCKTAKE_CANCELLED',
      'This stocktake was cancelled.',
    );

    // Ordered by variant id: the same lock order every other stock writer in
    // the system uses, so a posting cannot deadlock against a live sale.
    const lines = await client.query(
      `SELECT l.id, l.variant_id, l.expected_quantity, l.counted_quantity, l.recount_quantity,
              pv.product_id, pv.sku, pv.stock_quantity AS current_stock
         FROM stocktake_lines l
         JOIN product_variants pv ON pv.id = l.variant_id
        WHERE l.stocktake_id = $1 AND l.counted_quantity IS NOT NULL
        ORDER BY l.variant_id
        FOR UPDATE OF pv`,
      [id],
    );

    const unresolved = lines.rows.filter(
      (line) => line.recount_quantity !== null && line.recount_quantity !== line.counted_quantity,
    );
    // A line where two counts disagree is not a result, it is a question.
    // Posting it would pick one arbitrarily.
    assertPos(
      unresolved.length === 0 || body?.acceptRecountDisagreement === true,
      409,
      'RECOUNT_DISAGREEMENT',
      `${unresolved.length} line(s) have a recount that disagrees with the first count. Recount them, or post explicitly accepting the recount as final.`,
      { skus: unresolved.slice(0, 10).map((line) => line.sku) },
    );

    const applied = [];
    const touchedProducts = new Set();
    for (const line of lines.rows) {
      // The recount, when present, is the accepted figure.
      const counted = line.recount_quantity ?? line.counted_quantity;
      const discrepancy = counted - Number(line.expected_quantity);
      if (discrepancy === 0) continue;

      const currentStock = Number(line.current_stock) || 0;
      const newStock = Math.max(0, currentStock + discrepancy);
      const effectiveDelta = newStock - currentStock;
      if (effectiveDelta === 0) continue;

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        'UPDATE product_variants SET stock_quantity = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, line.variant_id, newStock],
      );
      // eslint-disable-next-line no-await-in-loop
      await recordMovement(client, context, {
        productId: line.product_id,
        variantId: line.variant_id,
        delta: effectiveDelta,
        reason: 'stocktake',
        referenceType: 'stocktake',
        referenceId: id,
        metadata: {
          sku: line.sku,
          expectedAtCount: Number(line.expected_quantity),
          counted,
          discrepancy,
          stockBefore: currentStock,
          stockAfter: newStock,
          // Recorded when the two differ, i.e. sales landed during the count.
          // Without it, a later reader cannot tell why the applied delta is
          // not simply (counted - expected).
          ...(currentStock !== Number(line.expected_quantity)
            ? { soldDuringCount: Number(line.expected_quantity) - currentStock }
            : {}),
        },
      });
      touchedProducts.add(line.product_id);
      applied.push({ sku: line.sku, discrepancy, stockBefore: currentStock, stockAfter: newStock });
    }

    for (const productId of touchedProducts) {
      // eslint-disable-next-line no-await-in-loop
      await recomputeProductTotal(client, productId);
    }

    await client.query(
      `UPDATE stocktakes SET status = 'posted', posted_at = now(), posted_by_user_id = $2 WHERE id = $1`,
      [id, context.userId],
    );
    await writeAudit(client, context, 'inventory.stocktake.posted', 'stocktake', id, {
      countedLines: lines.rowCount,
      adjustedLines: applied.length,
    });

    await client.query('COMMIT');
    logger.warn({ stocktakeId: id, adjustedLines: applied.length }, 'stocktake posted');
    return { stocktakeId: id, countedLines: lines.rowCount, adjustedLines: applied.length, applied };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cancelStocktake(context, stocktakeId) {
  const id = uuid(stocktakeId, 'stocktakeId');
  const result = await db.pool.query(
    `UPDATE stocktakes SET status = 'cancelled'
      WHERE tenant_id = $1 AND id = $2 AND status IN ('counting', 'review')
      RETURNING id`,
    [context.tenantId, id],
  );
  if (!result.rowCount) throw new PosError(409, 'STOCKTAKE_CLOSED', 'That stocktake is already posted or cancelled.');
  return { stocktakeId: id, status: 'cancelled' };
}

/** One stocktake with its lines. Expected quantities are withheld while a
 *  blind count is still open — that is the whole point of a blind count. */
async function getStocktake(context, stocktakeId) {
  const id = uuid(stocktakeId, 'stocktakeId');
  const stocktake = await db.pool.query(
    `SELECT s.*, starter.full_name AS started_by_name, poster.full_name AS posted_by_name
       FROM stocktakes s
       LEFT JOIN admin_users starter ON starter.id = s.started_by_user_id
       LEFT JOIN admin_users poster ON poster.id = s.posted_by_user_id
      WHERE s.tenant_id = $1 AND s.id = $2`,
    [context.tenantId, id],
  );
  if (!stocktake.rowCount) throw new PosError(404, 'STOCKTAKE_NOT_FOUND', 'Stocktake not found.');
  const row = stocktake.rows[0];
  const hideExpected = row.blind && row.status === 'counting';

  const lines = await db.pool.query(
    `SELECT l.id, l.variant_id, l.expected_quantity, l.counted_quantity, l.recount_quantity,
            l.counted_at, l.note, pv.sku, pv.size, pv.color, p.name AS product_name,
            pv.stock_quantity AS current_stock
       FROM stocktake_lines l
       JOIN product_variants pv ON pv.id = l.variant_id
       JOIN products p ON p.id = pv.product_id
      WHERE l.stocktake_id = $1
      ORDER BY p.name, pv.sku`,
    [id],
  );

  return {
    ...mapStocktake(row),
    startedByName: row.started_by_name,
    postedByName: row.posted_by_name,
    lines: lines.rows.map((line) => ({
      variantId: line.variant_id,
      sku: line.sku,
      productName: line.product_name,
      variant: [line.color, line.size].filter(Boolean).join(' / '),
      expectedQuantity: hideExpected ? null : Number(line.expected_quantity),
      countedQuantity: line.counted_quantity === null ? null : Number(line.counted_quantity),
      recountQuantity: line.recount_quantity === null ? null : Number(line.recount_quantity),
      currentStock: hideExpected ? null : Number(line.current_stock),
      discrepancy: hideExpected || line.counted_quantity === null
        ? null
        : (line.recount_quantity ?? line.counted_quantity) - Number(line.expected_quantity),
      countedAt: line.counted_at,
      note: line.note,
    })),
  };
}

async function listStocktakes(context, query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const { rows } = await db.pool.query(
    `SELECT s.*, u.full_name AS started_by_name,
            (SELECT count(*)::int FROM stocktake_lines l WHERE l.stocktake_id = s.id) AS line_count,
            (SELECT count(*)::int FROM stocktake_lines l WHERE l.stocktake_id = s.id AND l.counted_quantity IS NOT NULL) AS counted_count
       FROM stocktakes s
       LEFT JOIN admin_users u ON u.id = s.started_by_user_id
      WHERE s.tenant_id = $1
      ORDER BY s.started_at DESC
      LIMIT $2`,
    [context.tenantId, limit],
  );
  return rows.map((row) => ({
    ...mapStocktake(row),
    startedByName: row.started_by_name,
    lineCount: Number(row.line_count),
    countedCount: Number(row.counted_count),
  }));
}

function mapStocktake(row) {
  return {
    stocktakeId: row.id,
    reference: row.reference,
    status: row.status,
    blind: row.blind,
    note: row.note ?? null,
    startedAt: row.started_at,
    postedAt: row.posted_at ?? null,
  };
}

async function recomputeProductTotal(client, productId) {
  await client.query(
    `UPDATE products
        SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity), 0) FROM product_variants WHERE product_id = $1),
            updated_at = now()
      WHERE id = $1
        AND EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1)`,
    [productId],
  );
}

async function writeAudit(client, context, action, entityType, entityId, afterState) {
  await client.query(
    `INSERT INTO audit_events
       (tenant_id, actor_user_id, action, entity_type, entity_id, after_state, ip_address, user_agent, request_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [
      context.tenantId,
      context.userId,
      action,
      entityType,
      entityId,
      JSON.stringify(afterState ?? {}),
      context.ip || null,
      context.userAgent || null,
      context.requestId || null,
    ],
  );
}

module.exports = {
  adjustStock,
  startStocktake,
  saveCount,
  postStocktake,
  cancelStocktake,
  getStocktake,
  listStocktakes,
  ADJUSTMENT_REASONS,
};
