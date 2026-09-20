const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, slugify, toCents, validationError } = require('./lib');
const { upload } = require('../middleware/upload');
const { storage, IMAGE_VARIANT_KEYS } = require('../lib/storage');
const { ensureProductRecommendationsSchema } = require('../db/product-recommendations-schema');
const { kickRestockDispatch } = require('../lib/restock-dispatch-job');
// Every stock_quantity write in this file posts a matching ledger row in the
// same transaction — see server/lib/inventory-ledger.js for why that invariant
// exists and what breaks when a write skips it (docs/25 Phase 1b).
const { recordMovement, publishStockEvent, publishCatalogEvent } = require('../lib/inventory-ledger');

/**
 * Matches the `-card` in `mq9eqaq9-6714c560-card.webp`: the suffix `storage.js`
 * appends when it derives a resized copy. A URL carrying one is a derivative,
 * never an original upload, so it must never become a media asset of its own.
 */
const VARIANT_SUFFIX = new RegExp(`-(${IMAGE_VARIANT_KEYS.join('|')})$`, 'i');

/** Filename without its directory or extension. */
function urlStem(url) {
  const filename = String(url).split('/').pop()?.split('?')[0] || '';
  return filename.replace(/\.[a-z0-9]+$/i, '');
}

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ensure SEO columns exist (migration 004 may not have run on all environments)
let seoColumnsReady = false;
async function ensureSeoColumns(client) {
  if (seoColumnsReady) return;
  await client.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS meta_title text,
      ADD COLUMN IF NOT EXISTS meta_desc  text
  `);
  seoColumnsReady = true;
}

// Ensure cost_price_cents exists (migration 006 may not have run on all environments)
let costPriceColumnReady = false;
async function ensureCostPriceColumn(client) {
  if (costPriceColumnReady) return;
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS cost_price_cents integer
  `);
  costPriceColumnReady = true;
}

// Ensure the bilingual per-variant note columns exist (migration 031 may not
// have run on all environments). The note carries a construction difference
// that only applies to some sizes, e.g. "Back zipper" on 2-4 but not 6-10.
let variantNoteColumnsReady = false;
async function ensureVariantNoteColumns(client) {
  if (variantNoteColumnsReady) return;
  await client.query(`
    ALTER TABLE product_variants
      ADD COLUMN IF NOT EXISTS note_en text,
      ADD COLUMN IF NOT EXISTS note_ar text
  `);
  variantNoteColumnsReady = true;
}

const IMAGE_COLORS_SELECT = `
        COALESCE((
          SELECT jsonb_object_agg(url, color)
          FROM (
            SELECT DISTINCT ON (url)
              url,
              color
            FROM (
              SELECT
                COALESCE(m.preview_url, m.storage_url) AS url,
                trim(m.metadata->>'color') AS color,
                ml.sort_order
              FROM media_links ml
              JOIN media_assets m ON m.id = ml.media_id
              WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
            ) gallery_colors
            WHERE url IS NOT NULL AND url <> '' AND color IS NOT NULL AND color <> ''
            ORDER BY url, sort_order
          ) unique_gallery_colors
        ), '{}'::jsonb) AS image_colors`;

/** Turns a unique-constraint failure into a 409 the editor can show. */
function productConflict(err) {
  if (err?.code !== '23505') return err;
  const detail = String(err.detail || '');
  const field = /slug/.test(detail) ? 'slug' : /barcode/.test(detail) ? 'barcode' : 'SKU';
  const value = /=\(([^)]*)\)/.exec(detail)?.[1]?.split(', ').pop();
  const conflict = new Error(`Another product already uses this ${field}${value ? ` (${value})` : ''}.`);
  conflict.status = 409;
  return conflict;
}

function validateProduct(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return ['Product payload is required.'];
  }
  if (!String(body.name || '').trim()) errors.push('Product name is required.');
  if (!String(body.sku || '').trim()) errors.push('SKU is required.');
  if (!String(body.brand || '').trim()) errors.push('Brand is required.');
  if (Number(body.price) < 0) errors.push('Price cannot be negative.');
  if (body.defaultCostPrice != null && body.defaultCostPrice !== '' && Number(body.defaultCostPrice) < 0) {
    errors.push('Default product cost cannot be negative.');
  }
  if (body.defaultShippingCost != null && body.defaultShippingCost !== '' && Number(body.defaultShippingCost) < 0) {
    errors.push('Default shipping cost cannot be negative.');
  }
  // Prices are whole QAR (owner decision 2026-09-15); a fraction or text would
  // otherwise be rounded or zeroed silently.
  if (body.price != null && body.price !== '' && !Number.isInteger(Number(body.price))) {
    errors.push('Price must be a whole number of QAR.');
  }
  if (Number(body.stock) < 0) errors.push('Stock cannot be negative.');
  if (!Array.isArray(body.variants) || body.variants.length === 0) {
    errors.push('At least one product variant is required.');
  } else {
    const seen = new Set();
    body.variants.forEach((variant, index) => {
      const sku = String(variant?.sku || '').trim();
      if (!sku) {
        errors.push(`Variant ${index + 1} SKU is required.`);
      } else if (seen.has(sku)) {
        errors.push(`Duplicate variant SKU "${sku}".`);
      }
      if (sku) seen.add(sku);
      // Every variant is a sellable size (owner decision 2026-09-15).
      if (!String(variant?.size ?? '').trim()) {
        errors.push(`Variant ${sku || index + 1} needs a size.`);
      }
      if (variant?.price != null && variant.price !== '' && !Number.isInteger(Number(variant.price))) {
        errors.push(`Variant ${sku || index + 1} price must be a whole number of QAR.`);
      }
    });
  }

  return errors;
}

