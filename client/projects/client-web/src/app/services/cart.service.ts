import { ProductsService } from './products.service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CartItem } from '../models/product.model';
import { API_BASE } from '../core/api-base';

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

/** One line of a 409 INSUFFICIENT_STOCK response from add-to-bag or checkout. */
export interface StockShortage {
  variantId?: string | null;
  sku: string;
  name: string;
  size?: string | number | null;
  color?: string | null;
  requested: number;
  available: number;
  inBag?: number;
}

export function stockShortages(err: unknown): StockShortage[] {
  if (!(err instanceof HttpErrorResponse) || err.status !== 409) return [];
  if (err.error?.code !== 'INSUFFICIENT_STOCK' || !Array.isArray(err.error.details)) return [];
  return err.error.details;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly products = inject(ProductsService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE);
  private readonly _items = signal<CartItem[]>([]);
  private readonly _open = signal<boolean>(false);
  private readonly _rejectedAdd = signal<StockShortage | null>(null);

  readonly items = this._items.asReadonly();
  readonly isOpen = this._open.asReadonly();
  readonly count = computed(() => this._items().reduce((s, i) => s + i.qty, 0));
  readonly subtotal = computed(() => this._items().reduce((s, i) => s + i.price * i.qty, 0));
  /** Lines holding more than is still in stock (sold out or partly). */
  readonly stockIssues = computed(() => this._items().filter((i) => i.available != null && i.qty > i.available));
  /** Set when the server refused an add because there was not enough stock. */
  readonly rejectedAdd = this._rejectedAdd.asReadonly();

  constructor() {
    // Browser only. The cart is tied to the visitor's session cookie, which a
    // server render doesn't carry, so fetching it there would create an
    // anonymous server-side cart on every rendered page view.
    if (isPlatformBrowser(inject(PLATFORM_ID))) void this.refresh();
  }

  add(item: CartItem): void {
    this._rejectedAdd.set(null);
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

  /**
   * Lowers a line to what is still in stock. The API has no quantity update,
   * so the line is deleted and re-added; the UI only takes the final result.
   */
  async setQty(item: CartItem, qty: number): Promise<void> {
    if (qty <= 0) {
      this.remove(item.id, item.size, item.variantId, item.color);
      return;
    }
    const key = this.itemKey(item);
    this._items.update((prev) => prev.map((i) => (this.itemKey(i) === key ? { ...i, qty } : i)));
    try {
      await this.deleteItemRequest(item.id, item.size, item.variantId, item.color);
      const cart = await this.addItemRequest({ ...item, qty });
      this._items.set(cart.items || []);
    } catch {
      await this.refresh();
    }
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
      const cart = await this.addItemRequest(item);
      this._items.set(cart.items || []);
    } catch (err) {
      const [shortage] = stockShortages(err);
      if (shortage) {
        this._rejectedAdd.set(shortage);
        void this.products.refresh();
      }
      await this.refresh();
    }
  }

  private addItemRequest(item: CartItem): Promise<ServerCart> {
    return firstValueFrom(
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
  }

  private async removeRemote(id: string, size: number, variantId?: string, color?: string | null): Promise<void> {
    try {
      const cart = await this.deleteItemRequest(id, size, variantId, color);
      this._items.set(cart.items || []);
    } catch {
      await this.refresh();
    }
  }

  private deleteItemRequest(id: string, size: number, variantId?: string, color?: string | null): Promise<ServerCart> {
    const params = new URLSearchParams({ size: String(size) });
    if (variantId) params.set('variantId', variantId);
    if (color) params.set('color', color);
    return firstValueFrom(
      this.http.delete<ApiResponse<ServerCart>>(
        `${this.apiBase}/carts/current/items/${encodeURIComponent(id)}?${params.toString()}`,
        { withCredentials: true },
      ),
    ).then((res) => res.data);
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

}
