import { isPlatformBrowser } from '@angular/common';
import { InjectionToken, PLATFORM_ID, REQUEST, inject } from '@angular/core';

/**
 * Where the storefront finds its API, and which origin it calls itself.
 *
 * This replaces fourteen copies of a `resolveApiBase()` that each read
 * `window.location` while the owning service or component was being
 * constructed. That worked in the browser and throws on the server, where
 * there is no `window`, so none of the app could render server-side.
 *
 * Both sides compute the same value for the same page: `/api` in production,
 * `http://<host>:3000/api` on a development machine. That sameness is
 * load-bearing twice over:
 *
 * - Image `src`s rendered into the HTML (`resolveClientMediaUrl` prefixes the
 *   base onto `/uploads/...`) must match what the browser would render, or
 *   hydration re-points every image and the browser downloads them all twice.
 *
 * - The transfer cache keys each response by its literal request URL, so the
 *   server must request the same `/api/x` the browser will, or the browser
 *   finds nothing cached and fetches every page's data again.
 *
 * On the server a relative `/api` has nothing to resolve against; the server's
 * HTTP backend (`app.config.server.ts`) sends those requests to `API_ORIGIN`
 * without the app ever seeing a different URL.
 *
 * `API_BASE` (requests) and `PUBLIC_API_BASE` (markup) are kept as separate
 * tokens so either can diverge later without touching every consumer again,
 * but today `API_BASE` is simply `PUBLIC_API_BASE`.
 */

/**
 * A hostname that means "the developer's machine or LAN", where the API runs
 * on its own port rather than behind nginx at `/api`. Same rules as the most
 * complete of the old copies: loopback in both address families, plus the
 * RFC 1918 private ranges, so testing from a phone on the office Wi-Fi works.
 */
function isPrivateHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

function apiBaseForPage(hostname: string, protocol: string): string {
  return isPrivateHost(hostname) ? `${protocol}//${hostname}:3000/api` : '/api';
}

/**
 * The page's own URL, from whichever side is rendering.
 *
 * `REQUEST` is null outside a real request (build-time route extraction), in
 * which case there is no page to answer for and the callers fall back to the
 * production defaults.
 */
function pageUrl(): URL | null {
  if (isPlatformBrowser(inject(PLATFORM_ID))) return new URL(location.href);
  const request = inject(REQUEST, { optional: true });
  return request ? new URL(request.url) : null;
}

/** API base for URLs rendered into markup. Identical on server and browser. */
export const PUBLIC_API_BASE = new InjectionToken<string>('PUBLIC_API_BASE', {
  providedIn: 'root',
  factory: () => {
    const url = pageUrl();
    return url ? apiBaseForPage(url.hostname, url.protocol) : '/api';
  },
});

/**
 * API base for HTTP requests. Same value as `PUBLIC_API_BASE`; see the note at
 * the top of this file for why the server does not override it.
 */
export const API_BASE = new InjectionToken<string>('API_BASE', {
  providedIn: 'root',
  factory: () => inject(PUBLIC_API_BASE),
});

/**
 * The storefront's public origin, for canonical, og:url and JSON-LD.
 *
 * Behind nginx the server sees its proxied request, which can report `http://`
 * or an internal host, so production pins this with `SITE_URL` in
 * `app.config.server.ts`. The request-derived value is only the fallback that
 * keeps local SSR runs honest.
 */
export const SITE_ORIGIN = new InjectionToken<string>('SITE_ORIGIN', {
  providedIn: 'root',
  factory: () => pageUrl()?.origin ?? '',
});
