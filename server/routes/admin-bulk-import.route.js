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
const crypto = require('node:crypto');
const dns   = require('node:dns/promises');
const net   = require('node:net');
const multer = require('multer');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { slugify, toCents } = require('./lib');
const { storage } = require('../lib/storage');
const { recordMovement, publishStockEvent, publishCatalogEvent } = require('../lib/inventory-ledger');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');

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
  const findHeader = (...names) => headers.findIndex(h => names.includes(h));
  const idx = {
    legacySku:    findHeader('sku', 'new sku', 'product list sku', 'kids sku', 'sunglasses sku'),
    productSku:   findHeader('product sku', 'product_sku'),
    variantSku:   findHeader('variant sku', 'variant_sku'),
    name:         findHeader('english name', 'name', 'name en'),
    nameAr:       findHeader('arabic name', 'name_ar', 'name ar'),
    brand:        findHeader('brand'),
    status:       findHeader('status', 'visibility'),
    posStatus:    findHeader('pos status', 'pos visibility', 'pos_status'),
    descEn:       findHeader('description', 'desc', 'description en'),
    descAr:       findHeader('description ar'),
    shortEn:      findHeader('hook en', 'hook'),
    shortAr:      findHeader('hook ar'),
    teaserEn:     findHeader('short description en', 'teaser en'),
    teaserAr:     findHeader('short description ar', 'teaser ar'),
    noteEn:       findHeader('product note en', 'note en'),
    noteAr:       findHeader('product note ar', 'note ar'),
    careEn:       findHeader('material care en', 'material & care en', 'care en'),
    careAr:       findHeader('material care ar', 'material & care ar', 'care ar'),
    variantNoteEn: findHeader('variant note en'),
    variantNoteAr: findHeader('variant note ar'),
    color:        findHeader('english color', 'color'),
    material:     findHeader('material'),
    price:        findHeader('selling price', 'price'),
    image:        findHeader('picture', 'image', 'images'),
    size:         findHeader('size'),
    qty:          findHeader('quantity', 'qty', 'stock'),
    cost:         findHeader('cost-qar', 'cost_qar', 'cost qar', 'cost'),
    shippingCost: findHeader('shipping cost', 'shipping_cost', 'shipping'),
    collection:   findHeader('collections', 'collection'),
    barcode:      findHeader('barcode', 'ean', 'upc'),
    metaTitle:    findHeader('meta title', 'seo title'),
    metaDesc:     findHeader('meta description', 'meta desc', 'seo description'),
    slug:         findHeader('slug', 'handle'),
    relatedSkus:  findHeader('related product skus', 'related skus'),
  };
  const objects = [];
  const emptyCarry = () => ({
    productSku: '', name: '', nameAr: '', brand: '', status: '', posStatus: '',
    descEn: '', descAr: '', shortEn: '', shortAr: '', teaserEn: '', teaserAr: '',
    noteEn: '', noteAr: '', careEn: '', careAr: '', collection: '', image: '',
    metaTitle: '', metaDesc: '', slug: '', relatedSkus: '', color: '',
  });
  let carry = emptyCarry();
  let lastBoundary = '';
  const read = (row, column) => column >= 0 ? (row[column] || '').trim() : '';

  for (const row of rows.slice(1)) {
    const legacySku = read(row, idx.legacySku);
    const rawProductSku = read(row, idx.productSku);
    const variantSku = read(row, idx.variantSku) || legacySku;
    const rawName = read(row, idx.name);
    if (!variantSku || SECTION_HEADERS.has(variantSku.toLowerCase())) continue;

    // Product-level values may be entered once on the first variant row. Reset
    // every carried value as soon as Product SKU (preferred) or product name
    // changes, preventing data from the previous product bleeding into the next.
    const boundary = rawProductSku
      ? `sku:${rawProductSku.toLowerCase()}`
      : carry.productSku
        ? lastBoundary
        : rawName ? `name:${rawName.toLowerCase().replace(/\s+/g, ' ')}` : '';
    if (boundary && boundary !== lastBoundary) {
      carry = emptyCarry();
      lastBoundary = boundary;
    }

    const carryColumns = {
      productSku: idx.productSku, name: idx.name, nameAr: idx.nameAr,
      brand: idx.brand, status: idx.status, posStatus: idx.posStatus, descEn: idx.descEn, descAr: idx.descAr,
      shortEn: idx.shortEn, shortAr: idx.shortAr, teaserEn: idx.teaserEn,
      teaserAr: idx.teaserAr, noteEn: idx.noteEn, noteAr: idx.noteAr,
      careEn: idx.careEn, careAr: idx.careAr, collection: idx.collection,
      image: idx.image, metaTitle: idx.metaTitle, metaDesc: idx.metaDesc,
      slug: idx.slug, relatedSkus: idx.relatedSkus,
    };
    for (const [key, column] of Object.entries(carryColumns)) {
      const value = read(row, column);
      if (value) carry[key] = value;
    }
    const rawColor = read(row, idx.color);
    if (rawColor) carry.color = rawColor;

    objects.push({
      productSku: carry.productSku,
      variantSku,
      name: carry.name,
      nameAr: carry.nameAr,
      brand: carry.brand,
      status: carry.status,
      posStatus: carry.posStatus,
      descEn: carry.descEn,
      descAr: carry.descAr,
      shortEn: carry.shortEn,
      shortAr: carry.shortAr,
      teaserEn: carry.teaserEn,
      teaserAr: carry.teaserAr,
      noteEn: carry.noteEn,
      noteAr: carry.noteAr,
      careEn: carry.careEn,
      careAr: carry.careAr,
      color: carry.color,
      material: read(row, idx.material),
      variantNoteEn: read(row, idx.variantNoteEn),
      variantNoteAr: read(row, idx.variantNoteAr),
      priceRaw: read(row, idx.price),
      imageUrl: carry.image,
      size: read(row, idx.size),
      qtyRaw: read(row, idx.qty),
      costRaw: read(row, idx.cost),
      shippingRaw: read(row, idx.shippingCost),
      collection: carry.collection,
      barcode: read(row, idx.barcode),
      metaTitle: carry.metaTitle,
      metaDesc: carry.metaDesc,
      slug: carry.slug,
      relatedSkus: carry.relatedSkus,
    });
  }
  return objects;
}

