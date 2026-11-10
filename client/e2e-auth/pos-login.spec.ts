import { expect, test, type Page } from '@playwright/test';
import type { AuthUser, UserRole } from '../projects/admin-portal/src/app/services/auth.service';
import type { PosCurrentRegister } from '../projects/admin-portal/src/app/services/pos.service';

const user: AuthUser = {
  id: 'user-a', name: 'Test Cashier', initials: 'TC', email: 'cashier@example.invalid',
  role: 'cashier', tenantId: 'tenant-a', tenantSlug: 'test',
};
const identity = { registerId: 'register-a', displayName: 'Test counter', registerCredential: 'test-credential' };
const block = { blockId: 'block-a', start: 1, end: 100, next: 5, allocatedAt: '2026-09-05T00:00:00Z' };
const queuedSale = {
  registerId: identity.registerId, idempotencyKey: 'preserve-sale', shiftId: 'shift-old', receiptNumber: 4,
  status: 'pending', attempts: 0, queuedAt: '2026-09-05T00:00:00Z',
  payload: {}, receiptData: {}, lastError: '',
};
const parkedCart = {
  parkedCartId: 'preserve-cart', label: 'Saved cart', payload: { items: [] },
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z', local: true,
};
type ApiError = { status: number; code?: string };
type Scenario = {
  signedIn: boolean;
  bound: boolean;
  role: UserRole;
  cachedRole: UserRole | null;
  storedRegister: boolean;
  currentError: ApiError | null;
  checkError: ApiError | null;
  authNetworkError: boolean;
  registerNetworkError: boolean;
  cachedShift: boolean;
  shift: PosCurrentRegister['shift'];
};

async function prepare(page: Page, options: Partial<Scenario> = {}) {
  const state: Scenario = {
    signedIn: true, bound: false, role: 'cashier', cachedRole: 'cashier',
    storedRegister: true, currentError: null, checkError: null,
    authNetworkError: false, registerNetworkError: false, cachedShift: false, shift: null,
    ...options,
  };
  const calls: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    calls.push(pathname);
    const reply = (status: number, body: unknown) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    const ok = (data: unknown) => reply(200, { success: true, data });
    const fail = ({ status, code }: ApiError) => reply(status, { success: false, code, message: code || 'Authentication required.' });
    if (pathname === '/api/auth/me') {
      if (state.authNetworkError) return route.abort('failed');
      return state.signedIn ? ok({ ...user, role: state.role }) : fail({ status: 401 });
    }
    if (pathname === '/api/auth/login') { state.signedIn = true; return ok({ ...user, role: state.role }); }
    if (pathname === '/api/auth/logout') { state.signedIn = false; state.bound = false; return ok({ success: true }); }
    if (pathname === '/api/client-logs') return ok({ accepted: 1 });
    if (pathname === '/api/admin/orders') return ok({ orders: [], total: 0, page: 1, limit: 50, pages: 0 });
    if (pathname === '/api/admin/products' || pathname === '/api/admin/customers') return ok([]);
    if (pathname === '/api/pos/registers/current') {
      if (state.registerNetworkError) return route.abort('failed');
      if (state.currentError) {
        if (state.currentError.status === 401) state.signedIn = false;
        return fail(state.currentError);
      }
      if (!state.signedIn) return fail({ status: 401 });
      if (!state.bound) return fail({ status: 428, code: 'REGISTER_REQUIRED' });
      return ok({ ...identity, status: 'active', branchName: null, managerPinConfigured: true, shift: state.shift });
    }
    if (pathname === '/api/pos/registers/check-in') {
      if (state.checkError) {
        if (state.checkError.status === 401 && !state.checkError.code) state.signedIn = false;
        return fail(state.checkError);
      }
      state.bound = true;
      return ok(identity);
    }
    if (pathname === '/api/pos/registers') return ok({ registers: [{ ...identity, lastSeenAt: null, openShiftId: null, openShiftCashier: null }] });
    if (pathname === '/api/pos/registers/claim') {
      state.bound = true; state.checkError = null;
      return ok({ ...identity, registerCredential: 'replacement-credential' });
    }
    if (pathname === '/api/pos/registers/receipt-number-blocks') return ok(block);
    if (pathname === '/api/pos/products/search') return ok({ products: [], total: 0, page: 0, pages: 0, limit: 50 });
    if (pathname === '/api/pos/products/filters') return ok({ sizes: [], colors: [] });
    if (pathname === '/api/pos/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' });
    if (pathname === '/api/pos/parked-carts' || pathname.includes('/reference/')) return ok([]);
    return ok({});
  });

  // Seed storage on this origin without bootstrapping Angular or racing a
  // login probe. The next navigation loads the real application normally.
  await page.route('**/__auth-test-setup', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Setup</title>' }));
  await page.goto('/__auth-test-setup');
  await page.evaluate(async ({ state, user, identity, block, queuedSale, parkedCart }) => {
    if (state.cachedRole) localStorage.setItem('elite-admin:auth-user', JSON.stringify({ ...user, role: state.cachedRole }));
    if (!state.storedRegister) return;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elite-pos', 4);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('settings');
        request.result.createObjectStore('pending-sales', { keyPath: 'idempotencyKey' });
        request.result.createObjectStore('parked-carts', { keyPath: 'parkedCartId' });
        request.result.createObjectStore('pos-queue-journal', { keyPath: 'id', autoIncrement: true })
          .createIndex('idempotencyKey', 'idempotencyKey');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['settings', 'pending-sales', 'parked-carts'], 'readwrite');
      const settings = tx.objectStore('settings');
      settings.put(identity, 'register');
      settings.put(block, 'receipt-block');
      if (state.cachedShift) {
        settings.put({ shiftId: 'shift-a', registerId: identity.registerId, cashierId: user.id, openingFloatCents: 5000, openedAt: new Date().toISOString() }, 'shift');
        settings.put({ products: [], cachedAt: new Date().toISOString() }, 'catalog');
      }
      tx.objectStore('pending-sales').put(queuedSale);
      tx.objectStore('parked-carts').put(parkedCart);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { state, user, identity, block, queuedSale, parkedCart });
  return { state, calls, pageErrors };
}

