const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../db/client');
const { PosError } = require('./pos/errors');
const { recordMovement, publishStockEvent } = require('./inventory-ledger');
const {
  perLocationEnabled, requireLocation, lockLocationQuantity, applyLocationDelta, syncLocations,
} = require('./location-stock');
const { kickRestockDispatch } = require('./restock-dispatch-job');

/**
 * Stock file update (Inventory → Update from file, 2026-09-28).
 *
 * Staff download a sheet listing every active size for ONE location, type the
 * number they counted in the Stock column, and upload it. The number is the
 * new quantity at that location (absolute, like a stocktake); an empty Stock
 * cell means "leave it". With stock per location off, the sheet and the
 * numbers are the single shared figure, as the old Catalog stock import did.
 *
 * The sheet carries a Location column. Uploading it against another location
 * is refused (LOCATION_MISMATCH): that mix-up would overwrite a shop's stock
 * with another location's count. It also carries Current (the number when it
 * was downloaded) so the review can flag sizes that sold in between.
 *
 * Preview stores the reviewed rows in catalog_import_jobs (kind 'stock') and
 * commit applies them, so the Catalog import history keeps listing them.
 */

const ALL_LOCATIONS = 'All locations';
const TEMPLATE_COLUMNS = ['Location', 'Product', 'Color', 'Size', 'SKU', 'Barcode', 'Current', 'Stock'];

const stockFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype)
      || file.originalname.toLowerCase().endsWith('.csv');
    if (ok) return cb(null, true);
    cb(new PosError(422, 'CSV_ONLY', 'Only CSV files are accepted.'));
  },
});

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 rows; blank lines dropped. */
function parseCSV(text) {
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = text.endsWith('\n') ? text : `${text}\n`;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || (ch === '\r' && input[i + 1] === '\n')) {
      if (ch === '\r') i++;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) lines.push(row);
      row = [];
    } else field += ch;
  }
  return lines;
}

