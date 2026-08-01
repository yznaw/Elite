const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `invops-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Inventory Ops E2E';
process.env.DEFAULT_ADMIN_EMAIL = `invops-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'invops-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Inventory Ops Owner';
process.env.SESSION_SECRET = `invops-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { findDrift } = require('../lib/pos/inventory-consistency-job');

/**
 * docs/25 Phase 8 — stock adjustments and stocktakes.
 *
 * The property that carries the most risk is the stocktake arithmetic. A count
 * takes time and the shop keeps selling during it, so writing the counted
 * number back as an absolute silently reverses every sale made in between.
 * That case is tested explicitly below.
 */
test('inventory operations: adjustments, blind stocktake, and sales during a count', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required.');

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

  async function raw(path, options = {}) {
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
    return { response, body };
  }

  async function api(path, options = {}) {
    const { response, body } = await raw(path, options);
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.message}`), { response, body });
    return body.data;
  }

  const stockOf = async (variantId) => {
    const { rows } = await db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId]);
    return Number(rows[0].stock_quantity);
  };

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Inv Ops Product',$3,'active',5000,0) RETURNING id`,
      [tenantId, `INVOPS-${runId}`, `invops-${runId}`],
    );
    const productId = product.rows[0].id;
    const makeVariant = async (suffix, stock) => {
      const result = await db.query(
        `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
         VALUES ($1,$2,$3,$4,$5,5000,$6,true) RETURNING id`,
        [tenantId, productId, `INVOPS-V-${suffix}-${runId}`, `INVOPSB-${suffix}-${runId}`, suffix, stock],
      );
      return result.rows[0].id;
    };
    const variantA = await makeVariant('M', 20);
    const variantB = await makeVariant('L', 10);

    // ── Manual adjustment ───────────────────────────────────────────────────
    const damaged = await api('/admin/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({ variantId: variantA, delta: -3, reason: 'damaged', note: 'Water damage in the stockroom' }),
    });
    assert.equal(damaged.before, 20);
    assert.equal(damaged.after, 17);
    assert.equal(await stockOf(variantA), 17);

    const movement = await db.query(
      `SELECT delta, reason, metadata FROM inventory_movements
        WHERE variant_id = $1 AND reason = 'manual_adjustment' ORDER BY occurred_at DESC LIMIT 1`,
      [variantA],
    );
    assert.equal(Number(movement.rows[0].delta), -3);
    assert.equal(movement.rows[0].metadata.adjustmentReason, 'damaged');
    assert.equal(movement.rows[0].metadata.note, 'Water damage in the stockroom');

    // The reason is a closed list, so the shrinkage report can group on it —
    // free text would make "damaged", "Damaged" and "broken" three categories.
    const badReason = await raw('/admin/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({ variantId: variantA, delta: -1, reason: 'because' }),
    });
    assert.equal(badReason.response.status, 422);
    assert.equal(badReason.body.code, 'INVALID_FIELD');

    // A write-off reason cannot be used to invent stock.
    const wrongSign = await raw('/admin/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({ variantId: variantA, delta: 5, reason: 'damaged' }),
    });
    assert.equal(wrongSign.response.status, 422);

    // Stock can never be driven below zero.
    const tooMuch = await raw('/admin/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({ variantId: variantB, delta: -999, reason: 'lost' }),
    });
    assert.equal(tooMuch.response.status, 422);
    assert.equal(tooMuch.body.code, 'INSUFFICIENT_STOCK');
    assert.equal(await stockOf(variantB), 10, 'a rejected adjustment must not move stock');

    // ── Blind stocktake ─────────────────────────────────────────────────────
    const stocktake = await api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: `ST-${runId}`, blind: true, variantIds: [variantA, variantB] }),
    });
    assert.equal(stocktake.status, 'counting');
    assert.equal(stocktake.lineCount, 2);

    // Blind means the counter cannot see what the system expects. A count taken
    // while looking at the expected figure tends to agree with it.
    const blindView = await api(`/admin/inventory/stocktakes/${stocktake.stocktakeId}`);
    assert.equal(blindView.lines[0].expectedQuantity, null);
    assert.equal(blindView.lines[0].currentStock, null);

    // Only one open stocktake at a time.
    const second = await raw('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: `ST-${runId}-2` }),
    });
    assert.equal(second.response.status, 409);
    assert.equal(second.body.code, 'STOCKTAKE_IN_PROGRESS');

    // Counter finds 15 of A (expected 17 — two are genuinely missing)
    // and 10 of B (matches).
    await api(`/admin/inventory/stocktakes/${stocktake.stocktakeId}/counts`, {
      method: 'POST',
      body: JSON.stringify({ variantId: variantA, quantity: 15 }),
    });
    await api(`/admin/inventory/stocktakes/${stocktake.stocktakeId}/counts`, {
      method: 'POST',
      body: JSON.stringify({ variantId: variantB, quantity: 10 }),
    });

    // ── The case that breaks naive implementations ──────────────────────────
    // Three units of A sell between the count and the posting. Writing the
    // counted number (15) back as an absolute would undo those three sales.
    // What must happen: the discrepancy (-2) is applied to current stock (14),
    // giving 12 — the two missing units are written off, the three sales stand.
    // Simulated the way a real sale does it — stock and ledger together. A
    // bare `UPDATE product_variants` here would be an unledgered write, and the
    // drift check at the end of this test correctly catches that (it did, on
    // the first run of this file: baseline 20, ledger -5, stock 12, drift -3).
    await db.query('UPDATE product_variants SET stock_quantity = stock_quantity - 3 WHERE id = $1', [variantA]);
    await db.query(
      `INSERT INTO inventory_movements (tenant_id, product_id, variant_id, delta, reason, reference_type)
       VALUES ($1, $2, $3, -3, 'pos_sale', 'pos_transaction')`,
      [tenantId, productId, variantA],
    );
    assert.equal(await stockOf(variantA), 14);

    const posted = await api(`/admin/inventory/stocktakes/${stocktake.stocktakeId}/post`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(posted.adjustedLines, 1, 'only the line with a real discrepancy moves');
    assert.equal(
      await stockOf(variantA),
      12,
      'the discrepancy is applied to current stock — sales made during the count must survive',
    );
    assert.equal(await stockOf(variantB), 10, 'a line that matched must not move');

    const stocktakeMovement = await db.query(
      `SELECT delta, reason, metadata FROM inventory_movements
        WHERE reference_type = 'stocktake' AND reference_id = $1`,
      [stocktake.stocktakeId],
    );
    assert.equal(stocktakeMovement.rowCount, 1);
    assert.equal(Number(stocktakeMovement.rows[0].delta), -2);
    assert.equal(stocktakeMovement.rows[0].metadata.discrepancy, -2);
    assert.equal(stocktakeMovement.rows[0].metadata.expectedAtCount, 17);
    assert.equal(stocktakeMovement.rows[0].metadata.counted, 15);
    assert.equal(
      stocktakeMovement.rows[0].metadata.soldDuringCount,
      3,
      'the movement records why the applied delta is not simply counted-minus-expected',
    );

    // A posted stocktake is immutable.
    const repost = await raw(`/admin/inventory/stocktakes/${stocktake.stocktakeId}/post`, { method: 'POST', body: '{}' });
    assert.equal(repost.response.status, 409);
    assert.equal(repost.body.code, 'STOCKTAKE_POSTED');

    const closedCount = await raw(`/admin/inventory/stocktakes/${stocktake.stocktakeId}/counts`, {
      method: 'POST',
      body: JSON.stringify({ variantId: variantA, quantity: 99 }),
    });
    assert.equal(closedCount.response.status, 409);

    // ── A recount that disagrees blocks posting ─────────────────────────────
    const second2 = await api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: `ST-${runId}-B`, blind: false, variantIds: [variantB] }),
    });
    await api(`/admin/inventory/stocktakes/${second2.stocktakeId}/counts`, {
      method: 'POST', body: JSON.stringify({ variantId: variantB, quantity: 8 }),
    });
    await api(`/admin/inventory/stocktakes/${second2.stocktakeId}/counts`, {
      method: 'POST', body: JSON.stringify({ variantId: variantB, quantity: 9 }),
    });

    const disagreement = await raw(`/admin/inventory/stocktakes/${second2.stocktakeId}/post`, {
      method: 'POST', body: '{}',
    });
    assert.equal(disagreement.response.status, 409);
    assert.equal(disagreement.body.code, 'RECOUNT_DISAGREEMENT', 'two counts that disagree are a question, not a result');
    assert.equal(await stockOf(variantB), 10, 'a blocked posting must not have moved anything');

    // Posting explicitly accepting the recount uses the recount as final: 9
    // against an expected 10 is a discrepancy of -1.
    await api(`/admin/inventory/stocktakes/${second2.stocktakeId}/post`, {
      method: 'POST',
      body: JSON.stringify({ acceptRecountDisagreement: true }),
    });
    assert.equal(await stockOf(variantB), 9);

    // ── The ledger invariant still holds after all of it ────────────────────
    const drifted = await findDrift(tenantId);
    assert.deepEqual(
      drifted.filter((row) => [variantA, variantB].includes(row.variant_id)),
      [],
      'every adjustment and stocktake posting must reconcile against the ledger',
    );

    // Both operations are audited by name, not just by number.
    const audits = await db.query(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND action LIKE 'inventory.%' ORDER BY occurred_at`,
      [tenantId],
    );
    const actions = audits.rows.map((row) => row.action);
    assert.ok(actions.includes('inventory.adjusted'));
    assert.ok(actions.includes('inventory.stocktake.started'));
    assert.ok(actions.includes('inventory.stocktake.posted'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
