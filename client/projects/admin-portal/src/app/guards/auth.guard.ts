import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

/**
 * Block navigation to admin routes when no session exists.
 *
 * Uses `canMatch` so the guarded routes don't even load their lazy chunks
 * when the visitor isn't authenticated. We always re-check via `/api/auth/me`
 * so a stale cookie / cleared server session immediately bounces to /login.
 */
function createAuthGuard(allowedRoles?: readonly UserRole[]): CanMatchFn {
  return async (_route, segments: UrlSegment[]) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const isPos = segments[0]?.path === 'pos';

    // Only POS may resume a cached identity during an outage. Role checks
    // still apply, and every queued write is authorized again by the API.
    const cachedUser = auth.user();
    const user = !navigator.onLine && isPos && cachedUser
      ? cachedUser
      : await auth.me({ allowCachedOnNetworkError: isPos });

    if (!user) {
      const returnUrl = '/' + segments.map((s) => s.path).join('/');
      return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      return router.createUrlTree(['/dashboard']);
    }
    return true;
  };
}

export const authGuard = createAuthGuard();

/**
 * Resolve the session before checking its role. Separate canMatch guards run
 * concurrently, so [authGuard, roleGuard(...)] can reject an uncached user
 * before /auth/me returns, or authorize using a stale cached role.
 */
export function authenticatedRoleGuard(allowedRoles: readonly UserRole[]): CanMatchFn {
  return createAuthGuard(allowedRoles);
}
