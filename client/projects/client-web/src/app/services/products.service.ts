import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Product } from '../models/product.model';

const LOGO_FALLBACK = '/assets/brand/elite-logo-green.png';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly _products = signal<Product[]>([]);
  private readonly apiBase = this.resolveApiBase();
  private loadPromise: Promise<Product[]> | null = null;
  defaultImage = LOGO_FALLBACK;

  constructor() {
    void this.loadConfig().then(() => this.loadFromApi());
  }

  private async loadConfig(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: { defaultImage?: string } }>(`${this.apiBase}/config`),
      );
      if (res?.data?.defaultImage) this.defaultImage = res.data.defaultImage;
    } catch { /* use logo fallback */ }
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
    const image = this.resolveMediaUrl(product.image) || images[0] || this.defaultImage;
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

    return `${this.apiBase}${value}`; // /api/uploads/… routes through the existing proxy
  }
}
