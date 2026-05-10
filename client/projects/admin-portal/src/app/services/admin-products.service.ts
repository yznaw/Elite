import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProductVariant } from '../models';

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

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface SavedProductResponse {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'hidden' | 'archived';
  base_price_cents: number;
  stock_quantity: number;
}

@Injectable({ providedIn: 'root' })
export class AdminProductsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();

  saveProduct(payload: SaveProductPayload): Promise<SavedProductResponse> {
    return firstValueFrom(
      this.http.post<ApiResponse<SavedProductResponse>>(`${this.apiBase}/admin/products`, payload),
    ).then((res) => res.data);
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
