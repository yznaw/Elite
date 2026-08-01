import { Injectable } from '@angular/core';
import type { PosCatalogItem, PosSaleInput } from './pos.service';

export interface PosRegisterIdentity {
  registerId: string;
  displayName: string;
  registerCredential: string;
}

export interface PosReceiptBlock {
  blockId: string;
  start: number;
  end: number;
  next: number;
  allocatedAt: string;
}

export interface PosStoredShift {
  shiftId: string;
  registerId: string;
  cashierId?: string;
  openingFloatCents: number;
  openedAt: string;
}

export interface PosQueuedSale {
  idempotencyKey: string;
  receiptNumber: number;
  clientCreatedAt: string;
  shiftId: string;
  payload: PosSaleInput;
  receiptData: unknown;
  status: 'pending' | 'rejected' | 'synced';
  attempts: number;
  lastError: string;
  queuedAt: string;
  /** Kept in the store for AUDIT_WINDOW_MS after a successful sync instead of
   *  being deleted immediately, so a support escalation can still see what
   *  was queued/synced recently. The cleanup sweep purges rows once both
   *  synced and past the window. */
  synced?: boolean;
  syncedAt?: string | null;
}

export type PosQueueJournalEvent = 'created' | 'printed' | 'sync_attempted' | 'accepted' | 'rejected' | 'resolved';

export interface PosQueueJournalEntry {
  id?: number;
  idempotencyKey: string;
  event: PosQueueJournalEvent;
  at: string;
  detail?: Record<string, unknown>;
}

export interface PosPersistentStorageStatus {
  persisted: boolean;
  checkedAt: string;
}

export interface PosStorageEstimate {
  usage: number;
  quota: number;
  checkedAt: string;
}

export interface PosCachedCatalog {
  products: PosCatalogItem[];
  cachedAt: string;
}

export interface PosHardwareSettings {
  printerName: string;
  deviceSignerUrl: string;
  drawerPulse: 'epson-pin-2' | 'epson-pin-5' | 'disabled';
}

export interface PosLocalParkedCart {
  parkedCartId: string;
  label: string;
  payload: { items: Array<{ item: PosCatalogItem; quantity: number }> };
  createdAt: string;
  updatedAt: string;
  local: true;
}

