const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, created, notFound, validationError, toCents } = require('./lib');

const router = Router();

const VALID_CATEGORIES = new Set([
  'rent', 'salaries', 'utilities', 'marketing', 'logistics',
  'supplies', 'software', 'fees', 'maintenance', 'other',
]);
const VALID_PAYMENT_METHODS = new Set(['cash', 'card', 'bank_transfer', 'cheque', 'other']);
const VALID_RECURRENCES = new Set(['none', 'monthly', 'yearly']);

// lib's fromCents() rounds to whole units, which would silently drop the
// piastres off every expense. Money here is displayed to 2 decimals, so
// convert directly and keep them.
function money(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * A Postgres `date` comes back as a JS Date at local midnight, which turns
 * into the *previous* day once serialised to UTC JSON (Qatar is UTC+3). An
 * expense dated the 5th would reach the edit form as the 4th, so pull the
 * calendar date out in local terms and keep it a plain YYYY-MM-DD string.
 */
function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Defaults to the current month when the caller sends no window. */
function resolveRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isDate(query.from) ? query.from : `${today.slice(0, 7)}-01`;
  const to = isDate(query.to) ? query.to : today;
  return { from, to };
}

function mapExpense(row) {
  return {
    id:             row.id,
    expenseDate:    toIsoDate(row.occurrence_date || row.expense_date),
    category:       row.category,
    amount:         money(row.amount_cents),
    vendor:         row.vendor || '',
    paymentMethod:  row.payment_method,
    note:           row.note || '',
    receiptMediaId: row.receipt_media_id,
    receiptUrl:     row.receipt_url || null,
    recurrence:     row.recurrence,
    source:         row.source,
    // A projected occurrence of a recurring bill has no row of its own yet.
    // The UI shows it read-only until the user edits it, which materialises it.
    isProjected:    row.is_projected === true,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

/**
 * Expands recurring expenses across a date window.
 *
 * A recurring bill is stored as a single template row; its later occurrences
 * are generated on read rather than by a scheduler, so there is no cron job to
 * keep alive and no drift between what was scheduled and what the ledger says.
 * Non-recurring rows fall out of the same generate_series as a single row
 * (the 1000-year step can only ever produce the start date).
 *
 * An occurrence is suppressed when a materialised child row already covers
 * that date, which is what happens when the user edits one month of a
 * recurring bill.
 *
 * Params: $1 tenant, $2 from, $3 to.
 */
const OCCURRENCES_CTE = `
  WITH occ AS (
    SELECT
      e.*,
      ma.storage_url AS receipt_url,
      g.d::date AS occurrence_date,
      (e.recurrence <> 'none' AND g.d::date <> e.expense_date) AS is_projected
    FROM expenses e
    LEFT JOIN media_assets ma ON ma.id = e.receipt_media_id
    CROSS JOIN LATERAL generate_series(
      e.expense_date::timestamp,
      $3::timestamp,
      CASE e.recurrence
        WHEN 'monthly' THEN interval '1 month'
        WHEN 'yearly'  THEN interval '1 year'
        ELSE interval '1000 years'
      END
    ) AS g(d)
    WHERE e.tenant_id = $1
      AND e.expense_date <= $3::date
  ),
  expanded AS (
    SELECT occ.* FROM occ
    WHERE occ.occurrence_date >= $2::date
      AND NOT EXISTS (
        SELECT 1 FROM expenses child
        WHERE child.tenant_id = occ.tenant_id
          AND child.recurrence_parent_id = occ.id
          AND child.expense_date = occ.occurrence_date
      )
  )
`;

// GET /api/admin/expenses?from=&to=&category=&search=
router.get('/', asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const category = VALID_CATEGORIES.has(req.query.category) ? req.query.category : null;
  const search = String(req.query.search || '').trim();

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `${OCCURRENCES_CTE}
       SELECT * FROM expanded
       WHERE ($4::text IS NULL OR category = $4)
         AND ($5::text = '' OR vendor ILIKE '%' || $5 || '%' OR note ILIKE '%' || $5 || '%')
       ORDER BY occurrence_date DESC, created_at DESC`,
      [tenant.id, from, to, category, search],
    );
    ok(res, { from, to, expenses: result.rows.map(mapExpense) });
  } finally {
    client.release();
  }
}));

// GET /api/admin/expenses/summary?from=&to=
// Totals plus a per-category breakdown. This is what the Analytics page folds
// into net profit, so it counts projected occurrences too.
router.get('/summary', asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `${OCCURRENCES_CTE}
       SELECT category,
              COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
              COUNT(*)::int                          AS entry_count
       FROM expanded
       GROUP BY category
       ORDER BY total_cents DESC`,
      [tenant.id, from, to],
    );

    const byCategory = result.rows.map((r) => ({
      category: r.category,
      total: money(r.total_cents),
      entryCount: r.entry_count,
    }));
    const total = byCategory.reduce((sum, r) => sum + r.total, 0);

    ok(res, { from, to, total: Math.round(total * 100) / 100, byCategory });
  } finally {
    client.release();
  }
}));

