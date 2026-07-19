const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
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

test('a manager cannot approve their own action with their own PIN (P0-7 approver separation)', async () => {
  const selfPinHash = await bcrypt.hash('1357', 12);
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: context.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT pos_emergency_self_approval_enabled FROM tenants')) {
        return { rowCount: 1, rows: [{ pos_emergency_self_approval_enabled: false }] };
      }
      if (sql.startsWith('SELECT * FROM pos_pin_failures')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) {
        // Only the requesting cashier's own PIN hash matches — no other
        // manager exists in this fixture, so a correct self-approval
        // rejection must produce PIN_INVALID, not silently succeed.
        return { rowCount: 1, rows: [{ id: context.userId, pos_pin_hash: selfPinHash }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(
      verifyManagerPin(context, { pin: '1357', action: 'void' }),
      (error) => error instanceof PosError && error.code === 'PIN_INVALID',
    );
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('a different manager can still approve using their own PIN', async () => {
  const otherManagerId = '44444444-4444-4444-8444-444444444444';
  const otherPinHash = await bcrypt.hash('9999', 12);
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: context.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT pos_emergency_self_approval_enabled FROM tenants')) {
        return { rowCount: 1, rows: [{ pos_emergency_self_approval_enabled: false }] };
      }
      if (sql.startsWith('SELECT * FROM pos_pin_failures')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) {
        return { rowCount: 1, rows: [{ id: otherManagerId, pos_pin_hash: otherPinHash }] };
      }
      if (sql.startsWith('INSERT INTO pos_manager_overrides')) {
        return { rowCount: 1, rows: [{ id: 'override-1', manager_id: otherManagerId, action: 'void', expires_at: new Date() }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    const result = await verifyManagerPin(context, { pin: '9999', action: 'void' });
    assert.equal(result.managerId, otherManagerId);
  } finally {
    db.pool.connect = originalConnect;
  }
});
