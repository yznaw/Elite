#!/usr/bin/env node
/** Regression for a stale SSR route manifest after a storefront rebuild. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const client = resolve(fileURLToPath(new URL('..', import.meta.url)));
const built = join(client, 'dist/client-web');

test('missing SSR route serves the client shell while asset misses stay 404', async (t) => {
  // Keep the fixture under client/ so the bundled renderer can resolve any
  // externalized packages from this workspace's node_modules.
  const fixture = await mkdtemp(join(client, 'dist', 'ssr-fallback-'));
  await cp(join(built, 'server'), join(fixture, 'server'), { recursive: true });
  await mkdir(join(fixture, 'browser'));
  await cp(join(built, 'browser/index.csr.html'), join(fixture, 'browser/index.csr.html'));

  const manifestPath = join(fixture, 'server/angular-app-manifest.mjs');
  const manifest = await readFile(manifestPath, 'utf8');
  const start = manifest.indexOf('  routes: [');
  const end = manifest.indexOf('],\n  entryPointToBrowserMapping:', start);
  assert.ok(start >= 0 && end > start, 'expected Angular route manifest format');
  // Simulate an old in-memory renderer with only the home route. The built
  // browser still has /story; Angular SSR will return null for that page.
  await writeFile(manifestPath,
    `${manifest.slice(0, start)}  routes: [{ "renderMode": 0, "route": "/" }${manifest.slice(end)}`);

  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, [join(fixture, 'server/server.mjs')], {
    cwd: client,
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      API_ORIGIN: 'http://127.0.0.1:9', SITE_URL: 'https://elitecollections.qa' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
    await rm(fixture, { recursive: true, force: true });
  });

  const request = (path) => fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Host: 'elitecollections.qa', Accept: 'text/html' },
  });
  let response;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) break;
    try {
      response = await request('/story');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, `renderer did not start: ${output}`);
  assert.equal(response.status, 200, output);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /<!doctype html>/i);
  assert.equal((await request('/missing.js')).status, 404);
  assert.equal((await request('/api/missing')).status, 404);
});
