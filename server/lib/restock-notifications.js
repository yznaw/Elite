const { colorKey } = require('../../shared/color-key');
const ONE_SIZE = 'ONE_SIZE';
const normalizeSize = value => String(value ?? '').trim() || ONE_SIZE;
function invalid(message, status = 422, code = 'INVALID_VARIANT') {
  return Object.assign(new Error(message), { status, code });
}
async function validateRestockSelection(client, tenantId, productId, input) {
  const product = (await client.query("SELECT id, stock_quantity FROM products WHERE tenant_id = $1 AND id = $2 AND status = 'active' FOR SHARE", [tenantId, productId])).rows[0];
  if (!product) throw invalid('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  const variants = (await client.query('SELECT size, color, stock_quantity, is_active FROM product_variants WHERE tenant_id = $1 AND product_id = $2 FOR SHARE', [tenantId, productId])).rows;
  const size = normalizeSize(input.size);
  // A product without variants has no colours to choose between, but the storefront still
  // sends the product's display colour; that used to reject every alert for such products.
  const key = variants.length ? colorKey(input.color) : '';
  const matches = variants.filter(v => normalizeSize(v.size) === size && colorKey(v.color) === key);
  if (variants.length ? !matches.length : size !== ONE_SIZE || key !== '') throw invalid('Choose a size and colour offered for this product.');
  if (variants.length ? matches.some(v => v.is_active && v.stock_quantity > 0) : product.stock_quantity > 0) {
    throw invalid('This selection is in stock.', 409, 'IN_STOCK');
  }
  return { size, color: matches[0]?.color || '', colorKey: key };
}
async function createRestockNotification(client, tenantId, input) {
  const selection = await validateRestockSelection(client, tenantId, input.productId, input);
  const inserted = await client.query(`
    INSERT INTO restock_notifications (tenant_id, product_id, email, name, phone, size, color, color_key, locale)
    VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9)
    ON CONFLICT (tenant_id, product_id, email, size, color_key) WHERE status IN ('pending', 'sending')
    DO UPDATE SET locale = EXCLUDED.locale, name = COALESCE(EXCLUDED.name, restock_notifications.name)
    RETURNING id, status, requested_at`,
  [tenantId, input.productId, input.email.toLowerCase(), input.name || null, input.phone || null, selection.size, selection.color, selection.colorKey, String(input.locale || '').trim().toLowerCase().split(/[-_]/)[0] === 'ar' ? 'ar' : 'en']);
  return inserted.rows[0];
}
// Shared SQL for claims, rechecks and the demand report. A variant-less product
// uses product stock; ONE_SIZE also matches NULL/empty size on actual variants.
function stockSql(rn = 'rn', p = 'p') {
  return `(CASE WHEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = ${p}.id AND v.tenant_id = ${p}.tenant_id)
    THEN COALESCE((SELECT max(v.stock_quantity) FROM product_variants v
      WHERE v.product_id = ${p}.id AND v.tenant_id = ${p}.tenant_id AND v.is_active = true
        AND COALESCE(NULLIF(btrim(v.size), ''), 'ONE_SIZE') = ${rn}.size
        AND restock_color_key(v.color) = ${rn}.color_key), 0)
    WHEN ${rn}.size = 'ONE_SIZE' AND ${rn}.color_key = '' THEN ${p}.stock_quantity ELSE 0 END)`;
}
module.exports = { createRestockNotification, validateRestockSelection, stockSql, normalizeSize, ONE_SIZE };
