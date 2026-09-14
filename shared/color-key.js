// One normalization for storefront selection, API validation and dispatch.
const COLOR_ALIASES = Object.freeze({
  brwon: 'brown', cezzane: 'cezanne', greyserp: 'grey serpentine', serpertine: 'serpentine',
});
function colorKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return COLOR_ALIASES[key] || key;
}
function colorSlug(value) {
  // Preserve non-Latin names; URLSearchParams handles URL encoding.
  return colorKey(value).replace(/[^\p{L}\p{N}]+/gu, '');
}
module.exports = { COLOR_ALIASES, colorKey, colorSlug };
