const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `obs-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Observability E2E';
process.env.DEFAULT_ADMIN_EMAIL = `obs-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'obs-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Observability Test Owner';
process.env.SESSION_SECRET = `obs-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer, app } = require('../index');
const { recordError, fingerprintOf } = require('../lib/error-log');

/**
 * Covers docs/24-logging-observability-plan.md Phases A, C, D, F and G.
 *
 * The properties under test are the ones that make the difference between
 * "logging exists" and "an incident in the shop is diagnosable": one
 * correlation id shared by the response, the audit row and the error row;
 * duplicate faults grouping instead of flooding; client-side errors actually
 * arriving; secrets never landing in the database; and the health endpoint
 * telling the truth about the database.
 */
test('observability: correlation id, error grouping, client logs, health, response hygiene', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for the observability E2E.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function raw(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { response, body };
  }

  async function api(path, options = {}) {
    const { response, body } = await raw(path, options);
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body?.message}`), { response, body });
    return body.data;
  }

  /**
   * Error recording is deliberately fire-and-forget (docs/24 D3: it must never
   * be able to delay or fail the response), so the row lands shortly after the
   * client has already received its answer. Polling asserts the outcome without baking a fixed
   * sleep into the suite.
   */
  async function pollForRow(sql, params, attempts = 40) {
    let result = { rowCount: 0, rows: [] };
    for (let attempt = 0; attempt < attempts && result.rowCount === 0; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      result = await db.query(sql, params);
      // eslint-disable-next-line no-await-in-loop
      if (result.rowCount === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return result;
  }

  try {
    // ── Phase A: correlation id on every response ────────────────────────────
    const health = await raw('/health');
    assert.match(health.response.headers.get('x-request-id') || '', /^[0-9a-f]{12}$/);

    // A well-formed inbound id is honoured, so a proxy or the client shipper
    // can carry its own id through instead of a second unrelated one.
    const passthrough = await raw('/health', { headers: { 'x-request-id': 'inbound-trace-123' } });
    assert.equal(passthrough.response.headers.get('x-request-id'), 'inbound-trace-123');

    // A malformed one is replaced rather than echoed (header-injection guard).
    const rejected = await raw('/health', { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.notEqual(rejected.response.headers.get('x-request-id'), 'bad id with spaces');

    // ── Phase F: health tells the truth about the database ───────────────────
    assert.equal(health.response.status, 200);
    assert.equal(health.body.success, true);
    assert.equal(health.body.database.ok, true);
    assert.equal(typeof health.body.database.latencyMs, 'number');
    // Backward compatibility: the original fields any existing monitor parses.
    assert.equal(health.body.status, 'ok');
    assert.ok(health.body.timestamp && health.body.uptime);

    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    // ── Phase G: error responses carry a machine-readable code + reference ───
    // A POS route without an enrolled register returns a modelled PosError; its
    // message must survive (the cashier reads it) and it must carry the id.
    const posError = await raw('/pos/shifts/current');
    assert.equal(posError.response.ok, false);
    assert.equal(posError.body.code, 'REGISTER_REQUIRED');
    assert.match(posError.body.requestId || '', /^[0-9a-f]{12}$/);
    assert.ok(posError.body.message.length > 0);
    assert.equal(posError.body.requestId, posError.response.headers.get('x-request-id'));

    // ── Phase C: a POS 4xx is recorded as a warn, correlated by request id ───
    // (5xx is recorded too, but deliberately not provoked here: forcing a real
    // 500 would need a fault injected into a money path.)
    const recorded = await pollForRow(
      'SELECT fingerprint, source, severity, code, http_status, route FROM app_errors WHERE request_id = $1',
      [posError.body.requestId],
    );
    assert.equal(recorded.rowCount, 1);
    assert.equal(recorded.rows[0].source, 'server');
    assert.equal(recorded.rows[0].severity, 'warn');
    assert.equal(recorded.rows[0].code, 'REGISTER_REQUIRED');
    assert.equal(Number(recorded.rows[0].http_status), 428);
    assert.match(recorded.rows[0].route, /^GET \/api\/pos\/shifts\/current$/);

    // ── Phase C: repeats group instead of inserting a second row ─────────────
    // Matched on the fingerprint captured above, not on the original request
    // id: the dedup update deliberately moves request_id to the newest
    // occurrence, so the first id no longer identifies the row.
    const { fingerprint } = recorded.rows[0];
    const repeat = await raw('/pos/shifts/current');
    const grouped = await pollForRow(
      'SELECT seen_count, request_id FROM app_errors WHERE fingerprint = $1 AND seen_count >= 2',
      [fingerprint],
    );
    assert.equal(grouped.rowCount, 1, 'an identical fault must not create a second row');
    assert.equal(Number(grouped.rows[0].seen_count), 2);
    // The freshest occurrence's id is kept, so an investigator lands on the
    // most recent reproduction rather than the oldest.
    assert.equal(grouped.rows[0].request_id, repeat.body.requestId);

    // ── Phase D: client-side errors reach the store, with redaction ──────────
    const shipped = await api('/client-logs', {
      method: 'POST',
      body: JSON.stringify({
        entries: [{
          source: 'pos-client',
          severity: 'error',
          code: 'UNCAUGHT_ERROR',
          message: `Register screen froze ${runId}`,
          stack: 'Error: boom\n    at PosComponent.completeSale (pos.component.ts:1:1)',
          route: '/pos',
          occurredAt: new Date().toISOString(),
          online: false,
          pendingSales: 3,
          context: { managerPin: '4821', sessionToken: 'abc123', printerName: 'BIXOLON SRP-QE300' },
        }],
      }),
    });
    assert.equal(shipped.accepted, 1);

    const clientRow = await pollForRow(
      'SELECT source, severity, code, context, register_id FROM app_errors WHERE message = $1',
      [`Register screen froze ${runId}`],
    );
    assert.equal(clientRow.rowCount, 1);
    assert.equal(clientRow.rows[0].source, 'pos-client');
    assert.equal(clientRow.rows[0].code, 'UNCAUGHT_ERROR');
    // D5: secrets must never reach the database, even from an authenticated
    // client posting them directly — the server does not trust its client.
    assert.equal(clientRow.rows[0].context.managerPin, '[redacted]');
    assert.equal(clientRow.rows[0].context.sessionToken, '[redacted]');
    assert.equal(clientRow.rows[0].context.printerName, 'BIXOLON SRP-QE300');
    assert.equal(clientRow.rows[0].context.pendingSales, 3);
    assert.equal(clientRow.rows[0].context.online, false);

    // An empty or malformed batch is rejected cleanly, never with a 500.
    const emptyBatch = await raw('/client-logs', { method: 'POST', body: JSON.stringify({ entries: [] }) });
    assert.equal(emptyBatch.response.status, 422);

    // ── Phase D: CSP reports land unauthenticated and CSRF-exempt ────────────
    const cspResponse = await fetch(`${base}/client-logs/csp`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'effective-directive': 'script-src',
          'blocked-uri': `https://example.test/${runId}.js`,
          'document-uri': 'https://admin.example.test/pos',
        },
      }),
    });
    assert.equal(cspResponse.status, 204, 'a browser must never be given a reason to retry a report');

    // Written asynchronously after the 204, so poll rather than sleep.
    const cspRow = await pollForRow(
      'SELECT source, code, message FROM app_errors WHERE message LIKE $1',
      [`%${runId}.js%`],
    );
    assert.equal(cspRow.rowCount, 1);
    assert.equal(cspRow.rows[0].source, 'csp');
    assert.equal(cspRow.rows[0].code, 'script-src');

    // ── Phase H: the diagnostics reader surfaces all of the above ────────────
    const diagnostics = await api('/admin/diagnostics/errors?status=open&limit=100');
    assert.ok(diagnostics.summary.openCount >= 3);
    assert.ok(diagnostics.errors.some((row) => row.code === 'REGISTER_REQUIRED' && row.seenCount === 2));
    assert.ok(diagnostics.errors.some((row) => row.source === 'pos-client'));
    assert.ok(diagnostics.errors.some((row) => row.source === 'csp'));

    // Searching by the exact reference code a cashier would read out.
    const byReference = await api(`/admin/diagnostics/errors?status=all&search=${repeat.body.requestId}`);
    assert.ok(byReference.errors.length >= 1);
    assert.ok(byReference.errors.some((row) => row.requestId === repeat.body.requestId));

    // Resolving lets a later recurrence open a NEW row instead of silently
    // reviving the closed one — a regression after a fix must stay visible.
    const target = diagnostics.errors.find((row) => row.code === 'REGISTER_REQUIRED');
    const resolvedResult = await api(`/admin/diagnostics/errors/${target.errorId}/resolve`, { method: 'POST' });
    assert.equal(resolvedResult.resolved, true);
    await raw('/pos/shifts/current');
    // HAVING with no GROUP BY: the row only materialises once the count really
    // is 2, so the poller waits for the async insert instead of racing it.
    const afterResolve = await pollForRow(
      `SELECT count(*)::int AS rows FROM app_errors
       WHERE code = 'REGISTER_REQUIRED' AND route = 'GET /api/pos/shifts/current'
       HAVING count(*) = 2`,
      [],
    );
    assert.equal(afterResolve.rowCount, 1, 'a recurrence after resolving must open a new group');

    // Resolving twice is a clean 404, not a silent success.
    const doubleResolve = await raw(`/admin/diagnostics/errors/${target.errorId}/resolve`, { method: 'POST' });
    assert.equal(doubleResolve.response.status, 404);

    // ── Phase A: audit rows carry the same correlation id ────────────────────
    // setManagerPin writes an audit event through the POS context builder.
    // Unlike the intentional REGISTER_REQUIRED probes above, this is a real
    // POS write and must run from an enrolled register.
    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `Observability Register ${runId}` }),
    });
    await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    const pinResponse = await raw('/pos/manager-pin', { method: 'PUT', body: JSON.stringify({ pin: '4821' }) });
    assert.equal(pinResponse.response.ok, true);
    const auditRow = await db.query(
      'SELECT action, request_id FROM audit_events WHERE tenant_id = $1 AND request_id = $2',
      [tenantId, pinResponse.response.headers.get('x-request-id')],
    );
    assert.equal(auditRow.rowCount, 1);
    assert.equal(auditRow.rows[0].request_id, pinResponse.response.headers.get('x-request-id'));

    // And the audit reader can be queried by that same reference code.
    const auditView = await api(`/admin/diagnostics/audit-events?requestId=${pinResponse.response.headers.get('x-request-id')}`);
    assert.equal(auditView.events.length, 1);
    assert.equal(auditView.events[0].requestId, pinResponse.response.headers.get('x-request-id'));
    assert.ok(auditView.actions.length >= 1);

    // ── D3: a recorder failure must not be able to affect a caller ───────────
    // Passing a shape that cannot be inserted must resolve to null, not throw.
    const badRecord = await recordError({ source: 'server', severity: 'error', message: null, httpStatus: 'not-a-number' });
    assert.ok(badRecord === null || typeof badRecord === 'object');
    // Fingerprinting is deterministic — the property the whole grouping model
    // rests on.
    assert.equal(
      fingerprintOf({ source: 'server', code: 'X', route: 'GET /a', message: 'm', stack: null }),
      fingerprintOf({ source: 'server', code: 'X', route: 'GET /a', message: 'm', stack: null }),
    );
    assert.ok(app, 'the express app is exported for reuse');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) {
      await db.query('DELETE FROM app_errors WHERE tenant_id = $1 OR tenant_id IS NULL').catch(() => undefined);
      await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    }
    await db.pool.end();
  }
});
