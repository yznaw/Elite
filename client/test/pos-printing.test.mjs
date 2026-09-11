import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

let browser;
let page;
let script;
const cut = '\x1dV\x01';
const feedAndCut = '\x1ba\x00\x1b2\x1bd\x06' + cut;

before(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/pos-printing.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage();
  // A local origin gives the real transaction method crypto.randomUUID().
  await page.route('http://localhost/**', (route) => route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }));
  await page.goto('http://localhost/');
  await page.addScriptTag({ content: script });
});
afterEach(async () => { await page?.close(); });

for (const kind of ['sale', 'refund', 'void', 'z-report']) {
  test(`${kind}: one complete, byte-aligned receipt and one feed/cut per job`, async () => {
    const result = await page.evaluate(async (kind) => {
      const { createHardware, receipt, report } = window.posPrinting;
      const { hardware, jobs } = createHardware();
      if (kind === 'z-report') await hardware.printZReport(report);
      else await hardware.printReceipt({ ...receipt, kind }, kind === 'sale');
      const { config, data } = jobs[0];
      const image = new Image();
      image.src = `data:image/png;base64,${data[1].data}`;
      await image.decode();
      return {
        jobs: jobs.length, options: config.config, prefix: data[0],
        image: { ...data[1], data: undefined }, width: image.width, height: image.height,
        footer: data[2], drawer: data[3],
      };
    }, kind);
    assert.equal(result.jobs, 1);
    assert.equal(result.width, 504);
    assert.equal(result.width % 8, 0, 'raster rows must fill whole bytes');
    assert.ok(result.height > 400 && result.height < 2000, 'height fits the content, without fixed pages');
    assert.equal(result.prefix, '\x1b@', 'reset printer state before the body');
    assert.equal(result.image.format, 'image');
    assert.equal(result.image.flavor, 'base64');
    assert.equal(result.image.options.quantization, 'luma');
    assert.equal(result.image.options.imageEncoding, 'gs_v_0');
    assert.equal(result.options.encoding, 'ISO-8859-1');
    assert.equal(result.options.scaleContent, false);
    assert.equal(result.options.margins, 0);
    assert.equal(result.options.units, 'mm');
    assert.equal(result.options.size.width, 80);
    assert.equal(result.options.size.custom, true);
    assert.ok(
      result.options.size.height > result.height / 180 * 25.4,
      'driver page includes the full raster body plus cutter/QR feed',
    );
    assert.ok(result.footer.endsWith(feedAndCut));
    assert.equal(result.footer.split(cut).length - 1, 1);
    if (kind === 'z-report') assert.equal(result.footer, feedAndCut);
    else {
      const qrPrint = result.footer.indexOf('\x1d(k\x03\x00\x31\x51\x30');
      assert.ok(qrPrint >= 0 && qrPrint < result.footer.indexOf(feedAndCut), 'QR prints before feed/cut');
    }
    assert.equal(result.drawer, kind === 'sale' ? '\x1bp\x00\x32\x32' : undefined);
  });
}

test('receipt paints large, one-bit bilingual business, price and transaction details', async () => {
  const result = await page.evaluate(async () => {
    const { createHardware, receipt } = window.posPrinting;
    const { renderer } = createHardware();
    const calls = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(value, ...args) {
      calls.push({ value: String(value), font: this.font });
      return original.call(this, value, ...args);
    };
    let rendered;
    try {
      rendered = await renderer.render(receipt, {
        tradeNameAr: 'مجموعة إيليت', tradeNameEn: 'Elite Collection',
        addressAr: 'الدوحة، قطر', addressEn: 'Doha, Qatar', phone: '12345678',
        crLicenseNumber: 'CR-100', returnPolicyAr: 'الاستبدال خلال 14 يوماً',
        returnPolicyEn: 'Exchange within 14 days', footerStampAr: null,
        footerStampEn: null, updatedAt: receipt.createdAt,
      });
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original;
    }
    const image = new Image();
    image.src = rendered.imageDataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    const oneBit = pixels.every((channel, index) => index % 4 === 3 ? channel === 255 : channel === 0 || channel === 255);
    return { text: calls.map((call) => call.value).join('\n'), calls, oneBit };
  });
  assert.match(result.text, /مجموعة إيليت/);
  assert.match(result.text, /الدوحة، قطر/);
  assert.match(result.text, /فاتورة/);
  assert.match(result.text, /الإجمالي/);
  assert.match(result.text, /طريقة الدفع/);
  assert.match(result.text, /ر\.ق/);
  assert.match(result.text, /السجل التجاري/);
  const fontSize = (text) => {
    const call = result.calls.find(({ value }) => value.includes(text));
    return Number(call?.font.match(/(\d+)px/)?.[1] || 0);
  };
  assert.ok(fontSize('Leather shoes') >= 20, 'product names use a print-safe size');
  assert.ok(fontSize('حذاء جلد') >= 21, 'Arabic product names use a print-safe size');
  assert.ok(fontSize('Exchange within 14 days') >= 16, 'policy text uses a print-safe size');
  assert.equal(result.oneBit, true, 'body is explicitly black and white before reaching the printer driver');
});