async function replaceVariants(client, tenantId, productId, variants, { trustZeroStock = true, actorUserId = null, expectedStock = null } = {}) {
  await ensureVariantNoteColumns(client);

  // Lock first and identify rows by UUID. SKU is editable catalog data, not a
  // row identity: using it as identity used to delete/recreate a variant when
  // its SKU changed, severing stock history and making duplicated products
  // collide with their source product.
  const existingVariants = await client.query(
    `SELECT id, sku, barcode, barcode_source, stock_quantity
       FROM product_variants
      WHERE tenant_id = $1 AND product_id = $2
      FOR UPDATE`,
    [tenantId, productId],
  );
  const existingById = new Map(existingVariants.rows.map((row) => [row.id, row]));
  const existingBySku = new Map(existingVariants.rows.map((row) => [row.sku, row]));

  const resolved = variants.map((variant) => {
    const sku = String(variant.sku || '').trim();
    if (!sku) {
      const err = new Error('Every product variant requires an SKU.');
      err.status = 400;
      throw err;
    }

    const requestedId = UUID_RE.test(String(variant.id || '')) ? String(variant.id) : null;
    if (requestedId && !existingById.has(requestedId)) {
      const err = new Error(`Variant ${requestedId} does not belong to this product.`);
      err.status = 400;
      throw err;
    }
    // Older clients did not reliably send the id. Retain compatibility by
    // matching the current SKU only when no persisted UUID is present.
    const existing = requestedId ? existingById.get(requestedId) : existingBySku.get(sku);
    const typedBarcode = String(variant.barcode || '').trim();
    const existingBarcodeWasAuto = existing?.barcode_source === 'auto'
      || (!!existing && String(existing.barcode || '').trim() === String(existing.sku || '').trim());
    const shouldUseAutoBarcode = variant.barcodeSource === 'auto'
      || !typedBarcode
      || (!!existing && existingBarcodeWasAuto && typedBarcode === String(existing.barcode || '').trim());
    const barcodeSource = shouldUseAutoBarcode ? 'auto' : 'manual';
    const barcode = barcodeSource === 'auto' ? sku : typedBarcode;
    return { variant, sku, barcode, barcodeSource, existing: existing || null };
  });
  const incomingSkus = resolved.map((r) => r.sku);

  if (incomingSkus.length > 0) {
    // ON CONFLICT (tenant_id, sku) below would silently move another product's
    // variant onto this one, taking its stock and stocktake history with it.
    const taken = await client.query(
      `(SELECT pv.sku, p.name, p.status FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.tenant_id = $1 AND pv.product_id <> $2 AND pv.sku = ANY($3::text[])
        LIMIT 1)
       UNION ALL
       (SELECT cia.value AS sku, p.name, p.status
          FROM catalog_identifier_aliases cia
          JOIN product_variants pv ON pv.id = cia.variant_id
          JOIN products p ON p.id = pv.product_id
         WHERE cia.tenant_id = $1 AND pv.product_id <> $2
           AND cia.identifier_type = 'variant_sku'
           AND cia.normalized_value = ANY($4::text[])
         LIMIT 1)
       LIMIT 1`,
      [tenantId, productId, incomingSkus, incomingSkus.map((value) => value.toLowerCase())],
    );
    if (taken.rowCount > 0) {
      const row = taken.rows[0];
      const err = new Error(`Variant SKU "${row.sku}" already belongs to "${row.name}"${row.status === 'archived' ? ' (archived)' : ''}. Use a different SKU.`);
      err.status = 409;
      throw err;
    }
  }

  // product_variants has a UNIQUE(tenant_id, barcode) partial index — check
  // for collisions up front so a duplicate manually-typed barcode surfaces as
  // a clear 400 instead of a raw Postgres constraint error.
  const seenBarcodes = new Map();
  for (const { barcode } of resolved) seenBarcodes.set(barcode, (seenBarcodes.get(barcode) || 0) + 1);
  const dupeInBatch = [...seenBarcodes.entries()].find(([, count]) => count > 1)?.[0];
  if (dupeInBatch) {
    const err = new Error(`Barcode "${dupeInBatch}" is used by more than one variant on this product. Barcodes must be unique.`);
    err.status = 400;
    throw err;
  }
  if (resolved.length > 0) {
    const clash = await client.query(
      `SELECT barcode FROM product_variants
       WHERE tenant_id = $1 AND product_id <> $2 AND barcode = ANY($3::text[])
       LIMIT 1`,
      [tenantId, productId, resolved.map((r) => r.barcode)],
    );
    if (clash.rowCount > 0) {
      const err = new Error(`Barcode "${clash.rows[0].barcode}" is already used by another product. Barcodes must be unique.`);
      err.status = 400;
      throw err;
    }
  }

  // Stock held by this product's variants before the save. Every change made
  // below is posted to inventory_movements as a signed delta against these
  // values (docs/25 Phase 1b).
  const previousStockById = new Map();
  const productDefaultsResult = await client.query(
    `SELECT default_cost_price_cents, default_shipping_cost_cents
       FROM products WHERE tenant_id = $1 AND id = $2`,
    [tenantId, productId],
  );
  const productDefaults = productDefaultsResult.rows[0] || {};
  if (expectedStock && typeof expectedStock === 'object') {
    // The editor sends the stock it loaded. If a sale, stocktake or bulk update
    // changed a variant since then and this save would overwrite or remove it,
    // refuse rather than silently undo that change (owner decision 2026-09-15).
    const incomingStock = new Map();
    for (const item of resolved) {
      const stock = Math.max(0, Number.parseInt(item.variant.stock, 10) || 0);
      incomingStock.set(item.sku, stock);
      if (item.existing) incomingStock.set(item.existing.id, stock);
    }
    const changed = existingVariants.rows.filter((row) => {
      const expectedKey = Object.prototype.hasOwnProperty.call(expectedStock, row.id)
        ? row.id
        : Object.prototype.hasOwnProperty.call(expectedStock, row.sku) ? row.sku : null;
      if (!expectedKey) return false;
      const current = Number(row.stock_quantity) || 0;
      if (Number(expectedStock[expectedKey]) === current) return false;
      return !incomingStock.has(row.id) || incomingStock.get(row.id) !== current;
    });
    if (changed.length > 0) {
      const err = new Error(`Stock changed while this product was open: ${changed.map((row) => `${row.sku} is now ${row.stock_quantity}`).join(', ')}. The editor reloaded the latest stock; review it and save again.`);
      err.status = 409;
      err.code = 'STOCK_CHANGED';
      throw err;
    }
  }
  for (const row of existingVariants.rows) {
    previousStockById.set(row.id, Number(row.stock_quantity) || 0);
  }
  const retainedIds = new Set(resolved.map((item) => item.existing?.id).filter(Boolean));
  const removedVariants = existingVariants.rows.filter((row) => !retainedIds.has(row.id));

  // Recorded BEFORE the delete, while the rows still exist — inventory_movements
  // has ON DELETE SET NULL on variant_id, so a movement written afterwards
  // would lose the link to what it described.
  // recordMovement back-computes the ledger baseline as (current - delta), so a
  // removed row must already hold zero when its removal is recorded.
  const removedWithStock = removedVariants
    .filter((row) => (Number(row.stock_quantity) || 0) !== 0)
    .map((row) => row.id);
  if (removedWithStock.length > 0) {
    await client.query(
      'UPDATE product_variants SET stock_quantity = 0, updated_at = NOW() WHERE id = ANY($1::uuid[])',
      [removedWithStock],
    );
  }
  for (const removed of removedVariants) {
    const stock = Number(removed.stock_quantity) || 0;
    if (stock === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    await recordMovement(client, { tenantId, userId: actorUserId }, {
      productId,
      variantId: removed.id,
      delta: -stock,
      reason: 'catalog_edit',
      referenceType: 'product',
      referenceId: productId,
      metadata: { sku: removed.sku, action: 'variant_removed', previousStock: stock },
    });
    // eslint-disable-next-line no-await-in-loop
    await publishStockEvent(client, tenantId, removed.id, 0);
  }

  // Stocktake counts keep a hard reference to the variant they counted
  // (ON DELETE RESTRICT), so a counted size cannot be deleted without losing
  // that history and the whole save used to fail. Hide it instead: it drops out
  // of the editor, storefront and POS, and re-adding its SKU revives it through
  // the upsert below (owner decision 2026-09-14).
  const removedIds = removedVariants.map((row) => row.id);
  let countedIds = [];
  if (removedIds.length > 0) {
    const counted = await client.query(
      `SELECT variant_id FROM stocktake_lines WHERE variant_id = ANY($1::uuid[])
       UNION
       SELECT variant_id FROM stocktake_location_counts WHERE variant_id = ANY($1::uuid[])`,
      [removedIds],
    );
    countedIds = counted.rows.map((row) => row.variant_id);
  }
  const deletableIds = removedIds.filter((id) => !countedIds.includes(id));

  if (countedIds.length > 0) {
    await client.query(
      'UPDATE product_variants SET is_active = false, stock_quantity = 0, updated_at = NOW() WHERE id = ANY($1::uuid[])',
      [countedIds],
    );
  }
  if (deletableIds.length > 0) {
    // Null-out cart references first (cart_items.variant_id is ON DELETE RESTRICT)
    await client.query('UPDATE cart_items SET variant_id = NULL WHERE variant_id = ANY($1::uuid[])', [deletableIds]);
    await client.query('DELETE FROM product_variants WHERE id = ANY($1::uuid[])', [deletableIds]);
  }

  // Free all changing identifiers before assigning their final values. This
  // makes an intentional A<->B SKU swap safe under the unique indexes.
  for (const item of resolved.filter((entry) => entry.existing && entry.existing.sku !== entry.sku)) {
    const temporarySku = `__REKEY__${item.existing.id}`;
    const temporaryBarcode = item.existing.barcode_source === 'auto'
      || item.existing.barcode === item.existing.sku
      ? `__REKEY_BARCODE__${item.existing.id}`
      : item.existing.barcode;
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      'UPDATE product_variants SET sku = $1, barcode = $2, updated_at = NOW() WHERE id = $3',
      [temporarySku, temporaryBarcode, item.existing.id],
    );
  }

  for (const [index, { variant, sku, barcode, barcodeSource, existing }] of resolved.entries()) {
    const costCents = variant.costPrice != null && variant.costPrice !== ''
      ? Math.max(0, Math.round(Number(variant.costPrice) * 100))
      : productDefaults.default_cost_price_cents ?? null;

    const shippingCents = variant.shippingCost != null && variant.shippingCost !== ''
      ? Math.max(0, Math.round(Number(variant.shippingCost) * 100))
      : productDefaults.default_shipping_cost_cents ?? null;

    const colorText = String(variant.color || '').trim() || null;
    const incomingStock = Math.max(0, Number.parseInt(variant.stock, 10) || 0);

    const values = [
      tenantId,
      productId,
      sku,
      barcode,
      String(variant.size || '').trim() || null,
      colorText,
      String(variant.material || '').trim() || null,
      toCents(variant.price),
      costCents,
      shippingCents,
      incomingStock,
      index,
      String(variant.noteEn || '').trim() || null,
      String(variant.noteAr || '').trim() || null,
      barcodeSource,
    ];
    const upserted = existing
      ? await client.query(
        `UPDATE product_variants
            SET sku = $3, barcode = $4, size = $5, color = $6, material = $7,
                price_cents = $8, cost_price_cents = $9, shipping_cost_cents = $10,
                stock_quantity = CASE
                  WHEN ${trustZeroStock} THEN $11
                  WHEN $11 > 0 THEN $11
                  ELSE product_variants.stock_quantity
                END,
                sort_order = $12, is_active = true, note_en = $13, note_ar = $14,
                barcode_source = $15,
                color_ref_id = (SELECT id FROM ref_colors
                  WHERE tenant_id = $1 AND lower(trim(name_en)) = lower(trim($6)) LIMIT 1),
                updated_at = NOW()
          WHERE tenant_id = $1 AND product_id = $2 AND id = $16
          RETURNING id, stock_quantity`,
        [...values, existing.id],
      )
      : await client.query(
        `INSERT INTO product_variants (
           tenant_id, product_id, sku, barcode, size, color, material,
           price_cents, cost_price_cents, shipping_cost_cents, stock_quantity,
           sort_order, is_active, note_en, note_ar, barcode_source, color_ref_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,
           (SELECT id FROM ref_colors
             WHERE tenant_id = $1 AND lower(trim(name_en)) = lower(trim($6)) LIMIT 1))
         RETURNING id, stock_quantity`,
        values,
      );

    if (existing && existing.sku !== sku) {
      // Old labels/import files can still resolve this row without making the
      // old identifier active or reusable as another product's SKU.
      await client.query(
        `INSERT INTO catalog_identifier_aliases
           (tenant_id, variant_id, identifier_type, value, reason, created_by_user_id)
         VALUES ($1,$2,'variant_sku',$3,'catalog_rekey',$4)
         ON CONFLICT (tenant_id, identifier_type, normalized_value) DO NOTHING`,
        [tenantId, existing.id, existing.sku, actorUserId],
      );
      if (existing.barcode && existing.barcode !== barcode) {
        await client.query(
          `INSERT INTO catalog_identifier_aliases
             (tenant_id, variant_id, identifier_type, value, reason, created_by_user_id)
           VALUES ($1,$2,'barcode',$3,'catalog_rekey',$4)
           ON CONFLICT (tenant_id, identifier_type, normalized_value) DO NOTHING`,
          [tenantId, existing.id, existing.barcode, actorUserId],
        );
      }
    }

    // The upsert's CASE means the stored stock is not always what was sent, so
    // the delta is computed from what the database actually ended up with.
    const saved = upserted.rows[0];
    if (saved) {
      const previous = existing ? previousStockById.get(existing.id) ?? 0 : 0;
      const delta = (Number(saved.stock_quantity) || 0) - previous;
      if (delta !== 0) {
        await recordMovement(client, { tenantId, userId: actorUserId }, {
          productId,
          variantId: saved.id,
          delta,
          reason: 'catalog_edit',
          referenceType: 'product',
          referenceId: productId,
          metadata: {
            sku,
            action: existing ? 'variant_updated' : 'variant_created',
            previousStock: previous,
            newStock: Number(saved.stock_quantity) || 0,
          },
        });
        await publishStockEvent(client, tenantId, saved.id, Number(saved.stock_quantity) || 0);
      }
    }
  }
}

