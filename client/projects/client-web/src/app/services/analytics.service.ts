import { Injectable, NgZone, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

/** A single tracked interaction, queued client-side before being flushed. */
interface TrackedEvent {
  type: string;
  sessionId: string;
  pagePath: string;
  productId?: string | null;
  collectionId?: string | null;
  locale?: string | null;
  referrer?: string | null;
  metadata?: Record<string, unknown>;
  ts: number;
}

const SESSION_KEY = 'cw_a_sid';     // sessionStorage: the session uuid (per visit)
const VISITOR_KEY = 'cw_a_vid';     // localStorage: persistent visitor uuid (across visits)
const ACTIVITY_KEY = 'cw_a_seen';   // sessionStorage: last-activity epoch ms
const IDLE_MS = 30 * 60 * 1000;     // 30 min of inactivity starts a new session
const FLUSH_MS = 10_000;            // periodic flush cadence
const MAX_QUEUE = 25;               // flush early once the queue reaches this

/**
 * Lightweight, privacy-friendly storefront analytics.
 *
 * Design goals (perf-first):
 *   - ONE delegated `click` listener at the document root (capture + passive),
 *     so adding components never adds listeners. Elements opt in with
 *     `data-track="some-label"`.
 *   - Events are queued in memory and flushed in batches — never one request
 *     per click. The unload flush uses `navigator.sendBeacon`, which the
 *     browser sends off the main thread without delaying page close.
 *   - No layout reads on the hot path (we use the event's own clientX/Y).
 *
 * All listeners run outside Angular's zone so tracking never triggers change
 * detection. Call `init()` once from the root component.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly endpoint = `${this.resolveApiBase()}/analytics/collect`;

  private queue: TrackedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  /** Idempotent. Wires the delegated listeners and starts the flush loop. */
  init(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;

    // Open the session, carrying the *real* external entry referrer
    // (document.referrer) — this is what traffic-source attribution uses.
    // The HTTP Referer header on the beacon request is our own page, so the
    // client must send the original referrer explicitly.
    this.track('session_start', { referrer: document.referrer || null });
    this.track('pageview');

    this.zone.runOutsideAngular(() => {
      // One delegated click listener for the whole app.
      document.addEventListener('click', this.onClick, { capture: true, passive: true });

      // Flush opportunistically and reliably on the way out.
      document.addEventListener('visibilitychange', this.onHidden);
      window.addEventListener('pagehide', this.onHidden);

      this.timer = setInterval(() => this.flush(), FLUSH_MS);
    });

    // SPA navigations don't reload the page — track them explicitly.
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.track('pageview'));
  }

  /** Manually record a semantic event (e.g. add_to_cart) from anywhere. */
  track(type: string, extra: Partial<TrackedEvent> = {}): void {
    this.touchSession();
    this.queue.push({
      type,
      sessionId: this.sessionId(),
      pagePath: location.pathname + location.search,
      productId: extra.productId ?? null,
      collectionId: extra.collectionId ?? null,
      locale: document.documentElement.lang || null,
      referrer: extra.referrer ?? null,
      // Stamp every event with the persistent visitor id so the admin can
      // count unique visitors (distinct visitorId) vs sessions.
      metadata: { ...(extra.metadata ?? {}), visitorId: this.visitorId() },
      ts: Date.now(),
    });
    if (this.queue.length >= MAX_QUEUE) this.flush();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private readonly onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>('[data-track]');
    if (!el) return;
    this.track('click', {
      productId: el.getAttribute('data-track-product') || null,
      metadata: {
        label: el.getAttribute('data-track'),
        x: e.clientX,
        y: e.clientY,
        tag: el.tagName.toLowerCase(),
      },
    });
  };

  private readonly onHidden = (e: Event): void => {
    // pagehide always flushes; visibilitychange only when actually hidden.
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') {
      this.flush(true);
    }
  };

  /** Send queued events. Uses sendBeacon on unload, fetch+keepalive otherwise. */
  private flush(useBeacon = false): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const payload = JSON.stringify({ events: batch });

    try {
      if (useBeacon && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        const sent = navigator.sendBeacon(this.endpoint, blob);
        if (!sent) this.queue = batch.concat(this.queue); // re-queue on failure
        return;
      }
      void fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        credentials: 'include',
      }).catch(() => { this.queue = batch.concat(this.queue); });
    } catch {
      this.queue = batch.concat(this.queue);
    }
  }

  private sessionId(): string {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = this.uuid();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  /** Persistent across visits (localStorage) — identifies a unique visitor. */
  private visitorId(): string {
    let id: string | null = null;
    try { id = localStorage.getItem(VISITOR_KEY); } catch { /* storage blocked */ }
    if (!id) {
      id = this.uuid();
      try { localStorage.setItem(VISITOR_KEY, id); } catch { /* ignore */ }
    }
    return id;
  }

  /** Rotate the session id if the tab has been idle past the threshold. */
  private touchSession(): void {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
    if (last && now - last > IDLE_MS) {
      sessionStorage.setItem(SESSION_KEY, this.uuid());
    }
    sessionStorage.setItem(ACTIVITY_KEY, String(now));
  }

  private uuid(): string {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
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
