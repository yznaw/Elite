import { Injectable, effect, inject, signal } from '@angular/core';
import { StorageService } from './storage.service';

const THRESHOLD_KEY = 'low-stock-threshold';

/**
 * Holds store-level configuration that is shared across multiple pages
 * (settings, catalog, dashboard). Values are persisted to localStorage
 * using the tenant-scoped StorageService.
 */
@Injectable({ providedIn: 'root' })
export class StoreConfigService {
  private readonly storage = inject(StorageService);

  private readonly _lowStockThreshold = signal<number>(8);

  /** Number of units at or below which a product is flagged as low-stock. */
  readonly lowStockThreshold = this._lowStockThreshold.asReadonly();

  constructor() {
    const saved = parseInt(this.storage.get(THRESHOLD_KEY) ?? '', 10);
    if (saved > 0) this._lowStockThreshold.set(saved);

    effect(() => {
      this.storage.set(THRESHOLD_KEY, String(this._lowStockThreshold()));
    });
  }

  setLowStockThreshold(value: number): void {
    const clamped = Math.max(1, Math.round(value));
    this._lowStockThreshold.set(clamped);
  }
}
