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
        path: 'reference',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/reference/reference.component').then((m) => m.ReferenceComponent),
      },
      {
        // Only owners and admins can manage workspace settings & team members.
        path: 'settings',
        canMatch: [roleGuard(['owner', 'admin'])],
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
