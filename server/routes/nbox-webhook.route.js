const crypto = require('crypto');
const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler } = require('./lib');

const router = Router();
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const SIGNATURE_HEADERS = [
  'x-nbox-signature',
  'x-nbox-webhook-signature',
  'x-webhook-signature',
  'x-hmac-sha256',
  'x-hub-signature-256',
  'x-signature',
  'signature',
];

const STATUS_MAP = new Map([
  ['shipment.update', 'processing'],
  ['shipment.new', 'processing'],
  ['shipment.fulfilled', 'processing'],
  ['shipment.pickup', 'shipped'],
  ['shipment.picked_up', 'shipped'],
  ['shipment.in_transit', 'shipped'],
  ['shipment.completed', 'delivered'],
  ['shipment.delivered', 'delivered'],
  ['shipment.failed', 'returned'],
  ['new', 'processing'],
  ['fulfilled', 'processing'],
  ['pickup', 'shipped'],
  ['picked_up', 'shipped'],
  ['picked up', 'shipped'],
  ['pickup_failed', 'processing'],
  ['not_collected', 'processing'],
  ['in_transit_pickup', 'processing'],
  ['in_transit', 'shipped'],
  ['in transit', 'shipped'],
  ['intransit', 'shipped'],
  ['transit', 'shipped'],
  ['shipped', 'shipped'],
  ['completed', 'delivered'],
  ['complete', 'delivered'],
  ['delivered', 'delivered'],
  ['failed', 'returned'],
  ['failure', 'returned'],
  ['returned', 'returned'],
  ['return', 'returned'],
  ['returned_to_sender', 'returned'],
  ['returned to sender', 'returned'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
  ['on_hold', 'processing'],
]);

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signatureCandidates(value) {
  if (!value) return [];
  const raw = String(value).trim();
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const candidates = [raw];

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      candidates.push(part);
      continue;
    }
    const name = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (['sha256', 'v1', 'signature', 'sig'].includes(name)) candidates.push(val);
  }

  return [...new Set(candidates.map((candidate) => candidate.replace(/^sha256=/i, '').trim()))];
}

function parseWebhookTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateWebhookTimestamp(timestamp) {
  const parsed = parseWebhookTimestamp(timestamp);
  if (!parsed) {
    return { ok: false, status: 401, message: 'Invalid webhook timestamp.' };
  }

  const age = Math.abs(Date.now() - parsed);
  if (age > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, status: 401, message: 'Webhook timestamp outside allowed window.' };
  }

  return { ok: true };
}

function hmacSignatures(secret, payload) {
  const digest = crypto.createHmac('sha256', secret).update(payload).digest();
  return [
    { value: digest.toString('hex'), caseInsensitive: true },
    { value: digest.toString('base64'), caseInsensitive: false },
  ];
}

function signatureMatches(candidate, expected) {
  if (expected.caseInsensitive) {
    return timingSafeStringEqual(candidate.toLowerCase(), expected.value.toLowerCase());
  }
  return timingSafeStringEqual(candidate, expected.value);
}

