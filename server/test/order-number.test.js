const test = require('node:test');
const assert = require('node:assert/strict');
const { generateOrderNumber, insertWithRetry } = require('../lib/order-number');

function fakeClient() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(String(sql).trim());
      return { rows: [] };
    },
  };
}

function conflictError() {
  return Object.assign(new Error('duplicate key value violates unique constraint "orders_tenant_public_number_key"'), {
    code: '23505',
    constraint: 'orders_tenant_public_number_key',
  });
}

test('generateOrderNumber is not sequential and has real entropy', () => {
  const a = generateOrderNumber();
  const b = generateOrderNumber();
  assert.match(a, /^EC-\d{2}-\d{12}$/);
  // Not a hard guarantee (both draw from the same space), but with a
  // 10^6 random component two calls colliding here would indicate the
  // generator is broken, not bad luck.
  assert.notEqual(a, b);
});

test('insertWithRetry succeeds on the first attempt without retrying', async () => {
  const client = fakeClient();
  const seenNumbers = [];
  const row = await insertWithRetry(client, async (publicNumber) => {
    seenNumbers.push(publicNumber);
    return { id: 'order-1', public_number: publicNumber };
  });
  assert.equal(row.id, 'order-1');
  assert.equal(seenNumbers.length, 1);
  assert.ok(client.queries.includes('SAVEPOINT before_order_insert'));
  assert.ok(client.queries.includes('RELEASE SAVEPOINT before_order_insert'));
  assert.ok(!client.queries.some((q) => q.startsWith('ROLLBACK TO SAVEPOINT')));
});

test('insertWithRetry regenerates the number and retries on a public_number collision', async () => {
  const client = fakeClient();
  const seenNumbers = [];
  let calls = 0;
  const row = await insertWithRetry(client, async (publicNumber) => {
    calls += 1;
    seenNumbers.push(publicNumber);
    if (calls < 3) throw conflictError();
    return { id: 'order-2', public_number: publicNumber };
  });
  assert.equal(row.id, 'order-2');
  assert.equal(calls, 3);
  // Every attempt drew a fresh number — retrying with the same colliding
  // number would just fail again forever.
  assert.equal(new Set(seenNumbers).size, 3);
  const rollbacks = client.queries.filter((q) => q.startsWith('ROLLBACK TO SAVEPOINT'));
  assert.equal(rollbacks.length, 2);
});

test('insertWithRetry does not retry a different error (e.g. idempotency-key collision)', async () => {
  const client = fakeClient();
  let calls = 0;
  const idempotencyConflict = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'orders_tenant_idempotency_key_key',
  });
  await assert.rejects(
    insertWithRetry(client, async () => {
      calls += 1;
      throw idempotencyConflict;
    }),
    (err) => err === idempotencyConflict,
  );
  assert.equal(calls, 1, 'must not retry a conflict on a different constraint');
});

test('insertWithRetry gives up and throws after repeated collisions', async () => {
  const client = fakeClient();
  let calls = 0;
  await assert.rejects(
    insertWithRetry(client, async () => {
      calls += 1;
      throw conflictError();
    }),
    (err) => err.code === '23505',
  );
  assert.equal(calls, 5, 'should stop at MAX_ATTEMPTS rather than retrying forever');
});
