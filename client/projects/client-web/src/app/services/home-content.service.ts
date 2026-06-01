import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_HOME_CONTENT, HomeContentData } from '../models/home-content.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface HomeLayoutSection {
  id: 'home-hero' | 'home-collections' | 'home-discount' | 'home-promise';
  title: string;
  visible: boolean;
}

interface StorefrontSnapshot {
  blocks: Array<{
    id: string;
    title: string;
    visible: boolean;
  }>;
}

const DEFAULT_HOME_LAYOUT: HomeLayoutSection[] = [
  { id: 'home-hero', title: 'Landing Hero', visible: true },
  { id: 'home-collections', title: 'Featured Collections', visible: true },
  { id: 'home-discount', title: 'Discount Hero', visible: true },
  { id: 'home-promise', title: 'Craft Promise', visible: true },
];

@Injectable({ providedIn: 'root' })
export class HomeContentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly _contentData = signal<HomeContentData>(this.cloneContent(DEFAULT_HOME_CONTENT));
  private readonly _layoutSections = signal<HomeLayoutSection[]>(this.cloneLayout(DEFAULT_HOME_LAYOUT));
  private loadPromise: Promise<HomeContentData> | null = null;

  readonly contentData = this._contentData.asReadonly();
  readonly layoutSections = this._layoutSections.asReadonly();

  async refresh(force = false): Promise<HomeContentData> {
    if (force) this.loadPromise = null;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = Promise.allSettled([
      firstValueFrom(this.http.get<ApiResponse<HomeContentData>>(`${this.apiBase}/storefront-content`)),
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

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  private cloneContent(content: HomeContentData): HomeContentData {
    return JSON.parse(JSON.stringify(content)) as HomeContentData;
  }

  private cloneLayout(layout: HomeLayoutSection[]): HomeLayoutSection[] {
    return layout.map((section) => ({ ...section }));
  }

  private normalizeLayout(blocks: StorefrontSnapshot['blocks'] | undefined): HomeLayoutSection[] {
    const allowed = new Set(DEFAULT_HOME_LAYOUT.map((section) => section.id));
    const incoming = Array.isArray(blocks) ? blocks : [];
    const ordered = incoming
      .filter((block): block is StorefrontSnapshot['blocks'][number] & { id: HomeLayoutSection['id'] } => allowed.has(block.id as HomeLayoutSection['id']))
      .map((block) => {
        const fallback = DEFAULT_HOME_LAYOUT.find((section) => section.id === block.id)!;
        return {
          ...fallback,
          title: block.title || fallback.title,
          visible: block.visible !== false,
        };
      });
    const missing = DEFAULT_HOME_LAYOUT.filter((section) => !ordered.some((block) => block.id === section.id));
    return [...ordered, ...this.cloneLayout(missing)];
  }

  private normalizeContentImages(content: HomeContentData): HomeContentData {
    const fallback = this.cloneContent(DEFAULT_HOME_CONTENT);
    const next = this.cloneContent({
      ...fallback,
      ...content,
      hero: { ...fallback.hero, ...(content.hero || {}) },
      collections: Array.isArray(content.collections) ? content.collections : fallback.collections,
      story: {
        ...fallback.story,
        ...(content.story || {}),
        hero: { ...fallback.story.hero, ...(content.story?.hero || {}) },
        chapters: Array.isArray(content.story?.chapters) ? content.story.chapters : fallback.story.chapters,
        quote: { ...fallback.story.quote, ...(content.story?.quote || {}) },
        atelier: {
          ...fallback.story.atelier,
          ...(content.story?.atelier || {}),
          items: Array.isArray(content.story?.atelier?.items) ? content.story.atelier.items : fallback.story.atelier.items,
        },
      },
    });
    next.hero.imageUrl = this.resolveMediaUrl(next.hero.imageUrl);
    next.collections = next.collections.slice(0, 3).map((tile) => ({
      ...tile,
      imageUrl: this.resolveMediaUrl(tile.imageUrl),
    }));
    next.story.hero.imageUrl = this.resolveMediaUrl(next.story.hero.imageUrl);
    next.story.chapters = next.story.chapters.map((chapter) => ({
      ...chapter,
      imageUrl: this.resolveMediaUrl(chapter.imageUrl),
    }));
    return next;
  }

  private resolveMediaUrl(url: string): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.apiBase.replace(/\/api\/?$/, '')}${value}`;
  }
}
