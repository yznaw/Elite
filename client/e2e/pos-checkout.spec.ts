import { expect, test, type Page } from '@playwright/test';

/**
 * The browser release gate (docs/25 Phase 3).
 *
 * This suite was red from 13 July 2026 until this rewrite: it clicked a product
 * tile and expected the item in the cart, but the UI has required the variant
 * picker (colour, then size, then Add to cart) since commit 224c72a, so it timed
 * out with **Take payment** disabled. Every change to checkout since then landed
 * with no browser coverage at all.
 *
 * What it now protects, in order of how much money a regression would cost:
 *   1. an online sale actually completes through the real picker;
 *   2. an offline sale syncs to **exactly one** server transaction;
 *   3. a network failure after the server already committed still resolves to
 *      one transaction, not two;
 *   4. walk-in stays the zero-tap default, and a linked customer reaches the
 *      sale.
 */

const PRODUCT = 'POS Browser Product';
const API = 'http://127.0.0.1:3000/api';

/** Drives the real picker: colour, then size, then add. */
async function addToCart(page: Page, color: string, size: string) {
  await page.getByRole('button', { name: new RegExp(PRODUCT) }).click();
  await expect(page.getByText('SELECT VARIANT')).toBeVisible();

  // Scoped to the picker and matched on the accessible name. `hasText` matches
  // concatenated text content — a size tile reads "MIn stockQAR 25.00" with no
  // separators, so `^M\b` never matches there. The accessible name keeps the
  // spaces ("M In stock QAR 25.00"), which is both readable and stable.
  const picker = page.locator('.variant-picker');
  await picker.getByRole('button', { name: color, exact: true }).click();
  await picker.getByRole('button', { name: new RegExp(`^${size}\\b`) }).click();

  await page.getByRole('button', { name: /^Add to cart · / }).click();
  await expect(page.locator('.variant-picker')).toBeHidden();
}

async function completeSale(page: Page) {
  await page.getByRole('button', { name: /Take payment/ }).click();
  await page.getByRole('button', { name: 'Complete sale' }).click();
}

async function signInAndOpenShift(page: Page, registerName: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('browser-pos@elite.local');
  await page.getByLabel('Password').fill('browser-pos-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/pos');

  // Enrolment and shift-open are unconditional, not "if visible". Each test gets
  // a fresh browser context, so IndexedDB (the register credential) and the
  // session cookie both start empty — a newly enrolled register never has an
  // open shift either. Conditional steps also hid a real failure here: the POS
  // opens in a loading phase while it checks for a register, and `isVisible()`
  // does not wait, so the check ran against a screen that had not rendered yet
  // and silently skipped enrolment.
  //
  // The setup screen opens on the "I have a token" tab (a real tablist, so
  // role=tab), and the terminal-name field lives under the other tab.
  await page.getByRole('tab', { name: 'Set up a new register' }).click();
  // A distinct name per test: pos_registers has UNIQUE (tenant_id,
  // display_name), so reusing one makes the second test fail at enrolment.
  await page.getByPlaceholder('Main counter').fill(registerName);
  await page.getByRole('button', { name: 'Connect register' }).click();

  await expect(page.getByRole('heading', { name: 'Open a cashier shift' })).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Opening cash').fill('50.00');
  await page.getByRole('button', { name: 'Open shift' }).click();

  await expect(page.getByRole('button', { name: new RegExp(PRODUCT) })).toBeVisible({ timeout: 20000 });
}

/**
 * Counts this register's transactions straight from the API, using the page's
 * own authenticated session. Asserting against the server is the point: the UI
 * showing "SALE COMPLETE" says nothing about how many rows were written.
 */
async function countTransactions(page: Page): Promise<number> {
  return page.evaluate(async (api) => {
    const response = await fetch(`${api}/pos/shifts/current`, { credentials: 'include' });
    if (!response.ok) throw new Error(`shift summary failed: ${response.status}`);
    const body = await response.json();
    return body.data.transactionCount as number;
  }, API);
}

test.describe.configure({ mode: 'serial' });

