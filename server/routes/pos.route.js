const { Router } = require('express');
const db = require('../db/client');
const { requireAuth } = require('../middleware/require-auth');
const { posPinLimiter } = require('../middleware/rate-limit');
const { asyncHandler, created, ok } = require('./lib');
const { PosError } = require('../lib/pos/errors');
const {
  allocateReceiptBlock,
  checkInRegister,
  createEnrollmentToken,
  currentRegister,
  enrollRegister,
} = require('../lib/pos/register-service');
const { setManagerPin, verifyManagerPin } = require('../lib/pos/manager-service');
const { closeShift, currentSummary, getZReport, listZReports, openShift } = require('../lib/pos/shift-service');
const { listCashMovements, recordCashMovement } = require('../lib/pos/cash-movement-service');
const { createSale, findByBarcode, listProductFilters, loadSale, searchProducts } = require('../lib/pos/sale-service');
const { reportSyncState, syncTransactions } = require('../lib/pos/sync-service');
const { deleteParkedCart, listParkedCarts, parkCart } = require('../lib/pos/parked-cart-service');
const { createRefund, findTransaction, voidTransaction } = require('../lib/pos/correction-service');
const { listConflicts, resolveConflict } = require('../lib/pos/conflict-service');
const { getQzCertificate, signQzRequest } = require('../lib/pos/qz-service');
const { getEffectiveBranchProfile } = require('../lib/pos/branch-service');
const { resolveCustomer } = require('../lib/customer-identity');
const { audit, inTransaction } = require('../lib/pos/db');

const router = Router();
// Cashier is POS-only and lowest privilege; manager-scoped actions (e.g.
// setting another user's PIN) are further restricted inside their own
// service functions, not here — see register-service.js's setManagerPin.
// Editing branch details is admin-only and lives entirely off this router,
// in admin-pos-branches.route.js.
const POS_ROLES = ['owner', 'admin', 'manager', 'cashier'];

// SSE replay-buffer retention. Connection-time pruning is throttled to roughly
// hourly so a burst of reconnects does not run a global DELETE each time. This
// is a stopgap; a scheduled retention job should own this once one exists.
const EVENT_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
let lastEventPruneAt = 0;
async function pruneEventBuffer() {
  const now = Date.now();
  if (now - lastEventPruneAt < EVENT_RETENTION_INTERVAL_MS) return;
  lastEventPruneAt = now;
  try {
    await db.query("DELETE FROM pos_events WHERE created_at < now() - interval '2 days'");
  } catch (error) {
    lastEventPruneAt = 0;
    console.error('POS event retention prune failed:', error.message);
  }
}

router.use(requireAuth({ roles: POS_ROLES }));

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    registerId: req.session.posRegisterId || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    // Ties every audit_events row this request writes to the same id carried
    // by the pino log line, any app_errors row, and the reference code shown
    // to the cashier (docs/24, Phase A).
    requestId: req.requestId || null,
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

router.post('/registers/enrollment-tokens', posPinLimiter, asyncHandler(async (req, res) => {
  created(res, await createEnrollmentToken(context(req), req.body));
}));

router.post('/registers/enroll', posPinLimiter, asyncHandler(async (req, res) => {
  const register = await enrollRegister(context(req), req.body);
  req.session.posRegisterId = register.registerId;
  await saveSession(req);
  created(res, register);
}));

router.post('/registers/check-in', asyncHandler(async (req, res) => {
  const register = await checkInRegister(context(req), req.body);
  req.session.posRegisterId = register.registerId;
  await saveSession(req);
  ok(res, register);
}));

// Independent of the browser's online/offline events — the client polls this
// while offline or after a failed sale/sync, since a flaky LAN/Wi-Fi can drop
// API reachability without ever firing a browser `offline` event (the browser
// only reports its own network interface state, not whether the API is
// actually reachable).
router.get('/health-check', asyncHandler(async (req, res) => {
  ok(res, { ok: true, serverTime: new Date().toISOString() });
}));