function verifyWebhookSignature(req) {
  const secret = process.env.NBOX_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, status: 503, message: 'NBOX webhook secret is not configured.' };
  }

  const signatureHeader = SIGNATURE_HEADERS.map((header) => req.get(header)).find(Boolean);
  if (!signatureHeader) {
    return { ok: false, status: 401, message: 'Missing webhook signature.' };
  }

  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 400, message: 'Missing raw webhook body.' };
  }

  const timestamp = req.get('x-nbox-timestamp');
  const requireTimestamp = env('NBOX_WEBHOOK_REQUIRE_TIMESTAMP', 'true') !== 'false';
  const allowLegacySignatures = env('NBOX_WEBHOOK_ALLOW_LEGACY_SIGNATURES') === 'true';

  if (timestamp) {
    const timestampCheck = validateWebhookTimestamp(timestamp);
    if (!timestampCheck.ok) return timestampCheck;
  } else if (requireTimestamp) {
    return { ok: false, status: 401, message: 'Missing webhook timestamp.' };
  }

  const expectedSignatures = [];
  if (timestamp) {
    expectedSignatures.push(...hmacSignatures(
      secret,
      Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]),
    ));
  }
  if (!timestamp || allowLegacySignatures) {
    expectedSignatures.push(...hmacSignatures(secret, rawBody));
  }

  const matched = signatureCandidates(signatureHeader).some((candidate) => {
    return expectedSignatures.some((expected) => signatureMatches(candidate, expected));
  });

  if (!matched) {
    return { ok: false, status: 401, message: 'Invalid webhook signature.' };
  }

  return { ok: true };
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePayload(body, req) {
  const payload = asObject(body);
  const data = asObject(payload.data || payload.payload || payload.shipment || payload);
  const shipment = asObject(data.shipment || payload.shipment || data);
  const order = asObject(data.order || payload.order || shipment.order);

  const event = firstString(
    req.get('x-nbox-event-type'),
    req.get('x-nbox-event'),
    req.get('x-webhook-event'),
    payload.event,
    payload.type,
    payload.topic,
    payload.eventType,
    payload.event_type,
    data.event,
    data.type,
    data.status_event,
    shipment.status_event,
  );

  const statusText = firstString(
    data.status_event,
    shipment.status_event,
    shipment.status,
    shipment.statusCode,
    shipment.status_code,
    shipment.fulfillmentStatus,
    shipment.fulfillment_status,
    data.status,
    data.statusCode,
    payload.status_event,
    payload.status,
  );

  const trackingNumber = firstString(
    shipment.trackingNumber,
    shipment.tracking_number,
    shipment.awb,
    shipment.awbNumber,
    shipment.waybill,
    shipment.waybillNumber,
    data.awb,
    data.trackingNumber,
    data.tracking_number,
    data.shipment_id,
    payload.trackingNumber,
    payload.tracking_number,
  );

  const orderNumber = firstString(
    order.orderNumber,
    order.order_number,
    order.orderReference,
    order.order_reference,
    order.reference,
    order.referenceNumber,
    order.publicNumber,
    order.public_number,
    data.orderNumber,
    data.order_number,
    data.orderReference,
    data.order_reference,
    payload.orderNumber,
    payload.order_number,
    payload.orderReference,
    payload.order_reference,
  );

  const orderId = firstString(order.id, order.orderId, order.order_id, data.orderId, data.order_id, payload.orderId, payload.order_id);
  const shipmentId = firstString(shipment.id, shipment.shipmentId, shipment.shipment_id, data.shipmentId, data.shipment_id, payload.shipmentId, payload.shipment_id);
  const eventId = firstString(req.get('x-nbox-delivery-id'), payload.id, payload.eventId, payload.event_id, data.eventId, data.event_id);

  return {
    event,
    eventId,
    statusText,
    fulfillmentStatus: mapFulfillmentStatus(event, statusText),
    orderIdentifiers: [...new Set([orderNumber, orderId].filter(Boolean))],
    shipmentId,
    trackingNumber,
    trackingUrl: firstString(shipment.trackingUrl, shipment.tracking_url, data.trackingUrl, data.tracking_url, payload.trackingUrl, payload.tracking_url),
    carrier: firstString(shipment.carrier, shipment.carrierName, shipment.courier, data.carrier, data.carrierName, data.courier, payload.carrier),
    service: firstString(shipment.service, shipment.serviceName, shipment.service_code, data.service, data.serviceName, data.carrierName, payload.service),
    raw: payload,
  };
}

function mapFulfillmentStatus(event, statusText) {
  const eventKey = normalizeKey(event);
  const direct = eventKey === 'shipment.update' ? null : STATUS_MAP.get(eventKey);
  if (direct) return direct;

  return STATUS_MAP.get(normalizeKey(statusText)) || 'processing';
}

function mapOrderStatus(fulfillmentStatus) {
  if (fulfillmentStatus === 'delivered') return 'completed';
  if (fulfillmentStatus === 'returned') return 'returned';
  if (fulfillmentStatus === 'cancelled') return 'cancelled';
  if (fulfillmentStatus === 'processing' || fulfillmentStatus === 'shipped') return 'processing';
  return null;
}

function timelineKind(fulfillmentStatus) {
  if (['processing', 'shipped', 'delivered', 'cancelled', 'returned'].includes(fulfillmentStatus)) {
    return fulfillmentStatus;
  }
  return 'note';
}

