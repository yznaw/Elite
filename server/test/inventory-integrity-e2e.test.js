const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `inv-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Inventory Integrity E2E';
process.env.DEFAULT_ADMIN_EMAIL = `inv-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'inv-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Inventory Test Owner';
process.env.SESSION_SECRET = `inv-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const {
  ensurePaidOrderStock,
  reversePaidOrderStock,
  applyMissingPaidOrderStock,
} = require('../lib/order-stock');
const { findDrift } = require('../lib/pos/inventory-consistency-job');

/**
 * docs/25 Phase 1 — stock integrity across every channel.
 *
 * The defect under test: before this phase a paid web order never touched
 * inventory at all (no `stock_quantity` write existed outside the POS and the
 * catalog), so the shop could sell the same unit online and again at the till.
 * The second half is the ledger invariant — every stock change must post an
 * `inventory_movements` row, or the drift job alerts on normal work and
 * becomes noise.
 */
test('inventory integrity: web orders, duplicate webhooks, reversal, catalog edits, drift', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for the inventory integrity E2E.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const rawCookie of setCookies) {
      const [pair] = rawCookie.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.message}`), { response, body });
    return body.data;
  }

  const stockOf = async (variantId) => {
    const { rows } = await db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId]);
    return Number(rows[0].stock_quantity);
  };
  const movementsFor = async (orderId, reason) => {
    const { rows } = await db.query(
      `SELECT delta, reason, metadata FROM inventory_movements
        WHERE reference_type = 'order' AND reference_id = $1 AND reason = $2`,
      [orderId, reason],
    );
    return rows;
  };

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Inventory E2E Product',$3,'active',5000,10) RETURNING id`,
      [tenantId, `INV-E2E-${runId}`, `inv-e2e-${runId}`],
    );
    const productId = product.rows[0].id;
    const variant = await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',5000,10,true) RETURNING id`,
      [tenantId, productId, `INV-E2E-V-${runId}`, `INV-E2E-B-${runId}`],
    );
    const variantId = variant.rows[0].id;

    async function createPaidOrder(quantity, suffix) {
      const order = await db.query(
        `INSERT INTO orders (
           tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
           subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents,
           shipping_address, billing_address, paid_at, metadata
         ) VALUES ($1,$2,'Web Customer','completed','paid','processing',
           $3,0,0,0,$3,'{}'::jsonb,'{}'::jsonb, now(), '{}'::jsonb)
         RETURNING id`,
        [tenantId, `WEB-${runId}-${suffix}`, 5000 * quantity],
      );
      await db.query(
        `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price_cents, total_cents)
         VALUES ($1,$2,$3,$4,$5,'Inventory E2E Product',$6,5000,$7)`,
        [tenantId, order.rows[0].id, productId, variantId, `INV-E2E-V-${runId}`, quantity, 5000 * quantity],
      );
      return order.rows[0].id;
    }

    // ── A paid web order decrements stock and writes the ledger ─────────────
    const orderId = await createPaidOrder(3, 'A');
    const applied = await ensurePaidOrderStock(tenantId, orderId, { source: 'test' });
    assert.equal(applied.applied, true);
    assert.deepEqual(applied.shortages, []);
    assert.equal(await stockOf(variantId), 7, 'stock must drop by the ordered quantity');

    const saleMovements = await movementsFor(orderId, 'web_order');
    assert.equal(saleMovements.length, 1);
    assert.equal(Number(saleMovements[0].delta), -3);

    // The parent product total is re-summed from its variants, so the catalog
    // figure cannot drift away from the variant figure.
    const productRow = await db.query('SELECT stock_quantity FROM products WHERE id = $1', [productId]);
    assert.equal(Number(productRow.rows[0].stock_quantity), 7);

    // ── A duplicate delivery must not decrement twice ───────────────────────
    // Sadad delivers webhooks more than once by design; this is the property
    // that makes calling it from both the webhook and the callback safe.
    const duplicate = await ensurePaidOrderStock(tenantId, orderId, { source: 'test-duplicate' });
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.reason, 'already_applied');
    assert.equal(await stockOf(variantId), 7, 'a duplicate webhook must not decrement again');
    assert.equal((await movementsFor(orderId, 'web_order')).length, 1);

    // ── An unpaid order is never applied ────────────────────────────────────
    const unpaid = await db.query(
      `INSERT INTO orders (tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_address, billing_address, metadata)
       VALUES ($1,$2,'Web Customer','placed','pending','awaiting',5000,0,0,0,5000,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)
       RETURNING id`,
      [tenantId, `WEB-${runId}-UNPAID`],
    );
    const unpaidResult = await ensurePaidOrderStock(tenantId, unpaid.rows[0].id, { source: 'test' });
    assert.equal(unpaidResult.applied, false);
    assert.equal(unpaidResult.reason, 'order_not_paid');
    assert.equal(await stockOf(variantId), 7);

    // ── Overselling keeps the money, floors stock, and flags the order ──────
    // The payment already happened; rejecting is not an option. This mirrors
    // the POS's own offline policy: never discard a completed financial fact.
    const oversoldOrderId = await createPaidOrder(12, 'OVERSOLD');
    const oversold = await ensurePaidOrderStock(tenantId, oversoldOrderId, { source: 'test' });
    assert.equal(oversold.applied, true);
    assert.equal(oversold.shortages.length, 1);
    assert.equal(oversold.shortages[0].missing, 5, 'ordered 12 against 7 available');
    assert.equal(await stockOf(variantId), 0, 'stock floors at zero, never negative');

    const oversoldMovement = await movementsFor(oversoldOrderId, 'web_order');
    assert.equal(Number(oversoldMovement[0].delta), -7, 'only what was actually available is taken');
    assert.equal(oversoldMovement[0].metadata.shortageQuantity, 5);

    const timeline = await db.query(
      `SELECT detail, metadata FROM order_timeline_entries WHERE order_id = $1 AND kind = 'note'`,
      [oversoldOrderId],
    );
    assert.equal(timeline.rowCount, 1, 'whoever fulfils the order must be told');
    assert.equal(timeline.rows[0].metadata.shortages.length, 1);

    // ── Cancelling reverses exactly what was applied ────────────────────────
    const reversed = await reversePaidOrderStock(tenantId, oversoldOrderId, { reason: 'cancelled' });
    assert.equal(reversed.reversed, true);
    assert.equal(await stockOf(variantId), 7, 'reverses the 7 actually taken, not the 12 ordered');

    const doubleReverse = await reversePaidOrderStock(tenantId, oversoldOrderId, { reason: 'cancelled' });
    assert.equal(doubleReverse.reversed, false);
    assert.equal(doubleReverse.reason, 'already_reversed');
    assert.equal(await stockOf(variantId), 7, 'reversal is idempotent');

    // ── The backlog sweep repairs an order that missed its decrement ────────
    // This is what makes the guarantee independent of a webhook arriving twice.
    const missedOrderId = await createPaidOrder(2, 'MISSED');
    const sweep = await applyMissingPaidOrderStock({ sinceHours: 48, limit: 50, tenantId });
    assert.ok(sweep.repaired >= 1);
    assert.equal(await stockOf(variantId), 5);
    assert.equal((await movementsFor(missedOrderId, 'web_order')).length, 1);

    // ── Catalog edits post ledger rows, so drift stays meaningful ───────────
    const beforeEdit = await stockOf(variantId);
    await api('/admin/products/bulk-stock', {
      method: 'PATCH',
      body: JSON.stringify({ updates: [{ sku: `INV-E2E-V-${runId}`, stock: beforeEdit + 25 }] }),
    });
    assert.equal(await stockOf(variantId), beforeEdit + 25);

    const editMovements = await db.query(
      `SELECT delta, reason FROM inventory_movements
        WHERE variant_id = $1 AND reason = 'bulk_import' ORDER BY occurred_at DESC LIMIT 1`,
      [variantId],
    );
    assert.equal(editMovements.rowCount, 1, 'a manual stock edit must not be invisible to the ledger');
    assert.equal(Number(editMovements.rows[0].delta), 25);

    // ── The invariant: current stock reconciles against baseline + ledger ───
    // If this fails, the hourly drift job would be alerting on normal work,
    // which is what makes an alert get ignored.
    const drifted = await findDrift(tenantId);
    const ourDrift = drifted.filter((row) => row.variant_id === variantId);
    assert.deepEqual(ourDrift, [], 'no drift after a mixed order/reversal/catalog-edit sequence');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
