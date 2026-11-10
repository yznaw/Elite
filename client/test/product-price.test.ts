import test from 'node:test';
import assert from 'node:assert/strict';
import { variantPrice, priceRange, displayPrice, sortPrice } from '../projects/client-web/src/app/shared/product-price.ts';

/**
 * Mirrors the three real products that prompted this: a colour that costs more than the
 * product's own price (Green Edition, 1000 → 1300), and a product whose cheapest size is
 * below it (Black Edition, base 1200, from 1000).
 */
const product = {
  id: 'p', name: 'Shoe', price: 1000, tag: '', leather: '', style: '', image: '',
  sizes: [40, 41], colors: ['Black', 'Brown', 'Sand'], stock: 9,
  variants: [
    { id: 'k40', color: 'Black', size: 40, stock: 1, price: 1000 },
    { id: 'k41', color: 'Black', size: 41, stock: 1, price: 1000 },
    { id: 'b40', color: 'Brown', size: 40, stock: 1, price: 1300 },
    { id: 'b41', color: 'Brown', size: 41, stock: 1, price: 1300 },
    // One colour whose own sizes disagree: the only case that draws a range once a
    // colour is chosen.
    { id: 's40', color: 'Sand', size: 40, stock: 1, price: 1150 },
    { id: 's41', color: 'Sand', size: 41, stock: 1, price: 1250 },
  ],
};

test('a variant price wins, and zero or missing falls back to the product', () => {
  assert.equal(variantPrice(product, { price: 1300 }), 1300);
  assert.equal(variantPrice(product, { price: 0 }), 1000);
  assert.equal(variantPrice(product, {}), 1000);
  assert.equal(variantPrice(product, null), 1000);
});

test('a colour is one number; the product spans its colours', () => {
  assert.deepEqual(displayPrice(product, 'Black'), { min: 1000, max: 1000, isRange: false });
  assert.deepEqual(displayPrice(product, 'Brown'), { min: 1300, max: 1300, isRange: false });
  assert.deepEqual(displayPrice(product), { min: 1000, max: 1300, isRange: true });
  assert.deepEqual(priceRange(product, 'brwon'), { min: 1300, max: 1300, isRange: false }, 'colour aliases resolve');
});

test('a colour whose sizes disagree draws a range until a size is chosen', () => {
  assert.deepEqual(displayPrice(product, 'Sand'), { min: 1150, max: 1250, isRange: true });
  assert.deepEqual(displayPrice(product, 'Sand', 41), { min: 1250, max: 1250, isRange: false });
  assert.deepEqual(displayPrice(product, 'Black', 41), { min: 1000, max: 1000, isRange: false });
});

test('an inactive variant is never priced, and a product with none uses its own price', () => {
  const hidden = { ...product, variants: product.variants.map(v => v.color === 'Brown' ? { ...v, isActive: false } : v) };
  assert.deepEqual(displayPrice(hidden), { min: 1000, max: 1250, isRange: true }, 'the hidden 1300 is gone');

  const plain = { ...product, variants: [] };
  assert.deepEqual(displayPrice(plain), { min: 1000, max: 1000, isRange: false });
  assert.deepEqual(displayPrice(plain, 'Black', 41), { min: 1000, max: 1000, isRange: false });

  // Variants that carry no price of their own are all the product's price.
  const unpriced = { ...product, variants: product.variants.map(({ price: _price, ...v }) => v) };
  assert.deepEqual(displayPrice(unpriced), { min: 1000, max: 1000, isRange: false });
});

test('sorting and filtering use the cheapest sellable price', () => {
  assert.equal(sortPrice(product), 1000);
  // Black Edition: the product says 1200, but a customer can buy it for 1000.
  assert.equal(sortPrice({ ...product, price: 1200 }), 1000);
  assert.equal(sortPrice({ ...product, variants: [] }), 1000);
});

test('a size that exists in one colour but not another does not leak across', () => {
  const odd = {
    ...product,
    variants: [...product.variants, { id: 'k42', color: 'Black', size: 42, stock: 1, price: 900 }],
  };
  assert.deepEqual(displayPrice(odd, 'Black', 42), { min: 900, max: 900, isRange: false });
  // Brown has no 42: fall back to Brown's span rather than borrowing Black's price.
  assert.deepEqual(displayPrice(odd, 'Brown', 42), { min: 1300, max: 1300, isRange: false });
});

test('two active variants for one colour and size: the price is the one the bag will add', () => {
  // Real data does this: the same shoe under two SKUs, priced differently, both active.
  const twin = {
    ...product,
    variants: [
      { id: 'x1', color: 'Black', size: 40, stock: 0, price: 1100 },
      { id: 'x2', color: 'Black', size: 40, stock: 2, price: 1200 },
      ...product.variants.filter(v => !(v.color === 'Black' && v.size === 40)),
    ],
  };
  // x1 is sold out, so the bag adds x2 — and that is the price shown.
  assert.deepEqual(displayPrice(twin, 'Black', 40), { min: 1200, max: 1200, isRange: false });
  // With neither in stock there is nothing to add: fall back to the span of that size.
  const none = { ...twin, variants: twin.variants.map(v => v.size === 40 && v.color === 'Black' ? { ...v, stock: 0 } : v) };
  assert.deepEqual(displayPrice(none, 'Black', 40), { min: 1100, max: 1200, isRange: true });
});
