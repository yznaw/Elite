import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Customer } from '../models';

export interface SaveCustomerPayload {
  name: string;
  email: string;
  city: string;
  sizePref: number;
  notes: string;
  ltv?: number;
  orders?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminCustomersService {
  private readonly api = inject(ApiClient);

  list(): Promise<Customer[]> {
    return firstValueFrom(this.api.get<Customer[]>('/admin/customers'));
  }

  get(id: string): Promise<Customer> {
    return firstValueFrom(this.api.get<Customer>(`/admin/customers/${id}`));
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
}
