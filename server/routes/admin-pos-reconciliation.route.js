const { Router } = require('express');
const { asyncHandler, created, ok } = require('./lib');
const { PosError } = require('../lib/pos/errors');
const {
  listReconciliations,
  listRegisters,
  refreshBusinessDay,
  resolveException,
  submitSettlement,
} = require('../lib/pos/card-reconciliation-service');

const router = Router();

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
  };
}

router.get('/registers', asyncHandler(async (req, res) => {
  ok(res, await listRegisters(context(req)));
}));

router.get('/', asyncHandler(async (req, res) => {
  ok(res, await listReconciliations(context(req), {
    registerId: req.query.registerId,
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
  }));
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  created(res, await refreshBusinessDay(context(req), req.body));
}));

router.post('/settlement', asyncHandler(async (req, res) => {
  created(res, await submitSettlement(context(req), req.body));
}));

router.post('/:id/resolve', asyncHandler(async (req, res) => {
  ok(res, await resolveException(context(req), req.params.id, req.body));
}));

router.use((error, _req, res, next) => {
  if (!(error instanceof PosError)) return next(error);
  return res.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
});

module.exports = router;