router.get('/registers/current', asyncHandler(async (req, res) => {
  ok(res, await currentRegister(context(req)));
}));

router.post('/registers/receipt-number-blocks', asyncHandler(async (req, res) => {
  created(res, await allocateReceiptBlock(context(req)));
}));

// The register's own branch, falling back to the tenant's default branch —
// see branch-service.js's getEffectiveBranchProfile. Writes no longer go
// through this router at all: they're admin-only actions now, handled by
// /admin/pos-branches (see admin-pos-branches.route.js).
router.get('/business-profile', asyncHandler(async (req, res) => {
  ok(res, await getEffectiveBranchProfile(context(req)));
}));

router.put('/manager-pin', posPinLimiter, asyncHandler(async (req, res) => {
  ok(res, await setManagerPin(context(req), req.body));
}));

router.post('/manager/verify-pin', posPinLimiter, asyncHandler(async (req, res) => {
  ok(res, await verifyManagerPin(context(req), req.body));
}));

router.get('/products/search', asyncHandler(async (req, res) => {
  ok(res, await searchProducts(context(req), req.query));
}));

router.get('/products/filters', asyncHandler(async (req, res) => {
  ok(res, await listProductFilters(context(req)));
}));

router.get('/products/barcode/:barcode', asyncHandler(async (req, res) => {
  ok(res, await findByBarcode(context(req), req.params.barcode));
}));

router.post('/shifts/open', asyncHandler(async (req, res) => {
  created(res, await openShift(context(req), req.body));
}));

router.get('/shifts/current', asyncHandler(async (req, res) => {
  ok(res, await currentSummary(context(req), req.query.shiftId));
}));

router.post('/shifts/z-report', asyncHandler(async (req, res) => {
  created(res, await closeShift(context(req), req.body));
}));

router.get('/shifts/z-reports', asyncHandler(async (req, res) => {
  ok(res, await listZReports(context(req), { limit: req.query.limit }));
}));

router.get('/shifts/z-reports/:id', asyncHandler(async (req, res) => {
  ok(res, await getZReport(context(req), req.params.id));
}));

router.post('/cash-movements', asyncHandler(async (req, res) => {
  created(res, await recordCashMovement(context(req), req.body));
}));

router.get('/cash-movements', asyncHandler(async (req, res) => {
  ok(res, await listCashMovements(context(req), req.query.shiftId));
}));

router.post('/transactions', asyncHandler(async (req, res) => {
  created(res, await createSale(context(req), req.body));
}));

router.post('/transactions/sync', asyncHandler(async (req, res) => {
  ok(res, await syncTransactions(context(req), req.body));
}));

router.put('/sync-state', asyncHandler(async (req, res) => {
  ok(res, await reportSyncState(context(req), req.body));
}));

router.get('/transactions/lookup/:lookup', asyncHandler(async (req, res) => {
  ok(res, await findTransaction(context(req), req.params.lookup));
}));

router.post('/transactions/:id/void', asyncHandler(async (req, res) => {
  created(res, await voidTransaction(context(req), req.params.id, req.body));
}));

router.post('/refunds', asyncHandler(async (req, res) => {
  created(res, await createRefund(context(req), req.body));
}));

router.get('/parked-carts', asyncHandler(async (req, res) => {
  ok(res, await listParkedCarts(context(req)));
}));

router.post('/parked-carts', asyncHandler(async (req, res) => {
  created(res, await parkCart(context(req), req.body));
}));

router.delete('/parked-carts/:id', asyncHandler(async (req, res) => {
  ok(res, await deleteParkedCart(context(req), req.params.id));
}));

router.get('/sync-conflicts', asyncHandler(async (req, res) => {
  ok(res, await listConflicts(context(req)));
}));

