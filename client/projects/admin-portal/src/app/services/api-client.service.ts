import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, retry, timer } from 'rxjs';

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
 *   - GET requests: automatic retry ×2 with exponential back-off (500ms, 1000ms)
 *     for transient network errors (status 0, 502, 503, 504)
 *
 * Mutating requests (POST/PATCH/PUT/DELETE) are NOT auto-retried — use
 * idempotency keys on the server side for those.
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
    if (v.startsWith('/uploads/')) return this.url(v);
    return v;
  }

  get<T>(path: string): Observable<T> {
    return this.http
      .get<ApiEnvelope<T>>(this.url(path), { withCredentials: true })
      .pipe(
        // Retry transient errors (network drop, gateway timeout) with back-off.
        // 401/403/404/422 are not retried — they are deterministic failures.
        retry({
          count: 2,
          delay: (err, index) => {
            const retryable = err?.status === 0 || err?.status === 502 || err?.status === 503 || err?.status === 504;
            if (!retryable) throw err;
            return timer(Math.pow(2, index) * 500); // 500ms, 1000ms
          },
          resetOnSuccess: true,
        }),
        map((res) => res.data),
      );
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
