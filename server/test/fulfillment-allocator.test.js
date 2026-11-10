const test = require('node:test');
const assert = require('node:assert/strict');
const { allocate, aggregateProgress } = require('../lib/fulfillment-allocator');
const lines = [{ variantId: 'x', qty: 2 }, { variantId: 'y', qty: 1 }];
const loc = (id, stock, priority) => ({ id, stock, priority, origin: { address: id } });
test('complete shop takes precedence over warehouse', () => {
    const r = allocate(lines, [loc('a', { x: 2, y: 1 }, 0), loc('b', { x: 5, y: 4 }, 1), loc('w', { x: 9, y: 9 }, 2)], 'w');
    assert.deepEqual(r.map(l => l.locationId), ['a']);
});
test('complete Al Rayyan avoids two shop deliveries', () => {
    const r = allocate(lines, [loc('a', { x: 2 }, 0), loc('b', { y: 1 }, 1), loc('w', { x: 2, y: 1 }, 2)], 'w');
    assert.deepEqual(r.map(l => l.locationId), ['w']);
});
test('split quantities across origins without duplicating items', () => {
    const r = allocate(lines, [loc('a', { x: 1 }, 0), loc('b', { y: 1, x: 1 }, 1), loc('w', {}, 2)], 'w');
    assert.equal(r.length, 2);
    assert.equal(r.flatMap(l => l.items).filter(l => l.variantId === 'x').reduce((s, l) => s + l.qty, 0), 2);
});
test('uses fewest locations and permits three when all required', () => {
    const r = allocate(lines, [loc('a', { x: 1 }, 0), loc('b', { x: 1 }, 1), loc('w', { y: 1 }, 2)], 'w');
    assert.equal(r.length, 3);
    assert.throws(() => allocate(lines, [loc('a', {}, 0), loc('w', {}, 1)], 'w'), { code: 'INSUFFICIENT_STOCK' });
});
test('delivery completion waits for every active shipment', () => {
    assert.equal(aggregateProgress([{ status: 'delivered' }, { status: 'shipped' }]).label, 'partially_delivered');
    assert.equal(aggregateProgress([{ status: 'delivered' }, { status: 'delivered' }]).status, 'delivered');
    assert.equal(aggregateProgress([{ status: 'returned' }, { status: 'shipped' }]).status, 'shipped');
});
