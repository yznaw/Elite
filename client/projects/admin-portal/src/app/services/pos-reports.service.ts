import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export interface PosReportFilter {
  from?: string;
  to?: string;
  registerId?: string;
  cashierId?: string;
  reason?: string;
}

export interface PosDailySalesReport {
  totalCents: number;
  transactionCount: number;
  byDay: Array<{ businessDate: string; totalCents: number; transactionCount: number }>;
  byPaymentMethod: Array<{ paymentMethod: string; totalCents: number; transactionCount: number }>;
  byCashier: Array<{ cashierId: string; cashierName: string; totalCents: number; transactionCount: number }>;
  byRegister: Array<{ registerId: string; registerName: string; totalCents: number; transactionCount: number }>;
  byHour: Array<{ hourOfDay: number; totalCents: number; transactionCount: number }>;
  byItem: Array<{ sku: string; productName: string; variantTitle: string | null; quantity: number; totalCents: number }>;
}

export interface PosCashMovementsReport {
  movements: Array<{
    movementId: string; kind: string; amountCents: number; reason: string; createdAt: string;
    registerId: string; registerName: string; cashierId: string; cashierName: string;
    managerId: string | null; managerName: string | null;
  }>;
  zReportVariances: Array<{
    zReportId: string; createdAt: string; registerId: string; registerName: string;
    expectedCashCents: number; physicalCashCents: number; varianceCents: number;
    cashInCents: number; cashOutCents: number;
  }>;
}

export interface PosCardExceptionRow {
  reconciliationId: string;
  businessDate: string;
  registerId: string;
  registerName: string;
  posTotalCents: number;
  settlementTotalCents: number | null;
  varianceCents: number | null;
  status: 'pending' | 'matched' | 'exception' | 'resolved';
  notes: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface PosInventoryReport {
  byReason: Array<{ reason: string; netDelta: number; movementCount: number }>;
  movements: Array<{
    movementId: string; occurredAt: string; reason: string; delta: number;
    referenceType: string | null; referenceId: string | null; productName: string; sku: string | null;
  }>;
  driftAlerts: Array<{ sku: string; currentStock: number; baselineStock: number; ledgerDeltaTotal: number; drift: number }>;
}

export interface PosRefundVoidReport {
  voids: Array<{
    voidId: string; createdAt: string; amountCents: number; reason: string;
    registerId: string; registerName: string; cashierId: string; cashierName: string;
    managerId: string; managerName: string; transactionId: string;
  }>;
  refunds: Array<{
    refundId: string; createdAt: string; amountCents: number; method: string; reason: string;
    registerId: string; registerName: string; cashierId: string; cashierName: string;
    managerId: string; managerName: string; originalTransactionId: string;
  }>;
}

export interface PosZReportRow {
  zReportId: string;
  registerId: string;
  registerName: string;
  openingFloatCents: number;
  grossSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  refundTotalCents: number;
  voidTotalCents: number;
  netSalesCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCashCents: number;
  physicalCashCents: number;
  varianceCents: number;
  transactionCount: number;
  refundCount: number;
  voidCount: number;
  createdAt: string;
}

function toQuery(filter: PosReportFilter): string {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.registerId) params.set('registerId', filter.registerId);
  if (filter.cashierId) params.set('cashierId', filter.cashierId);
  if (filter.reason) params.set('reason', filter.reason);
  const query = params.toString();
  return query ? `?${query}` : '';
}

@Injectable({ providedIn: 'root' })
export class PosReportsService {
  private readonly api = inject(ApiClient);

  dailySales(filter: PosReportFilter): Promise<PosDailySalesReport> {
    return firstValueFrom(this.api.get<PosDailySalesReport>(`/admin/pos-reports/daily-sales${toQuery(filter)}`));
  }

  cashMovements(filter: PosReportFilter): Promise<PosCashMovementsReport> {
    return firstValueFrom(this.api.get<PosCashMovementsReport>(`/admin/pos-reports/cash-movements${toQuery(filter)}`));
  }

  cardSettlementExceptions(filter: PosReportFilter): Promise<PosCardExceptionRow[]> {
    return firstValueFrom(this.api.get<PosCardExceptionRow[]>(`/admin/pos-reports/card-settlement-exceptions${toQuery(filter)}`));
  }

  inventoryMovements(filter: PosReportFilter): Promise<PosInventoryReport> {
    return firstValueFrom(this.api.get<PosInventoryReport>(`/admin/pos-reports/inventory-movements${toQuery(filter)}`));
  }

  refundVoidExceptions(filter: PosReportFilter): Promise<PosRefundVoidReport> {
    return firstValueFrom(this.api.get<PosRefundVoidReport>(`/admin/pos-reports/refund-void-exceptions${toQuery(filter)}`));
  }

  zReportHistory(filter: PosReportFilter): Promise<PosZReportRow[]> {
    return firstValueFrom(this.api.get<PosZReportRow[]>(`/admin/pos-reports/z-reports${toQuery(filter)}`));
  }
}
