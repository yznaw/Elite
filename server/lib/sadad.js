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
  const params = {
    CALLBACK_URL : opts.callbackUrl,
    CUST_ID      : opts.customer.id || opts.customer.email,
    EMAIL        : opts.customer.email,
    MOBILE_NO    : String(opts.customer.phone),
    ORDER_ID     : String(opts.orderId),
    TXN_AMOUNT   : Number(opts.amount).toFixed(2),
    WEBSITE      : website,
    merchant_id  : merchantId,
    txnDate,
  };

  params.signature = generateSignature(params, secretKey);

  // Product detail inputs — array notation used in the form
  const items = opts.items && opts.items.length > 0
    ? opts.items
    : [{ orderId: opts.orderId, amount: opts.amount, quantity: 1 }];

  const productDetails = {};
  items.forEach((item, i) => {
    productDetails[`productdetail[${i}][order_id]`] = String(item.orderId);
    productDetails[`productdetail[${i}][amount]`]   = Number(item.amount).toFixed(2);
    productDetails[`productdetail[${i}][quantity]`] = String(item.quantity || 1);
  });

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
  SADAD_ENDPOINT,
  SadadError,
};
