const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `product-color-gallery-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Color Gallery E2E';
process.env.DEFAULT_ADMIN_EMAIL = `product-color-gallery-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'product-color-gallery-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Color Gallery Test Owner';
process.env.SESSION_SECRET = `product-color-gallery-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// A colour can hold several gallery images. The one flagged as its cover is what the
// collection card, the cart and the first slide of the product page use; the full list
// per colour comes back as colorGalleries, cover first.
test('colour galleries keep every image per colour and the chosen cover leads', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

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

    const img = (name) => `/uploads/${runId}-${name}.jpg`;
    const images = [img('b1'), img('b2'), img('b3'), img('s1'), img('s2'), img('shared')];
    const imageColors = {
      [images[0]]: 'Black', [images[1]]: 'Black', [images[2]]: 'Black',
      [images[3]]: 'Sage', [images[4]]: 'Sage',
    };
    const payload = {
      name: 'E2E Gallery Tote',
      sku: `GAL-${runId}`,
      brand: 'Elite Test',
      price: 300,
      stock: 4,
      variants: [
        { sku: `GAL-${runId}-B`, size: '1', color: 'Black', price: 300, stock: 2 },
        { sku: `GAL-${runId}-S`, size: '1', color: 'Sage', price: 300, stock: 2 },
      ],
      images,
      imageColors,
      colorCovers: { Black: images[1] },
    };
    const created = await api('/admin/products', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(created.colorCovers.black, images[1], 'the picked cover is stored');
    assert.equal(created.colorCovers.sage, images[3], 'no pick falls back to the first image of the colour');

    const publicRes = await fetch(`${base}/products/${created.id}`);
    const { data: pub } = await publicRes.json();
    const tail = (url) => String(url).split('/').pop();
    assert.equal(tail(pub.colorImages.black), tail(images[1]), 'card image of Black is its cover');
    assert.deepEqual(pub.colorGalleries.black.map(tail), [images[1], images[0], images[2]].map(tail), 'cover first, then gallery order');
    assert.deepEqual(pub.colorGalleries.sage.map(tail), [images[3], images[4]].map(tail));

    // A cover whose image is no longer tagged with the colour is ignored.
    const retagged = await api(`/admin/products/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, id: created.id, imageColors: { ...imageColors, [images[1]]: 'Sage' } }),
    });
    assert.equal(retagged.colorCovers.black, images[0]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
