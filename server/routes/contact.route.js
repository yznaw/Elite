const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { sendMail } = require('../lib/mailer');
const { asyncHandler, created, ok, validationError } = require('./lib');

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const phone = String(req.body.phone || '').trim();
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  if (!name || !email || !message) return validationError(res, ['Name, email, and message are required.']);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO contact_submissions (tenant_id, name, email, phone, subject, message, locale)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, status, created_at
      `,
      [tenant.id, name, email, phone || null, subject || null, message, req.body.locale || 'en'],
    );
    await sendMail({
      to: process.env.CONTACT_EMAIL_TO || process.env.SMTP_USER,
      replyTo: email,
      subject: `New contact enquiry${subject ? `: ${subject}` : ''}`,
      text: [
        'New contact enquiry',
        '',
        `Name: ${name}`,
        `Email: ${email}`,
        phone ? `Phone: ${phone}` : null,
        subject ? `Subject: ${subject}` : null,
        '',
        message,
      ].filter(Boolean).join('\n'),
    });
    created(res, result.rows[0], 'Contact submission received.');
  } finally {
    client.release();
  }
}));

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('SELECT * FROM contact_submissions WHERE tenant_id = $1 ORDER BY created_at DESC', [tenant.id]);
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

module.exports = router;
