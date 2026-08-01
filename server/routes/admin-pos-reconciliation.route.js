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
    requestId: req.requestId || null,
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

// PosError shaping lives in the global error handler in index.js — see the
// note in pos.route.js. A router-local responder here would bypass the
// correlation id, the app_errors record and the structured log line.

module.exports = router;
