const { Router } = require('express');
const { asyncHandler, ok } = require('./lib');
const { PosError } = require('../lib/pos/errors');
const { listAllRegisters, revokeRegister, listEnrollmentTokens, revokeEnrollmentToken } = require('../lib/pos/register-service');
const { listManagerPins, clearManagerPin } = require('../lib/pos/manager-service');

const router = Router();

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
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
