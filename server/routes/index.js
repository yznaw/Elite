const { Router } = require('express');
const healthRouter = require('./health.route');
const authRouter = require('./auth.route');
const adminProductsRouter = require('./admin-products.route');
const adminCollectionsRouter = require('./admin-collections.route');
const adminCustomersRouter = require('./admin-customers.route');
const adminOrdersRouter = require('./admin-orders.route');
const adminMediaRouter = require('./admin-media.route');
const adminStorefrontRouter = require('./admin-storefront.route');
const adminSettingsRouter = require('./admin-settings.route');
const adminSyncRouter = require('./admin-sync.route');
const adminAnalyticsRouter = require('./admin-analytics.route');
const adminBulkImportRouter = require('./admin-bulk-import.route');
const adminRefRouter = require('./admin-ref.route');
const productsRouter = require('./products.route');
const contactRouter = require('./contact.route');
const cartsRouter = require('./carts.route');
const { requireAuth } = require('../middleware/require-auth');

const router = Router();

// ─── Public routes ───────────────────────────────────────────────────────────
router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/products', productsRouter);
router.use('/contact', contactRouter);
router.use('/carts', cartsRouter);

// ─── Admin routes — require an authenticated session ────────────────────────
const admin = Router();
admin.use(requireAuth());
admin.use('/products', adminProductsRouter);
admin.use('/collections', adminCollectionsRouter);
admin.use('/customers', adminCustomersRouter);
admin.use('/orders', adminOrdersRouter);
admin.use('/media', adminMediaRouter);
admin.use('/storefront', adminStorefrontRouter);
admin.use('/sync', adminSyncRouter);
admin.use('/analytics', adminAnalyticsRouter);
admin.use('/bulk-import', adminBulkImportRouter);
admin.use('/ref', adminRefRouter);
// Settings includes role-sensitive endpoints (team management). Owners and
// admins can manage everything; viewers/managers can read store settings.
admin.use('/settings', adminSettingsRouter);

router.use('/admin', admin);

module.exports = router;