function parsePrice(raw) {
  return parseFloat((raw || '').replace(/[^\d.]/g, '')) || 0;
}

function splitPipeList(raw) {
  return [...new Set(String(raw || '').split('|').map(value => value.trim()).filter(Boolean))];
}

function importStatus(raw, fallback = 'hidden') {
  const value = String(raw || '').trim().toLowerCase();
  return ['active', 'hidden'].includes(value) ? value : fallback;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeImageMode(value) {
  const mode = String(value || 'ignore').trim().toLowerCase();
  return ['ignore', 'append', 'replace'].includes(mode) ? mode : 'ignore';
}

function storedPaths(stored) {
  return [
    stored?.storagePath,
    ...Object.values(stored?.variants || {}).map(variant => variant?.storagePath),
  ].filter(Boolean);
}

async function saveImportItem(client, jobId, key, originalRows, result) {
  await client.query(
    `INSERT INTO catalog_import_items
       (job_id, item_key, original_rows, status, product_id, result, error)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7)`,
    [jobId, key, JSON.stringify(originalRows), result.status, result.productId || null, JSON.stringify(result), result.error || null],
  );
}

router.get('/history', async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await db.query(
    `SELECT j.id, j.kind, j.filename, j.image_mode, j.status, j.summary,
            j.created_at, j.completed_at, u.full_name AS created_by,
            COALESCE(jsonb_agg(jsonb_build_object(
              'name', i.item_key, 'status', i.status, 'productId', i.product_id,
              'error', i.error, 'result', i.result
            ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
       FROM catalog_import_jobs j
       LEFT JOIN admin_users u ON u.id = j.created_by_user_id
       LEFT JOIN catalog_import_items i ON i.job_id = j.id
      WHERE j.tenant_id = $1
      GROUP BY j.id, u.full_name
      ORDER BY j.created_at DESC
      LIMIT 50`,
    [tenantId],
  );
  res.json({ success: true, data: result.rows.map(row => ({
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    imageMode: row.image_mode,
    status: row.status,
    summary: row.summary || {},
    createdBy: row.created_by || 'Deleted user',
    createdAt: row.created_at,
    completedAt: row.completed_at,
    log: (row.items || []).map(item => ({ ...item.result, name: item.name, status: item.status, error: item.error })),
  })) });
});

function parseStockCSV(text) {
  const rows = parseCSV(String(text || '').replace(/^\uFEFF/, '').trim());
  if (rows.length < 2) return { rows: [], fileErrors: ['CSV is empty.'] };
  const headers = rows[0].map(value => value.trim().toLowerCase());
  const skuIndex = headers.indexOf('sku');
  const stockIndex = headers.indexOf('stock');
  if (skuIndex < 0 || stockIndex < 0) {
    return { rows: [], fileErrors: ['Required columns are SKU and Stock.'] };
  }
  const seen = new Set();
  const parsed = rows.slice(1).map((row, index) => {
    const sku = String(row[skuIndex] || '').trim();
    const rawStock = String(row[stockIndex] ?? '').trim();
    const errors = [];
    if (!sku) errors.push('SKU is required.');
    if (!/^\d+$/.test(rawStock)) errors.push('Stock must be a whole number greater than or equal to zero.');
    const key = sku.toLowerCase();
    if (sku && seen.has(key)) errors.push('Duplicate SKU in file.');
    if (sku) seen.add(key);
    return { line: index + 2, sku, stock: /^\d+$/.test(rawStock) ? Number(rawStock) : null, errors };
  });
  return { rows: parsed, fileErrors: [] };
}

router.post('/stock/preview', csvUpload.single('csv'), async (req, res) => {
  if (!req.file) return res.status(422).json({ success: false, message: 'No CSV file received.' });
  const parsed = parseStockCSV(req.file.buffer.toString('utf-8'));
  if (parsed.fileErrors.length) return res.status(422).json({ success: false, message: parsed.fileErrors.join(' ') });

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const skus = parsed.rows.filter(row => row.sku).map(row => row.sku);
    const existing = await client.query(
      `SELECT pv.id AS variant_id, pv.product_id, pv.sku, pv.stock_quantity
         FROM product_variants pv
         JOIN products p ON p.id=pv.product_id
        WHERE pv.tenant_id=$1 AND pv.sku=ANY($2::text[]) AND p.status<>'archived'`,
      [tenant.id, skus],
    );
    const bySku = new Map(existing.rows.map(row => [row.sku, row]));
    const reviewed = parsed.rows.map(row => {
      const match = bySku.get(row.sku);
      const errors = [...row.errors];
      if (row.sku && !match) errors.push('Variant SKU was not found.');
      return {
        ...row,
        variantId: match?.variant_id || null,
        productId: match?.product_id || null,
        currentStock: match ? Number(match.stock_quantity) : null,
        change: match && row.stock !== null ? row.stock - Number(match.stock_quantity) : null,
        errors,
      };
    });
    const errorCount = reviewed.filter(row => row.errors.length).length;
    const job = await client.query(
      `INSERT INTO catalog_import_jobs
         (tenant_id,created_by_user_id,kind,filename,file_sha256,status,source_rows,summary,started_at,completed_at)
       VALUES ($1,$2,'stock',$3,$4,'review_ready',$5::jsonb,$6::jsonb,now(),now()) RETURNING id`,
      [tenant.id, req.user?.id || null, req.file.originalname || 'stock.csv',
       crypto.createHash('sha256').update(req.file.buffer).digest('hex'), JSON.stringify(reviewed),
       JSON.stringify({ total: reviewed.length, valid: reviewed.length - errorCount, failed: errorCount })],
    );
    for (const row of reviewed) {
      const item = {
        name: row.sku || `Line ${row.line}`,
        status: row.errors.length ? 'error' : 'updated',
        error: row.errors.join(' '),
        currentStock: row.currentStock,
        newStock: row.stock,
        line: row.line,
      };
      await saveImportItem(client, job.rows[0].id, item.name, [row], item);
    }
    res.json({ success: true, data: {
      jobId: job.rows[0].id,
      rows: reviewed,
      summary: { total: reviewed.length, valid: reviewed.length - errorCount, failed: errorCount },
      canCommit: errorCount === 0 && reviewed.length > 0,
    } });
  } finally {
    client.release();
  }
});

