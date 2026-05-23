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

@Injectable({ providedIn: 'root' })
export class AdminOrdersService {
  private readonly api = inject(ApiClient);

  list(): Promise<Order[]> {
    return firstValueFrom(this.api.get<Order[]>('/admin/orders'));
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
}
