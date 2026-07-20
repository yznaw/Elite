const { Router } = require('express');
const { asyncHandler, ok } = require('./lib');
const {
  dailySales,
  cashMovements,
  cardSettlementExceptions,
  inventoryMovements,
  refundVoidExceptions,
  zReportHistory,
} = require('../lib/pos/reports-service');

const router = Router();

function context(req) {
  return { tenantId: req.user.tenantId, userId: req.user.id, role: req.user.role };
}

router.get('/daily-sales', asyncHandler(async (req, res) => {
  ok(res, await dailySales(context(req), req.query));
}));

router.get('/cash-movements', asyncHandler(async (req, res) => {
  ok(res, await cashMovements(context(req), req.query));
}));

router.get('/card-settlement-exceptions', asyncHandler(async (req, res) => {
  ok(res, await cardSettlementExceptions(context(req), req.query));
}));

router.get('/inventory-movements', asyncHandler(async (req, res) => {
  ok(res, await inventoryMovements(context(req), req.query));
}));

router.get('/refund-void-exceptions', asyncHandler(async (req, res) => {
  ok(res, await refundVoidExceptions(context(req), req.query));
}));

router.get('/z-reports', asyncHandler(async (req, res) => {
  ok(res, await zReportHistory(context(req), req.query));
}));

module.exports = router;
