import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_HOME_CONTENT, HomeContentData } from '../models/home-content.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class HomeContentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly _contentData = signal<HomeContentData>(this.cloneContent(DEFAULT_HOME_CONTENT));
  private loadPromise: Promise<HomeContentData> | null = null;

  readonly contentData = this._contentData.asReadonly();

  async refresh(force = false): Promise<HomeContentData> {
    if (force) this.loadPromise = null;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = firstValueFrom(
      this.http.get<ApiResponse<HomeContentData>>(`${this.apiBase}/storefront-content`),
    )
      .then((res) => {
        if (res.data?.hero && Array.isArray(res.data.collections)) {
          this._contentData.set(this.normalizeContentImages(res.data));
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

  private normalizeContentImages(content: HomeContentData): HomeContentData {
    const next = this.cloneContent(content);
    next.hero.imageUrl = this.resolveMediaUrl(next.hero.imageUrl);
    next.collections = next.collections.map((tile) => ({
      ...tile,
      imageUrl: this.resolveMediaUrl(tile.imageUrl),
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
