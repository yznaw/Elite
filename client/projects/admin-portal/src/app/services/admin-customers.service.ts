import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Customer, Order } from '../models';

export interface SaveCustomerPayload {
  name: string;
  email: string;
  phone?: string;
  city: string;
  sizePref: number;
  notes: string;
}

export interface CustomerListParams {
  page?: number;
  limit?: number;
  q?: string;
  /** Server-side sort. Column keys are whitelisted in admin-customers.route.js. */
  sort?: string;
  dir?: 'asc' | 'desc';
}

export interface CustomerListResponse {
  customers: Customer[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

@Injectable({ providedIn: 'root' })
export class AdminCustomersService {
  private readonly api = inject(ApiClient);

  list(params: CustomerListParams = {}): Promise<CustomerListResponse> {
    const qs = new URLSearchParams();
    if (params.page  != null) qs.set('page',  String(params.page));
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.q)             qs.set('q',     params.q);
    if (params.sort)          qs.set('sort',  params.sort);
    if (params.dir)           qs.set('dir',   params.dir);
    const suffix = qs.toString() ? `?${qs}` : '';
    return firstValueFrom(this.api.get<CustomerListResponse>(`/admin/customers${suffix}`));
  }

  get(id: string): Promise<Customer> {
    return firstValueFrom(this.api.get<Customer>(`/admin/customers/${id}`));
  }

  getOrders(id: string): Promise<Order[]> {
    return firstValueFrom(this.api.get<Order[]>(`/admin/customers/${id}/orders`));
  }

  create(payload: SaveCustomerPayload): Promise<Customer> {
    return firstValueFrom(this.api.post<Customer>('/admin/customers', payload));
  }

  update(id: string, payload: Partial<SaveCustomerPayload>): Promise<Customer> {
    return firstValueFrom(this.api.patch<Customer>(`/admin/customers/${id}`, payload));
  }

  remove(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/customers/${id}`));
  }

  restore(id: string): Promise<Customer> {
    return firstValueFrom(this.api.patch<Customer>(`/admin/customers/${id}/restore`, {}));
  }
}
