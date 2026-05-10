import { Injectable, signal, computed } from '@angular/core';

export type NotifKind = 'order' | 'stock' | 'sync' | 'system' | 'customer';

export interface Notification {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  ts: Date;
  read: boolean;
  /** Optional route to navigate on click */
  route?: string;
}

/** Seed notifications — in production, these come from SSE / WebSocket / polling. */
const SEED: Notification[] = [
  {
    id: 'n1', kind: 'order', title: 'New order received',
    body: 'ORD-1049 · Noura Al-Thani · QAR 2,340',
    ts: new Date(Date.now() - 4 * 60_000), read: false, route: '/orders',
  },
  {
    id: 'n2', kind: 'stock', title: 'Low stock alert',
    body: 'Midnight Abaya (ABY-003) — 2 remaining',
    ts: new Date(Date.now() - 22 * 60_000), read: false, route: '/catalog',
  },
  {
    id: 'n3', kind: 'sync', title: 'Sync completed',
    body: 'Shopify · 146 records updated · 0 errors',
    ts: new Date(Date.now() - 58 * 60_000), read: true, route: '/sync',
  },
  {
    id: 'n4', kind: 'customer', title: 'New customer joined',
    body: 'Maryam Hassan · maryam@example.com',
    ts: new Date(Date.now() - 2 * 3600_000), read: true, route: '/customers',
  },
  {
    id: 'n5', kind: 'system', title: 'System update available',
    body: 'v2.4.1 — Performance improvements & bug fixes',
    ts: new Date(Date.now() - 5 * 3600_000), read: true,
  },
  {
    id: 'n6', kind: 'order', title: 'Order delivered',
    body: 'ORD-1042 · Fatima Al-Mansour · Marked as delivered',
    ts: new Date(Date.now() - 8 * 3600_000), read: true, route: '/orders',
  },
];

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly _items = signal<Notification[]>([...SEED]);
  readonly items = this._items.asReadonly();

  readonly unreadCount = computed(() => this._items().filter(n => !n.read).length);

  markRead(id: string): void {
    this._items.update(list => list.map(n => n.id === id ? { ...n, read: true } : n));
  }

  markAllRead(): void {
    this._items.update(list => list.map(n => ({ ...n, read: true })));
  }

  dismiss(id: string): void {
    this._items.update(list => list.filter(n => n.id !== id));
  }

  /**
   * Push a new notification to the top of the list.
   * In production, call this from SSE/WebSocket message handler.
   */
  push(notif: Omit<Notification, 'id' | 'ts' | 'read'>): void {
    const n: Notification = {
      ...notif,
      id: 'n-' + Date.now(),
      ts: new Date(),
      read: false,
    };
    this._items.update(list => [n, ...list]);
  }

  /** Relative time label (e.g. "3m ago", "2h ago") */
  timeAgo(ts: Date): string {
    const diff = Date.now() - ts.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
}
