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
  has3d: boolean;
  views3d: number;
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  private readonly api = inject(ApiClient);

  list(): Promise<Product[]> {
    return firstValueFrom(this.api.get<Product[]>('/admin/products'));
  }

  get(id: string): Promise<Product> {
    return firstValueFrom(this.api.get<Product>(`/admin/products/${id}`));
  }

  saveProduct(payload: SaveProductPayload): Promise<Product> {
    return firstValueFrom(this.api.post<Product>('/admin/products', payload));
  }

  update(id: string, payload: Partial<SaveProductPayload>): Promise<Product> {
    return firstValueFrom(this.api.patch<Product>(`/admin/products/${id}`, payload));
  }

  archive(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/products/${id}`));
  }

  bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    return firstValueFrom(this.api.post<{ deleted: number }>('/admin/products/bulk-delete', { ids }));
  }
}