/**
 * Resolve a product image URL to the media asset it belongs to, creating one
 * only when the URL is genuinely new.
 *
 * The subtlety is that the URL arrives from the admin client, and the media API
 * hands the client two URLs per asset: `storageUrl` (the original) and
 * `preview` (the 640px `-card` derivative). When a save sends the preview, an
 * exact-match lookup misses, and this function used to insert a second asset
 * pointing at a downscaled copy. Production accumulated five of those. They are
 * invisible in the admin, where the thumbnail looks the same, and soft on the
 * storefront, where a 640px file is asked to fill a 1400px slot. See
 * `docs/07-dev-guide.md`, "Pick the Right Image URL".
 *
 * So a variant URL is resolved back to its original rather than trusted: first
 * against the variant map the asset itself records, then against the filename
 * stem, since the derivative is always `.webp` while the original may be a
 * `.png` or a `.jpg` and the two never match on the full URL.
 */
async function findOrCreateImageAsset(client, tenantId, url, index) {
  // The Angular client normalises /uploads/ paths to /api/uploads/ for proxy
  // routing, so strip that prefix before DB lookup to avoid duplicate assets.
  const rawUrl = url.startsWith('/api/') ? url.slice(4) : url;
  const existing = await client.query(
    `
      SELECT id
      FROM media_assets
      WHERE tenant_id = $1
        AND kind = 'image'
        AND (storage_url = $2 OR preview_url = $2
             OR storage_url = $3 OR preview_url = $3)
      ORDER BY created_at
      LIMIT 1
    `,
    [tenantId, url, rawUrl],
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const stem = urlStem(rawUrl);
  if (VARIANT_SUFFIX.test(stem)) {
    // The asset that declares this file as one of its own variants.
    const byVariantMap = await client.query(
      `
        SELECT id
        FROM media_assets
        WHERE tenant_id = $1
          AND kind = 'image'
          AND EXISTS (
            SELECT 1
            FROM jsonb_each(COALESCE(metadata->'imageVariants', '{}'::jsonb)) AS variant
            WHERE variant.value->>'url' IN ($2, $3)
          )
        ORDER BY created_at
        LIMIT 1
      `,
      [tenantId, url, rawUrl],
    );
    if (byVariantMap.rowCount > 0) return byVariantMap.rows[0].id;

    // Older assets have no variant map recorded. Fall back to the shared stem,
    // matching on the filename so the differing extension does not matter.
    const originalStem = stem.replace(VARIANT_SUFFIX, '');
    const likeStem = `%/${originalStem.replace(/([%_\\])/g, '\\$1')}.%`;
    const byStem = await client.query(
      `
        SELECT id
        FROM media_assets
        WHERE tenant_id = $1
          AND kind = 'image'
          AND (storage_url LIKE $2 ESCAPE '\\' OR preview_url LIKE $2 ESCAPE '\\')
        ORDER BY created_at
        LIMIT 1
      `,
      [tenantId, likeStem],
    );
    if (byStem.rowCount > 0) return byStem.rows[0].id;

    // No original to point at. Inserting the derivative is still better than
    // dropping the image out of the gallery, but it is a defect somewhere
    // upstream, so it is logged and marked rather than stored silently.
    console.warn(
      `[admin-products] no original found for variant URL ${rawUrl}; storing the derivative. `
      + 'Something is saving a preview URL instead of storageUrl.',
    );
  }

  const filename = String(url).split('/').pop()?.split('?')[0] || `product-image-${index + 1}`;
  const inserted = await client.query(
    `
      INSERT INTO media_assets (tenant_id, filename, kind, mime_type, storage_url, preview_url, metadata)
      VALUES ($1, $2, 'image', $3, $4, $4, $5::jsonb)
      RETURNING id
    `,
    [
      tenantId,
      filename,
      filename.startsWith('data:') ? 'image/preview' : null,
      url,
      JSON.stringify({
        source: 'admin-product-save',
        ...(VARIANT_SUFFIX.test(stem) ? { unresolvedVariantUrl: true } : {}),
      }),
    ],
  );
  return inserted.rows[0].id;
}

function normalizeImageColors(imageColors) {
  if (!imageColors || typeof imageColors !== 'object' || Array.isArray(imageColors)) return {};
  return Object.entries(imageColors).reduce((map, [url, color]) => {
    const key = String(url || '').trim();
    const value = String(color || '').trim();
    if (key && value) map[key] = value;
    return map;
  }, {});
}

async function replaceImages(client, tenantId, productId, images, imageColors = {}) {
  const urls = [...new Set((Array.isArray(images) ? images : []).map((url) => String(url || '').trim()).filter(Boolean))];
  const colorsByUrl = normalizeImageColors(imageColors);

  await client.query("DELETE FROM media_links WHERE tenant_id = $1 AND product_id = $2 AND role IN ('gallery', 'primary')", [tenantId, productId]);

  const mediaIds = [];
  for (const [index, url] of urls.entries()) {
    const mediaId = await findOrCreateImageAsset(client, tenantId, url, index);
    const color = colorsByUrl[url] || '';
    if (color) {
      await client.query(
        'UPDATE media_assets SET metadata = metadata || $3::jsonb WHERE tenant_id = $1 AND id = $2',
        [tenantId, mediaId, JSON.stringify({ color })],
      );
    } else {
      await client.query(
        "UPDATE media_assets SET metadata = metadata - 'color' WHERE tenant_id = $1 AND id = $2",
        [tenantId, mediaId],
      );
    }
    mediaIds.push(mediaId);
    await client.query(
      `
        INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
        VALUES ($1, $2, $3, 'gallery', $4)
      `,
      [tenantId, mediaId, productId, index],
    );
  }

  await client.query(
    'UPDATE products SET primary_media_id = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3',
    [mediaIds[0] || null, tenantId, productId],
  );

  // Dual-write: also populate product_color_images pivot (migration 010).
  // Falls back gracefully if the table doesn't exist yet on older environments.
  await replaceColorImages(client, tenantId, productId, urls, colorsByUrl);
}

async function replaceColorImages(client, tenantId, productId, urls, colorsByUrl) {
  try {
    await client.query(
      'DELETE FROM product_color_images WHERE tenant_id = $1 AND product_id = $2',
      [tenantId, productId],
    );

    for (const [url, color] of Object.entries(colorsByUrl)) {
      const colorKey = String(color).trim().toLowerCase();
      if (!colorKey) continue;

      // Strip /api/ prefix that the Angular client adds for proxy routing
      const rawUrl = url.startsWith('/api/') ? url.slice(4) : url;
      const { rows } = await client.query(
        `SELECT id FROM media_assets
         WHERE tenant_id = $1 AND (storage_url = $2 OR preview_url = $2
                                OR storage_url = $3 OR preview_url = $3)
         LIMIT 1`,
        [tenantId, url, rawUrl],
      );
      if (!rows[0]) continue;

      const sortOrder = urls.indexOf(url);
      await client.query(
        `INSERT INTO product_color_images (tenant_id, product_id, color, media_id, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, color, sort_order)
         DO UPDATE SET media_id = EXCLUDED.media_id`,
        [tenantId, productId, colorKey, rows[0].id, sortOrder >= 0 ? sortOrder : 999],
      );
    }
  } catch (err) {
    // Non-fatal: pivot table may not exist on environments that haven't run migration 010 yet.
    if (err.code !== '42P01') throw err; // 42P01 = undefined_table
  }
}

async function replaceRecommendations(client, tenantId, productId, relatedProductIds) {
  await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
  await ensureVariantNoteColumns(client);
  const ids = [...new Set((Array.isArray(relatedProductIds) ? relatedProductIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && id !== productId))];

  await client.query('DELETE FROM product_recommendations WHERE tenant_id = $1 AND product_id = $2', [tenantId, productId]);
  if (ids.length === 0) return [];

  const valid = await client.query(
    `
      SELECT id
      FROM products
      WHERE tenant_id = $1
        AND status <> 'archived'
        AND id = ANY($2::uuid[])
      ORDER BY array_position($2::uuid[], id)
    `,
    [tenantId, ids],
  );
  const validIds = valid.rows.map((row) => row.id);

  for (const [index, recommendedProductId] of validIds.entries()) {
    await client.query(
      `
        INSERT INTO product_recommendations (tenant_id, product_id, recommended_product_id, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (product_id, recommended_product_id) DO UPDATE
        SET sort_order = EXCLUDED.sort_order
      `,
      [tenantId, productId, recommendedProductId, index],
    );
  }

  return validIds;
}

function mapAdminProduct(row) {
  const desc = row.description || {};
  const care = row.care_instructions || {};
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar || '',
    sku: row.sku,
    brand: row.brand,
    price: Math.round(Number(row.base_price_cents || 0) / 100),
    // What a customer can actually pay. The storefront and the till both sell at the
    // variant's price, so a list column showing only the product's own price reads as a
    // selling price the shop may not have.
    ...(() => {
      const prices = (row.variants || []).map((v) => Number(v.price) || 0).filter((n) => n > 0);
      const base = Math.round(Number(row.base_price_cents || 0) / 100);
      return prices.length
        ? { priceMin: Math.min(...prices), priceMax: Math.max(...prices) }
        : { priceMin: base, priceMax: base };
    })(),
    defaultCostPrice: row.default_cost_price_cents == null
      ? null
      : Number(row.default_cost_price_cents) / 100,
    defaultShippingCost: row.default_shipping_cost_cents == null
      ? null
      : Number(row.default_shipping_cost_cents) / 100,
    duplicatedFromProductId: row.duplicated_from_product_id || null,
    catalogRevision: Number(row.catalog_revision || 1),
    stock: Number(row.stock_quantity || 0),
    hidden: row.status === 'hidden',
    posHidden: row.pos_status === 'hidden',
    image: row.image || '',
    images: row.images || [],
    imageColors: normalizeImageColors(row.image_colors),
    variants: row.variants || [],
    enDesc: desc.en || '',
    arDesc: desc.ar || '',
    // Hook: the tagline used on the home hero and other compact surfaces.
    shortEn: desc.shortEn || '',
    shortAr: desc.shortAr || '',
    // Short description shown directly under the product name on the PDP.
    teaserEn: desc.teaserEn || '',
    teaserAr: desc.teaserAr || '',
    // Product-wide note, shown on the PDP above any size-specific note.
    noteEn: desc.noteEn || '',
    noteAr: desc.noteAr || '',
    // Material & Care copy, its own PDP section.
    careEn: care.en || '',
    careAr: care.ar || '',
    metaTitle: row.meta_title || '',
    metaDesc: row.meta_desc || '',
    slug: row.slug || '',
    relatedProductIds: row.related_product_ids || [],
  };
}

