const DEFAULT_ITEM_WEIGHT_GRAMS = 1000;
const DEFAULT_ITEM_LENGTH_CM = 35;
const DEFAULT_ITEM_WIDTH_CM = 25;
const DEFAULT_ITEM_HEIGHT_CM = 15;

const db = require('../db/client');

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
  const hasStatic = Boolean(env('NBOX_API_BASE_URL') && env('NBOX_API_TOKEN'));
  const hasLogin = Boolean(env('NBOX_API_BASE_URL') && env('NBOX_LOGIN_EMAIL') && env('NBOX_LOGIN_PASSWORD'));
  return hasStatic || hasLogin;
}

// In-memory cache (fast path for single-process, single-restart scenarios)
const _token = { value: null, fetchedAt: 0 };
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

// ── DB-backed token persistence ───────────────────────────────────────────────
// Survives server restarts and works across multiple worker processes.

async function readTokenFromDb() {
  try {
    const { rows } = await db.query(
      `SELECT config FROM integrations WHERE integration_key = 'nbox' LIMIT 1`,
    );
    const cfg = rows[0]?.config;
    if (cfg?.nboxToken && cfg?.nboxTokenFetchedAt) {
      return { token: cfg.nboxToken, fetchedAt: Number(cfg.nboxTokenFetchedAt) };
    }
  } catch {
    // DB unavailable — will fall through to a fresh login
  }
  return null;
}

async function persistTokenToDb(token, fetchedAt) {
  try {
    await db.query(
      `UPDATE integrations
          SET config     = config || $1::jsonb,
              updated_at = NOW()
        WHERE integration_key = 'nbox'`,
      [JSON.stringify({ nboxToken: token, nboxTokenFetchedAt: fetchedAt })],
    );
  } catch (err) {
    console.warn('[nbox] Could not persist token to DB (non-critical):', err.message);
  }
}

async function clearTokenFromDb() {
  try {
    await db.query(
      `UPDATE integrations
          SET config     = config - 'nboxToken' - 'nboxTokenFetchedAt',
              updated_at = NOW()
        WHERE integration_key = 'nbox'`,
    );
  } catch {
    // non-critical
  }
}

async function invalidateToken() {
  _token.value = null;
  _token.fetchedAt = 0;
  await clearTokenFromDb();
}

async function freshToken() {
  const email = env('NBOX_LOGIN_EMAIL');
  const password = env('NBOX_LOGIN_PASSWORD');

  if (!email || !password) {
    return env('NBOX_API_TOKEN');
  }

  // 1. In-memory cache (fastest)
  if (_token.value && (Date.now() - _token.fetchedAt) < TOKEN_TTL_MS) {
    return _token.value;
  }

  // 2. DB cache (survives restarts / multiple workers)
  const cached = await readTokenFromDb();
  if (cached && (Date.now() - cached.fetchedAt) < TOKEN_TTL_MS) {
    _token.value = cached.token;
    _token.fetchedAt = cached.fetchedAt;
    console.log('[nbox] Reused token from DB cache.');
    return _token.value;
  }

  // 3. Login to obtain a fresh token
  const base = env('NBOX_API_BASE_URL').replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        shopId: env('NBOX_SHOP_DOMAIN'),
        shopName: env('NBOX_ORIGIN_NAME', 'Elite Collections'),
        platform: env('NBOX_PLATFORM', 'custom'),
        url: env('NBOX_SHOP_URL', `https://${env('NBOX_SHOP_DOMAIN')}`),
      }),
    });
  } catch (err) {
    throw new NboxError('NBOX login request failed.', { message: err.message });
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  const token = data?.token || data?.data?.token || data?.accessToken || data?.access_token;
  if (!token) {
    throw new NboxError('NBOX login failed — no token in response.', { data });
  }

  _token.value = token;
  _token.fetchedAt = Date.now();
  console.log('[nbox] Obtained fresh token via login — persisting to DB.');
  await persistTokenToDb(_token.value, _token.fetchedAt);
  return token;
}

