import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const outputDir = join(process.cwd(), 'dist', 'admin-portal', 'browser');
const indexPath = join(outputDir, 'index.html');
const workerPath = join(outputDir, 'pos-sw.js');

if (!existsSync(indexPath) || !existsSync(workerPath)) {
  throw new Error('Admin production output is missing. Build admin-portal before generating the POS precache.');
}

const files = readdirSync(outputDir).filter((name) => existsSync(join(outputDir, name)));
const assets = new Set();

function addLocalReference(reference) {
  const clean = reference.split(/[?#]/, 1)[0].replace(/^\.\//, '').replace(/^\//, '');
  if (!clean || clean.includes('://') || !existsSync(join(outputDir, clean))) return;
  assets.add(clean);
}

const indexHtml = readFileSync(indexPath, 'utf8');
for (const match of indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)) addLocalReference(match[1]);

for (const fixedAsset of [
  'manifest.webmanifest',
  'favicon.ico',
  'favicon-32x32.png',
  'favicon-192x192.png',
  'favicon-512x512.png',
  'apple-touch-icon.png',
]) addLocalReference(fixedAsset);

// The POS is a lazy route. Find its emitted chunk by stable UI copy rather
// than by a hashed filename, then follow only static imports. Following every
// dynamic import in main.js would precache the entire admin portal, which is
// wasteful on the Celeron register this build targets.
const posChunk = files
  .filter((name) => name.endsWith('.js'))
  .find((name) => readFileSync(join(outputDir, name), 'utf8').includes('Offline mode: sales are receipted locally'));

if (!posChunk) throw new Error('Could not identify the emitted POS route chunk.');
assets.add(posChunk);

const visitedJs = new Set();
function addStaticDependencies(name) {
  if (visitedJs.has(name)) return;
  visitedJs.add(name);
  const source = readFileSync(join(outputDir, name), 'utf8');
  const patterns = [
    /\bfrom\s*["']\.\/([^"']+\.js)["']/g,
    /\bimport\s*["']\.\/([^"']+\.js)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const dependency = basename(match[1]);
      if (!existsSync(join(outputDir, dependency))) continue;
      assets.add(dependency);
      addStaticDependencies(dependency);
    }
  }
}

for (const asset of [...assets]) {
  if (asset.endsWith('.js')) addStaticDependencies(asset);
}

// Include local font/image references emitted into the POS/global styles.
for (const css of [...assets].filter((name) => name.endsWith('.css'))) {
  const source = readFileSync(join(outputDir, css), 'utf8');
  for (const match of source.matchAll(/url\(["']?([^"')]+)["']?\)/g)) addLocalReference(match[1]);
}

const urls = [...assets].sort().map((name) => `/${name}`);
const hash = createHash('sha256');
for (const name of [...assets].sort()) {
  hash.update(name);
  hash.update(readFileSync(join(outputDir, name)));
}
const version = hash.digest('hex').slice(0, 16);

let worker = readFileSync(workerPath, 'utf8');
if (!worker.includes('__POS_CACHE_VERSION__') || !worker.includes('/*__POS_PRECACHE_URLS__*/')) {
  throw new Error('The copied POS service worker does not contain its build placeholders.');
}
worker = worker
  .replace('__POS_CACHE_VERSION__', version)
  .replace('/*__POS_PRECACHE_URLS__*/[]', JSON.stringify(urls));
writeFileSync(workerPath, worker);
writeFileSync(join(outputDir, 'pos-precache.json'), `${JSON.stringify({ version, posChunk: `/${posChunk}`, urls }, null, 2)}\n`);

console.log(`[pos-precache] ${urls.length} assets, version ${version}, route /${posChunk}`);