/** Spreadsheet-safe cell: quoted when needed, formula triggers neutralised. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\t\r]/.test(text) || /^-[^0-9]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Undo csvCell's guard when a downloaded sheet comes back. */
function cellValue(raw) {
  const text = String(raw ?? '').trim();
  return /^'([=+@\t\r]|-[^0-9])/.test(text) ? text.slice(1) : text;
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Rows with a number in Stock. Rows whose Stock is empty are counted as
 * skipped and dropped, so a full sheet with three numbers typed is three rows.
 */
function parseStockCSV(text) {
  const rows = parseCSV(String(text || '').replace(/^﻿/, '').trim());
  if (rows.length < 2) return { rows: [], skipped: 0, fileLocation: null, fileErrors: ['The file is empty.'] };
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const col = (name) => headers.indexOf(name);
  const skuIndex = col('sku');
  const stockIndex = col('stock');
  const locationIndex = col('location');
  const currentIndex = col('current');
  if (skuIndex < 0 || stockIndex < 0) {
    return { rows: [], skipped: 0, fileLocation: null, fileErrors: ['Required columns are SKU and Stock.'] };
  }

  const locations = new Set();
  const seen = new Set();
  const parsed = [];
  let skipped = 0;
  rows.slice(1).forEach((row, index) => {
    const sku = cellValue(row[skuIndex]);
    const rawStock = cellValue(row[stockIndex]);
    const location = locationIndex >= 0 ? cellValue(row[locationIndex]) : '';
    if (location) locations.add(location);
    if (!rawStock) { if (sku) skipped++; return; }
    const errors = [];
    if (!sku) errors.push('SKU is required.');
    if (!/^\d+$/.test(rawStock)) errors.push('Stock must be a whole number greater than or equal to zero.');
    const key = sku.toLowerCase();
    if (sku && seen.has(key)) errors.push('Duplicate SKU in file.');
    if (sku) seen.add(key);
    const rawCurrent = currentIndex >= 0 ? cellValue(row[currentIndex]) : '';
    parsed.push({
      line: index + 2,
      sku,
      stock: /^\d+$/.test(rawStock) ? Number(rawStock) : null,
      fileCurrent: /^-?\d+$/.test(rawCurrent) ? Number(rawCurrent) : null,
      errors,
    });
  });

  const distinct = [...new Map([...locations].map((name) => [name.toLowerCase(), name])).values()];
  if (distinct.length > 1) {
    return {
      rows: [], skipped, fileLocation: null,
      fileErrors: [`This file mixes locations (${distinct.join(', ')}). Use one file per location.`],
    };
  }
  return { rows: parsed, skipped, fileLocation: distinct[0] || null, fileErrors: [] };
}

// ── Location for this file ─────────────────────────────────────────────────

/** The location a file is for: required with stock per location on, none otherwise. */
async function fileLocation(client, tenantId, locationId) {
  if (!(await perLocationEnabled(client, tenantId))) return null;
  const id = String(locationId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new PosError(422, 'LOCATION_REQUIRED', 'Choose which location this stock file is for.');
  }
  return requireLocation(client, tenantId, id);
}

function locationLabel(location) {
  return location ? location.name : ALL_LOCATIONS;
}

// ── Template: every active size, Stock left empty ──────────────────────────

async function buildTemplate(context, locationId) {
  const client = await db.pool.connect();
  try {
    await syncLocations(client, context.tenantId);
    const location = await fileLocation(client, context.tenantId, locationId);
    const { rows } = await client.query(
      `SELECT p.name AS product_name, pv.color, pv.size, pv.sku, pv.barcode,
              ${location
    ? 'COALESCE((SELECT vls.quantity FROM variant_location_stock vls WHERE vls.variant_id = pv.id AND vls.location_id = $2), 0)'
    : 'pv.stock_quantity'} AS current
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.tenant_id = $1 AND pv.is_active AND p.status <> 'archived' AND pv.sku IS NOT NULL AND pv.sku <> ''
        ORDER BY p.name, pv.color NULLS FIRST,
                 CASE WHEN pv.size ~ '^[0-9]+(\\.[0-9]+)?$' THEN pv.size::numeric END NULLS LAST, pv.size, pv.sku`,
      location ? [context.tenantId, location.id] : [context.tenantId],
    );
    const label = locationLabel(location);
    const lines = [
      TEMPLATE_COLUMNS.map(csvCell).join(','),
      ...rows.map((row) => [label, row.product_name, row.color, row.size, row.sku, row.barcode, Number(row.current), '']
        .map(csvCell).join(',')),
    ];
    const slug = String(label).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'location';
    const date = new Date().toISOString().slice(0, 10);
    return { filename: `stock-${slug}-${date}.csv`, csv: `﻿${lines.join('\r\n')}\r\n`, rows: rows.length };
  } finally {
    client.release();
  }
}

// ── Preview ────────────────────────────────────────────────────────────────

async function saveImportItem(client, jobId, key, originalRows, result) {
  await client.query(
    `INSERT INTO catalog_import_items (job_id, item_key, original_rows, status, product_id, result, error)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7)`,
    [jobId, key, JSON.stringify(originalRows), result.status, result.productId || null, JSON.stringify(result), result.error || null],
  );
}

async function previewStockFile(context, { buffer, filename, locationId }) {
  if (!buffer) throw new PosError(422, 'FILE_REQUIRED', 'No CSV file received.');
  const parsed = parseStockCSV(buffer.toString('utf-8'));
  if (parsed.fileErrors.length) throw new PosError(422, 'FILE_INVALID', parsed.fileErrors.join(' '));

  const client = await db.pool.connect();
  try {
    const location = await fileLocation(client, context.tenantId, locationId);
    const label = locationLabel(location);
    if (parsed.fileLocation && !sameName(parsed.fileLocation, label)) {
      throw new PosError(422, 'LOCATION_MISMATCH',
        `This sheet was downloaded for ${parsed.fileLocation}, but you chose ${label}. Choose ${parsed.fileLocation}, or download the sheet for ${label}.`,
        { fileLocation: parsed.fileLocation, chosen: label });
    }
    if (!parsed.rows.length) {
      throw new PosError(422, 'NOTHING_FILLED', 'No numbers were filled in. Type the counted number in the Stock column and upload again.');
    }

    const skus = parsed.rows.filter((row) => row.sku).map((row) => row.sku);
    // Exact SKU first, then a known SKU alias.
    const existing = await client.query(
      `SELECT DISTINCT ON (input.input_sku)
              input.input_sku, pv.id AS variant_id, pv.product_id, pv.sku, pv.color, pv.size,
              p.name AS product_name, pv.stock_quantity AS total
         FROM unnest($2::text[]) AS input(input_sku)
         JOIN product_variants pv ON pv.tenant_id = $1 AND (
           pv.sku = input.input_sku OR EXISTS (
             SELECT 1 FROM catalog_identifier_aliases cia
              WHERE cia.tenant_id = $1 AND cia.variant_id = pv.id
                AND cia.identifier_type = 'variant_sku'
                AND cia.normalized_value = lower(btrim(input.input_sku))
           )
         )
         JOIN products p ON p.id = pv.product_id
        WHERE p.status <> 'archived'
        ORDER BY input.input_sku, (pv.sku = input.input_sku) DESC`,
      [context.tenantId, skus],
    );
    const bySku = new Map(existing.rows.map((row) => [row.input_sku, row]));
    const atLocation = new Map();
    if (location && existing.rows.length) {
      const balances = await client.query(
        'SELECT variant_id, quantity FROM variant_location_stock WHERE location_id = $1 AND variant_id = ANY($2::uuid[])',
        [location.id, existing.rows.map((row) => row.variant_id)],
      );
      for (const row of balances.rows) atLocation.set(row.variant_id, Number(row.quantity));
    }

    const reviewed = parsed.rows.map((row) => {
      const match = bySku.get(row.sku);
      const errors = [...row.errors];
      if (row.sku && !match) errors.push('SKU was not found.');
      const current = match ? (location ? (atLocation.get(match.variant_id) ?? 0) : Number(match.total)) : null;
      const change = match && row.stock !== null ? row.stock - current : null;
      // Units held for paid website orders are part of the location but not
      // of the sellable total; the count cannot go below them.
      if (location && match && change !== null && Number(match.total) + change < 0) {
        errors.push(`${-(Number(match.total) + change)} unit(s) are held for paid website orders, so it cannot go that low.`);
      }
      return {
        line: row.line,
        sku: row.sku,
        stock: row.stock,
        variantId: match?.variant_id || null,
        productId: match?.product_id || null,
        productName: match?.product_name || null,
        color: match?.color || null,
        size: match?.size || null,
        currentStock: current,
        change,
        changedSinceDownload: row.fileCurrent !== null && current !== null && row.fileCurrent !== current
          ? { was: row.fileCurrent, now: current } : null,
        errors,
      };
    });
    const failed = reviewed.filter((row) => row.errors.length).length;
    const changed = reviewed.filter((row) => !row.errors.length && row.change).length;
    const summary = {
      total: reviewed.length,
      valid: reviewed.length - failed,
      failed,
      changed,
      unchanged: reviewed.length - failed - changed,
      skipped: parsed.skipped,
      ...(location ? { locationId: location.id, locationName: location.name } : {}),
    };

    await client.query('BEGIN');
    const job = await client.query(
      `INSERT INTO catalog_import_jobs
         (tenant_id, created_by_user_id, kind, filename, file_sha256, status, source_rows, summary, started_at, completed_at)
       VALUES ($1,$2,'stock',$3,$4,'review_ready',$5::jsonb,$6::jsonb,now(),now()) RETURNING id`,
      [context.tenantId, context.userId || null, filename || 'stock.csv',
        crypto.createHash('sha256').update(buffer).digest('hex'), JSON.stringify(reviewed), JSON.stringify(summary)],
    );
    for (const row of reviewed) {
      await saveImportItem(client, job.rows[0].id, row.sku || `Line ${row.line}`, [row], {
        name: row.sku || `Line ${row.line}`,
        status: row.errors.length ? 'error' : 'updated',
        error: row.errors.join(' '),
        currentStock: row.currentStock,
        newStock: row.stock,
        line: row.line,
      });
    }
    await client.query('COMMIT');
    return {
      jobId: job.rows[0].id,
      rows: reviewed,
      summary,
      location: location ? { id: location.id, name: location.name } : null,
      canCommit: failed === 0 && reviewed.length > 0,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Commit ─────────────────────────────────────────────────────────────────

async function commitStockFile(context, jobId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(jobId || ''))) throw new PosError(404, 'NOT_FOUND', 'Stock review was not found.');
  const tenantId = context.tenantId;
  const client = await db.pool.connect();
  let changedProducts = new Set();
  let result;
  try {
    await client.query('BEGIN');
    const jobResult = await client.query(
      `SELECT * FROM catalog_import_jobs WHERE tenant_id = $1 AND id = $2 AND kind = 'stock' FOR UPDATE`,
      [tenantId, jobId],
    );
    if (!jobResult.rowCount) throw new PosError(404, 'NOT_FOUND', 'Stock review was not found.');
    const job = jobResult.rows[0];
    if (job.status !== 'review_ready') throw new PosError(409, 'ALREADY_COMMITTED', 'This stock review was already saved.');
    const perLocation = await perLocationEnabled(client, tenantId);
    const locationId = job.summary?.locationId || null;
    if (perLocation && !locationId) {
      throw new PosError(409, 'LOCATION_REQUIRED', 'This file was reviewed before stock per location was on. Upload it again and choose its location.');
    }
    if (!perLocation && locationId) {
      throw new PosError(409, 'LOCATION_OFF', 'Stock per location was turned off after this file was reviewed. Upload it again.');
    }
    const rows = job.source_rows || [];
    if (!rows.length || rows.some((row) => Array.isArray(row.errors) && row.errors.length)) {
      throw new PosError(422, 'REVIEW_HAS_ERRORS', 'Fix every problem in the file before saving.');
    }

    await client.query("UPDATE catalog_import_jobs SET status = 'running', started_at = now() WHERE id = $1", [job.id]);
    await client.query('DELETE FROM catalog_import_items WHERE job_id = $1', [job.id]);
    // Every row lock up front, in variant-id order like every other stock
    // writer, so a save cannot deadlock against a till sale.
    await client.query(
      'SELECT id FROM product_variants WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
      [tenantId, rows.map((row) => row.variantId).filter(Boolean)],
    );
    const location = perLocation ? await requireLocation(client, tenantId, locationId) : null;
    const actor = { tenantId, userId: context.userId || null };
    let updated = 0;
    let changed = 0;
    for (const row of rows) {
      const variant = await client.query(
        'SELECT id, product_id, stock_quantity FROM product_variants WHERE tenant_id = $1 AND id = $2',
        [tenantId, row.variantId],
      );
      if (!variant.rowCount) throw new PosError(409, 'SKU_GONE', `Size "${row.sku}" no longer exists.`);
      const target = Number(row.stock);
      const totalBefore = Number(variant.rows[0].stock_quantity);
      const before = location ? await lockLocationQuantity(client, tenantId, row.variantId, location.id) : totalBefore;
      const delta = target - before;
      if (totalBefore + delta < 0) {
        throw new PosError(409, 'STOCK_HELD', `${row.sku}: some units are held for paid website orders, so it cannot go that low.`);
      }
      if (delta !== 0) {
        if (location) await applyLocationDelta(client, tenantId, { variantId: row.variantId, locationId: location.id, delta, sku: row.sku });
        await client.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1',
          [row.variantId, delta],
        );
        await recordMovement(client, actor, {
          productId: variant.rows[0].product_id,
          variantId: row.variantId,
          delta,
          reason: 'bulk_import',
          referenceType: 'stock_import',
          referenceId: job.id,
          locationId: location?.id || null,
          metadata: {
            sku: row.sku, previousStock: before, newStock: target, importJobId: job.id,
            ...(location ? { location: location.name } : {}),
          },
        });
        await publishStockEvent(client, tenantId, row.variantId, totalBefore + delta);
        changedProducts.add(variant.rows[0].product_id);
        changed++;
      }
      updated++;
      await saveImportItem(client, job.id, row.sku, [row], {
        name: row.sku, status: 'updated', currentStock: before, newStock: target,
      });
    }
    for (const productId of changedProducts) {
      await client.query(
        `UPDATE products SET stock_quantity = (SELECT COALESCE(sum(stock_quantity), 0) FROM product_variants WHERE product_id = $1), updated_at = now()
          WHERE id = $1`,
        [productId],
      );
    }
    const summary = { ...job.summary, total: rows.length, updated, changed, unchanged: updated - changed, failed: 0 };
    await client.query(
      "UPDATE catalog_import_jobs SET status = 'completed', summary = $2::jsonb, completed_at = now() WHERE id = $1",
      [job.id, JSON.stringify(summary)],
    );
    await client.query('COMMIT');
    result = {
      jobId, updated, changed, summary,
      location: location ? { id: location.id, name: location.name } : null,
      notFound: [],
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  kickRestockDispatch([...changedProducts]);
  return result;
}

module.exports = {
  ALL_LOCATIONS,
  TEMPLATE_COLUMNS,
  stockFileUpload,
  parseStockCSV,
  csvCell,
  buildTemplate,
  previewStockFile,
  commitStockFile,
};
