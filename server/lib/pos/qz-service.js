const crypto = require('node:crypto');
const fs = require('node:fs');
const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty } = require('./errors');

const MAX_SIGNING_REQUEST_BYTES = 128 * 1024;
const SIGNING_WINDOW_MS = 60 * 1000;
const SIGNING_LIMIT = 120;
const signingWindows = new Map();

function loadConfiguredFile(variable, label) {
  const filePath = String(process.env[variable] || '').trim();
  assertPos(filePath, 503, 'QZ_NOT_CONFIGURED', `${label} is not configured.`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    assertPos(false, 503, 'QZ_NOT_CONFIGURED', `${label} could not be read.`);
  }
}

/**
 * QZ Tray's client library (qz-tray.js `_qz.websocket.setup` signing flow)
 * hashes the call payload (SHA-256 of `{ call, params, timestamp }`) BEFORE
 * asking the signature promise to sign it — the server only ever receives
 * that opaque hash digest, never the original call name/printer/params.
 * `JSON.parse()`-ing it and trying to allowlist by call type or printer
 * name (the previous implementation here) is therefore structurally
 * impossible: the hash is not JSON and never contains the printer name, so
 * every real signing request was being rejected with QZ_REQUEST_INVALID.
 *
 * The server's role in QZ's signing model is only to prove possession of
 * the private key for whatever digest the already-trusted client produced
 * — it is not a place that can verify *what* is being printed. That check
 * has to happen earlier, in this server's own /pos/transactions and print
 * endpoints (which already scope printing to an authenticated, enrolled
 * register), not by inspecting the QZ signing payload.
 *
 * TODO(security follow-up): if per-printer server-side enforcement is
 * needed later, it requires changing the client to send the plaintext
 * `{ call, params, timestamp }` alongside the hash so the server can
 * recompute and compare before signing — QZ Tray does not support this out
 * of the box today.
 */
function parseQzRequest(rawRequest) {
  const request = nonEmpty(rawRequest, 'request', MAX_SIGNING_REQUEST_BYTES);
  assertPos(Buffer.byteLength(request, 'utf8') <= MAX_SIGNING_REQUEST_BYTES, 413, 'QZ_REQUEST_TOO_LARGE', 'QZ signing request is too large.');
  return { request };
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
    // Every QZ call this register makes (print, drawer pulse, printer
    // discovery) gets signed through this one endpoint, and the payload is
    // an opaque hash (see parseQzRequest) — there is no way to tell which
    // kind of call this was from here, so log every signed request rather
    // than pretending to distinguish "drawer" from "print" as before.
    await audit(client, context, 'pos.qz-sign.approved', 'pos_register', register.id);
    return { signature };
  }).then((result) => {
    if (result.error) throw result.error;
    return result.signature;
  });
}

module.exports = { getQzCertificate, parseQzRequest, signQzRequest };
