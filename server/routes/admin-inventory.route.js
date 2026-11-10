const { Router } = require('express');
const { asyncHandler, created, ok } = require('./lib');
const db = require('../db/client');
const { requireAuth } = require('../middleware/require-auth');
const locationStock = require('../lib/location-stock');
const { listStock, receiveStock, transferStock, listTransfers, listMovements } = require('../lib/location-stock-service');
const { stockFileUpload, buildTemplate, previewStockFile, commitStockFile } = require('../lib/stock-file-import');
const {
  adjustStock,
  cancelStocktake,
  getStocktake,
  listStocktakes,
  listStocktakeLocations,
  completeStocktakeLocation,
  fillMissingStocktakeCountsWithZero,
  reopenStocktakeLocation,
  postStocktake,
  saveCount,
  startStocktake,
  ADJUSTMENT_REASONS,
} = require('../lib/inventory-ops-service');

const router = Router();

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    requestId: req.requestId || null,
  };
}

/** The closed reason list, so the UI never invents its own. */
router.get('/adjustment-reasons', (req, res) => {
  ok(res, [...ADJUSTMENT_REASONS]);
});

router.post('/adjustments', asyncHandler(async (req, res) => {
  created(res, await adjustStock(context(req), req.body), 'Stock adjusted.');
}));

router.get('/stocktakes', asyncHandler(async (req, res) => {
  ok(res, await listStocktakes(context(req), req.query));
}));

router.get('/stocktake-locations', asyncHandler(async (req, res) => {
  ok(res, await listStocktakeLocations(context(req)));
}));

router.post('/stocktakes', asyncHandler(async (req, res) => {
  created(res, await startStocktake(context(req), req.body), 'Stocktake started.');
}));

router.get('/stocktakes/:id', asyncHandler(async (req, res) => {
  ok(res, await getStocktake(context(req), req.params.id));
}));

router.post('/stocktakes/:id/counts', asyncHandler(async (req, res) => {
  ok(res, await saveCount(context(req), req.params.id, req.body));
}));

router.post('/stocktakes/:id/locations/:locationId/complete', asyncHandler(async (req, res) => {
  ok(res, await completeStocktakeLocation(context(req), req.params.id, req.params.locationId));
}));

router.post('/stocktakes/:id/locations/:locationId/fill-missing-zero', asyncHandler(async (req, res) => {
  ok(res, await fillMissingStocktakeCountsWithZero(context(req), req.params.id, req.params.locationId));
}));

router.post('/stocktakes/:id/locations/:locationId/reopen', asyncHandler(async (req, res) => {
  ok(res, await reopenStocktakeLocation(context(req), req.params.id, req.params.locationId));
}));

router.post('/stocktakes/:id/post', asyncHandler(async (req, res) => {
  ok(res, await postStocktake(context(req), req.params.id, req.body), 'Stocktake posted.');
}));

router.post('/stocktakes/:id/cancel', asyncHandler(async (req, res) => {
  ok(res, await cancelStocktake(context(req), req.params.id), 'Stocktake cancelled.');
}));

// ─── Stock per location (plan Phase 3) ──────────────────────────────────────
// Owner/admin/manager (the router's own gate); cashiers have no access.

router.get('/stock', asyncHandler(async (req, res) => {
  ok(res, await listStock(context(req), req.query));
}));

router.post('/receipts', asyncHandler(async (req, res) => {
  created(res, await receiveStock(context(req), req.body), 'Stock added.');
}));

router.get('/movements', asyncHandler(async (req, res) => {
  ok(res, await listMovements(context(req), req.query));
}));

router.get('/transfers', asyncHandler(async (req, res) => {
  ok(res, await listTransfers(context(req), req.query));
}));

router.post('/transfers', asyncHandler(async (req, res) => {
  created(res, await transferStock(context(req), req.body), 'Stock moved.');
}));

