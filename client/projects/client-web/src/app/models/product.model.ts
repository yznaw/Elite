export interface Product {
  id: number;
  name: string;
  price: number;
  tag: string;
  leather: string;
  style: string;
  sizes: number[];
  image: string;
}

export interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  leather: string;
  size: number;
  qty: number;
}
