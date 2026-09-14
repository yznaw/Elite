const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRestockEmail, storefrontBaseUrl } = require('../lib/restock-email');
const { normalizeSize } = require('../lib/restock-notifications');
const { colorKey } = require('../../shared/color-key');
const n = { product_id:'123', product_name:'Shoe <script>', product_name_ar:'حذاء', color:'Brwon', color_key:'brown', size:'41', base_price_cents:12000, unsubscribe_token:'token', locale:'en', product_image:'/uploads/shoe.jpg' };
test('emails are bilingual, escaped, link the exact variant and include consent', () => {
  const en = buildRestockEmail(n,'https://shop.example');
  assert.match(en.html, /Shoe &lt;script&gt;/); assert.match(en.text, /color=brown&size=41/); assert.match(en.text,/unsubscribe\?token=token/); assert.match(en.text,/limited/);
  const ar = buildRestockEmail({...n,locale:'ar'},'https://shop.example');
  assert.match(ar.html, /dir="rtl"/); assert.match(ar.subject,/حذاء/); assert.match(ar.text,/إلغاء الاشتراك/);
  assert.doesNotMatch(buildRestockEmail({...n,size:'ONE_SIZE'},'https://shop.example').text, /size=ONE_SIZE|size=0/);
});
test('production mail refuses missing, malformed and localhost URLs', () => {
  for (const url of ['', 'bad', 'http://localhost:4200', 'http://127.0.0.1', 'http://[::1]', 'http://store.localhost', 'file:///tmp/a']) {
    assert.throws(()=>storefrontBaseUrl({ NODE_ENV:'production', STOREFRONT_BASE_URL:url }));
  }
  assert.equal(storefrontBaseUrl({NODE_ENV:'production',STOREFRONT_BASE_URL:'https://elitecollections.qa/'}),'https://elitecollections.qa');
});
test('size-less sentinel and color aliases are deterministic', () => {
  assert.equal(normalizeSize(null),'ONE_SIZE'); assert.equal(normalizeSize(''),'ONE_SIZE'); assert.equal(normalizeSize('41'),'41'); assert.equal(colorKey(' brwon '),'brown');
});
