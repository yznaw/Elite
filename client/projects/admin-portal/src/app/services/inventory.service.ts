import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

/** The closed reason list — the UI never invents its own, so the shrinkage
 *  report can group on it. */
export type AdjustmentReason =
  | 'damaged'
  | 'lost'
  | 'found'
  | 'returned_to_supplier'
  | 'sample'
  | 'correction';

export interface StockAdjustmentResult {
  variantId: string;
  sku: string;
  productName: string;
  before: number;
  after: number;
  delta: number;
  reason: AdjustmentReason;
}

export type StocktakeStatus = 'counting' | 'review' | 'posted' | 'cancelled';

export interface StocktakeSummary {
  stocktakeId: string;
  reference: string;
  status: StocktakeStatus;
  blind: boolean;
  note: string | null;
  startedAt: string;
  postedAt: string | null;
  startedByName?: string | null;
  lineCount?: number;
  countedCount?: number;
  locationCount?: number;
  completedLocationCount?: number;
}

export interface StocktakeLocation {
  locationId: string;
  branchId: string | null;
  name: string;
  type: 'store' | 'warehouse';
  active?: boolean;
  sortOrder?: number;
  status?: 'counting' | 'completed';
  countedCount?: number;
  completedAt?: string | null;
  completedByName?: string | null;
}

export interface StocktakeLine {
  variantId: string;
  sku: string;
  barcode: string;
  productName: string;
  color: string;
  size: string;
  variant: string;
  /** Withheld while a blind count is still open — that is the point of blind. */
  expectedQuantity: number | null;
  countedQuantity: number | null;
  recountQuantity: number | null;
  currentStock: number | null;
  discrepancy: number | null;
  countedAt: string | null;
  note: string | null;
  locationCounts: Record<string, number>;
  /** Per-location expected (stock per location on); null otherwise or while blind. */
  expectedByLocation?: Record<string, number> | null;
}

export interface StocktakeDetail extends StocktakeSummary {
  postedByName?: string | null;
  locations: StocktakeLocation[];
  lines: StocktakeLine[];
}

// ── Stock per location (server/lib/location-stock*.js) ──────────────────────

export interface StockLocation {
  id: string;
  branchId: string | null;
  name: string;
  type: 'store' | 'warehouse';
}

export interface PerLocationStatus {
  enabled: boolean;
  locations: StockLocation[];
  drift: { variantId: string; sku: string; stock: number; locationTotal: number; held: number }[];
}

export interface StockRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  color: string | null;
  size: string | null;
  /** Sellable total: every location minus units held for paid website orders. */
  total: number;
  held: number;
  /** Only locations holding stock appear; a missing id means 0. */
  byLocation: Record<string, number>;
}

export interface StockPage {
  enabled: boolean;
  locations: StockLocation[];
  total: number;
  items: StockRow[];
}

export type ReceiveReason = 'received' | 'found' | 'returned' | 'correction';

export interface StockLineInput { variantId: string; quantity: number }

export interface TransferSummary {
  transferId: string;
  createdAt: string;
  note: string | null;
  lineCount: number;
  unitCount: number;
  from: string;
  to: string;
  createdByName: string | null;
  lines: { sku: string; productName: string; color: string | null; size: string | null; quantity: number }[];
}

export type MovementType = 'sale' | 'return' | 'added' | 'removed' | 'transfer' | 'stocktake' | 'catalog';

export interface StockMovement {
  id: string;
  occurredAt: string;
  delta: number;
  reason: string;
  adjustmentReason: string | null;
  note: string | null;
  orderNumber: string | null;
  transferFrom: string | null;
  transferTo: string | null;
  productName: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  locationName: string | null;
  userName: string | null;
}

export interface MovementPage {
  total: number;
  users: { id: string; name: string }[];
  items: StockMovement[];
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly api = inject(ApiClient);

