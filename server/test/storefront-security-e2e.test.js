const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();
const run = crypto.randomUUID();
process.env.DEFAULT_TENANT_SLUG = `security-${run}`;
process.env.DEFAULT_TENANT_NAME = 'Security regression fixture';
process.env.DEFAULT_ADMIN_EMAIL = `owner-${run}@example.test`;
process.env.DEFAULT_ADMIN_PASSWORD = 'security-fixture-password';
process.env.SESSION_SECRET = `security-session-${run}`;
// Test-only local signing, never a gateway call or a delivery/email action.
process.env.SADAD_SECRET_KEY = 'isolated-security-test-key';
process.env.SADAD_MERCHANT_ID = 'test-merchant';
const mailer = require('../lib/mailer');
mailer.sendMail = async () => ({ sent: false });
const nbox = require('../lib/nbox');
nbox.isConfigured = () => false;
const db = require('../db/client');
const { startServer } = require('../index');
const { uploadsDir } = require('../lib/storage');
const sharp = require('sharp');

test('security boundaries: real sessions, PostgreSQL, pricing, roles and image decoding', { timeout: 120000 }, async t => {
  if (!process.env.DATABASE_URL) return t.skip('An isolated DATABASE_URL is required.');
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const files = [];
  let tenantId;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (tenantId) {
      await db.query('DELETE FROM carts WHERE tenant_id = $1', [tenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    for (const file of files) await fs.unlink(file).catch(() => {});
    await db.pool.end();
  });
  function shopper() {
    const cookies = new Map();
    return async (route, { method = 'GET', body, raw = false } = {}) => {
      const isForm = body instanceof FormData;
      const response = await fetch(`${base}${route.startsWith('/api/') || route.startsWith('/uploads/') ? route : '/api' + route}`, {
        method,
        headers: {
          ...(body && !isForm ? { 'content-type': 'application/json' } : {}),
          ...(cookies.size ? { cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') } : {}),
          ...(cookies.has('elite.csrf') ? { 'x-csrf-token': decodeURIComponent(cookies.get('elite.csrf')) } : {}),
        },
        ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
      });
      for (const entry of response.headers.getSetCookie()) {
        const pair = entry.split(';')[0];
        cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
      }
      const text = method === 'HEAD' ? '' : await response.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, body: data, headers: response.headers };
    };
  }
  const owner = shopper();
  const login = await owner('/auth/login', { method: 'POST', body: { email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  tenantId = login.body.data.tenantId;
  const p = await db.query(`INSERT INTO products (tenant_id,sku,brand,name,slug,status,base_price_cents,stock_quantity)
    VALUES ($1,$2,'Elite','Security shoe',$2,'active',100000,1) RETURNING id`, [tenantId, `shoe-${run}`]);
  const productId = p.rows[0].id;
  const v = await db.query(`INSERT INTO product_variants (tenant_id,product_id,sku,barcode,size,color,price_cents,stock_quantity,is_active)
    VALUES ($1,$2,$3,$3,'39','Black',100000,1,true) RETURNING id`, [tenantId, productId, `variant-${run}`]);
  const variantId = v.rows[0].id;
  const line = { productId, variantId, name: 'Forged name', sku: 'FORGED', size: 39, color: 'Black', qty: 1, price: 0.01 };
  const checkout = (items = [line], extra = {}) => ({
    customer: { name: 'Synthetic buyer', email: `buyer-${run}@example.test`, phone: '+97400000000' },
    shippingAddress: { line1: 'Local test address', city: 'Doha', country: 'Qatar' },
    items, shippingQuote: { available: true, amount: 0 }, ...extra,
  });
  const a = shopper(); const b = shopper();
  const cart = await a('/carts/current');
  assert.equal(cart.status, 200);
  assert.equal(cart.headers.get('cache-control'), 'no-store');
  const cartId = cart.body.data.id;

  await t.test('legacy routes reject every method without exposing raw carts', async () => {
    for (const [method, route] of [['POST','/carts'], ['GET',`/carts/${cartId}`], ['HEAD',`/carts/${cartId}`],
      ['POST',`/carts/${cartId}/items`], ['DELETE',`/carts/${cartId}/items/${crypto.randomUUID()}`], ['POST',`/carts/${cartId}/checkout`]]) {
      const r = await b(route, { method, ...(method === 'POST' ? { body: line } : {}) });
      assert.equal(r.status, 410, `${method} ${route}`);
    }
  });
  await t.test('catalog pricing and aggregate duplicate quantities protect checkout', async () => {
    const added = await a('/carts/current/items', { method: 'POST', body: line });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.data.items[0].price, 1000);
    assert.equal((await a('/carts/current/items', { method: 'POST', body: { ...line, size: '039' } })).status,409,'alternate size spelling cannot evade bag stock');
    const duplicate = await a('/carts/checkout', { method: 'POST', body: checkout([line, { ...line, variantId: variantId.toUpperCase(), productId: productId.toUpperCase(), size: '039' }]) });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'INSUFFICIENT_STOCK');
    assert.equal(duplicate.body.details[0].requested, 2);
    assert.equal(Number((await db.query('SELECT count(*) FROM orders WHERE tenant_id=$1',[tenantId])).rows[0].count), 0);
    for (const qty of [-1, 0, 0.5, 101, '1e100', true]) {
      const r = await a('/carts/checkout', { method: 'POST', body: checkout([{ ...line, qty }]) });
      assert.equal(r.status, 422, `quantity ${qty}`);
    }
    const plain = await db.query(`INSERT INTO products (tenant_id,sku,brand,name,slug,status,base_price_cents,stock_quantity)
      VALUES ($1,$2,'Elite','Plain shoe',$2,'active',50000,0) RETURNING id`, [tenantId, `plain-${run}`]);
    assert.equal((await a('/carts/current/items',{method:'POST',body:{productId:plain.rows[0].id,qty:1}})).status,409);
    const r = await a('/carts/checkout', { method: 'POST', body: checkout([{ productId: plain.rows[0].id, qty: 1 }]) });
    assert.equal(r.status, 409, 'base products must also pass stock checks');
  });
  await t.test('delivery charges are freshly quoted on the server', async () => {
    nbox.isConfigured = () => true;
    const saved = nbox.getDeliveryQuote;
    let quotedPrice;
    nbox.getDeliveryQuote = async payload => {
      quotedPrice = payload.items[0].price;
      return { available: true, amount: 25, currency: 'QAR' };
    };
    try {
      const r = await shopper()('/carts/checkout', { method: 'POST', body: checkout() });
      assert.equal(r.status,201);assert.equal(r.body.data.total,1025);assert.equal(quotedPrice,1000);
    } finally { nbox.isConfigured = () => false; nbox.getDeliveryQuote = saved; }
  });
  let orderId;
  await t.test('session ownership and scoped retry keys protect payment/customer data', async () => {
    const key = `same-client-key-${run}`;
    const request = checkout([line], { idempotencyKey: key, payment: { status: 'paid' } });
    const first = await a('/carts/checkout', { method: 'POST', body: request });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    orderId = first.body.data.id;
    assert.equal(first.body.data.total, 1000);
    assert.equal(first.body.data.payment, 'pending');
    const retries = await Promise.all([a('/carts/checkout',{method:'POST',body:request}), a('/carts/checkout',{method:'POST',body:request})]);
    for (const retry of retries) assert.equal(retry.body.data.id, orderId);
    for (const user of [b, shopper()]) {
      const init = await user('/payments/sadad/initiate', { method:'POST',body:{orderId} });
      assert.equal(init.status,404); assert.ok(!JSON.stringify(init.body).includes(request.customer.email));
      assert.equal((await user(`/payments/order-status/${orderId}`)).status,404);
    }
    const init = await a('/payments/sadad/initiate',{method:'POST',body:{orderId}});
    assert.equal(init.status,200);assert.equal(init.body.data.params.TXN_AMOUNT,'1000.00');
    assert.equal(init.headers.get('cache-control'),'no-store');
    const second = await b('/carts/checkout',{method:'POST',body:request});
    assert.equal(second.status,201);assert.notEqual(second.body.data.id,orderId);
    assert.equal((await a(`/payments/order-status/${orderId}`)).body.data.paymentStatus,'pending','same email cannot cancel another session');
    const noPriorCart = shopper();
    const third = await noPriorCart('/carts/checkout',{method:'POST',body:checkout()});
    assert.equal(third.status,201);
    assert.equal((await noPriorCart(`/payments/order-status/${third.body.data.id}`)).status,200,'checkout persists a new session');
    await db.query("UPDATE orders SET metadata = metadata - 'checkoutOwnerHash' WHERE id=$1",[third.body.data.id]);
    assert.equal((await noPriorCart('/payments/sadad/initiate',{method:'POST',body:{orderId:third.body.data.id}})).status,404,'old unbound orders fail closed');
  });
  await t.test('contact enquiries are private and staff writes deny viewer/cashier', async () => {
    await db.query(`INSERT INTO contact_submissions (tenant_id,name,email,message) VALUES ($1,'Fixture','private@example.test','PRIVATE FIXTURE')`,[tenantId]);
    for (const method of ['GET','HEAD']) assert.equal((await shopper()('/contact',{method})).status,404);
    assert.equal((await shopper()('/admin/contact')).status,401);
    const enquiries = await owner('/admin/contact?limit=1');
    assert.equal(enquiries.status,200);assert.equal(enquiries.body.data.length,1);
    assert.equal(enquiries.body.data[0].message,'PRIVATE FIXTURE');assert.ok(!('tenant_id' in enquiries.body.data[0]));
    const hash = await require('bcryptjs').hash('staff-fixture-password',10);
    for (const role of ['viewer','cashier']) {
      const email = `${role}-${run}@example.test`;
      await db.query(`INSERT INTO admin_users (tenant_id,email,password_hash,full_name,initials,role,status) VALUES ($1,$2,$3,$4,'TS',$5,'active')`,[tenantId,email,hash,role,role]);
      const user=shopper();assert.equal((await user('/auth/login',{method:'POST',body:{email,password:'staff-fixture-password'}})).status,200);
      for (const [method,route] of [['POST','products'],['PATCH',`products/${productId}`],['DELETE',`products/${productId}`],['POST','media'],['POST','collections'],['POST','policies'],['PUT','storefront/draft'],['POST','ref/colors']]) {
        assert.equal((await user(`/admin/${route}`,{method,body:{}})).status,403,`${role}: ${method} ${route}`);
      }
      assert.equal((await user('/admin/contact')).status,403);
      assert.equal((await user('/admin/products')).status,200,'read-only catalog access retained');
    }
  });
  await t.test('uploads validate actual bytes and rewrite filenames/content', async () => {
    async function upload(bytes, filename) {
      const form = new FormData();form.append('files',new Blob([bytes],{type:'image/png'}),filename);
      return owner('/admin/media',{method:'POST',body:form});
    }
    for (const bytes of [Buffer.from('<!doctype html><script>alert(1)</script>'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),Buffer.from([137,80,78,71,13,10,26,10])]) {
      assert.equal((await upload(bytes,'fake.png')).status,415,'MIME declaration cannot authorize invalid content');
    }
    const marker='INERT-TRAILING-HTML-MARKER';
    const png=await sharp({create:{width:16,height:16,channels:3,background:'#ffeedd'}}).png().toBuffer();
    const uploaded=await upload(Buffer.concat([png,Buffer.from(marker)]),'active.html');
    assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));
    const asset=uploaded.body.data[0];assert.ok(asset.storageUrl.endsWith('.webp'));
    const file=path.join(uploadsDir,path.basename(asset.storageUrl));files.push(file);
    const stored=await fs.readFile(file);assert.equal((await sharp(stored).metadata()).format,'webp');assert.ok(!stored.includes(Buffer.from(marker)));
    const served=await owner(asset.storageUrl);assert.equal(served.status,200);assert.equal(served.headers.get('x-content-type-options'),'nosniff');assert.ok(served.headers.get('content-security-policy').includes('sandbox'));
    const unsafe=path.join(uploadsDir,`old-${run}.html`);await fs.writeFile(unsafe,'<!doctype html>old fixture');files.push(unsafe);
    for (const prefix of ['/uploads/','/api/uploads/']) assert.equal((await owner(prefix+path.basename(unsafe))).status,404);
  });
});
