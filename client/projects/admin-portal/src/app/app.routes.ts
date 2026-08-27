import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/login/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/login/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'accept-invite',
    loadComponent: () =>
      import('./pages/accept-invite/accept-invite.component').then((m) => m.AcceptInviteComponent),
  },
  {
    path: 'pos',
    canMatch: [authGuard, roleGuard(['owner', 'admin', 'manager', 'cashier'])],
    loadComponent: () =>
      import('./pages/pos/pos.component').then((m) => m.PosComponent),
  },
  {
    path: '',
    canMatch: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'catalog',
        loadComponent: () =>
          import('./pages/catalog/catalog.component').then((m) => m.CatalogComponent),
      },
      {
        path: 'collections',
        loadComponent: () =>
          import('./pages/collections/collections.component').then((m) => m.CollectionsComponent),
      },
      {
        path: 'media',
        loadComponent: () =>
          import('./pages/media/media.component').then((m) => m.MediaComponent),
      },
      {
        path: 'storefront',
        loadComponent: () =>
          import('./pages/storefront/storefront.component').then((m) => m.StorefrontComponent),
      },
      { path: 'home-content', pathMatch: 'full', redirectTo: 'storefront' },
      {
        path: 'orders',
        loadComponent: () =>
          import('./pages/orders/orders.component').then((m) => m.OrdersComponent),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./pages/customers/customers.component').then((m) => m.CustomersComponent),
      },
      {
        path: 'feedback',
        loadComponent: () =>
          import('./pages/feedback/feedback.component').then((m) => m.FeedbackComponent),
      },
      {
        path: 'policies',
        loadComponent: () =>
          import('./pages/policies/policies.component').then((m) => m.PoliciesComponent),
      },
      {
        path: 'feedback/:productId',
        loadComponent: () =>
          import('./pages/feedback/feedback-detail.component').then((m) => m.FeedbackDetailComponent),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
      },
      {
        // Operating expenses ledger. Owner/admin only — matches the API mount,
        // since this is whole-business financial data.
        path: 'expenses',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/expenses/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'reference',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/reference/reference.component').then((m) => m.ReferenceComponent),
      },
      {
        // Back-office card settlement reconciliation — no cashier access.
        path: 'reconciliation',
        canMatch: [roleGuard(['owner', 'admin', 'manager'])],
        loadComponent: () =>
          import('./pages/pos-reconciliation/pos-reconciliation.component').then((m) => m.PosReconciliationComponent),
      },
      {
        // Core reporting (Phase 5) — same access scope as reconciliation.
        path: 'reports',
        canMatch: [roleGuard(['owner', 'admin', 'manager'])],
        loadComponent: () =>
          import('./pages/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        // Counting the shelf and posting the difference. Owner/admin only —
        // it writes stock (docs/25 Phase 8).
        path: 'stocktake',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/stocktake/stocktake.component').then((m) => m.StocktakeComponent),
      },
      {
        // Application errors (server, register browsers, CSP) and the audit
        // trail. Owner/admin only — stack traces and audit rows are not for
        // every role. See docs/24-logging-observability-plan.md Phase H.
        path: 'diagnostics',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/diagnostics/diagnostics.component').then((m) => m.DiagnosticsComponent),
      },
      {
        // Only owners and admins can manage workspace settings & team members.
        path: 'settings',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        // Manager-role accounts can't reach the rest of Settings (store
        // config/team management are owner/admin-only) but still need a way
        // to set the manager PIN that approver-separation requires them to
        // have — see docs/17-pos-remote-verification, 2026-07-20 retest.
        path: 'my-pin',
        canMatch: [roleGuard(['owner', 'admin', 'manager'])],
        loadComponent: () =>
          import('./pages/my-pin/my-pin.component').then((m) => m.MyPinComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