  listMovements(query: { search?: string; locationId?: string; userId?: string; type?: MovementType | ''; from?: string; to?: string; limit?: number; offset?: number }): Promise<MovementPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    return firstValueFrom(this.api.get<MovementPage>(`/admin/inventory/movements?${params.toString()}`));
  }

  perLocationStatus(): Promise<PerLocationStatus> {
    return firstValueFrom(this.api.get<PerLocationStatus>('/admin/inventory/per-location'));
  }

  activatePerLocation(): Promise<{ alreadyOn: boolean; seeded: number }> {
    return firstValueFrom(this.api.post<{ alreadyOn: boolean; seeded: number }>('/admin/inventory/per-location/activate', {}));
  }

  listStock(query: { search?: string; locationId?: string; state?: 'low' | 'out' | ''; lowThreshold?: number; limit?: number; offset?: number }): Promise<StockPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    return firstValueFrom(this.api.get<StockPage>(`/admin/inventory/stock?${params.toString()}`));
  }

  receive(input: { locationId: string; reason: ReceiveReason; note?: string; lines: StockLineInput[] }): Promise<{ receiptId: string }> {
    return firstValueFrom(this.api.post<{ receiptId: string }>('/admin/inventory/receipts', input));
  }

  transfer(input: { fromLocationId: string; toLocationId: string; note?: string; lines: StockLineInput[] }): Promise<{ transferId: string }> {
    return firstValueFrom(this.api.post<{ transferId: string }>('/admin/inventory/transfers', input));
  }

  listTransfers(limit = 30): Promise<TransferSummary[]> {
    return firstValueFrom(this.api.get<TransferSummary[]>(`/admin/inventory/transfers?limit=${limit}`));
  }

  adjust(input: {
    variantId: string;
    delta: number;
    reason: AdjustmentReason;
    note?: string;
    /** Per-location stock: which location changes (warehouse when omitted). */
    locationId?: string;
  }): Promise<StockAdjustmentResult> {
    return firstValueFrom(this.api.post<StockAdjustmentResult>('/admin/inventory/adjustments', input));
  }

  listStocktakes(limit = 25): Promise<StocktakeSummary[]> {
    return firstValueFrom(this.api.get<StocktakeSummary[]>(`/admin/inventory/stocktakes?limit=${limit}`));
  }

  getStocktake(stocktakeId: string): Promise<StocktakeDetail> {
    return firstValueFrom(this.api.get<StocktakeDetail>(`/admin/inventory/stocktakes/${stocktakeId}`));
  }

  listStocktakeLocations(): Promise<StocktakeLocation[]> {
    return firstValueFrom(this.api.get<StocktakeLocation[]>('/admin/inventory/stocktake-locations'));
  }

  startStocktake(input: { reference: string; blind: boolean; note?: string; variantIds?: string[]; locationIds?: string[] }): Promise<StocktakeSummary> {
    return firstValueFrom(this.api.post<StocktakeSummary>('/admin/inventory/stocktakes', input));
  }

  saveCount(stocktakeId: string, variantId: string, quantity: number, locationId?: string): Promise<{ recount: boolean }> {
    return firstValueFrom(
      this.api.post<{ recount: boolean }>(`/admin/inventory/stocktakes/${stocktakeId}/counts`, { variantId, quantity, locationId }),
    );
  }

  completeLocation(stocktakeId: string, locationId: string): Promise<{ allLocationsCompleted: boolean }> {
    return firstValueFrom(this.api.post<{ allLocationsCompleted: boolean }>(
      `/admin/inventory/stocktakes/${stocktakeId}/locations/${locationId}/complete`, {},
    ));
  }

  fillMissingCountsWithZero(stocktakeId: string, locationId: string): Promise<{ updatedCount: number }> {
    return firstValueFrom(this.api.post<{ updatedCount: number }>(
      `/admin/inventory/stocktakes/${stocktakeId}/locations/${locationId}/fill-missing-zero`, {},
    ));
  }

  reopenLocation(stocktakeId: string, locationId: string): Promise<void> {
    return firstValueFrom(this.api.post<void>(
      `/admin/inventory/stocktakes/${stocktakeId}/locations/${locationId}/reopen`, {},
    ));
  }

  post(stocktakeId: string, acceptRecountDisagreement = false): Promise<{ countedLines: number; adjustedLines: number }> {
    return firstValueFrom(
      this.api.post<{ countedLines: number; adjustedLines: number }>(
        `/admin/inventory/stocktakes/${stocktakeId}/post`,
        { acceptRecountDisagreement },
      ),
    );
  }

  cancel(stocktakeId: string): Promise<{ status: string }> {
    return firstValueFrom(this.api.post<{ status: string }>(`/admin/inventory/stocktakes/${stocktakeId}/cancel`, {}));
  }
}
