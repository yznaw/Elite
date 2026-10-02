// Integrated QNB card terminal (ECR, Ideal Solutions DLL) — server side.
//
// The till drives the terminal through the local Elite Card Bridge
// (tools/elite-card-bridge). Money moves on the terminal first; this service
// records each terminal operation by its ECR unique transaction number (UTN)
// so an approval can always be matched to exactly one sale, void or refund,
// even when the browser, the network or the bridge died in between.
//
// Card data: only what the terminal itself prints is accepted — a masked PAN
// (first 6, X mask, last 4), expiry, scheme name and the masked e-receipt.
// Anything that looks like a full card number is refused, never stored.

const { audit, inTransaction, requireRegister } = require('./db');
const { PosError, assertPos, cents, nonEmpty } = require('./errors');
const { consumeOverride } = require('./manager-service');

const KINDS = new Set(['sale', 'void', 'refund']);
const STATUSES = new Set(['pending', 'approved', 'declined', 'cancelled', 'unknown', 'reversed']);
const FINAL = new Set(['approved', 'declined', 'cancelled', 'reversed']);
// unknown = the bridge lost the terminal mid-operation; only a status check
// against the terminal (or a manager reading its last slip) can settle it.
const TRANSITIONS = {
  pending: new Set(['approved', 'declined', 'cancelled', 'unknown', 'reversed']),
  unknown: new Set(['approved', 'declined', 'cancelled', 'reversed']),
};
const UTN_PATTERN = /^[A-Z0-9]{8,23}$/;
const MASKED_PAN_PATTERN = /^[0-9]{6}X{2,9}[0-9]{4}$/;
const DIGIT_RUN = /\d{13,19}/g;
const CARD_MODES = new Set(['manual', 'integrated']);
// An attempt still pending/unknown after this is shown to the till as needing
// a check; younger ones may simply still be on the terminal screen.
const UNRESOLVED_AFTER_SECONDS = 150;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * True when text holds something that is plausibly a full card number: a run
 * of 13-19 digits (also when written with spaces or dashes) that starts like
 * a payment card (2-6) and passes the Luhn check. Merchant IDs, sequence and
 * invoice numbers on the terminal slip do not, so they pass through.
 */
function containsPan(value) {
  const text = String(value);
  for (const candidate of [text, text.replace(/[ \t-]/g, '')]) {
    for (const run of candidate.match(DIGIT_RUN) || []) {
      if (/^[2-6]/.test(run) && luhn(run)) return true;
    }
  }
  return false;
}

function utnOf(value, field = 'utn') {
  const utn = String(value || '').trim().toUpperCase();
  assertPos(UTN_PATTERN.test(utn), 422, 'CARD_UTN_INVALID', `${field} must be 8 to 23 letters or digits.`);
  return utn;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  assertPos(text.length <= maxLength, 422, 'CARD_RESULT_INVALID', 'A card result field is too long.');
  assertPos(!containsPan(text), 422, 'CARD_DATA_REJECTED', 'Card results must never contain a full card number.');
  return text;
}

/**
 * The terminal sends the PAN as NNNNNNXXXXXXNNNN padded with F (DLL v1.15+);
 * older builds used * for the mask. Normalized to NNNNNNXXXXXXNNNN. Anything
 * that is not a masked PAN is refused outright rather than stored.
 */
function maskedPan(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim().toUpperCase().replace(/F+$/, '').replace(/\*/g, 'X');
  if (!raw) return null;
  assertPos(!/^\d{13,19}$/.test(raw), 422, 'CARD_DATA_REJECTED', 'A full card number was sent. Only the masked number may be stored.');
  assertPos(MASKED_PAN_PATTERN.test(raw), 422, 'CARD_RESULT_INVALID', 'Masked card number has an unexpected format.');
  return raw;
}

function cardExpiry(value) {
  if (value === undefined || value === null || value === '') return null;
  const expiry = String(value).trim();
  if (expiry === '0000' || /^F+$/i.test(expiry)) return null;
  assertPos(/^[0-9]{4}$/.test(expiry), 422, 'CARD_RESULT_INVALID', 'Card expiry must be MMYY.');
  return expiry;
}

