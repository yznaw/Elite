import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CartItem } from '../models/product.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface CheckoutCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CheckoutAddress {
  fullName: string;
  phone: string;
  line1: string;
  city: string;
  country: string;
}

export interface CheckoutOrder {
  id: string;
  total: number;
  payment: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment: 'awaiting' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();

  createOrder(payload: {
    customer: CheckoutCustomer;
    shippingAddress: CheckoutAddress;
    items: CartItem[];
  }): Promise<CheckoutOrder> {
    return firstValueFrom(
      this.http.post<ApiResponse<CheckoutOrder>>(`${this.apiBase}/carts/checkout`, {
        ...payload,
        payment: {
          provider: 'pending_gateway',
          method: 'gateway_placeholder',
          status: 'pending',
        },
      }),
    ).then((res) => res.data);
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
