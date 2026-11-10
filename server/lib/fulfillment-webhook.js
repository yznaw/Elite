const crypto = require('node:crypto');
const { updateProgress } = require('./automatic-fulfillment');
const states = {
    new: 'processing', fulfilled: 'processing', pickup: 'processing', pickup_failed: 'processing', not_collected: 'processing', in_transit_pickup: 'processing', on_hold: 'processing',
    picked_up: 'shipped', in_transit: 'shipped', shipped: 'shipped', completed: 'delivered', delivered: 'delivered', failed: 'returned', returned: 'returned', returned_to_sender: 'returned', cancelled: 'cancelled', canceled: 'cancelled',
};
function statusFor(event) {
    const text = String(event.statusText || event.event).toLowerCase().replace(/^shipment\./, '').replace(/[ -]/g, '_');
    return states[text];
}
async function handle(client, tenantId, event, body) {
    const match = await client.query(`SELECT s.id,s.order_id FROM shipments s JOIN orders o ON o.id=s.order_id
    WHERE s.tenant_id=$1 AND o.fulfillment_version=1 AND
    (s.external_reference=ANY($2::text[]) OR (s.provider_shipment_id=$3 AND $3<>'') OR (s.tracking_number=$4 AND $4<>''))`, [tenantId, event.orderIdentifiers, event.shipmentId || '', event.trackingNumber || '']);
    if (match.rows.length !== 1)
        return false;
    const target = match.rows[0];
    await client.query('SELECT id FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, target.order_id]);
    const s = (await client.query('SELECT * FROM shipments WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, target.id])).rows[0];
    const status = statusFor(event);
    if (!status)
        return true;
    const data = body.data || body;
    const rawDate = data.updatedAt || data.updated_at || data.occurredAt || body.occurredAt;
    const eventAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate) : null;
    if (eventAt && s.provider_event_at && eventAt < s.provider_event_at)
        return true;
    const rank = { processing: 0, shipped: 1, delivered: 2, returned: 3, cancelled: 3 };
    if (rank[status] < rank[s.status] || (s.status === 'cancelled' && status !== 'cancelled') || (s.status === 'returned' && status !== 'returned') || (status === 'cancelled' && s.status !== 'processing'))
        return true;
    const key = crypto.createHash('sha256').update(`${event.eventId || ''}:${JSON.stringify(body)}`).digest('hex');
    const inserted = await client.query('INSERT INTO fulfillment_events(tenant_id,shipment_id,event_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING shipment_id', [tenantId, s.id, key]);
    if (!inserted.rowCount)
        return true;
    await client.query(`UPDATE shipments SET status=$3::order_fulfillment_status,
    tracking_number=COALESCE(NULLIF($4,''),tracking_number),tracking_url=COALESCE(NULLIF($5,''),tracking_url),
    provider_event_at=COALESCE($6,provider_event_at),
    booking_state=CASE WHEN $3='cancelled' THEN 'cancelled' ELSE 'booked' END,
    shipped_at=CASE WHEN $3 IN ('shipped','delivered') THEN COALESCE(shipped_at,now()) ELSE shipped_at END,
    delivered_at=CASE WHEN $3='delivered' THEN COALESCE(delivered_at,now()) ELSE delivered_at END,updated_at=now()
    WHERE tenant_id=$1 AND id=$2`, [tenantId, s.id, status, event.trackingNumber || '', /^https:\/\//i.test(event.trackingUrl || '') ? event.trackingUrl : '', eventAt]);
    await updateProgress(client, tenantId, s.order_id);
    await client.query(`INSERT INTO order_timeline_entries(tenant_id,order_id,kind,detail,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`, [tenantId, s.order_id, status, `NBOX ${s.external_reference}: ${status}`, JSON.stringify({ shipmentId: s.id, eventKey: key })]);
    return true;
}
module.exports = { handle, statusFor };