async function readStoredData(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elite-pos', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store: string, key: string) => new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return {
        identity: await read('settings', 'register'), block: await read('settings', 'receipt-block'),
        sale: await read('pending-sales', 'preserve-sale'), cart: await read('parked-carts', 'preserve-cart'),
      };
    } finally { db.close(); }
  });
}

async function expectPos(page: Page, heading: string) {
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByText('Session expired', { exact: true })).toHaveCount(0);
}

test('rejected device stops at the picker, preserves local work, and can be reclaimed', async ({ page }) => {
  const { calls, pageErrors } = await prepare(page, { checkError: { status: 401, code: 'REGISTER_CREDENTIAL_INVALID' } });
  await page.goto('/pos');
  await expectPos(page, 'Which till is this?');
  // Observe long enough to detect the original automatic navigation cycle.
  await page.waitForTimeout(1000);
  await expectPos(page, 'Which till is this?');
  expect(calls.filter(path => path.endsWith('/check-in'))).toHaveLength(1);
  // The server has disowned this device: its stale identity is dropped so
  // every reload lands on the picker instead of repeating the same rejected
  // check-in, but queued sales and parked carts are untouched.
  expect(await readStoredData(page)).toEqual({ identity: undefined, block, sale: queuedSale, cart: parkedCart });
  await page.getByRole('button', { name: /Test counter/ }).click();
  await expectPos(page, 'Open a cashier shift');
  expect(await readStoredData(page)).toEqual({ identity: { ...identity, registerCredential: 'replacement-credential' }, block, sale: queuedSale, cart: parkedCart });
  expect(calls.filter(path => path.endsWith('/claim'))).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('logout and login restore a known device without claiming it again', async ({ page }) => {
  const { state, calls } = await prepare(page, { bound: true });
  await page.goto('/dashboard');
  await page.locator('.avatar-btn').click();
  await page.locator('.user-drop-logout').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.signedIn).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('elite-admin:auth-user'))).toBeNull();
  expect(await readStoredData(page)).toEqual({ identity, block, sale: queuedSale, cart: parkedCart });
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectPos(page, 'Open a cashier shift');
  expect(calls.filter(path => path.endsWith('/check-in'))).toHaveLength(1);
  expect(calls.filter(path => path.endsWith('/claim'))).toHaveLength(0);
});

test('real session expiry during currentError still requests login', async ({ page }) => {
  await prepare(page, { currentError: { status: 401 } });
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fpos$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await readStoredData(page)).identity).toEqual(identity);
});

