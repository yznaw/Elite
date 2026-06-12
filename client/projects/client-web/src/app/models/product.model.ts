export interface ProductVariant {
  id?: string;
  sku?: string;
  size?: number;
  color?: string;
  material?: string;
  price?: number;
  stock: number;
}

export interface Product {
  id: string;
  name: string;
  brand?: string;
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