// Local audit-window retention for synced sales — matches docs/15 Phase 2's
// "keep for a configurable local audit window (e.g. 7 days)" rather than
// deleting the moment a sync succeeds, so a support escalation can still see
// what happened recently even after the sale has long since synced.
const AUDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class PosLocalStore {
  private readonly databaseName = 'elite-pos';
  private readonly settingsStore = 'settings';
  private readonly queueStore = 'pending-sales';
  private readonly parkedStore = 'parked-carts';
  private readonly journalStore = 'pos-queue-journal';

  getRegister(): Promise<PosRegisterIdentity | null> {
    return this.get<PosRegisterIdentity>('register');
  }

  setRegister(register: PosRegisterIdentity): Promise<void> {
    return this.put('register', register);
  }

  getReceiptBlock(): Promise<PosReceiptBlock | null> {
    return this.get<PosReceiptBlock>('receipt-block');
  }

  setReceiptBlock(block: PosReceiptBlock): Promise<void> {
    return this.put('receipt-block', block);
  }

  getShift(): Promise<PosStoredShift | null> {
    return this.get<PosStoredShift>('shift');
  }

  setShift(shift: PosStoredShift): Promise<void> {
    return this.put('shift', shift);
  }

  clearShift(): Promise<void> {
    return this.remove('shift');
  }

  getCatalog(): Promise<PosCachedCatalog | null> {
    return this.get<PosCachedCatalog>('catalog');
  }

  setCatalog(catalog: PosCachedCatalog): Promise<void> {
    return this.put('catalog', catalog);
  }

  getHardwareSettings(): Promise<PosHardwareSettings | null> {
    return this.get<PosHardwareSettings>('hardware');
  }

  setHardwareSettings(settings: PosHardwareSettings): Promise<void> {
    return this.put('hardware', settings);
  }

  async commitReceipt(receiptNumber: number): Promise<void> {
    const block = await this.getReceiptBlock();
    if (!block || block.next !== receiptNumber) return;
    await this.setReceiptBlock({ ...block, next: receiptNumber + 1 });
  }

  async queueOfflineSale(sale: PosQueuedSale): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([this.settingsStore, this.queueStore], 'readwrite');
      const settings = transaction.objectStore(this.settingsStore);
      const queue = transaction.objectStore(this.queueStore);
      const blockRequest = settings.get('receipt-block');
      blockRequest.onsuccess = () => {
        const block = blockRequest.result as PosReceiptBlock | undefined;
        if (!block || block.next !== sale.receiptNumber || block.next > block.end) {
          transaction.abort();
          reject(new Error('The reserved receipt number is no longer available.'));
          return;
        }
        queue.put(sale);
        settings.put({ ...block, next: block.next + 1 }, 'receipt-block');
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Offline sale could not be queued.'));
    }).finally(() => db.close());
  }

  async listQueuedSales(shiftId?: string): Promise<PosQueuedSale[]> {
    const db = await this.open();
    return new Promise<PosQueuedSale[]>((resolve, reject) => {
      const request = db.transaction(this.queueStore, 'readonly').objectStore(this.queueStore).getAll();
      request.onsuccess = () => {
        const values = (request.result as PosQueuedSale[])
          .filter((sale) => !shiftId || sale.shiftId === shiftId)
          .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
        resolve(values);
      };
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  async deleteQueuedSale(idempotencyKey: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.queueStore, 'readwrite');
      transaction.objectStore(this.queueStore).delete(idempotencyKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  /**
   * Replaces the old "delete on sync success" behavior — the row is kept,
   * flagged synced, so it stays visible to a support-bundle export for the
   * audit window (see AUDIT_WINDOW_MS) instead of vanishing the instant it
   * syncs. `cleanupSyncedSales()` is what actually removes it, once both
   * synced and past the window.
   */
  async markQueuedSaleSynced(idempotencyKey: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.queueStore, 'readwrite');
      const store = transaction.objectStore(this.queueStore);
      const request = store.get(idempotencyKey);
      request.onsuccess = () => {
        const sale = request.result as PosQueuedSale | undefined;
        if (sale) store.put({ ...sale, status: 'synced', synced: true, syncedAt: new Date().toISOString() });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  /** Purges only rows that are both synced AND older than AUDIT_WINDOW_MS —
   *  never touches pending or rejected rows regardless of age. */
  async cleanupSyncedSales(): Promise<void> {
    const db = await this.open();
    const cutoff = Date.now() - AUDIT_WINDOW_MS;
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.queueStore, 'readwrite');
      const store = transaction.objectStore(this.queueStore);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const sale of request.result as PosQueuedSale[]) {
          if (sale.synced && sale.syncedAt && new Date(sale.syncedAt).getTime() < cutoff) {
            store.delete(sale.idempotencyKey);
          }
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  /** Append-only lifecycle log for a queued sale — see PosQueueJournalEvent.
   *  Never updated or deleted except by the same audit-window cleanup that
   *  removes its parent sale (journalForSale/cleanupJournal below). */
  async appendJournal(entry: Omit<PosQueueJournalEntry, 'id'>): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.journalStore, 'readwrite');
      transaction.objectStore(this.journalStore).add(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  async journalForSale(idempotencyKey: string): Promise<PosQueueJournalEntry[]> {
    const db = await this.open();
    return new Promise<PosQueueJournalEntry[]>((resolve, reject) => {
      const index = db.transaction(this.journalStore, 'readonly').objectStore(this.journalStore).index('idempotencyKey');
      const request = index.getAll(IDBKeyRange.only(idempotencyKey));
      request.onsuccess = () => resolve((request.result as PosQueueJournalEntry[]).sort((a, b) => a.at.localeCompare(b.at)));
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  /** All unresolved/rejected sales + their journal entries, for the
   *  export-support-bundle action — deliberately excludes already-synced
   *  sales since those aren't what a support escalation needs. */
  async exportSupportBundle(): Promise<{ sales: PosQueuedSale[]; journal: PosQueueJournalEntry[] }> {
    const sales = (await this.listQueuedSales()).filter((sale) => !sale.synced);
    const db = await this.open();
    const journal = await new Promise<PosQueueJournalEntry[]>((resolve, reject) => {
      const request = db.transaction(this.journalStore, 'readonly').objectStore(this.journalStore).getAll();
      request.onsuccess = () => resolve(request.result as PosQueueJournalEntry[]);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
    const unresolvedKeys = new Set(sales.map((sale) => sale.idempotencyKey));
    return { sales, journal: journal.filter((entry) => unresolvedKeys.has(entry.idempotencyKey)) };
  }

  getPersistentStorageStatus(): Promise<PosPersistentStorageStatus | null> {
    return this.get<PosPersistentStorageStatus>('persistent-storage-status');
  }

  setPersistentStorageStatus(status: PosPersistentStorageStatus): Promise<void> {
    return this.put('persistent-storage-status', status);
  }

  getStorageEstimate(): Promise<PosStorageEstimate | null> {
    return this.get<PosStorageEstimate>('storage-estimate');
  }

  setStorageEstimate(estimate: PosStorageEstimate): Promise<void> {
    return this.put('storage-estimate', estimate);
  }

  async markQueuedSaleRejected(idempotencyKey: string, message: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.queueStore, 'readwrite');
      const store = transaction.objectStore(this.queueStore);
      const request = store.get(idempotencyKey);
      request.onsuccess = () => {
        const sale = request.result as PosQueuedSale | undefined;
        if (sale) store.put({ ...sale, status: 'rejected', attempts: sale.attempts + 1, lastError: message });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  async retryQueuedSale(idempotencyKey: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.queueStore, 'readwrite');
      const store = transaction.objectStore(this.queueStore);
      const request = store.get(idempotencyKey);
      request.onsuccess = () => {
        const sale = request.result as PosQueuedSale | undefined;
        if (sale) store.put({ ...sale, status: 'pending', lastError: '' });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  async parkCart(label: string, payload: PosLocalParkedCart['payload']): Promise<PosLocalParkedCart> {
    const timestamp = new Date().toISOString();
    const parked: PosLocalParkedCart = {
      parkedCartId: crypto.randomUUID(),
      label,
      payload,
      createdAt: timestamp,
      updatedAt: timestamp,
      local: true,
    };
    const db = await this.open();
    return new Promise<PosLocalParkedCart>((resolve, reject) => {
      const transaction = db.transaction(this.parkedStore, 'readwrite');
      transaction.objectStore(this.parkedStore).put(parked);
      transaction.oncomplete = () => resolve(parked);
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  async listParkedCarts(): Promise<PosLocalParkedCart[]> {
    const db = await this.open();
    return new Promise<PosLocalParkedCart[]>((resolve, reject) => {
      const request = db.transaction(this.parkedStore, 'readonly').objectStore(this.parkedStore).getAll();
      request.onsuccess = () => resolve((request.result as PosLocalParkedCart[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  async deleteParkedCart(parkedCartId: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.parkedStore, 'readwrite');
      transaction.objectStore(this.parkedStore).delete(parkedCartId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  private async get<T>(key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(this.settingsStore, 'readonly').objectStore(this.settingsStore).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  private async put(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.settingsStore, 'readwrite');
      transaction.objectStore(this.settingsStore).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  private async remove(key: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.settingsStore, 'readwrite');
      transaction.objectStore(this.settingsStore).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  private open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      // v3 -> v4: adds the queue-journal store only (additive) — existing
      // `pending-sales` rows are untouched by this upgrade. `synced`/
      // `syncedAt` are optional fields written going forward, not backfilled,
      // so v3 data left in the store is read as "not yet synced" until it's
      // next touched, which is safe (it just means an older completed sale
      // becomes eligible for the audit-window cleanup sweep once it is).
      const request = indexedDB.open(this.databaseName, 4);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.settingsStore)) {
          request.result.createObjectStore(this.settingsStore);
        }
        if (!request.result.objectStoreNames.contains(this.queueStore)) {
          request.result.createObjectStore(this.queueStore, { keyPath: 'idempotencyKey' });
        }
        if (!request.result.objectStoreNames.contains(this.parkedStore)) {
          request.result.createObjectStore(this.parkedStore, { keyPath: 'parkedCartId' });
        }
        if (!request.result.objectStoreNames.contains(this.journalStore)) {
          const journal = request.result.createObjectStore(this.journalStore, { keyPath: 'id', autoIncrement: true });
          journal.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
