import type { Product, ProductVariant } from '../models/product.model';
import { colorKey, colorSlug } from '../../../../../../shared/color-key.js';

export function productColors(product: Product): string[] {
  const colors = [product.color, ...(product.colors || []), ...(product.variants || []).map(v => v.color)];
  return [...new Map(colors.filter(Boolean).map(c => [colorKey(c), String(c).trim()])).values()];
}
export function matchingVariants(product: Product, color: string | null, size?: number | null): ProductVariant[] {
  return (product.variants || []).filter(v => colorKey(v.color) === colorKey(color)
    && (size == null ? v.size == null : Number(v.size) === size));
}
export function selectedVariant(product: Product, color: string | null, size?: number | null): ProductVariant | undefined {
  return matchingVariants(product, color, size).find(v => v.isActive !== false && v.stock > 0);
}
export function availableStock(product: Product, color: string | null, size?: number | null): number {
  if (!product.variants?.length) return Math.max(0, product.stock || 0);
  // A cart line targets one concrete variant, even if multiple materials share a size/colour.
  return Math.max(0, selectedVariant(product, color, size)?.stock || 0);
}
export function sizeOptions(product: Product, color: string | null): { size: number; state: 'available' | 'sold-out' }[] {
  const sizes = [...new Set([...product.sizes, ...(product.variants || []).flatMap(v => v.size == null ? [] : [v.size])])];
  return sizes.filter(size => !product.variants?.length || matchingVariants(product, color, size).length > 0)
    .map(size => ({ size, state: availableStock(product, color, size) > 0 ? 'available' as const : 'sold-out' as const }))
    .sort((a, b) => Number(a.state === 'sold-out') - Number(b.state === 'sold-out') || a.size - b.size);
}
export function colorState(product: Product, color: string | null): 'available' | 'sold-out' {
  return colorStock(product, color) > 0 ? 'available' : 'sold-out';
}
export function productSoldOut(product: Product): boolean {
  return product.variants?.length ? !product.variants.some(v => v.isActive !== false && v.stock > 0) : !(Number(product.stock) > 0);
}
export function defaultColor(product: Product, requested?: string | null): string | null {
  const colors = productColors(product);
  return (requested && colors.find(c => colorKey(c) === colorKey(requested) || colorSlug(c) === colorSlug(requested)))
    || colors.find(c => colorState(product, c) === 'available') || colors[0] || null;
}
/**
 * Stock for a colour across every size it offers.
 *
 * This is not the same question as `availableStock(product, color, null)`: a null size there means
 * "a variant with no size of its own", so it answers 0 for anything sized. Use this one to ask
 * whether a colour can be bought at all, before the customer has picked a size.
 */
export function colorStock(product: Product, color: string | null): number {
  if (!product.variants?.length) return Math.max(0, product.stock || 0);
  return (product.variants || [])
    .filter(v => colorKey(v.color) === colorKey(color) && v.isActive !== false)
    .reduce((most, v) => Math.max(most, v.stock || 0), 0);
}

/**
 * The size a customer picked, as it applies to the colour now showing.
 *
 * A size follows them to another colour only while it is in stock there: a shoe size is
 * the customer's, not the colour's, so there is no reason to make them pick it again. A
 * sold-out size is different. Picking one is how they ask to be told when it returns, so
 * it belongs to the colour it was picked on; carried elsewhere it read as a sold-out pick
 * on a colour they never chose a size for.
 */
export function carriedSize(product: Product, size: number | null | undefined, pickedOn: string | null | undefined, color: string | null): number | null {
  if (size == null) return null;
  const option = sizeOptions(product, color).find(o => o.size === size);
  if (!option) return null;
  if (option.state === 'available') return size;
  return colorKey(pickedOn) === colorKey(color) ? size : null;
}
