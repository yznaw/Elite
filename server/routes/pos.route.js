const { Router } = require('express');
const db = require('../db/client');
const { requireAuth } = require('../middleware/require-auth');
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
const { closeShift, currentSummary, openShift } = require('../lib/pos/shift-service');
const { createSale, findByBarcode, loadSale, searchProducts } = require('../lib/pos/sale-service');
const { reportSyncState, syncTransactions } = require('../lib/pos/sync-service');
const { deleteParkedCart, listParkedCarts, parkCart } = require('../lib/pos/parked-cart-service');
const { createRefund, findTransaction, voidTransaction } = require('../lib/pos/correction-service');
const { listConflicts, resolveConflict } = require('../lib/pos/conflict-service');
const { getQzCertificate, signQzRequest } = require('../lib/pos/qz-service');

const router = Router();
const POS_ROLES = ['owner', 'admin', 'manager'];

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
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

router.post('/registers/enrollment-tokens', asyncHandler(async (req, res) => {
  created(res, await createEnrollmentToken(context(req), req.body));
}));

router.post('/registers/enroll', asyncHandler(async (req, res) => {
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

router.get('/registers/current', asyncHandler(async (req, res) => {
  ok(res, await currentRegister(context(req)));
}));

router.post('/registers/receipt-number-blocks', asyncHandler(async (req, res) => {
  created(res, await allocateReceiptBlock(context(req)));
}));

router.put('/manager-pin', asyncHandler(async (req, res) => {
  ok(res, await setManagerPin(context(req), req.body));
}));

router.post('/manager/verify-pin', asyncHandler(async (req, res) => {
  ok(res, await verifyManagerPin(context(req), req.body));
}));

router.get('/products/search', asyncHandler(async (req, res) => {
  ok(res, await searchProducts(context(req), req.query));
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

router.get('/customers/search', asyncHandler(async (req, res) => {
  const query = String(req.query.q || '').replace(/[^\d+]/g, '').slice(0, 30);
  if (query.length < 3) return ok(res, []);
  const result = await db.query(
    `SELECT id, full_name, email, COALESCE(phone_number, phone, '') AS phone
     FROM customers
     WHERE tenant_id = $1 AND deleted_at IS NULL
       AND regexp_replace(COALESCE(phone_number, phone, ''), '[^0-9+]', '', 'g') LIKE $2
     ORDER BY last_order_at DESC NULLS LAST LIMIT 20`,
    [req.user.tenantId, `%${query}%`],
  );
  ok(res, result.rows.map((customer) => ({
    customerId: customer.id,
    name: customer.full_name,
    email: customer.email || '',
    phone: customer.phone,
  })));
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

router.use((error, _req, res, next) => {
  if (!(error instanceof PosError)) return next(error);
  return res.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
});

module.exports = router;