function timelineDetail(event) {
  const parts = [
    'NBOX shipment update',
    event.statusText ? `status: ${event.statusText}` : '',
    event.trackingNumber ? `tracking: ${event.trackingNumber}` : '',
    event.carrier ? `carrier: ${event.carrier}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

async function findOrder(client, tenantId, event) {
  if (event.orderIdentifiers.length > 0) {
    const result = await client.query(
      `
        SELECT o.*
        FROM orders o
        WHERE o.tenant_id = $1
          AND (o.id::text = ANY($2::text[]) OR o.public_number = ANY($2::text[]))
        LIMIT 1
      `,
      [tenantId, event.orderIdentifiers],
    );
    if (result.rowCount > 0) return result.rows[0];
  }

  if (event.trackingNumber) {
    const result = await client.query(
      `
        SELECT o.*
        FROM orders o
        JOIN shipments s ON s.order_id = o.id AND s.tenant_id = o.tenant_id
        WHERE o.tenant_id = $1 AND s.tracking_number = $2
        LIMIT 1
      `,
      [tenantId, event.trackingNumber],
    );
    if (result.rowCount > 0) return result.rows[0];
  }

  return null;
}

async function upsertShipment(client, tenantId, order, event) {
  const result = await client.query(
    `
      UPDATE shipments
      SET carrier = COALESCE($3, carrier),
          service = COALESCE($4, service),
          tracking_number = COALESCE($5, tracking_number),
          tracking_url = COALESCE($6, tracking_url),
          status = $7,
          shipped_at = CASE WHEN $7 IN ('shipped', 'delivered') THEN COALESCE(shipped_at, now()) ELSE shipped_at END,
          delivered_at = CASE WHEN $7 = 'delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
          updated_at = now()
      WHERE tenant_id = $1 AND order_id = $2
      RETURNING id
    `,
    [
      tenantId,
      order.id,
      event.carrier || null,
      event.service || null,
      event.trackingNumber || null,
      event.trackingUrl || null,
      event.fulfillmentStatus,
    ],
  );

  if (result.rowCount > 0) return result.rows[0].id;

  const inserted = await client.query(
    `
      INSERT INTO shipments (
        tenant_id, order_id, carrier, service, tracking_number, tracking_url, status,
        shipped_at, delivered_at, address
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $7 IN ('shipped', 'delivered') THEN now() ELSE NULL END,
        CASE WHEN $7 = 'delivered' THEN now() ELSE NULL END,
        $8::jsonb
      )
      RETURNING id
    `,
    [
      tenantId,
      order.id,
      event.carrier || null,
      event.service || null,
      event.trackingNumber || null,
      event.trackingUrl || null,
      event.fulfillmentStatus,
      JSON.stringify(order.shipping_address || {}),
    ],
  );
  return inserted.rows[0].id;
}

async function insertTimelineEntry(client, tenantId, orderId, shipmentId, event) {
  if (event.eventId) {
    const existing = await client.query(
      `
        SELECT id
        FROM order_timeline_entries
        WHERE tenant_id = $1
          AND order_id = $2
          AND metadata->>'nboxEventId' = $3
        LIMIT 1
      `,
      [tenantId, orderId, event.eventId],
    );
    if (existing.rowCount > 0) return false;
  }

  await client.query(
    `
      INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      tenantId,
      orderId,
      timelineKind(event.fulfillmentStatus),
      timelineDetail(event),
      JSON.stringify({
        provider: 'nbox',
        nboxEvent: event.event || null,
        nboxEventId: event.eventId || null,
        nboxShipmentId: event.shipmentId || null,
        shipmentId,
        trackingNumber: event.trackingNumber || null,
      }),
    ],
  );
  return true;
}

router.post('/', asyncHandler(async (req, res) => {
  const verification = verifyWebhookSignature(req);
  if (!verification.ok) {
    return res.status(verification.status).json({ success: false, message: verification.message });
  }

  const event = normalizePayload(req.body, req);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const order = await findOrder(client, tenant.id, event);

    if (!order) {
      await client.query('COMMIT');
      console.warn('NBOX webhook accepted but no matching order was found.', {
        event: event.event,
        orderIdentifiers: event.orderIdentifiers,
        trackingNumber: event.trackingNumber,
        shipmentId: event.shipmentId,
      });
      return res.status(202).json({
        success: true,
        message: 'NBOX webhook accepted; no matching order found.',
      });
    }

    const orderStatus = mapOrderStatus(event.fulfillmentStatus);
    await client.query(
      `
        UPDATE orders
        SET fulfillment_status = $3,
            status = COALESCE($4, status),
            metadata = metadata || $5::jsonb
        WHERE tenant_id = $1 AND id = $2
      `,
      [
        tenant.id,
        order.id,
        event.fulfillmentStatus,
        orderStatus,
        JSON.stringify({
          nbox: {
            lastEvent: event.event || null,
            lastEventId: event.eventId || null,
            lastShipmentId: event.shipmentId || null,
            lastStatus: event.statusText || event.fulfillmentStatus,
            updatedAt: new Date().toISOString(),
          },
        }),
      ],
    );

    const shipmentId = await upsertShipment(client, tenant.id, order, event);
    const timelineInserted = await insertTimelineEntry(client, tenant.id, order.id, shipmentId, event);

    await client.query('COMMIT');
    return res.json({
      success: true,
      data: {
        order: order.public_number,
        fulfillment: event.fulfillmentStatus,
        timelineInserted,
      },
      message: 'NBOX webhook processed.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
