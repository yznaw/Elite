/* Security audit: executes actual route source in a VM with ONLY test doubles.
 * No database, network, environment files, mail, or delivery modules loaded.
 * The assertions confirm current vulnerabilities, not that the application is safe.
 * Run: node docs/security/2026-09-20/offline-proofs.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const baseline=process.argv.includes('--baseline');
const baselineRef='6f56ffe';
function source(file){return baseline ? require('node:child_process').execFileSync('git',['show',baselineRef+':'+file],{cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root,file),'utf8');}
const helpers = require(path.join(root, 'server/routes/lib.js'));
const tenantId='11111111-1111-4111-8111-111111111111';
const productId='22222222-2222-4222-8222-222222222222';
const variantId='33333333-3333-4333-8333-333333333333';
const orderId='44444444-4444-4444-8444-444444444444';
const cartId='55555555-5555-4555-8555-555555555555';
const results=[];
function harness(file, options={}) {
 const routes=[]; const queries=[]; const sideEffects=[]; let storedOrder; let legacyItems=options.legacyItems||[];
 const cart={id:cartId,tenant_id:tenantId,session_id:'session:other-customer',currency:'QAR',subtotal_cents:100};
 const client={release(){},async query(sql,args=[]) {
  const q=sql.replace(/\s+/g,' ').trim(); queries.push({sql:q,args});
  if(q.startsWith('SELECT * FROM contact_submissions')) return {rowCount:1,rows:[{name:'Synthetic customer',email:'synthetic@example.test',message:'Private enquiry'}]};
  if(q.startsWith('SELECT * FROM carts WHERE id')) return {rowCount:1,rows:[cart]};
  if(q.includes('FROM cart_items ci')) return {rowCount:legacyItems.length,rows:legacyItems};
  if(q.startsWith('SELECT p.id, p.name')) return {rowCount:1,rows:[{id:productId,name:'Test shoe',sku:'TEST',status:'active',base_price_cents:99900,has_variants:true}]};
  if(q.startsWith('SELECT sku, size, color')) return {rowCount:1,rows:[{sku:'TEST',size:'39',color:null,price_cents:99900,is_active:true}]};
  if(q.includes('FROM product_variants pv')) return {rowCount:1,rows:[{stock_quantity:1,is_active:true,name:'Test shoe',price_cents:99900}]};
  if(q.startsWith('INSERT INTO orders (')) {
   if(!q.includes('paid_at')){storedOrder={id:orderId,tenant_id:tenantId,public_number:args[1],payment_status:'pending',total_cents:args[6],subtotal_cents:args[6],shipping_cents:0};return {rowCount:1,rows:[storedOrder]};}
   storedOrder={id:orderId,tenant_id:tenantId,public_number:args[1],payment_status:args[6],subtotal_cents:args[8],shipping_cents:args[9],total_cents:args[10],fulfillment_status:'awaiting'};
   return {rowCount:1,rows:[storedOrder]};
  }
  if(q.includes('FROM orders') && q.includes('total_cents')) return {rowCount:1,rows:[{id:orderId,total_cents:options.order?.total_cents??99900,currency:'QAR',payment_status:'pending',customer_email:'other-customer@example.test',customer_phone:'97400000000'}]};
  if(q.startsWith('UPDATE orders SET payment_status') && q.includes('RETURNING tenant_id')) return {rowCount:1,rows:[{tenant_id:tenantId,public_number:'TEST-1'}]};
  return {rowCount:0,rows:[]};
 }};
 const db={pool:{connect:async()=>client,query:client.query},query:client.query};
 const mocks={
  express:{Router:()=>({get:(p,...h)=>routes.push({method:'GET',path:p,handlers:h}),post:(p,...h)=>routes.push({method:'POST',path:p,handlers:h}),delete:(p,...h)=>routes.push({method:'DELETE',path:p,handlers:h})})},
  '../db/client':db,
  '../lib/nbox':{isConfigured:()=>true,getDeliveryQuote:async()=>({available:true,amount:20,currency:'QAR'})},
  '../lib/mailer':{sendMail:async()=>{throw Error('Mail blocked in offline audit');}},
  '../lib/order-delivery':{nboxQuoteMetadata:q=>q,bookNboxForPaidOrder:async()=>{sideEffects.push('delivery booking');return {created:false};}},
  '../lib/order-receipt':{sendReceiptForPaidOrder:async()=>{sideEffects.push('receipt');}},
  '../lib/order-stock':{ensurePaidOrderStock:async()=>{sideEffects.push('stock application');}},
  '../db/tenant':{ensureDefaultTenant:async()=>({id:tenantId,currency:'QAR'})},
  '../lib/customer-identity':{resolveCustomer:async()=>({customerId:null})},
  '../lib/order-number':{insertWithRetry:async(_client,fn)=>fn('TEST-1')},
  './lib':helpers,
  '../lib/sadad':{
   buildPaymentRequest:opts=>({endpoint:'https://payment.invalid',params:{EMAIL:opts.customer.email,MOBILE_NO:opts.customer.phone,TXN_AMOUNT:opts.amount},productDetails:{}}),
   verifyChecksum:()=>true,restoreUuidHyphens:id=>id,toOrderPaymentStatus:s=>Number(s)===3?'paid':'pending'
  }
 };
 const context={require:name=>{if(!(name in mocks))throw Error('Blocked module '+name);return mocks[name];},module:{exports:{}},console:{log(){},warn(){},error(){}},process:{env:{}},Buffer,Date};
 vm.runInNewContext(source('server/routes/'+file),context,{filename:file});
 async function invoke(method,route,body={},params={}) {
  const entry=routes.find(r=>r.method===method&&r.path===route);assert.ok(entry);
  return new Promise((resolve,reject)=>{
   let status=200;const res={status(n){status=n;return this;},json(data){resolve({status,body:data});return this;},redirect(url){resolve({status:302,url});return this;}};
   const req={body,params,query:{},sessionID:'different-session',session:{},headers:{},protocol:'https',get:k=>k==='host'?'localhost':undefined};
   let n=0;const next=e=>{if(e)return reject(e);const fn=entry.handlers[n++];if(!fn)return reject(Error('no response'));try{Promise.resolve(fn(req,res,next)).catch(reject);}catch(e){reject(e);}};next();
  });
 }
 return {invoke,queries,sideEffects,getOrder:()=>storedOrder};
}
function checkout(patch={}) {return {customer:{name:'Security Test',email:'security@example.test',phone:'97400000000'},shippingAddress:{line1:'Local test only',city:'Doha',country:'Qatar'},items:[{id:productId,variantId,sku:'TEST',name:'Test shoe',price:999,qty:1,size:39}],shippingQuote:{available:true,amount:20,currency:'QAR'},...patch};}
async function proof(name,fn){await fn();results.push({name,result:'Assertion verified in isolated route harness'});}
(async()=>{
 await proof(baseline?'Historical: browser marks checkout paid':'Fixed: forged paid status is ignored',async()=>{
  const h=harness('carts.route.js');const r=await h.invoke('POST','/checkout',checkout({payment:{status:'paid'}}));
  assert.equal(r.status,201);assert.equal(h.getOrder().payment_status,baseline?'paid':'pending');assert.equal(h.sideEffects.includes('delivery booking'),baseline);assert.equal(h.sideEffects.includes('receipt'),baseline);
 });
 await proof(baseline?'Historical: browser sets item and shipping prices':'Fixed: catalog prices and server delivery quote override browser values',async()=>{
  const h=harness('carts.route.js');const r=await h.invoke('POST','/checkout',checkout({items:[{id:productId,variantId,price:0.01,qty:1,size:39}],shippingQuote:{available:true,amount:0}}));
  assert.equal(r.status,201);assert.equal(h.getOrder().total_cents,baseline?1:101900);assert.equal(h.getOrder().shipping_cents,baseline?0:2000);
 });
 await proof(baseline?'Historical: missing variant skips validation':'Fixed: missing variant rejected for a product with active variants',async()=>{
  const h=harness('carts.route.js');const r=await h.invoke('POST','/checkout',checkout({items:[{id:productId,price:999,qty:1,size:39}]}));
  assert.equal(r.status,baseline?201:409);if(baseline)assert.equal(h.queries.filter(q=>q.sql.includes('FROM product_variants')).length,0);
 });
 await proof('Duplicate variant lines exceed available stock without rejection',async()=>{
  const h=harness('carts.route.js');const line=checkout().items[0];const r=await h.invoke('POST','/checkout',checkout({items:[line,line]}));
  assert.equal(r.status,201);assert.equal(h.queries.filter(q=>q.sql.startsWith('INSERT INTO order_items')).length,2);
 });
 await proof('Guest session reads another cart by UUID, including session identifier',async()=>{
  const h=harness('carts.route.js');const r=await h.invoke('GET','/:id',{}, {id:cartId});
  assert.equal(r.status,200);assert.equal(r.body.data.session_id,'session:other-customer');
 });
 await proof('Unauthenticated payment initiation discloses another order contact fields',async()=>{
  const h=harness('payments.route.js');const r=await h.invoke('POST','/sadad/initiate',{orderId});
  assert.equal(r.status,200);assert.equal(r.body.data.params.EMAIL,'other-customer@example.test');
 });
 await proof('New guest checkout cancellation is scoped only by supplied email',async()=>{
  const h=harness('carts.route.js');await h.invoke('POST','/checkout',checkout());
  const q=h.queries.find(q=>q.sql.startsWith('UPDATE orders')&&q.sql.includes("payment_status = 'cancelled'"));assert.ok(q);assert.equal(q.args[1],'security@example.test');assert.ok(!q.sql.includes('session'));
 });
 await proof('Callback lacks amount reconciliation after successful checksum verification',async()=>{
  const h=harness('payments.route.js');await h.invoke('POST','/sadad/callback',{ORDERID:orderId,transaction_status:3,transaction_number:'OFFLINE-TEST',TXN_AMOUNT:'0.01',checksumhash:'test-double-valid'});
  assert.ok(h.sideEffects.includes('delivery booking'));assert.ok(!h.queries.some(q=>q.sql.includes('total_cents')));
 });
 await proof('Public contact route returns synthetic private enquiries with no session',async()=>{
  const h=harness('contact.route.js');const r=await h.invoke('GET','/');
  assert.equal(r.status,200);assert.equal(r.body.data[0].message,'Private enquiry');
 });
 await proof('Image MIME declaration permits unchanged HTML file storage',async()=>{
  let uploadOptions;const virtualFiles=[];
  const fakeFs={existsSync:()=>true,mkdirSync(){},promises:{writeFile:async(file,bytes)=>virtualFiles.push({file,bytes:bytes.toString()})}};
  function load(file,mocks){const ctx={require:n=>{if(!(n in mocks))throw Error('Blocked module '+n);return mocks[n];},module:{exports:{}},process:{env:{}},console:{warn(){}},__dirname:path.join(root,'server/lib')};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});return ctx.module.exports;}
  load('server/middleware/upload.js',{'multer':Object.assign(o=>{uploadOptions=o;return {};},{memoryStorage:()=>({})})});
  let accepted=false;uploadOptions.fileFilter({}, {mimetype:'image/png',originalname:'test.html'},(error,yes)=>{if(error)throw error;accepted=yes;});assert.ok(accepted);
  const lib=load('server/lib/storage.js',{'node:fs':fakeFs,'node:path':path,'node:crypto':require('node:crypto'),sharp:null});
  const contents='<!doctype html><title>INERT OFFLINE AUDIT</title>';
  const stored=await lib.storage.save({buffer:Buffer.from(contents),filename:'test.html',mimeType:'image/png'});
  assert.ok(stored.url.endsWith('.html'));assert.equal(virtualFiles[0].bytes,contents);
 });
 assert.equal(helpers.fromCents(1050),11);
 results.push({name:'Money conversion rounds QAR 10.50 to QAR 11',result:'CONFIRMED by actual shared helper'});
 await proof('Legacy cart checkout still uses client-priced cart rows for gateway amount',async()=>{
  const h=harness('carts.route.js',{legacyItems:[{product_id:productId,variant_id:variantId,sku:'TEST',product_name:'Test shoe',size:'39',quantity:1,unit_price_cents:100}]});
  const added=await h.invoke('POST','/:id/items',{productId,variantId,sku:'TEST',name:'Test shoe',quantity:1,price:1,size:'39'},{id:cartId});assert.equal(added.status,200);const insert=h.queries.find(q=>q.sql.startsWith('INSERT INTO cart_items'));assert.equal(insert.args[7],100);
  const r=await h.invoke('POST','/:id/checkout',{email:'security@example.test'},{id:cartId});assert.equal(r.status,201);assert.equal(h.getOrder().total_cents,100);assert.ok(!h.queries.some(q=>q.sql.includes('FROM products p')));
  const ph=harness('payments.route.js',{order:h.getOrder()});const pr=await ph.invoke('POST','/sadad/initiate',{orderId});assert.equal(pr.body.data.params.TXN_AMOUNT,1);
 });
 const output={revision:baseline?baselineRef:require('node:child_process').execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'Actual route source, mocked DB and external services; no production execution or database integration',results};
 fs.writeFileSync(path.join(__dirname,baseline?'historical-results.json':'offline-results.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
