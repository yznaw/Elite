import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { PosReceiptBlock, PosRegisterIdentity } from './pos-local-store.service';

export interface PosCatalogItem {
  productId: string;
  variantId: string;
  name: string;
  /** Arabic product name, cached with the catalogue so an offline sale can
   *  still print the bilingual item line. Empty when untranslated. */
  nameAr: string;
  variant: string;
  size: string;
  color: string;
  material: string;
  sku: string;
  barcode: string;
  priceCents: number;
  stock: number;
  imageUrl: string;
  isActive: boolean;
}

export interface PosProductSearchResult {
  products: PosCatalogItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PosProductFilters {
  sizes: string[];
  colors: string[];
}

export interface PosCurrentRegister {
  registerId: string;
  displayName: string;
  status: string;
  shift: {
    id: string;
    state: 'open' | 'closing';
    cashierId: string;
    cashierName: string | null;
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
  cashInCents: number;
  cashOutCents: number;
  expectedCashCents: number;
  transactionCount: number;
  refundCount: number;
  voidCount: number;
  /**
   * True when this operator opened the shift and the shop allows self-close,
   * so the close sheet can drop the manager PIN field. The server re-checks
   * this when the Z report is actually written.
   */
  selfCloseAllowed?: boolean;
}

export type PosCashMovementKind = 'paid_in' | 'paid_out' | 'safe_drop' | 'float_adjust' | 'no_sale_drawer_open';

export interface PosCashMovement {
  movementId: string;
  shiftId: string;
  registerId: string;
  cashierId: string;
  managerId: string | null;
  kind: PosCashMovementKind;
  amountCents: number;
  reason: string;
  createdAt: string;
}

/**
 * A customer as the till sees them. The same row the website uses — matching
 * is on normalized phone or email, so a person who bought online is found here
 * and their history is one history (see server/lib/customer-identity.js).
 */
export interface PosCustomer {
  customerId: string;
  name: string;
  email: string;
  phone: string;
  ordersCount: number;
  ltvCents: number;
  lastOrderAt?: string | null;
  /** Set on create: true when an existing customer was matched, not created. */
  linkedExisting?: boolean;
  matchedOn?: 'email' | 'phone' | null;
}

export interface PosZReport {
  zReportId: string;
  shiftId: string;
  registerId: string;
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

export interface PosBusinessProfile {
  tradeNameAr: string;
  tradeNameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  crLicenseNumber: string | null;
  returnPolicyAr: string | null;
  returnPolicyEn: string | null;
  footerStampAr: string | null;
  footerStampEn: string | null;
  updatedAt: string;
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

  businessProfile(): Promise<PosBusinessProfile | null> {
    return firstValueFrom(this.api.get<PosBusinessProfile | null>('/pos/business-profile'));
  }

  updateBusinessProfile(profile: Omit<PosBusinessProfile, 'updatedAt'>): Promise<PosBusinessProfile> {
    return firstValueFrom(this.api.put<PosBusinessProfile>('/pos/business-profile', profile));
  }

  openShift(openingFloatCents: number): Promise<PosShift> {
    return firstValueFrom(this.api.post<PosShift>('/pos/shifts/open', { openingFloatCents }));
  }

  searchProducts(
    query = '',
    opts: { page?: number; size?: string | null; color?: string | null; includeOutOfStock?: boolean } = {},
  ): Promise<PosProductSearchResult> {
    // Default browse (no search text) hides sold-out variants so the
    // cashier isn't scrolling past dozens of unsellable sizes/colors; a real
    // search or barcode scan should still surface a sold-out item so it
    // doesn't look like it silently vanished from the catalog. limit is a
    // product count, not a variant-row count — the server expands each
    // matched product to all of its (filtered) variants.
    const includeOutOfStock = opts.includeOutOfStock ?? !!query.trim();
    const params = new URLSearchParams({
      q: query,
      limit: '40',
      page: String(opts.page ?? 0),
      includeOutOfStock: String(includeOutOfStock),
    });
    if (opts.size) params.set('size', opts.size);
    if (opts.color) params.set('color', opts.color);
    return firstValueFrom(
      this.api.get<PosProductSearchResult>(`/pos/products/search?${params.toString()}`),
    );
  }

