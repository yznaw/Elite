const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

// Must be set before ANY app module is required: db/tenant.js reads these
// into top-level constants at require time, so setting them after the first
// require (e.g. after requiring storefront-content.route below) would seed
// the default tenant/admin with the wrong credentials and the login further
// down would fail with "Invalid email or password" against a tenant that
// was created before these overrides took effect.
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `media-content-link-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Media Content Link E2E';
process.env.DEFAULT_ADMIN_EMAIL = `media-content-link-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'media-content-link-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Media Content Link Owner';
process.env.SESSION_SECRET = `media-content-link-e2e-session-${runId}`;

const storefrontContent = require('../routes/storefront-content.route');
const { collectContentImageUrls } = storefrontContent._test;
const db = require('../db/client');
const { startServer } = require('../index');

test('collectContentImageUrls finds every imageUrl in the tree regardless of where it is nested', () => {
  const content = {
    hero: { imageUrl: '/api/uploads/hero-main.webp' },
    heroSlider: {
      items: [
        {
          imageUrl: '/api/uploads/slide-1.webp',
          colors: [{ imageUrl: '/api/uploads/slide-1-red.webp' }, { imageUrl: '' }],
        },
        { imageUrl: '/api/uploads/slide-2.webp', colors: [] },
      ],
    },
    story: {
      hero: { imageUrl: '/api/uploads/story-hero.webp' },
      chapters: [{ imageUrl: '/api/uploads/chapter-1.webp' }],
      atelier: { items: [{ imageUrl: '/api/uploads/atelier-1.webp' }] },
    },
    unrelatedField: 'not a url',
  };

  const urls = collectContentImageUrls(content);
  assert.deepEqual([...urls].sort(), [
    '/api/uploads/atelier-1.webp',
    '/api/uploads/chapter-1.webp',
    '/api/uploads/hero-main.webp',
    '/api/uploads/slide-1-red.webp',
    '/api/uploads/slide-1.webp',
    '/api/uploads/slide-2.webp',
    '/api/uploads/story-hero.webp',
  ]);
});

test('collectContentImageUrls tolerates null/empty content without throwing', () => {
  assert.deepEqual(collectContentImageUrls(null), new Set());
  assert.deepEqual(collectContentImageUrls(undefined), new Set());
  assert.deepEqual(collectContentImageUrls({}), new Set());
});

// ── E2E: the actual reported bug ────────────────────────────────────────────
// An image used only by the homepage hero (no media_links row at all) must
// show as in-use in the Media library, and — the higher-stakes half of this
// bug — must survive "clean up orphaned media" instead of being deleted out
// from under the live storefront hero.
test('a media asset referenced only by the homepage hero is reported linked and survives orphan cleanup', { timeout: 30000 }, async (t) => {
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

    // A hero-only image: inserted straight into media_assets, deliberately
    // with NO media_links row, matching how an image the admin picks for the
    // hero (not a product gallery) actually ends up in the table.
    const heroAsset = await db.query(
      `INSERT INTO media_assets (tenant_id, filename, kind, mime_type, storage_url, preview_url)
       VALUES ($1, 'hero-only.webp', 'image', 'image/webp', '/uploads/hero-only-abc123.webp', '/uploads/hero-only-abc123.webp')
       RETURNING id`,
      [tenantId],
    );
    const heroAssetId = heroAsset.rows[0].id;

    // A genuinely unused image — the control. Orphan cleanup should still
    // remove this one; the fix must not make cleanup a no-op entirely.
    const trulyOrphanedAsset = await db.query(
      `INSERT INTO media_assets (tenant_id, filename, kind, mime_type, storage_url, preview_url)
       VALUES ($1, 'nothing-points-here.webp', 'image', 'image/webp', '/uploads/truly-orphaned-xyz789.webp', '/uploads/truly-orphaned-xyz789.webp')
       RETURNING id`,
      [tenantId],
    );
    const trulyOrphanedId = trulyOrphanedAsset.rows[0].id;

    // Home content references the hero asset by basename with an /api
    // prefix the stored storage_url doesn't have — the same mismatch
    // loadHeroMediaVariants already works around, so the fix must too.
    await db.query(
      `UPDATE store_settings
          SET home_content = $2::jsonb
        WHERE tenant_id = $1`,
      [
        tenantId,
        JSON.stringify({
          heroSlider: { items: [{ imageUrl: '/api/uploads/hero-only-abc123.webp', colors: [] }] },
        }),
      ],
    );

    const mediaList = await api('/admin/media');
    const heroRow = mediaList.find((m) => m.id === heroAssetId);
    const orphanRow = mediaList.find((m) => m.id === trulyOrphanedId);
    assert.ok(heroRow, 'the hero-only asset must appear in the media list');
    assert.equal(heroRow.linkedTo, null, 'it still has no product link');
    assert.equal(heroRow.usedInContent, true, 'it must be recognized as used by the homepage hero');
    assert.equal(orphanRow.usedInContent, false, 'the unrelated asset must not be flagged as used');

    const cleanup = await api('/admin/media/orphaned', { method: 'DELETE' });
    assert.ok(cleanup.ids.includes(trulyOrphanedId), 'the genuinely unused asset must be deleted');
    assert.ok(!cleanup.ids.includes(heroAssetId), 'the hero-referenced asset must NOT be deleted');

    const survivorCheck = await db.query('SELECT id FROM media_assets WHERE id = $1', [heroAssetId]);
    assert.equal(survivorCheck.rowCount, 1, 'the hero asset row must still exist after cleanup');
    const deletedCheck = await db.query('SELECT id FROM media_assets WHERE id = $1', [trulyOrphanedId]);
    assert.equal(deletedCheck.rowCount, 0, 'the truly orphaned asset row must be gone');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
