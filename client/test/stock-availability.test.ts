import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeOptions, defaultColor, colorStock, colorState, productSoldOut, availableStock, selectedVariant, carriedSize } from '../projects/client-web/src/app/shared/stock-availability.ts';
import { colorKey, colorSlug } from '../../shared/color-key.js';
const product = { id:'test', name:'Shoe', price:50, tag:'', leather:'', style:'', image:'', sizes:[40,41,42,43], colors:['Green','Brown'], stock:99, variants:[
  {id:'g40',color:'Green',size:40,stock:0}, {id:'g41',color:'Green',size:41,stock:2,isActive:false},
  {id:'b40',color:'brwon',size:40,stock:0}, {id:'b41',color:'Brown',size:41,stock:2}, {id:'b42',color:'Brown',size:42,stock:0}, {id:'b43',color:'Brown',size:43,stock:3},
] };
test('available sizes sort first and defaults skip an unavailable first colour and size', () => {
  assert.deepEqual(sizeOptions(product, 'brown'), [{size:41,state:'available'},{size:43,state:'available'},{size:40,state:'sold-out'},{size:42,state:'sold-out'}]);
  assert.equal(defaultColor(product), 'Brown');
  assert.equal(defaultColor(product,'green'),'Green');
  assert.equal(colorState(product,'Green'),'sold-out'); assert.equal(productSoldOut(product),false);
  assert.equal(availableStock(product,'Brown',41),2); assert.equal(selectedVariant(product,'Brown',41)?.id,'b41');
});
test('only offered sizes appear; inactive stock never makes a selection purchasable', () => {
  assert.deepEqual(sizeOptions(product,'Green'),[{size:40,state:'sold-out'},{size:41,state:'sold-out'}]);
  assert.equal(availableStock(product,'Green',41),0);
  assert.equal(productSoldOut({...product,variants:product.variants.map(v=>({...v,isActive:false}))}),true);
});
test('aliases, multiword colour links and Arabic colours normalize consistently', () => {
  assert.equal(colorKey(' Brwon '),'brown'); assert.equal(colorKey('serpertine'),'serpentine');
  assert.equal(defaultColor(product,'brwon'),'Brown');
  assert.equal(defaultColor({...product,colors:['Light Beige'],variants:[]},'lightbeige'),'Light Beige');
  assert.equal(colorSlug('أزرق'),'أزرق');
});
test('size-less variants scope stock to the selected colour; variant-less products use product stock', () => {
  const single = {...product,sizes:[],variants:[{color:'Green',stock:0},{color:'Brown',stock:3}]};
  assert.equal(defaultColor(single),'Brown');
  assert.equal(availableStock(single,'Green'),0); assert.equal(availableStock(single,'Brown'),3);
  assert.equal(availableStock({...single,variants:[],stock:4},null),4);
  assert.equal(productSoldOut({...single,variants:[],stock:0}),true);
  assert.equal(productSoldOut({...single,variants:[],stock:undefined}),true);
});

test('colour stock spans sizes, and asking availableStock for a null size does not', () => {
  // The max, never a sum: a cart line is one variant, so Brown's cap is b43's 3, not 2+3.
  assert.equal(colorStock(product,'Brown'),3);
  // g41 has stock but is inactive, so Green can't be bought at all.
  assert.equal(colorStock(product,'Green'),0);
  assert.equal(colorStock({...product,variants:[],stock:4},null),4);
  // The trap this helper exists for: a null size means "a variant with no size", so this is 0
  // even though Brown has stock in two sizes. Anything asking "can this be bought" must not
  // route through here with no size chosen.
  assert.equal(availableStock(product,'Brown',null),0);
});

test('a product can carry its sizes only on its variants', () => {
  // `product.sizes` is empty but the variants are sized. The storefront reads its size list from
  // `sizeOptions`, so this product must still present sizes and still require one before purchase;
  // keying off `product.sizes` instead left the purchase ungated.
  const variantOnly = { ...product, sizes: [], variants: [
    { id: 'v40', color: 'Brown', size: 40, stock: 0 },
    { id: 'v41', color: 'Brown', size: 41, stock: 2 },
  ] };
  assert.deepEqual(sizeOptions(variantOnly, 'Brown'), [{size:41,state:'available'},{size:40,state:'sold-out'}]);
  assert.equal(colorStock(variantOnly, 'Brown'), 2);

  // A genuinely sizeless product offers nothing to pick, so no size is ever demanded of it.
  const sizeless = { ...product, sizes: [], variants: [{ id: 's1', color: 'Brown', stock: 4 }] };
  assert.deepEqual(sizeOptions(sizeless, 'Brown'), []);
  assert.equal(colorStock(sizeless, 'Brown'), 4);
});

test('a picked size follows the customer to a colour only while it is in stock there', () => {
  // Brown 41 is in stock: picked on Brown it stays, and it follows to a colour where 41 is in stock.
  assert.equal(carriedSize(product, 41, 'Brown', 'Brown'), 41);
  const twin = {...product, variants:[...product.variants, {id:'k41',color:'Black',size:41,stock:1}]};
  assert.equal(carriedSize(twin, 41, 'Brown', 'Black'), 41);
  // Green 41 exists but cannot be bought (inactive): the size does not follow there.
  assert.equal(carriedSize(product, 41, 'Brown', 'Green'), null);
  // Brown 42 is sold out: kept on Brown where it was picked (a notify request)…
  assert.equal(carriedSize(product, 42, 'Brown', 'Brown'), 42);
  assert.equal(carriedSize(product, 42, ' brwon ', 'Brown'), 42, 'colour aliases and spacing do not matter');
  // …but not carried to Green, which does not offer 42 at all, nor anywhere it is sold out.
  assert.equal(carriedSize(product, 42, 'Brown', 'Green'), null);
  assert.equal(carriedSize(product, 40, 'Brown', 'Green'), null);
  assert.equal(carriedSize(product, 40, 'Green', 'Green'), 40);
  assert.equal(carriedSize(product, null, 'Brown', 'Brown'), null);
  assert.equal(carriedSize(product, undefined, undefined, 'Brown'), null);
});