  listProductFilters(): Promise<PosProductFilters> {
    return firstValueFrom(this.api.get<PosProductFilters>('/pos/products/filters'));
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

  /** Polled independently of the browser's online/offline events — those
   *  only reflect the network interface, not whether the API is actually
   *  reachable (a flaky LAN/router/DNS issue can leave navigator.onLine true
   *  while the API is unreachable). */
  healthCheck(): Promise<{ ok: boolean; serverTime: string }> {
    return firstValueFrom(this.api.get<{ ok: boolean; serverTime: string }>('/pos/health-check'));
  }

  verifyManagerPin(pin: string, action: PosManagerOverride['action']): Promise<PosManagerOverride> {
    return firstValueFrom(this.api.post<PosManagerOverride>('/pos/manager/verify-pin', { pin, action }));
  }

  setManagerPin(pin: string, managerId?: string): Promise<{ managerId: string; configured: boolean }> {
    return firstValueFrom(this.api.put('/pos/manager-pin', managerId ? { pin, managerId } : { pin }));
  }

  findTransaction(lookup: string): Promise<PosSaleResult> {
    return firstValueFrom(this.api.get<PosSaleResult>(`/pos/transactions/lookup/${encodeURIComponent(lookup)}`));
  }

  voidTransaction(transactionId: string, input: {
    idempotencyKey: string;
    voidReason: string;
    managerOverrideId: string;
    managerOverrideToken: string;
  }): Promise<{
    voidId: string;
    transactionId: string;
    amountCents: number;
    reason: string;
    voidedAt: string;
    stockRestored: Array<{ variantId: string; stock: number }>;
  }> {
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
    // Omitted on a self-close: the operator who opened the shift closes it
    // without a second manager's PIN when the shop allows that.
    managerOverrideId?: string;
    managerOverrideToken?: string;
  }): Promise<PosShiftSummary & { zReportId: string; varianceCents: number }> {
    return firstValueFrom(this.api.post('/pos/shifts/z-report', input));
  }

  recordCashMovement(input: {
    shiftId: string;
    kind: PosCashMovementKind;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    managerOverrideId?: string;
    managerOverrideToken?: string;
  }): Promise<PosCashMovement> {
    return firstValueFrom(this.api.post<PosCashMovement>('/pos/cash-movements', input));
  }

  listCashMovements(shiftId: string): Promise<PosCashMovement[]> {
    return firstValueFrom(this.api.get<PosCashMovement[]>(`/pos/cash-movements?shiftId=${encodeURIComponent(shiftId)}`));
  }

  listZReports(limit = 30): Promise<PosZReport[]> {
    return firstValueFrom(this.api.get<PosZReport[]>(`/pos/shifts/z-reports?limit=${limit}`));
  }

  getZReport(zReportId: string): Promise<PosZReport> {
    return firstValueFrom(this.api.get<PosZReport>(`/pos/shifts/z-reports/${zReportId}`));
  }

  /** Phone-first lookup, but a name or an email also matches. */
  searchCustomers(query: string): Promise<PosCustomer[]> {
    return firstValueFrom(this.api.get<PosCustomer[]>(`/pos/customers/search?q=${encodeURIComponent(query)}`));
  }

  /**
   * Online only — see the route's own note. Entering a phone that already
   * belongs to a website customer links to that person instead of creating a
   * second record of them, and the response says which happened.
   */
  createCustomer(input: { fullName: string; phone?: string; email?: string }): Promise<PosCustomer> {
    return firstValueFrom(this.api.post<PosCustomer>('/pos/customers', input));
  }
}
