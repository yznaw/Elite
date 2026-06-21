import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Order, OrderFulfillment, OrderPayment } from '../models';

export interface OrderStatusPayload {
  payment?: OrderPayment;
  fulfillment?: OrderFulfillment;
  status?: string;
  trackingNumber?: string;
  timelineKind?: string;
  detail?: string;
}

export interface OrderListParams {
  page?: number;
  limit?: number;
  payment?: string;
  fulfillment?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

@Injectable({ providedIn: 'root' })
export class AdminOrdersService {
  private readonly api = inject(ApiClient);

  list(params: OrderListParams = {}): Promise<OrderListResponse> {
    const qs = new URLSearchParams();
    if (params.page   != null)  qs.set('page',        String(params.page));
    if (params.limit  != null)  qs.set('limit',       String(params.limit));
    if (params.payment)         qs.set('payment',     params.payment);
    if (params.fulfillment)     qs.set('fulfillment', params.fulfillment);
    if (params.from)            qs.set('from',        params.from);
    if (params.to)              qs.set('to',          params.to);
    if (params.q)               qs.set('q',           params.q);
    const suffix = qs.toString() ? `?${qs}` : '';
    return firstValueFrom(this.api.get<OrderListResponse>(`/admin/orders${suffix}`));
  }

  get(id: string): Promise<Order> {
    return firstValueFrom(this.api.get<Order>(`/admin/orders/${id}`));
  }

  updateStatus(id: string, payload: OrderStatusPayload): Promise<Order> {
    return firstValueFrom(this.api.patch<Order>(`/admin/orders/${id}/status`, payload));
  }

  addNote(id: string, body: string): Promise<{ id: string; ts: string; body: string }> {
    return firstValueFrom(
      this.api.post<{ id: string; ts: string; body: string }>(`/admin/orders/${id}/notes`, { body }),
    );
  }

  rebookDelivery(id: string): Promise<Order> {
    return firstValueFrom(this.api.post<Order>(`/admin/orders/${id}/rebook-delivery`, {}));
  }
}