function assertExternalNboxUrl(value, source) {
  const url = String(value || '').trim();
  if (!url) {
    throw new NboxError(`${source} is not configured.`, {
      source,
      configured: false,
    });
  }
  if (/webhooks\/nbox/i.test(url)) {
    throw new NboxError(
      `${source} points to Elite's inbound NBOX webhook URL. Configure the outbound NBOX API URL instead.`,
      {
        source,
        value: url,
        hint: 'Use the outbound NBOX API base URL, for example https://nbox.now/api or https://staging.nbox.now/api.',
      },
    );
  }
}

function endpointUrl(path) {
  const rawPath = String(path || '').trim();
  assertExternalNboxUrl(rawPath, 'NBOX endpoint');

  if (/^https?:\/\//i.test(rawPath)) {
    assertExternalNboxUrl(rawPath, 'NBOX endpoint');
    return rawPath;
  }

  const rawBase = env('NBOX_API_BASE_URL');
  assertExternalNboxUrl(rawBase, 'NBOX_API_BASE_URL');

  let baseUrl;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    throw new NboxError('NBOX_API_BASE_URL must be an absolute URL including https://.', {
      source: 'NBOX_API_BASE_URL',
      value: rawBase,
      example: 'https://nbox.now/api',
    });
  }

  const cleanPath = rawPath.replace(/^\/+/, '');
  return `${baseUrl.href.replace(/\/+$/, '')}/${cleanPath}`;
}

async function authHeaders() {
  const token = await freshToken();
  const apiKey = env('NBOX_API_KEY');
  const shopDomain = env('NBOX_SHOP_DOMAIN');
  const authHeader = env('NBOX_AUTH_HEADER', 'x-nbox-shop-token');
  const authScheme = env('NBOX_AUTH_SCHEME');
  const headers = {
    'Content-Type': 'application/json',
  };

  if (!token) {
    throw new NboxError('NBOX_API_TOKEN is not configured.', { configured: false });
  }
  if (!shopDomain) {
    throw new NboxError('NBOX_SHOP_DOMAIN is not configured.', {
      configured: false,
      hint: 'Set this to the shop domain that belongs to the NBOX token, for example elitecollections.qa.',
    });
  }

  headers[authHeader] = authScheme ? `${authScheme} ${token}` : token;
  headers['x-nbox-shop-domain'] = shopDomain;
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

function countryName(country) {
  const code = countryCode(country);
  const map = {
    QA: 'Qatar',
    AE: 'United Arab Emirates',
    KW: 'Kuwait',
    SA: 'Saudi Arabia',
    BH: 'Bahrain',
    OM: 'Oman',
  };
  return map[code] || String(country || 'Qatar').trim();
}

function firstPositive(values, fallback) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function defaultNumber(name, fallback) {
  return firstPositive([env(name)], fallback);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  );
}

function addressPayload(address = {}, defaults = {}) {
  const country = address.country || address.countryCode || address.country_code || defaults.country || 'QA';
  const code = countryCode(country);
  return compactObject({
    address: address.line1 || address.address || defaults.address || '',
    city: address.city || defaults.city || 'Doha',
    state: address.state || address.region || defaults.state || address.city || defaults.city || 'Doha',
    countryCode: code,
    country: countryName(country),
    zip: address.zip || address.postalCode || address.postal_code || defaults.zip || '0000',
    longitude: address.longitude || address.lng || defaults.longitude,
    latitude: address.latitude || address.lat || defaults.latitude,
  });
}

function assertAddressComplete(address, label) {
  const missing = ['address', 'city', 'countryCode', 'zip'].filter((field) => !address[field]);
  if (missing.length > 0) {
    throw new NboxError(`${label} address is incomplete.`, {
      missing,
      hint: label === 'NBOX origin'
        ? 'Set NBOX_ORIGIN_ADDRESS, NBOX_ORIGIN_CITY, NBOX_ORIGIN_COUNTRY, and NBOX_ORIGIN_ZIP.'
        : 'Provide a complete shipping address before requesting an NBOX quote.',
    });
  }
}

