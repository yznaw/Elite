const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/client');
const { PosError } = require('../lib/pos/errors');
const { updatePosPolicy } = require('../lib/pos/policy-service');

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'owner',
  ip: '127.0.0.1',
  userAgent: 'test',
};

function mockPool({ selfClose = true, selfApproval = false } = {}) {
  const updates = [];
  db.pool.connect = async () => ({
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('UPDATE tenants')) {
        updates.push(params);
        return {
          rowCount: 1,
          rows: [{
            pos_self_close_shift_enabled: params[1] ?? selfClose,
            pos_emergency_self_approval_enabled: params[2] ?? selfApproval,
          }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  return updates;
}

test('one switch can be flipped without restating the other', async () => {
  const originalConnect = db.pool.connect;
  const updates = mockPool();

  try {
    const policy = await updatePosPolicy(context, { emergencySelfApprovalEnabled: true });
    assert.equal(policy.emergencySelfApprovalEnabled, true);
    // NULL for the untouched column, so COALESCE keeps its stored value rather
    // than a partial request silently resetting the other setting.
    assert.equal(updates[0][1], null);
    assert.equal(updates[0][2], true);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('a non-boolean value is rejected instead of being coerced', async () => {
  const originalConnect = db.pool.connect;
  mockPool();

  try {
    await assert.rejects(
      updatePosPolicy(context, { emergencySelfApprovalEnabled: 'yes' }),
      (error) => error instanceof PosError && error.code === 'INVALID_FIELD',
    );
    await assert.rejects(
      updatePosPolicy(context, {}),
      (error) => error instanceof PosError && error.code === 'INVALID_FIELD',
    );
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('only the owner can loosen approver separation', async () => {
  const originalConnect = db.pool.connect;
  mockPool();

  try {
    for (const role of ['admin', 'manager', 'cashier']) {
      await assert.rejects(
        updatePosPolicy({ ...context, role }, { emergencySelfApprovalEnabled: true }),
        (error) => error instanceof PosError && error.status === 403,
      );
    }
  } finally {
    db.pool.connect = originalConnect;
  }
});
