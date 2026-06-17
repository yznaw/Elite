#!/usr/bin/env node
/**
 * NBOX Webhook Integration Tests
 *
 * Usage:
 *   NBOX_WEBHOOK_SECRET=your-secret node scripts/test-nbox-webhook.js
 *   BASE_URL=http://localhost:3000 NBOX_WEBHOOK_SECRET=your-secret node scripts/test-nbox-webhook.js
 */

const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.NBOX_WEBHOOK_SECRET || '';
const WEBHOOK_URL = `${BASE_URL}/api/webhooks/nbox`;

let passed = 0;
let failed = 0;

function sign(body, secret, { withTimestamp = true, timestamp = new Date().toISOString(), encoding = 'hex' } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const buf = Buffer.from(raw, 'utf8');
  if (withTimestamp) {
    const ts = timestamp;
    const payload = Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), buf]);
    const sig = crypto.createHmac('sha256', secret).update(payload).digest(encoding);
    return { sig, ts };
  }
  const sig = crypto.createHmac('sha256', secret).update(buf).digest(encoding);
  return { sig, ts: null };
}

async function post(body, headers = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw,
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function assert(label, condition, actual) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}  →  got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Test payload helpers ────────────────────────────────────────────────────

function deliveredPayload(orderNumber = 'TEST-999') {
  return {
    event: 'shipment.update',
    id: `evt-${Date.now()}`,
    data: {
      status_event: 'delivered',
      shipment_id: 'shp-abc-123',
      order_reference: orderNumber,
      awb: 'NBOX123456',
      tracking_url: 'https://nbox.now/track/NBOX123456',
      carrier: 'NBOX',
      status: 'delivered',
    },
  };
}

function inTransitPayload(orderNumber = 'TEST-999') {
  return {
    event: 'shipment.update',
    id: `evt-transit-${Date.now()}`,
    data: {
      status_event: 'in_transit',
      order_reference: orderNumber,
      shipment_id: 'shp-transit-123',
      awb: 'NBOX654321',
      carrier: 'NBOX',
    },
  };
}

// ─── Run tests ───────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nNBOX Webhook Tests → ${WEBHOOK_URL}\n`);
  console.log(`Secret configured: ${SECRET ? 'yes' : 'NO (503 expected for all signed requests)'}\n`);

  // ── 1. No signature header ────────────────────────────────────────────────
  console.log('1. No signature header');
  {
    const { status, data } = await post(deliveredPayload());
    if (!SECRET) {
      assert('503 when server secret not configured', status === 503, status);
    } else {
      assert('401 missing signature', status === 401, status);
      assert('message mentions signature', data?.message?.toLowerCase().includes('signature'), data?.message);
    }
  }

  if (!SECRET) {
    console.log('\n⚠  NBOX_WEBHOOK_SECRET not set — skipping signature tests.');
    console.log('   Add NBOX_WEBHOOK_SECRET to server/.env, restart server, then re-run:\n');
    console.log('   NBOX_WEBHOOK_SECRET=test-secret-elite-nbox node scripts/test-nbox-webhook.js\n');
    summary();
    return;
  }

  // ── 2. Wrong signature ────────────────────────────────────────────────────
  console.log('\n2. Wrong signature');
  {
    const { ts } = sign(deliveredPayload(), SECRET);
    const { status, data } = await post(deliveredPayload(), {
      'x-nbox-signature': 'deadbeef',
      'x-nbox-timestamp': ts,
    });
    assert('401 invalid signature', status === 401, status);
    assert('message mentions invalid', data?.message?.toLowerCase().includes('invalid'), data?.message);
  }

  // ── 3. Valid hex signature ────────────────────────────────────────────────
  console.log('\n3. Valid hex signature — unknown order');
  {
    const body = deliveredPayload('ORDER-DOES-NOT-EXIST');
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET);
    const { status, data } = await post(raw, {
      'x-nbox-signature': sig,
      'x-nbox-timestamp': ts,
      'x-nbox-event-type': 'shipment.update',
      'x-nbox-delivery-id': `test-${Date.now()}`,
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
    assert('success: true', data?.success === true, data?.success);
  }

  // ── 4. Valid base64 signature ─────────────────────────────────────────────
  console.log('\n4. Valid base64 signature — unknown order');
  {
    const body = inTransitPayload('NO-SUCH-ORDER');
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET, { encoding: 'base64' });
    const { status, data } = await post(raw, {
      'x-nbox-webhook-signature': sig,
      'x-nbox-timestamp': ts,
      'x-nbox-event-type': 'shipment.update',
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
    assert('success: true', data?.success === true, data?.success);
  }

  // ── 5. Timestamp-prefixed signature ──────────────────────────────────────
  console.log('\n5. Timestamp-prefixed signature (x-nbox-timestamp header)');
  {
    const body = deliveredPayload('NO-ORDER-TS');
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET);
    const { status, data } = await post(raw, {
      'x-nbox-signature': sig,
      'x-nbox-timestamp': ts,
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
    assert('success: true', data?.success === true, data?.success);
  }

  // ── 6. sha256= prefix in signature ───────────────────────────────────────
  console.log('\n6. sha256= prefixed signature (GitHub-style)');
  {
    const body = deliveredPayload('NO-ORDER-PREFIX');
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET);
    const { status, data } = await post(raw, {
      'x-hub-signature-256': `sha256=${sig}`,
      'x-nbox-timestamp': ts,
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
    assert('success: true', data?.success === true, data?.success);
  }

  // ── 7. Minimal payload — no order fields ─────────────────────────────────
  console.log('\n7. Minimal payload — no identifiable order or tracking number');
  {
    const body = { status: 'delivered' };
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET);
    const { status, data } = await post(raw, {
      'x-nbox-signature': sig,
      'x-nbox-timestamp': ts,
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
    assert('success: true', data?.success === true, data?.success);
  }

  // ── 8. Status mapping — completed ────────────────────────────────────────
  console.log('\n8. Status mapping — event=shipment.completed → delivered');
  {
    const body = {
      event: 'shipment.completed',
      id: `evt-done-${Date.now()}`,
      data: {
        order: { order_number: 'NO-ORDER-STATUS' },
        shipment: { status: 'completed', tracking_number: 'TRK-DONE' },
      },
    };
    const raw = JSON.stringify(body);
    const { sig, ts } = sign(raw, SECRET);
    const { status, data } = await post(raw, {
      'x-nbox-signature': sig,
      'x-nbox-timestamp': ts,
    });
    assert('200 or 202 accepted', [200, 202].includes(status), status);
  }

  // ── 9. Old timestamp rejected ─────────────────────────────────────────────
  console.log('\n9. Old timestamp rejected');
  {
    const body = deliveredPayload('NO-ORDER-OLD-TS');
    const raw = JSON.stringify(body);
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { sig, ts } = sign(raw, SECRET, { timestamp });
    const { status, data } = await post(raw, {
      'x-nbox-signature': sig,
      'x-nbox-timestamp': ts,
    });
    assert('401 old timestamp', status === 401, status);
    assert('message mentions timestamp', data?.message?.toLowerCase().includes('timestamp'), data?.message);
  }

  // ── 10. Idempotency — duplicate event ID ─────────────────────────────────
  console.log('\n10. Idempotency — same eventId sent twice (if order exists in DB)');
  console.log('   (skipped — needs a real order in the database)');

  summary();
}

function summary() {
  const total = passed + failed;
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\nFatal error running tests:', err.message);
  process.exit(1);
});