test.describe('POS browser checkout', () => {
  test('online sale, offline sale, and a single reconciled transaction', async ({ page, context }) => {
    const failures: string[] = [];
    page.on('response', (response) => {
      // Two expected rejections are not failures: the 401 from `/auth/me`
      // before sign-in (the guard's "am I logged in?" probe) and the 428 from
      // the register probe before enrolment. Everything else is noise worth
      // failing on — a silent 500 during checkout would otherwise pass.
      const expected = (response.status() === 401 && response.url().endsWith('/api/auth/me'))
        || response.status() === 428;
      if (response.status() >= 400 && !expected) {
        failures.push(`HTTP ${response.status()} ${response.url()}`);
      }
    });

    await signInAndOpenShift(page, 'E2E Register A');
    const before = await countTransactions(page);

    // ── An online sale through the real picker ────────────────────────────
    await addToCart(page, 'Onyx', 'M');
    await completeSale(page);
    await expect(page.getByText('SALE COMPLETE')).toBeVisible();
    await expect(page.getByText('Saved in Elite.')).toBeVisible();
    await page.getByRole('button', { name: 'New sale' }).click();

    // A different colour and size: proves both picker steps are real and that
    // the cart keys on the variant, not on the product.
    await addToCart(page, 'Sand', 'L');
    await completeSale(page);
    await expect(page.getByText('SALE COMPLETE')).toBeVisible();
    await page.getByRole('button', { name: 'New sale' }).click();

    // ── An offline sale ───────────────────────────────────────────────────
    await context.setOffline(true);
    await addToCart(page, 'Onyx', 'L');
    await completeSale(page);
    await expect(page.getByText('Saved offline and waiting to synchronize.')).toBeVisible();
    await page.getByRole('button', { name: 'New sale' }).click();

    // ── Reconnect and drain the queue ─────────────────────────────────────
    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Queue 0' })).toBeVisible({ timeout: 30000 });

    // The assertion that actually matters: three sales were rung up, so the
    // server must hold exactly three more transactions. A double-sync, or a
    // retry that lost its idempotency key, would show up here as four.
    expect(await countTransactions(page)).toBe(before + 3);

    expect(failures, `unexpected HTTP failures: ${failures.join(', ')}`).toEqual([]);
  });

  test('a network failure after the server commits still yields one transaction', async ({ page, context }) => {
    await signInAndOpenShift(page, 'E2E Register B');
    const before = await countTransactions(page);

    // The dangerous case: the server commits the sale, then the response never
    // reaches the browser. The client cannot tell that apart from "never
    // arrived", so it falls back to the offline queue **with the same
    // idempotency key** — and the server must recognise the replay rather than
    // charging the customer twice.
    await context.route('**/api/pos/transactions', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      // Let it reach the server, then drop the response on the floor.
      await route.fetch().catch(() => undefined);
      await route.abort('failed');
    });

    await addToCart(page, 'Sand', 'M');
    await completeSale(page);
    // `.first()`: the receipt modal shows both the "SALE COMPLETE" header and
    // the offline note, so the alternation legitimately matches two nodes.
    // Either outcome is acceptable here — what matters is the count below.
    await expect(page.getByText(/Saved offline and waiting to synchronize\.|SALE COMPLETE/).first()).toBeVisible();
    await page.getByRole('button', { name: 'New sale' }).click();

    await context.unroute('**/api/pos/transactions');
    await expect(page.getByRole('button', { name: 'Queue 0' })).toBeVisible({ timeout: 30000 });

    expect(
      await countTransactions(page),
      'the committed sale plus its queued replay must reconcile to one transaction',
    ).toBe(before + 1);
  });

  test('walk-in is the default and a customer can be linked', async ({ page }) => {
    await signInAndOpenShift(page, 'E2E Register C');

    await addToCart(page, 'Onyx', 'M');
    await page.getByRole('button', { name: /Take payment/ }).click();

    // Walk-in costs zero taps: the payment action is reachable immediately with
    // no customer chosen. A queue at the till must never wait on data entry
    // (docs/25 Phase 5).
    await expect(page.getByPlaceholder('Phone, name, or email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete sale' })).toBeEnabled();

    // Linking: the search finds nothing, so the cashier creates the customer.
    const phone = `+974 5555${Date.now().toString().slice(-4)}`;
    await page.getByPlaceholder('Phone, name, or email').fill(phone);
    await page.getByRole('button', { name: 'Add as a new customer' }).click();
    await page.getByPlaceholder('Customer name').fill('Browser E2E Customer');
    await page.getByRole('button', { name: 'Save customer' }).click();
    // Scoped to the payment sheet: the name also appears in the success toast,
    // and a toast proves the request succeeded, not that the sale carries the
    // customer. The linked block is the thing that matters.
    await expect(page.locator('.customer-linked')).toContainText('Browser E2E Customer');

    await page.getByRole('button', { name: 'Complete sale' }).click();
    await expect(page.getByText('SALE COMPLETE')).toBeVisible();
  });

  test('a catalog older than 12 hours blocks offline payment', async ({ page, context }) => {
    await signInAndOpenShift(page, 'E2E Register D');

    // Load /pos as a real navigation once so the service worker has the POS
    // document shell, then age only the cached catalogue. The register and
    // open shift remain valid local state for the cold-offline restart below.
    // POS keeps a deliberate long-lived SSE connection open, so
    // `networkidle` is not a reachable state while online. The product
    // assertion below is the meaningful readiness gate after navigation.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: new RegExp(PRODUCT) })).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('elite-pos');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('settings', 'readwrite');
        const store = transaction.objectStore('settings');
        const request = store.get('catalog');
        request.onsuccess = () => {
          store.put({
            ...request.result,
            cachedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
          }, 'catalog');
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Offline selling is blocked until prices and stock are refreshed online.')).toBeVisible();

    await addToCart(page, 'Onyx', 'M');
    await expect(page.getByRole('button', { name: /Take payment/ })).toBeDisabled();

    await context.setOffline(false);
  });

  test('a previous-business-day shift is blocked for manager recovery', async ({ page }) => {
    await signInAndOpenShift(page, 'E2E Register E');

    await page.route('**/api/pos/registers/current', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.shift.openedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await route.fulfill({ response, json: body });
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Resolve the previous shift' })).toBeVisible();
    await expect(page.getByText('A shift from a previous business day is still open.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Take payment/ })).toHaveCount(0);
  });

  test('a shift belonging to another cashier cannot be resumed', async ({ page }) => {
    await signInAndOpenShift(page, 'E2E Register F');

    await page.route('**/api/pos/registers/current', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.shift.cashierId = '00000000-0000-4000-8000-000000000001';
      body.data.shift.cashierName = 'Previous Cashier';
      await route.fulfill({ response, json: body });
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Resolve the previous shift' })).toBeVisible();
    await expect(page.getByText(/still has a shift belonging to Previous Cashier/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Take payment/ })).toHaveCount(0);
  });

  test('an enrolled register falls back offline when the API is unreachable despite Wi-Fi', async ({ page, context }) => {
    await signInAndOpenShift(page, 'E2E Register G');

    // Abort only the register probes. The browser remains logically online,
    // reproducing the shop failure where Wi-Fi is connected but the API/DNS
    // path is down. The cached register, open shift, catalogue and receipt
    // block must win over the one-time enrollment screen.
    await context.route('**/api/pos/registers/current', (route) => route.abort('failed'));
    await context.route('**/api/pos/registers/check-in', (route) => route.abort('failed'));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Offline mode: sales are receipted locally and queued for synchronization.')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(PRODUCT) })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect this counter to Elite.' })).toHaveCount(0);
  });

  test('configured hardware keeps retrying when QZ or the printer is unavailable', async ({ page }) => {
    await signInAndOpenShift(page, 'E2E Register H');
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('elite-pos');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('settings', 'readwrite');
        transaction.objectStore('settings').put({
          printerName: 'E2E unavailable receipt printer',
          deviceSignerUrl: 'http://127.0.0.1:65534',
          drawerPulse: 'disabled',
        }, 'hardware');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    });

    const reconnectMessages: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('[pos-hardware] QZ Tray reconnect scheduled')) {
        reconnectMessages.push(message.text());
      }
    });
    const durableLogUpload = page.waitForResponse((response) => (
      response.url().endsWith('/api/client-logs')
      && response.request().method() === 'POST'
      && response.status() === 200
    ), { timeout: 30000 });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect.poll(
      () => reconnectMessages.length,
      { timeout: 25000, message: 'hardware supervisor should make a second attempt without a page reload' },
    ).toBeGreaterThanOrEqual(2);
    await durableLogUpload;
    await expect(page.getByRole('button', { name: /Hardware/ }).locator('i')).not.toHaveClass(/ready/);
  });
});
