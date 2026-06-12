import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CartItem } from '../models/product.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface ServerCart {
  id: string;
  subtotal: number;
  items: CartItem[];
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly _items = signal<CartItem[]>([]);
  private readonly _open = signal<boolean>(false);

  readonly items = this._items.asReadonly();
  readonly isOpen = this._open.asReadonly();
  readonly count = computed(() => this._items().reduce((s, i) => s + i.qty, 0));
  readonly subtotal = computed(() => this._items().reduce((s, i) => s + i.price * i.qty, 0));

  constructor() {
    void this.refresh();
  }

  add(item: CartItem): void {
    this._items.update((prev) => {
      const key = this.itemKey(item);
      const existing = prev.find((i) => this.itemKey(i) === key);
      if (existing) {
        return prev.map((i) =>
          this.itemKey(i) === key ? { ...i, qty: i.qty + item.qty } : i,
        );
      }
      return [...prev, item];
    });
    this.openDrawer();
    void this.addRemote(item);
  }

  remove(id: string, size: number, variantId?: string, color?: string | null): void {
    const target = this.itemKey({ id, size, variantId, color } as CartItem);
    this._items.update((prev) => prev.filter((i) => this.itemKey(i) !== target));
    void this.removeRemote(id, size, variantId, color);
  }

  clear(): void {
    this._items.set([]);
    void this.clearRemote();
  }

  openDrawer(): void {
    this._open.set(true);
  }

  closeDrawer(): void {
    this._open.set(false);
  }

  async refresh(): Promise<void> {
    try {
      const cart = await this.getCart();
      this._items.set(cart.items || []);
    } catch {}
  }

  private async addRemote(item: CartItem): Promise<void> {
    try {
      const cart = await firstValueFrom(
        this.http.post<ApiResponse<ServerCart>>(`${this.apiBase}/carts/current/items`, {
          productId: item.id,
          variantId: item.variantId || null,
          sku: item.sku || item.variantId || item.id,
          name: item.name,
          price: item.price,
          image: item.image,
          leather: item.leather,
          color: item.color || null,
          size: item.size,
          quantity: item.qty,
        }, { withCredentials: true }),
      ).then((res) => res.data);
      this._items.set(cart.items || []);
    } catch {
      await this.refresh();
    }
  }

  private async removeRemote(id: string, size: number, variantId?: string, color?: string | null): Promise<void> {
    try {
      const params = new URLSearchParams({ size: String(size) });
      if (variantId) params.set('variantId', variantId);
      if (color) params.set('color', color);
      const cart = await firstValueFrom(
        this.http.delete<ApiResponse<ServerCart>>(
          `${this.apiBase}/carts/current/items/${encodeURIComponent(id)}?${params.toString()}`,
          { withCredentials: true },
        ),
      ).then((res) => res.data);
      this._items.set(cart.items || []);
    } catch {
      await this.refresh();
    }
  }

  private async clearRemote(): Promise<void> {
    try {
      const cart = await firstValueFrom(
        this.http.delete<ApiResponse<ServerCart>>(`${this.apiBase}/carts/current/items`, { withCredentials: true }),
      ).then((res) => res.data);
      this._items.set(cart.items || []);
    } catch {
      await this.refresh();
    }
  }

  private getCart(): Promise<ServerCart> {
    return firstValueFrom(
      this.http.get<ApiResponse<ServerCart>>(`${this.apiBase}/carts/current`, { withCredentials: true }),
    ).then((res) => res.data);
  }

  private itemKey(item: CartItem): string {
    return [
      item.id,
      item.variantId || '',
      item.size,
      String(item.color || '').trim().toLowerCase(),
    ].join('|');
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