function originAddress() {
  return addressPayload({}, {
    address: env('NBOX_ORIGIN_ADDRESS'),
    city: env('NBOX_ORIGIN_CITY', 'Doha'),
    state: env('NBOX_ORIGIN_STATE', env('NBOX_ORIGIN_CITY', 'Doha')),
    country: env('NBOX_ORIGIN_COUNTRY', 'QA'),
    zip: env('NBOX_ORIGIN_ZIP', '0000'),
    longitude: env('NBOX_ORIGIN_LONGITUDE'),
    latitude: env('NBOX_ORIGIN_LATITUDE'),
  });
}

function destinationAddress(address = {}, customer = {}) {
  return addressPayload(address, {
    city: address.city || 'Doha',
    country: address.country || 'QA',
    zip: '0000',
  });
}

function splitName(customer = {}) {
  const fullName = firstString(customer.name, `${customer.firstName || ''} ${customer.lastName || ''}`);
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: firstString(customer.firstName, parts[0], 'Guest'),
    lastName: firstString(customer.lastName, parts.slice(1).join(' '), '-'),
  };
}

function customerPayload(customer = {}, shippingAddress = {}) {
  const name = splitName(customer);
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    email: firstString(customer.email, 'no-reply@elitecollections.qa'),
    phone: firstString(customer.phone, shippingAddress.phone),
  };
}

function productPayload(item = {}) {
  const defaultWeight = defaultNumber('NBOX_DEFAULT_ITEM_WEIGHT_GRAMS', DEFAULT_ITEM_WEIGHT_GRAMS);
  const length = firstPositive(
    [item.lengthCm, item.length_cm, item.length, item.metadata?.lengthCm, item.metadata?.length],
    defaultNumber('NBOX_DEFAULT_ITEM_LENGTH_CM', DEFAULT_ITEM_LENGTH_CM),
  );
  const width = firstPositive(
    [item.widthCm, item.width_cm, item.width, item.metadata?.widthCm, item.metadata?.width],
    defaultNumber('NBOX_DEFAULT_ITEM_WIDTH_CM', DEFAULT_ITEM_WIDTH_CM),
  );
  const height = firstPositive(
    [item.heightCm, item.height_cm, item.height, item.metadata?.heightCm, item.metadata?.height],
    defaultNumber('NBOX_DEFAULT_ITEM_HEIGHT_CM', DEFAULT_ITEM_HEIGHT_CM),
  );
  const grams = firstPositive(
    [item.grams, item.weightGrams, item.weight_grams, item.weight, item.metadata?.grams, item.metadata?.weightGrams],
    defaultWeight,
  );
  const volume = firstPositive(
    [item.volumeCm3, item.volume_cm3, item.volume, item.metadata?.volumeCm3, item.metadata?.volume],
    length * width * height,
  );

  return {
    name: firstString(item.name, item.productName, item.title, item.sku, item.id, 'Item'),
    quantity: Math.max(1, Number(item.qty || item.quantity) || 1),
    price: Number(item.price || item.amount || item.value || 0),
    grams,
    length,
    width,
    height,
    volume,
    currency: firstString(item.currency, 'QAR'),
  };
}

function productsPayload(items = []) {
  return items.map(productPayload);
}

function quoteAmount(shippingQuote) {
  return firstNumber(
    shippingQuote?.amount,
    shippingQuote?.price,
    shippingQuote?.total,
    shippingQuote?.total_price,
    shippingQuote?.displayRate,
    shippingQuote?.actualRate,
    0,
  );
}

function orderNumberValue(orderNumber) {
  const digits = String(orderNumber || '').replace(/\D/g, '');
  const compact = digits.slice(-12) || Date.now().toString().slice(-10);
  return Number(compact);
}

function orderTotals(items = [], shippingQuote = null) {
  const products = productsPayload(items);
  const subTotal = products.reduce((sum, product) => (
    sum + (Number(product.price) || 0) * (Number(product.quantity) || 1)
  ), 0);
  const shippingFee = quoteAmount(shippingQuote);
  return {
    products,
    subTotal: Number(subTotal.toFixed(2)),
    shippingFee: Number(shippingFee.toFixed(2)),
    total: Number((subTotal + shippingFee).toFixed(2)),
    currency: firstString(products[0]?.currency, shippingQuote?.currency, 'QAR'),
  };
}

