import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export interface PosReconciliationRegister {
  registerId: string;
  displayName: string;
}

export type PosReconciliationStatus = 'pending' | 'matched' | 'exception' | 'resolved';

export interface PosReconciliation {
  reconciliationId: string;
  registerId: string;
  registerName: string | null;
  businessDate: string;
  posTotalCents: number;
  settlementTotalCents: number | null;
  varianceCents: number | null;
  status: PosReconciliationStatus;
  notes: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class PosReconciliationService {
  private readonly api = inject(ApiClient);

  listRegisters(): Promise<PosReconciliationRegister[]> {
    return firstValueFrom(this.api.get<PosReconciliationRegister[]>('/admin/pos-reconciliation/registers'));
  }

  list(filter: { registerId?: string; from?: string; to?: string; status?: PosReconciliationStatus } = {}): Promise<PosReconciliation[]> {
    const params = new URLSearchParams();
    if (filter.registerId) params.set('registerId', filter.registerId);
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    if (filter.status) params.set('status', filter.status);
    const query = params.toString();
    return firstValueFrom(this.api.get<PosReconciliation[]>(`/admin/pos-reconciliation${query ? `?${query}` : ''}`));
  }

  refresh(registerId: string, businessDate: string): Promise<PosReconciliation> {
    return firstValueFrom(this.api.post<PosReconciliation>('/admin/pos-reconciliation/refresh', { registerId, businessDate }));
  }

  submitSettlement(registerId: string, businessDate: string, settlementTotalCents: number): Promise<PosReconciliation> {
    return firstValueFrom(this.api.post<PosReconciliation>('/admin/pos-reconciliation/settlement', {
      registerId, businessDate, settlementTotalCents,
    }));
  }

  resolve(reconciliationId: string, note: string): Promise<PosReconciliation> {
    return firstValueFrom(this.api.post<PosReconciliation>(`/admin/pos-reconciliation/${reconciliationId}/resolve`, { note }));
  }
}
