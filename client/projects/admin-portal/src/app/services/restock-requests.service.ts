import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
export interface RestockSummary {
  product_id: string; product_name: string; color_key: string; color: string | null; size: string;
  total_count: number; waiting_count: number; oldest_request: string; current_stock: number;
}
export interface RestockRequest {
  id: string; product_id: string; product_name: string; color: string | null; size: string; email: string;
  locale: string; status: string; requested_at: string; attempts: number; last_error: string | null;
}
@Injectable({ providedIn: 'root' })
export class RestockRequestsService {
  private readonly api = inject(ApiClient);
  summary(query = '') { return firstValueFrom(this.api.get<RestockSummary[]>(`/admin/restock-requests/summary?${query}`)); }
  list(query = '') { return firstValueFrom(this.api.get<{ rows: RestockRequest[]; total: number }>(`/admin/restock-requests?${query}`)); }
  action(id: string, action: 'resend' | 'cancel') { return firstValueFrom(this.api.post(`/admin/restock-requests/${id}/${action}`, {})); }
  exportUrl(query: string) { return this.api.url(`/admin/restock-requests/export.csv?${query}`); }
}