function receiptText(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  assertPos(text.length <= 16000, 422, 'CARD_RESULT_INVALID', 'Terminal receipt is too long.');
  assertPos(!containsPan(text), 422, 'CARD_DATA_REJECTED', 'Terminal receipt contains an unmasked card number.');
  return text;
}

function txnAt(value) {
  if (!value) return null;
  const date = new Date(value);
  assertPos(!Number.isNaN(date.getTime()), 422, 'CARD_RESULT_INVALID', 'txnAt must be a valid timestamp.');
  return date.toISOString();
}

/** Whitelist of what the bridge result may put on an attempt row. */
function normalizeResult(body) {
  const status = String(body?.status || '');
  assertPos(STATUSES.has(status) && status !== 'pending', 422, 'CARD_RESULT_INVALID', 'status must be approved, declined, cancelled, unknown or reversed.');
  const result = {
    status,
    errorCode: optionalText(body?.errorCode, 60),
    message: optionalText(body?.message, 250),
    hostResponseCode: optionalText(body?.hostResponseCode, 10),
    authCode: optionalText(body?.authCode, 12),
    maskedPan: maskedPan(body?.maskedPan),
    cardExpiry: cardExpiry(body?.cardExpiry),
    issuer: optionalText(body?.issuer, 40),
    tid: optionalText(body?.tid, 20),
    mid: optionalText(body?.mid, 20),
    seqNo: optionalText(body?.seqNo, 20),
    invoiceNo: optionalText(body?.invoiceNo, 20),
    hostTrace: optionalText(body?.hostTrace, 20),
    txnAt: txnAt(body?.txnAt),
    entryMethod: optionalText(body?.entryMethod, 20),
    pinVerified: typeof body?.pinVerified === 'boolean' ? body.pinVerified : null,
    receiptText: receiptText(body?.receiptText),
  };
  if (status === 'approved') {
    assertPos(result.authCode, 422, 'CARD_RESULT_INVALID', 'An approved card result must carry the authorization code.');
  }
  return result;
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    attemptId: row.id,
    utn: row.utn,
    kind: row.kind,
    registerId: row.register_id,
    shiftId: row.shift_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    errorCode: row.error_code,
    message: row.message,
    hostResponseCode: row.host_response_code,
    authCode: row.auth_code,
    maskedPan: row.masked_pan,
    cardExpiry: row.card_expiry,
    issuer: row.issuer,
    tid: row.tid,
    mid: row.mid,
    seqNo: row.seq_no,
    invoiceNo: row.invoice_no,
    hostTrace: row.host_trace,
    txnAt: row.txn_at,
    entryMethod: row.entry_method,
    pinVerified: row.pin_verified,
    receiptText: row.receipt_text,
    originalAttemptId: row.original_attempt_id,
    transactionId: row.pos_transaction_id,
    refundId: row.pos_refund_id,
    voidId: row.pos_void_id,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadAttempt(client, tenantId, utn, { lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM pos_card_attempts WHERE tenant_id = $1 AND utn = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [tenantId, utn],
  );
  return result.rows[0] || null;
}

function assertIntegrated(register) {
  assertPos(
    register.card_mode === 'integrated',
    409,
    'CARD_TERMINAL_NOT_ENABLED',
    'This till is not linked to a card terminal. Ask an owner to enable it in Settings.',
  );
}

function normalizeAttemptBody(body) {
  const kind = String(body?.kind || '');
  assertPos(KINDS.has(kind), 422, 'CARD_KIND_INVALID', 'kind must be sale, void or refund.');
  return {
    utn: utnOf(body?.utn),
    kind,
    amountCents: cents(body?.amountCents, 'amountCents', { allowZero: false }),
    shiftId: body?.shiftId ? String(body.shiftId) : null,
    originalUtn: body?.originalUtn ? utnOf(body.originalUtn, 'originalUtn') : null,
  };
}

/**
 * Insert-or-return for an attempt. Called before the terminal is driven, and
 * again from sale/refund sync when the till was offline at the time, so the
 * same UTN must always resolve to the same row. A second call that disagrees
 * on register, kind or amount is a bug or tampering and is refused.
 */
async function ensureAttempt(client, context, register, attempt) {
  const existing = await loadAttempt(client, context.tenantId, attempt.utn, { lock: true });
  if (existing) {
    assertPos(
      existing.register_id === register.id && existing.kind === attempt.kind && Number(existing.amount_cents) === attempt.amountCents,
      409,
      'CARD_ATTEMPT_CONFLICT',
      'This card terminal reference belongs to a different payment.',
    );
    return existing;
  }
  let originalId = null;
  if (attempt.originalUtn) {
    const original = await loadAttempt(client, context.tenantId, attempt.originalUtn);
    assertPos(original, 404, 'CARD_ATTEMPT_NOT_FOUND', 'The original card payment was not found.');
    originalId = original.id;
  }
  let shiftId = null;
  if (attempt.shiftId) {
    const shift = await client.query(
      'SELECT id FROM pos_shifts WHERE tenant_id = $1 AND id = $2 AND register_id = $3',
      [context.tenantId, attempt.shiftId, register.id],
    );
    shiftId = shift.rows[0]?.id || null;
  }
  const inserted = await client.query(
    `INSERT INTO pos_card_attempts
       (tenant_id, register_id, shift_id, utn, kind, amount_cents, original_attempt_id, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [context.tenantId, register.id, shiftId, attempt.utn, attempt.kind, attempt.amountCents, originalId, context.userId],
  );
  await audit(client, context, 'pos.card.attempt', 'pos_card_attempt', inserted.rows[0].id, {
    utn: attempt.utn, kind: attempt.kind, amountCents: attempt.amountCents,
  });
  return inserted.rows[0];
}

/** Applies a terminal result to an attempt row (locked by the caller). */
async function applyResult(client, context, row, result) {
  if (row.status === result.status) {
    // Replays of the same final result are idempotent. An approval replayed
    // with a different auth code is two different charges under one UTN.
    assertPos(
      result.status !== 'approved' || row.auth_code === result.authCode,
      409,
      'CARD_RESULT_CONFLICT',
      'This card payment was already recorded with a different approval code.',
    );
    return row;
  }
  const allowed = TRANSITIONS[row.status];
  assertPos(
    allowed && allowed.has(result.status),
    409,
    'CARD_RESULT_CONFLICT',
    `This card payment is already ${row.status} and cannot become ${result.status}.`,
  );
  const updated = await client.query(
    `UPDATE pos_card_attempts SET
       status = $3, error_code = $4, message = $5, host_response_code = $6, auth_code = $7,
       masked_pan = $8, card_expiry = $9, issuer = $10, tid = $11, mid = $12, seq_no = $13,
       invoice_no = $14, host_trace = $15, txn_at = $16, entry_method = $17, pin_verified = $18,
       receipt_text = COALESCE($19, receipt_text)
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      context.tenantId, row.id, result.status, result.errorCode, result.message, result.hostResponseCode,
      result.authCode, result.maskedPan, result.cardExpiry, result.issuer, result.tid, result.mid,
      result.seqNo, result.invoiceNo, result.hostTrace, result.txnAt, result.entryMethod,
      result.pinVerified, result.receiptText,
    ],
  );
  await audit(client, context, 'pos.card.result', 'pos_card_attempt', row.id, {
    utn: row.utn, kind: row.kind, from: row.status, to: result.status,
    errorCode: result.errorCode, hostResponseCode: result.hostResponseCode,
  });
  return updated.rows[0];
}

