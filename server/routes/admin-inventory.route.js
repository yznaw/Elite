const { Router } = require('express');
const { asyncHandler, created, ok } = require('./lib');
const {
  adjustStock,
  cancelStocktake,
  getStocktake,
  listStocktakes,
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

router.post('/stocktakes', asyncHandler(async (req, res) => {
  created(res, await startStocktake(context(req), req.body), 'Stocktake started.');
}));

router.get('/stocktakes/:id', asyncHandler(async (req, res) => {
  ok(res, await getStocktake(context(req), req.params.id));
}));

router.post('/stocktakes/:id/counts', asyncHandler(async (req, res) => {
  ok(res, await saveCount(context(req), req.params.id, req.body));
}));

router.post('/stocktakes/:id/post', asyncHandler(async (req, res) => {
  ok(res, await postStocktake(context(req), req.params.id, req.body), 'Stocktake posted.');
}));

router.post('/stocktakes/:id/cancel', asyncHandler(async (req, res) => {
  ok(res, await cancelStocktake(context(req), req.params.id), 'Stocktake cancelled.');
}));

module.exports = router;
