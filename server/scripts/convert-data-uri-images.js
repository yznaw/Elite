require('dotenv').config();

const db = require('../db/client');
const { storage } = require('../lib/storage');

/**
 * Move images stored as `data:` URLs into real uploaded files.
 *
 * The admin's collection drawer used to keep a picked cover as a base64 data
 * URL, so the bytes lived inside `collections.seo` and inside the home page
 * content blob. Those columns are served on every storefront page and, under
 * server-side rendering, ship twice: once in the markup and once in the
 * hydration payload. Six collection covers and three home tiles were ~900 kB
 * of every home and collection page, none of it cacheable and none of it with
 * the sized variants an upload produces.
 *
 * Converting writes the bytes through the same storage helper an upload uses
 * (so variants are generated), records a media_assets row so the image appears
 * in the media library, and replaces the value with its `/uploads/...` path.
 *
 * Dry run by default; pass --apply to write.
 *
 *   node scripts/convert-data-uri-images.js
 *   node scripts/convert-data-uri-images.js --apply
 *
 * Safe to re-run: rows without a data URL are skipped.
 */

const APPLY = process.argv.includes('--apply');
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is;

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function slugify(value) {
  return String(value || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
}

/** Store one data URL as a file and return its public `/uploads/...` path. */
async function convertOne(client, tenantId, dataUrl, nameHint) {
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return null;

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const filename = `${slugify(nameHint)}.${EXTENSIONS[mimeType.toLowerCase()] || 'bin'}`;

  if (!APPLY) {
    return { url: `(dry run) ${filename}`, bytes: buffer.length, mimeType };
  }

  const stored = await storage.save({ buffer, filename, mimeType });
  await client.query(
    `
      INSERT INTO media_assets (
        tenant_id, filename, kind, mime_type, size_bytes, width, height,
        storage_url, preview_url, metadata
      )
      VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [
      tenantId,
      filename,
      stored.mimeType,
      buffer.length,
      stored.width,
      stored.height,
      stored.url,
      stored.previewUrl,
      JSON.stringify({
        storagePath: stored.storagePath,
        originalName: filename,
        imageVariants: stored.variants || {},
        convertedFrom: 'data-url',
      }),
    ],
  );

  return { url: stored.url, bytes: buffer.length, mimeType };
}

/** Walk a JSON value, converting every `data:image` string it holds. */
async function convertInJson(client, tenantId, value, path, report, nameHint) {
  if (typeof value === 'string') {
    if (!DATA_URL.test(value.trim())) return value;
    const converted = await convertOne(client, tenantId, value, nameHint);
    if (!converted) return value;
    report.push({ path, bytes: converted.bytes, url: converted.url });
    return converted.url.startsWith('(dry run)') ? value : converted.url;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const [index, item] of value.entries()) {
      out.push(await convertInJson(client, tenantId, item, `${path}[${index}]`, report, `${nameHint}-${index + 1}`));
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = await convertInJson(client, tenantId, item, `${path}.${key}`, report, `${nameHint}-${key}`);
    }
    return out;
  }
  return value;
}

async function convertCollections(client, report) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, handle, title, seo FROM collections
     WHERE seo->>'imageUrl' LIKE 'data:image%' ORDER BY handle`,
  );

  for (const row of rows) {
    const converted = await convertOne(client, row.tenant_id, row.seo.imageUrl, `${row.handle || row.title}-cover`);
    if (!converted) continue;
    report.push({ path: `collections[${row.handle}].seo.imageUrl`, bytes: converted.bytes, url: converted.url });
    if (!APPLY) continue;
    await client.query(
      `UPDATE collections SET seo = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ ...row.seo, imageUrl: converted.url }), row.id],
    );
  }
}

async function convertHomeContent(client, report) {
  const { rows } = await client.query(
    'SELECT tenant_id, home_content, home_content_draft FROM store_settings',
  );

  for (const row of rows) {
    for (const column of ['home_content', 'home_content_draft']) {
      const content = row[column];
      if (!content) continue;
      const columnReport = [];
      const next = await convertInJson(client, row.tenant_id, content, column, columnReport, 'home');
      report.push(...columnReport);
      if (!APPLY || columnReport.length === 0) continue;
      await client.query(
        `UPDATE store_settings SET ${column} = $1::jsonb WHERE tenant_id = $2`,
        [JSON.stringify(next), row.tenant_id],
      );
    }
  }
}

async function main() {
  const client = await db.pool.connect();
  const report = [];
  try {
    await convertCollections(client, report);
    await convertHomeContent(client, report);
  } finally {
    client.release();
    await db.pool.end();
  }

  if (report.length === 0) {
    console.log('Nothing to convert: no data: URLs found.');
    return;
  }

  let total = 0;
  console.log(APPLY ? 'Converted:' : 'Would convert (dry run, nothing written):');
  for (const item of report) {
    total += item.bytes;
    console.log(`  ${String(Math.round(item.bytes / 1024)).padStart(6)} kB  ${item.path}  ->  ${item.url}`);
  }
  console.log(`  ${String(Math.round(total / 1024)).padStart(6)} kB  total removed from the API payloads`);
  if (!APPLY) console.log('\nRe-run with --apply to write the files and update the rows.');
}

main().catch((error) => {
  console.error('convert-data-uri-images failed:', error.message);
  process.exitCode = 1;
});
