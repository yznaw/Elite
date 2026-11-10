const { Router } = require('express');
const db = require('../db/client');
const { stockSql } = require('../lib/restock-notifications');
const { kickRestockDispatch } = require('../lib/restock-dispatch-job');
const router = Router();
const statuses = ['pending', 'sending', 'notified', 'failed', 'cancelled'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function filters(req) {
  const values = [req.user.tenantId], clauses = ['rn.tenant_id = $1'];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (req.query.status) {
    if (!statuses.includes(req.query.status)) throw Object.assign(new Error('Invalid status.'), { status: 422 });
    add('rn.status = ?', req.query.status);
  }
  if (req.query.productId) {
    if (!uuid.test(req.query.productId)) throw Object.assign(new Error('Invalid product.'), { status: 422 });
    add('rn.product_id = ?::uuid', req.query.productId);
  }
  if (req.query.product) add('p.name ILIKE ?', `%${String(req.query.product).slice(0, 200)}%`);
  if (req.query.color !== undefined) add('rn.color_key = ?', String(req.query.color));
  if (req.query.size) add('rn.size = ?', String(req.query.size));
  for (const key of ['from', 'to']) {
    if (!req.query[key]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query[key]) || !Number.isFinite(Date.parse(req.query[key]))) throw Object.assign(new Error('Invalid date.'), { status: 422 });
    add(key === 'from' ? 'rn.requested_at >= ?::date' : "rn.requested_at < ?::date + interval '1 day'", req.query[key]);
  }
  if (req.query.soldOut === 'true') clauses.push(`${stockSql()} <= 0`);
  return { values, where: clauses.join(' AND ') };
}
const join = 'FROM restock_notifications rn JOIN products p ON p.id = rn.product_id AND p.tenant_id = rn.tenant_id';
const fields = 'rn.id, rn.product_id, p.name AS product_name, rn.email, rn.size, rn.color, rn.color_key, rn.locale, rn.status, rn.requested_at, rn.notified_at, rn.attempts, rn.last_error, rn.next_attempt_at';
router.get('/summary', async (req, res, next) => {
  try {
    const { values, where } = filters(req);
    const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit, 10) || 1000));
    values.push(limit);
    const result = await db.query(`WITH demand AS (SELECT rn.product_id, p.name AS product_name, rn.color_key, rn.color, rn.size,
      rn.status, rn.requested_at, ${stockSql()} AS current_stock ${join} WHERE ${where})
      SELECT product_id, product_name, color_key, min(color) AS color, size,
        count(*)::int AS total_count, count(*) FILTER (WHERE status IN ('pending','sending'))::int AS waiting_count,
        min(requested_at) AS oldest_request, max(current_stock)::int AS current_stock
      FROM demand GROUP BY product_id, product_name, color_key, size
      ORDER BY waiting_count DESC, oldest_request, product_id, color_key, size LIMIT $${values.length}`, values);
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
});
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
router.get('/export.csv', async (req, res, next) => {
  let client;
  try {
    const { values, where } = filters(req);
    client = await db.pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query(`DECLARE restock_export NO SCROLL CURSOR FOR SELECT ${fields} ${join} WHERE ${where} ORDER BY rn.requested_at DESC, rn.id`, values);
    res.set({ 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="restock-requests.csv"' }).type('text/csv');
    const columns = ['product_name','color','size','email','locale','status','requested_at','attempts','last_error'];
    res.write('\ufeff' + columns.map(csvCell).join(',') + '\r\n');
    while (!res.destroyed) {
      const batch = await client.query('FETCH 500 FROM restock_export');
      if (!batch.rowCount) break;
      const chunk = batch.rows.map(row => columns.map(k => csvCell(row[k] instanceof Date ? row[k].toISOString() : row[k])).join(',')).join('\r\n') + '\r\n';
      if (!res.write(chunk)) await new Promise(resolve => {
        const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
        res.once('drain', done); res.once('close', done);
      });
    }
    await client.query('COMMIT');
    res.end();
  } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); if (res.headersSent) res.destroy(); else next(error); }
  finally { client?.release(); }
});
router.get('/', async (req, res, next) => {
  try {
    const { values, where } = filters(req);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const total = await db.query(`SELECT count(*)::int AS count ${join} WHERE ${where}`, values);
    values.push(offset);
    const rows = await db.query(`SELECT ${fields} ${join} WHERE ${where} ORDER BY rn.requested_at DESC, rn.id LIMIT 100 OFFSET $${values.length}`, values);
    res.set('Cache-Control', 'no-store').json({ success: true, data: { rows: rows.rows, total: total.rows[0].count } });
  } catch (error) { next(error); }
});
for (const action of ['resend', 'cancel']) {
  router.post(`/:id/${action}`, async (req, res, next) => {
    if (!uuid.test(req.params.id)) return res.status(422).json({ success: false, message: 'Invalid request.' });
    try {
      const update = action === 'cancel'
        ? "status = 'cancelled', claim_token = NULL, claimed_at = NULL"
        : "status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = now(), claimed_at = NULL, claim_token = NULL";
      const result = await db.query(`UPDATE restock_notifications SET ${update}
        WHERE tenant_id = $1 AND id = $2 ${action === 'resend' ? "AND status IN ('pending','failed','notified') AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.status = 'active')" : ''}
        RETURNING id, product_id, status`, [req.user.tenantId, req.params.id]);
      if (!result.rowCount) return res.status(409).json({ success: false, message: 'Request unavailable, cancelled, or already sending.' });
      if (action === 'resend') kickRestockDispatch([result.rows[0].product_id]);
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, message: 'An open request already exists for this customer and selection.' });
      next(error);
    }
  });
}
module.exports = router;
module.exports._test = { csvCell };
