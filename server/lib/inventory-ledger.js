/**
 * Writes to `inventory_movements` (migration 001) — the audit trail for
 * every stock change, in every channel.
 *
 * **The invariant this file exists to enforce:** `product_variants.stock_quantity`
 * is only ever written together with an `inventory_movements` row, in the same
 * transaction. Any write that skips this helper reappears later as unexplained
 * drift, and makes both the hourly consistency job and the inventory report
 * untrustworthy — which is worse than having neither.
 *
 * Lives in `lib/` rather than `lib/pos/` because it is no longer POS-only:
 * web orders (lib/order-stock.js), catalog edits and bulk imports write here
 * too (docs/25 Phase 1).
 *
 * Reason vocabulary in use:
 *   `pos_sale` · `pos_void` · `pos_refund`  — POS (sale-service, correction-service)
 *   `web_order` · `web_order_reversed`      — storefront orders (order-stock.js)
 *   `catalog_edit` · `bulk_import`          — admin catalog writes
 *
 * Must be called from inside the same transaction (same `client`) as the stock
 * change, so the ledger row and the stock change commit or roll back together,
 * never one without the other.
 *
 * On a variant's first-ever call, this also snapshots its pre-delta stock
 * into `pos_inventory_baselines` (migration 020). The ledger only records
 * *changes*; without a fixed starting point, "does current stock equal the
 * sum of all logged deltas" is never checkable — the baseline is that
 * fixed point, captured exactly once, so later drift (a stock change that
 * bypassed the ledger — a direct catalog edit, a bug) becomes detectable
 * by the consistency job.
 */
async function recordMovement(client, context, {
  productId,
  variantId,
  delta,
  reason,
  referenceType,
  referenceId,
  metadata,
}) {
  if (variantId) {
    const preDeltaStock = await currentStock(client, context.tenantId, variantId);
    if (preDeltaStock !== null) {
      // Value before this delta is applied — recordMovement is always
      // called after the UPDATE that changed stock_quantity, so the
      // baseline must be back-computed as (current - delta), not read live.
      await client.query(
        `INSERT INTO pos_inventory_baselines (tenant_id, variant_id, baseline_stock)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, variant_id) DO NOTHING`,
        [context.tenantId, variantId, preDeltaStock - delta],
      );
    }
  }

  await client.query(
    `INSERT INTO inventory_movements (
       tenant_id, product_id, variant_id, delta, reason,
       reference_type, reference_id, created_by_user_id, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      context.tenantId,
      productId,
      variantId,
      delta,
      reason,
      referenceType,
      referenceId,
      context.userId,
      JSON.stringify(metadata ?? {}),
    ],
  );
}

async function currentStock(client, tenantId, variantId) {
  const result = await client.query(
    'SELECT stock_quantity FROM product_variants WHERE tenant_id = $1 AND id = $2',
    [tenantId, variantId],
  );
  return result.rowCount ? Number(result.rows[0].stock_quantity) : null;
}

module.exports = { recordMovement };
