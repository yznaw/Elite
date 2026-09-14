import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const client=resolve(import.meta.dirname,'..');
const child=spawn(process.execPath,[resolve(client,'scripts/serve-pos-e2e.mjs')],{cwd:client,env:{...process.env,E2E_ADMIN_PORT:'4420'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
let browser;
try {
  for(let i=0;i<100&&!log.includes('at http');i++)await new Promise(r=>setTimeout(r,100));
  assert.match(log,/at http/);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const summary={product_id:'product',product_name:'Restock Shoe',color_key:'brown',color:'Brown',size:'41',total_count:2,waiting_count:2,current_stock:0,oldest_request:'2026-09-01T12:00:00Z'};
  let row={id:'request',product_id:'product',product_name:'Restock Shoe',color:'Brown',size:'41',email:'customer@example.test',locale:'ar',status:'pending',attempts:2,last_error:'Temporary SMTP outage',requested_at:'2026-09-01T12:00:00Z'};
  const calls=[];
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());calls.push(url.pathname+url.search);
    let data={};
    if(url.pathname.endsWith('/auth/me'))data={id:'owner',tenantId:'tenant',email:'owner@example.test',name:'Test Owner',role:'owner'};
    else if(url.pathname.endsWith('/restock-requests/summary'))data=[summary];
    else if(url.pathname.endsWith('/restock-requests'))data={rows:[row],total:1};
    else if(url.pathname.endsWith('/resend')) {row={...row,attempts:0,last_error:null};data=row;}
    else if(url.pathname.endsWith('/cancel')) {row={...row,status:'cancelled'};data=row;}
    await route.fulfill({json:{success:true,data}});
  });
  await page.goto('http://127.0.0.1:4420/restock-requests',{waitUntil:'networkidle'});
  await expect(page.locator('ap-topbar h1')).toHaveText('Restock Requests');
  const content=page.locator('ap-restock-requests');await expect(content.getByText('customer@example.test')).toBeVisible();
  await content.getByRole('button',{name:'View requests'}).click();
  await expect.poll(()=>calls.some(url=>url.includes('productId=product')&&url.includes('color=brown')&&url.includes('size=41'))).toBeTruthy();
  await content.getByRole('button',{name:'Resend now'}).click();await expect(content.getByText('Temporary SMTP outage')).toHaveCount(0);
  await content.locator('input[name=product]').fill('Shoe');await content.getByRole('button',{name:'Apply filters'}).click();
  await expect.poll(()=>calls.some(url=>url.includes('product=Shoe'))).toBeTruthy();
  await expect(content.getByRole('link',{name:'Export CSV'})).toHaveAttribute('href',/product=Shoe/);
  const output=process.env.STOCK_BROWSER_OUTPUT||'/tmp/elite-stock-browser';await mkdir(output,{recursive:true});await page.screenshot({path:output+'/admin.png',fullPage:true});
  await content.getByRole('button',{name:'Cancel',exact:true}).click();await expect(content.getByRole('button',{name:'Resend now'})).toHaveCount(0);
  await page.evaluate(()=>localStorage.setItem('elite-admin:locale','ar'));await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(content.getByRole('heading',{name:'طلبات توفر المخزون',exact:true})).toBeVisible();await page.screenshot({path:output+'/admin-ar-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: admin demand, detail filters, resend, cancel, CSV link, Arabic mobile.');
} finally {if(browser)await browser.close();child.kill('SIGTERM');}
