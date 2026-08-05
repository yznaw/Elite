const { Router } = require('express');
const healthRouter = require('./health.route');
const configRouter = require('./config.route');
const authRouter = require('./auth.route');
const adminProductsRouter = require('./admin-products.route');
const adminCollectionsRouter = require('./admin-collections.route');
const adminCustomersRouter = require('./admin-customers.route');
const adminOrdersRouter = require('./admin-orders.route');
const adminMediaRouter = require('./admin-media.route');
const adminStorefrontRouter = require('./admin-storefront.route');
const adminSettingsRouter = require('./admin-settings.route');
const adminAnalyticsRouter = require('./admin-analytics.route');
const adminPosReconciliationRouter = require('./admin-pos-reconciliation.route');
const adminPosReportsRouter = require('./admin-pos-reports.route');
const adminPosSecurityRouter = require('./admin-pos-security.route');
const adminPosBranchesRouter = require('./admin-pos-branches.route');
const adminBulkImportRouter = require('./admin-bulk-import.route');
const adminRefRouter = require('./admin-ref.route');
const productsRouter = require('./products.route');
const collectionsRouter = require('./collections.route');
const policiesRouter = require('./policies.route');
const adminPoliciesRouter = require('./admin-policies.route');
const storefrontRouter = require('./storefront.route');
const refRouter = require('./ref.route');
const contactRouter = require('./contact.route');
const cartsRouter = require('./carts.route');
const analyticsRouter = require('./analytics.route');
const storefrontContentRouter = require('./storefront-content.route');
const nboxWebhookRouter = require('./nbox-webhook.route');
const paymentsRouter = require('./payments.route');
const invitationsRouter = require('./invitations.route');
const posRouter = require('./pos.route');
const clientLogsRouter = require('./client-logs.route');
const adminDiagnosticsRouter = require('./admin-diagnostics.route');
const adminInventoryRouter = require('./admin-inventory.route');
const { router: reviewsPublicRouter, generalRouter: reviewsGeneralRouter, adminRouter: reviewsAdminRouter } = require('./product-reviews.route');
const { requireAuth } = require('../middleware/require-auth');

const router = Router();

// ─── Public routes ───────────────────────────────────────────────────────────
router.use('/health', healthRouter);
router.use('/config', configRouter);
router.use('/auth', authRouter);
router.use('/invitations', invitationsRouter);
router.use('/products', productsRouter);
router.use('/products', reviewsPublicRouter);
router.use('/reviews', reviewsGeneralRouter);
router.use('/collections', collectionsRouter);
router.use('/policies', policiesRouter);
router.use('/storefront', storefrontRouter.router);
router.use('/ref', refRouter);
router.use('/contact', contactRouter);
router.use('/carts', cartsRouter);
router.use('/analytics', analyticsRouter);
router.use('/payments', paymentsRouter);
router.use('/storefront-content', storefrontContentRouter.publicRouter);
router.use('/webhooks/nbox', nboxWebhookRouter);
router.use('/pos', posRouter);
// Mounted publicly because the CSP sub-route must accept browser-generated
// reports with no session; the app-log route enforces requireAuth() itself.
router.use('/client-logs', clientLogsRouter);

// ─── Admin routes — require an authenticated session ────────────────────────
const admin = Router();
admin.use(requireAuth());
admin.use('/products', adminProductsRouter);
admin.use('/collections', adminCollectionsRouter);
admin.use('/customers', adminCustomersRouter);
admin.use('/orders', adminOrdersRouter);
admin.use('/media', adminMediaRouter);
admin.use('/storefront', adminStorefrontRouter);
admin.use('/storefront-content', storefrontContentRouter.adminRouter);
admin.use('/analytics', adminAnalyticsRouter);
admin.use('/bulk-import', adminBulkImportRouter);
admin.use('/ref', adminRefRouter);
// Settings includes role-sensitive endpoints (team management). Owners and
// admins can manage everything; viewers/managers can read store settings.
admin.use('/settings', adminSettingsRouter);
admin.use('/policies', adminPoliciesRouter);
// Back-office cash/card reconciliation — owner/admin/manager only, no
// cashier access (cashiers don't reach the admin portal at all, but a
// viewer account shouldn't submit settlement figures either).
admin.use('/pos-reconciliation', requireAuth({ roles: ['owner', 'admin', 'manager'] }), adminPosReconciliationRouter);
// Core reporting (Phase 5) — reads sales/cash/card/inventory/refund-void
// ledgers written in earlier phases; same access scope as reconciliation.
admin.use('/pos-reports', requireAuth({ roles: ['owner', 'admin', 'manager'] }), adminPosReportsRouter);
// Registered devices, enrollment tokens, and manager-PIN administration —
// owner/admin only, since these are the exact same permission checks the
// underlying services already enforce (createEnrollmentToken, setManagerPin).
admin.use('/pos-security', requireAuth({ roles: ['owner', 'admin'] }), adminPosSecurityRouter);
// Physical shop locations, each with its own printable receipt identity —
// see server/db/migrations/027_pos_branches.sql and branch-service.js.
admin.use('/pos-branches', requireAuth({ roles: ['owner', 'admin'] }), adminPosBranchesRouter);
// Diagnostics: grouped application errors (server + register browsers + CSP)
// and the audit trail, which had no UI at all before this. Owner/admin only —
// stack traces and audit rows are not for every role.
admin.use('/diagnostics', requireAuth({ roles: ['owner', 'admin'] }), adminDiagnosticsRouter);
// Stock adjustments and stocktakes — the legitimate way to correct a stock
// number, as opposed to editing it in the catalogue with no reason attached
// (docs/25 Phase 8). Owner/admin only; the service enforces the same check.
admin.use('/inventory', requireAuth({ roles: ['owner', 'admin'] }), adminInventoryRouter);
admin.use('/', reviewsAdminRouter);

router.use('/admin', admin);

module.exports = router;
