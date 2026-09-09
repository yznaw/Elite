const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `reference-colors-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Reference Colors E2E';
process.env.DEFAULT_ADMIN_EMAIL = `reference-colors-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'reference-colors-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Reference Colors Owner';
process.env.SESSION_SECRET = `reference-colors-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('reference colors: Arabic edits persist and used/unused deletion is explicit', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
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
    return { response, body: await response.json() };
  }

  async function api(path, options = {}) {
    const result = await raw(path, options);
    if (!result.response.ok) {
      throw Object.assign(new Error(`${result.response.status}: ${result.body.message}`), result);
    }
    return result.body.data;
  }

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const color = await api('/admin/ref/colors', {
      method: 'POST',
      body: JSON.stringify({ name_en: 'Light Grey', name_ar: '', hex: '#D3D3D3', sort_order: 50 }),
    });
    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Reference Color Product',$3,'active',5000,1) RETURNING id`,
      [tenantId, `REF-COLOR-${runId}`, `reference-color-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants
         (tenant_id, product_id, sku, barcode, color, color_ref_id, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'Light Grey',$5,5000,1,true) RETURNING id`,
      [tenantId, product.rows[0].id, `REF-COLOR-V-${runId}`, `REF-COLOR-B-${runId}`, color.id],
    );

    const updated = await api(`/admin/ref/colors/${color.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...color, name_ar: 'رمادي فاتح' }),
    });
    assert.equal(updated.name_ar, 'رمادي فاتح');
    assert.equal(updated.variant_count, 1, 'editing must preserve the authoritative usage count');

    const afterReload = await api('/admin/ref/colors');
    assert.equal(afterReload.find((item) => item.id === color.id)?.name_ar, 'رمادي فاتح');

    const publicColors = await raw('/ref/colors');
    assert.equal(publicColors.response.headers.get('cache-control'), 'no-store');
    assert.equal(publicColors.body.data.find((item) => item.id === color.id)?.name_ar, 'رمادي فاتح');

    const guarded = await raw(`/admin/ref/colors/${color.id}`, { method: 'DELETE' });
    assert.equal(guarded.response.status, 409);
    assert.equal(guarded.body.variantCount, 1);

    await api(`/admin/ref/colors/${color.id}?force=true`, { method: 'DELETE' });
    const survivingVariant = await db.query(
      'SELECT color, color_ref_id FROM product_variants WHERE id = $1',
      [variant.rows[0].id],
    );
    assert.equal(survivingVariant.rows[0].color, 'Light Grey');
    assert.equal(survivingVariant.rows[0].color_ref_id, null);

    const unused = await api('/admin/ref/colors', {
      method: 'POST',
      body: JSON.stringify({ name_en: 'Unused Test Color', name_ar: 'لون غير مستخدم', hex: '#123456' }),
    });
    await api(`/admin/ref/colors/${unused.id}`, { method: 'DELETE' });
    const remaining = await api('/admin/ref/colors');
    assert.equal(remaining.some((item) => item.id === unused.id), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
