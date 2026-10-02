const { assertPos } = require('./pos/errors');
const { recordMovement, publishStockEvent } = require('./inventory-ledger');
const { applyLocationDelta } = require('./location-stock');
const { updateProgress } = require('./automatic-fulfillment');
const nbox = require('./nbox');
async function act(client, context, orderRef, shipmentId, body) {
    const match = (await client.query('SELECT * FROM orders WHERE tenant_id=$1 AND (id::text=$2 OR public_number=$2)', [context.tenantId, orderRef])).rows[0];
    assertPos(match?.fulfillment_version, 404, 'NOT_FOUND', 'Order not found.');
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`automatic:${context.tenantId}:${match.id}`]);
    try {
        let s = (await client.query('SELECT * FROM shipments WHERE tenant_id=$1 AND order_id=$2 AND id::text=$3', [context.tenantId, match.id, shipmentId])).rows[0];
        assertPos(s, 404, 'NOT_FOUND', 'Delivery not found.');
        assertPos(match.payment_status === 'paid' || body.action === 'restore', 409, 'ORDER_NOT_PAID', 'Only paid orders can dispatch.');
        const action = body.action;
        assertPos(['retry', 'confirm_absent', 'attach', 'cancel', 'restore'].includes(action), 422, 'INVALID_ACTION', 'Choose a delivery action.');
        if (['confirm_absent', 'attach'].includes(action)) {
            assertPos(s.booking_state === 'uncertain' && body.confirmed === true && typeof body.note === 'string' && body.note.trim().length >= 10 && body.note.length <= 1000, 422, 'RECONCILIATION_REQUIRED', 'Confirm the outcome with NBOX and record a reconciliation note.');
        }
        if (action === 'cancel' && s.booking_state === 'booked') {
            assertPos(s.status === 'processing', 409, 'ALREADY_COLLECTED', 'A collected shipment must use the return process.');
            const response = await nbox.cancelShipment(s.external_reference);
            assertPos(['success', 'ok'].includes(String(response?.status).toLowerCase()), 502, 'CANCEL_UNCONFIRMED', 'NBOX did not confirm cancellation. Reconcile with NBOX.');
        }
        await client.query('BEGIN');
        // Same order-before-shipments locking order as payment and webhooks.
        await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [match.id]);
        s = (await client.query('SELECT * FROM shipments WHERE id=$1 FOR UPDATE', [s.id])).rows[0];
        if (action === 'retry' || action === 'confirm_absent') {
            assertPos(s.booking_state === (action === 'retry' ? 'failed' : 'uncertain'), 409, 'RETRY_BLOCKED', 'Only confirmed failed or reconciled absent bookings can be retried.');
            await client.query("UPDATE shipments SET booking_state='pending',booking_error=NULL WHERE id=$1", [s.id]);
        }
        else if (action === 'attach') {
            const providerId = String(body.providerId || '').trim();
            assertPos(providerId.length > 0 && providerId.length <= 200, 422, 'INVALID_REFERENCE', 'Enter the shipment reference confirmed by NBOX.');
            await client.query("UPDATE shipments SET provider_shipment_id=$2,tracking_number=NULLIF($3,''),booking_state='booked',booking_error=NULL WHERE id=$1", [s.id, providerId, String(body.trackingNumber || '').slice(0, 200)]);
        }
        else if (action === 'cancel') {
            assertPos(['pending', 'failed', 'booked'].includes(s.booking_state) && s.status === 'processing', 409, 'CANCEL_BLOCKED', 'Reconcile uncertain bookings, or use the return process after collection.');
            await client.query("UPDATE shipments SET booking_state='cancelled',status='cancelled' WHERE id=$1", [s.id]);
            await updateProgress(client, context.tenantId, match.id);
        }
        else if (action === 'restore') {
            assertPos(['cancelled', 'returned'].includes(s.status) && body.confirmed === true, 409, 'PHYSICAL_RETURN_REQUIRED', 'Confirm that these cancelled or returned items are physically back at their origin.');
            const rows = (await client.query(`SELECT a.*,i.product_id FROM fulfillment_allocations a JOIN order_items i ON i.id=a.order_item_id WHERE a.shipment_id=$1 AND a.state='allocated' ORDER BY a.variant_id,a.location_id FOR UPDATE OF a`, [s.id])).rows;
            await client.query('SELECT id FROM product_variants WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [context.tenantId, rows.map(a => a.variant_id)]);
            for (const a of rows) {
                await applyLocationDelta(client, context.tenantId, { variantId: a.variant_id, locationId: a.location_id, delta: a.quantity });
                const stock = (await client.query('UPDATE product_variants SET stock_quantity=stock_quantity+$2,updated_at=now() WHERE id=$1 RETURNING stock_quantity', [a.variant_id, a.quantity])).rows[0].stock_quantity;
                await recordMovement(client, context, { productId: a.product_id, variantId: a.variant_id, delta: a.quantity, reason: 'web_order_reversed', referenceType: 'shipment', referenceId: s.id, locationId: a.location_id });
                await client.query("UPDATE fulfillment_allocations SET state='restored' WHERE id=$1", [a.id]);
                await client.query('UPDATE products SET stock_quantity=(SELECT sum(stock_quantity) FROM product_variants WHERE product_id=$1) WHERE id=$1', [a.product_id]);
                await publishStockEvent(client, context.tenantId, a.variant_id, stock);
            }
        }
        await client.query(`INSERT INTO audit_events(tenant_id,actor_user_id,action,entity_type,entity_id,after_state) VALUES($1,$2,$3,'shipment',$4,$5::jsonb)`, [context.tenantId, context.userId, `shipment.${action}`, s.id, JSON.stringify({ note: body.note || null, providerId: body.providerId || null, confirmed: body.confirmed === true })]);
        await client.query('COMMIT');
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`automatic:${context.tenantId}:${match.id}`]);
    }
}
module.exports = { act };
