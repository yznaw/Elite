const nodemailer = require('nodemailer');

let transporter;

function configured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || '',
      }
      : undefined,
  });

  return transporter;
}

async function sendMail(message) {
  const from = process.env.SMTP_FROM || process.env.STORE_EMAIL_FROM || 'Elite <no-reply@elite.local>';

  if (!configured()) {
    console.log('\n[email:preview]', {
      to: message.to,
      from,
      subject: message.subject,
      text: message.text,
    });
    const err = new Error('SMTP_HOST is not configured.');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  return getTransporter().sendMail({
    from,
    ...message,
  });
}

module.exports = {
  sendMail,
};