function buildRatePayload({ shippingAddress, items }) {
  const origin = originAddress();
  const destination = destinationAddress(shippingAddress);
  assertAddressComplete(origin, 'NBOX origin');
  assertAddressComplete(destination, 'NBOX destination');

  return {
    products: productsPayload(items),
    origin,
    destination,
    type: env('NBOX_SHIPPING_TYPE', 'non_document'),
  };
}

function buildOrderPayload({ orderNumber, customer, shippingAddress, items, shippingQuote }) {
  const totals = orderTotals(items, shippingQuote);
  const destination = destinationAddress(shippingAddress, customer);
  const origin = originAddress();
  assertAddressComplete(origin, 'NBOX origin');
  assertAddressComplete(destination, 'NBOX destination');

  const serviceCode = firstString(
    shippingQuote?.serviceCode,
    shippingQuote?.service_code,
    shippingQuote?.carrier,
    env('NBOX_DEFAULT_SERVICE_CODE'),
  );

  return compactObject({
    order: compactObject({
      shopDomain: env('NBOX_SHOP_DOMAIN'),
      carrier: serviceCode || undefined,
      subTotal: totals.subTotal,
      tax: 0,
      discount: 0,
      orderNumber: orderNumberValue(orderNumber),
      orderReference: String(orderNumber || ''),
      total: totals.total,
      currency: totals.currency,
      shippingFee: totals.shippingFee,
      paymentStatus: 'prepaid',
      paymentMethod: 'online_payment',
    }),
    customer: customerPayload(customer, shippingAddress),
    origin,
    destination,
    products: totals.products,
  });
}

async function postJson(path, payload, { retried = false } = {}) {
  if (!isConfigured()) {
    throw new NboxError('NBOX API is not configured.', { configured: false });
  }

  let url;
  try {
    url = endpointUrl(path);
  } catch (err) {
    if (err.name === 'NboxError') throw err;
    throw new NboxError('NBOX endpoint URL is invalid.', {
      path,
      message: err.message,
    });
  }

  let headers;
  try {
    headers = await authHeaders();
  } catch (err) {
    if (err.name === 'NboxError') throw err;
    throw new NboxError('NBOX API credentials are invalid.', { message: err.message });
  }

  // Debug: log outgoing request (token masked to last 6 chars)
  const debugHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) =>
      k.toLowerCase().includes('token') || k.toLowerCase() === 'authorization'
        ? [k, `***${String(v).slice(-6)}`]
        : [k, v],
    ),
  );
  console.log('[nbox] outgoing request', { url, headers: debugHeaders });

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new NboxError('NBOX API request failed before a response was received.', {
      url,
      message: err.message,
    });
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  console.log('[nbox] response', { status: response.status, body: text.slice(0, 500) });

  if (response.status === 401 || response.status === 403) {
    if (!retried) {
      console.warn('[nbox] Auth rejected — re-logging in and retrying.');
      await invalidateToken();
      return postJson(path, payload, { retried: true });
    }
    throw new NboxError(`NBOX API authentication failed after re-login.`, {
      status: response.status,
      data,
    });
  }

  const bodyStatus = String(data?.status || '').trim().toLowerCase();
  if (['unauthorized', 'unauthenticated'].includes(bodyStatus)) {
    if (!retried) {
      console.warn('[nbox] Auth rejected in body — re-logging in and retrying.');
      await invalidateToken();
      return postJson(path, payload, { retried: true });
    }
    throw new NboxError(
      data?.message || 'NBOX API authentication failed after re-login.',
      { data },
    );
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

const LOCAL_CARRIER_PATTERNS = [
  /nbox\s*logistics/i,
  /nbox\s*now/i,
  /^nbox$/i,
  /local/i,
  /qatar/i,
  /qa$/i,
];

function isLocalCarrier(rate) {
  const fields = [
    rate.service_name, rate.service, rate.name, rate.carrier,
    rate.service_code, rate.code, rate.type, rate.scope,
  ].filter(Boolean).map(String);
  return fields.some((f) => LOCAL_CARRIER_PATTERNS.some((re) => re.test(f)));
}

function pickRate(candidates) {
  if (!candidates.length) return null;
  const local = candidates.find(isLocalCarrier);
  if (local) return local;
  // Fall back to lowest-cost option
  return candidates.reduce((cheapest, r) => {
    const cost = firstNumber(r.amount, r.price, r.total, r.total_price, r.total_amount, r.delivery_fee, r.shipping_fee, r.cost);
    const cheapestCost = firstNumber(cheapest.amount, cheapest.price, cheapest.total, cheapest.total_price, cheapest.total_amount, cheapest.delivery_fee, cheapest.shipping_fee, cheapest.cost);
    return cost < cheapestCost ? r : cheapest;
  });
}

function normalizeQuote(response) {
  const topStatus = String(response?.status || '').trim().toLowerCase();
  if (['unauthorized', 'unauthenticated', 'forbidden', 'error', 'failed', 'failure'].includes(topStatus)) {
    throw new NboxError(
      firstString(response?.message, `NBOX API returned status: ${topStatus}.`),
      { status: topStatus, data: response },
    );
  }

  const rate = pickRate(rateCandidates(response));
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
    rate.total_price,
    rate.total_amount,
    rate.displayRate,
    rate.actualRate,
    rate.delivery_fee,
    rate.shipping_fee,
    rate.cost,
  );

  return {
    available: amount >= 0,
    id: firstString(rate.id, rate.rate_id, rate.quote_id, rate.service_id),
    serviceName: firstString(rate.service_name, rate.service, rate.name, rate.carrierName, rate.carrier, 'NBOX Delivery'),
    serviceCode: firstString(rate.service_code, rate.code, rate.carrier),
    amount,
    currency: firstString(rate.currency, response?.currency, response?.data?.currency, 'QAR'),
    eta: firstString(rate.eta, rate.estimated_delivery, rate.delivery_time, rate.transit_time, rate.description),
    raw: response,
  };
}

