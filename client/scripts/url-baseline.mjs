#!/usr/bin/env node
/**
 * Snapshot how every public storefront URL answers, so a deploy can be proven
 * not to have changed any link it wasn't meant to.
 *
 *   node scripts/url-baseline.mjs capture <out.json> [origin]
 *   node scripts/url-baseline.mjs compare <before.json> <after.json>
 *
 * `capture` reads the live sitemap, adds the routes the sitemap deliberately
 * leaves out (checkout, thank-you, the kiosk page, the www host, a dead URL,
 * a payment-gateway return), and records for each: HTTP status, redirect
 * target, <title>, first <h1>, canonical and robots meta. Redirects are NOT
 * followed -- the redirect itself is the thing being checked.
 *
 * `compare` exits non-zero on any status or redirect change that isn't on the
 * EXPECTED list below. Title / h1 / canonical changes are printed as info
 * only: server rendering is supposed to change those (a CSR shell has no h1).
 */
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;

// Status/redirect changes that are the point of the SSR + slug work. Anything
// else that moves is a regression.
const EXPECTED = [
  {
    why: 'SSR returns a real 404 for unknown URLs instead of the 200 SPA shell',
    match: (url) => url.pathname === '/this-page-does-not-exist-baseline',
    ok: (b, a) => b.status === 200 && a.status === 404,
  },
  {
    why: 'SSR runs the Sadad return guard server-side and redirects instead of serving the shell',
    match: (url) => url.pathname === '/' && url.searchParams.has('order_id'),
    ok: (b, a) => b.status === 200
      && [301, 302, 303, 307, 308].includes(a.status)
      && /\/checkout\/failure/.test(a.location || ''),
  },
];

function extra(origin) {
  const o = new URL(origin);
  const www = `${o.protocol}//www.${o.host}`;
  return [
    `${origin}/checkout`,
    `${origin}/checkout/success`,
    `${origin}/checkout/failure`,
    `${origin}/checkout/pending`,
    `${origin}/thank-you`,
    `${origin}/experience`,
    `${origin}/this-page-does-not-exist-baseline`,
    `${origin}/?order_id=baseline-test`,
    `${www}/`,
    `${www}/contact`,
  ];
}

function pick(re, html) {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 160) : null;
}

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: ctrl.signal,
    });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('html') ? await res.text() : '';
    return {
      url,
      status: res.status,
      location: res.headers.get('location'),
      title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i, body),
      h1: pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i, body)?.replace(/<[^>]+>/g, '') ?? null,
      canonical: pick(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i, body),
      robots: pick(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/i, body),
      bytes: body.length,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { url, status: 0, error: String(err?.message || err), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function capture(out, origin = 'https://elitecollections.qa') {
  origin = origin.replace(/\/+$/, '');
  const sitemap = await (await fetch(`${origin}/sitemap.xml`, { headers: { 'user-agent': UA } })).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (locs.length === 0) throw new Error(`No <loc> entries found in ${origin}/sitemap.xml`);

  const urls = [...new Set([...locs, ...extra(origin)])];
  const results = new Array(urls.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < urls.length) {
      const i = next++;
      results[i] = await probe(urls[i]);
    }
  }));

  const snapshot = { capturedAt: new Date().toISOString(), origin, count: results.length, results };
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`);

  const failed = results.filter((r) => r.status === 0);
  const byStatus = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  console.log(`captured ${results.length} URLs -> ${out}`);
  console.log('status counts:', byStatus);
  if (failed.length) {
    console.log(`${failed.length} URL(s) failed to respond:`);
    for (const f of failed) console.log(`  ${f.url}  ${f.error}`);
  }
}

async function compare(beforePath, afterPath) {
  const before = JSON.parse(await readFile(beforePath, 'utf8'));
  const after = JSON.parse(await readFile(afterPath, 'utf8'));
  const afterByUrl = new Map(after.results.map((r) => [r.url, r]));

  const regressions = [];
  const expected = [];
  const info = [];

  for (const b of before.results) {
    const a = afterByUrl.get(b.url);
    if (!a) {
      // A URL leaving the sitemap is only fine if it still answers the same.
      regressions.push(`${b.url}: missing from the after snapshot (dropped from sitemap?) -- re-probe it`);
      continue;
    }
    const url = new URL(b.url);
    const statusMoved = b.status !== a.status || (b.location || null) !== (a.location || null);
    if (statusMoved) {
      const rule = EXPECTED.find((e) => e.match(url) && e.ok(b, a));
      const line = `${b.url}: ${b.status}${b.location ? ` -> ${b.location}` : ''}  =>  ${a.status}${a.location ? ` -> ${a.location}` : ''}`;
      if (rule) expected.push(`${line}\n      (${rule.why})`);
      else regressions.push(line);
    }
    for (const field of ['title', 'h1', 'canonical', 'robots']) {
      if ((b[field] ?? null) !== (a[field] ?? null)) {
        info.push(`${b.url}  ${field}: ${JSON.stringify(b[field] ?? null)} => ${JSON.stringify(a[field] ?? null)}`);
      }
    }
  }
  const beforeUrls = new Set(before.results.map((r) => r.url));
  for (const a of after.results) {
    if (!beforeUrls.has(a.url)) info.push(`new URL in after snapshot: ${a.url} (${a.status})`);
  }

  console.log(`before: ${before.capturedAt} (${before.count} URLs)`);
  console.log(`after:  ${after.capturedAt} (${after.count} URLs)\n`);
  if (expected.length) console.log(`EXPECTED changes (${expected.length}):\n  ${expected.join('\n  ')}\n`);
  if (info.length) console.log(`INFO (content only, not a failure) (${info.length}):\n  ${info.join('\n  ')}\n`);
  if (regressions.length) {
    console.log(`REGRESSIONS (${regressions.length}):\n  ${regressions.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('No link regressions.');
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'capture' && args[0]) await capture(args[0], args[1]);
else if (mode === 'compare' && args[0] && args[1]) await compare(args[0], args[1]);
else {
  console.error('usage:\n  node scripts/url-baseline.mjs capture <out.json> [origin]\n  node scripts/url-baseline.mjs compare <before.json> <after.json>');
  process.exitCode = 2;
}
