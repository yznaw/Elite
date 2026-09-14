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
  if (!product.variants?.length) return (product.stock || 0) > 0 ? 'available' : 'sold-out';
  return product.variants.some(v => colorKey(v.color) === colorKey(color) && v.isActive !== false && v.stock > 0)
    ? 'available' : 'sold-out';
}
export function productSoldOut(product: Product): boolean {
  return product.variants?.length ? !product.variants.some(v => v.isActive !== false && v.stock > 0) : !(Number(product.stock) > 0);
}
export function defaultColor(product: Product, requested?: string | null): string | null {
  const colors = productColors(product);
  return (requested && colors.find(c => colorKey(c) === colorKey(requested) || colorSlug(c) === colorSlug(requested)))
    || colors.find(c => colorState(product, c) === 'available') || colors[0] || null;
}
export function defaultSize(product: Product, color: string | null): number | null {
  return sizeOptions(product, color).find(s => s.state === 'available')?.size ?? null;
}
