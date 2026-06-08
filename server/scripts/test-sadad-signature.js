/**
 * Run from the server directory:
 *   node scripts/test-sadad-signature.js
 *
 * Prints exactly what the signature string looks like so you can
 * spot any env-var or field-name issues.
 */
require('dotenv').config();
const crypto = require('crypto');

const secretKey  = process.env.SADAD_SECRET_KEY;
const merchantId = process.env.SADAD_MERCHANT_ID;
const website    = process.env.SADAD_WEBSITE;

console.log('\n=== Loaded env vars ===');
console.log('SADAD_MERCHANT_ID :', JSON.stringify(merchantId));
console.log('SADAD_SECRET_KEY  :', JSON.stringify(secretKey));
console.log('SADAD_WEBSITE     :', JSON.stringify(website));

// ── Approach A: section-7 style (8 fields, lowercase "email") ───────────────
const paramsA = {
  CALLBACK_URL : 'https://api.elitecollections.qa/api/payments/sadad/callback',
  MOBILE_NO    : '12345678',
  ORDER_ID     : 'ba44d6edd9354f818ef9370298065058',
  TXN_AMOUNT   : '800.00',
  WEBSITE      : website,
  email        : 'test@pay.com',
  merchant_id  : merchantId,
  txnDate      : '2026-06-08 21:41:26',
};

// ── Approach B: end-to-end style (9 fields, uppercase EMAIL + CUST_ID) ──────
const paramsB = {
  CALLBACK_URL : 'https://api.elitecollections.qa/api/payments/sadad/callback',
  CUST_ID      : 'ba44d6edd9354f818ef9370298065058',
  EMAIL        : 'test@pay.com',
  MOBILE_NO    : '12345678',
  ORDER_ID     : 'ba44d6edd9354f818ef9370298065058',
  TXN_AMOUNT   : '800.00',
  WEBSITE      : website,
  merchant_id  : merchantId,
  txnDate      : '2026-06-08 21:41:26',
};

function computeSig(params, key) {
  const sortedKeys = Object.keys(params).sort();
  let str = key;
  for (const k of sortedKeys) str += params[k];
  return {
    sortedKeys,
    string: str,
    sig: crypto.createHash('sha256').update(str).digest('hex').toUpperCase(),
  };
}

console.log('\n=== Approach A — section-7 style (lowercase email, no CUST_ID) ===');
const a = computeSig(paramsA, secretKey);
console.log('Sorted keys   :', a.sortedKeys);
console.log('String hashed :', JSON.stringify(a.string));
console.log('Signature     :', a.sig);

console.log('\n=== Approach B — end-to-end style (uppercase EMAIL + CUST_ID) ===');
const b = computeSig(paramsB, secretKey);
console.log('Sorted keys   :', b.sortedKeys);
console.log('String hashed :', JSON.stringify(b.string));
console.log('Signature     :', b.sig);

console.log('\n=== Signature sent to Sadad (from the failing request) ===');
console.log('B45262A1D34A5C40FA9D7F47023ECB82A9623C1E23DBBB7EDF489F905E202B3E');
console.log('\nMatch A?', a.sig === 'B45262A1D34A5C40FA9D7F47023ECB82A9623C1E23DBBB7EDF489F905E202B3E');
console.log('Match B?', b.sig === 'B45262A1D34A5C40FA9D7F47023ECB82A9623C1E23DBBB7EDF489F905E202B3E');