async function recordAttempt(context, body) {
  const attempt = normalizeAttemptBody(body);
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    assertIntegrated(register);
    return mapAttempt(await ensureAttempt(client, context, register, attempt));
  });
}

async function recordResult(context, utnValue, body) {
  const utn = utnOf(utnValue);
  const result = normalizeResult(body);
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const row = await loadAttempt(client, context.tenantId, utn, { lock: true });
    assertPos(row, 404, 'CARD_ATTEMPT_NOT_FOUND', 'Card payment attempt not found.');
    assertPos(row.register_id === register.id, 403, 'CARD_ATTEMPT_OTHER_REGISTER', 'This card payment belongs to another till.');
    return mapAttempt(await applyResult(client, context, row, result));
  });
}

/**
 * What this till must look at before taking another card payment: anything
 * still pending/unknown, and — the dangerous case — an approved sale charge
 * that never became a sale (customer charged, no receipt).
 */
async function listUnresolved(context) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const result = await client.query(
      `SELECT * FROM pos_card_attempts
        WHERE tenant_id = $1 AND register_id = $2
          AND created_at < now() - make_interval(secs => $3)
          AND (
            status IN ('pending', 'unknown')
            OR (status = 'approved' AND kind = 'sale' AND pos_transaction_id IS NULL)
            OR (status = 'approved' AND kind = 'refund' AND pos_refund_id IS NULL)
            OR (status = 'approved' AND kind = 'void' AND pos_void_id IS NULL)
          )
        ORDER BY created_at`,
      [context.tenantId, register.id, UNRESOLVED_AFTER_SECONDS],
    );
    return result.rows.map(mapAttempt);
  });
}

