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
          this._products.set(res.data.map((product) => this.normalizeProductImages(product)));
        }
        return this._products();
      })
      .catch(() => this._products());

    return this.loadPromise;
  }

  private normalizeProductImages(product: Product): Product {
    const images = Array.isArray(product.images)
      ? product.images.map((image) => this.resolveMediaUrl(image)).filter(Boolean)
      : [];
    const image = this.resolveMediaUrl(product.image) || images[0] || product.image;
    const colorImages = this.normalizeColorImages(product.colorImages);
    const variants = Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
        ...variant,
        size: Number.isFinite(Number(variant.size)) ? Number(variant.size) : undefined,
        stock: Math.max(0, Number.parseInt(String(variant.stock), 10) || 0),
      }))
      : undefined;

    return {
      ...product,
      image,
      images: images.length ? [...new Set([image, ...images])] : product.images,
      colorImages: Object.keys(colorImages).length ? colorImages : undefined,
      variants,
    };
  }

  private normalizeColorImages(colorImages: Product['colorImages']): Record<string, string> {
    return Object.entries(colorImages || {}).reduce<Record<string, string>>((map, [color, url]) => {
      const key = String(color || '').trim().toLowerCase();
      const image = this.resolveMediaUrl(String(url || ''));
      if (key && image) map[key] = image;
      return map;
    }, {});
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  private resolveMediaUrl(url: string | undefined): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.apiBase.replace(/\/api\/?$/, '')}${value}`;
  }
}
