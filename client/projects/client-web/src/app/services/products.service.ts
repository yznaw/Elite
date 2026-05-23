import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Product } from '../models/product.model';

const ALL_PRODUCTS: Product[] = [
  { id: '1', name: 'Al-Mahmal Oxford',  price: 2800, tag: 'Signature',  leather: 'Camel Nappa',      style: 'Oxford', sizes: [40, 41, 42, 43, 44, 45], image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=85&auto=format&fit=crop' },
  { id: '2', name: 'Najd Derby',        price: 2200, tag: 'New',        leather: 'Goat Suede',       style: 'Derby',  sizes: [39, 40, 41, 42, 43, 44], image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=600&q=85&auto=format&fit=crop' },
  { id: '3', name: 'Hijaz Loafer',      price: 1950, tag: 'Bestseller', leather: 'Calf Leather',     style: 'Loafer', sizes: [40, 41, 42, 43, 44],     image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&q=85&auto=format&fit=crop' },
  { id: '4', name: 'Rub Al Khali Boot', price: 3400, tag: 'Limited',    leather: 'Camel Full-Grain', style: 'Boot',   sizes: [41, 42, 43, 44, 45],     image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=85&auto=format&fit=crop' },
  { id: '5', name: 'Medina Mule',       price: 1600, tag: '',           leather: 'Goat Suede',       style: 'Loafer', sizes: [39, 40, 41, 42, 43],     image: 'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=600&q=85&auto=format&fit=crop' },
  { id: '6', name: 'Quraish Chelsea',   price: 2650, tag: 'New',        leather: 'Calf Leather',     style: 'Boot',   sizes: [40, 41, 42, 43, 44, 45], image: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=600&q=85&auto=format&fit=crop' },
];

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly _products = signal<Product[]>(ALL_PRODUCTS);
  private readonly apiBase = this.resolveApiBase();
  private loadPromise: Promise<Product[]> | null = null;

  constructor() {
    void this.loadFromApi();
  }

  getAll(): Product[] {
    return this._products();
  }

  getById(id: string): Product | undefined {
    return this._products().find((p) => p.id === id);
  }

  getFeatured(): Product[] {
    return this._products().slice(0, 3);
  }

  async ensureLoaded(): Promise<Product[]> {
    return this.loadFromApi();
  }

  async refresh(): Promise<Product[]> {
    return this.loadFromApi(true);
  }

  private async loadFromApi(force = false): Promise<Product[]> {
    if (force) this.loadPromise = null;
    if (this.loadPromise) return this.loadPromise;

    const url = force ? `${this.apiBase}/products?t=${Date.now()}` : `${this.apiBase}/products`;

    this.loadPromise = firstValueFrom(
      this.http.get<ApiResponse<Product[]>>(url),
    )
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          this._products.set(res.data);
        }
        return this._products();
      })
      .catch(() => this._products());

    return this.loadPromise;
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
