const { audit, inTransaction } = require('./db');
const { assertPos, nonEmpty } = require('./errors');

const MAX_TEXT = 500;

function optionalText(value, field, maxLength = MAX_TEXT) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value).trim();
  assertPos(result.length <= maxLength, 422, 'INVALID_FIELD', `${field} is too long.`);
  return result || null;
}

/**
 * Optional, but stored as '' rather than NULL.
 *
 * For the columns declared `NOT NULL DEFAULT ''`, where "not provided" has to
 * round-trip as an empty string instead of a null.
 */
function optionalBlank(value, field, maxLength = MAX_TEXT) {
  const result = String(value ?? '').trim();
  assertPos(result.length <= maxLength, 422, 'INVALID_FIELD', `${field} is too long.`);
  return result;
}

function publicProfile(row) {
  if (!row) return null;
  return {
    tradeNameAr: row.trade_name_ar,
    tradeNameEn: row.trade_name_en,
    addressAr: row.address_ar,
    addressEn: row.address_en,
    phone: row.phone,
    crLicenseNumber: row.cr_license_number,
    returnPolicyAr: row.return_policy_ar,
    returnPolicyEn: row.return_policy_en,
    footerStampAr: row.footer_stamp_ar,
    footerStampEn: row.footer_stamp_en,
    updatedAt: row.updated_at,
  };
}

async function getBusinessProfile(context) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM pos_business_profile WHERE tenant_id = $1`,
      [context.tenantId],
    );
    return publicProfile(result.rows[0]);
  });
}

async function updateBusinessProfile(context, body) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can edit the POS business profile.',
  );

  // Only what the receipt actually prints is required.
  //
  // The Arabic trade name and address were mandatory here from when the
  // receipt was going to be bilingual. It is not: the receipt is English-only
  // (owner decision, 2026-08-01) and the renderer never reads either field, so
  // requiring them blocked the save on data that goes nowhere. They stay in
  // the table because a bilingual receipt is still a plausible future, and
  // because the storefront may want them; they are simply no longer a gate.
  //
  // The English name, the English address and the phone stay required. Those
  // are printed, and a receipt that cannot say who issued it or where they
  // are is a weak commercial document.
  const fields = {
    trade_name_ar: optionalBlank(body?.tradeNameAr, 'tradeNameAr', 200),
    trade_name_en: nonEmpty(body?.tradeNameEn, 'tradeNameEn', 200),
    address_ar: optionalBlank(body?.addressAr, 'addressAr', MAX_TEXT),
    address_en: nonEmpty(body?.addressEn, 'addressEn', MAX_TEXT),
    phone: nonEmpty(body?.phone, 'phone', 40),
    cr_license_number: optionalText(body?.crLicenseNumber, 'crLicenseNumber', 80),
    return_policy_ar: optionalText(body?.returnPolicyAr, 'returnPolicyAr'),
    return_policy_en: optionalText(body?.returnPolicyEn, 'returnPolicyEn'),
    footer_stamp_ar: optionalText(body?.footerStampAr, 'footerStampAr', 200),
    footer_stamp_en: optionalText(body?.footerStampEn, 'footerStampEn', 200),
  };

  return inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO pos_business_profile
        (tenant_id, trade_name_ar, trade_name_en, address_ar, address_en, phone,
         cr_license_number, return_policy_ar, return_policy_en, footer_stamp_ar, footer_stamp_en,
         updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         trade_name_ar = EXCLUDED.trade_name_ar,
         trade_name_en = EXCLUDED.trade_name_en,
         address_ar = EXCLUDED.address_ar,
         address_en = EXCLUDED.address_en,
         phone = EXCLUDED.phone,
         cr_license_number = EXCLUDED.cr_license_number,
         return_policy_ar = EXCLUDED.return_policy_ar,
         return_policy_en = EXCLUDED.return_policy_en,
         footer_stamp_ar = EXCLUDED.footer_stamp_ar,
         footer_stamp_en = EXCLUDED.footer_stamp_en,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = now()
       RETURNING *`,
      [
        context.tenantId,
        fields.trade_name_ar,
        fields.trade_name_en,
        fields.address_ar,
        fields.address_en,
        fields.phone,
        fields.cr_license_number,
        fields.return_policy_ar,
        fields.return_policy_en,
        fields.footer_stamp_ar,
        fields.footer_stamp_en,
        context.userId,
      ],
    );
    const row = result.rows[0];
    await audit(client, context, 'pos.business-profile.updated', 'pos_business_profile', row.id);
    return publicProfile(row);
  });
}

module.exports = { getBusinessProfile, updateBusinessProfile };
