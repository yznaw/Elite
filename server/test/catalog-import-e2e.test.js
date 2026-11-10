const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `catalog-import-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Catalog Import E2E';
process.env.DEFAULT_ADMIN_EMAIL = `catalog-import-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'catalog-import-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Catalog Import Test Owner';
process.env.SESSION_SECRET = `catalog-import-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('catalog review snapshot commits once, history persists, and stock preview validates before commit', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of values) {
      const [pair] = raw.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    return response;
  }

  async function json(path, options = {}) {
    const response = await request(path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${body.message}`);
    return body.data;
  }

  async function ndjson(path, options = {}) {
    const response = await request(path, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text}`);
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  try {
    const user = await json('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const productSku = `IMPORT-${runId}`;
    const variantSku = `${productSku}-ONE`;
    const productCsv = [
      'Product SKU,Variant SKU,English Name,Arabic Name,Brand,Status,POS Status,Selling Price,Quantity',
      `${productSku},${variantSku},Import Test,اختبار الاستيراد,Elite,hidden,active,125,4`,
    ].join('\n');
    const reviewForm = new FormData();
    reviewForm.append('csv', new Blob([productCsv], { type: 'text/csv' }), 'products.csv');
    const reviewEvents = await ndjson('/admin/bulk-import?dryRun=true&imageMode=ignore', { method: 'POST', body: reviewForm });
    const reviewDone = reviewEvents.find(event => event.type === 'done');
    assert.ok(reviewDone?.jobId);
    assert.equal(reviewDone.summary.created, 1);

    const beforeCommit = await db.query('SELECT id FROM products WHERE tenant_id=$1 AND sku=$2', [tenantId, productSku]);
    assert.equal(beforeCommit.rowCount, 0, 'review must not write products');

    const commitEvents = await ndjson(`/admin/bulk-import?reviewId=${reviewDone.jobId}`, { method: 'POST' });
    const commitDone = commitEvents.find(event => event.type === 'done');
    assert.equal(commitDone.jobId, reviewDone.jobId, 'commit reuses the reviewed snapshot job');
    assert.equal(commitDone.summary.created, 1);

    const saved = await db.query(
      `SELECT p.id, p.pos_status, pt.name AS name_ar, pv.id AS variant_id, pv.stock_quantity
         FROM products p
         JOIN product_variants pv ON pv.product_id=p.id
         LEFT JOIN product_translations pt ON pt.product_id=p.id AND pt.locale='ar'
        WHERE p.tenant_id=$1 AND p.sku=$2`,
      [tenantId, productSku],
    );
    assert.equal(saved.rowCount, 1);
    assert.equal(saved.rows[0].pos_status, 'active');
    assert.equal(saved.rows[0].name_ar, 'اختبار الاستيراد');
    assert.equal(Number(saved.rows[0].stock_quantity), 4);

    const history = await json('/admin/bulk-import/history');
    assert.ok(history.some(job => job.id === reviewDone.jobId && job.status === 'completed'));

    const invalidStock = new FormData();
    invalidStock.append('csv', new Blob([`SKU,Stock\n${variantSku},not-a-number`], { type: 'text/csv' }), 'bad-stock.csv');
    const invalidReview = await json('/admin/bulk-import/stock/preview', { method: 'POST', body: invalidStock });
    assert.equal(invalidReview.canCommit, false);
    assert.match(invalidReview.rows[0].errors.join(' '), /whole number/);

    const validStock = new FormData();
    validStock.append('csv', new Blob([`SKU,Stock\n${variantSku},0`], { type: 'text/csv' }), 'stock.csv');
    const stockReview = await json('/admin/bulk-import/stock/preview', { method: 'POST', body: validStock });
    assert.equal(stockReview.canCommit, true);
    assert.equal(stockReview.rows[0].currentStock, 4);
    const stockCommit = await json(`/admin/bulk-import/stock/${stockReview.jobId}/commit`, { method: 'POST' });
    assert.equal(stockCommit.updated, 1);

    const finalStock = await db.query('SELECT stock_quantity FROM product_variants WHERE id=$1', [saved.rows[0].variant_id]);
    assert.equal(Number(finalStock.rows[0].stock_quantity), 0);
    const events = await db.query(
      `SELECT event_type FROM pos_events WHERE tenant_id=$1 AND event_type IN ('catalog.changed','stock.updated')`,
      [tenantId],
    );
    assert.ok(events.rows.some(row => row.event_type === 'catalog.changed'));
    assert.ok(events.rows.some(row => row.event_type === 'stock.updated'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id=$1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
