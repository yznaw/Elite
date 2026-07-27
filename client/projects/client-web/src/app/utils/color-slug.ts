/**
 * Colour name normalisation shared by the product page and the home hero.
 *
 * The product detail page reads `?color=` from the URL and matches it against
 * its own variant colours using these exact rules, so the hero must generate
 * slugs the same way or a swatch deep-link silently resolves to nothing.
 */

/** Case- and whitespace-insensitive comparison key, e.g. " Copper Brown " -> "copper brown". */
export function colorKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

/** URL-safe form used in the `?color=` query param, e.g. "Light Beige" -> "lightbeige". */
export function colorSlug(value: string): string {
  return colorKey(value).replace(/[^a-z0-9]+/g, '');
}
