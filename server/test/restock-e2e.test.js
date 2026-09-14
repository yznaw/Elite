const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
Object.assign(process.env, { DEFAULT_TENANT_SLUG:`restock-e2e-${runId}`, DEFAULT_TENANT_NAME:'Restock Test', DEFAULT_ADMIN_EMAIL:`restock-${runId}@elite.local`, DEFAULT_ADMIN_PASSWORD:'restock-test-password', SESSION_SECRET:`restock-test-${runId}` });
const db = require('../db/client');
const { startServer } = require('../index');
const { createRestockNotification } = require('../lib/restock-notifications');
const { runRestockDispatch, cleanupRestockNotifications } = require('../lib/restock-dispatch-job');
const { COLOR_ALIASES, colorKey } = require('../../shared/color-key');

test('restock API, worker, stock channels, consent and admin demand', {timeout:120000}, async t => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL required');
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const cookies = new Map(); let tenantId; let counter = 0;
  async function request(path, method='GET', body) {
    const form = body instanceof FormData;
    const res = await fetch(base+path, {method,headers:{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '), ...(cookies.has('elite.csrf')?{'x-csrf-token':decodeURIComponent(cookies.get('elite.csrf'))}:{}), ...(body && !form?{'content-type':'application/json'}:{})},body:body?form?body:JSON.stringify(body):undefined});
    for (const raw of res.headers.getSetCookie()) { const pair=raw.split(';')[0]; const i=pair.indexOf('='); cookies.set(pair.slice(0,i),pair.slice(i+1)); }
    const text = await res.text(); let data; try { data=JSON.parse(text); } catch { data=text; }
    return {status:res.status,body:data};
  }
  async function api(path,method,body) { const res=await request(path,method,body); assert.ok(res.status<400, JSON.stringify(res)); return res.body.data; }
  async function fixture({noVariants=false,size='41',color='brwon',stock=0}={}) {
    const key=`RESTOCK-${runId}-${++counter}`;
    const p=(await db.query("INSERT INTO products(tenant_id,sku,brand,name,slug,status,base_price_cents,stock_quantity) VALUES($1,$2,'Elite','Restock Shoe',$2,'active',5000,$3) RETURNING id",[tenantId,key,stock])).rows[0];
    let variant;
    if (!noVariants) variant=(await db.query('INSERT INTO product_variants(tenant_id,product_id,sku,size,color,price_cents,stock_quantity,is_active) VALUES($1,$2,$3,$4,$5,5000,$6,true) RETURNING id',[tenantId,p.id,key+'-V',size,color,stock])).rows[0];
    return {id:p.id,variantId:variant?.id,sku:key+'-V',size,color};
  }
  const setStock = (p,stock) => db.query(`UPDATE ${p.variantId?'product_variants':'products'} SET stock_quantity=$2 WHERE id=$1`,[p.variantId||p.id,stock]);
  const subscribe = p => createRestockNotification(db.pool,tenantId,{productId:p.id,email:`customer${++counter}@example.test`,size:p.size,color:p.color,locale:'ar'});
  const read = id => db.query('SELECT * FROM restock_notifications WHERE id=$1',[id]).then(r=>r.rows[0]);
  const dispatch = (p,extra={}) => runRestockDispatch({productIds:[p.id],smtpConfigured:true,sendMail:async()=>{},...extra});
  try {
    assert.equal((await request('/admin/restock-requests')).status,401);
    const user=await api('/auth/login','POST',{email:process.env.DEFAULT_ADMIN_EMAIL,password:process.env.DEFAULT_ADMIN_PASSWORD}); tenantId=user.tenantId;
    await db.query("INSERT INTO pos_branches(tenant_id,name,is_default) VALUES($1,'Test Shop',true)",[tenantId]);
    await t.test('validates exact combinations, aliases, active state, one-size and rate limits',async()=>{
      const p=await fixture();
      for (const [body,status] of [[{size:'99',color:'brown'},422],[{size:'41',color:'red'},422],[{color:'brown'},422],[{size:'41',color:'brown'},201]]) {
        assert.equal((await request(`/products/${p.id}/restock-notifications`,'POST',{email:'valid@example.test',...body})).status,status);
      }
      const row=(await db.query('SELECT * FROM restock_notifications WHERE product_id=$1',[p.id])).rows[0]; assert.equal(row.color_key,'brown'); assert.ok(row.unsubscribe_token);
      await setStock(p,3); assert.equal((await request(`/products/${p.id}/restock-notifications`,'POST',{email:'valid@example.test',size:'41',color:'brown'})).body.code,'IN_STOCK');
      await db.query("UPDATE products SET status='archived' WHERE id=$1",[p.id]); assert.equal((await read(row.id)).status,'cancelled');
      assert.equal((await request(`/products/${p.id}/restock-notifications`,'POST',{email:'valid@example.test',size:'41',color:'brown'})).status,404);
      const one=await fixture({noVariants:true,size:undefined,color:''});
      assert.equal((await request(`/products/${one.id}/restock-notifications`,'POST',{email:'one@example.test'})).status,201);
      assert.equal((await db.query('SELECT size FROM restock_notifications WHERE product_id=$1',[one.id])).rows[0].size,'ONE_SIZE');
      for(let i=7;i<10;i++) assert.notEqual((await request(`/products/${one.id}/restock-notifications`,'POST',{email:'one@example.test'})).status,429);
      assert.equal((await request(`/products/${one.id}/restock-notifications`,'POST',{email:'one@example.test'})).status,429);
      for(const alias of Object.keys(COLOR_ALIASES)) assert.equal((await db.query('SELECT restock_color_key($1) AS key',[` ${alias.toUpperCase()} `])).rows[0].key,colorKey(alias));
    });
    await t.test('concurrent dispatch claims each request once and rechecks stock',async()=>{
      const p=await fixture();const n=await subscribe(p);await setStock(p,3);const sent=[];
      await Promise.all([dispatch(p,{sendMail:async mail=>sent.push(mail)}),dispatch(p,{sendMail:async mail=>sent.push(mail)})]);
      assert.equal(sent.length,1);assert.match(sent[0].html,/dir="rtl"/);assert.equal((await read(n.id)).status,'notified');
      await setStock(p,0);const next=await subscribe(p);await setStock(p,1);
      const result=await dispatch(p,{beforeSend:()=>setStock(p,0),sendMail:async()=>assert.fail('stock sold out before send')});
      assert.equal(result.deferred,1);assert.equal((await read(next.id)).status,'pending');
    });
    await t.test('backoff, terminal failure, missing SMTP and crash recovery',async()=>{
      const p=await fixture();const n=await subscribe(p);await setStock(p,3);
      for(let attempt=1;attempt<=5;attempt++) {
        await dispatch(p,{sendMail:async()=>{throw new Error('SMTP outage');}});
        const row=await read(n.id);assert.equal(row.attempts,attempt);assert.equal(row.status,attempt===5?'failed':'pending');
        if(attempt<5) { assert.ok(new Date(row.next_attempt_at)>new Date()); await db.query('UPDATE restock_notifications SET next_attempt_at=now() WHERE id=$1',[n.id]); }
      }
      await setStock(p,0);const crash=await subscribe(p);await setStock(p,2);
      let alerts=0;await dispatch(p,{smtpConfigured:false,alert:async()=>alerts++});await dispatch(p,{smtpConfigured:false,alert:async()=>alerts++});
      assert.equal(alerts,1);assert.equal((await read(crash.id)).attempts,0);
      await db.query("UPDATE restock_notifications SET status='sending',claimed_at=now()-interval '16 minutes',claim_token=gen_random_uuid() WHERE id=$1",[crash.id]);
      await dispatch(p);assert.equal((await read(crash.id)).status,'notified');
    });
    for (const channel of ['adjustment','stocktake','bulk-stock','stock-import','product-edit','manual-sql','one-size-variant','variant-less']) {
      await t.test(`dispatch after ${channel} restocks`,async()=>{
        const p=await fixture(channel==='variant-less'?{noVariants:true,size:null,color:''}:channel==='one-size-variant'?{size:null}:{});
        const n=await subscribe(p);
        if(channel==='adjustment') await api('/admin/inventory/adjustments','POST',{variantId:p.variantId,delta:3,reason:'found',note:'Restock test'});
        else if(channel==='stocktake') {
          const st=await api('/admin/inventory/stocktakes','POST',{reference:`ST-${counter}`,blind:true,variantIds:[p.variantId]});
          await api(`/admin/inventory/stocktakes/${st.stocktakeId}/counts`,'POST',{variantId:p.variantId,quantity:3});
          await api(`/admin/inventory/stocktakes/${st.stocktakeId}/post`,'POST',{});
        } else if(channel==='bulk-stock') await api('/admin/products/bulk-stock','PATCH',{updates:[{sku:p.sku,stock:3}]});
        else if(channel==='stock-import') {
          const form=new FormData();form.append('csv',new Blob([`SKU,Stock\n${p.sku},3`],{type:'text/csv'}),'stock.csv');
          const preview=await api('/admin/bulk-import/stock/preview','POST',form);await api(`/admin/bulk-import/stock/${preview.jobId}/commit`,'POST',{});
        } else if(channel==='product-edit') {
          await api(`/admin/products/${p.id}`,'PATCH',{name:'Restock Shoe',price:50,status:'active',variants:[{id:p.variantId,sku:p.sku,size:'41',color:'brwon',price:50,stock:3}]});
        } else await setStock(p,3);
        const sent=[];await dispatch(p,{sendMail:async mail=>sent.push(mail)});assert.equal(sent.length,1);assert.equal((await read(n.id)).status,'notified');
      });
    }
    await t.test('catalog CSV updates wake an existing subscription',async()=>{
      const p=await fixture();const n=await subscribe(p);
      const row=(await db.query('SELECT sku FROM products WHERE id=$1',[p.id])).rows[0];
      const csv=`Product SKU,Variant SKU,English Name,Brand,Status,Selling Price,Quantity,Size,Color\n${row.sku},${p.sku},Restock Shoe,Elite,active,50,3,41,brwon`;
      const form=new FormData();form.append('csv',new Blob([csv],{type:'text/csv'}),'products.csv');
      const imported=await request('/admin/bulk-import?imageMode=ignore','POST',form);
      assert.equal(imported.status,200);assert.match(imported.body,/"type":"done"/);
      const sent=[];await dispatch(p,{sendMail:async mail=>sent.push(mail)});assert.equal(sent.length,1);assert.equal((await read(n.id)).status,'notified');
    });
    await t.test('paid web order reversal dispatches a restock alert',async()=>{
      const {ensurePaidOrderStock,reversePaidOrderStock}=require('../lib/order-stock');
      const p=await fixture({stock:1});
      const order=(await db.query(`INSERT INTO orders(tenant_id,public_number,customer_name,status,payment_status,fulfillment_status,subtotal_cents,shipping_cents,tax_cents,discount_cents,total_cents,shipping_address,billing_address,paid_at,metadata)
        VALUES($1,$2,'Web customer','completed','paid','processing',5000,0,0,0,5000,'{}','{}',now(),'{}') RETURNING id`,[tenantId,`WEB-${runId}`])).rows[0];
      await db.query(`INSERT INTO order_items(tenant_id,order_id,product_id,variant_id,sku,product_name,quantity,unit_price_cents,total_cents) VALUES($1,$2,$3,$4,$5,'Restock Shoe',1,5000,5000)`,[tenantId,order.id,p.id,p.variantId,p.sku]);
      assert.equal((await ensurePaidOrderStock(tenantId,order.id,{source:'test'})).applied,true);
      const n=await subscribe(p);assert.equal((await reversePaidOrderStock(tenantId,order.id,{reason:'cancelled'})).reversed,true);
      assert.equal((await dispatch(p)).sent,1);assert.equal((await read(n.id)).status,'notified');
    });
    await t.test('POS void and refund return sold-out selections to waiting customers',async()=>{
      const bcrypt=require('bcryptjs'); const pin='4471';
      await db.query(`INSERT INTO admin_users(tenant_id,email,password_hash,full_name,initials,role,status,pos_pin_hash) VALUES($1,$2,'unused','Test Manager','TM','manager','active',$3)`,[tenantId,`manager-${runId}@elite.local`,await bcrypt.hash(pin,10)]);
      const enrollment=await api('/pos/registers/enrollment-tokens','POST',{displayName:'Restock Test Register'});
      await api('/pos/registers/enroll','POST',{enrollmentToken:enrollment.token});
      const block=await api('/pos/registers/receipt-number-blocks','POST',{});
      const shift=await api('/pos/shifts/open','POST',{openingFloatCents:0});
      let receipt=block.start;
      for(const action of ['void','refund']) {
        const p=await fixture({stock:1});
        const sale=await api('/pos/transactions','POST',{idempotencyKey:`${action}-sale-${runId}`,receiptNumber:receipt++,shiftId:shift.shiftId,items:[{variantId:p.variantId,quantity:1,unitPriceCents:5000}],payment:{method:'cash',cashAmountCents:5000,cardAmountCents:0,amountTenderedCents:5000,changeGivenCents:0},clientCreatedAt:new Date().toISOString()});
        const n=await subscribe(p);const approval=await api('/pos/manager/verify-pin','POST',{pin,action});
        const override={managerOverrideId:approval.overrideId,managerOverrideToken:approval.token};
        if(action==='void') await api(`/pos/transactions/${sale.transactionId}/void`,'POST',{idempotencyKey:`void-${runId}`,voidReason:'Restock test',...override});
        else await api('/pos/refunds','POST',{idempotencyKey:`refund-${runId}`,receiptNumber:receipt++,shiftId:shift.shiftId,originalTransactionId:sale.transactionId,lines:[{transactionItemId:sale.items[0].id,quantity:1,restock:true}],refundMethod:'cash',reason:'Restock test',...override});
        assert.equal((await dispatch(p)).sent,1);assert.equal((await read(n.id)).status,'notified');
      }
    });
    await t.test('admin filters, CSV, retry/cancel and idempotent unsubscribe',async()=>{
      const p=await fixture();const n=await subscribe(p);
      const summary=await api(`/admin/restock-requests/summary?productId=${p.id}&status=pending`);assert.equal(summary[0].waiting_count,1);assert.equal(summary[0].current_stock,0);
      const list=await api(`/admin/restock-requests?productId=${p.id}`);assert.equal(list.total,1);
      const csv=await request(`/admin/restock-requests/export.csv?productId=${p.id}`);assert.match(csv.body,/customer/);
      await api(`/admin/restock-requests/${n.id}/resend`,'POST',{});assert.equal((await read(n.id)).status,'pending');
      const token=(await read(n.id)).unsubscribe_token;
      assert.equal((await request(`/restock-notifications/unsubscribe?token=${token}`)).status,200);
      assert.equal((await request(`/restock-notifications/unsubscribe?token=${token}`)).status,200);
      assert.equal((await request(`/admin/restock-requests/${n.id}/resend`,'POST',{})).status,409);
      await api(`/admin/restock-requests/${n.id}/cancel`,'POST',{});assert.equal((await read(n.id)).status,'cancelled');
      const other=await db.query("INSERT INTO tenants(slug,name) VALUES($1,'Other') RETURNING id",['other-'+runId]);
      const foreign=await db.query("INSERT INTO products(tenant_id,sku,brand,name,slug,status,base_price_cents) VALUES($1,'other','Elite','Other','other','active',5000) RETURNING id",[other.rows[0].id]);
      const f=await createRestockNotification(db.pool,other.rows[0].id,{productId:foreign.rows[0].id,email:'foreign@example.test'});
      assert.equal((await api(`/admin/restock-requests?productId=${foreign.rows[0].id}`)).total,0);
      assert.equal((await request(`/admin/restock-requests/${f.id}/cancel`,'POST',{})).status,409);
      await db.query('DELETE FROM tenants WHERE id=$1',[other.rows[0].id]);
    });
    await t.test('retention deletes old closed and pending rows while preserving recent consent',async()=>{
      const p=await fixture();
      const rows=await db.query(`INSERT INTO restock_notifications(tenant_id,product_id,email,size,color,status,requested_at,updated_at)
        SELECT $1,$2,'old'||n||'@example.test','41','brwon',s,now()-age,now()-age FROM (VALUES
          (1,'notified',interval '181 days'),(2,'cancelled',interval '181 days'),(3,'failed',interval '181 days'),(4,'pending',interval '366 days'),(5,'pending',interval '364 days')) AS x(n,s,age) RETURNING id`,[tenantId,p.id]);
      await cleanupRestockNotifications();assert.equal((await db.query('SELECT id FROM restock_notifications WHERE id=ANY($1::uuid[])',[rows.rows.map(r=>r.id)])).rowCount,1);
    });
  } finally { await new Promise(r=>server.close(r)); if(tenantId) await db.query('DELETE FROM tenants WHERE id=$1',[tenantId]); await db.pool.end(); }
});