test('concurrent receipts are serialized before reaching the printer spooler', async () => {
  const result = await page.evaluate(async () => {
    const { createHardware, receipt } = window.posPrinting;
    const { hardware, qz } = createHardware();
    let calls = 0;
    let releaseFirst;
    qz.print = async () => {
      calls++;
      if (calls === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    };
    const first = hardware.printReceipt(receipt);
    const second = hardware.printReceipt({ ...receipt, receiptNumber: '1002' });
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const callsBeforeFirstFinished = calls;
    releaseFirst();
    await Promise.all([first, second]);
    return { callsBeforeFirstFinished, finalCalls: calls };
  });
  assert.equal(result.callsBeforeFirstFinished, 1);
  assert.equal(result.finalCalls, 2);
});

test('long bilingual receipt grows beyond the measuring canvas and keeps the footer', async () => {
  const result = await page.evaluate(async () => {
    const { createHardware, receipt } = window.posPrinting;
    const { renderer } = createHardware();
    const rendered = await renderer.render({
      ...receipt, items: Array.from({ length: 65 }, (_, i) => ({ ...receipt.items[0], name: `Item ${i + 1}` })),
    }, { returnPolicyEn: 'Refunds: Bring the original receipt.\nExchanges: Within 14 days.', returnPolicyAr: 'يرجى إحضار الإيصال الأصلي' });
    const image = new Image();
    image.src = rendered.imageDataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    // The lookup caption is the final body content; ink in its final 80 rows
    // proves the full second pass was drawn, including content past 4000px.
    const pixels = ctx.getImageData(0, image.height - 80, image.width, 80).data;
    return { width: image.width, height: image.height, tailHasInk: pixels.some((value, index) => index % 4 !== 3 && value < 128) };
  });
  assert.equal(result.width, 504);
  assert.ok(result.height > 4000);
  assert.equal(result.tailHasInk, true);
});

test('unresponsive optional business profile cannot prevent printing', { timeout: 10000 }, async () => {
  const result = await page.evaluate(async () => {
    const { createHardware, receipt } = window.posPrinting;
    const { hardware, pos, jobs } = createHardware();
    pos.businessProfile = () => new Promise(() => {});
    await hardware.printReceipt(receipt);
    return jobs.length;
  });
  assert.equal(result, 1);
});

for (const method of ['cash', 'card']) {
  test(`${method} sale automatically prints once after the sale has committed and busy is released`, async () => {
    const result = await page.evaluate(async (method) => {
      const fixture = window.posPrinting.createComponent();
      fixture.component.paymentMethod = () => method;
      fixture.component.terminalReference = method === 'card' ? 'approval-1001' : '';
      await fixture.component.completeSale();
      return { prints: fixture.printCalls, counts: fixture.counts, saved: !!fixture.component.lastSale(), events: fixture.events };
    }, method);
    assert.equal(result.counts.sales, 1);
    assert.equal(result.saved, true);
    assert.equal(result.prints.length, 1);
    assert.equal(result.prints[0].busy, false);
    assert.equal(result.prints[0].openDrawer, method === 'cash');
    assert.equal(result.events.length, 0);
  });
}

for (const kind of ['refund', 'void']) {
  test(`${kind} print failure is visible; retry prints the saved copy without another transaction or drawer pulse`, async () => {
    const result = await page.evaluate(async (kind) => {
      const fixture = window.posPrinting.createComponent(kind);
      const { component, events, printCalls, counts } = fixture;
      const originalPrint = component.hardware.printReceipt;
      component.hardware.printReceipt = async (...args) => {
        await originalPrint(...args);
        throw new Error('Printer paper out');
      };
      await component[kind === 'refund' ? 'refundCurrentTransaction' : 'voidCurrentTransaction']();
      const warning = events.find((event) => event.kind === 'warning');
      component.hardware.printReceipt = originalPrint;
      warning?.action?.run();
      await Promise.resolve();
      return { printCalls, counts, warning: warning && { ...warning, action: warning.action.label }, events: events.map(({ action, ...event }) => event) };
    }, kind);
    assert.equal(result.counts[kind === 'refund' ? 'refunds' : 'voids'], 1);
    assert.equal(result.warning?.duration, null);
    assert.equal(result.warning?.action, 'Retry print');
    assert.match(result.warning?.title, /receipt not printed/);
    assert.equal(result.printCalls.length, 2);
    assert.equal(result.printCalls[0].busy, false);
    assert.equal(result.printCalls[0].openDrawer, true);
    assert.equal(result.printCalls[1].openDrawer, false);
    assert.deepEqual(result.printCalls[0].data, result.printCalls[1].data);
    assert.ok(result.events.some((event) => event.kind === 'log' && event.detail.code === 'PRINT_FAILED'));
    assert.ok(!result.events.some((event) => event.kind === 'error'));
  });
}

test('refund prints before an optional transaction refresh, even when that refresh fails', async () => {
  const result = await page.evaluate(async () => {
    const { component, printCalls, events, counts } = window.posPrinting.createComponent('refund');
    let printsAtRefresh = 0;
    component.pos.findTransaction = async () => {
      printsAtRefresh = printCalls.length;
      throw new Error('Network unavailable');
    };
    await component.refundCurrentTransaction();
    return { printsAtRefresh, counts, events };
  });
  assert.equal(result.printsAtRefresh, 1);
  assert.equal(result.counts.refunds, 1);
  assert.ok(!result.events.some((event) => event.kind === 'error'));
});

test('a failed print rejects without resubmitting and the next receipt is a fresh job', async () => {
  const result = await page.evaluate(async () => {
    const { createHardware, receipt } = window.posPrinting;
    const { hardware, qz, jobs } = createHardware();
    const print = qz.print;
    let error;
    qz.print = async () => { throw new Error('Printer unavailable'); };
    try { await hardware.printReceipt(receipt); } catch (failure) { error = failure.message; }
    qz.print = print;
    await hardware.printReceipt({ ...receipt, receiptNumber: '1002', lookupCode: '#1002' });
    return { error, jobs: jobs.length, prefix: jobs[0].data[0], footer: jobs[0].data[2] };
  });
  assert.equal(result.error, 'Printer unavailable');
  assert.equal(result.jobs, 1);
  assert.equal(result.prefix, '\x1b@');
  assert.ok(result.footer.includes('#1002'));
  assert.ok(result.footer.endsWith(feedAndCut));
});
