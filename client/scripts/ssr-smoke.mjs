#!/usr/bin/env node
/**
 * Prove the storefront's SSR server renders every route without crashing or
 * hanging, with the API both unreachable and reachable.
 *
 *   node scripts/ssr-smoke.mjs                      # API down only
 *   node scripts/ssr-smoke.mjs --api http://127.0.0.1:3000
 *
 * Why both: a server render that throws on a missing `window`, or waits on a
 * timer that never clears, fails the same way whether or not data arrives --
 * but only an unreachable API proves the page still degrades to a rendered
 * shell instead of a 500. CI has no API, so the "down" pass is the one that
 * always runs.
 *
 * Requests carry the production Host header, exactly as nginx forwards it. On
 * a loopback Host the app deliberately targets the development API on :3000
 * instead of API_ORIGIN (see core/api-base.ts), so without this the "API
 * reachable" pass would silently test nothing.
 *
 * Fails on: a non-matching status, any request slower than ROUTE_TIMEOUT_MS
 * (a hung render), render errors in the server's own output, or -- with the
 * API up -- a data page whose transfer cache is empty, which means the
 * browser would fetch everything again and repaint over the rendered page.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = resolve(CLIENT, 'dist/client-web/server/server.mjs');
const PORT = 4390;
const PUBLIC_HOST = 'elitecollections.qa';
// Tuned for an API on loopback, where no legitimate render comes close. Raise
// it (`--timeout 20000`) only when --api points across the internet, where
// network latency alone can exceed it.
const ROUTE_TIMEOUT_MS = (() => {
  const i = process.argv.indexOf('--timeout');
  const value = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 5_000;
})();
const BOOT_TIMEOUT_MS = 30_000;
// Port 9 (discard) refuses immediately, so "API down" fails fast instead of
// waiting on a TCP timeout that would mask a genuinely hung render.
const API_DOWN = 'http://127.0.0.1:9';

const REDIRECT = [301, 302, 303, 307, 308];

// `transfers`: with the API up, the page must ship its API responses in the
// transfer cache.
const ROUTES = [
  { path: '/', status: [200], transfers: true },
  { path: '/collection', status: [200], transfers: true },
  { path: '/story', status: [200] },
  { path: '/contact', status: [200] },
  { path: '/policy/smoke-handle', status: [200, 404] },
  { path: '/this-page-does-not-exist-smoke', status: [404] },
  // Client-rendered routes: served as the CSR shell, never rendered here.
  { path: '/checkout', status: [200] },
  { path: '/thank-you', status: [200] },
  // Sadad return: the root guard now runs server-side and must redirect.
  { path: '/?order_id=smoke', status: REDIRECT, location: /\/checkout\/failure/ },
];

// Lines that mean a render went wrong even if the HTTP status looked fine.
const RENDER_ERROR = /ReferenceError|TypeError|is not defined|NG0\d{3}|Error: /;

const api = (() => {
  const i = process.argv.indexOf('--api');
  return i > -1 ? process.argv[i + 1] : null;
})();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** GET a path the way nginx proxies it. Never follows redirects. */
function get(path, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port: PORT,
      path,
      timeout: timeoutMs,
      headers: { host: PUBLIC_HOST, accept: 'text/html', 'x-forwarded-proto': 'https' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolvePromise({ status: res.statusCode, location: res.headers.location || '', body }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
    req.on('error', reject);
  });
}

/** Number of API responses cached in the page's transfer state. */
function transferEntries(html) {
  const match = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return 0;
  try {
    return Object.keys(JSON.parse(match[1])).filter((key) => key !== '__nghData__').length;
  } catch {
    return 0;
  }
}

