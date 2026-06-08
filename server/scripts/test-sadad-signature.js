require('dotenv').config();
const crypto = require('crypto');

const secretKey  = process.env.SADAD_SECRET_KEY;
const merchantId = process.env.SADAD_MERCHANT_ID;
const website    = process.env.SADAD_WEBSITE;

console.log('\n=== Loaded env vars ===');
console.log('SADAD_MERCHANT_ID :', JSON.stringify(merchantId));
console.log('SADAD_SECRET_KEY  :', JSON.stringify(secretKey));
console.log('SADAD_WEBSITE     :', JSON.stringify(website));

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

const base = {
  CALLBACK_URL : 'https://api.elitecollections.qa/api/payments/sadad/callback',
  MOBILE_NO    : '12345678',
  ORDER_ID     : 'ba44d6edd9354f818ef9370298065058',
  TXN_AMOUNT   : '800.00',
  WEBSITE      : website,
  email        : 'test@pay.com',
  merchant_id  : merchantId,
  txnDate      : '2026-06-08 21:41:26',
};

// ── Theory A: 8 fields only, no productdetail ───────────────────────────────
const paramsA = { ...base };

// ── Theory B: productdetail as "Array" (PHP $POST array→string behaviour) ──
const paramsB = {
  ...base,
  productdetail: 'Array',   // PHP converts array fields to string "Array"
};

// ── Theory C: productdetail fields as literal keys (raw parsing) ────────────
const paramsC = {
  ...base,
  'productdetail[0][order_id]' : 'ba44d6edd9354f818ef9370298065058',
  'productdetail[0][amount]'   : '800.00',
  'productdetail[0][quantity]' : '1',
};

console.log('\n=== Theory A — 8 fields, no productdetail ===');
const a = computeSig(paramsA, secretKey);
console.log('Sorted keys:', a.sortedKeys);
console.log('Signature  :', a.sig);

console.log('\n=== Theory B — productdetail as "Array" (PHP $POST behaviour) ===');
const b = computeSig(paramsB, secretKey);
console.log('Sorted keys:', b.sortedKeys);
console.log('Signature  :', b.sig);

console.log('\n=== Theory C — productdetail as 3 literal keys ===');
const c = computeSig(paramsC, secretKey);
console.log('Sorted keys:', c.sortedKeys);
console.log('Signature  :', c.sig);

console.log('\n=== Which theory our code is currently using? ===');
console.log('Check the network tab for the "signature" field in the form POST to sadadqa.com');
console.log('and compare below:\n');
console.log('Theory A sig:', a.sig);
console.log('Theory B sig:', b.sig);
console.log('Theory C sig:', c.sig);
