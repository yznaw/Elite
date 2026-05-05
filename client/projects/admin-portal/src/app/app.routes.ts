import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Lazy-load the dashboard page
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    // Catch-all — redirect unknown admin paths to dashboard
    path: '**',
    redirectTo: '',
  },
];
