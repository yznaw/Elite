const { Router } = require('express');
const { asyncHandler, created, ok } = require('./lib');
const {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
} = require('../lib/pos/branch-service');

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

router.get('/', asyncHandler(async (req, res) => {
  ok(res, await listBranches(context(req)));
}));

router.post('/', asyncHandler(async (req, res) => {
  created(res, await createBranch(context(req), req.body));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  ok(res, await updateBranch(context(req), req.params.id, req.body));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  ok(res, await deleteBranch(context(req), req.params.id));
}));

router.post('/:id/set-default', asyncHandler(async (req, res) => {
  ok(res, await setDefaultBranch(context(req), req.params.id));
}));

// PosError shaping lives in the global error handler in index.js — see the
// note in pos.route.js and admin-pos-security.route.js.

module.exports = router;
