/**
 * Bulk import — streams NDJSON progress events so the client can show
 * a live log without polling.
 *
 * Products are grouped by English Name. Each unique name → one `products` row.
 * Each color row within a group → one `product_variants` row.
 *
 * Event types:
 *   { type:'start',      total }
 *   { type:'processing', current, total, name, variantCount }
 *   { type:'item',       current, total, name, productId, status, variantsCreated, variantsUpdated, imagesUploaded, imagesFailed, error }
 *   { type:'done',       summary: { total, created, updated, failed } }
 */

const { Router } = require('express');
const https = require('node:https');
const http  = require('node:http');
const multer = require('multer');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { slugify, toCents } = require('./lib');
const { storage } = require('../lib/storage');

const router = Router();

// ── CSV-only multer ───────────────────────────────────────────────────────────
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (ok) return cb(null, true);
    cb(new Error('Only CSV files are accepted.'));
  },
});

// ── CSV parser (RFC 4180) ─────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = [];
  let row = [], field = '', inQuotes = false;
  const input = text.endsWith('\n') ? text : text + '\n';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i+1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && input[i+1] === '\n') {
        row.push(field); field = '';
        if (row.some(Boolean)) lines.push(row);
        row = []; i++;
      } else if (ch === '\n') {
        row.push(field); field = '';
        if (row.some(Boolean)) lines.push(row);
        row = [];
      } else { field += ch; }
    }
  }
  return lines;
}

const SECTION_HEADERS = new Set(['product list sku','kids sku','sunglasses sku','sku']);

function csvToObjects(text) {
  const rows = parseCSV(text.trim());
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    sku:    headers.findIndex(h => ['sku','product list sku','kids sku','sunglasses sku'].includes(h)),
    name:   headers.findIndex(h => h === 'english name' || h === 'name'),
    desc:   headers.findIndex(h => h === 'description' || h === 'desc'),
    color:  headers.findIndex(h => h === 'english color' || h === 'color'),
    nameAr: headers.findIndex(h => h === 'arabic name' || h === 'name_ar'),
    price:  headers.findIndex(h => h === 'price'),
    image:  headers.findIndex(h => h === 'picture' || h === 'image' || h === 'images'),
  };
  const objects = [];
  let lastDesc = '';
  for (const row of rows.slice(1)) {
    const sku = (row[idx.sku] || '').trim();
    if (!sku || SECTION_HEADERS.has(sku.toLowerCase())) continue;
    const rawDesc = idx.desc >= 0 ? (row[idx.desc] || '').trim() : '';
    if (rawDesc) lastDesc = rawDesc;
    objects.push({
      sku,
      name:     idx.name  >= 0 ? (row[idx.name]  || '').trim() : '',
      color:    idx.color >= 0 ? (row[idx.color] || '').trim() : '',
      desc:     rawDesc || lastDesc,
      nameAr:   idx.nameAr >= 0 ? (row[idx.nameAr] || '').trim() : '',
      priceRaw: idx.price >= 0 ? (row[idx.price]  || '').trim() : '',
      imageUrl: idx.image >= 0 ? (row[idx.image]  || '').trim() : '',
    });
  }
  return objects;
}

function parsePrice(raw) {
  return parseFloat((raw || '').replace(/[^\d.]/g, '')) || 0;
}

// ── Drive helpers ─────────────────────────────────────────────────────────────
function extractDriveId(url) {
  if (!url) return null;
  const p = url.match(/\/(?:folders|d)\/([a-zA-Z0-9_-]+)/);
  if (p) return p[1];
  const q = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (q) return q[1];
  return null;
}

function listFolderImages(folderId, apiKey) {
  if (!apiKey) return Promise.resolve([]);
  const q  = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/'`);
  const fl = encodeURIComponent('files(id,name,mimeType)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fl}&pageSize=12&key=${encodeURIComponent(apiKey)}`;
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': 'EliteImporter/1.0' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve((JSON.parse(Buffer.concat(chunks).toString()).files || []).filter(f => f.mimeType.startsWith('image/'))); }
        catch { resolve([]); }
      });
      res.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