router.post('/sync-conflicts/:id/resolve', asyncHandler(async (req, res) => {
  ok(res, await resolveConflict(context(req), req.params.id, req.body));
}));

/**
 * Customer lookup at the till.
 *
 * Phone-first because that is what a cashier can ask for and type in a queue,
 * but a name match is accepted too — a regular who is remembered by name and
 * not by number is a normal case in a small shop. Digits are matched against
 * the normalized `phone_key` (migration 023) so "+974 5551 2345" and
 * "97455512345" find the same person.
 */
router.get('/customers/search', asyncHandler(async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 60);
  const digits = raw.replace(/[^0-9]/g, '');
  if (raw.length < 3) return ok(res, []);

  const result = await db.query(
    `SELECT id, full_name, email, COALESCE(phone_number, phone, '') AS phone,
            orders_count, ltv_cents, last_order_at
     FROM customers
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND (
         ($2 <> '' AND phone_key LIKE $3)
         OR full_name ILIKE $4
         OR ($5 <> '' AND email IS NOT NULL AND email::text ILIKE $4)
       )
     ORDER BY last_order_at DESC NULLS LAST
     LIMIT 20`,
    [
      req.user.tenantId,
      digits,
      `%${digits}%`,
      `%${raw}%`,
      raw.includes('@') ? raw : '',
    ],
  );
  ok(res, result.rows.map((customer) => ({
    customerId: customer.id,
    name: customer.full_name,
    email: customer.email || '',
    phone: customer.phone,
    ordersCount: Number(customer.orders_count || 0),
    ltvCents: Number(customer.ltv_cents || 0),
    lastOrderAt: customer.last_order_at,
  })));
}));

/**
 * Quick-create a customer at the till.
 *
 * **Online only, deliberately.** A customer created offline could not get a
 * server id, so the sale would have to carry a client-invented identity that
 * later needs merging — the exact class of problem the receipt-number design
 * exists to avoid. Offline, the POS keeps selling as walk-in.
 *
 * Routed through the same matcher the storefront uses, so entering a phone
 * number that already belongs to an online customer **links to that person**
 * rather than creating a second record of them.
 */
