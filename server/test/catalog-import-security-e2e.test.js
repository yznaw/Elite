const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `catalog-import-sec-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Catalog Import Security E2E';
process.env.DEFAULT_ADMIN_EMAIL = `catalog-import-sec-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'catalog-import-sec-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Catalog Import Security Owner';
process.env.SESSION_SECRET = `catalog-import-sec-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// Covers three fixes from the docs/34 Phase 3 security/reliability pass:
//   - bulk-import is restricted to owner/admin (a manager account gets 403)
//   - a stale preview (catalog changed after preview, before commit) is
//     rejected with a clear message instead of silently overwriting the edit
//   - two concurrent commits of the same review cannot both apply — one 200,
//     one 409, and exactly one set of variants/stock movements results
test('bulk-import permissions, stale-review rejection, and double-commit idempotency', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let tenantId = '';

  function makeSession() {
    let cookie = '';
    let csrfToken = '';
    return {
      async request(path, options = {}) {
        const response = await fetch(`${base}${path}`, {
          ...options,
          headers: {
            ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
            ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
            ...(options.headers || {}),
          },
        });
        const values = typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie')].filter(Boolean);
        for (const raw of values) {
          const [pair] = raw.split(';');
          const [name, value] = pair.split('=');
          if (name === 'elite.sid') cookie = pair;
          if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
        }
        return response;
      },
      async json(path, options = {}) {
        const response = await this.request(path, options);
        const body = await response.json();
        return { response, body };
      },
      async ndjson(path, options = {}) {
        const response = await this.request(path, options);
        const text = await response.text();
        return { response, events: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
      },
    };
  }

  try {
    const owner = makeSession();
    const { body: ownerLogin } = await owner.json('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    assert.ok(ownerLogin.success, 'owner login must succeed');
    tenantId = ownerLogin.data.tenantId;

    // ── Permissions: a manager (not owner/admin) is blocked from bulk-import ──
    const managerEmail = `manager-${runId}@elite.local`;
    const managerPassword = 'catalog-import-manager-password';
    await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status)
       VALUES ($1,$2,$3,$4,$5,'manager','active')`,
      [tenantId, managerEmail, await bcrypt.hash(managerPassword, 10), 'Test Manager', 'TM'],
    );
    const manager = makeSession();
    const { body: managerLogin } = await manager.json('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: managerEmail, password: managerPassword }),
    });
    assert.ok(managerLogin.success, 'manager login must succeed');

    const { response: historyResp } = await manager.json('/admin/bulk-import/history');
    assert.equal(historyResp.status, 403, 'a manager must not reach bulk-import endpoints');

    const blockedForm = new FormData();
    blockedForm.append('csv', new Blob(['Product SKU,Variant SKU,English Name,Selling Price,Quantity\nX,X-1,X,1,1'], { type: 'text/csv' }), 'x.csv');
    const { response: importResp } = await manager.json('/admin/bulk-import?dryRun=true', { method: 'POST', body: blockedForm });
    assert.equal(importResp.status, 403, 'a manager must not be able to import products');

    // ── Stale-review rejection ────────────────────────────────────────────
    const sku = `STALE-${runId}`;
    const variantSku = `${sku}-ONE`;
    const initialCsv = [
      'Product SKU,Variant SKU,English Name,Brand,Status,Selling Price,Quantity',
      `${sku},${variantSku},Stale Test Product,Elite,active,100,3`,
    ].join('\n');
    const commitForm = new FormData();
    commitForm.append('csv', new Blob([initialCsv], { type: 'text/csv' }), 'initial.csv');
    const { events: createEvents } = await owner.ndjson('/admin/bulk-import', { method: 'POST', body: commitForm });
    const created = createEvents.find(e => e.type === 'done');
    assert.equal(created.summary.created, 1);

    const updateCsv = [
      'Product SKU,Variant SKU,English Name,Brand,Status,Selling Price,Quantity',
      `${sku},${variantSku},Stale Test Product,Elite,active,150,3`,
    ].join('\n');
    const reviewForm = new FormData();
    reviewForm.append('csv', new Blob([updateCsv], { type: 'text/csv' }), 'update.csv');
    const { events: reviewEvents } = await owner.ndjson('/admin/bulk-import?dryRun=true', { method: 'POST', body: reviewForm });
    const review = reviewEvents.find(e => e.type === 'done');
    assert.ok(review?.jobId);

    // Simulate a concurrent edit landing between preview and commit.
    const productRow = await db.query('SELECT id FROM products WHERE tenant_id=$1 AND sku=$2', [tenantId, sku]);
    await db.query("UPDATE products SET base_price_cents = 20000, updated_at = now() WHERE id = $1", [productRow.rows[0].id]);

    const { response: staleCommitResp, body: staleCommitBody } = await owner.json(`/admin/bulk-import?reviewId=${review.jobId}`, { method: 'POST' });
    assert.equal(staleCommitResp.status, 409, 'a commit against a changed catalog must be rejected');
    assert.match(staleCommitBody.message, /catalog changed/i);

    const jobAfterStale = await db.query('SELECT status FROM catalog_import_jobs WHERE id=$1', [review.jobId]);
    assert.equal(jobAfterStale.rows[0].status, 'review_ready', 'a rejected stale commit must not consume the review');

    const priceAfterStale = await db.query('SELECT base_price_cents FROM products WHERE id=$1', [productRow.rows[0].id]);
    assert.equal(Number(priceAfterStale.rows[0].base_price_cents), 20000, 'the concurrent edit must survive the rejected stale commit');

    // ── Double-commit idempotency ─────────────────────────────────────────
    const raceSku = `RACE-${runId}`;
    const raceVariantSku = `${raceSku}-ONE`;
    const raceCsv = [
      'Product SKU,Variant SKU,English Name,Brand,Status,Selling Price,Quantity',
      `${raceSku},${raceVariantSku},Race Test Product,Elite,active,200,5`,
    ].join('\n');
    const raceReviewForm = new FormData();
    raceReviewForm.append('csv', new Blob([raceCsv], { type: 'text/csv' }), 'race.csv');
    const { events: raceReviewEvents } = await owner.ndjson('/admin/bulk-import?dryRun=true', { method: 'POST', body: raceReviewForm });
    const raceReview = raceReviewEvents.find(e => e.type === 'done');
    assert.ok(raceReview?.jobId);

    const raceSessionA = makeSession();
    const raceSessionB = makeSession();
    await raceSessionA.json('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    await raceSessionB.json('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });

    // Read each response fully (not just headers) so the winner's streamed
    // NDJSON body — and therefore its actual DB writes — has finished before
    // the assertions below inspect the database.
    const readFully = async (promise) => {
      const response = await promise;
      await response.text();
      return response;
    };
    const [raceA, raceB] = await Promise.all([
      readFully(raceSessionA.request(`/admin/bulk-import?reviewId=${raceReview.jobId}`, { method: 'POST' })),
      readFully(raceSessionB.request(`/admin/bulk-import?reviewId=${raceReview.jobId}`, { method: 'POST' })),
    ]);
    const statuses = [raceA.status, raceB.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one of two concurrent commits must succeed');

    const raceVariants = await db.query(
      `SELECT pv.id, pv.stock_quantity FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE p.tenant_id=$1 AND p.sku=$2`,
      [tenantId, raceSku],
    );
    assert.equal(raceVariants.rowCount, 1, 'the race must not create duplicate variants');
    assert.equal(Number(raceVariants.rows[0].stock_quantity), 5, 'stock must reflect a single applied commit, not a doubled delta');

    const raceMovements = await db.query(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE variant_id = $1 AND reason = 'bulk_import'`,
      [raceVariants.rows[0].id],
    );
    assert.equal(raceMovements.rows[0].n, 1, 'only one commit must have posted a stock movement');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id=$1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
