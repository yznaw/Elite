const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');

const port = Number.parseInt(process.env.ELITE_POS_SIGNER_PORT || '8182', 10);
const certificatePath = process.env.ELITE_POS_QZ_CERT_PATH;
const privateKeyPath = process.env.ELITE_POS_QZ_KEY_PATH;
const allowedOrigins = new Set(String(process.env.ELITE_POS_ALLOWED_ORIGINS || 'http://localhost:4300')
  .split(',').map((value) => value.trim()).filter(Boolean));
const allowedPrinters = new Set(String(process.env.ELITE_POS_PRINTER_ALLOWLIST || '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const maxBytes = 128 * 1024;

function requiredFile(filePath, label) {
  if (!filePath) throw new Error(`${label} environment variable is required.`);
  return fs.readFileSync(filePath, 'utf8');
}

const certificate = requiredFile(certificatePath, 'ELITE_POS_QZ_CERT_PATH');
const privateKey = requiredFile(privateKeyPath, 'ELITE_POS_QZ_KEY_PATH');

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(body);
}

function allowedRequest(request) {
  if (Buffer.byteLength(request, 'utf8') > maxBytes) return false;
  let payload;
  try { payload = JSON.parse(request); } catch { return false; }
  const call = String(payload?.call || payload?.method || '').toLowerCase();
  if (!['websocket', 'print', 'printers.find', 'printers.getdefault', 'getversion'].includes(call)) return false;
  if (call === 'print') {
    const serialized = JSON.stringify(payload);
    return allowedPrinters.size > 0 && [...allowedPrinters].some((printer) => serialized.includes(printer));
  }
  return true;
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return send(res, 403, 'Origin denied.');
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, 'ok');
  if (req.method === 'GET' && req.url === '/qz/certificate') return send(res, 200, certificate);
  if (req.method !== 'POST' || req.url !== '/qz/sign') return send(res, 404, 'Not found.');

  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > maxBytes * 2) req.destroy();
  });
  req.on('end', () => {
    try {
      const request = JSON.parse(body).request;
      if (typeof request !== 'string' || !allowedRequest(request)) return send(res, 403, 'QZ request denied.');
      const signature = crypto.sign('RSA-SHA512', Buffer.from(request, 'utf8'), privateKey).toString('base64');
      return send(res, 200, signature);
    } catch {
      return send(res, 422, 'Invalid signing request.');
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Elite POS device signer listening on http://127.0.0.1:${port}`);
});