async function waitForBoot(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited during boot (code ${child.exitCode})`);
    // Probe a client-rendered route: it answers from the prebuilt shell without
    // rendering or touching the API, so this measures "is the process up" and
    // nothing else. Probing `/` with a live API made a slow first render look
    // like a server that never booted.
    try {
      await get('/checkout', 1_000);
      return;
    } catch { await sleep(250); }
  }
  throw new Error(`server did not accept connections within ${BOOT_TIMEOUT_MS}ms`);
}

/**
 * Refuse to run against a port something else already holds. Otherwise the
 * child fails to bind, the boot probe is answered by the other process, and
 * every result below describes the wrong server -- a leftover one still
 * pointed at a live API makes the "API down" pass look fine.
 */
async function assertPortFree() {
  try {
    await get('/checkout', 1_000);
  } catch {
    return;
  }
  throw new Error(`port ${PORT} is already in use; stop whatever is listening there (lsof -nP -iTCP:${PORT} -sTCP:LISTEN) and rerun`);
}

/** Stop the child and wait until it has really exited and released the port. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  const graceful = await Promise.race([exited.then(() => true), sleep(3_000).then(() => false)]);
  if (!graceful) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function pass(label, apiOrigin) {
  const apiUp = apiOrigin !== API_DOWN;
  const logs = [];
  await assertPortFree();
  const child = spawn(process.execPath, [SERVER], {
    cwd: CLIENT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      API_ORIGIN: apiOrigin,
      SITE_URL: `https://${PUBLIC_HOST}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const failures = [];
  try {
    await waitForBoot(child);
    for (const route of ROUTES) {
      const started = Date.now();
      let res;
      try {
        res = await get(route.path, ROUTE_TIMEOUT_MS);
      } catch (err) {
        failures.push(`${route.path}: no response within ${ROUTE_TIMEOUT_MS}ms (${err.name}) -- likely a hung render`);
        continue;
      }
      const ms = Date.now() - started;
      const okStatus = route.status.includes(res.status);
      const okLocation = !route.location || route.location.test(res.location);
      const cached = transferEntries(res.body);
      // API up: data pages must ship their responses. API down: they must ship
      // none -- data arriving anyway means renders reached some other API than
      // API_ORIGIN (e.g. the public site), which is the bug this guards.
      const okTransfer = !route.transfers || (apiUp ? cached > 0 : cached === 0);
      const mark = okStatus && okLocation && okTransfer ? 'ok  ' : 'FAIL';
      const extra = [
        res.location ? `-> ${res.location}` : '',
        route.transfers ? `(${cached} cached)` : '',
      ].filter(Boolean).join('  ');
      console.log(`  ${mark} ${String(res.status).padEnd(3)} ${String(ms).padStart(5)}ms  ${route.path}${extra ? `  ${extra}` : ''}`);
      if (!okStatus) failures.push(`${route.path}: status ${res.status}, expected ${route.status.join('/')}`);
      if (!okLocation) failures.push(`${route.path}: redirect to "${res.location}", expected ${route.location}`);
      if (!okTransfer) {
        failures.push(apiUp
          ? `${route.path}: transfer cache is empty with the API up -- the browser would refetch and repaint`
          : `${route.path}: ${cached} API responses with API_ORIGIN unreachable -- renders are calling a different API`);
      }
    }
  } catch (err) {
    failures.push(String(err.message || err));
  } finally {
    await stop(child);
  }

  const errorLines = logs.join('').split('\n').filter((l) => RENDER_ERROR.test(l));
  // With the API deliberately down, failed fetches are expected noise; only
  // crashes and Angular runtime errors count there.
  const fatal = apiUp
    ? errorLines
    : errorLines.filter((l) => /ReferenceError|is not defined|NG0\d{3}/.test(l));
  if (fatal.length) failures.push(`render errors in server output:\n      ${fatal.slice(0, 10).join('\n      ')}`);

  console.log(failures.length ? `  ${label}: ${failures.length} failure(s)` : `  ${label}: passed`);
  return failures;
}

if (!existsSync(SERVER)) {
  console.error(`No server bundle at ${SERVER}. Run \`npm run build:web\` first.`);
  process.exit(2);
}

// The render server runs on the production Node major or this proves nothing.
// Newer Node ships browser globals (Node 25+ defines `sessionStorage`), so an
// unguarded `sessionStorage` call passed here on Node 26 and broke Sadad's
// return URL in production on Node 22. The production major is the one the
// API pins in server/package.json `engines`.
{
  const engines = JSON.parse(readFileSync(resolve(CLIENT, '../server/package.json'), 'utf8')).engines?.node ?? '';
  const wanted = Number((engines.match(/\d+/) ?? [])[0]);
  const running = Number(process.versions.node.split('.')[0]);
  if (wanted && running !== wanted) {
    console.error(
      `ssr-smoke must run on Node ${wanted} (server/package.json engines "${engines}"), not ${process.version}.\n`
      + `Run it with a Node ${wanted} binary, e.g. \`$(brew --prefix node@${wanted})/bin/node scripts/ssr-smoke.mjs\`.`,
    );
    process.exit(2);
  }
}

const all = [];
console.log(`API unreachable (${API_DOWN}):`);
all.push(...(await pass('api-down', API_DOWN)));
if (api) {
  console.log(`\nAPI reachable (${api}):`);
  all.push(...(await pass('api-up', api)));
}

if (all.length) {
  console.log(`\nSSR smoke FAILED:\n  ${all.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('\nSSR smoke passed.');
}
