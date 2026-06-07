class SadadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SadadError';
    this.details = details;
  }
}

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function isConfigured() {
  return Boolean(env('SADAD_MERCHANT_ID') && env('SADAD_API_KEY'));
}

function baseUrl() {
  return env('SADAD_API_BASE_URL', 'https://api.sadad.qa').replace(/\/+$/, '');
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Merchant-ID': env('SADAD_MERCHANT_ID'),
    'X-API-Key': env('SADAD_API_KEY'),
  };
}

/**
 * Create a payment session with Sadad.
 * Returns a redirect URL to send the customer to.
 *
 * @param {{
 *   orderId: string,
 *   amount: number,
 *   currency: string,
 *   customer: { firstName: string, lastName: string, email: string, phone: string },
 *   successUrl: string,
 *   failureUrl: string,
 *   webhookUrl: string,
 * }} params
 */
async function createPaymentSession(params) {
  if (!isConfigured()) {
    throw new SadadError('Sadad is not configured — set SADAD_MERCHANT_ID and SADAD_API_KEY');
  }

  // TODO: replace with the real Sadad endpoint and payload shape once docs are available
  const body = {
    merchant_order_id: params.orderId,
    amount: params.amount,
    currency: params.currency || 'QAR',
    customer: {
      first_name: params.customer.firstName,
      last_name: params.customer.lastName,
      email: params.customer.email,
      phone: params.customer.phone,
    },
    redirect_urls: {
      success: params.successUrl,
      failure: params.failureUrl,
    },
    webhook_url: params.webhookUrl,
  };

  const res = await fetch(`${baseUrl()}/v1/payments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new SadadError('Sadad payment session creation failed', { status: res.status, body: json });
  }

  // TODO: adjust field names to match the real Sadad response shape
  return {
    sessionId: json.session_id || json.id,
    redirectUrl: json.redirect_url || json.payment_url,
    raw: json,
  };
}

/**
 * Retrieve payment status from Sadad by session/transaction ID.
 */
async function getPaymentStatus(sessionId) {
  if (!isConfigured()) {
    throw new SadadError('Sadad is not configured — set SADAD_MERCHANT_ID and SADAD_API_KEY');
  }

  // TODO: adjust endpoint path to match actual Sadad API
  const res = await fetch(`${baseUrl()}/v1/payments/${sessionId}`, {
    method: 'GET',
    headers: authHeaders(),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new SadadError('Sadad status check failed', { status: res.status, body: json });
  }

  // TODO: map to actual field names from Sadad response
  return {
    sessionId,
    status: json.status,           // expected: 'paid' | 'pending' | 'failed' | 'cancelled'
    transactionId: json.transaction_id,
    amount: json.amount,
    currency: json.currency,
    paidAt: json.paid_at,
    raw: json,
  };
}

/**
 * Verify a webhook payload signature from Sadad.
 * TODO: implement actual signature verification once docs are available.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = env('SADAD_WEBHOOK_SECRET');
  if (!secret) return true; // skip if not configured yet

  // TODO: replace with real HMAC or RSA verification per Sadad docs
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return signatureHeader === expected;
}

/**
 * Map a Sadad payment status string to the internal order payment status.
 */
function toOrderPaymentStatus(sadadStatus) {
  const map = {
    paid: 'paid',
    success: 'paid',
    pending: 'pending',
    failed: 'failed',
    cancelled: 'failed',
    refunded: 'refunded',
  };
  return map[String(sadadStatus).toLowerCase()] || 'pending';
}

module.exports = {
  isConfigured,
  createPaymentSession,
  getPaymentStatus,
  verifyWebhookSignature,
  toOrderPaymentStatus,
  SadadError,
};
