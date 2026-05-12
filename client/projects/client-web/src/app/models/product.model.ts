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
  image: string;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  leather: string;
  size: number;
  qty: number;
}
