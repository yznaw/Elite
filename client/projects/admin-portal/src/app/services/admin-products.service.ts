import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Product, ProductVariant } from '../models';

export interface SaveProductPayload {
  name: string;
  sku: string;
  brand: string;
  price: number;
  stock: number;
  hidden: boolean;
  enDesc: string;
  arDesc: string;
  metaTitle: string;
  metaDesc: string;
  slug: string;
  variants: ProductVariant[];
  images: string[];
  imageColors: Record<string, string>;
  relatedProductIds: string[];
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  private readonly api = inject(ApiClient);

  list(): Promise<Product[]> {
    return firstValueFrom(this.api.get<Product[]>('/admin/products'))
      .then(products => products.map(p => this.normalizeProduct(p)));
  }

  get(id: string): Promise<Product> {
    return firstValueFrom(this.api.get<Product>(`/admin/products/${id}`))
      .then(p => this.normalizeProduct(p));
  }

  /** Resolve /uploads/… image URLs so they route through the API proxy.
   *  imageColors keys are URL-keyed, so they must be normalized to the same
   *  proxy format as images[] — otherwise imageForColor() can never match. */
  private normalizeProduct(p: Product): Product {
    const norm = (u: string) => this.api.mediaUrl(u);
    return {
      ...p,
      image:       p.image ? norm(p.image) : p.image,
      images:      p.images?.map(norm) ?? p.images,
      imageColors: Object.fromEntries(
        Object.entries(p.imageColors ?? {}).map(([url, color]) => [norm(url), color])
      ),
    };
  }

  saveProduct(payload: SaveProductPayload): Promise<Product> {
    return firstValueFrom(this.api.post<Product>('/admin/products', payload))
      .then(p => this.normalizeProduct(p));
  }

  update(id: string, payload: Partial<SaveProductPayload>): Promise<Product> {
    return firstValueFrom(this.api.patch<Product>(`/admin/products/${id}`, payload))
      .then(p => this.normalizeProduct(p));
  }

  archive(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/products/${id}`));
  }

  bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    return firstValueFrom(this.api.post<{ deleted: number }>('/admin/products/bulk-delete', { ids }));
  }

  duplicate(id: string): Promise<Product> {
    return firstValueFrom(this.api.post<Product>(`/admin/products/${id}/duplicate`, {}))
      .then(p => this.normalizeProduct(p));
  }

  bulkStockUpdate(updates: { sku: string; stock: number }[]): Promise<{ updated: number; notFound: string[] }> {
    return firstValueFrom(this.api.patch<{ updated: number; notFound: string[] }>('/admin/products/bulk-stock', { updates }));
  }
}
