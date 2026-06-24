import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Block navigation to admin routes when no session exists.
 *
 * Uses `canMatch` so the guarded routes don't even load their lazy chunks
 * when the visitor isn't authenticated. We always re-check via `/api/auth/me`
 * so a stale cookie / cleared server session immediately bounces to /login.
 */
export const authGuard: CanMatchFn = async (_route, segments: UrlSegment[]) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // The POS shell must be restartable during an outage. This permits only the
  // locally cached identity to open /pos; every queued write is authenticated
  // and authorized again by the API when connectivity returns.
  if (!navigator.onLine && segments[0]?.path === 'pos' && auth.user()) return true;

  const user = await auth.me({ allowCachedOnNetworkError: segments[0]?.path === 'pos' });
  if (user) return true;

  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
};