function downloadBuffer(url, maxRedirects = 6) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https:') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 EliteImporter/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume(); return resolve(downloadBuffer(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const ct = (res.headers['content-type'] || '').split(';')[0].trim();
      if (ct === 'text/html') { res.resume(); return reject(new Error('File not public — share with Anyone with the link')); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: ct }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

function filenameFromMime(ct, url) {
  if (ct.includes('png'))  return 'image.png';
  if (ct.includes('webp')) return 'image.webp';
  if (ct.includes('gif'))  return 'image.gif';
  if (ct.includes('avif')) return 'image.avif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'image.jpg';
  const m = (url || '').match(/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i);
  return m ? `image.${m[1].toLowerCase()}` : 'image.jpg';
}

async function resolveImageUrls(rawUrl, apiKey) {
  if (!rawUrl) return [];
  const parts = rawUrl.split('|').map(u => u.trim()).filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    const id = extractDriveId(part);
    if (!id) { resolved.push(part); continue; }
    if (part.includes('/drive/folders/')) {
      const files = await listFolderImages(id, apiKey);
      for (const f of files) resolved.push(`https://drive.google.com/uc?export=download&id=${f.id}`);
    } else {
      resolved.push(`https://drive.google.com/uc?export=download&id=${id}`);
    }
  }
  return resolved;
}

// ── Template download ─────────────────────────────────────────────────────────
router.get('/template', (_req, res) => {
  const header  = 'SKU,English Name,Description,English Color,Arabic Name,Price,Picture';
  const example = '2BAWHT,Signature II Luxe,"Classic Arabic slippers.",White,سيغنتشر اا لوكس – نعال أبيض,QAR 980.00,https://drive.google.com/drive/folders/YOUR_FOLDER_ID';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="elite-products-template.csv"');
  res.send(`${header}\n${example}\n`);
});

