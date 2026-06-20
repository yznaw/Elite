import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'collection/:parent/:child',
    loadComponent: () =>
      import('./pages/collection/collection.component').then(
        (m) => m.CollectionComponent,
      ),
  },
  {
    path: 'collection/:collection',
    loadComponent: () =>
      import('./pages/collection/collection.component').then(
        (m) => m.CollectionComponent,
      ),
  },
  {
    path: 'collection',
    loadComponent: () =>
      import('./pages/collection/collection.component').then(
        (m) => m.CollectionComponent,
      ),
  },
  {
    path: 'product/:id',
    loadComponent: () =>
      import('./pages/product/product.component').then(
        (m) => m.ProductComponent,
      ),
  },
  {
    path: 'thank-you',
    loadComponent: () =>
      import('./pages/thank-you/thank-you.component').then(
        (m) => m.ThankYouComponent,
      ),
  },
  {
    path: 'checkout/success',
    loadComponent: () =>
      import('./pages/thank-you/thank-you.component').then(
        (m) => m.ThankYouComponent,
      ),
  },
  {
    path: 'checkout/failure',
    loadComponent: () =>
      import('./pages/checkout-result/checkout-result.component').then(
        (m) => m.CheckoutResultComponent,
      ),
  },
  {
    path: 'checkout/pending',
    loadComponent: () =>
      import('./pages/checkout-result/checkout-result.component').then(
        (m) => m.CheckoutResultComponent,
      ),
  },
  {
    path: 'checkout',
    loadComponent: () =>
      import('./pages/checkout/checkout.component').then(
        (m) => m.CheckoutComponent,
      ),
  },
  {
    path: 'story',
    loadComponent: () =>
      import('./pages/story/story.component').then((m) => m.StoryComponent),
  },
  {
    path: 'contact',
    loadComponent: () =>
      import('./pages/contact/contact.component').then(
        (m) => m.ContactComponent,
      ),
  },
  {
    path: 'kiosk',
    loadComponent: () =>
      import('./pages/kiosk/kiosk.component').then((m) => m.KioskComponent),
  },
  {
    path: 'policy/:handle',
    loadComponent: () =>
      import('./pages/policy/policy.component').then((m) => m.PolicyComponent),
  },
  { path: '**', redirectTo: '' },
];
