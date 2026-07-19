const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-recon-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Reconciliation E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-recon-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-recon-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Recon Test Owner';
process.env.SESSION_SECRET = `pos-recon-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('card settlement reconciliation: matched, exception, resolve-requires-note', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS reconciliation E2E.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
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

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const product = await db.query(
      `INSERT INTO products
        (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','POS Recon E2E Product',$3,'active',5000,10)
       RETURNING id`,
      [tenantId, `POS-RECON-E2E-${runId}`, `pos-recon-e2e-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants
        (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',5000,10,true)
       RETURNING id`,
      [tenantId, product.rows[0].id, `POS-RECON-E2E-V-${runId}`, `E2ERECON${Date.now()}`],
    );
    const variantId = variant.rows[0].id;

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Recon Register ${runId}` }),
    });
    const register = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    const registerId = register.registerId;
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });

    // Ring up one card sale for QAR 50.00 (5000 cents).
    await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `recon-sale-${runId}`,
        receiptNumber: block.start,
        shiftId: shift.shiftId,
        customerId: null,
        items: [{ variantId, quantity: 1, unitPriceCents: 5000 }],
        payment: {
          method: 'card', cashAmountCents: 0, cardAmountCents: 5000, amountTenderedCents: 0, changeGivenCents: 0,
          terminalReference: 'TERM-0001',
        },
        clientCreatedAt: new Date().toISOString(),
      }),
    });

    const businessDate = new Date().toISOString().slice(0, 10);

    // Refresh with no settlement entered yet — should report the live POS total.
    const refreshed = await api('/admin/pos-reconciliation/refresh', {
      method: 'POST',
      body: JSON.stringify({ registerId, businessDate }),
    });
    assert.equal(refreshed.posTotalCents, 5000);
    assert.equal(refreshed.status, 'pending');

    // Settlement matches within tolerance -> auto-matched.
    const matched = await api('/admin/pos-reconciliation/settlement', {
      method: 'POST',
      body: JSON.stringify({ registerId, businessDate, settlementTotalCents: 5000 }),
    });
    assert.equal(matched.status, 'matched');
    assert.equal(matched.varianceCents, 0);

    // Re-submitting with a mismatch beyond tolerance -> exception.
    const exception = await api('/admin/pos-reconciliation/settlement', {
      method: 'POST',
      body: JSON.stringify({ registerId, businessDate, settlementTotalCents: 4700 }),
    });
    assert.equal(exception.status, 'exception');
    assert.equal(exception.varianceCents, -300);

    // Cannot resolve without a note.
    await assert.rejects(
      api(`/admin/pos-reconciliation/${exception.reconciliationId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note: '' }),
      }),
      /422/,
    );

    // Resolving with a note succeeds.
    const resolved = await api(`/admin/pos-reconciliation/${exception.reconciliationId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Acquirer deducted a QAR 3.00 monthly terminal fee before settlement.' }),
    });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.notes, 'Acquirer deducted a QAR 3.00 monthly terminal fee before settlement.');

    // A second exception cannot be resolved twice.
    const secondException = await api('/admin/pos-reconciliation/settlement', {
      method: 'POST',
      body: JSON.stringify({ registerId, businessDate, settlementTotalCents: 4700 }),
    });
    assert.equal(secondException.status, 'exception');
    assert.equal(secondException.reconciliationId, exception.reconciliationId);

    const list = await api(`/admin/pos-reconciliation?registerId=${registerId}`);
    assert.ok(list.some((r) => r.reconciliationId === exception.reconciliationId));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