async function loadAdminProduct(client, tenantId, productId) {
  await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
  await ensureVariantNoteColumns(client);
  const result = await client.query(
    `
      SELECT
        p.*,
        COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pv.id,
            'sku', pv.sku,
            'barcode', pv.barcode,
            'barcodeSource', pv.barcode_source,
            'size', pv.size,
            'color', pv.color,
            'material', pv.material,
            'noteEn', pv.note_en,
            'noteAr', pv.note_ar,
            'price', round(pv.price_cents / 100.0),
            'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0, 2) ELSE NULL END,
            'shippingCost', CASE WHEN pv.shipping_cost_cents IS NOT NULL THEN round(pv.shipping_cost_cents / 100.0, 2) ELSE NULL END,
            'totalCost', CASE WHEN pv.total_cost_cents IS NOT NULL THEN round(pv.total_cost_cents / 100.0, 2) ELSE NULL END,
            'stock', pv.stock_quantity
          ) ORDER BY pv.sort_order, pv.created_at)
          FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active
        ), '[]'::jsonb) AS variants,
        COALESCE((
          SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
          FROM media_links ml
          JOIN media_assets m ON m.id = ml.media_id
          WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
        ), ARRAY[]::text[]) AS images,
        ${IMAGE_COLORS_SELECT},
        COALESCE((
          SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
          FROM product_recommendations pr
          JOIN products rp ON rp.id = pr.recommended_product_id
          WHERE pr.tenant_id = p.tenant_id
            AND pr.product_id = p.id
            AND rp.status <> 'archived'
        ), ARRAY[]::uuid[]) AS related_product_ids,
        pt_ar.name AS name_ar
      FROM products p
      LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
      LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
      WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
      GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
    `,
    [tenantId, productId],
  );
  return result.rowCount === 0 ? null : mapAdminProduct(result.rows[0]);
}

