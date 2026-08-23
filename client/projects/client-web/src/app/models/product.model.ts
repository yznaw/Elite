export interface ProductVariant {
  id?: string;
  sku?: string;
  size?: number;
  color?: string;
  material?: string;
  /** Detail that applies to this size/colour only, e.g. a back zipper on the
   *  small sizes. Shown next to the size picker so one gallery can cover a
   *  range whose construction is not identical throughout. */
  noteEn?: string;
  noteAr?: string;
  price?: number;
  stock: number;
}

export interface ColorCopy {
  hookEn: string;
  hookAr: string;
  teaserEn: string;
  teaserAr: string;
}

export interface Product {
  id: string;
  name: string;
  brand?: string;
  /** Legacy long copy. No longer editable in the admin; kept only as a
   *  fallback for the Material & Care section on products saved before it
   *  existed. May contain rich-text markup. */
  descriptionEn?: string;
  descriptionAr?: string;
  /** Hook: one-line copy for compact surfaces such as the home hero. */
  shortDescriptionEn?: string;
  shortDescriptionAr?: string;
  /** Short description shown directly under the product name on the PDP. */
  teaserEn?: string;
  teaserAr?: string;
  /** Material & Care copy, its own PDP section. May contain rich-text markup. */
  careInstructionsEn?: string;
  careInstructionsAr?: string;
  price: number;
  tag: string;
  leather: string;
  style: string;
  category?: string;
  categories?: string[];
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  sizes: number[];
  stock?: number;
  image: string;
  images?: string[];
  imageVariants?: Record<string, Record<string, { url: string; width?: number; mimeType?: string }>>;
  colorImages?: Record<string, string>;
  /** Per-colour Hook/Short description override, keyed by lowercase colour
      name. A colour with no entry falls back to the fields above. */
  colorCopy?: Record<string, ColorCopy>;
  variants?: ProductVariant[];
  relatedProductIds?: string[];
}

export interface CartItem {
  id: string;
  variantId?: string;
  sku?: string;
  name: string;
  price: number;
  image: string;
  leather: string;
  color?: string | null;
  size: number;
  qty: number;
}
