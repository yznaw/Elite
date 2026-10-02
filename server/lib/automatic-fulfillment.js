const crypto = require('node:crypto');
const db = require('../db/client');
const nbox = require('./nbox');
const { assertPos, uuid } = require('./pos/errors');
const { allocate, aggregateProgress } = require('./fulfillment-allocator');
const { recordMovement, publishStockEvent } = require('./inventory-ledger');
const { perLocationEnabled, syncLocations, listLocations, applyLocationDelta } = require('./location-stock');
const { logger } = require('./logger');
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
    return value;
}
function fingerprint(lines, address) {
    return crypto.createHash('sha256').update(JSON.stringify(canonical({
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCents: l.unitCents })).sort((a, b) => a.variantId.localeCompare(b.variantId)),
        address,
    }))).digest('hex');
}
async function settings(client, tenantId) {
    const { rows } = await client.query('SELECT config FROM tenants WHERE id = $1', [tenantId]);
    return rows[0]?.config?.automaticFulfillment || { enabled: false, locations: [], fallbackId: null };
}
async function configuration(client, tenantId) {
    await syncLocations(client, tenantId);
    return { ...await settings(client, tenantId), stockLocations: await listLocations(client, tenantId), perLocation: await perLocationEnabled(client, tenantId) };
}
function cleanOrigin(raw = {}) {
    const out = {};
    for (const key of ['address', 'city', 'state', 'countryCode', 'zip', 'contactName', 'phone']) {
        out[key] = String(raw[key] || '').trim();
        assertPos(out[key].length <= 250, 422, 'INVALID_ORIGIN', 'Pickup fields must be at most 250 characters.');
    }
    assertPos(out.address && out.city && /^[A-Z]{2}$/.test(out.countryCode) && out.zip && out.phone, 422, 'INVALID_ORIGIN', 'Pickup address, city, country code, postal code and phone are required.');
    for (const [key, max] of [['latitude', 90], ['longitude', 180]]) {
        if (raw[key] !== '' && raw[key] != null) {
            const value = Number(raw[key]);
            assertPos(Number.isFinite(value) && Math.abs(value) <= max, 422, 'INVALID_ORIGIN', 'Invalid pickup coordinates.');
            out[key] = value;
        }
    }
    return out;
}
async function saveSettings(client, context, body) {
    // A valid configuration activates automatic fulfillment by default. Keep
    // an explicit false available for existing clients and operational rollback.
    const enabled = body.enabled === undefined ? true : body.enabled;
    assertPos(typeof enabled === 'boolean' && Array.isArray(body.locations) && body.locations.length <= 3, 422, 'INVALID_CONFIGURATION', 'Provide up to three pickup locations.');
    const existing = await listLocations(client, context.tenantId);
    const ids = new Set(existing.map((l) => l.id));
    const locations = body.locations.map((loc, index) => {
        uuid(loc.id, 'locationId');
        assertPos(ids.has(loc.id), 422, 'INVALID_LOCATION', 'Choose a stock location belonging to this store.');
        return { id: loc.id, priority: index, origin: cleanOrigin(loc.origin) };
    });
    assertPos(new Set(locations.map((l) => l.id)).size === locations.length, 422, 'DUPLICATE_LOCATION', 'Each stock location can be configured once.');
    const fallbackId = body.fallbackId ? uuid(body.fallbackId, 'fallbackId') : null;
    assertPos(!fallbackId || locations.some((l) => l.id === fallbackId), 422, 'INVALID_FALLBACK', 'The warehouse must be a configured pickup location.');
    // Each configured entry is one independent consignment. Prevent accidentally
    // counting a branch and its warehouse as two copies of the same origin.
    const addresses = locations.map((l) => `${l.origin.address}|${l.origin.city}`.toLowerCase().replace(/\s+/g, ' '));
    assertPos(new Set(addresses).size === addresses.length, 422, 'DUPLICATE_ORIGIN', 'Use one stock location for each pickup address; reconcile shared branch/warehouse stock first.');
    if (enabled) {
        assertPos(locations.length >= 2 && fallbackId && await perLocationEnabled(client, context.tenantId), 409, 'FULFILLMENT_NOT_READY', 'Enable stock per location and configure the shop and warehouse first.');
        assertPos(nbox.isConfigured(), 409, 'NBOX_NOT_CONFIGURED', 'Configure NBOX credentials before enabling automatic delivery.');
        assertPos(Boolean(process.env.NBOX_WEBHOOK_SECRET), 409, 'NBOX_NOT_CONFIGURED', 'Configure the NBOX webhook signing secret before enabling automatic delivery.');
        const { rows } = await client.query("SELECT id FROM orders WHERE tenant_id=$1 AND fulfillment_version IS NULL AND payment_status='paid' AND EXISTS (SELECT 1 FROM order_stock_holds h WHERE h.order_id=orders.id AND h.status='held') LIMIT 1", [context.tenantId]);
        assertPos(!rows.length, 409, 'LEGACY_ORDERS_PENDING', 'Resolve existing paid orders awaiting approval before enabling automatic fulfillment.');
    }
    const value = { enabled, fallbackId, locations };
    await client.query("UPDATE tenants SET config=jsonb_set(COALESCE(config,'{}'),'{automaticFulfillment}',$2::jsonb,true) WHERE id=$1", [context.tenantId, JSON.stringify(value)]);
    await client.query("INSERT INTO audit_events(tenant_id,actor_user_id,action,entity_type,entity_id,after_state) VALUES($1,$2,'fulfillment.settings','tenant',$1,$3::jsonb)", [context.tenantId, context.userId, JSON.stringify(value)]);
    return value;
}
function publicQuote(row) {
    const p = row.plan;
    return { available: true, id: row.id, expiresAt: row.expires_at, amount: p.totalCents / 100, currency: p.currency,
        serviceName: 'NBOX', serviceCode: 'nbox', shipmentCount: p.shipments.length,
        shipments: p.shipments.map((s, i) => ({ number: i + 1, amount: s.deliveryCents / 100, eta: s.quote.eta,
            items: s.items.map((l) => ({ variantId: l.variantId, name: l.name, size: l.size, qty: l.qty })) })),
    };
}
async function createQuote(client, tenantId, ownerHash, lines, shippingAddress, currency = 'QAR') {
    const cfg = await settings(client, tenantId);
    assertPos(cfg.enabled, 409, 'AUTOMATIC_FULFILLMENT_OFF', 'Automatic delivery is disabled.');
    assertPos(lines.length && lines.every((l) => l.variantId), 422, 'VARIANT_REQUIRED', 'Select a size and colour for every item.');
    assertPos(new Set(lines.map(l => l.variantId)).size === lines.length, 422, 'DUPLICATE_VARIANT', 'Combine repeated variants into one cart line.');
    lines = lines.map(({ variantId, productId, name, sku, size, color, qty, unitCents }) => ({ variantId, productId, name, sku, size, color, qty, unitCents }));
    const ids = lines.map((l) => l.variantId);
    const { rows } = await client.query(`SELECT v.variant_id,v.location_id,
    GREATEST(v.quantity-COALESCE((SELECT sum(a.quantity) FROM fulfillment_allocations a WHERE a.variant_id=v.variant_id AND a.location_id=v.location_id AND a.state='reserved'),0),0)::int AS quantity
    FROM variant_location_stock v JOIN stocktake_locations l ON l.id=v.location_id
    WHERE v.tenant_id=$1 AND v.variant_id=ANY($2::uuid[]) AND l.is_active`, [tenantId, ids]);
    const totals = await client.query('SELECT id,stock_quantity FROM product_variants WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, ids]);
    assertPos(lines.every((l) => Number(totals.rows.find((v) => v.id === l.variantId)?.stock_quantity) >= l.qty), 409, 'INSUFFICIENT_STOCK', 'Some items are no longer available.');
    const locations = cfg.locations.map((l) => ({ ...l, stock: Object.fromEntries(rows.filter((r) => r.location_id === l.id).map((r) => [r.variant_id, r.quantity])) }));
    const groups = allocate(lines, locations, cfg.fallbackId);
    const shipments = [];
    for (const group of groups) {
        const quote = await nbox.getDeliveryQuote({ origin: group.origin, shippingAddress,
            items: group.items.map((l) => ({ ...l, price: l.unitCents / 100, quantity: l.qty })) });
        assertPos(quote.available && quote.currency === currency && Number.isFinite(quote.amount) && quote.amount >= 0, 409, 'DELIVERY_UNAVAILABLE', 'NBOX could not quote every delivery in the store currency.');
        shipments.push({ ...group, quote, deliveryCents: Math.round(quote.amount * 100) });
    }
    const plan = { shipments, currency, totalCents: shipments.reduce((s, l) => s + l.deliveryCents, 0), configuration: cfg };
    const result = await client.query(`INSERT INTO fulfillment_quotes(tenant_id,owner_hash,fingerprint,plan,expires_at)
    VALUES($1,$2,$3,$4::jsonb,now()+interval '15 minutes') RETURNING *`, [tenantId, ownerHash, fingerprint(lines, shippingAddress), JSON.stringify(plan)]);
    return publicQuote(result.rows[0]);
}
async function acceptedQuote(client, tenantId, ownerHash, id, lines, address) {
    uuid(id, 'quoteId');
    const { rows } = await client.query('SELECT * FROM fulfillment_quotes WHERE id=$1 AND tenant_id=$2 AND owner_hash=$3 AND expires_at>now()', [id, tenantId, ownerHash]);
    assertPos(rows.length && rows[0].fingerprint === fingerprint(lines, address), 409, 'QUOTE_CHANGED', 'Delivery quote expired or items changed. Review a new quote before paying.');
    const cfg = await settings(client, tenantId);
    assertPos(JSON.stringify(canonical(cfg)) === JSON.stringify(canonical(rows[0].plan.configuration)), 409, 'QUOTE_CHANGED', 'Pickup settings changed. Review a new delivery quote.');
    return rows[0];
}
async function totals(client, tenantId, variantIds) {
    await client.query(`UPDATE products p SET stock_quantity=(SELECT COALESCE(sum(v.stock_quantity),0) FROM product_variants v WHERE v.product_id=p.id),updated_at=now()
    WHERE p.tenant_id=$1 AND p.id IN (SELECT product_id FROM product_variants WHERE id=ANY($2::uuid[]))`, [tenantId, variantIds]);
    for (const id of [...new Set(variantIds)]) {
        const r = await client.query('SELECT stock_quantity FROM product_variants WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
        await publishStockEvent(client, tenantId, id, Number(r.rows[0].stock_quantity));
    }
}
async function reserve(client, tenantId, order, quote) {
    const items = (await client.query('SELECT * FROM order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY variant_id', [tenantId, order.id])).rows;
    // Caller has locked variants in sorted order; revalidate each specific origin.
    for (const group of [...quote.plan.shipments].sort((a, b) => a.locationId.localeCompare(b.locationId))) {
        for (const line of group.items) {
            const r = await client.query(`SELECT quantity-COALESCE((SELECT sum(a.quantity) FROM fulfillment_allocations a WHERE a.variant_id=v.variant_id AND a.location_id=v.location_id AND a.state='reserved'),0) AS available
        FROM variant_location_stock v WHERE tenant_id=$1 AND variant_id=$2 AND location_id=$3 FOR UPDATE`, [tenantId, line.variantId, group.locationId]);
            assertPos(Number(r.rows[0]?.available) >= line.qty, 409, 'QUOTE_CHANGED', 'Stock changed at a pickup location. Review a new delivery quote before payment.');
        }
    }
    for (const [i, group] of quote.plan.shipments.entries()) {
        const shipment = (await client.query(`INSERT INTO shipments(tenant_id,order_id,carrier,status,address,origin_location_id,origin_snapshot,quote_snapshot,external_reference,delivery_cents,booking_state)
      VALUES($1,$2,'nbox','processing',$3::jsonb,$4,$5::jsonb,$6::jsonb,$7,$8,'waiting_payment') RETURNING id`, [tenantId, order.id, JSON.stringify(order.shipping_address), group.locationId, JSON.stringify(group.origin), JSON.stringify(group.quote), `${order.public_number}-S${i + 1}`, group.deliveryCents])).rows[0];
        for (const line of group.items) {
            const item = items.find((l) => l.variant_id === line.variantId);
            assertPos(item, 409, 'INVALID_PLAN', 'An allocated item does not match the order.');
            await client.query(`INSERT INTO fulfillment_allocations(tenant_id,order_id,order_item_id,variant_id,location_id,shipment_id,quantity,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,'reserved')`, [tenantId, order.id, item.id, line.variantId, group.locationId, shipment.id, line.qty]);
        }
    }
    for (const item of items) {
        await client.query("INSERT INTO order_stock_holds(tenant_id,order_id,variant_id,quantity,status) VALUES($1,$2,$3,$4,'reserved')", [tenantId, order.id, item.variant_id, item.quantity]);
        const r = await client.query('UPDATE product_variants SET stock_quantity=stock_quantity-$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND stock_quantity >= $3 RETURNING id', [tenantId, item.variant_id, item.quantity]);
        assertPos(r.rowCount, 409, 'INSUFFICIENT_STOCK', 'Stock changed. Review your order before payment.');
        await recordMovement(client, { tenantId }, { productId: item.product_id, variantId: item.variant_id, delta: -item.quantity, reason: 'web_reservation', referenceType: 'order', referenceId: order.id });
    }
    await client.query("UPDATE orders SET fulfillment_version=1,allocation_state='reserved',reservation_expires_at=now()+interval '30 minutes' WHERE id=$1", [order.id]);
    await totals(client, tenantId, items.map((i) => i.variant_id));
}
async function consume(client, order) {
    if (order.allocation_state === 'allocated')
        return true;
    if (order.allocation_state === 'released') {
        // A delayed verified payment can recover only its original paid plan.
        const rows = (await client.query("SELECT a.*,i.product_id FROM fulfillment_allocations a JOIN order_items i ON i.id=a.order_item_id WHERE a.order_id=$1 AND a.state='released' ORDER BY a.variant_id,a.location_id", [order.id])).rows;
        const variants = (await client.query('SELECT id,stock_quantity FROM product_variants WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [order.tenant_id, rows.map(a => a.variant_id)])).rows;
        let possible = rows.length > 0;
        const required = new Map();
        for (const a of rows) {
            required.set(a.variant_id, (required.get(a.variant_id) || 0) + a.quantity);
            const r = await client.query(`SELECT quantity-COALESCE((SELECT sum(quantity) FROM fulfillment_allocations a WHERE a.variant_id=v.variant_id AND a.location_id=v.location_id AND a.state='reserved'),0) AS available FROM variant_location_stock v WHERE tenant_id=$1 AND variant_id=$2 AND location_id=$3 FOR UPDATE`, [order.tenant_id, a.variant_id, a.location_id]);
            if (Number(r.rows[0]?.available) < a.quantity || !r.rowCount)
                possible = false;
        }
        for (const [id, quantity] of required)
            if (Number(variants.find(v => v.id === id)?.stock_quantity) < quantity)
                possible = false;
        if (possible) {
            for (const [id, quantity] of required) {
                await client.query('UPDATE product_variants SET stock_quantity=stock_quantity-$2 WHERE id=$1', [id, quantity]);
                await recordMovement(client, { tenantId: order.tenant_id }, { productId: rows.find(a => a.variant_id === id).product_id, variantId: id, delta: -quantity, reason: 'web_reservation', referenceType: 'order', referenceId: order.id });
            }
            await client.query("UPDATE order_stock_holds SET status='reserved',released_at=NULL WHERE order_id=$1", [order.id]);
            await client.query("UPDATE fulfillment_allocations SET state='reserved' WHERE order_id=$1 AND state='released'", [order.id]);
            await client.query("UPDATE shipments SET booking_state='waiting_payment',status='processing' WHERE order_id=$1 AND booking_state='cancelled'", [order.id]);
            order.allocation_state = 'reserved';
        }
    }
    if (order.allocation_state !== 'reserved') {
        await client.query("UPDATE orders SET allocation_state='exception' WHERE id=$1", [order.id]);
        return false;
    }
    const allocations = (await client.query(`SELECT a.*,i.product_id FROM fulfillment_allocations a JOIN order_items i ON i.id=a.order_item_id
    WHERE a.tenant_id=$1 AND a.order_id=$2 AND a.state='reserved' ORDER BY a.variant_id,a.location_id`, [order.tenant_id, order.id])).rows;
    assertPos(allocations.length, 409, 'RESERVATION_MISSING', 'Paid order has no stock reservation.');
    await client.query('SELECT id FROM product_variants WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [order.tenant_id, allocations.map(a => a.variant_id)]);
    await client.query("UPDATE fulfillment_allocations SET state='allocated' WHERE order_id=$1 AND state='reserved'", [order.id]);
    for (const a of allocations) {
        await applyLocationDelta(client, order.tenant_id, { variantId: a.variant_id, locationId: a.location_id, delta: -a.quantity });
        const common = { productId: a.product_id, variantId: a.variant_id, referenceType: 'order', referenceId: order.id };
        await recordMovement(client, { tenantId: order.tenant_id }, { ...common, delta: a.quantity, reason: 'web_reservation_consumed' });
        await recordMovement(client, { tenantId: order.tenant_id }, { ...common, delta: -a.quantity, reason: 'web_order', locationId: a.location_id });
    }
    await client.query("UPDATE order_stock_holds SET status='released',released_at=now() WHERE order_id=$1 AND status='reserved'", [order.id]);
    await client.query("UPDATE orders SET allocation_state='allocated',status='confirmed',fulfillment_status='processing',updated_at=now() WHERE id=$1", [order.id]);
    await client.query("UPDATE shipments SET booking_state='pending' WHERE order_id=$1 AND booking_state='waiting_payment'", [order.id]);
    await totals(client, order.tenant_id, allocations.map(a => a.variant_id));
    await client.query("INSERT INTO order_timeline_entries(tenant_id,order_id,kind,detail) VALUES($1,$2,'processing','Payment confirmed; stock allocated automatically.')", [order.tenant_id, order.id]);
    return true;
}
async function processPaidOrder(tenantId, orderId) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const order = (await client.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, orderId])).rows[0];
        if (!order?.fulfillment_version) {
            await client.query('ROLLBACK');
            return null;
        }
        if (order.payment_status !== 'paid' || ['cancelled', 'refunded'].includes(order.status)) {
            await client.query('ROLLBACK');
            return { applied: false };
        }
        const applied = await consume(client, order);
        await client.query('COMMIT');
        return { applied, automatic: true, reason: applied ? 'allocated' : 'reservation_expired' };
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
/** Caller holds the order lock. Idempotent release of an unpaid reservation. */
async function release(client, order) {
    if (order.allocation_state !== 'reserved' || order.payment_status === 'paid')
        return false;
    const items = (await client.query("SELECT h.*,v.product_id FROM order_stock_holds h JOIN product_variants v ON v.id=h.variant_id WHERE h.order_id=$1 AND h.status='reserved' ORDER BY h.variant_id", [order.id])).rows;
    await client.query('SELECT id FROM product_variants WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [order.tenant_id, items.map(i => i.variant_id)]);
    await client.query("UPDATE fulfillment_allocations SET state='released' WHERE order_id=$1 AND state='reserved'", [order.id]);
    for (const i of items) {
        await client.query('UPDATE product_variants SET stock_quantity=stock_quantity+$2,updated_at=now() WHERE id=$1', [i.variant_id, i.quantity]);
        await recordMovement(client, { tenantId: order.tenant_id }, { productId: i.product_id, variantId: i.variant_id, delta: i.quantity, reason: 'web_reservation_released', referenceType: 'order', referenceId: order.id });
    }
    await client.query("UPDATE order_stock_holds SET status='released',released_at=now() WHERE order_id=$1 AND status='reserved'", [order.id]);
    await client.query("UPDATE orders SET allocation_state='released' WHERE id=$1", [order.id]);
    await client.query("UPDATE shipments SET booking_state='cancelled',status='cancelled' WHERE order_id=$1 AND booking_state='waiting_payment'", [order.id]);
    await totals(client, order.tenant_id, items.map(i => i.variant_id));
    return true;
}
async function expireReservations() {
    const { rows } = await db.query(`SELECT id FROM orders WHERE fulfillment_version=1 AND allocation_state='reserved' AND payment_status<>'paid'
    AND (reservation_expires_at<now() OR status='cancelled' OR payment_status='failed') ORDER BY id LIMIT 100`);
    for (const row of rows) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            const order = (await client.query(`SELECT * FROM orders WHERE id=$1 AND allocation_state='reserved' AND payment_status<>'paid'
        AND (reservation_expires_at<now() OR status='cancelled' OR payment_status='failed') FOR UPDATE SKIP LOCKED`, [row.id])).rows[0];
            if (order)
                await release(client, order);
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
        finally {
            client.release();
        }
    }
    await db.query("DELETE FROM fulfillment_quotes WHERE expires_at < now()-interval '1 day'");
}
async function bookShipments(client, tenantId, orderId) {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`automatic:${tenantId}:${orderId}`]);
    try {
        const order = (await client.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2', [tenantId, orderId])).rows[0];
        if (!order?.fulfillment_version)
            return null;
        if (order.payment_status !== 'paid' || order.allocation_state !== 'allocated' || order.status === 'cancelled')
            return { skipped: true, reason: 'not_ready' };
        // An interrupted HTTP call may already have created a shipment. Never
        // resend without an operator/provider confirming what happened.
        await client.query("UPDATE shipments SET booking_state='uncertain',booking_error='Booking interrupted. Reconcile this reference with NBOX before retrying.' WHERE tenant_id=$1 AND order_id=$2 AND booking_state='booking'", [tenantId, orderId]);
        const shipments = (await client.query("SELECT * FROM shipments WHERE tenant_id=$1 AND order_id=$2 AND booking_state='pending' ORDER BY external_reference", [tenantId, orderId])).rows;
        for (const s of shipments) {
            const lines = (await client.query(`SELECT i.*,a.quantity AS allocated_quantity FROM fulfillment_allocations a JOIN order_items i ON i.id=a.order_item_id
        WHERE a.tenant_id=$1 AND a.shipment_id=$2 AND a.state='allocated' ORDER BY i.id`, [tenantId, s.id])).rows;
            if (!lines.length)
                continue;
            await client.query("UPDATE shipments SET booking_state='booking',booking_started_at=now(),booking_error=NULL WHERE id=$1", [s.id]);
            try {
                const result = await nbox.createShipment({ orderNumber: s.external_reference, externalReference: s.external_reference, origin: s.origin_snapshot,
                    customer: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone }, shippingAddress: s.address,
                    items: lines.map(i => ({ name: i.product_name, quantity: i.allocated_quantity, price: i.unit_price_cents / 100, metadata: i.metadata })), shippingQuote: s.quote_snapshot });
                assertPos(result.id || result.orderId || result.trackingNumber, 502, 'MISSING_SHIPMENT_ID', 'NBOX response did not identify the shipment. Reconcile before retrying.');
                await client.query(`UPDATE shipments SET booking_state='booked',provider_shipment_id=$2,tracking_number=$3,tracking_url=$4,service=$5,booking_error=NULL WHERE id=$1`, [s.id, result.id || result.orderId || result.trackingNumber, result.trackingNumber || null, /^https:\/\//i.test(result.trackingUrl || '') ? result.trackingUrl : null, result.serviceName || 'NBOX']);
            }
            catch (err) {
                const status = Number(err.details?.status);
                const safeFailure = [400, 401, 403, 404, 422, 429].includes(status);
                await client.query('UPDATE shipments SET booking_state=$2,booking_error=$3 WHERE id=$1', [s.id, safeFailure ? 'failed' : 'uncertain', String(err.message).slice(0, 500)]);
            }
        }
        const list = await deliveryList(client, tenantId, orderId, true);
        return { created: true, failed: list.some(s => ['failed', 'uncertain'].includes(s.bookingState)), shipments: list };
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`automatic:${tenantId}:${orderId}`]);
    }
}
async function deliveryList(client, tenantId, orderId, internal = false) {
    const { rows } = await client.query(`SELECT s.*,l.name AS location_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.product_name,'size',i.size,'quantity',a.quantity)) FROM fulfillment_allocations a JOIN order_items i ON i.id=a.order_item_id WHERE a.shipment_id=s.id),'[]') AS items
    FROM shipments s LEFT JOIN stocktake_locations l ON l.id=s.origin_location_id WHERE s.tenant_id=$1 AND s.order_id=$2 ORDER BY s.external_reference,s.created_at`, [tenantId, orderId]);
    return rows.map(s => ({ id: s.id, status: s.status, trackingNumber: s.tracking_number, trackingUrl: /^https:\/\//i.test(s.tracking_url || '') ? s.tracking_url : null, amount: (s.delivery_cents || 0) / 100, items: s.items,
        ...(internal ? { location: s.location_name, reference: s.external_reference, bookingState: s.booking_state, bookingError: s.booking_error } : {}),
    }));
}
async function updateProgress(client, tenantId, orderId) {
    const rows = (await client.query('SELECT status FROM shipments WHERE tenant_id=$1 AND order_id=$2', [tenantId, orderId])).rows;
    const p = aggregateProgress(rows);
    await client.query(`UPDATE orders SET fulfillment_status=$3::order_fulfillment_status,
    status=CASE WHEN $3='delivered' THEN 'completed'::order_status WHEN $3='cancelled' THEN 'cancelled'::order_status WHEN $3='returned' THEN 'returned'::order_status ELSE status END,
    metadata=jsonb_set(metadata,'{deliveryProgress}',$4::jsonb,true),updated_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId, orderId, p.status, JSON.stringify(p)]);
    return p;
}
async function run() {
    await expireReservations();
    const orders = (await db.query(`SELECT tenant_id,id FROM orders WHERE fulfillment_version=1 AND payment_status='paid' AND status NOT IN ('cancelled','completed','refunded')
    AND (allocation_state IN ('reserved','released') OR EXISTS(SELECT 1 FROM shipments s WHERE s.order_id=orders.id AND s.booking_state IN ('pending','booking'))
      OR (allocation_state='allocated' AND metadata->'confirmation'->>'sentAt' IS NULL AND customer_email IS NOT NULL
        AND COALESCE(metadata->'confirmation'->>'nextAttemptAt','') <= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      OR NOT EXISTS(SELECT 1 FROM admin_notifications n WHERE n.entity_id=orders.id AND n.kind='order')
      OR ((allocation_state='exception' OR EXISTS(SELECT 1 FROM shipments s WHERE s.order_id=orders.id AND s.booking_state IN ('failed','uncertain'))) AND NOT EXISTS(SELECT 1 FROM admin_notifications n WHERE n.entity_id=orders.id AND n.kind='fulfillment_exception')))
    ORDER BY paid_at LIMIT 100`)).rows;
    for (const o of orders) {
        try {
            await processPaidOrder(o.tenant_id, o.id);
            const client = await db.pool.connect();
            try {
                await bookShipments(client, o.tenant_id, o.id);
                await require('./staff-notify').notifyNewWebOrder(client, o.tenant_id, o.id);
                await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`confirm:${o.id}`]);
                try {
                    await require('./order-confirmation').sendOrderConfirmedEmail(client, o.tenant_id, o.id);
                }
                finally {
                    await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`confirm:${o.id}`]);
                }
                await client.query(`INSERT INTO admin_notifications(tenant_id,kind,title,body,route,entity_type,entity_id)
          SELECT $1,'fulfillment_exception','Delivery needs attention','Check stock allocation or NBOX booking before dispatch.',$3,'order',$2
          WHERE EXISTS(SELECT 1 FROM orders WHERE id=$2 AND allocation_state='exception') OR EXISTS(SELECT 1 FROM shipments WHERE order_id=$2 AND booking_state IN ('failed','uncertain'))
          ON CONFLICT (tenant_id,kind,entity_id) WHERE entity_id IS NOT NULL DO NOTHING`, [o.tenant_id, o.id, `/orders?id=${o.id}`]);
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            logger.warn({ orderId: o.id, err: err.message }, 'Automatic fulfillment failed; will reconcile on next sweep');
        }
    }
}
function startWorker() {
    let busy = false;
    const tick = async () => { if (busy)
        return; busy = true; try {
        await run();
    }
    catch (err) {
        logger.warn({ err: err.message }, 'Fulfillment worker failed');
    }
    finally {
        busy = false;
    } };
    if (!process.env.DATABASE_URL)
        return () => { };
    const timer = setInterval(tick, 15000);
    timer.unref();
    return () => clearInterval(timer);
}
module.exports = { settings, configuration, saveSettings, createQuote, acceptedQuote, reserve, processPaidOrder, release, expireReservations, bookShipments, deliveryList, updateProgress, startWorker, run, fingerprint };
