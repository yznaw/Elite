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
}
