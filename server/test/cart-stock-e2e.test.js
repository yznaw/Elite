const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `cart-stock-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Cart Stock E2E';
process.env.SESSION_SECRET = `cart-stock-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

/**
 * A storefront bag used to accept any quantity and only learn about stock at
 * the final checkout call, so a customer could fill in every step and then be
 * told the order failed. The bag now reports what is left per line, refuses
 * adds beyond stock, and the checkout rejection names the exact line.
 */
test('cart stock: add limit, availability on the bag, checkout rejection details', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for the cart stock E2E.');

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

  async function call(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
    });
    captureCookies(response);
    return { status: response.status, body: await response.json() };
  }

  try {
    // Creates the session cart, and with it the tenant.
    assert.equal((await call('/carts/current')).status, 200);
    const tenant = await db.query('SELECT id FROM tenants WHERE slug = $1', [process.env.DEFAULT_TENANT_SLUG]);
    tenantId = tenant.rows[0].id;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Cart Stock Sandal',$3,'active',99900,1) RETURNING id`,
      [tenantId, `CART-E2E-${runId}`, `cart-e2e-${runId}`],
    );
    const productId = product.rows[0].id;
    const variant = await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'39',99900,1,true) RETURNING id`,
      [tenantId, productId, `CART-E2E-V-${runId}`, `CART-E2E-B-${runId}`],
    );
    const variantId = variant.rows[0].id;
    const line = {
      productId, variantId, sku: `CART-E2E-V-${runId}`, name: 'Cart Stock Sandal', price: 999, size: 39, color: 'Green', quantity: 1,
    };

    // ── The last unit goes in, and the bag says one is left ─────────────────
    const first = await call('/carts/current/items', { method: 'POST', body: JSON.stringify(line) });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.items[0].available, 1);

    // ── A second one is refused with the line identified ────────────────────
    const second = await call('/carts/current/items', { method: 'POST', body: JSON.stringify(line) });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'INSUFFICIENT_STOCK');
    assert.equal(second.body.details[0].variantId, variantId);
    assert.equal(second.body.details[0].inBag, 1);
    assert.equal(second.body.details[0].available, 1);
    assert.equal((await call('/carts/current')).body.data.items[0].qty, 1, 'a refused add must not change the bag');

    // ── It sells elsewhere; the bag now reports zero ────────────────────────
    await db.query('UPDATE product_variants SET stock_quantity = 0 WHERE id = $1', [variantId]);
    const bag = (await call('/carts/current')).body.data;
    assert.equal(bag.items[0].available, 0);

    // ── Checkout names the line precisely enough for the storefront to fix it
    const checkout = await call('/carts/checkout', {
      method: 'POST',
      body: JSON.stringify({
        customer: { firstName: 'Noor', lastName: 'Al-Kuwari', email: `cart-e2e-${runId}@example.com`, phone: '+97433445566' },
        shippingAddress: { line1: 'Zone 66, Street 900, Building 12', city: 'Doha', country: 'Qatar', phone: '+97433445566' },
        items: bag.items,
        shippingQuote: { available: true, amount: 20, currency: 'QAR' },
      }),
    });
    assert.equal(checkout.status, 409);
    assert.equal(checkout.body.code, 'INSUFFICIENT_STOCK');
    assert.equal(checkout.body.details[0].variantId, variantId);
    assert.equal(String(checkout.body.details[0].size), '39');
    assert.equal(checkout.body.details[0].color, 'Green');
    assert.equal(checkout.body.details[0].available, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
