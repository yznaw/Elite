import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiClient } from './api-client.service';

export type UserRole = 'owner' | 'admin' | 'manager' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: UserRole;
  tenantId: string;
  tenantSlug: string | null;
}

const STORAGE_KEY = 'elite-admin:auth-user';

/**
 * Owns the admin-portal authentication state.
 *
 * Persistence is server-side: the session cookie issued by Express survives
 * page reloads. We mirror the resolved user into a signal (and localStorage)
 * so the shell can render it instantly on a fresh tab while `me()` revalidates.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);

  private readonly _user = signal<AuthUser | null>(this.readCachedUser());
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly role = computed<UserRole | null>(() => this._user()?.role ?? null);

  /** Hit `/api/auth/me`. Returns the user on success, `null` on 401. */
  me(options: { allowCachedOnNetworkError?: boolean } = {}): Promise<AuthUser | null> {
    const cachedUser = this._user();
    return firstValueFrom(
      this.api.get<AuthUser>('/auth/me').pipe(
        map((u) => {
          this.setUser(u);
          return u;
        }),
        catchError((error: { status?: number }) => {
          if (options.allowCachedOnNetworkError && error?.status === 0 && cachedUser) {
            return of(cachedUser);
          }
          this.setUser(null);
          return of(null);
        }),
      ),
    );
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const user = await firstValueFrom(
      this.api.post<AuthUser>('/auth/login', { email, password }),
    );
    this.setUser(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.post<{ success: true }>('/auth/logout', {}));
    } finally {
      this.setUser(null);
    }
  }

  /** Always succeeds at the API level (no account-existence leak). The
      server logs the reset URL to its console in dev. */
  forgotPassword(email: string): Promise<void> {
    return firstValueFrom(this.api.post<{ sent: true }>('/auth/forgot', { email }))
      .then(() => undefined);
  }

  resetPassword(token: string, password: string): Promise<void> {
    return firstValueFrom(this.api.post<{ reset: true }>('/auth/reset', { token, password }))
      .then(() => undefined);
  }

  hasRole(...roles: UserRole[]): boolean {
    const r = this._user()?.role;
    return !!r && roles.includes(r);
  }

  private setUser(user: AuthUser | null): void {
    this._user.set(user);
    try {
      if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode etc.) — signal is the source of truth.
    }
  }

  private readCachedUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }
}
