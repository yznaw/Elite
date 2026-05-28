import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StorefrontBlock } from '../models';
import { StorageService } from './storage.service';

const PREVIEW_TOKEN = 'elite-admin:preview-token';

interface Snapshot {
  blocks: StorefrontBlock[];
  /** ISO timestamp of when this snapshot was committed. */
  savedAt: string;
}

/**
 * Storefront layout persistence + publish flow.
 *
 * Draft     — the editor's working copy. Auto-persisted on every change so a
 *             reload doesn't lose work. Read by the customer-web in preview mode.
 * Published — the version shoppers see. Updated by `publish()`.
 *
 * In production this would be backed by API calls (POST /api/storefront/draft,
 * POST /api/storefront/publish). The signal API stays the same — just swap the
 * localStorage reads/writes for HTTP calls.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private readonly storage = inject(StorageService);

  private readonly _draft = signal<Snapshot | null>(null);
  private readonly _published = signal<Snapshot | null>(null);

  readonly draft = this._draft.asReadonly();
  readonly published = this._published.asReadonly();

  /** True when draft has unpublished changes (or there's a draft but no published version). */
  readonly hasUnpublishedChanges = computed(() => {
    const d = this._draft(), p = this._published();
    if (!d) return false;
    if (!p) return true;
    return JSON.stringify(d.blocks) !== JSON.stringify(p.blocks);
  });

  constructor() {
    // Load saved state using tenant-scoped keys (storage is available here).
    this._draft.set(this.load('storefront:draft'));
    this._published.set(this.load('storefront:published'));

    // Persist draft to localStorage automatically.
    effect(() => {
      const d = this._draft();
      if (d) this.storage.set('storefront:draft', JSON.stringify(d));
      else this.storage.remove('storefront:draft');
    });
    // Persist published to localStorage automatically.
    effect(() => {
      const p = this._published();
      if (p) this.storage.set('storefront:published', JSON.stringify(p));
      else this.storage.remove('storefront:published');
    });
  }

  /** Save a draft snapshot — call after every edit. */
  saveDraft(blocks: StorefrontBlock[]): void {
    this._draft.set({ blocks, savedAt: new Date().toISOString() });
  }

  /** Promote draft → published. Customer-web reads from the published key. */
  publish(): Snapshot | null {
    const d = this._draft();
    if (!d) return null;
    const next: Snapshot = { blocks: d.blocks, savedAt: new Date().toISOString() };
    this._published.set(next);
    return next;
  }

  /** Roll the published snapshot back (used by the Undo affordance after a publish). */
  revertPublished(snapshot: Snapshot | null): void {
    this._published.set(snapshot);
  }

  /**
   * Build the URL for the preview tab. Strategy:
   *   • dev: admin runs on :4300 → swap to :4200
   *   • prod: 'admin.example.com' → strip the 'admin.' prefix
   *   • fallback: same origin
   *
   * Override at runtime via window.__ELITE_STOREFRONT_URL__ if you have a
   * non-standard host layout.
   */
  storefrontUrl(): string {
    const w = (typeof window !== 'undefined') ? window : null;
    if (!w) return '/';
    const override = (w as unknown as { __ELITE_STOREFRONT_URL__?: string }).__ELITE_STOREFRONT_URL__;
    if (override) return override;

    const { protocol, hostname, port } = w.location;
    if (port === '4300') return `${protocol}//${hostname}:4200`;
    if (hostname.startsWith('admin.')) return `${protocol}//${hostname.slice(6)}`;
    return `${protocol}//${w.location.host}`;
  }

  /**
   * Build a one-time preview link with a short-lived token.
   * In production the token would be issued by the backend and validated on
   * the customer-web; for the prototype it's a random string we both store
   * locally so the customer-web can verify and pick up the draft layout.
   */
  buildPreviewLink(): string {
    const token = crypto.getRandomValues(new Uint32Array(2)).join('-');
    try { sessionStorage.setItem(PREVIEW_TOKEN, token); } catch {}
    const base = this.storefrontUrl();
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}preview=storefront&token=${token}`;
  }

  /** Clears both draft and published. Useful for a full reset. */
  reset(): void {
    this._draft.set(null);
    this._published.set(null);
  }

  private load(base: string): Snapshot | null {
    try {
      const raw = this.storage.get(base);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Snapshot;
      if (parsed && Array.isArray(parsed.blocks) && typeof parsed.savedAt === 'string') return parsed;
      return null;
    } catch {
      return null;
    }
  }
}
