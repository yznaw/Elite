import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Services run in Node against the real @angular/core (signals, inject);
// window, fetch and timers are provided by the test.
globalThis.window = globalThis;
if (!globalThis.location) globalThis.location = { pathname: '/dashboard', hostname: 'localhost', protocol: 'http:' };
globalThis.addEventListener ??= () => {};

const bundle = await build({
  stdin: {
    contents: [
      "export { ToastService, MAX_VISIBLE_TOASTS, markToastShown, wasToastShown } from './projects/admin-portal/src/app/services/toast.service';",
      "export { ConnectivityService, NETWORK_TOAST_KEY } from './projects/admin-portal/src/app/services/connectivity.service';",
      "export { httpErrorInterceptor } from './projects/admin-portal/src/app/interceptors/http-error.interceptor';",
      "export { ApiClient } from './projects/admin-portal/src/app/services/api-client.service';",
      "export { I18nService } from './projects/admin-portal/src/app/services/i18n.service';",
      "export { ClientLoggerService } from './projects/admin-portal/src/app/services/client-logger.service';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20',
  external: ['@angular/*', 'rxjs', 'rxjs/*'],
  tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
});
const bundlePath = fileURLToPath(new URL('./.toast-notifications.bundle.mjs', import.meta.url));
writeFileSync(bundlePath, bundle.outputFiles[0].text);
// JIT support for the Angular classes @angular/common/http declares.
await import('@angular/compiler');
let m;
try { m = await import(bundlePath); } finally { rmSync(bundlePath, { force: true }); }
const { Injector, runInInjectionContext } = await import('@angular/core');
const { Router } = await import('@angular/router');
const { HttpErrorResponse, HttpRequest, HttpResponse } = await import('@angular/common/http');
const { firstValueFrom, of, throwError } = await import('rxjs');

let toast;
let probes;
let injector;
function setup() {
  toast = new m.ToastService();
  probes = 0;
  injector = Injector.create({
    providers: [
      { provide: m.ToastService, useValue: toast },
      { provide: m.I18nService, useValue: { t: (k) => k } },
      { provide: m.ApiClient, useValue: { url: (p) => `http://api.test/api${p}` } },
      { provide: m.ClientLoggerService, useValue: { log() {}, isSuspended: () => true } },
      { provide: Router, useValue: { url: '/dashboard', navigate: async () => true } },
    ],
  });
  const connectivity = runInInjectionContext(injector, () => new m.ConnectivityService());
  return { connectivity, injector: Injector.create({ providers: [{ provide: m.ConnectivityService, useValue: connectivity }], parent: injector }) };
}

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
});

test('the same message collapses into one toast with a count', () => {
  setup();
  for (let i = 0; i < 5; i++) toast.error('Server error', 'Try again');
  assert.equal(toast.items().length, 1);
  assert.equal(toast.items()[0].count, 5);
});

test('no more than three toasts are visible; the oldest self-dismissing one goes', () => {
  setup();
  const pinned = toast.push({ title: 'Receipt not printed', kind: 'warning', duration: null });
  ['A', 'B', 'C'].forEach((title) => toast.info(title));
  assert.equal(toast.items().length, m.MAX_VISIBLE_TOASTS);
  assert.ok(toast.items().some((t) => t.id === pinned), 'a persistent toast is not the one dropped');
  assert.deepEqual(toast.items().map((t) => t.title), ['Receipt not printed', 'B', 'C']);
});

test('errors leave on their own after 8 s, and hovering holds them', () => {
  setup();
  const id = toast.error('Server error');
  mock.timers.tick(5000);
  toast.pause(id);
  mock.timers.tick(60000);
  assert.equal(toast.items().length, 1, 'paused while being read');
  toast.resume(id);
  mock.timers.tick(2999);
  assert.equal(toast.items().length, 1);
  mock.timers.tick(1);
  assert.equal(toast.items().length, 0);
});

