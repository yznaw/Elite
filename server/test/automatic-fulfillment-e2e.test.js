const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config();
const run = crypto.randomUUID();
process.env.DEFAULT_TENANT_SLUG = `fulfillment-${run}`;
process.env.DEFAULT_ADMIN_EMAIL = `fulfillment-${run}@example.test`;
process.env.DEFAULT_ADMIN_PASSWORD = 'isolated-fulfillment-test';
process.env.SESSION_SECRET = `session-${run}`;
process.env.NBOX_WEBHOOK_SECRET = 'isolated-nbox-test-secret';
process.env.SADAD_SECRET_KEY = 'isolated-sadad-test-secret';
process.env.SADAD_MERCHANT_ID = 'isolated-test-merchant';
const db = require('../db/client');
const mailer = require('../lib/mailer');
mailer.sendMail = async () => ({ messageId: 'test' });
const { startServer } = require('../index');
const auto = require('../lib/automatic-fulfillment');
const nbox = require('../lib/nbox');
const { findLocationDrift, applyLocationDelta } = require('../lib/location-stock');
const { verify } = require('../lib/fulfillment-payment');
nbox.isConfigured = () => true;
const calls = [];
nbox.getDeliveryQuote = async ({ origin, items }) => { calls.push({ origin, items }); return { available: true, amount: origin.address === 'Shop A' ? 10 : 20, currency: 'QAR', serviceCode: 'NBOX' }; };
const bookings = [];
nbox.createShipment = async (p) => { bookings.push(p); return { id: `provider-${p.externalReference}`, trackingNumber: `track-${p.externalReference}`, serviceName: 'NBOX' }; };
test('automatic fulfillment: secure checkout, reservations, split booking and independent tracking', { timeout: 90000 }, async (t) => {
    if (!process.env.DATABASE_URL)
        return t.skip('Isolated DATABASE_URL required');
    const server = await startServer(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let tenant;
    t.after(async () => { await new Promise(r => server.close(r)); if (tenant) {
        await db.query('DELETE FROM fulfillment_allocations WHERE tenant_id=$1', [tenant]);
        await db.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    } await db.pool.end(); });
    const shopper = (seed = {}) => {
        const cookies = new Map(Object.entries(seed));
        return async (path, method = 'GET', body) => {
            const r = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(cookies.has('elite.csrf') ? { 'x-csrf-token': decodeURIComponent(cookies.get('elite.csrf')) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            for (const raw of r.headers.getSetCookie()) {
                const pair = raw.split(';')[0];
                const i = pair.indexOf('=');
                cookies.set(pair.slice(0, i), pair.slice(i + 1));
            }
            return { status: r.status, body: await r.json() };
        };
    };
    const admin = shopper();
    const guest = shopper();
    const attacker = shopper();
    const login = await admin('/auth/login', 'POST', { email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    tenant = login.body.data.tenantId;
    await db.query("INSERT INTO pos_branches(tenant_id,name) VALUES($1,'A'),($1,'B')", [tenant]);
    const product = (await db.query("INSERT INTO products(tenant_id,sku,brand,name,slug,status,base_price_cents,stock_quantity) VALUES($1,$2,'Elite','Test Shoes',$2,'active',1000,0) RETURNING id", [tenant, run])).rows[0].id;
    const make = async (size) => (await db.query("INSERT INTO product_variants(tenant_id,product_id,sku,barcode,size,price_cents,stock_quantity,is_active) VALUES($1,$2,$3,$3,$4,1000,0,true) RETURNING id", [tenant, product, run + size, size])).rows[0].id;
    const x = await make('40'), y = await make('41');
    assert.equal((await admin('/admin/inventory/per-location/activate', 'POST', {})).status, 200);
    const config = (await admin('/admin/inventory/automatic-fulfillment')).body.data;
    const shops = config.stockLocations.filter(l => l.type === 'store');
    const a = shops.find(l => l.name === 'A').id, b = shops.find(l => l.name === 'B').id, w = config.stockLocations.find(l => l.type === 'warehouse').id;
    const cfg = { fallbackId: w, locations: [a, b, w].map((id, i) => ({ id, origin: { address: ['Shop A', 'Shop B', 'Al Rayyan'][i], city: 'Doha', state: 'Doha', countryCode: 'QA', zip: '0000', phone: '97411111111' } })) };
    assert.equal((await guest('/admin/inventory/automatic-fulfillment', 'PUT', cfg)).status, 401, 'guest cannot alter origins');
    assert.equal((await admin('/admin/inventory/automatic-fulfillment', 'PUT', {locations:[],fallbackId:null})).status, 409, 'incomplete setup cannot enable delivery');
    const savedConfig = await admin('/admin/inventory/automatic-fulfillment', 'PUT', cfg);
    assert.equal(savedConfig.status, 200);
    assert.equal(savedConfig.body.data.enabled, true, 'valid settings activate delivery without a toggle');
    const receive = async (locationId, lines) => { const r = await admin('/admin/inventory/receipts', 'POST', { locationId, lines }); assert.equal(r.status, 201, JSON.stringify(r.body)); };
    await receive(a, [{ variantId: x, quantity: 2 }]);
    await receive(b, [{ variantId: y, quantity: 1 }]);
    const payload = { customer: { firstName: 'Test', lastName: 'Buyer', email: 'buyer@example.test', phone: '97411111111' }, shippingAddress: { line1: 'Customer address', city: 'Doha', country: 'Qatar' }, items: [{ id: product, variantId: x, size: '40', qty: 2, price: 0.01, grams: 0 }, { id: product, variantId: y, size: '41', qty: 1 }] };
    const quoted = await guest('/carts/shipping-quote', 'POST', payload);
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
    const quote = quoted.body.data;
    assert.equal(quote.shipmentCount, 2);
    assert.equal(quote.amount, 30);
    assert.equal(calls[0].items[0].price, 10, 'catalog price overrides tampering');
    assert.equal(calls[0].items[0].grams, undefined, 'untrusted dimensions omitted');
    await attacker('/carts/shipping-quote', 'POST', payload);
    const stolen = await attacker('/carts/checkout', 'POST', { ...payload, shippingQuote: quote });
    assert.equal(stolen.status, 409, 'quote belongs to the original session');
    const changed = await guest('/carts/checkout', 'POST', { ...payload, shippingAddress: { ...payload.shippingAddress, line1: 'Changed' }, shippingQuote: quote });
    assert.equal(changed.status, 409, 'destination bound to quote');
    const duplicate = await guest('/carts/shipping-quote', 'POST', { ...payload, items: [payload.items[0], payload.items[0]] });
    assert.equal(duplicate.status, 409);
    const placed = await guest('/carts/checkout', 'POST', { ...payload, shippingQuote: { ...quote, amount: 0.01 }, idempotencyKey: 'first' });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.data.total, 60, 'server sums goods and immutable quote');
    const id = placed.body.data.id;
    assert.equal((await admin(`/admin/orders/${id}/status`, 'PATCH', { payment: 'paid' })).status, 409, 'manual paid flag cannot bypass provider verification');
    const retry = await guest('/carts/checkout', 'POST', { ...payload, shippingQuote: quote, idempotencyKey: 'first' });
    assert.equal(retry.body.data.id, id);
    assert.deepEqual(await findLocationDrift(db.pool, tenant), [], 'reservation keeps stock invariant');
    const reserveRows = await db.query('SELECT * FROM fulfillment_allocations WHERE order_id=$1', [id]);
    assert.equal(reserveRows.rowCount, 2);
    const blocked = await guest('/carts/shipping-quote', 'POST', payload);
    assert.equal(blocked.status, 409, 'last units reserved');
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM product_variants WHERE id=$1 FOR UPDATE', [x]);
        await assert.rejects(applyLocationDelta(client, tenant, { variantId: x, locationId: a, delta: -1 }), { code: 'LOCATION_INSUFFICIENT_STOCK' });
        await client.query('ROLLBACK');
    }
    finally {
        client.release();
    }
    assert.equal(await verify(db.pool, id, { TXN_AMOUNT: '0.01' }, 'payment-one'), false, 'underpayment rejected');
    assert.equal(await verify(db.pool, id, {}, 'payment-one'), false, 'missing amount rejected');
    assert.equal(await verify(db.pool, id, { TXN_AMOUNT: '60.00' }, 'payment-one'), true);
    const callback = async (amount, valid = true) => {
        const payload = { ORDERID: id.replaceAll('-', ''), transaction_status: '3', transaction_number: 'payment-one', TXN_AMOUNT: amount };
        const checksumhash = valid ? require('../lib/sadad').generateSignature(payload, process.env.SADAD_SECRET_KEY) : 'invalid';
        return fetch(base + '/payments/sadad/callback', {
            method: 'POST', redirect: 'manual', headers: {
                'content-type': 'application/x-www-form-urlencoded',
                origin: 'null',
                cookie: 'elite.csrf=gateway-return-test',
            },
            body: new URLSearchParams({ ...payload, checksumhash }),
        });
    };
    assert.equal((await callback('60.00', false)).status, 302);
    assert.equal((await callback('0.01')).status, 302);
    assert.equal((await db.query('SELECT payment_status FROM orders WHERE id=$1', [id])).rows[0].payment_status, 'pending', 'forged or underpaid callbacks cannot fulfill');
    await Promise.all([callback('60.00'), callback('60.00')]);
    assert.equal((await db.query('SELECT payment_status FROM orders WHERE id=$1', [id])).rows[0].payment_status, 'paid');
    await Promise.all([auto.processPaidOrder(tenant, id), auto.processPaidOrder(tenant, id)]);
    assert.deepEqual(await findLocationDrift(db.pool, tenant), [], 'paid allocation keeps stock invariant');
    const c = await db.pool.connect();
    try {
        await auto.bookShipments(c, tenant, id);
        await auto.bookShipments(c, tenant, id);
    }
    finally {
        c.release();
    }
    assert.equal(bookings.length, 2, 'each child booked once');
    await auto.run();
    assert.ok((await db.query('SELECT metadata FROM orders WHERE id=$1', [id])).rows[0].metadata.confirmation.sentAt, 'worker sends confirmation without approval');
    assert.notEqual(bookings[0].externalReference, bookings[1].externalReference);
    assert.equal(bookings[0].items.length, 1);
    const details = await admin(`/admin/orders/${id}`);
    assert.equal(details.body.data.deliveries.length, 2);
    assert.equal(details.body.data.needsApproval, false);
    const child = details.body.data.deliveries;
    const webhook = require('../lib/fulfillment-webhook');
    const event = ref => ({ orderIdentifiers: [ref], shipmentId: '', trackingNumber: '', event: 'shipment.update', statusText: 'completed', eventId: crypto.randomUUID() });
    const wc = await db.pool.connect();
    try {
        await wc.query('BEGIN');
        await webhook.handle(wc, tenant, event(child[0].reference), { data: { status: 'completed' } });
        await wc.query('COMMIT');
        assert.equal((await db.query('SELECT metadata FROM orders WHERE id=$1', [id])).rows[0].metadata.deliveryProgress.label, 'partially_delivered');
        await wc.query('BEGIN');
        await webhook.handle(wc, tenant, event(child[1].reference), { data: { status: 'completed' } });
        await wc.query('COMMIT');
        assert.equal((await db.query('SELECT fulfillment_status FROM orders WHERE id=$1', [id])).rows[0].fulfillment_status, 'delivered');
        await wc.query('BEGIN');
        await webhook.handle(wc, tenant, { ...event(child[0].reference), statusText: 'new' }, { data: { status: 'new' } });
        await wc.query('COMMIT');
        assert.equal((await db.query('SELECT fulfillment_status FROM orders WHERE id=$1', [id])).rows[0].fulfillment_status, 'delivered', 'old update cannot regress delivery');
    }
    finally {
        wc.release();
    }
    assert.equal((await attacker(`/payments/delivery-status/${placed.body.data.orderNumber}`)).status, 404, 'other session cannot track order');
    const publicStatus = await guest(`/payments/delivery-status/${placed.body.data.orderNumber}`);
    assert.equal(publicStatus.status, 200);
    assert.equal(publicStatus.body.data.deliveries[0].location, undefined, 'internal locations excluded');
    await receive(w, [{ variantId: x, quantity: 3 }, { variantId: y, quantity: 2 }]);
    const fallback = await guest('/carts/shipping-quote', 'POST', payload);
    assert.equal(fallback.body.data.shipmentCount, 1);
    assert.equal(calls.at(-1).origin.address, 'Al Rayyan');
    const p2 = await guest('/carts/checkout', 'POST', { ...payload, shippingQuote: fallback.body.data, idempotencyKey: 'second' });
    assert.equal(p2.status, 201, JSON.stringify(p2.body));
    const id2 = p2.body.data.id;
    assert.equal(await verify(db.pool, id2, { TXN_AMOUNT: '50.00' }, 'payment-one'), false, 'provider transaction cannot pay two orders');
    await db.query("UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", [id2]);
    await auto.expireReservations();
    assert.equal((await db.query('SELECT allocation_state FROM orders WHERE id=$1', [id2])).rows[0].allocation_state, 'released');
    assert.deepEqual(await findLocationDrift(db.pool, tenant), [], 'expiry restores sellable stock once');
    await auto.expireReservations();
    assert.deepEqual(await findLocationDrift(db.pool, tenant), []);
    await db.query('UPDATE variant_location_stock SET quantity=0 WHERE variant_id=$1 AND location_id=$2', [x, w]);
    await db.query('UPDATE product_variants SET stock_quantity=0 WHERE id=$1', [x]);
    await db.query("UPDATE orders SET payment_status='paid' WHERE id=$1", [id2]);
    await auto.processPaidOrder(tenant, id2);
    assert.equal((await db.query('SELECT allocation_state FROM orders WHERE id=$1', [id2])).rows[0].allocation_state, 'exception', 'late payment is recorded but not oversold');
    // Booking ambiguity and operator reconciliation never duplicate a shipment.
    await receive(w, [{ variantId: x, quantity: 3 }]);
    const q3 = (await guest('/carts/shipping-quote', 'POST', payload)).body.data;
    const o3 = await guest('/carts/checkout', 'POST', { ...payload, shippingQuote: q3, idempotencyKey: 'third' });
    assert.equal(o3.status, 201, JSON.stringify(o3.body));
    const id3 = o3.body.data.id;
    await db.query("UPDATE orders SET payment_status='paid',paid_at=now() WHERE id=$1", [id3]);
    await auto.processPaidOrder(tenant, id3);
    const realCreate = nbox.createShipment;
    let ambiguousCalls = 0;
    nbox.createShipment = async () => { ambiguousCalls++; throw new Error('Network timeout after request'); };
    const bc = await db.pool.connect();
    try {
        await auto.bookShipments(bc, tenant, id3);
        await auto.bookShipments(bc, tenant, id3);
    }
    finally {
        bc.release();
    }
    assert.equal(ambiguousCalls, 1);
    nbox.createShipment = realCreate;
    let delivery = (await admin(`/admin/orders/${id3}`)).body.data.deliveries[0];
    assert.equal(delivery.bookingState, 'uncertain');
    const action = `/admin/orders/${id3}/deliveries/${delivery.id}/action`;
    assert.equal((await admin(action, 'POST', { action: 'retry' })).status, 409);
    assert.equal((await attacker(action, 'POST', { action: 'confirm_absent', confirmed: true, note: 'Confirmed in provider portal' })).status, 401);
    assert.equal((await admin(action, 'POST', { action: 'confirm_absent', confirmed: true, note: 'Confirmed in provider portal' })).status, 200);
    const rc = await db.pool.connect();
    try {
        await auto.bookShipments(rc, tenant, id3);
    }
    finally {
        rc.release();
    }
    nbox.cancelShipment = async () => ({ status: 'success' });
    assert.equal((await admin(action, 'POST', { action: 'cancel' })).status, 200);
    assert.equal((await admin(action, 'POST', { action: 'restore', confirmed: false })).status, 409, 'refund/cancel alone never restores physical stock');
    assert.equal((await admin(action, 'POST', { action: 'restore', confirmed: true })).status, 200);
    const stockAfter = (await db.query('SELECT stock_quantity FROM product_variants WHERE id=$1', [x])).rows[0].stock_quantity;
    assert.equal((await admin(action, 'POST', { action: 'restore', confirmed: true })).status, 200);
    assert.equal((await db.query('SELECT stock_quantity FROM product_variants WHERE id=$1', [x])).rows[0].stock_quantity, stockAfter, 'physical return is idempotent');
    // A late verified payment can still consume the original plan if available.
    const q4 = (await guest('/carts/shipping-quote', 'POST', payload)).body.data;
    const o4 = await guest('/carts/checkout', 'POST', { ...payload, shippingQuote: q4, idempotencyKey: 'fourth' });
    assert.equal(o4.status, 201, JSON.stringify(o4.body));
    const id4 = o4.body.data.id;
    await db.query("UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", [id4]);
    await auto.expireReservations();
    await db.query("UPDATE orders SET payment_status='paid',paid_at=now() WHERE id=$1", [id4]);
    assert.equal((await auto.processPaidOrder(tenant, id4)).applied, true, 'late payment recovers the original locations');
    assert.deepEqual(await findLocationDrift(db.pool, tenant), [], 'late recovery preserves stock accounting');
    // An unsigned courier event cannot change a booked delivery.
    const bad = await fetch(base + '/webhooks/nbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { orderReference: delivery.reference, status: 'completed' } }) });
    assert.equal(bad.status, 401);
    const signedBody = JSON.stringify({ event: 'shipment.update', eventId: 'signed-cancel', data: { orderReference: delivery.reference, status: 'new' } });
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', process.env.NBOX_WEBHOOK_SECRET).update(timestamp + '.' + signedBody).digest('hex');
    const signed = await fetch(base + '/webhooks/nbox', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nbox-timestamp': timestamp, 'x-nbox-signature': signature }, body: signedBody });
    assert.equal(signed.status, 200);
    assert.equal((await db.query('SELECT status FROM shipments WHERE id=$1', [delivery.id])).rows[0].status, 'cancelled', 'signed stale event cannot resurrect cancellation');
    await db.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [id]);
    assert.equal(await verify(db.pool, id, { TXN_AMOUNT: '60.00' }, 'payment-one'), false, 'success replay cannot undo a refund');
    // Session tenant, not the default tenant, controls access to order endpoints.
    const foreign = (await db.query("INSERT INTO tenants(slug,name,currency) VALUES($1,'Other store','QAR') RETURNING id", ['foreign-' + run])).rows[0].id;
    const bcrypt = require('bcryptjs');
    const foreignEmail = `other-${run}@example.test`;
    const foreignUser = (await db.query("INSERT INTO admin_users(tenant_id,email,full_name,initials,role,status,password_hash) VALUES($1,$2,'Other admin','OA','admin','active',$3) RETURNING id", [foreign, foreignEmail, await bcrypt.hash('isolated-password', 4)])).rows[0].id;
    // The app currently logs into one configured tenant; seed a real signed
    // session for the second tenant to exercise the middleware's boundary.
    const sid = crypto.randomUUID();
    await db.query("INSERT INTO admin_sessions(sid,sess,expire) VALUES($1,$2::json,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), httpOnly: true, path: '/' }, user: { id: foreignUser, tenantId: foreign, role: 'admin' } })]);
    const signature2 = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
    const foreignAdmin = shopper({ 'elite.sid': encodeURIComponent(`s:${sid}.${signature2}`), 'elite.csrf': 'test-csrf' });
    assert.equal((await foreignAdmin(`/admin/orders/${id}`)).status, 404);
    assert.equal((await foreignAdmin(action, 'POST', { action: 'retry' })).status, 404);
    await db.query('DELETE FROM tenants WHERE id=$1', [foreign]);
});
