const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/client');
const { PosError } = require('../lib/pos/errors');
const { verifyManagerPin } = require('../lib/pos/manager-service');

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'manager',
  registerId: '33333333-3333-4333-8333-333333333333',
  ip: '127.0.0.1',
  userAgent: 'test',
};

test('failed manager PIN persists its failure counter before returning an error', async () => {
  const statements = [];
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: context.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT * FROM pos_pin_failures')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(
      verifyManagerPin(context, { pin: '0000', action: 'refund' }),
      (error) => error instanceof PosError && error.code === 'PIN_INVALID',
    );
    assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO pos_pin_failures')));
    assert.equal(statements.at(-1), 'COMMIT');
    assert.ok(!statements.includes('ROLLBACK'));
  } finally {
    db.pool.connect = originalConnect;
  }
});
