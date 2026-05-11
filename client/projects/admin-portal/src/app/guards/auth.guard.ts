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

  const user = await auth.me();
  if (user) return true;

  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
};
