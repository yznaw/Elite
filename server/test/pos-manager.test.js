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
  // A real PIN-holder exists (unlike the auto-approve test below) whose hash
  // just doesn't match what was typed — this is what should exercise the
  // wrong-PIN/failure-counting path, distinct from "nobody has a PIN set up."
  const someoneElsesHash = await bcrypt.hash('9999', 12);
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
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) {
        return { rowCount: 1, rows: [{ id: '44444444-4444-4444-8444-444444444444', pos_pin_hash: someoneElsesHash }] };
      }
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

test('no manager PIN configured anywhere auto-approves instead of failing every attempt', async () => {
  // Before this behavior existed, an empty admin_users result here fell into
  // the same branch as a wrong PIN — every attempt failed as PIN_INVALID and
  // counted toward the five/ten-attempt lockout, even though there was never
  // a PIN to check against. Setup gaps should not lock the register.
  const statements = [];
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: context.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('INSERT INTO pos_manager_overrides')) {
        return { rowCount: 1, rows: [{ id: 'override-auto', manager_id: context.userId, action: 'void', expires_at: new Date() }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    const result = await verifyManagerPin(context, { action: 'void' });
    assert.equal(result.managerId, context.userId);
    assert.equal(result.autoApproved, true);
    assert.ok(!statements.some((sql) => sql.startsWith('SELECT * FROM pos_pin_failures')));
    assert.ok(!statements.some((sql) => sql.startsWith('INSERT INTO pos_pin_failures')));
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('a manager cannot approve their own action with their own PIN (P0-7 approver separation)', async () => {
  const selfPinHash = await bcrypt.hash('1357', 12);
  const statements = [];
  const originalConnect = db.pool.connect;
  db.pool.connect = async () => ({
    async query(text) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: context.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT pos_emergency_self_approval_enabled FROM tenants')) {
        return { rowCount: 1, rows: [{ pos_emergency_self_approval_enabled: false }] };
      }
      if (sql.startsWith('SELECT * FROM pos_pin_failures')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id, pos_pin_hash FROM admin_users')) {
        // Only the requesting cashier's own PIN hash matches — no other
        // manager exists in this fixture, so the override must be rejected
        // rather than silently succeed.
        return { rowCount: 1, rows: [{ id: context.userId, pos_pin_hash: selfPinHash }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(
      verifyManagerPin(context, { pin: '1357', action: 'void' }),
      // Distinct from PIN_INVALID: the PIN is correct, the approver is not
      // eligible. A single-manager shop otherwise reads "PIN is incorrect"
      // and retypes a PIN that was right all along.
      (error) => error instanceof PosError && error.code === 'SELF_APPROVAL_BLOCKED' && error.status === 403,
    );
    // A correct own-PIN entry is not a brute-force attempt, so it must not
    // burn one of the five attempts before the register locks out.
    assert.ok(!statements.some((sql) => sql.startsWith('INSERT INTO pos_pin_failures')));
    assert.ok(!statements.some((sql) => sql.startsWith('INSERT INTO pos_manager_overrides')));
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('a wrong PIN in a single-manager shop still reports PIN_INVALID', async () => {
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
        return { rowCount: 1, rows: [{ id: context.userId, pos_pin_hash: selfPinHash }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });

  try {
    await assert.rejects(
      verifyManagerPin(context, { pin: '2468', action: 'void' }),
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
