import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { PosReceiptBlock, PosRegisterIdentity } from './pos-local-store.service';

export interface PosCatalogItem {
  productId: string;
  variantId: string;
  name: string;
  variant: string;
  sku: string;
  barcode: string;
  priceCents: number;
  stock: number;
  imageUrl: string;
  isActive: boolean;
}

export interface PosCurrentRegister {
  registerId: string;
  displayName: string;
  status: string;
  shift: {
    id: string;
    state: 'open' | 'closing';
    openingFloatCents: number;
    openedAt: string;
  } | null;
}

export interface PosShift {
  shiftId: string;
  registerId: string;
  cashierId: string;
  openingFloatCents: number;
  state: 'open' | 'closing' | 'closed';
  openedAt: string;
}

export interface PosSaleResult {
  transactionId: string;
  orderId: string;
  orderNumber: string;
  receiptNumber: string;
  status: string;
  paymentMethod: 'cash' | 'card';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountTenderedCents: number;
  changeGivenCents: number;
  stockUpdates: Array<{ variantId: string; stock: number }>;
  receipt: { qrCodeValue: string; receiptData: unknown };
  items?: PosTransactionItem[];
  refunds?: PosRefundSummary[];
  voidReason?: string | null;
  syncConflicts?: Array<{ conflictId: string; type: string; variantId: string }>;
}

export interface PosTransactionItem {
  id: string;
  variantId: string | null;
  name: string;
  variant: string;
  sku: string;
  quantity: number;
  refundableQty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PosRefundSummary {
  refundId: string;
  amountCents: number;
  method: 'cash' | 'card';
  reason: string;
  status: string;
  receiptNumber: string;
  createdAt: string;
}

export interface PosManagerOverride {
  overrideId: string;
  token: string;
  managerId: string;
  action: 'refund' | 'void' | 'z-report' | 'drawer-open' | 'sync-conflict-override';
  expiresAt: string;
}

export interface PosParkedCart {
  parkedCartId: string;
  label: string;
  payload: { items: Array<{ item: PosCatalogItem; quantity: number }> };
  createdAt: string;
  updatedAt: string;
  local?: boolean;
}

export interface PosSyncConflict {
  conflictId: string;
  transactionId: string;
  receiptNumber: string;
  productName: string;
  sku: string;
  type: 'insufficient_stock' | 'price_changed';
  expectedValue: number | null;
  actualValue: number | null;
  shortageQuantity: number | null;
  createdAt: string;
}

export interface PosShiftSummary {
  shiftId: string;
  openingFloatCents: number;
  grossSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  refundTotalCents: number;
  voidTotalCents: number;
  netSalesCents: number;
  expectedCashCents: number;
  transactionCount: number;
  refundCount: number;
  voidCount: number;
}

export interface PosSaleInput {
  idempotencyKey: string;
  receiptNumber: number;
  shiftId: string;
  customerId: string | null;
  items: Array<{ variantId: string; quantity: number; unitPriceCents: number }>;
  payment: {
    method: 'cash' | 'card';
    cashAmountCents: number;
    cardAmountCents: number;
    amountTenderedCents: number;
    changeGivenCents: number;
  };
  clientCreatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly api = inject(ApiClient);

  get eventUrl(): string {
    return this.api.url('/pos/events');
  }

  get certificateUrl(): string {
    return this.api.url('/pos/print/certificate');
  }

  get signingUrl(): string {
    return this.api.url('/pos/print/sign');
  }

  mediaUrl(path: string): string {
    return this.api.mediaUrl(path);
  }

  createEnrollmentToken(displayName: string): Promise<{ token: string }> {
    return firstValueFrom(this.api.post<{ token: string }>('/pos/registers/enrollment-tokens', { displayName }));
  }

  enroll(enrollmentToken: string): Promise<PosRegisterIdentity> {
    return firstValueFrom(this.api.post<PosRegisterIdentity>('/pos/registers/enroll', { enrollmentToken }));
  }

  checkIn(identity: PosRegisterIdentity): Promise<void> {
    return firstValueFrom(this.api.post('/pos/registers/check-in', identity)).then(() => undefined);
  }

  currentRegister(): Promise<PosCurrentRegister> {
    return firstValueFrom(this.api.get<PosCurrentRegister>('/pos/registers/current'));
  }

  allocateReceiptBlock(): Promise<PosReceiptBlock> {
    return firstValueFrom(this.api.post<PosReceiptBlock>('/pos/registers/receipt-number-blocks', {}));
  }

  openShift(openingFloatCents: number): Promise<PosShift> {
    return firstValueFrom(this.api.post<PosShift>('/pos/shifts/open', { openingFloatCents }));
  }

