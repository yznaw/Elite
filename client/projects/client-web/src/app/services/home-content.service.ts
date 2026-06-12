import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_HOME_CONTENT, HomeContentData } from '../models/home-content.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface HomeLayoutSection {
  id: 'home-hero' | 'home-collections' | 'home-discount' | 'home-promise' | 'home-reels';
  title: string;
  visible: boolean;
}

interface StorefrontSnapshot {
  blocks: Array<{ id: string; title: string; visible: boolean }>;
}

const DEFAULT_HOME_LAYOUT: HomeLayoutSection[] = [
  { id: 'home-hero',        title: 'Landing Hero',        visible: true },
  { id: 'home-collections', title: 'Featured Collections', visible: true },
  { id: 'home-discount',    title: 'Promotion Section',        visible: true },
  { id: 'home-promise',     title: 'Craft Promise',        visible: true },
  { id: 'home-reels',       title: 'Stats Reel',           visible: true },
];

@Injectable({ providedIn: 'root' })
export class HomeContentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly _contentData = signal<HomeContentData>(this.cloneContent(DEFAULT_HOME_CONTENT));
  private readonly _layoutSections = signal<HomeLayoutSection[]>(this.cloneLayout(DEFAULT_HOME_LAYOUT));
  private readonly _previewToken = signal<string | null>(this.detectPreviewToken());
  private loadPromise: Promise<HomeContentData> | null = null;

  readonly contentData = this._contentData.asReadonly();
  readonly layoutSections = this._layoutSections.asReadonly();
  /** Non-null when the storefront is rendering a preview draft. */
  readonly previewToken = this._previewToken.asReadonly();
  readonly isPreviewMode = computed(() => this._previewToken() !== null);

  async refresh(force = false): Promise<HomeContentData> {
    if (force) this.loadPromise = null;
    if (this.loadPromise) return this.loadPromise;

    const token = this._previewToken();

    if (token) {
      // Preview mode: load draft content using the short-lived token
      this.loadPromise = firstValueFrom(
        this.http.get<ApiResponse<HomeContentData>>(
          `${this.apiBase}/storefront-content/draft?token=${encodeURIComponent(token)}`,
        ),
      )
        .then((res) => {
          if (res.data?.hero) this._contentData.set(this.normalizeContentImages(res.data));
          return this._contentData();
        })
        .catch(() => this._contentData());

      return this.loadPromise;
    }

    // Normal mode: load live content + layout
    const bust = force ? `?t=${Date.now()}` : '';

    this.loadPromise = Promise.allSettled([
      firstValueFrom(this.http.get<ApiResponse<HomeContentData>>(`${this.apiBase}/storefront-content${bust}`)),
      firstValueFrom(this.http.get<ApiResponse<StorefrontSnapshot>>(`${this.apiBase}/storefront/published`)),
    ])
      .then(([contentResult, layoutResult]) => {
        const content =
          contentResult.status === 'fulfilled' && contentResult.value.data?.hero
            ? contentResult.value.data
            : this._contentData();

        this._contentData.set(this.normalizeContentImages(content));

        if (layoutResult.status === 'fulfilled') {
          this._layoutSections.set(this.normalizeLayout(layoutResult.value.data?.blocks));
        }

        return this._contentData();
      })
      .catch(() => this._contentData());

    return this.loadPromise;
  }

  private detectPreviewToken(): string | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('preview');
    return token && token.length > 0 ? token : null;
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  private cloneContent(content: HomeContentData): HomeContentData {
    return JSON.parse(JSON.stringify(content)) as HomeContentData;
  }

  private cloneLayout(layout: HomeLayoutSection[]): HomeLayoutSection[] {
    return layout.map((s) => ({ ...s }));
  }

  private normalizeLayout(blocks: StorefrontSnapshot['blocks'] | undefined): HomeLayoutSection[] {
    const allowed = new Set(DEFAULT_HOME_LAYOUT.map((s) => s.id));
    const incoming = Array.isArray(blocks) ? blocks : [];
    const ordered = incoming
      .filter((b): b is StorefrontSnapshot['blocks'][number] & { id: HomeLayoutSection['id'] } =>
        allowed.has(b.id as HomeLayoutSection['id'])
      )
      .map((b) => {
        const fallback = DEFAULT_HOME_LAYOUT.find((s) => s.id === b.id)!;
        return { ...fallback, title: b.title || fallback.title, visible: b.visible !== false };
      });
    const missing = DEFAULT_HOME_LAYOUT.filter((s) => !ordered.some((b) => b.id === s.id));
    return [...ordered, ...this.cloneLayout(missing)];
  }

  private normalizeContentImages(content: HomeContentData): HomeContentData {
    const fallback = this.cloneContent(DEFAULT_HOME_CONTENT);
    const next = this.cloneContent({
      ...fallback,
      ...content,
      hero:       { ...fallback.hero,       ...(content.hero       || {}) },
      collections: Array.isArray(content.collections) ? content.collections : fallback.collections,
      heroSlider: {
        ctaEn: content.heroSlider?.ctaEn || fallback.heroSlider.ctaEn,
        ctaAr: content.heroSlider?.ctaAr || fallback.heroSlider.ctaAr,
        items: Array.isArray(content.heroSlider?.items) && content.heroSlider.items.length > 0
          ? content.heroSlider.items.map((item) => ({
              ...item,
              callouts: Array.isArray(item.callouts) ? item.callouts : [],
            }))
          : fallback.heroSlider.items,
      },
      promise: {
        cards: Array.isArray(content.promise?.cards) ? content.promise!.cards : fallback.promise.cards,
      },
      stats: Array.isArray(content.stats) ? content.stats : fallback.stats,
      contact: {
        ...fallback.contact,
        ...(content.contact || {}),
        infoBlocks:  Array.isArray(content.contact?.infoBlocks)  ? content.contact!.infoBlocks  : fallback.contact.infoBlocks,
        socialLinks: Array.isArray(content.contact?.socialLinks) ? content.contact!.socialLinks : fallback.contact.socialLinks,
      },
      story: {
        ...fallback.story,
        ...(content.story || {}),
        heroFacts: Array.isArray(content.story?.heroFacts) && content.story.heroFacts.length > 0
          ? content.story.heroFacts
          : fallback.story.heroFacts,
        hero:     { ...fallback.story.hero,     ...(content.story?.hero     || {}) },
        intro:    { ...fallback.story.intro,    ...(content.story?.intro    || {}) },
        chapters: Array.isArray(content.story?.chapters) && content.story.chapters.length > 0
          ? content.story.chapters
          : fallback.story.chapters,
        quote:    { ...fallback.story.quote,    ...(content.story?.quote    || {}) },
        atelier:  {
          ...fallback.story.atelier,
          ...(content.story?.atelier || {}),
          items: Array.isArray(content.story?.atelier?.items) && content.story!.atelier.items.length > 0
            ? content.story!.atelier.items
            : fallback.story.atelier.items,
        },
      },
    });

    // Resolve media URLs
    next.hero.imageUrl           = this.resolveMediaUrl(next.hero.imageUrl);
    next.collections             = next.collections.slice(0, 3).map((t) => ({ ...t, imageUrl: this.resolveMediaUrl(t.imageUrl) }));
    next.story.hero.imageUrl     = this.resolveMediaUrl(next.story.hero.imageUrl);
    next.story.chapters          = next.story.chapters.map((c) => ({ ...c, imageUrl: this.resolveMediaUrl(c.imageUrl) }));
    next.heroSlider.items = next.heroSlider.items.map((item) => ({
      ...item,
      imageUrl: this.resolveMediaUrl(item.imageUrl),
      callouts: (item.callouts ?? []).map((cl) => ({
        ...cl,
        thumbnail: this.resolveMediaUrl(cl.thumbnail),
      })),
    }));

    return next;
  }

  private resolveMediaUrl(url: string): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:|\/assets\/)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;
    return `${this.apiBase}${value}`;
  }
}
