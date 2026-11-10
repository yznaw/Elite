import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { httpErrorInterceptor } from './interceptors/http-error.interceptor';
import { csrfInterceptor } from './interceptors/csrf.interceptor';
import { GlobalErrorHandler } from './services/global-error-handler';
import { reloadOnStaleBuild } from './services/stale-build';

export const appConfig: ApplicationConfig = {
  providers: [
    // A tab left open across a deploy recovers on its next click instead of
    // dead links — see services/stale-build.ts.
    provideRouter(routes, withNavigationErrorHandler(reloadOnStaleBuild)),
    provideHttpClient(withFetch(), withInterceptors([csrfInterceptor, httpErrorInterceptor])),
    provideAnimations(),
    // Uncaught errors reach the server instead of dying in a console that
    // closes with the tab — see services/global-error-handler.ts (docs/24, Phase D).
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
};
