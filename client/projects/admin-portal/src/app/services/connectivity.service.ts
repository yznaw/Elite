import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client.service';
import { I18nService } from './i18n.service';
import { ToastService } from './toast.service';

export const NETWORK_TOAST_KEY = 'network';
const BACK_ONLINE_TOAST_KEY = 'network-back';
/** Probe delays while offline; the last one repeats. */
const PROBE_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000];
const PROBE_TIMEOUT_MS = 5000;

/**
 * One owner for "is the API reachable?" in the back office.
 *
 * A page fires several requests at once, and every one of them used to raise
 * its own "Connection lost" toast that never went away. Now the first failure
 * flips this to offline and shows ONE message that stays while the API is
 * unreachable, probes /api/health with backoff, and clears itself (with a
 * short "Back online") as soon as any request or probe succeeds.
 *
 * The POS is left alone: it has its own offline mode and indicator.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly api = inject(ApiClient);

  readonly online = signal(true);

  private probeTimer: number | null = null;
  private attempt = 0;
  private probing = false;

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('offline', () => { if (!this.onPos()) this.reportFailure(); });
    window.addEventListener('online', () => { if (!this.online()) void this.probeNow(); });
  }

  /** A request could not reach the API at all (HTTP status 0). */
  reportFailure(): void {
    if (!this.online()) return;
    this.online.set(false);
    this.attempt = 0;
    this.toast.dismissKey(BACK_ONLINE_TOAST_KEY);
    this.toast.push({
      key: NETWORK_TOAST_KEY,
      kind: 'error',
      title: this.i18n.t('error.network.title'),
      sub: this.i18n.t('error.network.sub'),
      duration: null,
      action: { label: this.i18n.t('error.network.retry'), run: () => void this.probeNow(), keepOpen: true },
    });
    this.scheduleProbe();
  }

  /** Something reached the API; if we were offline, say so once and move on. */
  reportSuccess(): void {
    if (this.online()) return;
    this.online.set(true);
    this.clearProbe();
    this.toast.dismissKey(NETWORK_TOAST_KEY);
    this.toast.push({
      key: BACK_ONLINE_TOAST_KEY,
      kind: 'success',
      title: this.i18n.t('error.network.back'),
      duration: 3000,
    });
  }

  async probeNow(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    this.clearProbe();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(this.api.url('/health'), { cache: 'no-store', signal: controller.signal });
      if (response.ok) {
        this.reportSuccess();
        return;
      }
    } catch {
      // Still unreachable; fall through to the next scheduled attempt.
    } finally {
      clearTimeout(timeout);
      this.probing = false;
    }
    // Still offline (a scheduled probe or the Retry button failed): the one
    // message stays up and the next attempt is scheduled with more backoff.
    if (!this.online()) this.scheduleProbe();
  }

  private scheduleProbe(): void {
    this.clearProbe();
    const delay = PROBE_BACKOFF_MS[Math.min(this.attempt, PROBE_BACKOFF_MS.length - 1)];
    this.attempt++;
    this.probeTimer = window.setTimeout(() => void this.probeNow(), delay);
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  private onPos(): boolean {
    return window.location.pathname.startsWith('/pos');
  }
}
