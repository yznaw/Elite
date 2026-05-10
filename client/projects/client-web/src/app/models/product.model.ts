export interface Product {
  id: string;
  name: string;
  price: number;
  tag: string;
  leather: string;
  style: string;
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