// ─── Update from file (lib/stock-file-import.js) ─────────────────────────────
// Owner/admin/manager, like the rest of this router. The sheet lists every
// active size for one location; staff fill the Stock column and upload it.

router.get('/stock-file/template', asyncHandler(async (req, res) => {
  const { filename, csv } = await buildTemplate(context(req), req.query.locationId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}));

router.post('/stock-file/preview', stockFileUpload.single('csv'), asyncHandler(async (req, res) => {
  ok(res, await previewStockFile(context(req), {
    buffer: req.file?.buffer, filename: req.file?.originalname, locationId: req.body?.locationId,
  }));
}));

router.post('/stock-file/:id/commit', asyncHandler(async (req, res) => {
  const result = await commitStockFile(context(req), req.params.id);
  ok(res, result, result.location ? `Stock updated at ${result.location.name}.` : 'Stock updated.');
}));

// ─── Per-location stock switch (migration 046, lib/location-stock.js) ───────
// Owner/admin only. Turning it on seeds every variant's current total into the
// warehouse; the opening stocktake then moves units to where they are. See
// the go-live runbook before using it on a live shop.

const ownerOrAdmin = requireAuth({ roles: ['owner', 'admin'] });

async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

router.get('/per-location', asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  ok(res, await inTransaction(async (client) => {
    await locationStock.syncLocations(client, tenantId);
    const enabled = await locationStock.perLocationEnabled(client, tenantId);
    const units = enabled ? await client.query(
      `SELECT location_id, COALESCE(sum(quantity), 0)::int AS units
         FROM variant_location_stock WHERE tenant_id = $1 GROUP BY location_id`,
      [tenantId],
    ) : { rows: [] };
    return {
      enabled,
      locations: await locationStock.listLocations(client, tenantId),
      // Units on hand per location (location id → units), for the pickers.
      units: Object.fromEntries(units.rows.map((row) => [row.location_id, row.units])),
      drift: enabled ? (await locationStock.findLocationDrift(client, tenantId, 20)) : [],
    };
  }));
}));

// Stores take their names from their branch (Settings → Branches); the
// warehouse has no branch, so it is named here.
router.get('/automatic-fulfillment', ownerOrAdmin, asyncHandler(async (req,res) => {
  ok(res, await require('../lib/automatic-fulfillment').configuration(db.pool, req.user.tenantId));
}));
router.put('/automatic-fulfillment', ownerOrAdmin, asyncHandler(async (req,res) => {
  ok(res, await inTransaction(client => require('../lib/automatic-fulfillment').saveSettings(client, context(req), req.body)));
}));

router.patch('/locations/:id', ownerOrAdmin, asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return res.status(422).json({ success: false, message: 'The name must be 1 to 60 characters.' });
  }
  const result = await db.query(
    `UPDATE stocktake_locations SET name = $3
      WHERE tenant_id = $1 AND id = $2 AND location_type = 'warehouse'
      RETURNING id, name`,
    [req.user.tenantId, req.params.id, name],
  ).catch((err) => {
    if (err.code === '22P02') return { rowCount: 0 };
    if (err.code === '23505') {
      const conflict = new Error('Another location already uses that name.');
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  });
  if (!result.rowCount) {
    return res.status(404).json({ success: false, message: 'Only the warehouse is renamed here. Stores are renamed from their branch.' });
  }
  ok(res, result.rows[0], 'Location renamed.');
}));

router.post('/per-location/activate', ownerOrAdmin, asyncHandler(async (req, res) => {
  const result = await inTransaction((client) => locationStock.activatePerLocation(client, context(req)));
  ok(res, result, result.alreadyOn ? 'Per-location stock is already on.' : 'Per-location stock is on. All stock starts in the warehouse.');
}));

router.post('/per-location/deactivate', ownerOrAdmin, asyncHandler(async (req, res) => {
  await inTransaction((client) => locationStock.deactivatePerLocation(client, context(req)));
  ok(res, { enabled: false }, 'Per-location stock is off. Stock is one shared figure again.');
}));

module.exports = router;
