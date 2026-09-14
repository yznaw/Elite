import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeOptions, defaultColor, defaultSize, colorState, productSoldOut, availableStock, selectedVariant } from '../projects/client-web/src/app/shared/stock-availability.ts';
import { colorKey, colorSlug } from '../../shared/color-key.js';
const product = { id:'test', name:'Shoe', price:50, tag:'', leather:'', style:'', image:'', sizes:[40,41,42,43], colors:['Green','Brown'], stock:99, variants:[
  {id:'g40',color:'Green',size:40,stock:0}, {id:'g41',color:'Green',size:41,stock:2,isActive:false},
  {id:'b40',color:'brwon',size:40,stock:0}, {id:'b41',color:'Brown',size:41,stock:2}, {id:'b42',color:'Brown',size:42,stock:0}, {id:'b43',color:'Brown',size:43,stock:3},
] };
test('available sizes sort first and defaults skip an unavailable first colour and size', () => {
  assert.deepEqual(sizeOptions(product, 'brown'), [{size:41,state:'available'},{size:43,state:'available'},{size:40,state:'sold-out'},{size:42,state:'sold-out'}]);
  assert.equal(defaultColor(product), 'Brown'); assert.equal(defaultSize(product,'Brown'),41);
  assert.equal(defaultColor(product,'green'),'Green'); assert.equal(defaultSize(product,'Green'),null);
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
  assert.equal(defaultColor(single),'Brown'); assert.equal(defaultSize(single,'Brown'),null);
  assert.equal(availableStock(single,'Green'),0); assert.equal(availableStock(single,'Brown'),3);
  assert.equal(availableStock({...single,variants:[],stock:4},null),4);
  assert.equal(productSoldOut({...single,variants:[],stock:0}),true);
  assert.equal(productSoldOut({...single,variants:[],stock:undefined}),true);
});
