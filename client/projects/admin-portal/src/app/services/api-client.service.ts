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