/**
 * A manager settles an attempt the terminal could not (e.g. the bridge was
 * reinstalled and its journal lost): they read the terminal's last slip or
 * audit report and record what really happened. Needs manager approval.
 */
async function resolveAttempt(context, utnValue, body) {
  const utn = utnOf(utnValue);
  const outcome = String(body?.outcome || '');
  assertPos(['approved', 'declined', 'reversed', 'cancelled'].includes(outcome), 422, 'CARD_RESULT_INVALID', 'outcome must be approved, declined, cancelled or reversed.');
  const note = nonEmpty(body?.note, 'note', 500);
  const result = normalizeResult({ ...body, status: outcome });
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const row = await loadAttempt(client, context.tenantId, utn, { lock: true });
    assertPos(row, 404, 'CARD_ATTEMPT_NOT_FOUND', 'Card payment attempt not found.');
    assertPos(row.register_id === register.id, 403, 'CARD_ATTEMPT_OTHER_REGISTER', 'This card payment belongs to another till.');
    const override = await consumeOverride(client, context, 'card-resolve', body);
    const updated = await applyResult(client, context, row, result);
    const final = await client.query(
      `UPDATE pos_card_attempts SET resolved_by_user_id = $3, resolution_note = $4
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [context.tenantId, updated.id, override.manager_id, note],
    );
    await audit(client, context, 'pos.card.unknown_resolved', 'pos_card_attempt', row.id, {
      utn, outcome, note, managerId: override.manager_id,
    });
    return mapAttempt(final.rows[0]);
  });
}

/**
 * Validates and parses the cardAttempt a sale/refund/void carries. The
 * snapshot holds the terminal result too, so an offline-queued sale can create
 * and settle the attempt row on sync if the till never reached the API.
 */
function normalizeCardAttempt(value, kind) {
  if (value === undefined || value === null) return null;
  assertPos(typeof value === 'object', 422, 'CARD_ATTEMPT_INVALID', 'cardAttempt must be an object.');
  return {
    utn: utnOf(value.utn, 'cardAttempt.utn'),
    kind,
    amountCents: cents(value.amountCents, 'cardAttempt.amountCents', { allowZero: false }),
    shiftId: value.shiftId ? String(value.shiftId) : null,
    originalUtn: value.originalUtn ? utnOf(value.originalUtn, 'cardAttempt.originalUtn') : null,
    result: value.result ? normalizeResult({ ...value.result, status: value.result.status || 'approved' }) : null,
  };
}

/**
 * Called inside the sale/refund/void transaction. Makes sure the attempt
 * exists and is approved for exactly this amount on this till, and is not
 * already linked to another record. Returns the locked row.
 */
async function claimApprovedAttempt(client, context, register, cardAttempt, amountCents, linkColumn) {
  assertPos(cardAttempt.amountCents === amountCents, 422, 'CARD_AMOUNT_MISMATCH', 'The amount charged on the terminal does not match this total.');
  let row = await ensureAttempt(client, context, register, cardAttempt);
  if (cardAttempt.result && row.status !== 'approved') {
    row = await applyResult(client, context, row, cardAttempt.result);
  }
  assertPos(row.status === 'approved', 409, 'CARD_NOT_APPROVED', 'The card terminal has not approved this payment.');
  assertPos(!row[linkColumn], 409, 'CARD_ATTEMPT_USED', 'This card terminal approval is already linked to another receipt.');
  return row;
}

async function linkAttempt(client, tenantId, attemptId, linkColumn, entityId) {
  const allowed = new Set(['pos_transaction_id', 'pos_refund_id', 'pos_void_id']);
  if (!allowed.has(linkColumn)) throw new PosError(500, 'INTERNAL', 'Invalid card attempt link.');
  await client.query(
    `UPDATE pos_card_attempts SET ${linkColumn} = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, attemptId, entityId],
  );
}

