/** Build the client-approved semi-automatic variant SKU: BASE-SIZE. */
export function formatVariantSku(baseSku: string, size: string): string {
  const base = String(baseSku || '').trim().replace(/-+$/, '');
  const suffix = String(size || '').trim();
  return base && suffix ? `${base}-${suffix}` : '';
}

/** Recover a colour's base SKU from a saved variant without guessing any
 * model, leather or colour segment. Example: 1493-GF-MK-5.5 → 1493-GF-MK. */
export function variantBaseSku(variantSku: string, size: string): string {
  const sku = String(variantSku || '').trim();
  const suffix = String(size || '').trim();
  if (!sku || !suffix) return sku;
  const expectedSuffix = `-${suffix}`;
  return sku.endsWith(expectedSuffix) ? sku.slice(0, -expectedSuffix.length) : sku;
}
