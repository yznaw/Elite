import { ApplicationConfig } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  provideClientHydration,
  withEventReplay,
  withHttpTransferCacheOptions,
} from '@angular/platform-browser';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      /*
       * `scrollPositionRestoration` is deliberately off. It scrolls with the browser's
       * scroller, which obeys `html { scroll-behavior: smooth }` from styles.scss, so
       * arriving on a new page from the footer of a long one *animated* the whole way up:
       * for the first half second you were still looking at the bottom of the new page, and
       * a single touch cancelled the animation and left you stranded mid-page. AppComponent
       * scrolls to the top itself, instantly, and only when the path actually changes.
       */
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'disabled',
      }),
    ),
    provideHttpClient(withFetch()),
    // Reuse the server-rendered DOM instead of discarding and repainting it.
    // Event replay keeps a tap made before the app finished booting (a filter,
    // "add to cart") from being silently lost.
    //
    // The transfer cache hands the server's GET responses to the browser so it
    // doesn't fetch the same data twice. Two kinds of request are kept out of
    // it: the cart, which belongs to the visitor's session and must never be
    // answered from a server render; and preview drafts, which are per-token
    // and must always be fetched live.
    provideClientHydration(
      withEventReplay(),
      withHttpTransferCacheOptions({
        filter: (req) => !/\/carts(\/|$|\?)|\/storefront-content\/draft/.test(req.url),
      }),
    ),
    // `provideAnimations()` used to sit here. The storefront animates entirely
    // in CSS: there is no `animations: []` metadata and no `@angular/animations`
    // import anywhere in the app, so the provider was booting the animation
    // engine, and shipping it in the initial bundle, for nothing. Add it back
    // only alongside the first component that actually declares a trigger.
  ],
};
