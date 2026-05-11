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
        path: 'analytics',
        loadComponent: () =>
          import('./pages/analytics/analytics.component').then((m) => m.AnalyticsComponent),
      },
      {
        path: 'sync',
        loadComponent: () =>
          import('./pages/sync/sync.component').then((m) => m.SyncComponent),
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
