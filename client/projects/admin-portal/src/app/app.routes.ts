import { Routes } from '@angular/router';

export const routes: Routes = [
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
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
