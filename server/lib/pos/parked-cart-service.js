const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty, uuid } = require('./errors');

function normalizeCartPayload(payload) {
  assertPos(payload && typeof payload === 'object' && !Array.isArray(payload), 422, 'INVALID_CART', 'Cart payload is required.');
  assertPos(Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= 100, 422, 'INVALID_CART', 'Parked cart must contain 1 to 100 lines.');
  const serialized = JSON.stringify(payload);
  assertPos(Buffer.byteLength(serialized, 'utf8') <= 256 * 1024, 413, 'CART_TOO_LARGE', 'Parked cart exceeds the 256 KB limit.');
  return serialized;
}

async function listParkedCarts(context) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const result = await client.query(
      `SELECT id, label, cart_payload, created_at, updated_at
       FROM pos_parked_carts
       WHERE tenant_id = $1 AND register_id = $2 AND cashier_id = $3
       ORDER BY updated_at DESC`,
      [context.tenantId, register.id, context.userId],
    );
    return result.rows.map((row) => ({
      parkedCartId: row.id,
      label: row.label || '',
      payload: row.cart_payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

async function parkCart(context, body) {
  const label = body?.label ? nonEmpty(body.label, 'label', 80) : '';
  const cartPayload = normalizeCartPayload(body?.payload);
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const result = await client.query(
      `INSERT INTO pos_parked_carts
        (tenant_id, register_id, cashier_id, label, cart_payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING id, label, cart_payload, created_at, updated_at`,
      [context.tenantId, register.id, context.userId, label || null, cartPayload],
    );
    const row = result.rows[0];
    await audit(client, context, 'pos.cart.parked', 'pos_parked_cart', row.id, { label, itemCount: body.payload.items.length });
    return {
      parkedCartId: row.id,
      label: row.label || '',
      payload: row.cart_payload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

async function deleteParkedCart(context, parkedCartId) {
  const id = uuid(parkedCartId, 'parkedCartId');
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const result = await client.query(
      `DELETE FROM pos_parked_carts
       WHERE tenant_id = $1 AND id = $2 AND register_id = $3 AND cashier_id = $4
       RETURNING id, label`,
      [context.tenantId, id, register.id, context.userId],
    );
    assertPos(result.rowCount === 1, 404, 'PARKED_CART_NOT_FOUND', 'Parked cart not found.');
    await audit(client, context, 'pos.cart.restored', 'pos_parked_cart', id, { label: result.rows[0].label || '' });
    return { parkedCartId: id, deleted: true };
  });
}

module.exports = { deleteParkedCart, listParkedCarts, normalizeCartPayload, parkCart };