router.post('/stock/:id/commit', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');
    const jobResult = await client.query(
      `SELECT * FROM catalog_import_jobs
        WHERE tenant_id=$1 AND id=$2 AND kind='stock' FOR UPDATE`,
      [tenant.id, req.params.id],
    );
    if (!jobResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Stock review was not found.' });
    }
    const job = jobResult.rows[0];
    if (job.status !== 'review_ready') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'This stock review was already committed.' });
    }
    const rows = job.source_rows || [];
    if (!rows.length || rows.some(row => Array.isArray(row.errors) && row.errors.length)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ success: false, message: 'Fix every validation error before committing stock.' });
    }

    await client.query("UPDATE catalog_import_jobs SET status='running', started_at=now() WHERE id=$1", [job.id]);
    await client.query('DELETE FROM catalog_import_items WHERE job_id=$1', [job.id]);
    const changedProducts = new Set();
    let updated = 0;
    for (const row of rows) {
      const changed = await client.query(
        `UPDATE product_variants pv
            SET stock_quantity=$1, updated_at=now()
           FROM (SELECT id, product_id, stock_quantity AS previous
                   FROM product_variants
                  WHERE tenant_id=$2 AND sku=$3 FOR UPDATE) old
          WHERE pv.id=old.id
        RETURNING pv.id AS variant_id, old.product_id, old.previous`,
        [row.stock, tenant.id, row.sku],
      );
      if (!changed.rowCount) throw new Error(`Variant SKU "${row.sku}" no longer exists.`);
      const saved = changed.rows[0];
      const delta = Number(row.stock) - Number(saved.previous);
      if (delta !== 0) {
        await recordMovement(client, { tenantId: tenant.id, userId: req.user?.id || null }, {
          productId: saved.product_id,
          variantId: saved.variant_id,
          delta,
          reason: 'bulk_import',
          referenceType: 'stock_import',
          referenceId: job.id,
          metadata: { sku: row.sku, previousStock: Number(saved.previous), newStock: Number(row.stock), importJobId: job.id },
        });
        await publishStockEvent(client, tenant.id, saved.variant_id, Number(row.stock));
      }
      changedProducts.add(saved.product_id);
      updated++;
      await saveImportItem(client, job.id, row.sku, [row], {
        name: row.sku, status: 'updated', currentStock: Number(saved.previous), newStock: Number(row.stock),
      });
    }
    for (const productId of changedProducts) {
      await client.query(
        `UPDATE products SET stock_quantity=(SELECT COALESCE(sum(stock_quantity),0) FROM product_variants WHERE product_id=$1), updated_at=now() WHERE id=$1`,
        [productId],
      );
    }
    const summary = { total: rows.length, updated, failed: 0 };
    await client.query(
      `UPDATE catalog_import_jobs SET status='completed', summary=$2::jsonb, completed_at=now() WHERE id=$1`,
      [job.id, JSON.stringify(summary)],
    );
    await client.query('COMMIT');
    res.json({ success: true, data: { jobId: job.id, updated, notFound: [], summary } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
});

// Map of single-letter abbreviations (uppercase) found in SKU segments → color name.
// The segment is identified as the part right before the size (last numeric-ish segment).
// Extend this map as new abbreviations appear in the catalog.
const SKU_COLOR_MAP = {
  G:  'Grey',
  GR: 'Grey',
  B:  'Black',
  BL: 'Black',
  BLK:'Black',
  W:  'White',
  WH: 'White',
  WHT:'White',
  N:  'Navy',
  NV: 'Navy',
  R:  'Red',
  RD: 'Red',
  BR: 'Brown',
  BRN:'Brown',
  BG: 'Beige',
  BE: 'Beige',
  GD: 'Gold',
  GL: 'Gold',
  S:  'Silver',
  SL: 'Silver',
  T:  'Tan',
  C:  'Camel',
  CM: 'Camel',
  KK: 'Khaki',
  KH: 'Khaki',
  GN: 'Green',
  O:  'Olive',
  OL: 'Olive',
  P:  'Pink',
  PK: 'Pink',
  Y:  'Yellow',
  YL: 'Yellow',
  OR: 'Orange',
  PR: 'Purple',
  PU: 'Purple',
  BU: 'Burgundy',
};

/**
 * Try to infer a color name from a SKU string.
 * Looks for a known abbreviation in the segment right before the trailing
 * size segment (the last dash-delimited token that looks like a number).
 *
 * e.g. "8825-GNC-G-5"   → segment before "5"  → "G"  → "Grey"
 *      "8825-GNC-B-9.5" → segment before "9.5" → "B"  → "Black"
 *      "8825-GNC-390-5" → segment before "5"   → "390" → no match → null
 */
function inferColorFromSku(sku) {
  if (!sku) return null;
  const parts = sku.split('-');
  if (parts.length < 2) return null;
  // Walk from the end; skip the last segment if it looks like a size (numeric or like "5", "6.5", "XL" etc.)
  // Then check the segment before it.
  for (let i = parts.length - 1; i >= 1; i--) {
    const seg = parts[i].toUpperCase();
    // If this segment is numeric (a size), look at the one before it
    if (/^\d+(\.\d+)?$/.test(seg) || /^(XS|S|M|L|XL|XXL|XXXL|OS)$/.test(seg)) {
      const prev = parts[i - 1].toUpperCase();
      if (SKU_COLOR_MAP[prev]) return SKU_COLOR_MAP[prev];
      return null;
    }
  }
  // No size-like segment found — try the last segment directly
  const last = parts[parts.length - 1].toUpperCase();
  return SKU_COLOR_MAP[last] || null;
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
  if (!apiKey) return Promise.reject(new Error('GOOGLE_API_KEY is required to import a Google Drive folder.'));
  const q  = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/'`);
  const fl = encodeURIComponent('files(id,name,mimeType)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fl}&pageSize=12&key=${encodeURIComponent(apiKey)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'EliteImporter/1.0' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200 || body.error) return reject(new Error(body.error?.message || `Google Drive HTTP ${res.statusCode}`));
          const files = (body.files || []).filter(f => f.mimeType.startsWith('image/'));
          if (files.length === 0) return reject(new Error('Google Drive folder contains no accessible images.'));
          resolve(files);
        } catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    // Without this, a hung Google Drive request blocks forever holding the
    // per-group DB transaction open (this is called from inside BEGIN...COMMIT).
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Google Drive request timed out')); });
  });
}

