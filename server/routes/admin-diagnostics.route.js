const { Router } = require('express');
const { asyncHandler, ok } = require('./lib');
const {
  auditActions,
  errorSummary,
  listAuditEvents,
  listErrors,
  resolveError,
} = require('../lib/diagnostics-service');

const router = Router();

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    requestId: req.requestId || null,
  };
}

router.get('/errors', asyncHandler(async (req, res) => {
  ok(res, {
    summary: await errorSummary(context(req)),
    errors: await listErrors(context(req), req.query),
  });
}));

router.post('/errors/:id/resolve', asyncHandler(async (req, res) => {
  ok(res, await resolveError(context(req), req.params.id));
}));

router.get('/audit-events', asyncHandler(async (req, res) => {
  ok(res, {
    actions: await auditActions(context(req)),
    events: await listAuditEvents(context(req), req.query),
  });
}));

module.exports = router;
