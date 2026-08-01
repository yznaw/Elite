import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist', 'admin-portal', 'browser');
const port = Number.parseInt(process.env.E2E_ADMIN_PORT || '4300', 10);
const apiOrigin = new URL(process.env.E2E_API_ORIGIN || 'http://127.0.0.1:3000');

if (!existsSync(join(root, 'index.html'))) {
  throw new Error(`Production admin build not found at ${root}. Run npm run build:admin first.`);
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function proxy(req, res) {
  const upstream = http.request({
    protocol: apiOrigin.protocol,
    hostname: apiOrigin.hostname,
    port: apiOrigin.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: apiOrigin.host },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`E2E API proxy failed: ${error.message}`);
  });
  req.pipe(upstream);
}

function sendFile(req, res, filePath) {
  const headers = {
    'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control': filePath.endsWith('pos-sw.js') || filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  return createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname;
  if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const candidate = resolve(root, relative);
  if (candidate.startsWith(`${root}/`) && existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(req, res, candidate);
    return;
  }

  // Angular owns extensionless application routes such as /login and /pos.
  if (!extname(pathname)) {
    sendFile(req, res, join(root, 'index.html'));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[pos-e2e-static] ${root} at http://127.0.0.1:${port}, API ${apiOrigin.origin}`);
});

