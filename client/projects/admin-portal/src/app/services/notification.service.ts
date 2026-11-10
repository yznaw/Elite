import { Injectable, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { I18nService } from './i18n.service';
import { AuthService } from './auth.service';

export type NotifKind = 'order' | 'stock' | 'sync' | 'system' | 'customer';

export interface Notification {
  id: number;
  kind: NotifKind;
  title: string;
  body: string;
  ts: Date;
  read: boolean;
  /** Route to open on click, e.g. /orders?id=… */
  route?: string;
}

interface FeedRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  createdAt: string;
}

interface FeedResponse {
  items: FeedRow[];
  lastReadId: number;
}

export type DesktopAlertState = 'unsupported' | 'default' | 'granted' | 'denied';

const VISIBLE_POLL_MS = 20_000;
const HIDDEN_POLL_MS = 60_000;
const MAX_ITEMS = 50;
const SOUND_KEY = 'elite.notif.sound';
// Shared across tabs so two open admin tabs do not both chime for one order.
const ALERTED_KEY = 'elite.notif.alertedId';

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode: best effort */ }
}

/**
 * The top-bar bell. Rows come from GET /api/admin/notifications (written by
 * server/lib/staff-notify.js when a website order is paid).
 *
 * Polls every 20 s while the tab is visible and every 60 s while hidden. On a
 * new order it plays a short chime and shows a desktop (Windows) notification
 * when the user has allowed them. Both only work while the admin is open in a
 * browser tab; the new-order email covers the closed-browser case.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly auth = inject(AuthService);

  private readonly _items = signal<Notification[]>([]);
  private readonly _lastReadId = signal(0);
  readonly items = computed(() => this._items().map((n) => ({ ...n, read: n.id <= this._lastReadId() })));
  readonly unreadCount = computed(() => this._items().filter((n) => n.id > this._lastReadId()).length);
  readonly loaded = signal(false);

  readonly soundEnabled = signal(storageGet(SOUND_KEY) !== 'off');
  readonly desktopState = signal<DesktopAlertState>(this.readPermission());

  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private newestId = 0;
  private audio: AudioContext | null = null;

  constructor() {
    // Poll only while signed in; a sign-out (or a different user signing in)
    // drops the previous feed, since read state is per user.
    effect(() => {
      const signedIn = this.auth.isAuthenticated();
      untracked(() => {
        if (signedIn) this.start();
        else this.reset();
      });
    });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.poll(true);
  }

  private reset(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.newestId = 0;
    this._items.set([]);
    this._lastReadId.set(0);
    this.loaded.set(false);
  }

  /** Called when the dropdown opens: everything on screen counts as seen. */
  async markAllRead(): Promise<void> {
    const upToId = this.newestId;
    if (!upToId || upToId <= this._lastReadId()) return;
    this._lastReadId.set(upToId);
    try {
      const res = await firstValueFrom(this.api.post<{ lastReadId: number }>('/admin/notifications/read', { upToId }));
      this._lastReadId.set(Math.max(this._lastReadId(), res.lastReadId));
    } catch { /* the badge simply comes back on the next poll */ }
  }

  setSound(on: boolean): void {
    this.soundEnabled.set(on);
    storageSet(SOUND_KEY, on ? 'on' : 'off');
    if (on) this.chime();
  }

  /** Must run from a click: browsers only show the permission prompt on a user gesture. */
  async enableDesktopAlerts(): Promise<void> {
    if (!('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      this.desktopState.set(result as DesktopAlertState);
    } catch {
      this.desktopState.set(this.readPermission());
    }
  }

  /** Relative time label, localized. */
  timeAgo(ts: Date): string {
    const mins = Math.floor((Date.now() - ts.getTime()) / 60_000);
    if (mins < 1) return this.i18n.t('notif.justNow');
    if (mins < 60) return this.i18n.t('notif.minutesAgo').replace('{n}', String(mins));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return this.i18n.t('notif.hoursAgo').replace('{n}', String(hrs));
    return this.i18n.t('notif.daysAgo').replace('{n}', String(Math.floor(hrs / 24)));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private readonly onVisibility = (): void => {
    // Coming back to the tab: check now instead of waiting out the slow timer.
    if (document.visibilityState === 'visible' && this.started) this.schedule(0);
    this.desktopState.set(this.readPermission());
  };

  private schedule(delay: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(false), delay);
  }

  private async poll(initial: boolean): Promise<void> {
    try {
      const path = initial || !this.newestId ? '/admin/notifications' : `/admin/notifications?after=${this.newestId}`;
      const res = await firstValueFrom(this.api.get<FeedResponse>(path));
      if (!this.started) return; // signed out while the request was in flight
      const fresh = (Array.isArray(res?.items) ? res.items : []).map((row) => this.toNotification(row));
      this._lastReadId.set(Math.max(this._lastReadId(), Number(res?.lastReadId) || 0));
      if (initial) {
        this._items.set(fresh);
      } else if (fresh.length) {
        const known = new Set(this._items().map((n) => n.id));
        const added = fresh.filter((n) => !known.has(n.id));
        this._items.update((list) => [...added, ...list].slice(0, MAX_ITEMS));
        this.alert(added);
      }
      this.newestId = Math.max(this.newestId, ...this._items().map((n) => n.id), 0);
      // Items already in the feed at page load are not "new" to this tab.
      if (initial) this.markAlerted(this.newestId);
      this.loaded.set(true);
    } catch {
      // Network and session problems are surfaced by the HTTP interceptor;
      // the bell just tries again on the next tick.
    } finally {
      this.schedule(document.visibilityState === 'visible' ? VISIBLE_POLL_MS : HIDDEN_POLL_MS);
    }
  }

  private toNotification(row: FeedRow): Notification {
    const kind = (['order', 'stock', 'sync', 'system', 'customer'].includes(row.kind) ? row.kind : 'system') as NotifKind;
    return {
      id: row.id,
      kind,
      title: row.title,
      body: row.body,
      ts: new Date(row.createdAt),
      read: false,
      route: row.route || undefined,
    };
  }

  private markAlerted(id: number): void {
    const prev = Number(storageGet(ALERTED_KEY) || 0);
    if (id > prev) storageSet(ALERTED_KEY, String(id));
  }

  private alert(added: Notification[]): void {
    const orders = added.filter((n) => n.kind === 'order');
    if (!orders.length) return;
    const newest = Math.max(...orders.map((n) => n.id));
    // Another open tab already alerted for these.
    if (newest <= Number(storageGet(ALERTED_KEY) || 0)) return;
    this.markAlerted(newest);
    if (this.soundEnabled()) this.chime();
    if (this.desktopState() === 'granted') {
      for (const n of orders.slice(0, 3)) this.showDesktop(n);
    }
  }

  private showDesktop(n: Notification): void {
    try {
      const desktop = new window.Notification(n.title, {
        body: n.body,
        // Same tag across tabs: the OS keeps one notification per order.
        tag: `elite-order-${n.id}`,
        icon: '/favicon-192x192.png',
      });
      desktop.onclick = () => {
        window.focus();
        desktop.close();
        if (n.route) this.zone.run(() => void this.router.navigateByUrl(n.route!));
      };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }

  /** A short two-note chime, synthesized so there is no audio file to ship. */
  private chime(): void {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      const ctx = this.audio;
      if (ctx.state === 'suspended') void ctx.resume();
      const start = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = start + i * 0.16;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.4);
      });
    } catch { /* audio is a nicety; never break the bell over it */ }
  }

  private readPermission(): DesktopAlertState {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as DesktopAlertState;
  }
}
