const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `product-image-preview-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Product Image Preview E2E';
process.env.DEFAULT_ADMIN_EMAIL = `product-image-preview-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'product-image-preview-password';
process.env.DEFAULT_ADMIN_NAME = 'Preview URL Test Owner';
process.env.SESSION_SECRET = `product-image-preview-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// A product save sends image URLs from the admin client, and each one is
// resolved to a media asset, or inserted as a new asset when nothing matches.
// The admin media API hands the client two URLs per asset that are not
// interchangeable: `storageUrl` (the original) and `preview` (the 640px `-card`
// derivative). Sending the preview must resolve back to the original, never
// create a second asset pointing at a downscaled copy: that is invisible in the
// admin, where the thumbnail looks identical, and soft on the storefront, where
// a 640px file is stretched into a 1400px slot.
//
// A freshly uploaded asset stores the card URL in its own `preview_url`, so the
// plain equality lookup already covers that case. This test covers the case it
// does not: an asset whose `preview_url` is something else, which is the state
// of anything uploaded before the variant pipeline existed. There the match has
// to come from the variant map, or from the filename stem, and the stem matters
// because the derivative is always `.webp` while the original here is a `.png`.
test('saving a product with a preview URL reuses the original asset', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  let sharp;
  try { sharp = require('sharp'); } catch { return t.skip('sharp is required to generate variants.'); }

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
        ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
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

  const countAssets = async () => Number(
    (await db.query("SELECT count(*) c FROM media_assets WHERE tenant_id = $1 AND kind = 'image'", [tenantId])).rows[0].c,
  );

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    // Wide enough that every variant down to `card` is actually generated;
    // a small upload only advertises the sizes it can fill.
    const png = await sharp({
      create: { width: 1500, height: 1200, channels: 3, background: { r: 40, g: 70, b: 60 } },
    }).png().toBuffer();

    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'preview-url-regression.png');
    const uploaded = await api('/admin/media', { method: 'POST', body: form });
    const asset = Array.isArray(uploaded) ? uploaded[0] : uploaded;

    const storageUrl = asset.storageUrl || asset.url;
    const previewUrl = asset.preview || asset.previewUrl;
    assert.ok(storageUrl, 'upload should return the original URL');
    assert.ok(previewUrl, 'upload should return the preview URL');
    assert.match(previewUrl, /-card\.webp$/, 'preview should be the 640px card derivative');
    assert.notEqual(previewUrl, storageUrl, 'preview and original must be different files');

    const assetsAfterUpload = await countAssets();

    // Put the asset into the pre-variant-pipeline state: the row still knows
    // its variants, but `preview_url` no longer points at the card file, so the
    // equality lookup cannot find it from the preview URL alone.
    await db.query(
      'UPDATE media_assets SET preview_url = storage_url WHERE tenant_id = $1 AND storage_url = $2',
      [tenantId, storageUrl],
    );

    const product = await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Preview URL Regression',
        sku: `PREVIEW-${runId}`,
        brand: 'Elite Test',
        price: 300,
        stock: 1,
        // The defect: the admin sends the preview rather than the original.
        images: [previewUrl],
        variants: [{ sku: `PREVIEW-${runId}-D`, barcode: `PREVIEW-${runId}-D`, price: 300, stock: 1 }],
      }),
    });

    assert.equal(
      await countAssets(),
      assetsAfterUpload,
      'saving a preview URL must not create a second media asset for the derivative',
    );

    const linked = await db.query(
      `SELECT m.storage_url
         FROM media_links ml
         JOIN media_assets m ON m.id = ml.media_id
        WHERE ml.tenant_id = $1 AND ml.product_id = $2 AND ml.role IN ('gallery','primary')`,
      [tenantId, product.id],
    );
    assert.equal(linked.rowCount, 1, 'the product should link exactly one image');
    assert.equal(
      linked.rows[0].storage_url,
      storageUrl,
      'the linked asset must be the original upload, not the card derivative',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
