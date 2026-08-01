const { Router } = require('express');
const { asyncHandler, ok } = require('./lib');
const { PosError } = require('../lib/pos/errors');
const { listAllRegisters, revokeRegister, listEnrollmentTokens, revokeEnrollmentToken } = require('../lib/pos/register-service');
const { listManagerPins, clearManagerPin } = require('../lib/pos/manager-service');
const { getPosPolicy, updatePosPolicy } = require('../lib/pos/policy-service');

const router = Router();

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    // This router writes audit_events (enrollment tokens, manager PINs), so it
    // carries the correlation id too — docs/24, Phase A.
    requestId: req.requestId || null,
  };
}

router.get('/registers', asyncHandler(async (req, res) => {
  ok(res, await listAllRegisters(context(req)));
}));

router.post('/registers/:id/revoke', asyncHandler(async (req, res) => {
  ok(res, await revokeRegister(context(req), req.params.id));
}));

router.get('/enrollment-tokens', asyncHandler(async (req, res) => {
  ok(res, await listEnrollmentTokens(context(req)));
}));

router.post('/enrollment-tokens/:id/revoke', asyncHandler(async (req, res) => {
  ok(res, await revokeEnrollmentToken(context(req), req.params.id));
}));

router.get('/manager-pins', asyncHandler(async (req, res) => {
  ok(res, await listManagerPins(context(req)));
}));

router.post('/manager-pins/:userId/clear', asyncHandler(async (req, res) => {
  ok(res, await clearManagerPin(context(req), req.params.userId));
}));

router.get('/policy', asyncHandler(async (req, res) => {
  ok(res, await getPosPolicy(context(req)));
}));

router.put('/policy', asyncHandler(async (req, res) => {
  ok(res, await updatePosPolicy(context(req), req.body));
}));

// PosError shaping lives in the global error handler in index.js — see the
// note in pos.route.js. A router-local responder here would bypass the
// correlation id, the app_errors record and the structured log line.

module.exports = router;
