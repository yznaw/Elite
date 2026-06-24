const crypto = require('node:crypto');
const fs = require('node:fs');
const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty } = require('./errors');

const MAX_SIGNING_REQUEST_BYTES = 128 * 1024;
const SIGNING_WINDOW_MS = 60 * 1000;
const SIGNING_LIMIT = 120;
const signingWindows = new Map();

function configuredPrinters() {
  return new Set(String(process.env.POS_PRINTER_ALLOWLIST || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function loadConfiguredFile(variable, label) {
  const filePath = String(process.env[variable] || '').trim();
  assertPos(filePath, 503, 'QZ_NOT_CONFIGURED', `${label} is not configured.`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    assertPos(false, 503, 'QZ_NOT_CONFIGURED', `${label} could not be read.`);
  }
}

function parseQzRequest(rawRequest) {
  const request = nonEmpty(rawRequest, 'request', MAX_SIGNING_REQUEST_BYTES);
  assertPos(Buffer.byteLength(request, 'utf8') <= MAX_SIGNING_REQUEST_BYTES, 413, 'QZ_REQUEST_TOO_LARGE', 'QZ signing request is too large.');
  let payload;
  try {
    payload = JSON.parse(request);
  } catch {
    assertPos(false, 422, 'QZ_REQUEST_INVALID', 'QZ signing request must be valid JSON.');
  }
  const call = String(payload?.call || payload?.method || '').toLowerCase();
  const allowedCall = call === 'websocket'
    || call === 'print'
    || call === 'printers.find'
    || call === 'printers.getdefault'
    || call === 'getversion';
  assertPos(allowedCall, 403, 'QZ_OPERATION_DENIED', `QZ operation ${call || 'unknown'} is not allowed.`);

  if (call === 'print') {
    const printers = configuredPrinters();
    assertPos(printers.size > 0, 503, 'QZ_PRINTERS_NOT_CONFIGURED', 'No POS printer allowlist is configured.');
    const serialized = JSON.stringify(payload);
    assertPos([...printers].some((printer) => serialized.includes(printer)), 403, 'QZ_PRINTER_DENIED', 'The requested printer is not approved for POS use.');
  }
  return { request, payload, call, drawerCommand: /(?:\\u0010\\u0014|\\u001b\\u0070|cash.?drawer)/i.test(request) };
}

function enforceRateLimit(registerId) {
  const now = Date.now();
  const current = signingWindows.get(registerId);
  if (!current || current.resetAt <= now) {
    signingWindows.set(registerId, { count: 1, resetAt: now + SIGNING_WINDOW_MS });
    return;
  }
  assertPos(current.count < SIGNING_LIMIT, 429, 'QZ_RATE_LIMITED', 'Too many QZ signing requests.');
  current.count += 1;
}

async function getQzCertificate(context) {
  return inTransaction(async (client) => {
    await requireRegister(client, context);
    return loadConfiguredFile('QZ_SIGNING_CERT_PATH', 'QZ signing certificate');
  });
}

async function signQzRequest(context, rawRequest) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    enforceRateLimit(register.id);
    let parsed;
    try {
      parsed = parseQzRequest(rawRequest);
    } catch (error) {
      await audit(client, context, 'pos.qz-sign.rejected', 'pos_register', register.id, {
        code: error.code || 'QZ_REQUEST_INVALID',
      });
      return { error };
    }
    const privateKey = loadConfiguredFile('QZ_SIGNING_KEY_PATH', 'QZ signing private key');
    const signature = crypto.sign('RSA-SHA512', Buffer.from(parsed.request, 'utf8'), privateKey).toString('base64');
    if (parsed.drawerCommand) {
      await audit(client, context, 'pos.drawer.command-signed', 'pos_register', register.id, { call: parsed.call });
    }
    return { signature };
  }).then((result) => {
    if (result.error) throw result.error;
    return result.signature;
  });
}

module.exports = { getQzCertificate, parseQzRequest, signQzRequest };