async function getRegisterCardSettings(context, registerId) {
  return inTransaction(async (client) => {
    const result = await client.query(
      'SELECT id, display_name, card_mode, card_manual_fallback FROM pos_registers WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, registerId],
    );
    const row = result.rows[0];
    assertPos(row, 404, 'REGISTER_NOT_FOUND', 'POS register not found.');
    return { registerId: row.id, displayName: row.display_name, cardMode: row.card_mode, cardManualFallback: row.card_manual_fallback };
  });
}

async function updateRegisterCardSettings(context, registerId, body) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can change card terminal settings.');
  const cardMode = body?.cardMode === undefined ? undefined : String(body.cardMode);
  assertPos(cardMode === undefined || CARD_MODES.has(cardMode), 422, 'CARD_MODE_INVALID', 'cardMode must be manual or integrated.');
  const fallback = body?.cardManualFallback;
  assertPos(fallback === undefined || typeof fallback === 'boolean', 422, 'INVALID_FIELD', 'cardManualFallback must be true or false.');
  return inTransaction(async (client) => {
    const before = await client.query(
      'SELECT id, card_mode, card_manual_fallback FROM pos_registers WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [context.tenantId, registerId],
    );
    assertPos(before.rowCount, 404, 'REGISTER_NOT_FOUND', 'POS register not found.');
    const result = await client.query(
      `UPDATE pos_registers SET
         card_mode = COALESCE($3, card_mode),
         card_manual_fallback = COALESCE($4, card_manual_fallback)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, display_name, card_mode, card_manual_fallback`,
      [context.tenantId, registerId, cardMode ?? null, fallback ?? null],
    );
    const row = result.rows[0];
    await audit(client, context, 'pos.card.settings_updated', 'pos_register', registerId,
      { cardMode: row.card_mode, cardManualFallback: row.card_manual_fallback },
      { cardMode: before.rows[0].card_mode, cardManualFallback: before.rows[0].card_manual_fallback });
    return { registerId: row.id, displayName: row.display_name, cardMode: row.card_mode, cardManualFallback: row.card_manual_fallback };
  });
}

/** Owner/admin/manager list for the reconciliation page. */
async function listAttempts(context, { registerId, status, from, to, limit = 200 } = {}) {
  assertPos(!status || STATUSES.has(status), 422, 'INVALID_FIELD', 'status is invalid.');
  const max = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT a.*, r.display_name AS register_name
         FROM pos_card_attempts a
         JOIN pos_registers r ON r.id = a.register_id
        WHERE a.tenant_id = $1
          AND ($2::uuid IS NULL OR a.register_id = $2)
          AND ($3::text IS NULL OR a.status = $3)
          AND ($4::date IS NULL OR a.created_at >= $4::date)
          AND ($5::date IS NULL OR a.created_at < $5::date + 1)
        ORDER BY a.created_at DESC
        LIMIT $6`,
      [context.tenantId, registerId || null, status || null, from || null, to || null, max],
    );
    return result.rows.map((row) => ({ ...mapAttempt(row), registerName: row.register_name }));
  });
}

module.exports = {
  FINAL,
  claimApprovedAttempt,
  containsPan,
  getRegisterCardSettings,
  linkAttempt,
  listAttempts,
  listUnresolved,
  mapAttempt,
  maskedPan,
  normalizeCardAttempt,
  normalizeResult,
  recordAttempt,
  recordResult,
  resolveAttempt,
  updateRegisterCardSettings,
};