test('a plain 401 on check-in offers recovery instead of an auto-redirect loop', async ({ page }) => {
  // check-in is a register-binding route: a genuine session expiry there still
  // reaches the operator, but through the picker's own recovery screen rather
  // than an interceptor-driven /login redirect, which is what looped forever
  // against a still-authenticated session (docs/12-pos-system.md).
  const { calls } = await prepare(page, { checkError: { status: 401 } });
  await page.goto('/pos');
  await expectPos(page, 'Could not open this register');
  expect(calls.filter(path => path.endsWith('/check-in'))).toHaveLength(1);
  expect((await readStoredData(page)).identity).toEqual(identity);
});

test('valid session without cached user opens POS on the first navigation', async ({ page }) => {
  const { calls } = await prepare(page, { cachedRole: null, storedRegister: false });
  await page.goto('/pos');
  await expectPos(page, 'Which till is this?');
  expect(calls.filter(path => path === '/api/auth/me')).toHaveLength(1);
  expect(calls.filter(path => path.endsWith('/check-in'))).toHaveLength(0);
});

test('authorized server role replaces a stale denied cached role', async ({ page }) => {
  await prepare(page, { cachedRole: 'viewer', role: 'cashier' });
  await page.goto('/pos');
  await expectPos(page, 'Open a cashier shift');
});

test('denied server role overrides a stale authorized cached role', async ({ page }) => {
  const { calls } = await prepare(page, { cachedRole: 'owner', role: 'viewer' });
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(calls.some(path => path.startsWith('/api/pos/'))).toBe(false);
});

test('expired session overrides cached access before opening POS', async ({ page }) => {
  const { calls } = await prepare(page, { signedIn: false, cachedRole: 'owner' });
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fpos$/);
  expect(calls.some(path => path.startsWith('/api/pos/'))).toBe(false);
});

test('API outage can resume a cached authorized POS user and shift', async ({ page }) => {
  const { calls } = await prepare(page, { authNetworkError: true, registerNetworkError: true, cachedShift: true });
  await page.goto('/pos');
  await expect(page.locator('.pos-shell.is-selling')).toBeVisible();
  await expect(page.locator('.network')).toHaveText('Offline');
  expect(calls.filter(path => path.endsWith('/check-in'))).toHaveLength(0);
});

test('API outage without cached user still requires login', async ({ page }) => {
  const { calls } = await prepare(page, { authNetworkError: true, cachedRole: null });
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fpos$/);
  expect(calls.some(path => path.startsWith('/api/pos/'))).toBe(false);
});

test('browser offline flag resumes cached POS without probing the session', async ({ page }) => {
  const { calls } = await prepare(page, { cachedShift: true, registerNetworkError: true });
  // Keep the local test document reachable, while exercising the guard's
  // navigator.onLine=false path independently of API network failures.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.goto('/pos');
  await expect(page.locator('.pos-shell.is-selling')).toBeVisible();
  expect(calls.filter(path => path === '/api/auth/me')).toHaveLength(0);
  await expect(page.locator('.network')).toHaveText('Offline');
});

test('an outage does not grant POS access to a cached viewer', async ({ page }) => {
  const { calls } = await prepare(page, { authNetworkError: true, cachedRole: 'viewer' });
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard$/);
  expect(calls.some(path => path.startsWith('/api/pos/'))).toBe(false);
});

test('REGISTER_DISABLED sends a disowned device back to the picker', async ({ page }) => {
  await prepare(page, { checkError: { status: 403, code: 'REGISTER_DISABLED' } });
  await page.goto('/pos');
  await expectPos(page, 'Which till is this?');
  expect((await readStoredData(page)).identity).toBeUndefined();
});

test('SERVER_ERROR offers recovery without clearing the identity', async ({ page }) => {
  await prepare(page, { checkError: { status: 500, code: 'SERVER_ERROR' } });
  await page.goto('/pos');
  await expectPos(page, 'Could not open this register');
  expect((await readStoredData(page)).identity).toEqual(identity);
});

test('restoring a device still blocks selling in another employee\'s shift', async ({ page }) => {
  await prepare(page, { bound: true, shift: {
    id: 'shift-a', state: 'open', cashierId: 'other-user', cashierName: 'Other Cashier',
    openingFloatCents: 5000, openedAt: new Date().toISOString(),
  } });
  await page.goto('/pos');
  await expectPos(page, 'Resolve the previous shift');
  await expect(page.locator('.pos-shell.is-selling')).toHaveCount(0);
});

test('child role guard still denies cashier access to settings', async ({ page }) => {
  await prepare(page, { cachedRole: 'owner', role: 'cashier' });
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/dashboard$/);
});