function normalizeShipment(response) {
  const data = response?.data || response?.payload || response || {};
  const status = String(data.status || response?.status || '').trim().toLowerCase();
  if (['failed', 'failure', 'error'].includes(status)) {
    throw new NboxError(firstString(data.message, response?.message, 'NBOX order creation failed.'), {
      data: response,
    });
  }

  return {
    provider: 'nbox',
    id: firstString(data.shipment_id, data.shipmentId, data.orderReference, data.order_reference, data.orderId, data.id, data.awb, data.waybill),
    orderId: firstString(data.orderId, data.order_id),
    orderReference: firstString(data.orderReference, data.order_reference),
    trackingNumber: firstString(data.awb, data.tracking_number, data.trackingNumber, data.shipment_id, data.shipmentId, data.waybill),
    trackingUrl: firstString(data.tracking_url, data.trackingUrl, data.label_url),
    carrier: firstString(data.carrier, data.carrierName),
    serviceName: firstString(data.carrierName, data.service_name, data.service, data.carrier),
    actualRate: firstNumber(data.actualRate, data.actual_rate),
    displayRate: firstNumber(data.displayRate, data.display_rate),
    status: 'processing',
    raw: response,
  };
}

async function getDeliveryQuote({ customer, shippingAddress, items }) {
  const endpoint = env('NBOX_RATE_ENDPOINT');
  if (!endpoint) {
    throw new NboxError('NBOX_RATE_ENDPOINT is not configured.', { configured: false });
  }

  const payload = buildRatePayload({ customer, shippingAddress, items });
  return normalizeQuote(await postJson(endpoint, payload));
}

async function createShipment({ orderNumber, customer, shippingAddress, items, shippingQuote }) {
  const endpoint = env('NBOX_SHIPMENT_ENDPOINT');
  if (!endpoint) {
    throw new NboxError('NBOX_SHIPMENT_ENDPOINT is not configured.', { configured: false });
  }

  const payload = buildOrderPayload({
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
