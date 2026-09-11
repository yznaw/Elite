/**
 * PM2 definition for the storefront's server-side rendering process.
 *
 *   pm2 startOrReload deploy/pm2/elite-web.config.cjs
 *   pm2 save
 *
 * Only `elite-web` lives here. The API (`elite-api`) was started by hand long
 * before this file existed and is deliberately left out, so running this can
 * never restart or reconfigure the API by accident.
 *
 * Nothing breaks if this process is down: nginx falls back to serving the
 * plain client-rendered shell (`index.csr.html`) on 502/503/504, which is how
 * the storefront behaved before SSR. See deploy/nginx/elite.conf.
 */
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'elite-web',
      // Resolved from this file, so the config works from any checkout path
      // rather than assuming /var/www/elite.
      cwd: path.resolve(__dirname, '../../client'),
      script: 'dist/client-web/server/server.mjs',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        // Loopback only. nginx is the public edge; this port must never be
        // reachable from outside the host.
        HOST: '127.0.0.1',
        PORT: '4000',
        // Where server-side renders fetch data. Loopback, so page renders never
        // leave the machine or depend on public DNS and TLS.
        API_ORIGIN: 'http://127.0.0.1:3000',
        // The public origin baked into canonical URLs, og:url and JSON-LD. Pinned
        // rather than read from the proxied request, which reports http:// and
        // whatever Host nginx forwarded.
        SITE_URL: 'https://elitecollections.qa',
      },
      // A render that leaks memory gets recycled before it can starve the API
      // sharing this box. Normal steady state is well under this.
      max_memory_restart: '400M',
      kill_timeout: 5000,
      time: true,
    },
  ],
};
