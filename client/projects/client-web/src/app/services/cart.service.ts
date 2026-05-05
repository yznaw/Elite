import { Injectable, computed, effect, signal } from '@angular/core';
import { CartItem } from '../models/product.model';

const STORAGE_KEY = 'elite_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly _items = signal<CartItem[]>(this.load());
  private readonly _open = signal<boolean>(false);

  readonly items = this._items.asReadonly();
  readonly isOpen = this._open.asReadonly();
  readonly count = computed(() => this._items().reduce((s, i) => s + i.qty, 0));
  readonly subtotal = computed(() => this._items().reduce((s, i) => s + i.price * i.qty, 0));

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items()));
      } catch {}
    });
  }

  add(item: CartItem): void {
    this._items.update((prev) => {
      const existing = prev.find((i) => i.id === item.id && i.size === item.size);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id && i.size === item.size ? { ...i, qty: i.qty + item.qty } : i,
        );
      }
      return [...prev, item];
    });
    this.openDrawer();
  }

  remove(id: number, size: number): void {
    this._items.update((prev) => prev.filter((i) => !(i.id === id && i.size === size)));
  }

  clear(): void {
    this._items.set([]);
  }

  openDrawer(): void {
    this._open.set(true);
  }

  closeDrawer(): void {
    this._open.set(false);
  }

  private load(): CartItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  }
}
