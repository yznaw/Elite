import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface RefColor {
  id: string;
  name_en: string;
  name_ar: string;
  hex: string;
  swatch_image_url?: string | null;
  sort_order: number;
}

export interface SizeChartRow {
  uk: string;
  eu: string;
  us: string;
}

export interface RefSizeSet {
  id: string;
  name: string;
  sizes: string[];
  size_chart: SizeChartRow[];
  tip?: string | null;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class ReferenceDataService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly cacheMs = 60 * 60_000;
  private readonly _colorHexByName = signal<Record<string, string>>({});
  private readonly _colorSwatchImageByName = signal<Record<string, string>>({});
  private readonly _sizeSets = signal<RefSizeSet[]>([]);
  private colorsPromise: Promise<Record<string, string>> | null = null;
  private sizeSetsPromise: Promise<RefSizeSet[]> | null = null;
  private colorsLoadedAt = 0;
  private sizeSetsLoadedAt = 0;

  readonly colorHexByName = this._colorHexByName.asReadonly();
  readonly colorSwatchImageByName = this._colorSwatchImageByName.asReadonly();
  readonly sizeSets = this._sizeSets.asReadonly();

  async ensureColors(): Promise<Record<string, string>> {
    if (Object.keys(this._colorHexByName()).length > 0) {
      if (Date.now() - this.colorsLoadedAt > this.cacheMs && !this.colorsPromise) {
        void this.loadColors(true);
      }
      return this._colorHexByName();
    }

    return this.loadColors();
  }

  async refreshColors(): Promise<Record<string, string>> {
    return this.loadColors(true);
  }

  async ensureSizeSets(): Promise<RefSizeSet[]> {
    if (this._sizeSets().length > 0) {
      if (Date.now() - this.sizeSetsLoadedAt > this.cacheMs && !this.sizeSetsPromise) {
        void this.loadSizeSets(true);
      }
      return this._sizeSets();
    }

    return this.loadSizeSets();
  }

  async refreshSizeSets(): Promise<RefSizeSet[]> {
    return this.loadSizeSets(true);
  }

  private async loadColors(force = false): Promise<Record<string, string>> {
    if (force) this.colorsPromise = null;
    if (this.colorsPromise) return this.colorsPromise;

    this.colorsPromise = firstValueFrom(
      this.http.get<ApiResponse<RefColor[]>>(`${this.apiBase}/ref/colors`),
    )
      .then((res) => {
        const colors = Array.isArray(res.data) ? res.data : [];
        const map = colors.reduce<Record<string, string>>((acc, color) => {
          const name = String(color.name_en || '').trim().toLowerCase();
          const hex = String(color.hex || '').trim();
          if (name && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
            acc[name] = hex;
          }
          return acc;
        }, {});
        const swatchMap = colors.reduce<Record<string, string>>((acc, color) => {
          const name = String(color.name_en || '').trim().toLowerCase();
          const image = this.resolveMediaUrl(color.swatch_image_url);
          if (name && image) acc[name] = image;
          return acc;
        }, {});
        this._colorHexByName.set(map);
        this._colorSwatchImageByName.set(swatchMap);
        this.colorsLoadedAt = Date.now();
        return map;
      })
      .catch(() => this._colorHexByName())
      .finally(() => {
        this.colorsPromise = null;
      });

    return this.colorsPromise;
  }

  private async loadSizeSets(force = false): Promise<RefSizeSet[]> {
    if (force) this.sizeSetsPromise = null;
    if (this.sizeSetsPromise) return this.sizeSetsPromise;

    this.sizeSetsPromise = firstValueFrom(
      this.http.get<ApiResponse<RefSizeSet[]>>(`${this.apiBase}/ref/size-sets`),
    )
      .then((res) => {
        const sets = Array.isArray(res.data)
          ? res.data.map((set) => ({
            ...set,
            sizes: Array.isArray(set.sizes) ? set.sizes.map((size) => String(size).trim()).filter(Boolean) : [],
            size_chart: Array.isArray(set.size_chart) ? set.size_chart : [],
            tip: set.tip ?? null,
          })).filter((set) => set.name && (set.sizes.length > 0 || set.size_chart.length > 0))
          : [];
        this._sizeSets.set(sets);
        this.sizeSetsLoadedAt = Date.now();
        return sets;
      })
      .catch(() => this._sizeSets())
      .finally(() => {
        this.sizeSetsPromise = null;
      });

    return this.sizeSetsPromise;
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

  private resolveMediaUrl(url: string | null | undefined): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.apiBase}${value}`;
  }
}
