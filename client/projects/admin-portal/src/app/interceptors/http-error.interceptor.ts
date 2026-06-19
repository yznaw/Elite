import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';

/**
 * Global HTTP error interceptor.
 * Shows a toast for every failed HTTP request with contextual messaging
 * based on the status code. Errors are re-thrown so individual components
 * can still handle them if needed.
 *
 * Status mapping:
 *   0   → Network / CORS issue
 *   401 → Session expired (redirect to login when auth is added)
 *   403 → Permission denied
 *   404 → Resource not found
 *   422 → Validation error
 *   429 → Rate limited
 *   500+ → Server error
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const i18n = inject(I18nService);
  const router = inject(Router);
  const t = (k: string) => i18n.t(k);

  // The guard probes /auth/me on every navigation — a 401 there is the
  // normal "not logged in" signal, not an error worth toasting.
  const isAuthProbe = /\/api\/auth\/(me|login)$/.test(req.url);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // status 0 covers network failures, CORS blocks, DNS errors, and timeouts
      if (err.status === 0) {
        toast.error(
          t('error.network.title'),
          t('error.network.sub'),
          { label: t('common.retry'), run: () => {} },
        );
      } else if (err.status === 401) {
        const onLogin = router.url.startsWith('/login');
        if (!isAuthProbe && !onLogin) {
          // Use error (not warning) so the banner is clearly visible.
          // The redirect to login carries the returnUrl so the admin
          // lands back on the same page after re-authenticating.
          toast.error(t('error.401.title'), t('error.401.sub'));
          router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
      } else if (err.status === 403) {
        toast.error(
          t('error.403.title'),
          t('error.403.sub'),
        );
      } else if (err.status === 404) {
        toast.warning(
          t('error.404.title'),
          t('error.404.sub'),
        );
      } else if (err.status === 422) {
        const msg = err.error?.message || err.error?.error || '';
        toast.warning(
          t('error.422.title'),
          msg || t('error.422.sub'),
        );
      } else if (err.status === 429) {
        toast.warning(
          t('error.429.title'),
          t('error.429.sub'),
        );
      } else if (err.status >= 500) {
        toast.error(
          t('error.server.title'),
          t('error.server.sub'),
          { label: t('common.retry'), run: () => {} },
        );
      } else {
        toast.error(
          t('error.unknown.title'),
          `${err.status} — ${err.statusText || t('error.unknown.sub')}`,
        );
      }

      return throwError(() => err);
    }),
  );
};
