const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `cart-pricing-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Cart Pricing E2E';
process.env.SESSION_SECRET = `cart-pricing-e2e-session-${runId}`;
// The delivery fee is quoted server-side through NBOX when it is configured; this
// test covers the unconfigured path, where delivery is free.
for (const key of ['NBOX_API_BASE_URL', 'NBOX_API_TOKEN', 'NBOX_LOGIN_EMAIL', 'NBOX_LOGIN_PASSWORD']) delete process.env[key];

const db = require('../db/client');
const { startServer } = require('../index');

/**
 * The bag and the checkout used to take each line's price from the request, and the
 * order total (what the payment gateway charges) was summed from it. The request could
 * also mark the order paid. These pin the catalog as the only source of price and
 * identity, and the gateway as the only way to pay.
 */
test('cart pricing: the catalog prices every line, never the request', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for the cart pricing E2E.');

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

  const buyer = {
    customer: { firstName: 'Noor', lastName: 'Al-Kuwari', email: `cart-pricing-${runId}@example.com`, phone: '+97433445566' },
    shippingAddress: { line1: 'Zone 66, Street 900, Building 12', city: 'Doha', country: 'Qatar', phone: '+97433445566' },
    shippingQuote: { available: true, amount: 0, currency: 'QAR' },
  };
  const checkout = (items, extra = {}) => call('/carts/checkout', {
    method: 'POST',
    body: JSON.stringify({ ...buyer, items, ...extra }),
  });

  try {
    assert.equal((await call('/carts/current')).status, 200);
    tenantId = (await db.query('SELECT id FROM tenants WHERE slug = $1', [process.env.DEFAULT_TENANT_SLUG])).rows[0].id;

    async function product(name, status = 'active', basePriceCents = 120000) {
      const row = await db.query(
        `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
         VALUES ($1,$2,'Elite',$3,$4,$5,$6,10) RETURNING id`,
        [tenantId, `PRICE-${name}-${runId}`, name, `price-${name}-${runId}`.toLowerCase(), status, basePriceCents],
      );
      return row.rows[0].id;
    }
    async function variant(productId, code, size, color, priceCents) {
      const row = await db.query(
        `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, color, price_cents, stock_quantity, is_active)
         VALUES ($1,$2,$3,$3,$4,$5,$6,5,true) RETURNING id`,
        [tenantId, productId, `PRICE-${code}-${runId}`, size, color, priceCents],
      );
      return row.rows[0].id;
    }

    const sandal = await product('Sandal');
    const sandal42 = await variant(sandal, 'S42', '42', 'Black', 105000);
    const other = await product('Other');
    const other40 = await variant(other, 'O40', '40', 'Brown', 90000);
    const hidden = await product('Hidden', 'hidden');
    const hidden40 = await variant(hidden, 'H40', '40', 'Black', 90000);

    const line = {
      productId: sandal, variantId: sandal42, name: 'Sandal', price: 1, size: 42, color: 'Black', quantity: 1,
    };

    // ── A forged price is ignored when the line goes in the bag ─────────────
    const added = await call('/carts/current/items', { method: 'POST', body: JSON.stringify(line) });
    assert.equal(added.status, 200);
    assert.equal(added.body.data.items[0].price, 1050, 'the bag shows the catalog price');

    // ── Checkout: forged price, forged "paid", forged zero-cost quantity ────
    const order = await checkout([{ ...line, qty: -3 }], {
      payment: { provider: 'forged', method: 'forged', status: 'paid' },
      idempotencyKey: `pricing-${runId}`,
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.data.total, 1050, 'total is catalog price x 1 (a negative quantity counts as 1)');
    assert.equal(order.body.data.payment, 'pending', 'only the gateway can mark an order paid');
    const stored = await db.query(
      `SELECT o.total_cents, o.payment_status, oi.unit_price_cents, oi.quantity, oi.product_name, oi.sku
         FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.id = $1`,
      [order.body.data.id],
    );
    assert.equal(Number(stored.rows[0].total_cents), 105000);
    assert.equal(stored.rows[0].payment_status, 'pending');
    assert.equal(Number(stored.rows[0].unit_price_cents), 105000);
    assert.equal(Number(stored.rows[0].quantity), 1);
    assert.equal(stored.rows[0].product_name, 'Sandal', 'name comes from the catalog');
    assert.equal(stored.rows[0].sku, `PRICE-S42-${runId}`, 'sku comes from the catalog');

    // ── Lines that do not describe something on sale are refused ────────────
    const refused = async (label, item) => {
      const result = await checkout([item]);
      assert.equal(result.status, 409, `${label}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.code, 'ITEM_UNAVAILABLE', label);
      return result.body.details[0];
    };
    assert.equal((await refused('variant of another product', { ...line, variantId: other40 })).reason, 'unavailable');
    assert.equal((await refused('size mismatch', { ...line, size: 41 })).reason, 'mismatch');
    assert.equal((await refused('colour mismatch', { ...line, color: 'Brown' })).reason, 'mismatch');
    assert.equal((await refused('no size on a sized product', { ...line, variantId: null })).reason, 'choose_size');
    assert.equal((await refused('hidden product', {
      ...line, productId: hidden, variantId: hidden40, size: 40,
    })).reason, 'unavailable');
    assert.equal((await refused('unknown product', { ...line, productId: 'not-a-uuid' })).reason, 'unknown_product');

    // The same rule guards the bag.
    const badAdd = await call('/carts/current/items', { method: 'POST', body: JSON.stringify({ ...line, variantId: other40 }) });
    assert.equal(badAdd.status, 409);
    assert.equal(badAdd.body.code, 'ITEM_UNAVAILABLE');

    // Colour is compared without case or surrounding space: the storefront is not wrong
    // to send "black " for "Black".
    const casual = await checkout([{ ...line, color: ' black ' }]);
    assert.equal(casual.status, 201, JSON.stringify(casual.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
