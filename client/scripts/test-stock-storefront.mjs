// Build client-web first. Runs against fixture API data; no customer requests or mail.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const client = resolve(import.meta.dirname, '..');
const asset = '/assets/brand/elite-logo-green.png';
const baseProduct = {id:'test-shoe',name:'Stock Test Shoe',nameAr:'حذاء التجربة',price:50,tag:'',leather:'Leather',style:'Sandal',image:asset,images:[asset],sizes:[40,41,42],colors:['Green','Brown'],stock:5,variants:[
  {id:'green40',size:40,color:'Green',stock:0},{id:'green41',size:41,color:'Green',stock:0},
  {id:'brown40',size:40,color:'brwon',stock:0},{id:'brown41',size:41,color:'Brown',stock:2},{id:'brown42',size:42,color:'Brown',stock:3},
]};
let products;let restockPosts;let stale;
function reset() {products=[structuredClone(baseProduct),{...structuredClone(baseProduct),id:'sold-out',name:'Sold Out Shoe',variants:baseProduct.variants.map(v=>({...v,stock:0}))},{...baseProduct,id:'one-size',name:'One Size',sizes:[],colors:[],variants:[],stock:0}];restockPosts=[];stale=false;}
reset();
function fixture(path,method,body) {
  if(path.endsWith('/restock-notifications')&&method==='POST') {
    restockPosts.push(body);
    if(stale) {products[0].variants.find(v=>v.id==='green40').stock=2;return {status:409,data:{success:false,code:'IN_STOCK'}};}
    return {status:201,data:{success:true,data:{id:'request'}}};
  }
  let data=[];
  if(path==='/api/products') data=products;
  else if(path==='/api/config') data={};
  else if(path==='/api/collections') data=[{id:'all-products',handle:'all-products',title:'All Products',description:'',productIds:products.map(p=>p.id),children:[],parentId:null,imageUrl:asset}];
  else if(path==='/api/ref/colors') data=[{nameEn:'Green',nameAr:'أخضر',hex:'#008000'},{nameEn:'Brown',nameAr:'بني',hex:'#654321'}];
  else if(path==='/api/carts/current') data={items:[]};
  else if(path.includes('/storefront-content')) data={};
  return {status:200,data:{success:true,data}};
}
const api=http.createServer(async(req,res)=>{
  let raw='';for await (const chunk of req) raw+=chunk;
  const result=fixture(new URL(req.url,'http://localhost').pathname,req.method,raw?JSON.parse(raw):null);
  res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.data));
});
await new Promise(r=>api.listen(4416,'127.0.0.1',r));
let logs='';
const ssr=spawn(process.execPath,[resolve(client,'dist/client-web/server/server.mjs')],{cwd:client,env:{...process.env,PORT:'4417',HOST:'127.0.0.1',API_ORIGIN:'http://127.0.0.1:4416',SITE_URL:'http://elitecollections.qa:4418'},stdio:['ignore','pipe','pipe']});
ssr.stdout.on('data',d=>logs+=d);ssr.stderr.on('data',d=>logs+=d);
const proxy=http.createServer((req,res)=>{
  const target=req.url.startsWith('/api/')?4416:4417;
  const upstream=http.request({host:'127.0.0.1',port:target,path:req.url,method:req.method,headers:{...req.headers,host:'elitecollections.qa:4418'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
});
await new Promise(r=>proxy.listen(4418,'127.0.0.1',r));
let browser;
const output=process.env.STOCK_BROWSER_OUTPUT||'/tmp/elite-stock-browser';await mkdir(output,{recursive:true});
try {
  for(let i=0;i<100&&!logs.includes('listening');i++) await new Promise(r=>setTimeout(r,100));
  assert.match(logs,/listening/);
  const html=await fetch('http://127.0.0.1:4418/collection/all-products/all').then(r=>r.text());
  assert.ok(html.includes('size-select-test-shoe'), 'collection is server rendered');assert.ok(html.includes('Stock Test Shoe'));
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];
  page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(/NG05\d\d/.test(msg.text()))errors.push(msg.text());});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='elitecollections.qa') {
      const response=await route.fetch({url:`http://127.0.0.1:4418${url.pathname}${url.search}`});await route.fulfill({response});
    } else if(url.protocol==='data:') await route.continue();else await route.abort();
  });
  const go=path=>page.goto('http://elitecollections.qa:4418'+path,{waitUntil:'networkidle'});
  await go('/collection/all-products/all');
  const tile=page.locator('.product-tile').filter({hasText:'Stock Test Shoe'});
  await tile.locator('.size-select').waitFor();assert.equal(await tile.locator('.size-select').inputValue(),'41');
  const options=await tile.locator('.size-select option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,disabled:n.disabled,text:n.textContent})));
  assert.deepEqual(options.map(o=>o.value),['41','42','40']);assert.equal(options[2].disabled,true);assert.match(options[2].text,/Sold out/);
  const before=(await tile.boundingBox()).height;
  await tile.locator('.product-color-swatch').first().hover();
  assert.equal(await tile.locator('.buy-now').count(),0);assert.match(await tile.locator('.quick-add').innerText(),/Notify Me/i);
  assert.ok(Math.abs((await tile.boundingBox()).height-before)<2,'card height stays fixed');
  await page.screenshot({path:output+'/collection.png',fullPage:true});
  await tile.locator('.quick-add').click();await page.locator('#restock-size').waitFor();
  assert.match(page.url(),/color=green.*notify=1/);assert.equal(await page.locator('#restock-size').inputValue(),'');
  await page.locator('#restock-email').fill('customer@example.test');await page.locator('#restock-panel button[type=submit]').click();assert.equal(restockPosts.length,0);
  await page.locator('#restock-size').selectOption('41');await page.locator('#restock-panel button[type=submit]').click();await page.locator('.restock-success').waitFor();assert.equal(restockPosts[0].size,41);
  await go('/product/test-shoe?color=brown&size=42');assert.match(await page.locator('.size-options .active').innerText(),/42/);
  const plus=page.locator('button[aria-label="Increase quantity"]');
  await plus.click();await plus.click();await expect(plus).toBeDisabled();
  await go('/product/sold-out?notify=1');assert.match(await page.locator('.stock-status').innerText(),/Out of stock/i);assert.equal(await page.locator('.add-cart-btn').count(),0);
  await go('/product/one-size?notify=1');assert.equal(await page.locator('#restock-size').count(),0);
  await page.locator('#restock-email').fill('one@example.test');await page.locator('#restock-panel button[type=submit]').click();await page.locator('.restock-success').waitFor();assert.equal('size' in restockPosts.at(-1),false);
  stale=true;await go('/product/test-shoe?color=Green&notify=1');await page.locator('#restock-size').selectOption('40');await page.locator('#restock-email').fill('stale@example.test');await page.locator('#restock-panel button[type=submit]').click();await page.locator('.cta-stack .add-cart-btn').waitFor();assert.match(await page.locator('.size-options .active').innerText(),/40/);
  await page.context().addCookies([{name:'elite_locale',value:'ar',domain:'elitecollections.qa',path:'/'}]);
  await page.evaluate(()=>localStorage.setItem('elite-web:locale','ar'));await page.setViewportSize({width:390,height:844});await go('/product/sold-out?notify=1');
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.match(await page.locator('.stock-status').innerText(),/نفد المخزون/);await page.screenshot({path:output+'/product-ar-mobile.png',fullPage:true});
  await go('/collection/all-products/all');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  assert.ok((await page.locator('.size-select option:disabled').allTextContents()).some(text=>text.includes('نفد')));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile collection stays within the viewport');
  await page.screenshot({path:output+'/collection-ar-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);assert.doesNotMatch(logs,/ReferenceError|TypeError|NG05\d\d/);
  console.log('PASS: SSR/hydration, collection defaults and sold-out states, fixed card height, exact restock size, quantity cap, one-size, 409 recovery, Arabic mobile.');
} finally {if(browser)await browser.close();ssr.kill('SIGTERM');await new Promise(r=>proxy.close(r));await new Promise(r=>api.close(r));}
