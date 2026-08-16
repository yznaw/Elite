import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';
import { ClientLoggerService } from '../services/client-logger.service';

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
  const clientLogger = inject(ClientLoggerService);
  const t = (k: string) => i18n.t(k);

  // The log endpoint's own traffic must never be reported through the log
  // endpoint. Without this guard, one failing request becomes an endless
  // retry storm on a register (docs/24, Phase D).
  const isClientLogRequest = /\/api\/client-logs/.test(req.url);

  // The guard probes /auth/me on every navigation — a 401 there is the
  // normal "not logged in" signal, not an error worth toasting.
  const isAuthProbe = /\/api\/auth\/(me|login)$/.test(req.url);
  const isPosRequest = /\/api\/pos\//.test(req.url);
  const isRegisterProbe = /\/api\/pos\/registers\/current$/.test(req.url);
  // A wrong manager PIN returns 401 PIN_INVALID — this is a normal, expected
  // rejection (a cashier mistyping a manager's PIN), not a real session
  // expiry. Without this exception, every failed PIN attempt force-redirected
  // to /login and showed "Session expired," even though the session was
  // completely intact — confirmed during 2026-07-19 remote QA.
  const isManagerPinVerify = /\/api\/pos\/manager\/verify-pin$/.test(req.url);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // Ship the failure before any toast logic: this is the record that makes
      // a phone call from the shop diagnosable. Skipped for expected rejections
      // (a mistyped manager PIN, a "not logged in" probe, a register probe
      // before enrollment) so the error list stays signal, not noise.
      const isExpectedRejection = isAuthProbe || isManagerPinVerify
        || (err.status === 428 && isRegisterProbe)
        || err.status === 401 || err.status === 403 || err.status === 404;
      if (!isClientLogRequest && !isExpectedRejection && !clientLogger.isSuspended()) {
        clientLogger.log({
          source: isPosRequest ? 'pos-client' : 'admin-client',
          severity: err.status >= 500 || err.status === 0 ? 'error' : 'warn',
          code: err.error?.code || (err.status === 0 ? 'NETWORK_UNREACHABLE' : `HTTP_${err.status}`),
          message: err.error?.message || err.message || `Request failed with ${err.status}`,
          route: `${req.method} ${req.url}`,
          httpStatus: err.status,
          // The server puts its correlation id in the error body; reusing it
          // means the client entry and the server entry share one id.
          requestId: err.error?.requestId ?? null,
        });
      }

      // status 0 covers network failures, CORS blocks, DNS errors, and timeouts
      if (err.status === 0) {
        if (!isPosRequest) {
          toast.error(
            t('error.network.title'),
            t('error.network.sub'),
            { label: t('common.retry'), run: () => {} },
          );
        }
      } else if (err.status === 401) {
        const onLogin = router.url.startsWith('/login');
        if (isManagerPinVerify) {
          // Let pos.component.ts's own catch block show the specific
          // "Manager PIN is incorrect" / "temporarily locked" message instead
          // of the generic session-expired toast, and do not redirect.
        } else if (!isAuthProbe && !onLogin) {
          // Use error (not warning) so the banner is clearly visible.
          // The redirect to login carries the returnUrl so the admin
          // lands back on the same page after re-authenticating.
          toast.error(t('error.401.title'), t('error.401.sub'));
          router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
      } else if (err.status === 403) {
        // SELF_APPROVAL_BLOCKED also lands here. Its message names the actual
        // fix ("another manager has to approve this"), so the generic
        // permission-denied toast would only bury it under a second banner.
        if (!isManagerPinVerify) {
          // Every 403 this app raises already carries a specific, actionable
          // reason (e.g. "Only owners and admins can enroll POS terminals.",
          // "This POS register is disabled or revoked.") — showing the fixed
          // generic sub-text instead threw that away and left the operator
          // with no next step, which is exactly what a flat "Access denied"
          // toast on the POS enrollment screen looked like.
          toast.error(
            t('error.403.title'),
            err.error?.message || t('error.403.sub'),
          );
        }
      } else if (err.status === 404) {
        // Many 404s here name the exact thing that's missing (e.g. "No
        // active product uses barcode 6291041500213.") — worth more to a
        // cashier at a scanner than the fixed "resource not found" text.
        toast.warning(
          t('error.404.title'),
          err.error?.message || t('error.404.sub'),
        );
      } else if (err.status === 422) {
        const msg = err.error?.message || err.error?.error || '';
        toast.warning(
          t('error.422.title'),
          msg || t('error.422.sub'),
        );
      } else if (err.status === 413) {
        // A file/request that's too large can be rejected by our own body-size
        // check (JSON body with a friendly `message`) or, if a host-level proxy
        // blocks it first, with no parseable body at all — hence the fallback
        // to a fixed, simple explanation instead of a raw HTTP status line.
        toast.error(
          t('error.413.title'),
          err.error?.message || t('error.413.sub'),
        );
      } else if (err.status === 429) {
        toast.warning(
          t('error.429.title'),
          err.error?.message || t('error.429.sub'),
        );
      } else if (err.status >= 500) {
        toast.error(
          t('error.server.title'),
          t('error.server.sub'),
          { label: t('common.retry'), run: () => {} },
        );
      } else if (!(err.status === 428 && isRegisterProbe)) {
        // Prefer the backend's own friendly `message` (e.g. "Only CSV files are
        // accepted.") over the raw HTTP status line — the latter is only shown
        // when there's truly no parseable body to explain what happened.
        toast.error(
          t('error.unknown.title'),
          err.error?.message || `${err.status} — ${err.statusText || t('error.unknown.sub')}`,
        );
      }

      return throwError(() => err);
    }),
  );
};
