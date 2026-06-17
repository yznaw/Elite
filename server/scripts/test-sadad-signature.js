require('dotenv').config();
const crypto = require('crypto');

const secretKey  = process.env.SADAD_SECRET_KEY;
const merchantId = process.env.SADAD_MERCHANT_ID;
const website    = process.env.SADAD_WEBSITE;

console.log('\n=== Loaded env vars ===');
console.log('SADAD_MERCHANT_ID :', JSON.stringify(merchantId));
console.log('SADAD_SECRET_KEY  :', secretKey ? '[set]' : '[missing]');
console.log('SADAD_WEBSITE     :', JSON.stringify(website));

function computeSig(params, key) {
  const sortedKeys = Object.keys(params).sort();
  let str = key;
  for (const k of sortedKeys) str += params[k];
  return {
    sortedKeys,
    string: str,
    sig: crypto.createHash('sha256').update(str).digest('hex'),
  };
}

const base = {
  CALLBACK_URL : 'https://elitecollections.qa/api/payments/sadad/callback',
  MOBILE_NO    : '12345678',
  ORDER_ID     : 'ba44d6edd9354f818ef9370298065058',
  TXN_AMOUNT   : '800.00',
  WEBSITE      : website,
  EMAIL        : 'test@pay.com',
  merchant_id  : merchantId,
  txnDate      : '2026-06-08 21:41:26',
};

const { sortedKeys, string, sig } = computeSig(base, secretKey);

console.log('\n=== Web Checkout 2.1 request signature ===');
console.log('Sorted keys:', sortedKeys);
console.log('String      :', string);
console.log('Signature   :', sig);
console.log('\nProduct detail fields are submitted in the form, but are not included in the signed data:');
console.log('productdetail[0][order_id] = ba44d6edd9354f818ef9370298065058');
console.log('productdetail[0][amount]   = 800.00');
console.log('productdetail[0][quantity] = 1');
