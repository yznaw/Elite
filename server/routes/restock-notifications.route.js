const { Router } = require('express');
const db = require('../db/client');
const router = Router();
router.get('/unsubscribe', async (req, res, next) => {
  const token = String(req.query.token || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return res.status(400).type('text').send('Invalid unsubscribe link.');
  try {
    const result = await db.query(`WITH cancelled AS (
      UPDATE restock_notifications SET status = 'cancelled', claim_token = NULL, claimed_at = NULL
      WHERE unsubscribe_token = $1 AND status <> 'cancelled' RETURNING locale
    ) SELECT locale FROM cancelled UNION ALL
      SELECT locale FROM restock_notifications WHERE unsubscribe_token = $1 LIMIT 1`, [token]);
    if (!result.rowCount) return res.status(404).type('text').send('This link has expired. / انتهت صلاحية الرابط.');
    const ar = result.rows[0].locale === 'ar';
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(`<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Elite</title><body><main><h1>${ar ? 'تم إلغاء الاشتراك' : 'You have unsubscribed'}</h1><p>${ar ? 'لن تتلقى المزيد من التنبيهات لهذا الطلب.' : 'You will receive no more alerts for this request.'}</p></main></body></html>`);
  } catch (error) { next(error); }
});
module.exports = router;
