import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StorefrontBlock } from '../models';
import { ApiClient } from './api-client.service';
import { StorageService } from './storage.service';

const PREVIEW_TOKEN = 'elite-admin:preview-token';

interface Snapshot {
  blocks: StorefrontBlock[];
  /** ISO timestamp of when this snapshot was committed. */
  savedAt: string | null;
}

export const HOME_LAYOUT_BLOCKS: StorefrontBlock[] = [
  { id: 'home-hero', type: '3D Hero', title: '3D Hero', visible: true, config: 'Interactive model hero' },
  { id: 'home-collections', type: 'Featured Collections', title: 'Featured Collections', visible: true, config: '3 admin collections', collectionIds: [] },
  { id: 'home-discount', type: 'Discount Hero', title: 'Discount Hero', visible: true, config: 'Promotional split section' },
  { id: 'home-promise', type: 'Craft Promise', title: 'Craft Promise', visible: true, config: 'Stats and atelier promise' },
];

/**
 * Storefront layout persistence + publish flow.
 *
 * Draft     — the editor's working copy. Auto-persisted on every change so a
 *             reload doesn't lose work. Read by the customer-web in preview mode.
 * Published — the version shoppers see. Updated by `publish()`.
 *
 * Persistence is backend-only so every admin device sees the same draft and
 * published home layout.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private readonly api = inject(ApiClient);
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

  /** Update the in-memory draft immediately; callers persist with saveDraftRemote. */
  saveDraft(blocks: StorefrontBlock[]): void {
    this._draft.set({ blocks, savedAt: new Date().toISOString() });
  }

  async loadDraft(): Promise<Snapshot | null> {
    const snapshot = await firstValueFrom(this.api.get<Snapshot | null>('/admin/storefront/draft'));
    if (snapshot) this._draft.set(snapshot);
    return snapshot;
  }

  async saveDraftRemote(blocks: StorefrontBlock[]): Promise<Snapshot | null> {
    const snapshot = await firstValueFrom(this.api.post<Snapshot | null>('/admin/storefront/draft', {
      title: 'Home layout',
      blocks,
    }));
    if (snapshot) this._draft.set(snapshot);
    return snapshot;
  }

  /** Promote the in-memory draft; production persistence goes through publishRemote. */
  publish(): Snapshot | null {
    const d = this._draft();
    if (!d) return null;
    const next: Snapshot = { blocks: d.blocks, savedAt: new Date().toISOString() };
    this._published.set(next);
    return next;
  }

  async publishRemote(): Promise<Snapshot | null> {
    const snapshot = await firstValueFrom(this.api.post<Snapshot | null>('/admin/storefront/publish', {}));
    if (snapshot) this._published.set(snapshot);
    return snapshot;
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
}
