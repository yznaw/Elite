const { sendMail } = require('./mailer');

const ROLE_LABEL = {
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Cashier',
  viewer: 'Viewer',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * The staff-invitation email. Deliberately its own small file rather than
 * folded into order-receipt.js — same brand template family (dark green
 * header, gold rule, Georgia headline) but a different audience and a
 * different failure posture: an order receipt is best-effort on top of a
 * sale that already happened, this is the *only* delivery path for the
 * invite link unless someone copies it by hand, so the caller decides how
 * to react to a failure here, this function only decides how to word it.
 *
 * Throws on failure (mailer.js's own contract — SMTP_NOT_CONFIGURED when no
 * SMTP_HOST is set, or whatever nodemailer raises). Callers must catch it;
 * this must never be the reason an invitation fails to be *created* — the
 * link itself is generated and returned regardless of whether the email
 * send succeeds.
 */
async function sendInvitationEmail({ to, role, inviteLink, inviterName, tenantName }) {
  const roleLabel = ROLE_LABEL[role] || role;
  const storeName = tenantName || 'Elite Collection';
  const invitedBy = inviterName ? `${inviterName} at ${storeName}` : storeName;

  const text = [
    `You've been invited to join ${storeName} on Elite's admin portal.`,
    '',
    `Invited by: ${invitedBy}`,
    `Role: ${roleLabel}`,
    '',
    `Accept your invitation: ${inviteLink}`,
    '',
    'This link expires in 48 hours and can only be used once.',
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
    <body style="margin:0;padding:0;background:#f4f0e8;color:#201a13;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">You've been invited to join ${escapeHtml(storeName)} as ${escapeHtml(roleLabel)}.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f0e8;width:100%">
        <tr><td align="center" style="padding:28px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fffdf9;border:1px solid #e8e1d6;border-top:4px solid #b8924a">
            <tr><td style="padding:34px 36px 28px;background:#024638;color:#fffaf0">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:.16em;line-height:34px">ELITE</div>
              <div style="margin-top:8px;color:#d6bc91;font-size:11px;letter-spacing:.18em;text-transform:uppercase">${escapeHtml(storeName)}</div>
            </tr></td>
            <tr><td style="padding:34px 36px 8px">
              <div style="color:#b8924a;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:bold">Team invitation</div>
              <h1 style="margin:10px 0 8px;color:#201a13;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:34px;font-weight:normal">You're invited to join ${escapeHtml(storeName)}.</h1>
              <p style="margin:0;color:#6f6457;font-size:14px;line-height:22px">${escapeHtml(invitedBy)} added you to the admin portal as <strong style="color:#201a13">${escapeHtml(roleLabel)}</strong>.</p>
            </td></tr>
            <tr><td style="padding:8px 36px 32px">
              <a href="${inviteLink}" style="display:inline-block;padding:14px 28px;background:#024638;color:#fffaf0;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:.02em">Accept invitation</a>
              <p style="margin:18px 0 0;color:#897b6b;font-size:12px;line-height:18px">This link expires in 48 hours and can only be used once. If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all;color:#6f6457">${escapeHtml(inviteLink)}</span></p>
            </td></tr>
            <tr><td style="padding:20px 36px 30px;border-top:1px solid #e8e1d6">
              <p style="margin:0;color:#897b6b;font-size:12px;line-height:18px">If you weren't expecting this invitation, you can safely ignore this email — no account is created until the link above is used.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>`;

  await sendMail({ to, subject: `You're invited to ${storeName}`, text, html });
}

module.exports = { sendInvitationEmail };
