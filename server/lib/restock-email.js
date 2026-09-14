const { colorSlug } = require('../../shared/color-key');
function storefrontBaseUrl(env = process.env) {
  const raw = env.STOREFRONT_BASE_URL || (env.NODE_ENV !== 'production' ? env.CLIENT_BASE_URL || 'http://localhost:4200' : '');
  let url;
  try { url = new URL(raw); } catch { throw new Error('STOREFRONT_BASE_URL must be a public storefront URL.'); }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (env.NODE_ENV === 'production' && local)) {
    throw new Error('STOREFRONT_BASE_URL must not point to localhost in production.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function buildRestockEmail(n, base = storefrontBaseUrl()) {
  const ar = n.locale === 'ar';
  const name = ar ? n.product_name_ar || n.product_name : n.product_name;
  const url = new URL(`${base}/product/${n.product_id}`);
  if (n.color_key) url.searchParams.set('color', colorSlug(n.color_key));
  if (n.size !== 'ONE_SIZE') url.searchParams.set('size', n.size);
  const unsubscribe = new URL(`${base}/api/restock-notifications/unsubscribe`);
  unsubscribe.searchParams.set('token', n.unsubscribe_token);
  const size = n.size === 'ONE_SIZE' ? (ar ? 'مقاس واحد' : 'One size') : n.size;
  const color = ar ? n.color_name_ar || n.color : n.color;
  const price = new Intl.NumberFormat(ar ? 'ar-QA' : 'en-QA', { style: 'currency', currency: 'QAR' }).format(Number(n.base_price_cents || 0) / 100);
  const subject = ar ? `${name} متوفر من جديد` : `${name} is back in stock`;
  const detail = ar ? `المقاس: ${size}${color ? ` · اللون: ${color}` : ''} · ${price}` : `Size: ${size}${color ? ` · Color: ${color}` : ''} · ${price}`;
  const limited = ar ? 'الكميات محدودة وتخضع للتوفر وقت الشراء.' : 'Quantities are limited and subject to availability when you buy.';
  const cta = ar ? 'تسوق الآن' : 'Shop now';
  const consent = ar ? 'طلبت أن نبلغك عند توفر هذه القطعة مجدداً.' : 'You asked to be told when this was back.';
  const cancel = ar ? 'إلغاء الاشتراك' : 'Unsubscribe';
  let image = '';
  if (n.product_image) {
    try { const src = new URL(n.product_image, base); if (['http:', 'https:'].includes(src.protocol)) image = `<img src="${escapeHtml(src.href)}" alt="${escapeHtml(name)}" width="320" style="max-width:100%;height:auto">`; } catch { /* optional image */ }
  }
  return {
    subject,
    text: `${subject}\n${detail}\n${limited}\n${cta}: ${url.href}\n\n${consent}\n${cancel}: ${unsubscribe.href}`,
    html: `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><body style="font-family:Arial,sans-serif;background:#f7f5ef;color:#17392f;padding:32px"><main style="max-width:520px;margin:auto"><h1>${escapeHtml(subject)}</h1>${image}<p>${escapeHtml(detail)}</p><p>${limited}</p><p><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:16px 24px;background:#17392f;color:#fff">${cta}</a></p><hr><p>${consent} <a href="${escapeHtml(unsubscribe.href)}">${cancel}</a></p><p>Elite</p></main></body></html>`,
  };
}
module.exports = { storefrontBaseUrl, buildRestockEmail };
