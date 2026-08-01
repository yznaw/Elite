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
}

export interface StocktakeLine {
  variantId: string;
  sku: string;
  productName: string;
  variant: string;
  /** Withheld while a blind count is still open — that is the point of blind. */
  expectedQuantity: number | null;
  countedQuantity: number | null;
  recountQuantity: number | null;
  currentStock: number | null;
  discrepancy: number | null;
  countedAt: string | null;
  note: string | null;
}

export interface StocktakeDetail extends StocktakeSummary {
  postedByName?: string | null;
  lines: StocktakeLine[];
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly api = inject(ApiClient);

  adjust(input: {
    variantId: string;
    delta: number;
    reason: AdjustmentReason;
    note?: string;
  }): Promise<StockAdjustmentResult> {
    return firstValueFrom(this.api.post<StockAdjustmentResult>('/admin/inventory/adjustments', input));
  }

  listStocktakes(limit = 25): Promise<StocktakeSummary[]> {
    return firstValueFrom(this.api.get<StocktakeSummary[]>(`/admin/inventory/stocktakes?limit=${limit}`));
  }

  getStocktake(stocktakeId: string): Promise<StocktakeDetail> {
    return firstValueFrom(this.api.get<StocktakeDetail>(`/admin/inventory/stocktakes/${stocktakeId}`));
  }

  startStocktake(input: { reference: string; blind: boolean; note?: string; variantIds?: string[] }): Promise<StocktakeSummary> {
    return firstValueFrom(this.api.post<StocktakeSummary>('/admin/inventory/stocktakes', input));
  }

  saveCount(stocktakeId: string, variantId: string, quantity: number): Promise<{ recount: boolean }> {
    return firstValueFrom(
      this.api.post<{ recount: boolean }>(`/admin/inventory/stocktakes/${stocktakeId}/counts`, { variantId, quantity }),
    );
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