test('errorFrom stays quiet when the global message already covered that error', () => {
  setup();
  const shown = new Error('covered');
  m.markToastShown(shown);
  assert.equal(toast.errorFrom(shown, "Couldn't load report"), null);
  assert.equal(toast.items().length, 0);
  assert.notEqual(toast.errorFrom(new Error('not covered'), "Couldn't read the file"), null);
  assert.equal(toast.items().length, 1);
});

test('ten failed requests during an outage give one message, and it clears itself', async () => {
  const { injector: withConnectivity } = setup();
  let reachable = false;
  globalThis.fetch = async () => { probes++; if (!reachable) throw new TypeError('offline'); return { ok: true }; };

  const failing = () => throwError(() => new HttpErrorResponse({ status: 0, url: 'http://api.test/api/admin/orders' }));
  const errors = await Promise.all(Array.from({ length: 10 }, () => runInInjectionContext(withConnectivity, () =>
    firstValueFrom(m.httpErrorInterceptor(new HttpRequest('GET', 'http://api.test/api/admin/orders'), failing)).catch((e) => e))));

  assert.equal(toast.items().length, 1);
  assert.equal(toast.items()[0].key, m.NETWORK_TOAST_KEY);
  assert.equal(toast.items()[0].duration, null, 'stays while offline');
  assert.ok(errors.every((e) => m.wasToastShown(e)), 'pages see these as already reported');
  assert.equal(toast.errorFrom(errors[0], "Couldn't load orders"), null, 'no second, page-level toast');

  // Retry really probes now (it used to do nothing).
  await toast.items()[0].action.run();
  assert.equal(probes, 1);
  assert.equal(toast.items()[0].key, m.NETWORK_TOAST_KEY, 'still offline, still one message');
  assert.equal(toast.items()[0].action.keepOpen, true, 'pressing Try now does not close the message');

  // One failed attempt already, so the next probe backs off to 5 s.
  reachable = true;
  mock.timers.tick(4999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes, 1, 'backoff respected');
  mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(toast.items().map((t) => [t.kind, t.title]), [['success', 'error.network.back']]);
  mock.timers.tick(3000);
  assert.equal(toast.items().length, 0);
});

test('a successful response also ends the outage; a 5xx burst is one message without a fake Retry', async () => {
  const { connectivity, injector: withConnectivity } = setup();
  connectivity.reportFailure();
  const ok = () => of(new HttpResponse({ status: 200, body: {} }));
  await runInInjectionContext(withConnectivity, () => firstValueFrom(m.httpErrorInterceptor(new HttpRequest('GET', 'http://api.test/api/admin/x'), ok)));
  assert.equal(connectivity.online(), true);
  toast.clear();

  const serverError = () => throwError(() => new HttpErrorResponse({ status: 503, url: 'http://api.test/api/admin/x' }));
  for (let i = 0; i < 6; i++) {
    await runInInjectionContext(withConnectivity, () =>
      firstValueFrom(m.httpErrorInterceptor(new HttpRequest('GET', 'http://api.test/api/admin/x'), serverError)).catch(() => null));
  }
  assert.equal(toast.items().length, 1);
  assert.equal(toast.items()[0].count, 6);
  assert.equal(toast.items()[0].action, undefined);
});

test('a 422 shows the server field problems instead of "Validation failed."', async () => {
  const { injector: withConnectivity } = setup();
  const invalid = () => throwError(() => new HttpErrorResponse({
    status: 422, url: 'http://api.test/api/admin/products',
    error: { message: 'Validation failed.', errors: ['SKU is required.', 'Brand is required.'] },
  }));
  await runInInjectionContext(withConnectivity, () =>
    firstValueFrom(m.httpErrorInterceptor(new HttpRequest('POST', 'http://api.test/api/admin/products', {}), invalid)).catch(() => null));
  assert.equal(toast.items()[0].sub, 'SKU is required. Brand is required.');
});
