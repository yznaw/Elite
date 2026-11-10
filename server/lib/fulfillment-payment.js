// Call only AFTER authenticating the complete provider payload. A successful
// signature does not make a mismatched amount or reused transaction valid.
async function verify(client, orderId, payload, reference) {
    const order = (await client.query('SELECT * FROM orders WHERE id::text=$1', [orderId])).rows[0];
    if (!order?.fulfillment_version)
        return true; // Preserve legacy payment sessions.
    // A replay of the original success must never undo a later refund.
    if (['refunded', 'partially_refunded'].includes(order.payment_status))
        return false;
    const raw = payload.TXN_AMOUNT ?? payload.TXNAMOUNT ?? payload.transactionAmount ?? payload.transaction_amount ?? payload.amount;
    const currency = payload.CURRENCY ?? payload.currency;
    const amount = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    const valid = /^\d+(?:\.\d{1,2})?$/.test(amount) && Math.round(Number(amount) * 100) === Number(order.total_cents)
        && (!currency || String(currency).toUpperCase() === order.currency) && typeof reference === 'string' && reference.length > 0 && reference.length <= 200;
    let claimed = false;
    if (valid) {
        const r = await client.query(`INSERT INTO fulfillment_payment_claims(provider_reference,order_id,amount_cents) VALUES($1,$2,$3)
   ON CONFLICT(provider_reference) DO UPDATE SET provider_reference=EXCLUDED.provider_reference WHERE fulfillment_payment_claims.order_id=EXCLUDED.order_id RETURNING order_id`, [reference, orderId, order.total_cents]);
        claimed = r.rowCount === 1;
    }
    if (!claimed) {
        await client.query(`INSERT INTO admin_notifications(tenant_id,kind,title,body,route,entity_type,entity_id)
   VALUES($1,'payment_verification','Payment requires verification','Provider amount or transaction reference could not be verified. Check SADAD before fulfillment.',$3,'order',$2)
   ON CONFLICT(tenant_id,kind,entity_id) WHERE entity_id IS NOT NULL DO NOTHING`, [order.tenant_id, order.id, `/orders?id=${order.id}`]);
    }
    return claimed;
}
module.exports = { verify };
