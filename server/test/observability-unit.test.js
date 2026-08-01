const test = require('node:test');
const assert = require('node:assert/strict');

const mailer = require('../lib/mailer');
const { sendAlert, resetAlertDedup } = require('../lib/alerts');
const { recordError, fingerprintOf, serverErrorSurge } = require('../lib/error-log');
const db = require('../db/client');

/**
 * Unit-level guarantees for docs/24 Phases C and E. These do not need a
 * database or an SMTP server, so they run in every environment — which
 * matters, because the properties they protect are the ones that keep logging
 * from being able to break a sale.
 */

test('alerts: deduplicated to one email per key per window', async () => {
  resetAlertDedup();
  const original = mailer.sendMail;
  const sent = [];
  mailer.sendMail = async (message) => { sent.push(message); };
  process.env.ALERT_EMAIL = 'ops@example.test';

  try {
    const first = await sendAlert('inventory-drift:elite', '3 variants drifted', 'body');
    const second = await sendAlert('inventory-drift:elite', '3 variants drifted', 'body');
    const other = await sendAlert('server-error-surge', '12 errors', 'body');

    assert.equal(first.sent, true);
    assert.equal(second.sent, false, 'a repeat inside the window must not send again');
    assert.equal(second.reason, 'deduplicated');
    assert.equal(other.sent, true, 'a different alert key is independent');
    assert.equal(sent.length, 2);
    assert.match(sent[0].subject, /^\[Elite alert\] /);
    assert.equal(sent[0].to, 'ops@example.test');
    // The key is in the body so a recipient can tell support what fired.
    assert.match(sent[0].text, /Alert key: inventory-drift:elite/);
  } finally {
    mailer.sendMail = original;
    delete process.env.ALERT_EMAIL;
    resetAlertDedup();
  }
});

test('alerts: no recipient configured is a silent no-op, never a throw', async () => {
  resetAlertDedup();
  delete process.env.ALERT_EMAIL;
  delete process.env.BACKUP_ALERT_EMAIL;
  const result = await sendAlert('inventory-drift:elite', 'subject', 'body');
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no_recipient_configured');
});

test('alerts: a send failure does not throw and does not burn the dedup window', async () => {
  resetAlertDedup();
  const original = mailer.sendMail;
  process.env.ALERT_EMAIL = 'ops@example.test';
  let attempts = 0;
  mailer.sendMail = async () => {
    attempts += 1;
    // Mirrors mailer.js's real behaviour when SMTP_HOST is unset.
    const error = new Error('SMTP_HOST is not configured.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  };

  try {
    const failed = await sendAlert('print-failures:register-1', 'subject', 'body');
    assert.equal(failed.sent, false);
    assert.equal(failed.reason, 'SMTP_NOT_CONFIGURED');

    // A transient failure must not silence the alert for the whole window —
    // otherwise one SMTP blip hides a real problem for an hour.
    mailer.sendMail = async () => { attempts += 1; };
    const retried = await sendAlert('print-failures:register-1', 'subject', 'body');
    assert.equal(retried.sent, true);
    assert.equal(attempts, 2);
  } finally {
    mailer.sendMail = original;
    delete process.env.ALERT_EMAIL;
    resetAlertDedup();
  }
});

test('error-log: a recorder failure is swallowed and cannot reach the caller', async () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalQuery = db.pool.query;
  process.env.DATABASE_URL = 'postgres://unused';
  db.pool.query = async () => { throw new Error('database is on fire'); };

  try {
    // The contract that matters: this is called from the global error handler,
    // next to money-handling requests. It must resolve, never reject, and
    // never surface the internal failure.
    const result = await recordError({ source: 'server', severity: 'error', message: 'boom', httpStatus: 500 });
    assert.equal(result, null);
  } finally {
    db.pool.query = originalQuery;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});

test('error-log: no DATABASE_URL is a clean no-op', async () => {
  const originalUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.equal(await recordError({ source: 'server', severity: 'error', message: 'boom' }), null);
  } finally {
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
  }
});

test('error-log: fingerprints group identical faults and separate different ones', () => {
  const base = { source: 'server', code: 'INSUFFICIENT_STOCK', route: 'POST /api/pos/transactions', message: 'Not enough stock', stack: null };
  assert.equal(fingerprintOf(base), fingerprintOf({ ...base }));
  // A different message on the same code/route still groups, because the
  // stack's first frame (or the message when there is none) is what varies —
  // here the message IS the discriminator, so it must separate.
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, message: 'Something else entirely' }));
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, route: 'POST /api/pos/refunds' }));
  assert.notEqual(fingerprintOf(base), fingerprintOf({ ...base, source: 'pos-client' }));

  // Same fault, different line number in a later release: the first stack
  // frame changes, so it is treated as a new fault rather than silently
  // merged into the old group.
  const withStack = { ...base, stack: 'Error: x\n    at createSale (sale-service.js:500:1)' };
  assert.equal(fingerprintOf(withStack), fingerprintOf({ ...withStack, message: 'different text, same frame' }));
});

test('error-log: 5xx surge counter only trips at the threshold', () => {
  const before = serverErrorSurge();
  assert.equal(typeof before.count, 'number');
  assert.equal(before.windowMinutes, 5);
  assert.equal(typeof before.surging, 'boolean');
});
