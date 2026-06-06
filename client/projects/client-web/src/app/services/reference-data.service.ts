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
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class ReferenceDataService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();
  private readonly cacheMs = 60 * 60_000;
  private readonly _colorHexByName = signal<Record<string, string>>({});
  private colorsPromise: Promise<Record<string, string>> | null = null;
  private colorsLoadedAt = 0;

  readonly colorHexByName = this._colorHexByName.asReadonly();

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
        this._colorHexByName.set(map);
        this.colorsLoadedAt = Date.now();
        return map;
      })
      .catch(() => this._colorHexByName())
      .finally(() => {
        this.colorsPromise = null;
      });

    return this.colorsPromise;
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
