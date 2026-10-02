const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NBOX_API_BASE_URL = 'https://carrier.example.test/api';
process.env.NBOX_API_TOKEN = 'test-token';
process.env.NBOX_SHOP_DOMAIN = 'test.example';
process.env.NBOX_RATE_ENDPOINT = '/rates';
process.env.NBOX_SHIPMENT_ENDPOINT = '/order';
delete process.env.NBOX_LOGIN_EMAIL;
delete process.env.NBOX_LOGIN_PASSWORD;
const nbox = require('../lib/nbox');
test('NBOX sends explicit origins and distinct child identifiers; missing rate is unavailable', async () => {
    const realFetch = global.fetch;
    const requests = [];
    let response = { rates: [{ service_code: 'NBOX', displayRate: 12, actualRate: 9, currency: 'QAR' }] };
    global.fetch = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, status: 200, text: async () => JSON.stringify(response) }; };
    try {
        const origin = { address: 'Al Rayyan', city: 'Doha', countryCode: 'QA', zip: '0000', latitude: 0, longitude: 0 };
        const destination = { line1: 'Customer', city: 'Doha', country: 'Qatar' };
        const items = [{ name: 'Sandal', quantity: 2, price: 10 }];
        const quote = await nbox.getDeliveryQuote({ origin, shippingAddress: destination, items });
        assert.equal(quote.amount, 12);
        assert.equal(requests[0].body.origin.address, 'Al Rayyan');
        assert.equal(requests[0].body.origin.lat, 0);
        assert.equal(requests[0].body.origin.lng, 0);
        response = { data: { shipment_id: 'NBOX-1', tracking_number: 'AWB1' } };
        for (const ref of ['EC-26-123-S1', 'EC-26-123-S2'])
            await nbox.createShipment({ origin, shippingAddress: destination, items, customer: { name: 'Buyer', phone: '97411111111' }, orderNumber: ref, externalReference: ref, shippingQuote: quote });
        assert.equal(requests[1].body.order.orderNumber, 'EC-26-123-S1');
        assert.equal(requests[2].body.order.orderNumber, 'EC-26-123-S2');
        assert.equal(requests[1].body.products[0].quantity, 2);
        assert.equal(requests[1].body.order.total, 32);
        response = { rates: [{ service_code: 'NBOX', currency: 'QAR' }] };
        assert.equal((await nbox.getDeliveryQuote({ origin, shippingAddress: destination, items })).available, false);
        response = { status: 'success' };
        await nbox.cancelShipment('EC-26-123-S1');
        assert.deepEqual(requests.at(-1).body, { orderNumber: 'EC-26-123-S1' });
    }
    finally {
        global.fetch = realFetch;
    }
});
