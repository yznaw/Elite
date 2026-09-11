import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

/**
 * Storefront render server. Runs as the `elite-web` pm2 process
 * (deploy/pm2/elite-web.config.cjs) behind nginx, which serves every built
 * file itself and only proxies page requests here. If this process is down or
 * slow, nginx serves the client-rendered shell instead (deploy/nginx/elite.conf),
 * so nothing here is on the critical path for the site staying up.
 */

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.disable('x-powered-by');

const angularApp = new AngularNodeAppEngine({
  // Allowed Host values are baked into the build from angular.json
  // (`security.allowedHosts`); a request for any other host gets a 400 and is
  // never rendered, which is what stops Host-header SSRF.
  //
  // nginx sets these two on every proxied request. Trusting them keeps
  // @angular/ssr from logging a warning per request for each untrusted
  // X-Forwarded-* header. Neither decides anything security-relevant here:
  // canonical URLs come from SITE_URL, not from the request, and
  // X-Forwarded-Host is deliberately not trusted.
  trustProxyHeaders: ['x-forwarded-for', 'x-forwarded-proto'],
});

/**
 * Built files. In production nginx answers these before a request can reach
 * this process; this is for running the server directly (local checks,
 * scripts/ssr-smoke.mjs). The client-rendered shell is the one HTML file in
 * here and must not inherit the year-long cache meant for hashed bundles.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);

/**
 * Everything else is a page. Rendered HTML depends on the visitor's locale
 * cookie and on live catalogue data, so it is never cacheable by a browser or
 * any shared cache in between.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      res.setHeader('Cache-Control', 'no-store');
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is run via PM2.
 * Binds to loopback by default: nginx is the public edge, and this port must
 * never be reachable from outside the host.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 4000);
  const host = process.env['HOST'] || '127.0.0.1';
  app.listen(port, host, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Storefront SSR listening on http://${host}:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
