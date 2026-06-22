import { Injectable } from '@angular/core';

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

type PosSetting = PosRegisterIdentity | PosReceiptBlock;

@Injectable({ providedIn: 'root' })
export class PosLocalStore {
  private readonly databaseName = 'elite-pos';
  private readonly storeName = 'settings';

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

  async commitReceipt(receiptNumber: number): Promise<void> {
    const block = await this.getReceiptBlock();
    if (!block || block.next !== receiptNumber) return;
    await this.setReceiptBlock({ ...block, next: receiptNumber + 1 });
  }

  private async get<T extends PosSetting>(key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  private async put(key: string, value: PosSetting): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }).finally(() => db.close());
  }

  private open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
