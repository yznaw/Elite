import { ApplicationConfig } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'top',
      }),
    ),
    provideHttpClient(withFetch()),
    // `provideAnimations()` used to sit here. The storefront animates entirely
    // in CSS: there is no `animations: []` metadata and no `@angular/animations`
    // import anywhere in the app, so the provider was booting the animation
    // engine, and shipping it in the initial bundle, for nothing. Add it back
    // only alongside the first component that actually declares a trigger.
  ],
};
