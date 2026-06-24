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
  status: 'pending' | 'rejected';
  attempts: number;
  lastError: string;
  queuedAt: string;
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

@Injectable({ providedIn: 'root' })
export class PosLocalStore {
  private readonly databaseName = 'elite-pos';
  private readonly settingsStore = 'settings';
  private readonly queueStore = 'pending-sales';
  private readonly parkedStore = 'parked-carts';

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

  private open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 3);
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
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
