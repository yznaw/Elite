/** Build the client-approved semi-automatic variant SKU: BASE-SIZE. */
export function formatVariantSku(baseSku: string, size: string): string {
  const base = String(baseSku || '').trim().replace(/-+$/, '');
  const suffix = String(size || '').trim();
  return base && suffix ? `${base}-${suffix}` : '';
}
