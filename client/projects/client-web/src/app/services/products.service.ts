import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';

const ALL_PRODUCTS: Product[] = [
  { id: 1, name: 'Al-Mahmal Oxford',  price: 2800, tag: 'Signature',  leather: 'Camel Nappa',      style: 'Oxford', sizes: [40, 41, 42, 43, 44, 45], image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=85&auto=format&fit=crop' },
  { id: 2, name: 'Najd Derby',        price: 2200, tag: 'New',        leather: 'Goat Suede',       style: 'Derby',  sizes: [39, 40, 41, 42, 43, 44], image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=600&q=85&auto=format&fit=crop' },
  { id: 3, name: 'Hijaz Loafer',      price: 1950, tag: 'Bestseller', leather: 'Calf Leather',     style: 'Loafer', sizes: [40, 41, 42, 43, 44],     image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&q=85&auto=format&fit=crop' },
  { id: 4, name: 'Rub Al Khali Boot', price: 3400, tag: 'Limited',    leather: 'Camel Full-Grain', style: 'Boot',   sizes: [41, 42, 43, 44, 45],     image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=85&auto=format&fit=crop' },
  { id: 5, name: 'Medina Mule',       price: 1600, tag: '',           leather: 'Goat Suede',       style: 'Loafer', sizes: [39, 40, 41, 42, 43],     image: 'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=600&q=85&auto=format&fit=crop' },
  { id: 6, name: 'Quraish Chelsea',   price: 2650, tag: 'New',        leather: 'Calf Leather',     style: 'Boot',   sizes: [40, 41, 42, 43, 44, 45], image: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=600&q=85&auto=format&fit=crop' },
];

@Injectable({ providedIn: 'root' })
export class ProductsService {
  getAll(): Product[] {
    return ALL_PRODUCTS;
  }

  getById(id: number): Product | undefined {
    return ALL_PRODUCTS.find((p) => p.id === id);
  }

  getFeatured(): Product[] {
    return ALL_PRODUCTS.slice(0, 3);
  }
}