// ── Streaming bulk import ─────────────────────────────────────────────────────
router.post('/', csvUpload.single('csv'), async (req, res) => {
  if (!req.file) {
    return res.status(422).json({ success: false, message: 'No CSV file received.' });
  }

  const allRows = csvToObjects(req.file.buffer.toString('utf-8'));
  const apiKey  = process.env.GOOGLE_API_KEY || null;

  if (allRows.length === 0) {
    return res.status(422).json({ success: false, message: 'CSV is empty or header row is missing.' });
  }

  // Group rows by base product name — each group becomes one product
  const groupMap = new Map();
  for (const row of allRows) {
    if (!row.name) continue;
    const key = row.name.toLowerCase().trim();
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(row);
  }
  const groups = [...groupMap.values()];

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  send({ type: 'start', total: groups.length });

  const results = [];
  const client  = await db.pool.connect();

  try {
    const tenant = await ensureDefaultTenant(client);
    const userId = req.session?.user?.id || null;

    for (const [groupIndex, groupRows] of groups.entries()) {
      const current  = groupIndex + 1;
      const firstRow = groupRows[0];
      const baseName = firstRow.name.trim();
      const baseSlug = slugify(baseName);

      if (!firstRow.sku || !baseName) {
        const r = { name: baseName || '(unknown)', status: 'skipped', error: 'Missing SKU or name' };
        results.push(r);
        send({ type: 'item', current, total: groups.length, ...r });
        continue;
      }

      send({ type: 'processing', current, total: groups.length, name: baseName, variantCount: groupRows.length });

      try {
        await client.query('BEGIN');

        const description = { en: firstRow.desc.trim(), ar: firstRow.nameAr || '' };

        // Find or create product by slug — slug is the grouping key across imports
        const existing = await client.query(
          'SELECT id FROM products WHERE tenant_id=$1 AND slug=$2',
          [tenant.id, baseSlug]
        );

        let productId, wasInserted;
        if (existing.rows.length > 0) {
          productId   = existing.rows[0].id;
          wasInserted = false;
          await client.query(
            `UPDATE products SET name=$2, description=$3::jsonb, base_price_cents=$4, updated_at=NOW() WHERE id=$1`,
            [productId, baseName, JSON.stringify(description), toCents(parsePrice(firstRow.priceRaw))]
          );
        } else {
          const ins = await client.query(
            `INSERT INTO products (tenant_id, sku, brand, name, slug, status, description, base_price_cents, currency, stock_quantity)
             VALUES ($1,$2,'Elite',$3,$4,'active',$5::jsonb,$6,$7,0) RETURNING id`,
            [tenant.id, firstRow.sku, baseName, baseSlug, JSON.stringify(description),
             toCents(parsePrice(firstRow.priceRaw)), tenant.currency || 'QAR']
          );
          productId   = ins.rows[0].id;
          wasInserted = true;
        }

        // Each color row → one product_variant
        let variantsCreated = 0, variantsUpdated = 0;
        let imagesUploaded  = 0, imagesFailed    = 0;
        let firstMediaId    = null;

        // Skip image upload if product already exists and already has images
        const imgCheck = await client.query(
          "SELECT COUNT(*) AS cnt FROM media_links WHERE product_id=$1 AND role='gallery'",
          [productId]
        );
        const skipImages = !wasInserted && Number(imgCheck.rows[0].cnt) > 0;

        for (const [varIdx, row] of groupRows.entries()) {
          const varResult = await client.query(
            `INSERT INTO product_variants (tenant_id, product_id, sku, color, price_cents, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (tenant_id, sku) DO UPDATE SET
               product_id=$2, color=$4, price_cents=$5, sort_order=$6, updated_at=NOW()
             RETURNING id, (xmax=0) AS inserted`,
            [tenant.id, productId, row.sku, row.color || null, toCents(parsePrice(row.priceRaw)), varIdx]
          );
          const variantId = varResult.rows[0].id;
          if (varResult.rows[0].inserted) variantsCreated++; else variantsUpdated++;

          if (!skipImages) {
            const imageUrls = await resolveImageUrls(row.imageUrl, apiKey);
            if (imageUrls.length > 0) {
              const orderRes = await client.query(
                "SELECT COALESCE(MAX(sort_order)+1,0) AS next FROM media_links WHERE product_id=$1 AND role='gallery'",
                [productId]
              );
              let sortOrder = Number(orderRes.rows[0].next || 0);

              for (const imgUrl of imageUrls) {
                try {
                  const { buffer, contentType } = await downloadBuffer(imgUrl);
                  const filename = filenameFromMime(contentType, imgUrl);
                  const stored   = await storage.save({ buffer, filename, mimeType: contentType });
                  const mediaRow = await client.query(
                    `INSERT INTO media_assets
                       (tenant_id,filename,kind,mime_type,size_bytes,storage_url,preview_url,uploaded_by_user_id,metadata)
                     VALUES ($1,$2,'image',$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
                    [tenant.id, filename, contentType, buffer.length, stored.url, stored.url, userId,
                     JSON.stringify({ storagePath: stored.storagePath, importedFrom: 'bulk-import', variantSku: row.sku, color: row.color })]
                  );
                  const mediaId = mediaRow.rows[0].id;
                  await client.query(
                    `INSERT INTO media_links (tenant_id,media_id,product_id,role,sort_order) VALUES ($1,$2,$3,'gallery',$4)`,
                    [tenant.id, mediaId, productId, sortOrder]
                  );
                  if (!firstMediaId) firstMediaId = mediaId;
                  sortOrder++;
                  imagesUploaded++;
                } catch { imagesFailed++; }
              }
            }
          }
        }

        if (firstMediaId) {
          await client.query(
            'UPDATE products SET primary_media_id=$1 WHERE id=$2 AND primary_media_id IS NULL',
            [firstMediaId, productId]
          );
        }

        await client.query('COMMIT');

        const r = {
          name: baseName,
          productId,
          status: wasInserted ? 'created' : 'updated',
          variantsCreated,
          variantsUpdated,
          imagesUploaded,
          imagesFailed,
        };
        results.push(r);
        send({ type: 'item', current, total: groups.length, ...r });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        const r = { name: baseName, status: 'error', error: err.message };
        results.push(r);
        send({ type: 'item', current, total: groups.length, ...r });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const updated = results.filter(r => r.status === 'updated').length;
    const failed  = results.filter(r => r.status === 'error' || r.status === 'skipped').length;
    send({ type: 'done', summary: { total: groups.length, created, updated, failed }, noApiKey: !apiKey });

  } finally {
    client.release();
    res.end();
  }
});

module.exports = router;
