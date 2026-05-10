const { Router } = require('express');
const healthRouter = require('./health.route');
const adminProductsRouter = require('./admin-products.route');
const adminCollectionsRouter = require('./admin-collections.route');
const adminCustomersRouter = require('./admin-customers.route');
const adminOrdersRouter = require('./admin-orders.route');
const adminMediaRouter = require('./admin-media.route');
const adminStorefrontRouter = require('./admin-storefront.route');
const adminSettingsRouter = require('./admin-settings.route');
const adminSyncRouter = require('./admin-sync.route');
const adminAnalyticsRouter = require('./admin-analytics.route');
const productsRouter = require('./products.route');
const contactRouter = require('./contact.route');
const cartsRouter = require('./carts.route');
// Import additional route modules here as you build them
// const authRouter = require('./auth.route');
// const userRouter = require('./user.route');

const router = Router();

// ─── Mount Routes ─────────────────────────────────────────────────────────────
router.use('/health', healthRouter);
router.use('/products', productsRouter);
router.use('/admin/products', adminProductsRouter);
router.use('/admin/collections', adminCollectionsRouter);
router.use('/admin/customers', adminCustomersRouter);
router.use('/admin/orders', adminOrdersRouter);
router.use('/admin/media', adminMediaRouter);
router.use('/admin/storefront', adminStorefrontRouter);
router.use('/admin/settings', adminSettingsRouter);
router.use('/admin/sync', adminSyncRouter);
router.use('/admin/analytics', adminAnalyticsRouter);
router.use('/contact', contactRouter);
router.use('/carts', cartsRouter);
// router.use('/auth',   authRouter);
// router.use('/users',  userRouter);

module.exports = router;
