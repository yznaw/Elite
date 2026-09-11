import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Product } from '../models/product.model';
import { resolveClientMediaUrl } from '../utils/media-url';
import { API_BASE, PUBLIC_API_BASE } from '../core/api-base';

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
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly apiBase = inject(API_BASE);
  private readonly publicApiBase = inject(PUBLIC_API_BASE);
  private readonly cacheMs = 60_000;
  private loadPromise: Promise<Product[]> | null = null;
  private configPromise: Promise<void> | null = null;
  private loadedAt = 0;
  defaultImage = LOGO_FALLBACK;
  readonly products = this._products.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Browser: warm the catalogue immediately, so search and navigation feel
    // instant. Server: only when a page asks (`ensureLoaded()` from home and
    // collection). The nav injects this service on every page, so an eager
    // load here fetched the whole catalogue for every render, including
    // contact, story and policy pages that never show a product: ~800 kB
    // embedded in each page's transfer state and the full /api/products
    // response time added to every request.
    if (isPlatformBrowser(inject(PLATFORM_ID))) void this.loadFromApi();
  }

  /**
   * `defaultImage` feeds every product without art, so it must be known before
   * products are normalised, on both sides alike: a server that normalised with
   * the logo fallback and a browser that normalised with the configured image
   * would render different `src`s for the same product. Fetched once.
   */
  private loadConfig(): Promise<void> {
    this.configPromise ??= firstValueFrom(
      this.http.get<{ success: boolean; data: { defaultImage?: string } }>(`${this.apiBase}/config`),
    )
      .then((res) => {
        if (res?.data?.defaultImage) this.defaultImage = res.data.defaultImage;
      })
      .catch(() => { /* use logo fallback */ });
    return this.configPromise;
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
    if (this._products().length > 0) {
      if (Date.now() - this.loadedAt > this.cacheMs && !this._loading()) {
        void this.loadFromApi(true);
      }
      return this._products();
    }

    return this.loadFromApi();
  }

  async refresh(): Promise<Product[]> {
    return this.loadFromApi(true);
  }

  private async loadFromApi(force = false): Promise<Product[]> {
    if (force) this.loadPromise = null;
    if (this.loadPromise) return this.loadPromise;

    const url = force ? `${this.apiBase}/products?t=${Date.now()}` : `${this.apiBase}/products`;
    let failed = false;
    this._loading.set(true);
    this._error.set(null);

    this.loadPromise = this.loadConfig()
      .then(() => firstValueFrom(this.http.get<ApiResponse<Product[]>>(url)))
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          this._products.set(res.data.map((product) => this.normalizeProductImages(product)));
        }
        this.loadedAt = Date.now();
        return this._products();
      })
      .catch(() => {
        failed = true;
        this._error.set('Products could not be loaded.');
        return this._products();
      })
      .finally(() => {
        this._loaded.set(true);
        this._loading.set(false);
        if (failed) this.loadPromise = null;
      });

    return this.loadPromise;
  }

  private normalizeProductImages(product: Product): Product {
    const images = Array.isArray(product.images)
      ? product.images.map((image) => this.resolveMediaUrl(image)).filter(Boolean)
      : [];
    const image = this.resolveMediaUrl(product.image) || images[0] || this.defaultImage;
    const colorImages = this.normalizeColorImages(product.colorImages);
    const imageVariants = this.normalizeImageVariants(product.imageVariants);
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
      imageVariants: Object.keys(imageVariants).length ? imageVariants : undefined,
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

  private normalizeImageVariants(imageVariants: Product['imageVariants']): NonNullable<Product['imageVariants']> {
    return Object.entries(imageVariants || {}).reduce<NonNullable<Product['imageVariants']>>((map, [source, variants]) => {
      const sourceUrl = this.resolveMediaUrl(source);
      const normalizedVariants = Object.entries(variants || {}).reduce<Record<string, { url: string; width?: number; mimeType?: string }>>(
        (variantMap, [key, value]) => {
          const url = this.resolveMediaUrl(value?.url);
          if (!url) return variantMap;
          variantMap[key] = {
            ...value,
            url,
          };
          return variantMap;
        },
        {},
      );

      if (sourceUrl && Object.keys(normalizedVariants).length > 0) {
        map[sourceUrl] = normalizedVariants;
        Object.values(normalizedVariants).forEach((variant) => {
          map[variant.url] = normalizedVariants;
        });
      }

      return map;
    }, {});
  }


  private resolveMediaUrl(url: string | undefined): string {
    return resolveClientMediaUrl(url, this.publicApiBase);
  }
}
