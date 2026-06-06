import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

/** Standard envelope returned by the Express API. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Thin wrapper around HttpClient that:
 *   - resolves the API base URL once (localhost dev → :3000, prod → /api)
 *   - sends `withCredentials: true` on every request so the session cookie
 *     issued by Express is sent with admin API calls
 *   - unwraps the `{ success, data }` envelope to the inner `data`
 *
 * All admin services should compose this rather than calling HttpClient
 * directly, so behaviour stays consistent across the app.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = this.resolveApiBase();

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * Resolve a media/storage URL so it always routes through the API proxy.
   * `/uploads/abc.jpg` → `/api/uploads/abc.jpg` (production, same proxy)
   * `/uploads/abc.jpg` → `http://localhost:3000/api/uploads/abc.jpg` (dev)
   * Full https:// URLs are returned unchanged.
   */
  mediaUrl(path: string): string {
    const v = (path || '').trim();
    if (!v || /^(https?:|data:|blob:)/i.test(v)) return v;
    if (v.startsWith('/uploads/')) return this.url(v); // e.g. /api/uploads/abc.jpg
    return v;
  }

  get<T>(path: string): Observable<T> {
    return this.http
      .get<ApiEnvelope<T>>(this.url(path), { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<ApiEnvelope<T>>(this.url(path), body, { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .put<ApiEnvelope<T>>(this.url(path), body, { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .patch<ApiEnvelope<T>>(this.url(path), body, { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  delete<T>(path: string): Observable<T> {
    return this.http
      .delete<ApiEnvelope<T>>(this.url(path), { withCredentials: true })
      .pipe(map((res) => res.data));
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
