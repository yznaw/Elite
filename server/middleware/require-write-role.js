/**
 * Read-open, write-restricted gate.
 *
 * `requireAuth({ roles })` blocks a route wholesale, which is wrong for
 * surfaces a viewer is supposed to be able to look at but not change — the
 * admin Orders and Customers pages, where a viewer could previously refund an
 * order, cancel it, or delete a customer.
 *
 * Mount AFTER requireAuth(), which populates `req.user`.
 *
 *   admin.use('/orders', requireWriteRole(['owner','admin','manager']), ordersRouter);
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requireWriteRole(roles) {
  const allowed = new Set(roles);

  return (req, res, next) => {
    if (READ_METHODS.has(req.method)) return next();
    if (req.user && allowed.has(req.user.role)) return next();
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions.',
    });
  };
}

module.exports = { requireWriteRole };
