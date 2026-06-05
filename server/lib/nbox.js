const DEFAULT_ITEM_WEIGHT_GRAMS = 1000;

class NboxError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NboxError';
    this.details = details;
  }
}

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function isConfigured() {
  return Boolean(env('NBOX_API_BASE_URL') && env('NBOX_API_TOKEN'));
}

function endpointUrl(path) {
  const base = env('NBOX_API_BASE_URL').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  return `${base}/${cleanPath}`;
}

function authHeaders() {
  const token = env('NBOX_API_TOKEN');
  const apiKey = env('NBOX_API_KEY');
  const authHeader = env('NBOX_AUTH_HEADER', 'Authorization');
  const authScheme = env('NBOX_AUTH_SCHEME', 'Bearer');
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers[authHeader] = authScheme ? `${authScheme} ${token}` : token;
  }
  if (apiKey) headers['X-API-Key'] = apiKey;

  return headers;
}

function countryCode(country) {
  const value = String(country || '').trim().toLowerCase();
  const map = {
    qatar: 'QA',
    qa: 'QA',
    uae: 'AE',
    'united arab emirates': 'AE',
    kuwait: 'KW',
    'saudi arabia': 'SA',
    bahrain: 'BH',
    oman: 'OM',
  };
  return map[value] || String(country || 'QA').trim().toUpperCase();
}

function packageSummary(items) {
  const qty = items.reduce((sum, item) => sum + (Number(item.qty || item.quantity) || 1), 0);
  const defaultWeight = Number.parseInt(env('NBOX_DEFAULT_ITEM_WEIGHT_GRAMS'), 10) || DEFAULT_ITEM_WEIGHT_GRAMS;
  const totalWeight = items.reduce((sum, item) => {
    const itemQty = Number(item.qty || item.quantity) || 1;
    const grams = Number(item.weightGrams || item.weight_grams || item.weight) || defaultWeight;
    return sum + grams * itemQty;
  }, 0);

  return {
    pieces: Math.max(1, qty),
    weight_grams: Math.max(defaultWeight, totalWeight),
    weight_kg: Math.max(defaultWeight, totalWeight) / 1000,
  };
}

function originAddress() {
  return {
    name: env('NBOX_ORIGIN_NAME', 'Elite Collections'),
    phone: env('NBOX_ORIGIN_PHONE'),
    email: env('NBOX_ORIGIN_EMAIL'),
    line1: env('NBOX_ORIGIN_ADDRESS'),
    city: env('NBOX_ORIGIN_CITY', 'Doha'),
    country: countryCode(env('NBOX_ORIGIN_COUNTRY', 'QA')),
  };
}

function destinationAddress(address = {}, customer = {}) {
  return {
    name: address.fullName || customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    phone: address.phone || customer.phone || '',
    email: customer.email || '',
    line1: address.line1 || address.address || '',
    city: address.city || '',
    country: countryCode(address.country || 'QA'),
  };
}

function buildShipmentPayload({ orderNumber, customer, shippingAddress, items, shippingQuote }) {
  const packages = packageSummary(items);
  const destination = destinationAddress(shippingAddress, customer);
  const origin = originAddress();

  return {
    reference: orderNumber,
    order_number: orderNumber,
    service_code: shippingQuote?.serviceCode || shippingQuote?.service_code || env('NBOX_DEFAULT_SERVICE_CODE'),
    rate_id: shippingQuote?.id || shippingQuote?.rateId || shippingQuote?.rate_id || null,
    origin,
    destination,
    recipient: destination,
    package: packages,
    packages: [packages],
    items: items.map((item) => ({
      sku: item.sku || item.id || item.productId || '',
      name: item.name || item.productName || 'Item',
      quantity: Number(item.qty || item.quantity) || 1,
      value: Number(item.price) || 0,
      currency: 'QAR',
    })),
  };
}

async function postJson(path, payload) {
  if (!isConfigured()) {
    throw new NboxError('NBOX API is not configured.', { configured: false });
  }

  const response = await fetch(endpointUrl(path), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new NboxError(`NBOX API returned ${response.status}.`, {
      status: response.status,
      data,
    });
  }

  return data;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function rateCandidates(response) {
  const data = response?.data || response?.payload || response;
  if (Array.isArray(data?.rates)) return data.rates;
  if (Array.isArray(data?.quotes)) return data.quotes;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function normalizeQuote(response) {
  const rate = rateCandidates(response)[0];
  if (!rate) {
    return {
      available: false,
      message: 'NBOX did not return an available delivery service.',
      raw: response,
    };
  }

  const amount = firstNumber(
    rate.amount,
    rate.price,
    rate.total,
    rate.total_amount,
    rate.delivery_fee,
    rate.shipping_fee,
    rate.cost,
  );

  return {
    available: amount >= 0,
    id: firstString(rate.id, rate.rate_id, rate.quote_id, rate.service_id),
    serviceName: firstString(rate.service_name, rate.service, rate.name, rate.carrier, 'NBOX Delivery'),
    serviceCode: firstString(rate.service_code, rate.code),
    amount,
    currency: firstString(rate.currency, response?.currency, response?.data?.currency, 'QAR'),
    eta: firstString(rate.eta, rate.estimated_delivery, rate.delivery_time, rate.transit_time),
    raw: response,
  };
}

function normalizeShipment(response) {
  const data = response?.data || response?.payload || response || {};
  return {
    provider: 'nbox',
    id: firstString(data.id, data.shipment_id, data.shipmentId, data.awb, data.waybill),
    trackingNumber: firstString(data.tracking_number, data.trackingNumber, data.awb, data.waybill),
    trackingUrl: firstString(data.tracking_url, data.trackingUrl, data.label_url),
    status: firstString(data.status, 'processing'),
    raw: response,
  };
}

async function getDeliveryQuote({ customer, shippingAddress, items }) {
  const endpoint = env('NBOX_RATE_ENDPOINT');
  if (!endpoint) {
    throw new NboxError('NBOX_RATE_ENDPOINT is not configured.', { configured: false });
  }

  const payload = buildShipmentPayload({
    orderNumber: `QUOTE-${Date.now()}`,
    customer,
    shippingAddress,
    items,
  });
  return normalizeQuote(await postJson(endpoint, payload));
}

async function createShipment({ orderNumber, customer, shippingAddress, items, shippingQuote }) {
  const endpoint = env('NBOX_SHIPMENT_ENDPOINT');
  if (!endpoint) {
    throw new NboxError('NBOX_SHIPMENT_ENDPOINT is not configured.', { configured: false });
  }

  const payload = buildShipmentPayload({
    orderNumber,
    customer,
    shippingAddress,
    items,
    shippingQuote,
  });
  return normalizeShipment(await postJson(endpoint, payload));
}

module.exports = {
  NboxError,
  createShipment,
  getDeliveryQuote,
  isConfigured,
};
