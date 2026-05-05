import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Lazy-load the home page feature module
    // Replace with your actual page component or lazy-loaded route
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    // Catch-all — redirect unknown paths to home
    path: '**',
    redirectTo: '',
  },
];
