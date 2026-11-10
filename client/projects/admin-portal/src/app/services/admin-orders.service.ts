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
  /** Server-side sort. Column keys are whitelisted in admin-orders.route.js. */
  sort?: string;
  dir?: 'asc' | 'desc';
  /** Only paid website orders waiting for approval (stock per location). */
  needsApproval?: boolean;
}

export interface AllocationLine {
  variantId: string;
  sku: string;
  productName: string;
  size: string | null;
  color: string | null;
  quantity: number;
}

export interface AllocationOption {
  id: string;
  name: string;
  type: 'store' | 'warehouse';
  allAvailable: boolean;
  missing: (AllocationLine & { available: number; elsewhere: { locationId: string; name: string; quantity: number }[] })[];
}

export interface OrderAllocation {
  enabled: boolean;
  needsApproval: boolean;
  approvedAt: string | null;
  pickupLocation: string | null;
  lines: AllocationLine[];
  locations: AllocationOption[];
}

export interface OrderListResponse {
  orders: Order[];
  needsApprovalCount?: number;
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
    if (params.sort)            qs.set('sort',        params.sort);
    if (params.dir)             qs.set('dir',         params.dir);
    if (params.needsApproval)   qs.set('needsApproval', 'true');
    const suffix = qs.toString() ? `?${qs}` : '';
    return firstValueFrom(this.api.get<OrderListResponse>(`/admin/orders${suffix}`));
  }

  allocation(id: string): Promise<OrderAllocation> {
    return firstValueFrom(this.api.get<OrderAllocation>(`/admin/orders/${id}/allocation`));
  }

  approve(id: string, locationId: string): Promise<Order> {
    return firstValueFrom(this.api.post<Order>(`/admin/orders/${id}/approve`, { locationId }));
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
