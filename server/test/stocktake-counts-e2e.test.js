const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `stocktake-counts-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Stocktake Counts E2E';
process.env.DEFAULT_ADMIN_EMAIL = `stocktake-counts-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'stocktake-counts-password';
process.env.DEFAULT_ADMIN_NAME = 'Stocktake Owner';
process.env.SESSION_SECRET = `stocktake-counts-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

/**
 * Team feedback 2026-09-24: exported stocktakes showed an empty Counted column.
 * These pin down what the export is built from (GET /stocktakes/:id), the
 * order it is in, and every way a count may be refused.
 */
test('stocktake counts: per-location counts, size order, blind rules and refusals', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for stocktake E2E.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let tenantId = '';
  let otherTenantId = '';

  /** One cookie jar per signed-in user. */
  function session() {
    let cookie = '';
    let csrfToken = '';
    async function raw(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
      });
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      for (const rawCookie of setCookies) {
        const [pair] = rawCookie.split(';');
        const [name, value] = pair.split('=');
        if (name === 'elite.sid') cookie = pair;
        if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
      }
      const body = await response.json().catch(() => ({}));
      return { status: response.status, body };
    }
    async function api(path, options) {
      const { status, body } = await raw(path, options);
      if (status >= 400) throw Object.assign(new Error(`${status}: ${body.message}`), { status, body });
      return body.data;
    }
    return { raw, api };
  }

  const owner = session();
  const post = (s, path, body) => s.raw(path, { method: 'POST', body: JSON.stringify(body) });

  try {
    const user = await owner.api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    // Two shops plus the warehouse, as at Elite.
    await db.query(
      `INSERT INTO pos_branches (tenant_id, name, is_default) VALUES ($1, 'Al Rayyan Shop', true), ($1, 'The Pearl Shop', false)`,
      [tenantId],
    );

    // One product, one colour, sizes deliberately out of order.
    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Croco Simple',$3,'active',180000,0) RETURNING id`,
      [tenantId, `ST-${runId}`, `st-${runId}`],
    );
    const sizes = ['10', '5', '12.5', 'S', '5.5', '15'];
    const variants = {};
    for (const size of sizes) {
      const row = await db.query(
        `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, color, price_cents, stock_quantity, is_active)
         VALUES ($1,$2,$3,$3,$4,'Green',180000,4,true) RETURNING id`,
        [tenantId, product.rows[0].id, `ST-${runId}-${size}`, size],
      );
      variants[size] = row.rows[0].id;
    }

    const locations = await owner.api('/admin/inventory/stocktake-locations');
    assert.deepEqual(locations.map((l) => l.name).sort(), ['Al Rayyan Shop', 'The Pearl Shop', 'Warehouse']);
    const loc = Object.fromEntries(locations.map((l) => [l.name, l.locationId]));

    // ── Show expected (not blind) over three locations ────────────────────────
    const started = await owner.api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: `Feedback ${runId}`, blind: false, locationIds: locations.map((l) => l.locationId) }),
    });
    const id = started.stocktakeId;
    const count = (variantId, quantity, locationId) => post(owner, `/admin/inventory/stocktakes/${id}/counts`, { variantId, quantity, locationId });

    let view = await owner.api(`/admin/inventory/stocktakes/${id}`);
    assert.deepEqual(view.lines.map((l) => l.size), ['5', '5.5', '10', '12.5', '15', 'S'], 'sizes sort as numbers, named sizes last');
    assert.ok(view.lines.every((l) => l.expectedQuantity === 4), 'an open count shows the expected quantity');

    // Positive: counts are kept per location and returned for the export.
    assert.equal((await count(variants['5'], 2, loc['Al Rayyan Shop'])).status, 200);
    assert.equal((await count(variants['5'], 1, loc['The Pearl Shop'])).status, 200);
    assert.equal((await count(variants['5'], 0, loc.Warehouse)).status, 200, 'zero is a real count');
    assert.equal((await count(variants['10'], '3', loc['Al Rayyan Shop'])).status, 200, 'a numeric string is accepted');
    view = await owner.api(`/admin/inventory/stocktakes/${id}`);
    const five = view.lines.find((l) => l.size === '5');
    assert.deepEqual(five.locationCounts, { [loc['Al Rayyan Shop']]: 2, [loc['The Pearl Shop']]: 1, [loc.Warehouse]: 0 });
    assert.deepEqual(view.lines.find((l) => l.size === '10').locationCounts, { [loc['Al Rayyan Shop']]: 3 });
    assert.equal(five.countedQuantity, null, 'the stocktake total waits for every location to finish');

    // Positive: saving the same count again changes nothing (re-import of an unchanged sheet).
    assert.equal((await count(variants['5'], 2, loc['Al Rayyan Shop'])).status, 200);
    view = await owner.api(`/admin/inventory/stocktakes/${id}`);
    assert.equal(view.lines.find((l) => l.size === '5').locationCounts[loc['Al Rayyan Shop']], 2);

    // Negative: a count must be a whole, non-negative number.
    for (const bad of [-1, 1.5, '1.5', 'abc', '5pcs', '', null]) {
      const response = await count(variants['5'], bad, loc['Al Rayyan Shop']);
      assert.equal(response.status, 422, `refuses ${JSON.stringify(bad)}`);
    }
    view = await owner.api(`/admin/inventory/stocktakes/${id}`);
    assert.equal(view.lines.find((l) => l.size === '5').locationCounts[loc['Al Rayyan Shop']], 2, 'a refused count changes nothing');

    // Negative: variant outside the stocktake, missing/unknown location.
    assert.equal((await count('00000000-0000-4000-8000-000000000000', 1, loc['Al Rayyan Shop'])).status, 404);
    assert.equal((await count(variants['5'], 1, undefined)).status, 422, 'a multi-location count needs its location');
    assert.equal((await count(variants['5'], 1, '00000000-0000-4000-8000-000000000000')).status, 404);

    // Negative: a completed location is read-only until reopened.
    for (const size of sizes) await count(variants[size], 1, loc.Warehouse);
    assert.equal((await post(owner, `/admin/inventory/stocktakes/${id}/locations/${loc.Warehouse}/complete`, {})).status, 200);
    const locked = await count(variants['5'], 7, loc.Warehouse);
    assert.equal(locked.status, 409);
    assert.equal(locked.body.code, 'LOCATION_COMPLETED');

    // Positive: once every location is complete, the total is the sum.
    for (const name of ['Al Rayyan Shop', 'The Pearl Shop']) {
      for (const size of sizes) {
        if (!view.lines.find((l) => l.size === size).locationCounts[loc[name]] && !(size === '5')) await count(variants[size], 1, loc[name]);
      }
      assert.equal((await post(owner, `/admin/inventory/stocktakes/${id}/locations/${loc[name]}/complete`, {})).status, 200);
    }
    view = await owner.api(`/admin/inventory/stocktakes/${id}`);
    assert.equal(view.lines.find((l) => l.size === '5').countedQuantity, 2 + 1 + 1, 'Rayyan 2 + Pearl 1 + Warehouse 1');

    // Negative: a viewer cannot read or write stocktakes.
    const viewerEmail = `stocktake-viewer-${runId}@elite.local`;
    await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status)
       VALUES ($1,$2,$3,'Viewer','VW','viewer','active')`,
      [tenantId, viewerEmail, await bcrypt.hash('viewer-password', 10)],
    );
    const viewer = session();
    await viewer.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: viewerEmail, password: 'viewer-password' }) });
    assert.equal((await viewer.raw(`/admin/inventory/stocktakes/${id}`)).status, 403);
    assert.equal((await post(viewer, `/admin/inventory/stocktakes/${id}/counts`, { variantId: variants['5'], quantity: 1, locationId: loc.Warehouse })).status, 403);

    // Negative: another tenant's stocktake is invisible.
    const other = await db.query(`INSERT INTO tenants (slug, name) VALUES ($1, 'Other') RETURNING id`, [`other-${runId}`]);
    otherTenantId = other.rows[0].id;
    const foreign = await db.query(
      `INSERT INTO stocktakes (tenant_id, reference, started_by_user_id) VALUES ($1, 'Foreign', $2) RETURNING id`,
      [otherTenantId, user.id],
    );
    assert.equal((await owner.raw(`/admin/inventory/stocktakes/${foreign.rows[0].id}`)).status, 404);
    assert.equal((await post(owner, `/admin/inventory/stocktakes/${foreign.rows[0].id}/counts`, { variantId: variants['5'], quantity: 1 })).status, 404);

    // Negative: a cancelled stocktake takes no counts.
    assert.equal((await post(owner, `/admin/inventory/stocktakes/${id}/cancel`, {})).status, 200);
    const closed = await count(variants['5'], 1, loc['Al Rayyan Shop']);
    assert.equal(closed.status, 409);
    assert.equal(closed.body.code, 'STOCKTAKE_CLOSED');

    // ── Blind: the expected figure never leaves the server while counting ───
    const blind = await owner.api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: `Blind ${runId}`, blind: true, locationIds: [loc.Warehouse] }),
    });
    view = await owner.api(`/admin/inventory/stocktakes/${blind.stocktakeId}`);
    assert.ok(view.lines.every((l) => l.expectedQuantity === null && l.currentStock === null && l.discrepancy === null));
    assert.ok(!JSON.stringify(view).includes('"expected_quantity"'));
    await post(owner, `/admin/inventory/stocktakes/${blind.stocktakeId}/cancel`, {});
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (otherTenantId) await db.query('DELETE FROM tenants WHERE id = $1', [otherTenantId]).catch(() => undefined);
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