// ── SSRF guard for import-supplied image URLs ────────────────────────────────
// The "Picture" column is attacker-influenceable free text — anyone who can
// upload a product CSV controls it — so it must never be used to make the
// server fetch an internal address: cloud metadata endpoints (169.254.169.254),
// localhost admin ports, or other hosts on the private network. Checked before
// the initial request AND before following each redirect hop, since a public
// host can still 302 to a private one.
function isPrivateIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    return a === 10
      || a === 127
      || a === 0
      || a >= 224
      || (a === 169 && b === 254) // link-local, incl. cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local (fc00::/7)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // could not parse as an IP — refuse rather than risk it
}

async function assertPublicHost(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Image URL is not valid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Image URL scheme "${parsed.protocol}" is not allowed.`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost') {
    throw new Error('Image URL host is not allowed.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Image URL resolves to a private network address.');
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve image host "${hostname}".`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Image URL resolves to a private network address.');
  }
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
function downloadBuffer(url, maxRedirects = 6) {
  return assertPublicHost(url).then(() => new Promise((resolve, reject) => {
    const proto = url.startsWith('https:') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 EliteImporter/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        return resolve(downloadBuffer(nextUrl, maxRedirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const ct = (res.headers['content-type'] || '').split(';')[0].trim();
      if (ct === 'text/html') { res.resume(); return reject(new Error('File not public — share with Anyone with the link')); }
      if (!ct.startsWith('image/')) { res.resume(); return reject(new Error(`URL is not an image (${ct || 'unknown content type'})`)); }
      const declaredSize = Number(res.headers['content-length'] || 0);
      if (declaredSize > MAX_IMAGE_BYTES) { res.resume(); return reject(new Error('Image exceeds the 20 MB limit.')); }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > MAX_IMAGE_BYTES) {
          req.destroy(new Error('Image exceeds the 20 MB limit.'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: ct }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Download timed out')); });
  }));
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

// Product SKU is the stable grouping key in Template V2. Name remains as a
// compatibility fallback for the legacy template. Returns [key, rows][] (not
// a plain Map) so callers can recover each group's grouping key — needed to
// match a preview's stale-catalog snapshot back up with its groups at commit.
function buildGroups(allRows) {
  const groupMap = new Map();
  for (const row of allRows) {
    if (!row.name) continue;
    const key = row.productSku
      ? `sku:${row.productSku.toLowerCase().trim()}`
      : `name:${row.name.toLowerCase().trim().replace(/\s+/g, ' ')}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(row);
  }
  return [...groupMap.entries()];
}

// Detects whether the catalog changed between a dry-run preview and its later
// commit — another admin edited or archived a matched product, or a product
// that didn't exist at preview time exists now. Compares the snapshot taken
// during preview (job.summary.catalogSnapshot, written at the bottom of the
// route below) against a fresh read, keyed by the same grouping key
// buildGroups() produces, so a stale preview is rejected with a clear message
// instead of silently overwriting whatever the catalog now holds.
async function findStaleGroups(client, tenantId, sourceJob, groupEntries) {
  const snapshot = Array.isArray(sourceJob?.summary?.catalogSnapshot) ? sourceJob.summary.catalogSnapshot : [];
  if (!snapshot.length) return [];
  const byKey = new Map(snapshot.map(entry => [entry.key, entry]));

  const groupMeta = groupEntries.map(([groupKey, groupRows]) => {
    const firstRow = groupRows[0];
    const baseName = (firstRow.name || '').trim();
    const baseProductSku = (firstRow.productSku || firstRow.variantSku || '').trim();
    const baseSlug = slugify(firstRow.slug || baseName);
    return { groupKey, baseProductSku, baseSlug };
  });

  const skus = [...new Set(groupMeta.map(g => g.baseProductSku).filter(Boolean))];
  const slugs = [...new Set(groupMeta.map(g => g.baseSlug).filter(Boolean))];
  if (!skus.length && !slugs.length) return [];

  const current = await client.query(
    `SELECT id, sku, slug, updated_at FROM products
      WHERE tenant_id=$1 AND status <> 'archived' AND (sku=ANY($2::text[]) OR slug=ANY($3::text[]))`,
    [tenantId, skus, slugs],
  );
  const bySku = new Map(current.rows.map(row => [row.sku, row]));
  const bySlug = new Map(current.rows.map(row => [row.slug, row]));

  const stale = [];
  for (const { groupKey, baseProductSku, baseSlug } of groupMeta) {
    const expected = byKey.get(groupKey);
    if (!expected) continue; // group is new since preview — nothing to compare, will be created
    const match = bySku.get(baseProductSku) || bySlug.get(baseSlug) || null;
    const currentProductId = match?.id || null;
    const currentUpdatedAt = match?.updated_at ? new Date(match.updated_at).toISOString() : null;
    const expectedProductId = expected.productId || null;
    if (currentProductId !== expectedProductId || (expectedProductId && currentUpdatedAt !== expected.updatedAt)) {
      stale.push(groupKey);
    }
  }
  return stale;
}

// ── Template download ─────────────────────────────────────────────────────────
router.get('/template', (_req, res) => {
  const headers = [
    'Product SKU', 'Variant SKU', 'Barcode', 'English Name', 'Arabic Name',
    'Brand', 'Status', 'POS Status', 'Hook EN', 'Hook AR',
    'Short Description EN', 'Short Description AR', 'Description EN', 'Description AR',
    'Product Note EN', 'Product Note AR', 'Material Care EN', 'Material Care AR',
    'Variant Note EN', 'Variant Note AR', 'Size', 'English Color', 'Material',
    'Selling Price', 'Cost-QAR', 'Shipping Cost', 'Quantity', 'Collections',
    'Picture', 'Meta Title', 'Meta Description', 'Slug', 'Related Product SKUs',
  ];
  const example = [
    'SIG-LUXE', 'SIG-LUXE-WHT-5', 'SIG-LUXE-WHT-5', 'Signature II Luxe',
    'سيغنتشر ٢ لوكس', 'Elite Collection', 'hidden', 'active',
    'Quiet luxury, made in Doha.', 'فخامة هادئة صُنعت في الدوحة.',
    'Hand-finished leather slippers.', 'نعال جلدية بتشطيب يدوي.',
    'Classic Arabic slippers.', 'نعال عربية كلاسيكية.',
    'Fits true to size.', 'المقاس مطابق للمعتاد.',
    'Wipe with a soft dry cloth.', 'ينظف بقطعة قماش ناعمة وجافة.',
    '', '', '5', 'White', 'Leather', '980.00', '359.55', '50.54', '0',
    'Classic|Footwear', 'https://drive.google.com/drive/folders/YOUR_FOLDER_ID',
    'Signature II Luxe | Elite Collection',
    'Hand-finished luxury slippers made in Doha.', 'signature-ii-luxe', '',
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="elite-products-template-v2.csv"');
  res.send(`\uFEFF${headers.map(csvCell).join(',')}\n${example.map(csvCell).join(',')}\n`);
});

// ── Streaming bulk import ─────────────────────────────────────────────────────
router.post('/', csvUpload.single('csv'), async (req, res) => {
  const reviewId = String(req.query.reviewId || '').trim();
  const retryId = String(req.query.retryId || '').trim();
  if (!req.file && !reviewId && !retryId) {
    return res.status(422).json({ success: false, message: 'No CSV file received.' });
  }

  const dryRun  = !reviewId && !retryId && (req.query.dryRun === 'true' || req.query.dryRun === '1');
  let allRows;
  let filename;
  let fileSha256 = null;
  let imageMode = normalizeImageMode(req.query.imageMode);
  let reusedJob = null;

  const client = await db.pool.connect();
  let tenant;
  try {
    tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
  } catch (err) {
    client.release();
    throw err;
  }

  // reviewId/retryId consume a previously-parsed job snapshot rather than
  // re-reading (possibly changed) browser state. For reviewId specifically,
  // the lookup, status check, stale-catalog check, and the transition to
  // 'running' all happen in one FOR UPDATE-locked transaction so two
  // concurrent commit requests for the same review (a double-click, a
  // retried network request) cannot both pass the 'review_ready' check — the
  // loser blocks on the row lock, then sees 'running' once the winner's
  // claim commits and 409s instead of re-committing the same rows twice.
  if (reviewId || retryId) {
    try {
      await client.query('BEGIN');
      const source = await client.query(
        `SELECT id, filename, image_mode, source_rows, status, summary
           FROM catalog_import_jobs
          WHERE tenant_id = $1 AND id = $2 AND kind = 'products'
          FOR UPDATE`,
        [tenant.id, reviewId || retryId],
      );
      if (!source.rowCount) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ success: false, message: 'Import review/history was not found.' });
      }
      const sourceJob = source.rows[0];
      if (reviewId && sourceJob.status !== 'review_ready') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({ success: false, message: 'This review was already committed or is no longer available.' });
      }

      if (retryId) {
        const failed = await client.query(
          `SELECT original_rows FROM catalog_import_items
            WHERE job_id = $1 AND status IN ('error','skipped') ORDER BY created_at`,
          [retryId],
        );
        allRows = failed.rows.flatMap(row => row.original_rows || []);
        if (!allRows.length) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({ success: false, message: 'This import has no failed rows to retry.' });
        }
        filename = `retry-${sourceJob.filename}`;
      } else {
        allRows = sourceJob.source_rows || [];
        filename = sourceJob.filename;
        reusedJob = sourceJob.id;
      }
      imageMode = sourceJob.image_mode;

      if (allRows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(422).json({ success: false, message: 'CSV is empty or header row is missing.' });
      }

      if (reviewId) {
        const stale = await findStaleGroups(client, tenant.id, sourceJob, buildGroups(allRows));
        if (stale.length) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({
            success: false,
            message: 'The catalog changed since this preview was generated. Please run preview again.',
          });
        }
        // Claim the job now, inside the same lock, so a concurrent duplicate
        // request sees status='running' the moment this transaction commits.
        await client.query(
          `UPDATE catalog_import_jobs
              SET status='running', started_at=now(), completed_at=NULL, error=NULL
            WHERE id=$1`,
          [sourceJob.id],
        );
        await client.query('DELETE FROM catalog_import_items WHERE job_id=$1', [sourceJob.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
      throw err;
    }
  } else {
    const sourceBuffer = req.file.buffer;
    allRows = csvToObjects(sourceBuffer.toString('utf-8'));
    filename = req.file.originalname || 'import.csv';
    fileSha256 = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    if (allRows.length === 0) {
      client.release();
      return res.status(422).json({ success: false, message: 'CSV is empty or header row is missing.' });
    }
  }
  const apiKey  = process.env.GOOGLE_API_KEY || null;
  const groupEntries = buildGroups(allRows);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  send({ type: 'start', total: groupEntries.length });

  const results = [];
  const catalogSnapshot = [];

  try {
    const userId = req.user?.id || null;
    let jobId = reusedJob;
    if (!jobId) {
      const job = await client.query(
        `INSERT INTO catalog_import_jobs
           (tenant_id, created_by_user_id, kind, filename, file_sha256, image_mode, status, source_rows, started_at)
         VALUES ($1,$2,'products',$3,$4,$5,'running',$6::jsonb,now()) RETURNING id`,
        [tenant.id, userId, filename, fileSha256, imageMode, JSON.stringify(allRows)],
      );
      jobId = job.rows[0].id;
    }

    for (const [groupIndex, [groupKey, groupRows]] of groupEntries.entries()) {
      const current  = groupIndex + 1;
      const firstRow = groupRows[0];
      const baseName = firstRow.name.trim();
      const baseProductSku = (firstRow.productSku || firstRow.variantSku).trim();
      const baseSlug = slugify(firstRow.slug || baseName);

      if (!baseProductSku || !firstRow.variantSku || !baseName) {
        const r = { name: baseName || '(unknown)', status: 'skipped', error: 'Missing SKU or name' };
        results.push(r);
        await saveImportItem(client, jobId, r.name, groupRows, r);
        send({ type: 'item', current, total: groupEntries.length, ...r });
        continue;
      }

      send({ type: 'processing', current, total: groupEntries.length, name: baseName, variantCount: groupRows.length });

      const createdStoragePaths = [];
      const replacedStoragePaths = [];
      try {
        await client.query('BEGIN');

        const nameAr = (firstRow.nameAr || '').trim();

        // Match by stable Product SKU first. Slug remains a legacy fallback so
        // old import files update rather than duplicate existing products.
        const existing = await client.query(
          `SELECT id, sku, brand, status, pos_status, description, care_instructions,
                  base_price_cents, meta_title, meta_desc, slug, updated_at
             FROM products
            WHERE tenant_id=$1 AND status <> 'archived' AND (sku=$2 OR slug=$3)
            ORDER BY CASE WHEN sku=$2 THEN 0 ELSE 1 END
            LIMIT 1`,
          [tenant.id, baseProductSku, baseSlug]
        );

        const existingProduct = existing.rows[0] || null;
        // Captured regardless of dryRun so a preview's summary carries the
        // baseline findStaleGroups() compares a later commit attempt against.
        catalogSnapshot.push({
          key: groupKey,
          productId: existingProduct?.id || null,
          updatedAt: existingProduct?.updated_at ? new Date(existingProduct.updated_at).toISOString() : null,
        });
        const brand = firstRow.brand || existingProduct?.brand || tenant.name || 'Elite';
        const status = importStatus(firstRow.status, existingProduct?.status || 'hidden');
        const posStatus = importStatus(firstRow.posStatus, existingProduct?.pos_status || 'active');
        const existingDesc = existingProduct?.description || {};
        const existingCare = existingProduct?.care_instructions || {};
        const description = {
          en: firstRow.descEn || existingDesc.en || '',
          ar: firstRow.descAr || existingDesc.ar || '',
          shortEn: firstRow.shortEn || existingDesc.shortEn || '',
          shortAr: firstRow.shortAr || existingDesc.shortAr || '',
          teaserEn: firstRow.teaserEn || existingDesc.teaserEn || '',
          teaserAr: firstRow.teaserAr || existingDesc.teaserAr || '',
          noteEn: firstRow.noteEn || existingDesc.noteEn || '',
          noteAr: firstRow.noteAr || existingDesc.noteAr || '',
        };
        const careInstructions = {
          en: firstRow.careEn || existingCare.en || '',
          ar: firstRow.careAr || existingCare.ar || '',
        };
        const firstPrice = groupRows.find(row => row.priceRaw)?.priceRaw || '';
        if (!existingProduct && !firstPrice) throw new Error('Selling Price is required for a new product.');
        const basePriceCents = firstPrice
          ? toCents(parsePrice(firstPrice))
          : Number(existingProduct.base_price_cents || 0);
        const metaTitle = firstRow.metaTitle || existingProduct?.meta_title || null;
        const metaDesc = firstRow.metaDesc || existingProduct?.meta_desc || null;
        let productId, wasInserted;
        if (existingProduct) {
          productId   = existingProduct.id;
          wasInserted = false;
          await client.query(
            `UPDATE products
                SET name=$2, sku=$3, brand=$4, slug=$5, status=$6, pos_status=$7,
                    description=$8::jsonb, care_instructions=$9::jsonb,
                    base_price_cents=$10, meta_title=$11, meta_desc=$12, updated_at=NOW()
              WHERE id=$1`,
            [productId, baseName, baseProductSku, brand, baseSlug, status, posStatus,
             JSON.stringify(description), JSON.stringify(careInstructions), basePriceCents,
             metaTitle, metaDesc]
          );
        } else {
          const ins = await client.query(
            `INSERT INTO products
               (tenant_id, sku, brand, name, slug, status, description, care_instructions,
                base_price_cents, currency, stock_quantity, meta_title, meta_desc, pos_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,0,$11,$12,$13)
             RETURNING id`,
            [tenant.id, baseProductSku, brand, baseName, baseSlug, status,
             JSON.stringify(description), JSON.stringify(careInstructions), basePriceCents,
             tenant.currency || 'QAR', metaTitle, metaDesc, posStatus]
          );
          productId   = ins.rows[0].id;
          wasInserted = true;
        }

        // Upsert Arabic name into product_translations
        if (nameAr) {
          await client.query(
            `INSERT INTO product_translations (product_id, locale, name)
             VALUES ($1, 'ar', $2)
             ON CONFLICT (product_id, locale) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
            [productId, nameAr]
          );
        }

        // Resolve collection membership
        const collectionNames = splitPipeList(firstRow.collection);
        if (collectionNames.length > 0) {
          await client.query('DELETE FROM collection_products WHERE tenant_id=$1 AND product_id=$2', [tenant.id, productId]);
          for (const collectionName of collectionNames) {
            const collHandle = slugify(collectionName);
            const collRes = await client.query(
              `INSERT INTO collections (tenant_id, handle, title, status)
               VALUES ($1,$2,$3,'active')
               ON CONFLICT (tenant_id, handle) DO UPDATE SET title = EXCLUDED.title
               RETURNING id`,
              [tenant.id, collHandle, collectionName]
            );
            await client.query(
              `INSERT INTO collection_products (tenant_id, collection_id, product_id)
               VALUES ($1,$2,$3)
               ON CONFLICT (collection_id, product_id) DO NOTHING`,
              [tenant.id, collRes.rows[0].id, productId]
            );
          }
        }

        const relatedSkus = splitPipeList(firstRow.relatedSkus);
        if (relatedSkus.length > 0) {
          const related = await client.query(
            `SELECT id, sku FROM products
              WHERE tenant_id=$1 AND sku=ANY($2::text[]) AND id<>$3 AND status<>'archived'`,
            [tenant.id, relatedSkus, productId]
          );
          const relatedBySku = new Map(related.rows.map(row => [row.sku, row.id]));
          await client.query('DELETE FROM product_recommendations WHERE tenant_id=$1 AND product_id=$2', [tenant.id, productId]);
          for (const [index, relatedSku] of relatedSkus.entries()) {
            const relatedProductId = relatedBySku.get(relatedSku);
            if (!relatedProductId) continue;
            await client.query(
              `INSERT INTO product_recommendations
                 (tenant_id, product_id, recommended_product_id, sort_order)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (product_id, recommended_product_id) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
              [tenant.id, productId, relatedProductId, index]
            );
          }
        }

        // Each row → one product_variant (color + size)
        let variantsCreated = 0, variantsUpdated = 0;
        let imagesUploaded  = 0, imagesFailed    = 0;
        let firstMediaId    = null;

        // Image behavior is explicit. Blank Picture always preserves existing
        // media; Ignore never performs network/file I/O; Append keeps current
        // links; Replace clears them only after the first new image validates.
        const skipImages = imageMode === 'ignore';
        let replacementPrepared = false;

        // Track which color URLs have already been queued this import (avoid re-downloading same folder)
        const processedColorImages = new Set();

        // Stock held by this product's variants before the import touches them.
        // Every stock_quantity write below must post a matching inventory_movements
        // row against these values — see server/lib/inventory-ledger.js for why,
        // and admin-products.route.js's replaceVariants() for the same pattern.
        const previousStockBySku = new Map();
        const existingVariantBySku = new Map();
        const existingVariants = await client.query(
          `SELECT sku, stock_quantity, price_cents
             FROM product_variants
            WHERE tenant_id = $1 AND product_id = $2`,
          [tenant.id, productId],
        );
        for (const row of existingVariants.rows) {
          previousStockBySku.set(row.sku, Number(row.stock_quantity) || 0);
          existingVariantBySku.set(row.sku, row);
        }

        // Never let a mistyped Product SKU silently move an existing variant
        // from another product. Report the conflict and keep both products intact.
        const incomingVariantSkus = groupRows.map(row => row.variantSku);
        const foreignVariants = await client.query(
          `SELECT sku FROM product_variants
            WHERE tenant_id=$1 AND sku=ANY($2::text[]) AND product_id<>$3
            LIMIT 1`,
          [tenant.id, incomingVariantSkus, productId]
        );
        if (foreignVariants.rowCount > 0) {
          throw new Error(`Variant SKU "${foreignVariants.rows[0].sku}" already belongs to another product.`);
        }

        for (const [varIdx, row] of groupRows.entries()) {
          const existingVariant = existingVariantBySku.get(row.variantSku);
          const priceCents    = row.priceRaw
            ? toCents(parsePrice(row.priceRaw))
            : Number(existingVariant?.price_cents ?? basePriceCents);
          const costCents     = row.costRaw     ? toCents(parsePrice(row.costRaw))     : null;
          const shippingCents = row.shippingRaw ? toCents(parsePrice(row.shippingRaw)) : null;
          const stockQty      = row.qtyRaw !== '' ? Math.max(0, parseInt(row.qtyRaw, 10) || 0) : null;
          const sizeVal       = row.size || null;

          // Use explicit color from CSV; fall back to SKU-inferred color
          const colorVal = (row.color || '').trim() || inferColorFromSku(row.variantSku) || null;

          // Barcode defaults to the variant's own SKU — see replaceVariants()
          // in admin-products.route.js for the same convention.
          const barcodeVal = (row.barcode || '').trim() || null;

          const varResult = await client.query(
            `INSERT INTO product_variants
               (tenant_id, product_id, sku, barcode, color, size, material,
                price_cents, cost_price_cents, shipping_cost_cents, stock_quantity,
                sort_order, note_en, note_ar, color_ref_id)
             VALUES ($1,$2,$3,COALESCE($4,$3),$5,$6,$7,$8,$9,$10,COALESCE($11,0),$12,$13,$14,
               (SELECT id FROM ref_colors WHERE tenant_id=$1 AND lower(trim(name_en))=lower(trim($5)) LIMIT 1))
             ON CONFLICT (tenant_id, sku) DO UPDATE SET
               product_id=$2, barcode=COALESCE($4, product_variants.barcode, $3),
               color=COALESCE($5, product_variants.color),
               size=COALESCE($6, product_variants.size),
               material=COALESCE($7, product_variants.material), price_cents=$8,
               cost_price_cents=COALESCE($9, product_variants.cost_price_cents),
               shipping_cost_cents=COALESCE($10, product_variants.shipping_cost_cents),
               stock_quantity=COALESCE($11, product_variants.stock_quantity),
               sort_order=$12,
               note_en=COALESCE($13, product_variants.note_en),
               note_ar=COALESCE($14, product_variants.note_ar),
               updated_at=NOW(),
               color_ref_id=(SELECT id FROM ref_colors WHERE tenant_id=$1 AND lower(trim(name_en))=lower(trim($5)) LIMIT 1)
             RETURNING id, stock_quantity, (xmax=0) AS inserted`,
            [tenant.id, productId, row.variantSku, barcodeVal, colorVal, sizeVal, row.material || null,
             priceCents, costCents, shippingCents, stockQty, varIdx,
             row.variantNoteEn || null, row.variantNoteAr || null]
          );
          const variantId = varResult.rows[0].id;
          const variantInserted = varResult.rows[0].inserted;
          if (variantInserted) variantsCreated++; else variantsUpdated++;

          // The upsert's CASE means the stored stock is not always what was
          // sent (a CSV row with an empty quantity must not zero out real
          // stock), so the delta is computed from what the database actually
          // ended up with — same convention as replaceVariants() in
          // admin-products.route.js.
          const previousStock = previousStockBySku.get(row.variantSku) ?? 0;
          const newStock = Number(varResult.rows[0].stock_quantity) || 0;
          const stockDelta = newStock - previousStock;
          if (stockDelta !== 0) {
            await recordMovement(client, { tenantId: tenant.id, userId }, {
              productId,
              variantId,
              delta: stockDelta,
              reason: 'bulk_import',
              referenceType: 'product',
              referenceId: productId,
              metadata: {
                sku: row.variantSku,
                action: variantInserted ? 'variant_created' : 'variant_updated',
                previousStock,
                newStock,
              },
            });
            await publishStockEvent(client, tenant.id, variantId, newStock);
          }

          // Images: only resolve a source once per product. Review validates
          // remote files but deliberately does not write storage or DB rows.
          if (!skipImages && row.imageUrl && !processedColorImages.has(row.imageUrl)) {
            processedColorImages.add(row.imageUrl);
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
                  if (dryRun) continue;
                  const filename = filenameFromMime(contentType, imgUrl);
                  const stored   = await storage.save({ buffer, filename, mimeType: contentType });
                  const newPaths = storedPaths(stored);
                  createdStoragePaths.push(...newPaths);
                  let mediaId;
                  try {
                    if (imageMode === 'replace' && !replacementPrepared) {
                      replacementPrepared = true;
                      const oldMedia = await client.query(
                        `SELECT DISTINCT m.id
                           FROM media_links ml
                           JOIN media_assets m ON m.id=ml.media_id
                          WHERE ml.product_id=$1 AND ml.role IN ('gallery','primary')`,
                        [productId],
                      );
                      await client.query('UPDATE products SET primary_media_id=NULL WHERE id=$1', [productId]);
                      await client.query(
                        "DELETE FROM media_links WHERE product_id=$1 AND role IN ('gallery','primary')",
                        [productId],
                      );
                      const removed = await client.query(
                        `DELETE FROM media_assets m
                          WHERE m.tenant_id=$1
                            AND m.id=ANY($2::uuid[])
                            AND NOT EXISTS (SELECT 1 FROM media_links ml WHERE ml.media_id=m.id)
                        RETURNING metadata`,
                        [tenant.id, oldMedia.rows.map(media => media.id)],
                      );
                      for (const old of removed.rows) {
                        replacedStoragePaths.push(...storedPaths({
                          storagePath: old.metadata?.storagePath,
                          variants: old.metadata?.imageVariants || {},
                        }));
                      }
                      sortOrder = 0;
                    }
                    const mediaRow = await client.query(
                      `INSERT INTO media_assets
                         (tenant_id,filename,kind,mime_type,size_bytes,width,height,storage_url,preview_url,uploaded_by_user_id,metadata)
                       VALUES ($1,$2,'image',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING id`,
                      [tenant.id, filename, contentType, buffer.length, stored.width, stored.height, stored.url, stored.previewUrl, userId,
                       JSON.stringify({
                         storagePath: stored.storagePath,
                         importedFrom: 'bulk-import',
                         variantSku: row.variantSku,
                         color: colorVal,
                         imageVariants: stored.variants || {},
                       })]
                    );
                    mediaId = mediaRow.rows[0].id;
                    await client.query(
                      `INSERT INTO media_links (tenant_id,media_id,product_id,role,sort_order) VALUES ($1,$2,$3,'gallery',$4)`,
                      [tenant.id, mediaId, productId, sortOrder]
                    );
                  } catch (error) {
                    await storage.removeMany(newPaths);
                    throw error;
                  }
                  if (!firstMediaId) firstMediaId = mediaId;
                  sortOrder++;
                  imagesUploaded++;
                } catch (error) {
                  imagesFailed++;
                  // Previously swallowed silently — a failed image download left
                  // no trace anywhere, not even server logs, making "images
                  // didn't arrive" unanswerable after the fact.
                  (req.log || console).warn(
                    { err: { message: error.message, code: error.code }, imgUrl, sku: row.variantSku },
                    'bulk-import: image download/store failed',
                  );
                  if (error?.code) throw error; // database/storage failure: rollback product atomically
                }
              }
            }
          }
        }

        // Re-sum all variant stock onto the parent product so the catalog
        // stock total stays accurate — same statement used by every other
        // stock-writing path in the codebase (replaceVariants, /bulk-stock,
        // sale-service, order-stock). Runs before the dryRun check so a dry
        // run's would-be total still gets rolled back with everything else.
        await client.query(
          `UPDATE products
              SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants WHERE product_id = $1),
                  updated_at = now()
            WHERE id = $1`,
          [productId],
        );

        if (firstMediaId) {
          await client.query(
            `UPDATE products SET primary_media_id=$1
              WHERE id=$2 AND (primary_media_id IS NULL OR $3='replace')`,
            [firstMediaId, productId, imageMode]
          );
        }

        await publishCatalogEvent(client, tenant.id, productId, wasInserted ? 'created' : 'updated');

        if (dryRun) {
          await client.query('ROLLBACK');
        } else {
          await client.query('COMMIT');
          if (replacedStoragePaths.length) await storage.removeMany(replacedStoragePaths);
        }

        const r = {
          name: baseName,
          productId: dryRun ? null : productId,
          status: wasInserted ? 'created' : 'updated',
          variantsCreated,
          variantsUpdated,
          imagesUploaded: dryRun ? 0 : imagesUploaded,
          imagesFailed:   dryRun ? 0 : imagesFailed,
        };
        results.push(r);
        await saveImportItem(client, jobId, baseProductSku, groupRows, r);
        send({ type: 'item', current, total: groupEntries.length, ...r });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        if (createdStoragePaths.length) await storage.removeMany(createdStoragePaths);
        const r = { name: baseName, status: 'error', error: err.message };
        results.push(r);
        await saveImportItem(client, jobId, baseProductSku || baseName, groupRows, r);
        send({ type: 'item', current, total: groupEntries.length, ...r });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const updated = results.filter(r => r.status === 'updated').length;
    const failed  = results.filter(r => r.status === 'error' || r.status === 'skipped').length;
    const summary = { total: groupEntries.length, created, updated, failed, catalogSnapshot };
    await client.query(
      `UPDATE catalog_import_jobs
          SET status=$2, summary=$3::jsonb, completed_at=now()
        WHERE id=$1`,
      [jobId, dryRun ? 'review_ready' : 'completed', JSON.stringify(summary)],
    );
    send({ type: 'done', jobId, summary, noApiKey: !apiKey });

  } finally {
    client.release();
    res.end();
  }
});

// ── Repair: infer color from SKU for variants with no color set ───────────────
// POST /api/admin/bulk-import/repair-colors
// Scans all product_variants with null/empty color, tries to infer from SKU,
// and updates them. Returns { repaired, skipped }.
router.post('/repair-colors', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const { rows } = await client.query(
      "SELECT id, product_id, sku FROM product_variants WHERE tenant_id = $1 AND (color IS NULL OR color = '')",
      [tenant.id],
    );

    let repaired = 0, skipped = 0;
    await client.query('BEGIN');
    const changedProducts = new Set();
    for (const row of rows) {
      const color = inferColorFromSku(row.sku);
      if (color) {
        await client.query(
          'UPDATE product_variants SET color = $1, updated_at = NOW() WHERE id = $2',
          [color, row.id],
        );
        changedProducts.add(row.product_id);
        repaired++;
      } else {
        skipped++;
      }
    }
    for (const productId of changedProducts) {
      await publishCatalogEvent(client, tenant.id, productId, 'variants_changed');
    }
    await client.query('COMMIT');
    res.json({ success: true, data: { repaired, skipped, total: rows.length } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports._test = {
  parseCSV, csvToObjects, parseStockCSV, splitPipeList, importStatus, csvCell, normalizeImageMode,
  isPrivateIp, assertPublicHost, buildGroups, findStaleGroups,
};