  searchProducts(query = ''): Promise<PosCatalogItem[]> {
    const params = new URLSearchParams({ q: query, limit: '80' });
    return firstValueFrom(
      this.api.get<{ products: PosCatalogItem[] }>(`/pos/products/search?${params.toString()}`),
    ).then((result) => result.products);
  }

  findBarcode(barcode: string): Promise<PosCatalogItem> {
    return firstValueFrom(this.api.get<PosCatalogItem>(`/pos/products/barcode/${encodeURIComponent(barcode)}`));
  }

  createSale(input: PosSaleInput): Promise<PosSaleResult> {
    return firstValueFrom(this.api.post<PosSaleResult>('/pos/transactions', input));
  }

  syncSales(transactions: Array<{
    idempotencyKey: string;
    receiptNumber: number;
    clientCreatedAt: string;
    payload: PosSaleInput;
  }>): Promise<{
    accepted: Array<{ idempotencyKey: string; transactionId: string }>;
    acceptedWithConflicts: Array<{ idempotencyKey: string; transactionId: string; conflicts: PosSyncConflict[] }>;
    rejected: Array<{ idempotencyKey: string; reason: string; code: string; message: string }>;
  }> {
    return firstValueFrom(this.api.post('/pos/transactions/sync', { transactions }));
  }

  reportSyncState(shiftId: string, pendingCount: number, rejectedCount: number): Promise<void> {
    return firstValueFrom(this.api.put('/pos/sync-state', { shiftId, pendingCount, rejectedCount })).then(() => undefined);
  }

  verifyManagerPin(pin: string, action: PosManagerOverride['action']): Promise<PosManagerOverride> {
    return firstValueFrom(this.api.post<PosManagerOverride>('/pos/manager/verify-pin', { pin, action }));
  }

  findTransaction(lookup: string): Promise<PosSaleResult> {
    return firstValueFrom(this.api.get<PosSaleResult>(`/pos/transactions/lookup/${encodeURIComponent(lookup)}`));
  }

  voidTransaction(transactionId: string, input: {
    idempotencyKey: string;
    voidReason: string;
    managerOverrideId: string;
    managerOverrideToken: string;
  }): Promise<{ voidId: string; transactionId: string; stockRestored: Array<{ variantId: string; stock: number }> }> {
    return firstValueFrom(this.api.post(`/pos/transactions/${transactionId}/void`, input));
  }

  refund(input: {
    idempotencyKey: string;
    receiptNumber: number;
    shiftId: string;
    originalTransactionId: string;
    lines: Array<{ transactionItemId: string; quantity: number; restock: boolean }>;
    refundMethod: 'cash' | 'card';
    reason: string;
    managerOverrideId: string;
    managerOverrideToken: string;
  }): Promise<PosSaleResult & { refundId: string; refundReceiptNumber: string; amountCents: number; method: 'cash' | 'card' }> {
    return firstValueFrom(this.api.post('/pos/refunds', input));
  }

  listParkedCarts(): Promise<PosParkedCart[]> {
    return firstValueFrom(this.api.get<PosParkedCart[]>('/pos/parked-carts'));
  }

  parkCart(label: string, payload: PosParkedCart['payload']): Promise<PosParkedCart> {
    return firstValueFrom(this.api.post<PosParkedCart>('/pos/parked-carts', { label, payload }));
  }

  deleteParkedCart(id: string): Promise<void> {
    return firstValueFrom(this.api.delete(`/pos/parked-carts/${id}`)).then(() => undefined);
  }

  listConflicts(): Promise<PosSyncConflict[]> {
    return firstValueFrom(this.api.get<PosSyncConflict[]>('/pos/sync-conflicts'));
  }

  resolveConflict(conflictId: string, resolution: string, override: PosManagerOverride): Promise<void> {
    return firstValueFrom(this.api.post(`/pos/sync-conflicts/${conflictId}/resolve`, {
      resolution,
      managerOverrideId: override.overrideId,
      managerOverrideToken: override.token,
    })).then(() => undefined);
  }

  shiftSummary(): Promise<PosShiftSummary> {
    return firstValueFrom(this.api.get<PosShiftSummary>('/pos/shifts/current'));
  }

  closeShift(input: {
    shiftId: string;
    physicalCashCents: number;
    idempotencyKey: string;
    managerOverrideId: string;
    managerOverrideToken: string;
  }): Promise<PosShiftSummary & { zReportId: string; varianceCents: number }> {
    return firstValueFrom(this.api.post('/pos/shifts/z-report', input));
  }
}
