const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');

// Exercise the real middleware without bootstrapping a database or jobs.
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/cors_test';
process.env.SESSION_SECRET = 'cors-regression-test-session-secret';
process.env.LOG_LEVEL = 'silent';
process.env.SMTP_HOST = '';
process.env.ALERT_EMAIL = '';
process.env.BACKUP_ALERT_EMAIL = '';
process.env.SADAD_ENDPOINT = 'https://sadadqa.com/webpurchase';
process.env.SADAD_CORS_ORIGINS = '';
process.env.UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

async function serve(t, nodeEnv, origins) {
  process.env.NODE_ENV = nodeEnv;
  process.env.CORS_ORIGINS = origins;
  delete require.cache[require.resolve('../index')];
  const { app } = require('../index');
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/api/products`;
}

async function preflight(url, origin) {
  return fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token',
    },
  });
}

async function assertAllowed(url, origin) {
  const response = await preflight(url, origin);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-headers'), /x-csrf-token/);
}

async function assertDenied(response) {
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'CORS_ORIGIN_DENIED');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
}

test('CORS keeps explicit production origins and treats denied origins as client errors', async (t) => {
  const db = require('../db/client');
  const { logger } = require('../lib/logger');
  const { serverErrorSurge } = require('../lib/error-log');
  const query = t.mock.method(db.pool, 'query', async () => ({ rows: [] }));
  const connect = t.mock.method(db.pool, 'connect', async () => {
    throw new Error('CORS checks must not access the database');
  });
  const warning = t.mock.method(logger, 'warn', () => {});
  const error = t.mock.method(logger, 'error', () => {});
  t.after(() => db.pool.end());

  await t.test('the public site is allowed; localhost and unlisted sites are denied', async (t) => {
    const url = await serve(t, 'production', 'https://elitecollections.qa, https://www.elitecollections.qa,https://admin.elitecollections.qa');
    for (const origin of ['https://elitecollections.qa', 'https://www.elitecollections.qa', 'https://admin.elitecollections.qa', 'https://sadadqa.com', 'https://payment.sadadqa.com']) {
      await assertAllowed(url, origin);
    }
    for (const origin of ['http://localhost:5173', 'https://elitecollections.qa.evil.example', 'https://payment.sadadqa.com.evil.example', 'null']) {
      await assertDenied(await preflight(url, origin));
    }
    await assertDenied(await fetch(url, { headers: { Origin: 'http://localhost:5173' } }));
  });

  await t.test('the SADAD payment host reaches callback signature validation, including with a CSRF cookie', async (t) => {
    const url = await serve(t, 'production', 'https://elitecollections.qa');
    t.mock.method(console, 'warn', () => {});
    for (const cookie of ['', 'elite.csrf=diagnostic-test-token']) {
      const response = await fetch(new URL('/api/payments/sadad/callback', url), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: 'https://payment.sadadqa.com',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: 'checksumhash=invalid',
      });
      assert.equal(response.status, 302);
      assert.equal(new URL(response.headers.get('location')).pathname, '/checkout/failure');
      assert.equal(new URL(response.headers.get('location')).searchParams.get('reason'), 'invalid_signature');
    }
  });

  await t.test('production can opt in to one exact local origin', async (t) => {
    const url = await serve(t, 'production', 'https://elitecollections.qa,http://localhost:5173');
    await assertAllowed(url, 'http://localhost:5173');
    await assertDenied(await preflight(url, 'http://localhost:5174'));
  });

  await t.test('development still accepts local clients on arbitrary ports', async (t) => {
    const url = await serve(t, 'development', '');
    await assertAllowed(url, 'http://localhost:5173');
    await assertAllowed(url, 'http://127.0.0.1:5173');
    await assertDenied(await preflight(url, 'https://untrusted.example'));
  });

  assert.equal(query.mock.callCount(), 0, 'denied public origins must not create server error records');
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(serverErrorSurge().count, 0, 'denied origins must not trigger server error surge alerts');
  assert.equal(error.mock.callCount(), 0);
  assert.equal(warning.mock.callCount(), 7);
  for (const call of warning.mock.calls) {
    assert.equal(call.arguments[0].status, 403);
    assert.ok(call.arguments[0].requestId);
  }
});
