const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler } = require('./lib');

const router = Router();

// Public origin of the storefront. Nginx serves the Angular bundle from this
// host and proxies /sitemap.xml here, so the URLs we emit must be the
// storefront's, not the API's. See docs/09-nginx-https.md.
function siteOrigin() {
  const raw = process.env.SITE_URL || 'https://elitecollections.qa';
  return raw.replace(/\/+$/, '');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [`    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

// Routes with no dynamic segment, from client/projects/client-web/src/app/app.routes.ts.
// Checkout, thank-you and the checkout result pages are deliberately absent:
// they are transactional dead ends with nothing to index.
const STATIC_ROUTES = [
  { path: '/',           changefreq: 'weekly',  priority: '1.0' },
  { path: '/collection', changefreq: 'daily',   priority: '0.9' },
  { path: '/story',      changefreq: 'monthly', priority: '0.6' },
  { path: '/experience', changefreq: 'monthly', priority: '0.6' },
  { path: '/contact',    changefreq: 'monthly', priority: '0.5' },
];

// GET /api/sitemap.xml — every indexable storefront URL, built from live data.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const origin = siteOrigin();
    const client = await db.pool.connect();

    try {
      const tenant = await ensureDefaultTenant(client);

      // Active collections, with the parent handle so nested collections get
      // the /collection/:parent/:child URL the storefront actually links to.
      const collections = await client.query(
        `
          SELECT c.handle, c.updated_at, parent.handle AS parent_handle
          FROM collections c
          LEFT JOIN collections parent ON parent.id = c.parent_id
          WHERE c.tenant_id = $1
            AND c.status = 'active'
            AND c.handle <> 'all-products'
          ORDER BY c.sort_order, c.created_at DESC
        `,
        [tenant.id],
      );

      // Only 'active' products are reachable on the storefront — the public
      // product endpoint returns 404 for draft/hidden/archived rows.
      const products = await client.query(
        `SELECT id::text, updated_at
           FROM products
          WHERE tenant_id = $1 AND status = 'active'
          ORDER BY updated_at DESC`,
        [tenant.id],
      );

      const policies = await client.query(
        `SELECT handle, updated_at
           FROM policies
          WHERE tenant_id = $1 AND status = 'active'
          ORDER BY sort_order, created_at`,
        [tenant.id],
      );

      // Newest content timestamp doubles as <lastmod> for the home and
      // collection index pages, which are just views over the same data.
      const newest = isoDate(
        [...products.rows, ...collections.rows]
          .map((r) => r.updated_at)
          .sort()
          .pop(),
      );

      const entries = [
        ...STATIC_ROUTES.map((r) => urlEntry({
          loc: `${origin}${r.path === '/' ? '/' : r.path}`,
          lastmod: r.path === '/' || r.path === '/collection' ? newest : null,
          changefreq: r.changefreq,
          priority: r.priority,
        })),
        ...collections.rows.map((r) => urlEntry({
          loc: r.parent_handle
            ? `${origin}/collection/${encodeURIComponent(r.parent_handle)}/${encodeURIComponent(r.handle)}`
            : `${origin}/collection/${encodeURIComponent(r.handle)}`,
          lastmod: isoDate(r.updated_at),
          changefreq: 'weekly',
          priority: '0.8',
        })),
        ...products.rows.map((r) => urlEntry({
          loc: `${origin}/product/${r.id}`,
          lastmod: isoDate(r.updated_at),
          changefreq: 'weekly',
          priority: '0.7',
        })),
        ...policies.rows.map((r) => urlEntry({
          loc: `${origin}/policy/${encodeURIComponent(r.handle)}`,
          lastmod: isoDate(r.updated_at),
          changefreq: 'yearly',
          priority: '0.3',
        })),
      ];

      res.type('application/xml');
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.send(
        `<?xml version="1.0" encoding="UTF-8"?>\n`
        + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        + `${entries.join('\n')}\n`
        + `</urlset>\n`,
      );
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