async function upsertProduct(client, tenant, product, { actorUserId = null } = {}) {
  const name = String(product.name).trim();
  const sku = String(product.sku).trim();
  const brand = String(product.brand).trim();
  const currency = product.currency || tenant.currency;
  const status = product.hidden ? 'hidden' : 'active';
  const posStatus = product.posHidden ? 'hidden' : 'active';
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const imageColors = normalizeImageColors(product.imageColors);
  const hasRelatedProductIds = Object.prototype.hasOwnProperty.call(product, 'relatedProductIds');
  const description = {
    en: String(product.enDesc || '').trim(),
    ar: String(product.arDesc || '').trim(),
    shortEn: String(product.shortEn || '').trim(),
    shortAr: String(product.shortAr || '').trim(),
    teaserEn: String(product.teaserEn || '').trim(),
    teaserAr: String(product.teaserAr || '').trim(),
    // Product note: one short line that holds for the whole product, shown on
    // the storefront without waiting for a size to be picked. Sits above the
    // per-variant note rather than replacing it.
    noteEn: String(product.noteEn || '').trim(),
    noteAr: String(product.noteAr || '').trim(),
  };
  const careInstructions = {
    en: String(product.careEn || '').trim(),
    ar: String(product.careAr || '').trim(),
  };

  const metaTitle = String(product.metaTitle || '').trim() || null;
  const metaDesc = String(product.metaDesc || '').trim() || null;
  const nullableCents = (value) => value == null || value === ''
    ? null
    : Math.max(0, Math.round(Number(value) * 100));
  const defaultCostPriceCents = nullableCents(product.defaultCostPrice);
  const defaultShippingCostCents = nullableCents(product.defaultShippingCost);
  const duplicatedFromProductId = UUID_RE.test(String(product.duplicatedFromProductId || ''))
    ? String(product.duplicatedFromProductId)
    : null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const stockQty = variants.length > 0
    ? variants.reduce((sum, v) => sum + (Math.max(0, Number.parseInt(v.stock, 10) || 0)), 0)
    : Math.max(0, Number.parseInt(product.stock, 10) || 0);

  const reservedSku = await client.query(
    `SELECT p.name
       FROM catalog_identifier_aliases cia
       JOIN products p ON p.id = cia.product_id
      WHERE cia.tenant_id = $1 AND cia.identifier_type = 'product_sku'
        AND cia.normalized_value = lower(btrim($2))
        AND cia.product_id IS DISTINCT FROM $3::uuid
      LIMIT 1`,
    [tenant.id, sku, product.id || null],
  );
  if (reservedSku.rowCount > 0) {
    const err = new Error(`Product SKU "${sku}" was previously used by "${reservedSku.rows[0].name}". Use a different SKU.`);
    err.status = 409;
    throw err;
  }

  // Slugs are unique per tenant, archived products included. Suffix instead of
  // failing the whole save with a constraint error.
  const baseSlug = slugify(product.slug || name);
  const slugRows = await client.query(
    `SELECT slug FROM products
      WHERE tenant_id = $1 AND id IS DISTINCT FROM $2::uuid AND (slug = $3 OR slug LIKE $4)`,
    [tenant.id, product.id || null, baseSlug, `${baseSlug}-%`],
  );
  const usedSlugs = new Set(slugRows.rows.map((row) => row.slug));
  let slug = baseSlug;
  for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${baseSlug}-${n}`;

  const params = [
    tenant.id,
    sku,
    brand,
    name,
    slug,
    status,
    JSON.stringify(description),
    JSON.stringify(careInstructions),
    toCents(product.price),
    currency,
    stockQty,
    metaTitle,   // $12
    metaDesc,    // $13
    posStatus,   // $14
    defaultCostPriceCents,     // $15
    defaultShippingCostCents,  // $16
    duplicatedFromProductId,   // $17
  ];

  let previousSku = null;
  if (product.id) {
    const previous = await client.query(
      'SELECT sku FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenant.id, product.id],
    );
    previousSku = previous.rows[0]?.sku || null;
  }

  const upserted = product.id
    ? await client.query(
      `
        UPDATE products
        SET sku = $2,
            brand = $3,
            name = $4,
            slug = $5,
            status = $6,
            description = $7::jsonb,
            care_instructions = $8::jsonb,
            base_price_cents = $9,
            currency = $10,
            stock_quantity = $11,
            meta_title = $12,
            meta_desc = $13,
            pos_status = $14,
            default_cost_price_cents = $15,
            default_shipping_cost_cents = $16,
            duplicated_from_product_id = COALESCE(duplicated_from_product_id, $17),
            catalog_revision = catalog_revision + 1,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $18
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      [...params, product.id],
    )
    : await client.query(
      `
        INSERT INTO products (
          tenant_id, sku, brand, name, slug, status, description, care_instructions,
          base_price_cents, currency, stock_quantity,
          meta_title, meta_desc, pos_status,
          default_cost_price_cents, default_shipping_cost_cents, duplicated_from_product_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id, sku, name, slug, status, base_price_cents, stock_quantity, meta_title, meta_desc
      `,
      params,
    );

  const saved = upserted.rows[0];
  if (previousSku && previousSku !== sku) {
    await client.query(
      `INSERT INTO catalog_identifier_aliases
         (tenant_id, product_id, identifier_type, value, reason, created_by_user_id)
       VALUES ($1,$2,'product_sku',$3,'catalog_rekey',$4)
       ON CONFLICT (tenant_id, identifier_type, normalized_value) DO NOTHING`,
      [tenant.id, saved.id, previousSku, actorUserId],
    );
  }
  // A PATCH that does not send variants (hide toggle, name edit) must not
  // rewrite them: that would reset stock sold in the meantime.
  if (!product.skipVariants) {
    await replaceVariants(client, tenant.id, saved.id, variants, { actorUserId, expectedStock: product.expectedStock || null });
  }
  // Re-sum variant stock onto the product row so the catalog total is always
  // accurate even when the stock-preservation branch kept a different value.
  //
  // The price is derived the same way, for the same reason. The shop sells at the variant's
  // price; `base_price_cents` is a fallback for variants that carry none, the default a new
  // size is created with, and the key the admin list sorts and filters by. Left to be typed
  // by hand it drifted — three live products advertised a price no size actually had, and a
  // size added afterwards would have inherited the stale number.
  if (variants.length > 0) {
    await client.query(
      `UPDATE products
          SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants WHERE product_id = $1),
              base_price_cents = COALESCE((
                SELECT min(price_cents) FROM product_variants
                 WHERE product_id = $1 AND is_active AND price_cents > 0
              ), base_price_cents),
              updated_at = now()
        WHERE id = $1`,
      [saved.id],
    );
  }
  await replaceImages(client, tenant.id, saved.id, images, imageColors);
  if (hasRelatedProductIds) {
    await replaceRecommendations(client, tenant.id, saved.id, product.relatedProductIds);
  }

  // Upsert Arabic name into product_translations
  const nameAr = String(product.nameAr || '').trim();
  if (nameAr) {
    await client.query(
      `
        INSERT INTO product_translations (product_id, locale, name)
        VALUES ($1, 'ar', $2)
        ON CONFLICT (product_id, locale) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      `,
      [saved.id, nameAr],
    );
  }

  await publishCatalogEvent(client, tenant.id, saved.id, product.id ? 'updated' : 'created');

  return { ...saved, tenantId: tenant.id, imageCount: images.length };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
  await ensureVariantNoteColumns(client);
    const result = await client.query(
      `
        SELECT
          p.*,
          COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'barcode', pv.barcode,
              'barcodeSource', pv.barcode_source,
              'size', pv.size,
              'color', pv.color,
              'material', pv.material,
              'noteEn', pv.note_en,
              'noteAr', pv.note_ar,
              'price', round(pv.price_cents / 100.0),
              'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0, 2) ELSE NULL END,
              'shippingCost', CASE WHEN pv.shipping_cost_cents IS NOT NULL THEN round(pv.shipping_cost_cents / 100.0, 2) ELSE NULL END,
              'totalCost', CASE WHEN pv.total_cost_cents IS NOT NULL THEN round(pv.total_cost_cents / 100.0, 2) ELSE NULL END,
              'stock', pv.stock_quantity
            ) ORDER BY pv.sort_order, pv.created_at)
            FROM product_variants pv
            WHERE pv.product_id = p.id AND pv.is_active
          ), '[]'::jsonb) AS variants,
          COALESCE((
            SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
            FROM media_links ml
            JOIN media_assets m ON m.id = ml.media_id
            WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
          ), ARRAY[]::text[]) AS images,
          ${IMAGE_COLORS_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status <> 'archived'
          ), ARRAY[]::uuid[]) AS related_product_ids,
          pt_ar.name AS name_ar
        FROM products p
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
        WHERE p.tenant_id = $1 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
        ORDER BY p.created_at DESC
      `,
      [tenant.id],
    );

    ok(res, result.rows.map(mapAdminProduct));
  } finally {
    client.release();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensureProductRecommendationsSchema(client);
  await ensureSeoColumns(client);
  await ensureCostPriceColumn(client);
  await ensureVariantNoteColumns(client);
    const result = await client.query(
      `
        SELECT
          p.*,
          COALESCE(primary_media.preview_url, primary_media.storage_url, '') AS image,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'barcode', pv.barcode,
              'barcodeSource', pv.barcode_source,
              'size', pv.size,
              'color', pv.color,
              'material', pv.material,
              'noteEn', pv.note_en,
              'noteAr', pv.note_ar,
              'price', round(pv.price_cents / 100.0),
              'costPrice', CASE WHEN pv.cost_price_cents IS NOT NULL THEN round(pv.cost_price_cents / 100.0, 2) ELSE NULL END,
              'shippingCost', CASE WHEN pv.shipping_cost_cents IS NOT NULL THEN round(pv.shipping_cost_cents / 100.0, 2) ELSE NULL END,
              'totalCost', CASE WHEN pv.total_cost_cents IS NOT NULL THEN round(pv.total_cost_cents / 100.0, 2) ELSE NULL END,
              'stock', pv.stock_quantity
            ) ORDER BY pv.sort_order, pv.created_at)
            FROM product_variants pv
            WHERE pv.product_id = p.id AND pv.is_active
          ), '[]'::jsonb) AS variants,
          COALESCE((
            SELECT array_agg(COALESCE(m.preview_url, m.storage_url) ORDER BY ml.sort_order)
            FROM media_links ml
            JOIN media_assets m ON m.id = ml.media_id
            WHERE ml.product_id = p.id AND ml.role IN ('gallery', 'primary')
          ), ARRAY[]::text[]) AS images,
          ${IMAGE_COLORS_SELECT},
          COALESCE((
            SELECT array_agg(pr.recommended_product_id ORDER BY pr.sort_order)
            FROM product_recommendations pr
            JOIN products rp ON rp.id = pr.recommended_product_id
            WHERE pr.tenant_id = p.tenant_id
              AND pr.product_id = p.id
              AND rp.status <> 'archived'
          ), ARRAY[]::uuid[]) AS related_product_ids,
          pt_ar.name AS name_ar
        FROM products p
        LEFT JOIN media_assets primary_media ON primary_media.id = p.primary_media_id
        LEFT JOIN product_translations pt_ar ON pt_ar.product_id = p.id AND pt_ar.locale = 'ar'
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.status <> 'archived'
        GROUP BY p.id, primary_media.preview_url, primary_media.storage_url, pt_ar.name
      `,
      [tenant.id, req.params.id],
    );

    if (result.rowCount === 0) return notFound(res, 'Product not found.');
    ok(res, mapAdminProduct(result.rows[0]));
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const errors = validateProduct(req.body);
  if (errors.length > 0) return validationError(res, errors);

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const saved = await upsertProduct(client, tenant, { ...req.body, id: undefined }, { actorUserId: req.user?.id || null });
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    kickRestockDispatch([saved.id]);
    created(res, product, 'Product saved.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

// PATCH /bulk-stock must be registered before PATCH /:id to avoid route collision
router.patch('/bulk-stock', asyncHandler(async (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return validationError(res, ['updates must be a non-empty array of { sku, stock } objects.']);
  }
  const seenSkus = new Set();
  const updateErrors = [];
  updates.forEach((item, index) => {
    const sku = String(item?.sku || '').trim();
    const stock = Number(item?.stock);
    if (!sku) updateErrors.push(`updates[${index}].sku is required.`);
    if (!Number.isSafeInteger(stock) || stock < 0) {
      updateErrors.push(`updates[${index}].stock must be a whole number greater than or equal to zero.`);
    }
    const key = sku.toLowerCase();
    if (sku && seenSkus.has(key)) updateErrors.push(`Duplicate SKU "${sku}".`);
    seenSkus.add(key);
  });
  if (updateErrors.length) return validationError(res, updateErrors);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');

    let updated = 0;
    const notFound = [];
    const changedProductIds = new Set();

    for (const item of updates) {
      const sku = String(item.sku || '').trim();
      const stock = Number(item.stock);

      // Update the variant row first (preferred — variant SKUs are unique).
      // `stock_quantity` before the write is returned so the ledger records a
      // signed delta rather than an absolute value: the ledger's whole purpose
      // is that current stock must reconcile against baseline + sum(delta).
      const varResult = await client.query(
        `UPDATE product_variants pv
            SET stock_quantity = $1, updated_at = now()
           FROM (SELECT id, stock_quantity AS previous FROM product_variants
          WHERE tenant_id = $2 AND is_active
            AND (lower(sku) = lower($3) OR id IN (
              SELECT variant_id FROM catalog_identifier_aliases
               WHERE tenant_id = $2 AND identifier_type = 'variant_sku'
                 AND normalized_value = lower(btrim($3))
            ))
                  ORDER BY (sku = $3) DESC LIMIT 1 FOR UPDATE) prev
          WHERE pv.id = prev.id
        RETURNING pv.product_id, pv.id AS variant_id, prev.previous`,
        [stock, tenant.id, sku],
      );

      if (varResult.rowCount > 0) {
        const row = varResult.rows[0];
        const delta = stock - Number(row.previous);
        if (delta !== 0) {
          // Without this the hourly drift job reports every legitimate manual
          // edit as drift, and an alert that fires on normal work is an alert
          // that gets ignored (docs/25 Phase 1b).
          await recordMovement(client, { tenantId: tenant.id, userId: req.user?.id || null }, {
            productId: row.product_id,
            variantId: row.variant_id,
            delta,
            reason: 'bulk_import',
            referenceType: 'bulk_stock_update',
            referenceId: null,
            metadata: { sku, previousStock: Number(row.previous), newStock: stock },
          });
          await publishStockEvent(client, tenant.id, row.variant_id, stock);
        }
        // Re-sum all variant stock onto the parent product so the catalog stock total stays accurate
        const productId = varResult.rows[0].product_id;
        changedProductIds.add(productId);
        await client.query(
          'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants WHERE product_id = $1), updated_at = now() WHERE id = $1',
          [productId],
        );
        updated += varResult.rowCount;
      } else {
        notFound.push(sku);
      }
    }

    await client.query('COMMIT');
    for (const productId of changedProductIds) {
      kickRestockDispatch([productId]);
    }
    ok(res, { updated, notFound }, `${updated} variant(s) updated.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const current = await client.query("SELECT * FROM products WHERE tenant_id = $1 AND id = $2 AND status <> 'archived'", [tenant.id, req.params.id]);
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Product not found.');
    }

    const existing = current.rows[0];
    const existingFull = await loadAdminProduct(client, tenant.id, req.params.id);
    let patchVariants = req.body.variants;
    if (!Array.isArray(patchVariants)) {
      const existingVariants = await client.query(
        `SELECT id, sku, barcode, barcode_source AS "barcodeSource", size, color, material, note_en AS "noteEn", note_ar AS "noteAr",
                round(price_cents / 100.0) AS price,
                CASE WHEN cost_price_cents IS NULL THEN NULL ELSE round(cost_price_cents / 100.0, 2) END AS "costPrice",
                CASE WHEN shipping_cost_cents IS NULL THEN NULL ELSE round(shipping_cost_cents / 100.0, 2) END AS "shippingCost",
                stock_quantity AS stock
           FROM product_variants
          WHERE tenant_id = $1 AND product_id = $2 AND is_active
          ORDER BY sort_order, created_at`,
        [tenant.id, req.params.id],
      );
      patchVariants = existingVariants.rows;
    }
    const patchStockRaw = req.body.stock ?? existing.stock_quantity;
    const patchStock = Array.isArray(patchVariants) && patchVariants.length > 0
      ? patchVariants.reduce((sum, v) => sum + (Math.max(0, Number.parseInt(v.stock, 10) || 0)), 0)
      : patchStockRaw;

    const payload = {
      name: req.body.name ?? existing.name,
      sku: req.body.sku ?? existing.sku,
      brand: req.body.brand ?? existing.brand,
      price: req.body.price ?? Math.round(Number(existing.base_price_cents) / 100),
      defaultCostPrice: req.body.defaultCostPrice
        ?? (existing.default_cost_price_cents == null ? null : Number(existing.default_cost_price_cents) / 100),
      defaultShippingCost: req.body.defaultShippingCost
        ?? (existing.default_shipping_cost_cents == null ? null : Number(existing.default_shipping_cost_cents) / 100),
      duplicatedFromProductId: existing.duplicated_from_product_id || null,
      stock: patchStock,
      hidden: req.body.hidden ?? existing.status === 'hidden',
      posHidden: req.body.posHidden ?? existing.pos_status === 'hidden',
      enDesc: req.body.enDesc ?? existing.description?.en,
      arDesc: req.body.arDesc ?? existing.description?.ar,
      shortEn: req.body.shortEn ?? existing.description?.shortEn,
      shortAr: req.body.shortAr ?? existing.description?.shortAr,
      teaserEn: req.body.teaserEn ?? existing.description?.teaserEn,
      teaserAr: req.body.teaserAr ?? existing.description?.teaserAr,
      noteEn: req.body.noteEn ?? existing.description?.noteEn,
      noteAr: req.body.noteAr ?? existing.description?.noteAr,
      careEn: req.body.careEn ?? existing.care_instructions?.en,
      careAr: req.body.careAr ?? existing.care_instructions?.ar,
      slug: req.body.slug ?? existing.slug,
      metaTitle: req.body.metaTitle ?? existing.meta_title,
      metaDesc: req.body.metaDesc ?? existing.meta_desc,
      id: req.params.id,
      nameAr: req.body.nameAr ?? existingFull?.nameAr ?? '',
      variants: patchVariants,
      skipVariants: !Array.isArray(req.body.variants),
      expectedStock: req.body.expectedStock || null,
      images: Object.prototype.hasOwnProperty.call(req.body, 'images') ? req.body.images : existingFull?.images,
      imageColors: Object.prototype.hasOwnProperty.call(req.body, 'imageColors') ? req.body.imageColors : existingFull?.imageColors,
      relatedProductIds: Object.prototype.hasOwnProperty.call(req.body, 'relatedProductIds')
        ? req.body.relatedProductIds
        : existingFull?.relatedProductIds,
    };

    const errors = validateProduct(payload);
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return validationError(res, errors);
    }

    const saved = await upsertProduct(client, tenant, payload, { actorUserId: req.user?.id || null });
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    kickRestockDispatch([saved.id]);
    ok(res, product, 'Product updated.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

// POST /api/admin/products/bulk-delete: archives products by ID array (same as DELETE /:id)
router.post('/bulk-delete', asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return validationError(res, ['ids must be a non-empty array of product IDs.']);
  }

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');

    // Archive instead of deleting (owner decision 2026-09-15): orders, POS
    // lines, stocktakes and the stock ledger keep real rows, and Undo can restore
    // it. Scoped to the tenant, and unsaved editor ids are ignored.
    const result = await client.query(
      `UPDATE products SET status = 'archived', updated_at = now()
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status <> 'archived'
        RETURNING id`,
      [tenant.id, ids.filter((id) => UUID_RE.test(String(id)))],
    );
    for (const row of result.rows) {
      await publishCatalogEvent(client, tenant.id, row.id, 'archived');
    }

    await client.query('COMMIT');
    ok(res, { deleted: result.rowCount }, `${result.rowCount} product(s) deleted.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');
    const result = await client.query(
      `
        UPDATE products
        SET status = 'archived'
        WHERE tenant_id = $1 AND id = $2
        RETURNING id
      `,
      [tenant.id, req.params.id],
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Product not found.');
    }
    await publishCatalogEvent(client, tenant.id, result.rows[0].id, 'archived');
    await client.query('COMMIT');
    ok(res, { id: result.rows[0].id }, 'Product archived.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

// POST /api/admin/products/:id/restore: undo an archive. The caller says
// whether it was hidden; without that it comes back hidden so it cannot
// reappear on the storefront unchecked.
router.post('/:id/restore', asyncHandler(async (req, res) => {
  if (!UUID_RE.test(String(req.params.id))) return notFound(res, 'Archived product not found.');
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE products SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'archived'
        RETURNING id`,
      [tenant.id, req.params.id, req.body?.hidden === false ? 'active' : 'hidden'],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Archived product not found.');
    }
    await publishCatalogEvent(client, tenant.id, result.rows[0].id, 'updated');
    const product = await loadAdminProduct(client, tenant.id, result.rows[0].id);
    await client.query('COMMIT');
    ok(res, product, 'Product restored.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

/**
 * POST /api/admin/products/:id/images
 *
 * Multipart upload of one or more images for a product. Each file is stored
 * via the storage adapter, then `media_assets` + `media_links` rows are
 * written so the gallery shows up in /api/admin/products list responses.
 *
 * On the first image upload (or when ?primary=true), the product's
 * `primary_media_id` is updated so list views and storefront use the new
 * image as the thumbnail.
 *
 * Returns the resulting `images: string[]` array (URLs in display order)
 * so the frontend can patch its local form state with one assignment.
 */
router.post(
  '/:id/images',
  upload.array('files', 12),
  asyncHandler(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) return validationError(res, ['No files received.']);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await ensureDefaultTenant(client);
      const userId = req.session?.user?.id || null;
      const productId = req.params.id;

      const exists = await client.query('SELECT id FROM products WHERE tenant_id = $1 AND id = $2', [tenant.id, productId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return notFound(res, 'Product not found.');
      }

      const startOrderRes = await client.query(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM media_links WHERE product_id = $1 AND role = 'gallery'",
        [productId],
      );
      let sortOrder = Number(startOrderRes.rows[0].next || 0);

      const newMediaIds = [];
      for (const file of files) {
        const stored = await storage.save({
          buffer: file.buffer,
          filename: file.originalname,
          mimeType: file.mimetype,
        });
        const inserted = await client.query(
          `
            INSERT INTO media_assets (
              tenant_id, filename, kind, mime_type, size_bytes, width, height,
              storage_url, preview_url, uploaded_by_user_id, metadata
            )
            VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            RETURNING id
          `,
          [
            tenant.id, file.originalname, stored.mimeType, file.size,
            stored.width, stored.height,
            stored.url, stored.previewUrl, userId,
            JSON.stringify({
              storagePath: stored.storagePath,
              originalName: file.originalname,
              imageVariants: stored.variants || {},
            }),
          ],
        );
        const mediaId = inserted.rows[0].id;
        await client.query(
          `
            INSERT INTO media_links (tenant_id, media_id, product_id, role, sort_order)
            VALUES ($1, $2, $3, 'gallery', $4)
          `,
          [tenant.id, mediaId, productId, sortOrder],
        );
        newMediaIds.push(mediaId);
        sortOrder += 1;
      }

      // Promote the first uploaded file so the storefront API and admin list
      // show the catalog upload immediately instead of an older seed image.
      if (newMediaIds.length > 0) {
        await client.query('UPDATE products SET primary_media_id = $1 WHERE id = $2', [newMediaIds[0], productId]);
        await publishCatalogEvent(client, tenant.id, productId, 'images_changed');
      }

      // Compose the returned `images[]` so the client can patch in place.
      const allImages = await client.query(
        `
          SELECT COALESCE(m.preview_url, m.storage_url) AS url
          FROM media_links ml
          JOIN media_assets m ON m.id = ml.media_id
          WHERE ml.product_id = $1 AND ml.role IN ('gallery', 'primary')
          ORDER BY
            CASE
              WHEN COALESCE(m.preview_url, m.storage_url) LIKE '/uploads/%'
                OR m.metadata ? 'storagePath'
              THEN 0
              ELSE 1
            END,
            ml.sort_order
        `,
        [productId],
      );

      await client.query('COMMIT');
      created(res, {
        productId,
        uploaded: newMediaIds.length,
        images: allImages.rows.map((r) => r.url),
      }, `Uploaded ${newMediaIds.length} image${newMediaIds.length === 1 ? '' : 's'}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const source = await loadAdminProduct(client, tenant.id, req.params.id);
    if (!source) return notFound(res, 'Product not found.');

    // Build unique SKU: append -COPY, or -COPY-N if collision
    let newSku = source.sku + '-COPY';
    const existing = await client.query(
      "SELECT sku FROM products WHERE tenant_id = $1 AND sku LIKE $2 AND status <> 'archived'",
      [tenant.id, source.sku + '-COPY%'],
    );
    if (existing.rowCount > 0) {
      const nums = existing.rows.map(r => {
        const m = r.sku.match(/-COPY-?(\d+)$/);
        return m ? parseInt(m[1], 10) : 1;
      });
      newSku = source.sku + '-COPY-' + (Math.max(...nums) + 1);
    }

    await client.query('BEGIN');
    const saved = await upsertProduct(client, tenant, {
      ...source,
      id: undefined,
      sku: newSku,
      slug: newSku,
      duplicatedFromProductId: source.id,
      hidden: true,
      stock: 0,
      // A copy starts empty. Rebase every variant SKU onto the copy's product
      // namespace and clean the boundary, so legacy "3336-MC--5" separators
      // are not carried forward.
      variants: (source.variants || []).map((v, index) => {
        const oldSku = String(v.sku || '').trim();
        const legacySuffix = oldSku.startsWith(source.sku)
          ? oldSku.slice(source.sku.length).replace(/^-+/, '')
          : '';
        const suffix = legacySuffix
          || [String(v.color || '').trim(), String(v.size || '').trim()].filter(Boolean).join('-')
          || String(index + 1);
        return {
          ...v,
          id: undefined,
          barcode: '',
          barcodeSource: 'auto',
          stock: 0,
          sku: `${newSku}-${suffix}`,
        };
      }),
    });
    const product = await loadAdminProduct(client, tenant.id, saved.id);
    await client.query('COMMIT');
    created(res, product, 'Product duplicated.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw productConflict(err);
  } finally {
    client.release();
  }
}));

module.exports = router;
module.exports._test = { validateProduct, mapAdminProduct };
