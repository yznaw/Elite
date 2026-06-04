import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Wrapper around localStorage that namespaces every key under the current
 * tenant's ID, preventing cross-tenant data bleed in shared browsers.
 *
 * Falls back to `'local'` before a user is authenticated so the portal
 * remains functional during the login flow.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly auth = inject(AuthService);

  /** Returns the fully-qualified tenant-scoped storage key. */
  key(base: string): string {
    const tid = this.auth.user()?.tenantId ?? 'local';
    return `elite:${tid}:${base}`;
  }

  get(base: string): string | null {
    try { return localStorage.getItem(this.key(base)); } catch { return null; }
  }

  set(base: string, value: string): void {
    try { localStorage.setItem(this.key(base), value); } catch {}
  }

  remove(base: string): void {
    try { localStorage.removeItem(this.key(base)); } catch {}
  }
}
