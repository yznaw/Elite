const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────
const SADAD_ENDPOINT = 'https://sadadqa.com/webpurchase';

// ─── Error class ─────────────────────────────────────────────────────────────
class SadadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SadadError';
    this.details = details;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function isConfigured() {
  return Boolean(env('SADAD_MERCHANT_ID') && env('SADAD_SECRET_KEY'));
}

// ─── Signature / Checksum ─────────────────────────────────────────────────────

/**
 * Generate a SADAD SHA256 signature.
 *
 * Algorithm (per official docs):
 *   1. Sort all params alphabetically by key
 *   2. Prefix string with the Secret Key
 *   3. Concatenate parameter VALUES only (no keys, no separators)
 *   4. SHA256 hash → uppercase hex
 *
 * @param {Record<string, string>} params  — must NOT include 'signature' or 'checksumhash'
 * @param {string} secretKey
 * @returns {string}  uppercase hex digest
 */
function generateSignature(params, secretKey) {
  const sortedKeys = Object.keys(params).sort();
  let str = secretKey;
  for (const k of sortedKeys) {
    str += params[k];
  }
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

/**
 * Verify a SADAD checksumhash received in a callback or webhook.
 *
 * @param {Record<string, string>} params  — all fields EXCEPT checksumhash
 * @param {string} receivedHash            — the checksumhash value from the payload
 * @param {string} [secretKey]             — defaults to SADAD_SECRET_KEY env var
 * @returns {boolean}
 */
function verifyChecksum(params, receivedHash, secretKey) {
  const key = secretKey || env('SADAD_SECRET_KEY');
  if (!key) return false;
  const generated = generateSignature(params, key);
  return generated.toLowerCase() === String(receivedHash || '').toLowerCase();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip hyphens from a UUID so it passes Sadad's alphanumeric-only validation.
 * e.g. "550e8400-e29b-41d4-a716-446655440000" → "550e8400e29b41d4a716446655440000"
 */
function stripUuidHyphens(id) {
  return String(id || '').replace(/-/g, '');
}

/**
 * Restore hyphens to a 32-char hex string returned by Sadad in the callback.
 * PostgreSQL also accepts the hyphen-less form, but this keeps things explicit.
 */
function restoreUuidHyphens(id) {
  const s = String(id || '').replace(/-/g, '');
  if (s.length !== 32) return id; // not a UUID — return as-is
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

/**
 * Normalise a phone number to digits only.
 * Sadad requires 8–15 digits with the country code prefix (e.g. 97412345678).
 */
function normalisePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 15) return digits;
  // Fallback: Qatar country code + stripped digits (truncated/padded to 11 digits)
  const bare = digits.replace(/^974/, '');
  const padded = bare.padEnd(8, '0').slice(0, 8);
  return `974${padded}`;
}

// ─── Payment request builder ──────────────────────────────────────────────────

/**
 * Build signed parameters for SADAD Web Checkout 2.1.
 *
 * The caller receives { params, productDetails, endpoint }.
 * The Angular client should create a hidden HTML form, add all these as hidden
 * inputs, and submit it — this redirects the customer to the SADAD payment page.
 *
 * @param {{
 *   orderId        : string,
 *   amount         : number,
 *   callbackUrl    : string,
 *   customer       : { id?: string, email: string, phone: string },
 *   items?         : Array<{ orderId: string|number, amount: number, quantity: number }>
 * }} opts
 */
function buildPaymentRequest(opts) {
  const secretKey  = env('SADAD_SECRET_KEY');
  const merchantId = env('SADAD_MERCHANT_ID');
  const website    = env('SADAD_WEBSITE', 'DEFAULT');

  if (!secretKey || !merchantId) {
    throw new SadadError(
      'Sadad is not configured — set SADAD_MERCHANT_ID and SADAD_SECRET_KEY in your .env',
    );
  }

  // txnDate format from Sadad docs: "YYYY-MM-DD HH:MM:SS"
  const txnDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // All params that will be included in signature (alphabetical sort happens inside generateSignature)
  // Sadad ORDER_ID must be alphanumeric only — strip UUID hyphens
  const sadadOrderId = stripUuidHyphens(opts.orderId);

  // ── Signed params ──────────────────────────────────────────────────────────
  // Use EXACTLY the 8 fields from Sadad docs section 7 (lowercase "email").
  // Sadad verifies against this predefined set — extra fields are ignored.
  const params = {
    CALLBACK_URL : opts.callbackUrl,
    MOBILE_NO    : normalisePhone(opts.customer.phone),
    ORDER_ID     : sadadOrderId,
    TXN_AMOUNT   : Number(opts.amount).toFixed(2),
    WEBSITE      : website,
    email        : opts.customer.email,   // lowercase — matches Sadad section 7
    merchant_id  : merchantId,
    txnDate,
  };

  // ── productdetail fields ───────────────────────────────────────────────────
  // Sadad requires productdetail AND includes ALL received form fields when
  // verifying the signature. So productdetail must be part of the signed params.
  const items = opts.items && opts.items.length > 0
    ? opts.items
    : [{ orderId: opts.orderId, amount: opts.amount, quantity: 1 }];

  items.forEach((item, i) => {
    params[`productdetail[${i}][order_id]`] = stripUuidHyphens(item.orderId);
    params[`productdetail[${i}][amount]`]   = Number(item.amount).toFixed(2);
    params[`productdetail[${i}][quantity]`] = String(item.quantity || 1);
  });

  params.signature = generateSignature(params, secretKey);

  // productDetails is empty — everything is already in params (all signed)
  const productDetails = {};

  return { params, productDetails, endpoint: SADAD_ENDPOINT };
}

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Map a SADAD numeric transactionStatus to the internal order payment status.
 *   1 → 'pending'  (In Progress — do NOT fulfil yet)
 *   2 → 'failed'
 *   3 → 'paid'
 */
function toOrderPaymentStatus(transactionStatus) {
  const code = Number(transactionStatus);
  if (code === 3) return 'paid';
  if (code === 2) return 'failed';
  return 'pending';
}

module.exports = {
  isConfigured,
  generateSignature,
  verifyChecksum,
  buildPaymentRequest,
  toOrderPaymentStatus,
  restoreUuidHyphens,
  SADAD_ENDPOINT,
  SadadError,
};