router.post('/customers', asyncHandler(async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const email = String(req.body?.email || '').trim();

  if (!fullName) throw new PosError(422, 'INVALID_FIELD', 'Customer name is required.');
  if (!phone && !email) {
    throw new PosError(422, 'INVALID_FIELD', 'A phone number or an email address is required.');
  }
  if (phone && !/^[0-9+\-\s()]{6,25}$/.test(phone)) {
    throw new PosError(422, 'INVALID_FIELD', 'That phone number does not look valid.');
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new PosError(422, 'INVALID_FIELD', 'That email address does not look valid.');
  }

  const ctx = context(req);
  const result = await inTransaction(async (client) => {
    const resolved = await resolveCustomer(client, ctx.tenantId, { fullName, phone, email }, { source: 'pos' });
    await audit(
      client,
      ctx,
      resolved.created ? 'pos.customer.created' : 'pos.customer.linked',
      'customer',
      resolved.customerId,
      { matchedOn: resolved.matchedOn, source: 'pos' },
    );
    return resolved;
  });

  const saved = await db.query(
    `SELECT id, full_name, email, COALESCE(phone_number, phone, '') AS phone, orders_count, ltv_cents
       FROM customers WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, result.customerId],
  );
  const row = saved.rows[0];
  created(res, {
    customerId: row.id,
    name: row.full_name,
    email: row.email || '',
    phone: row.phone,
    ordersCount: Number(row.orders_count || 0),
    ltvCents: Number(row.ltv_cents || 0),
    // The cashier is told when an existing customer was matched instead of a
    // new one being created, so "already a customer" is visible at the till.
    linkedExisting: !result.created,
    matchedOn: result.matchedOn,
  }, result.created ? 'Customer created.' : 'Linked to an existing customer.');
}));

router.get('/print/certificate', asyncHandler(async (req, res) => {
  const certificate = await getQzCertificate(context(req));
  res.type('text/plain').send(certificate);
}));

router.post('/print/sign', asyncHandler(async (req, res) => {
  const signature = await signQzRequest(context(req), req.body?.request);
  res.type('text/plain').send(signature);
}));

router.get('/transactions/:id', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT 1 FROM pos_registers
     WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [req.user.tenantId, req.session.posRegisterId || null],
  );
  if (!result.rowCount) throw new PosError(428, 'REGISTER_REQUIRED', 'This terminal must be enrolled and checked in.');
  ok(res, await loadSale(db, req.user.tenantId, req.params.id));
}));

router.get('/events', async (req, res, next) => {
  const ctx = context(req);
  if (!ctx.registerId) return next(new PosError(428, 'REGISTER_REQUIRED', 'This terminal must be enrolled and checked in.'));
  let lastId = /^\d+$/.test(req.headers['last-event-id'] || '') ? req.headers['last-event-id'] : null;
  let refreshRequired = false;

  try {
    const register = await db.query(
      `SELECT id FROM pos_registers
       WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
      [ctx.tenantId, ctx.registerId],
    );
    if (!register.rowCount) throw new PosError(403, 'REGISTER_DISABLED', 'This POS register is disabled or revoked.');
    await pruneEventBuffer();
    const cursor = await db.query(
      'SELECT COALESCE(max(id), 0)::text AS max_id, COALESCE(min(id), 0)::text AS min_id FROM pos_events WHERE tenant_id = $1',
      [ctx.tenantId],
    );
    if (!lastId) {
      // First connection: start from the current head, no historical replay.
      lastId = cursor.rows[0].max_id;
    } else if (Number(lastId) < Number(cursor.rows[0].min_id) - 1) {
      // The client's replay position predates the retained buffer: events were
      // pruned between its last-seen id and the oldest retained id. Tell it to
      // do a full REST catalog refresh and resume from the current head.
      refreshRequired = true;
      lastId = cursor.rows[0].max_id;
    }
  } catch (error) {
    return next(error);
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  if (refreshRequired) {
    // Carry the current head as this event's id so the browser adopts a fresh
    // Last-Event-ID; otherwise the next reconnect resends the stale cursor and
    // we would emit refresh-required again in a loop.
    res.write(`id: ${lastId}\n`);
    res.write(`event: catalog.refresh-required\n`);
    res.write(`data: ${JSON.stringify({ type: 'catalog.refresh-required' })}\n\n`);
  }

  let closed = false;
  let polling = false;

  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      const events = await db.query(
        `SELECT id::text, event_type, payload, created_at
         FROM pos_events
         WHERE tenant_id = $1 AND id > $2::bigint
           AND (register_id IS NULL OR register_id = $3)
         ORDER BY id ASC LIMIT 100`,
        [ctx.tenantId, lastId, ctx.registerId],
      );
      for (const event of events.rows) {
        lastId = event.id;
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.event_type}\n`);
        res.write(`data: ${JSON.stringify({ type: event.event_type, ...event.payload, createdAt: event.created_at })}\n\n`);
      }
    } catch (error) {
      console.error('POS event stream poll failed:', error.message);
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(poll, 1000);
  const heartbeatTimer = setInterval(() => {
    if (!closed) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30000);
  poll();

  req.on('close', () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  });
});

// PosError shaping deliberately lives in the global error handler in
// index.js, not here.
//
// This router used to answer PosErrors itself, which meant every POS failure
// bypassed the global handler entirely: no correlation id in the response, no
// `app_errors` row, and no structured log line — on the one surface where a
// cashier is standing in front of a customer and support has to diagnose the
// failure remotely. The global handler produces the identical body (status,
// code, message, details) plus `requestId`, so forwarding loses nothing.
//
// Do not reintroduce a router-local error responder here.

module.exports = router;
