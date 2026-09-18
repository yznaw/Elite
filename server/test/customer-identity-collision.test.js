const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resolveCustomer, normalizePhone } = require('../lib/customer-identity');

require('dotenv').config();

const runId = `${Date.now()}-${require('node:crypto').randomUUID()}`;
Object.assign(process.env, {
  DEFAULT_TENANT_SLUG: `identity-collision-${runId}`,
  DEFAULT_TENANT_NAME: 'Identity Collision Test',
  DEFAULT_ADMIN_EMAIL: `identity-${runId}@example.test`,
  DEFAULT_ADMIN_PASSWORD: 'identity-collision-test-password',
  SESSION_SECRET: `identity-collision-${runId}`,
});

test('customer identity collisions', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenant = await pool.query(
    "INSERT INTO tenants (slug, name) VALUES ($1, 'Identity Collision Test') RETURNING id",
    [process.env.DEFAULT_TENANT_SLUG],
  );
  const tenantId = tenant.rows[0].id;

  async function insert(email, phone, extra = '') {
    return (await pool.query(
      `INSERT INTO customers (tenant_id, full_name, email, phone_number)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, `Customer ${extra}`, email, phone],
    )).rows[0];
  }
  async function read(id) {
    return (await pool.query('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
  }
  async function resolve(input) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await resolveCustomer(client, tenantId, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    await t.test('A: split email and phone attaches to the phone holder', async () => {
      const a = await insert('split@example.test', null, 'Online');
      const b = await insert(null, '+974 5551 2345', 'Till');
      const result = await resolve({ email: a.email, phone: b.phone_number });
      assert.equal(result.customerId, b.id);
      assert.equal(result.matchedOn, 'phone');
      assert.equal(result.created, false);
      assert.deepEqual(await read(a.id), a);
      assert.equal((await read(b.id)).email, null);
      assert.equal(result.adopted.email, false);
    });

    await t.test('B: phone match cannot adopt another customer’s email', async () => {
      const a = await insert(null, '55500002');
      const b = await insert('mirror@example.test', null);
      const result = await resolve({ phone: '(555) 00002', email: b.email.toUpperCase() });
      assert.equal(result.customerId, a.id);
      assert.equal(result.matchedOn, 'phone');
      assert.equal(result.adopted.email, false);
      assert.equal((await read(a.id)).email, null);
      assert.deepEqual(await read(b.id), b);
    });

    await t.test('C: a deleted email holder is linked without being restored or changed', async () => {
      const deleted = await insert('deleted@example.test', null);
      await pool.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [deleted.id]);
      const before = await read(deleted.id);
      const result = await resolve({ email: deleted.email, phone: '55500003' });
      assert.equal(result.customerId, deleted.id);
      assert.equal(result.matchedOn, 'email');
      assert.equal(result.created, false);
      assert.deepEqual(result.adopted, { email: false, phone: false });
      assert.deepEqual(await read(deleted.id), before);
      const live = await insert(null, '55500004');
      const fill = await resolve({ email: deleted.email, phone: live.phone_number });
      assert.equal(fill.customerId, live.id);
      assert.equal(fill.adopted.email, false, 'email fill must also respect deleted holders');
      assert.equal((await read(live.id)).email, null);
    });

    await t.test('D: short phones match the generated key, including formatted input', async () => {
      assert.equal(normalizePhone('(12) 3'), '123');
      const first = await resolve({ phone: '123', email: 'short@example.test' });
      const second = await resolve({ phone: '(12) 3', email: 'other-short@example.test' });
      assert.equal(second.customerId, first.customerId);
      assert.equal(second.matchedOn, 'phone');
      assert.equal(second.created, false);
      assert.deepEqual(second.adopted, { email: false, phone: false });
      assert.equal((await read(first.customerId)).email, 'short@example.test');
    });

    await t.test('E: concurrent inserts converge and the outer transaction remains usable', async () => {
      for (const sameEmail of [true, false]) {
        const a = await pool.connect();
        const b = await pool.connect();
        const phone = sameEmail ? '55500005' : '55500006';
        const email = `race-${sameEmail}@example.test`;
        let retryCount = 0;
        let insertStarted;
        const waitingToInsert = new Promise((done) => { insertStarted = done; });
        const observedB = {
          query(sql, params) {
            if (/^INSERT INTO customers/.test(sql)) insertStarted();
            if (sql === 'ROLLBACK TO SAVEPOINT resolve_customer') retryCount += 1;
            return b.query(sql, params);
          },
        };
        let second;
        try {
          await a.query('BEGIN');
          await b.query('BEGIN');
          await b.query("SET LOCAL statement_timeout = '5s'");
          const first = await resolveCustomer(a, tenantId, { email, phone });
          // A's new row is still uncommitted. Wait until B has missed both
          // lookups and actually issues its INSERT before letting A commit.
          second = resolveCustomer(observedB, tenantId, {
            email: sameEmail ? email : 'race-other@example.test', phone,
          });
          second.catch(() => {});
          await Promise.race([waitingToInsert, second]);
          await a.query('COMMIT');
          const result = await second;
          assert.equal(result.customerId, first.customerId);
          assert.equal(result.created, false);
          assert.equal(result.matchedOn, 'phone');
          assert.equal((await b.query('SELECT 1 AS usable')).rows[0].usable, 1);
          await b.query('COMMIT');
          if (!sameEmail) assert.equal(retryCount, 1, 'phone race must exercise the savepoint retry');
          const count = await pool.query(
            'SELECT count(*)::int AS n FROM customers WHERE tenant_id = $1 AND phone_key = $2',
            [tenantId, phone],
          );
          assert.equal(count.rows[0].n, 1);
        } finally {
          await a.query('ROLLBACK');
          await second?.catch(() => {});
          await b.query('ROLLBACK');
          a.release();
          b.release();
        }
      }
    });

    await t.test('blank identifiers, valid fills, deleted phones, and tenant isolation', async () => {
      const anon = await resolve({ email: ' ', phone: ' () ', name: 'Walk-in' });
      assert.equal(anon.customerId, null);
      assert.deepEqual(anon.adopted, { email: false, phone: false });
      const emailOnly = await resolve({ email: ' email-only@example.test ' });
      assert.equal((await read(emailOnly.customerId)).phone_key, null);
      const filled = await resolve({ email: 'EMAIL-ONLY@example.test', phone: '55500007' });
      assert.equal(filled.customerId, emailOnly.customerId);
      assert.equal(filled.matchedOn, 'email');
      assert.deepEqual(filled.adopted, { email: false, phone: true });
      const before = await read(filled.customerId);
      await resolve({ email: before.email, phone: '55599999' });
      const after = await read(filled.customerId);
      assert.equal(after.phone_number, before.phone_number);
      assert.equal(after.phone, before.phone);

      const deleted = await insert(null, '55500008');
      await pool.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [deleted.id]);
      const adoptDeletedPhone = await resolve({ email: 'reused-phone@example.test' });
      const reused = await resolve({ email: 'reused-phone@example.test', phone: deleted.phone_number });
      assert.equal(reused.customerId, adoptDeletedPhone.customerId);
      assert.equal(reused.adopted.phone, true);
      assert.ok((await read(deleted.id)).deleted_at);

      const otherTenant = (await pool.query(
        "INSERT INTO tenants (slug, name) VALUES ($1, 'Other') RETURNING id",
        [`identity-other-${runId}`],
      )).rows[0].id;
      try {
        await pool.query(
          `INSERT INTO customers (tenant_id, full_name, email, phone_number)
           VALUES ($1, 'Other Tenant', 'tenant@example.test', '55500009')`, [otherTenant],
        );
        const own = await resolve({ email: 'tenant@example.test', phone: '55500009' });
        assert.equal(own.created, true);
        assert.equal((await read(own.customerId)).tenant_id, tenantId);
      } finally {
        await pool.query('DELETE FROM tenants WHERE id = $1', [otherTenant]);
      }
    });

    await t.test('an email claimed during UPDATE retries without aborting checkout', async () => {
      const target = await insert(null, '55500016');
      const winner = await pool.connect();
      const checkout = await pool.connect();
      let pending;
      let retries = 0;
      try {
        await winner.query('BEGIN');
        await checkout.query('BEGIN');
        await checkout.query("SET LOCAL statement_timeout = '5s'");
        const pid = (await checkout.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await winner.query(
          `INSERT INTO customers (tenant_id, full_name, email)
           VALUES ($1, 'Email Winner', 'update-race@example.test')`, [tenantId],
        );
        const observed = {
          query(sql, params) {
            if (sql === 'ROLLBACK TO SAVEPOINT resolve_customer') retries += 1;
            return checkout.query(sql, params);
          },
        };
        pending = resolveCustomer(observed, tenantId, { email: 'update-race@example.test', phone: target.phone_number });
        pending.catch(() => {});
        // Wait for the UPDATE to hit the unique constraint against the
        // uncommitted email owner. This proves the residual statement race,
        // rather than allowing the NOT EXISTS guard to see a committed owner.
        const deadline = Date.now() + 3000;
        let blocked = false;
        while (Date.now() < deadline) {
          const locks = await pool.query(
            'SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted', [pid],
          );
          if (locks.rowCount) { blocked = true; break; }
          await new Promise((done) => setTimeout(done, 10));
        }
        assert.ok(blocked, 'checkout must be waiting on the concurrent email owner');
        await winner.query('COMMIT');
        const result = await pending;
        assert.equal(result.customerId, target.id);
        assert.equal(result.adopted.email, false);
        assert.equal(retries, 1);
        await checkout.query('COMMIT');
        assert.equal((await read(target.id)).email, null);
      } finally {
        await winner.query('ROLLBACK');
        await pending?.catch(() => {});
        await checkout.query('ROLLBACK');
        winner.release();
        checkout.release();
      }
    });

    await t.test('a phone claimed after lookup is skipped by both UPDATE guards', async () => {
      const target = await insert('late-phone@example.test', null);
      const client = await pool.connect();
      let blocker;
      try {
        await client.query('BEGIN');
        const observed = {
          async query(sql, params) {
            if (sql.startsWith('UPDATE customers')) blocker = await insert(null, '55500010');
            return client.query(sql, params);
          },
        };
        const result = await resolveCustomer(observed, tenantId, { email: target.email, phone: '55500010' });
        assert.equal(result.customerId, target.id);
        assert.equal(result.adopted.phone, false);
        await client.query('COMMIT');
        const after = await read(target.id);
        assert.equal(after.phone, null);
        assert.equal(after.phone_number, null);
        assert.deepEqual(await read(blocker.id), blocker);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    await t.test('legacy duplicates without the conditional index choose the oldest row', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Transactional DDL: the index and fixtures are restored on rollback.
        await client.query('DROP INDEX customers_tenant_phone_key_idx');
        const oldest = (await client.query(
          `INSERT INTO customers (tenant_id, full_name, phone_number, created_at)
           VALUES ($1, 'Oldest', '55500011', now() - interval '1 day') RETURNING id`, [tenantId],
        )).rows[0].id;
        await client.query(
          "INSERT INTO customers (tenant_id, full_name, phone_number) VALUES ($1, 'Newer', '55500011')", [tenantId],
        );
        const result = await resolveCustomer(client, tenantId, { phone: '55500011' });
        assert.equal(result.customerId, oldest);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    await t.test('F: admin create, edit, and restore return actionable 409 responses', async () => {
      const { startServer } = require('../index');
      const db = require('../db/client');
      const server = await startServer(0);
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const cookies = new Map();
      async function request(path, method, body) {
        const response = await fetch(base + path, {
          method,
          headers: {
            'content-type': 'application/json',
            cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
            ...(cookies.has('elite.csrf') ? { 'x-csrf-token': decodeURIComponent(cookies.get('elite.csrf')) } : {}),
          },
          body: JSON.stringify(body),
        });
        for (const raw of response.headers.getSetCookie()) {
          const pair = raw.split(';')[0];
          const i = pair.indexOf('=');
          cookies.set(pair.slice(0, i), pair.slice(i + 1));
        }
        return { status: response.status, body: await response.json() };
      }
      function isConflict(response, field) {
        assert.equal(response.status, 409, JSON.stringify(response.body));
        assert.equal(response.body.code, 'CUSTOMER_IDENTIFIER_TAKEN');
        assert.equal(response.body.field, field);
        assert.ok(response.body.message);
      }
      try {
        const login = await request('/auth/login', 'POST', {
          email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD,
        });
        assert.equal(login.status, 200, JSON.stringify(login.body));
        const holder = await insert('admin-holder@example.test', '55500012', 'Blocker');
        isConflict(await request('/admin/customers', 'POST', {
          name: 'Create Conflict', email: 'admin-free@example.test', phone: holder.phone_number,
        }), 'phone');
        const target = await insert('admin-edit@example.test', null);
        isConflict(await request('/admin/customers', 'POST', {
          name: 'Upsert Conflict', email: target.email, phone: holder.phone_number,
        }), 'phone');
        isConflict(await request(`/admin/customers/${target.id}`, 'PATCH', { phone: holder.phone_number }), 'phone');
        isConflict(await request(`/admin/customers/${target.id}`, 'PATCH', { email: holder.email }), 'email');
        assert.deepEqual(await read(target.id), target, 'rejected writes must not change the customer');

        const deleted = await insert('admin-deleted@example.test', '55500013');
        await pool.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [deleted.id]);
        const deletedBefore = await read(deleted.id);
        const blocker = await insert(null, deleted.phone_number, 'Restore Blocker');
        const restore = await request(`/admin/customers/${deleted.id}/restore`, 'PATCH', {});
        isConflict(restore, 'phone');
        assert.deepEqual(restore.body.blockingCustomer, { id: blocker.id, name: blocker.full_name });
        assert.ok(restore.body.message.includes(blocker.id));
        isConflict(await request('/admin/customers', 'POST', {
          name: 'Accidental Restore', email: deleted.email,
        }), 'email');
        assert.deepEqual(await read(deleted.id), deletedBefore);
        await pool.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [blocker.id]);
        const restored = await request(`/admin/customers/${deleted.id}/restore`, 'PATCH', {});
        assert.equal(restored.status, 200);
        assert.equal((await read(deleted.id)).deleted_at, null);
        const created = await request('/admin/customers', 'POST', {
          name: 'Valid Create', email: 'admin-valid@example.test', phone: '55500014',
        });
        assert.equal(created.status, 201);
        const updated = await request(`/admin/customers/${created.body.data.id}`, 'PATCH', { phone: '55500015' });
        assert.equal(updated.status, 200);
      } finally {
        await new Promise((done) => server.close(done));
        await db.pool.end();
      }
    });
  } finally {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await pool.end();
  }
});

test('identity retry is bounded and never swallows unrelated failures', async () => {
  for (const constraint of [
    'customers_tenant_id_email_key', 'customers_tenant_email_key',
    'customers_tenant_phone_key_idx', 'customers_pkey',
  ]) {
    const calls = [];
    const error = Object.assign(new Error('conflict'), { code: '23505', constraint });
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.startsWith('INSERT INTO customers')) throw error;
        return { rowCount: 0, rows: [] };
      },
    };
    await assert.rejects(
      resolveCustomer(client, 'tenant', { email: 'retry@example.test', phone: '123' }),
      (actual) => actual === error,
    );
    const attempts = constraint === 'customers_pkey' ? 1 : 2;
    assert.equal(calls.filter((sql) => sql.startsWith('INSERT INTO customers')).length, attempts);
    assert.equal(calls.filter((sql) => sql === 'ROLLBACK TO SAVEPOINT resolve_customer').length, attempts);
    assert.equal(calls.filter((sql) => sql === 'RELEASE SAVEPOINT resolve_customer').length, attempts);
  }
});
