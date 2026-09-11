import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CartItem } from '../models/product.model';
import { API_BASE } from '../core/api-base';

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
  zone?: string;
  street?: string;
  building?: string;
  additionalDetails?: string;
  city: string;
  country: string;
}

export interface DeliveryQuote {
  available: boolean;
  id?: string;
  serviceName?: string;
  serviceCode?: string;
  amount: number;
  currency: string;
  eta?: string;
  message?: string;
}

export interface CheckoutOrder {
  id: string;          // UUID — use for payment initiation
  orderNumber: string; // human-readable reference (e.g. EC-26-0677520)
  total: number;
  delivery?: number;
  payment: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillment: 'awaiting' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
}

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE);

  createOrder(payload: {
    customer: CheckoutCustomer;
    shippingAddress: CheckoutAddress;
    items: CartItem[];
    shippingQuote: DeliveryQuote;
    idempotencyKey?: string;
    payment?: {
      provider: string;
      method: string;
      status: 'pending' | 'paid' | 'failed';
    };
  }): Promise<CheckoutOrder> {
    return firstValueFrom(
      this.http.post<ApiResponse<CheckoutOrder>>(`${this.apiBase}/carts/checkout`, {
        ...payload,
        payment: payload.payment || {
          provider: 'pending_gateway',
          method: 'gateway_placeholder',
          status: 'pending',
        },
      }),
    ).then((res) => res.data);
  }

  getDeliveryQuote(payload: {
    customer: CheckoutCustomer;
    shippingAddress: CheckoutAddress;
    items: CartItem[];
  }): Promise<DeliveryQuote> {
    return firstValueFrom(
      this.http.post<ApiResponse<DeliveryQuote>>(`${this.apiBase}/carts/shipping-quote`, payload),
    ).then((res) => res.data);
  }

}
