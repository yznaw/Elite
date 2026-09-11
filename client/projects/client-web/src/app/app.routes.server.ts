import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Which routes the server renders, and which it hands to the browser.
 *
 * Server: pages whose content is the point of being indexed. Rendered per
 * request, never at build time, so an edit published from the admin is live in
 * the next page view instead of waiting for a rebuild.
 *
 * Client: served as the plain client-rendered shell, exactly as before SSR.
 * - product/:id  stays client-side until product URLs move to slugs; rendering
 *                UUID URLs now would only get them indexed ahead of the rename.
 * - checkout/*, thank-you  are transactional, tied to the visitor's session and
 *                sessionStorage, and have nothing to index (robots.txt already
 *                disallows them).
 * - experience   is the in-store feedback kiosk.
 *
 * Every path in app.routes.ts needs an entry here or must fall through to `**`.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'collection', renderMode: RenderMode.Server },
  { path: 'collection/:collection', renderMode: RenderMode.Server },
  { path: 'collection/:parent/:child', renderMode: RenderMode.Server },
  { path: 'story', renderMode: RenderMode.Server },
  { path: 'contact', renderMode: RenderMode.Server },
  { path: 'policy/:handle', renderMode: RenderMode.Server },

  { path: 'product/:id', renderMode: RenderMode.Client },
  { path: 'checkout', renderMode: RenderMode.Client },
  { path: 'checkout/success', renderMode: RenderMode.Client },
  { path: 'checkout/failure', renderMode: RenderMode.Client },
  { path: 'checkout/pending', renderMode: RenderMode.Client },
  { path: 'thank-you', renderMode: RenderMode.Client },
  { path: 'experience', renderMode: RenderMode.Client },

  // The not-found page, now with a real 404 status. Before SSR every unknown
  // URL answered 200, so crawlers were told dead links were live pages.
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
