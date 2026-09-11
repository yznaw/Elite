import { ApplicationConfig, inject, mergeApplicationConfig } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import {
  FetchBackend,
  HttpBackend,
  HttpEvent,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { Observable, map } from 'rxjs';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { SITE_ORIGIN } from './core/api-base';

/**
 * Where server renders actually send API requests. Loopback in production
 * (deploy/pm2/elite-web.config.cjs), so renders never leave the machine.
 */
const apiOrigin = (process.env['API_ORIGIN'] || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/**
 * The public origin written into canonical URLs, og:url and JSON-LD. Pinned in
 * production because behind nginx the rendered request reports `http://`.
 * Unset, SITE_ORIGIN falls back to the request's own origin, which is right
 * for local runs.
 */
const siteUrl = (process.env['SITE_URL'] || '').replace(/\/+$/, '');

/**
 * The server's HTTP backend: the normal fetch backend with two adjustments,
 * both applied below the transfer cache so the cache sees the result.
 *
 * 1. The storefront's own API is reached at `API_ORIGIN`. The app requests
 *    `/api/...` on the server exactly as it does in the browser, because the
 *    transfer cache keys responses by the literal request URL: had the server
 *    asked for `http://127.0.0.1:3000/api/x` while the browser asks for
 *    `/api/x`, no cached response would ever be found and the browser would
 *    fetch every page's data a second time.
 *
 *    By the time a request gets here, @angular/platform-server's own
 *    interceptor has already made that URL absolute against the page, i.e.
 *    `https://elitecollections.qa/api/x` (it runs after the transfer cache,
 *    so the cache key is still the relative URL). Left alone, every render
 *    would leave the machine and come back in through public DNS, TLS and
 *    nginx. So any URL on the page's own host under `/api/` is redirected to
 *    `API_ORIGIN`; a still-relative one is handled the same way. Anything
 *    else, including the development API on its own port, passes untouched.
 *
 * 2. `Set-Cookie` and `Cache-Control` are dropped from responses. The API
 *    sets its CSRF cookie on every response and marks some reads `no-store`,
 *    and the transfer cache refuses anything carrying either, so it stayed
 *    empty. Both headers are for browsers; a render has no cookie jar and no
 *    HTTP cache, and the page it produces is itself no-store (server.ts).
 *    Requests that must stay out of the cache are excluded by the filter in
 *    app.config.ts (drafts) or by sending credentials (the cart), not by
 *    these headers.
 */
function serverApiBackend(): HttpBackend {
  const fetchBackend = inject(FetchBackend);
  // One render = one app injector, so this is the page being rendered: the
  // same PlatformLocation platform-server resolved the relative URL against.
  const pageHostname = inject(PlatformLocation).hostname;

  const toApiOrigin = (url: string): string | null => {
    if (url.startsWith('/') && !url.startsWith('//')) {
      return url.startsWith('/api/') ? `${apiOrigin}${url}` : null;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.hostname !== pageHostname || !parsed.pathname.startsWith('/api/')) return null;
    return `${apiOrigin}${parsed.pathname}${parsed.search}`;
  };

  return {
    handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
      const rewritten = toApiOrigin(req.url);
      const outgoing = rewritten ? req.clone({ url: rewritten }) : req;
      return fetchBackend.handle(outgoing).pipe(
        map((event) =>
          event instanceof HttpResponse
            ? event.clone({ headers: event.headers.delete('set-cookie').delete('cache-control') })
            : event,
        ),
      );
    },
  };
}

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: HttpBackend, useFactory: serverApiBackend },
    ...(siteUrl ? [{ provide: SITE_ORIGIN, useValue: siteUrl }] : []),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
