import type { Product, ProductVariant } from '../models/product.model';
import { colorKey } from '../../../../../../shared/color-key.js';

/**
 * What a product costs, read the same way everywhere.
 *
 * A variant's own price is the truth and the product's price is the fallback — the rule the
 * server already applies when it prices a bag line (`resolveLines` in carts.route.js) and the
 * one the till has always used. The storefront used to print `product.price` on the card and
 * on the product page while the bag charged the variant's, so a customer could be shown QAR
 * 1,000 and charged 1,300, or be shown 1,250 for a product whose cheapest size was 1,150.
 *
 * Prices here are whole riyals, as the API sends them.
 */

/** A variant's price, falling back to the product's. Zero counts as unset. */
export function variantPrice(product: Product, variant?: Pick<ProductVariant, 'price'> | null): number {
  return Number(variant?.price) > 0 ? Number(variant!.price) : Number(product.price) || 0;
}

/** Variants that can be priced: active, and this colour's when one is given. */
function pricedVariants(product: Product, color?: string | null): ProductVariant[] {
  const variants = (product.variants || []).filter((v) => v.isActive !== false);
  if (color == null) return variants;
  return variants.filter((v) => colorKey(v.color) === colorKey(color));
}

/**
 * The variant the bag would add: active, in stock, this colour and size.
 *
 * Deliberately a local copy of `selectedVariant()` from `stock-availability.ts` rather than an
 * import: these two modules stay independent so each can be unit-tested on its own under
 * Node's type stripper, which cannot resolve extensionless specifiers. The rule is three
 * lines; if it ever grows, share it instead of copying it again.
 */
function purchasableVariant(product: Product, color?: string | null, size?: number | null): ProductVariant | undefined {
  return (product.variants || []).find((v) => colorKey(v.color) === colorKey(color ?? null)
    && Number(v.size) === Number(size)
    && v.isActive !== false
    && v.stock > 0);
}

export interface PriceSpan {
  min: number;
  max: number;
  /** True when the two differ, which is the only time a range is drawn. */
  isRange: boolean;
}

const span = (prices: number[], fallback: number): PriceSpan => {
  if (prices.length === 0) return { min: fallback, max: fallback, isRange: false };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return { min, max, isRange: min !== max };
};

/** The span of a whole product, or of one colour. */
export function priceRange(product: Product, color?: string | null): PriceSpan {
  const variants = pricedVariants(product, color);
  return span(variants.map((v) => variantPrice(product, v)), Number(product.price) || 0);
}

/**
 * The price to show for what the customer has chosen so far.
 *
 * A chosen size is one exact price. A colour without a size is that colour's span, which is a
 * single number unless the colour's own sizes disagree. Nothing chosen is the product's span.
 * `isRange` is what tells the template whether to draw one number or two — the same rule the
 * till's product grid uses.
 */
export function displayPrice(product: Product, color?: string | null, size?: number | null): PriceSpan {
  if (size != null) {
    // The bag adds one concrete variant, so once a size is chosen the page shows that
    // variant's price. This matters on real data: a colour and size can carry two active
    // variants at different prices (two SKUs of the same shoe), and a range there would name
    // a price the customer cannot actually be charged.
    const buying = purchasableVariant(product, color, size);
    if (buying) {
      const exact = variantPrice(product, buying);
      return { min: exact, max: exact, isRange: false };
    }
    const sized = pricedVariants(product, color).filter((v) => Number(v.size) === size);
    if (sized.length) return span(sized.map((v) => variantPrice(product, v)), Number(product.price) || 0);
  }
  return priceRange(product, color);
}

/**
 * The number a product sorts and filters by: its cheapest sellable variant.
 *
 * Sorting on the product's own price put a product whose sizes start at 1,000 behind one that
 * costs 1,200, and a price filter could exclude a product the customer could in fact afford.
 */
export function sortPrice(product: Product): number {
  return priceRange(product).min;
}