// GET /api/admin/expenses/export.csv?from=&to=&category=
router.get('/export.csv', asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const category = VALID_CATEGORIES.has(req.query.category) ? req.query.category : null;

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `${OCCURRENCES_CTE}
       SELECT * FROM expanded
       WHERE ($4::text IS NULL OR category = $4)
       ORDER BY occurrence_date ASC`,
      [tenant.id, from, to, category],
    );

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'Date,Category,Amount (QAR),Vendor,Payment Method,Note,Source';
    const lines = result.rows.map((row) => {
      const e = mapExpense(row);
      return [e.expenseDate, e.category, e.amount.toFixed(2), e.vendor, e.paymentMethod, e.note, e.source]
        .map(esc).join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${from}-to-${to}.csv"`);
    // BOM so Excel opens the Arabic vendor/note columns in the right encoding.
    res.send(`﻿${[header, ...lines].join('\n')}\n`);
  } finally {
    client.release();
  }
}));

// POST /api/admin/expenses
router.post('/', asyncHandler(async (req, res) => {
  const errors = [];

  const expenseDate = isDate(req.body.expenseDate) ? req.body.expenseDate : null;
  if (!expenseDate) errors.push('A valid expense date is required.');

  const category = VALID_CATEGORIES.has(req.body.category) ? req.body.category : null;
  if (!category) errors.push('A valid category is required.');

  const amountCents = toCents(req.body.amount);
  if (amountCents <= 0) errors.push('Amount must be greater than zero.');

  if (errors.length) return validationError(res, errors);

  const paymentMethod = VALID_PAYMENT_METHODS.has(req.body.paymentMethod) ? req.body.paymentMethod : 'cash';
  const recurrence = VALID_RECURRENCES.has(req.body.recurrence) ? req.body.recurrence : 'none';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const result = await client.query(
      `INSERT INTO expenses
         (tenant_id, expense_date, category, amount_cents, vendor, payment_method,
          note, receipt_media_id, recurrence, recurrence_parent_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenant.id, expenseDate, category, amountCents,
        String(req.body.vendor || '').trim() || null,
        paymentMethod,
        String(req.body.note || '').trim() || null,
        req.body.receiptMediaId || null,
        recurrence,
        req.body.recurrenceParentId || null,
        req.session?.user?.id || null,
      ],
    );
    await client.query('COMMIT');
    created(res, mapExpense(result.rows[0]), 'Expense saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/admin/expenses/:id
router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const current = await client.query(
      'SELECT * FROM expenses WHERE tenant_id = $1 AND id = $2',
      [tenant.id, req.params.id],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Expense not found.');
    }

    const row = current.rows[0];
    const expenseDate   = isDate(req.body.expenseDate) ? req.body.expenseDate : row.expense_date;
    const category      = VALID_CATEGORIES.has(req.body.category) ? req.body.category : row.category;
    const amountCents   = req.body.amount !== undefined ? toCents(req.body.amount) : row.amount_cents;
    const paymentMethod = VALID_PAYMENT_METHODS.has(req.body.paymentMethod) ? req.body.paymentMethod : row.payment_method;
    const recurrence    = VALID_RECURRENCES.has(req.body.recurrence) ? req.body.recurrence : row.recurrence;
    const vendor        = req.body.vendor !== undefined ? (String(req.body.vendor).trim() || null) : row.vendor;
    const note          = req.body.note   !== undefined ? (String(req.body.note).trim()   || null) : row.note;
    const receiptId     = req.body.receiptMediaId !== undefined ? (req.body.receiptMediaId || null) : row.receipt_media_id;

    if (amountCents <= 0) {
      await client.query('ROLLBACK');
      return validationError(res, ['Amount must be greater than zero.']);
    }

    const result = await client.query(
      `UPDATE expenses
          SET expense_date = $3, category = $4, amount_cents = $5, vendor = $6,
              payment_method = $7, note = $8, receipt_media_id = $9,
              recurrence = $10, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenant.id, req.params.id, expenseDate, category, amountCents, vendor,
       paymentMethod, note, receiptId, recurrence],
    );
    await client.query('COMMIT');
    ok(res, mapExpense(result.rows[0]), 'Expense updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// DELETE /api/admin/expenses/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'DELETE FROM expenses WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Expense not found.');
    ok(res, { id: result.rows[0].id }, 'Expense deleted.');
  } finally {
    client.release();
  }
}));

// POST /api/admin/expenses/import-pos-cash-outs
// Mirrors POS paid-out cash movements into the ledger so petty cash is not
// tracked in two places. The partial unique index on (tenant_id,
// source_ref_id) makes this safe to run repeatedly — a movement already
// mirrored is skipped, never duplicated.
router.post('/import-pos-cash-outs', asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.body || {});
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const result = await client.query(
      `INSERT INTO expenses
         (tenant_id, expense_date, category, amount_cents, payment_method,
          note, source, source_ref_id, created_by_user_id)
       SELECT m.tenant_id, m.created_at::date, 'other', m.amount_cents, 'cash',
              m.reason, 'pos_cash_out', m.id, m.cashier_id
       FROM pos_cash_movements m
       WHERE m.tenant_id = $1
         AND m.kind = 'paid_out'
         AND m.created_at::date BETWEEN $2::date AND $3::date
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [tenant.id, from, to],
    );
    await client.query('COMMIT');
    ok(res, { imported: result.rowCount, from, to },
      result.rowCount === 0
        ? 'No new cash-outs to import.'
        : `Imported ${result.rowCount} cash-out${result.rowCount === 1 ? '' : 's'}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
