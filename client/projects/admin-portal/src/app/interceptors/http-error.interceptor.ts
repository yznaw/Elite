import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { ToastService, markToastShown } from '../services/toast.service';
import { ConnectivityService } from '../services/connectivity.service';
import { I18nService } from '../services/i18n.service';
import { ClientLoggerService } from '../services/client-logger.service';

/**
 * Global HTTP error interceptor.
 * Shows one message per kind of failure, not one per request: identical
 * toasts collapse in ToastService (×N), and "can't reach the API" is owned by
 * ConnectivityService, which shows a single message and clears it when the
 * connection is back. Every error it surfaces is marked (markToastShown) so a
 * component's own catch can use toast.errorFrom/warningFrom and not repeat it.
 * Errors are re-thrown so individual components can still handle them.
 *
 * Status mapping:
 *   0   → Network / CORS issue
 *   401 → Session expired, except locally handled PIN/device rejections
 *   403 → Permission denied
 *   404 → Resource not found
 *   409 → Customer identifier conflict (server message)
 *   422 → Validation error
 *   429 → Rate limited
 *   500+ → Server error
 */
/**
 * Loop breaker. A redirect to /login only helps if signing in changes the
 * outcome; when it does not, the login page's own "already signed in" check
 * sends the operator straight back and the 401 fires again. One redirect per
 * window is enough to get a genuinely signed-out user to the form, and caps a
 * misclassified 401 at a single bounce instead of an endless one.
 */
let lastLoginRedirectAt = 0;
const LOGIN_REDIRECT_COOLDOWN_MS = 10_000;
const POS_REGISTER_REJECTED_EVENT = 'elite:pos-register-rejected';
function recentlyRedirectedToLogin(): boolean {
  return Date.now() - lastLoginRedirectAt < LOGIN_REDIRECT_COOLDOWN_MS;
}

/**
 * The one "session expired" path: toast, then /login with a returnUrl so the
 * operator lands back on the same page after signing in again. Shared with the
 * tab-resume session check (app.component.ts) so both honour one cooldown and
 * the toast never shows twice.
 */
export function sendToLoginAfterSessionExpiry(router: Router, toast: ToastService, i18n: I18nService): void {
  if (router.url.startsWith('/login') || recentlyRedirectedToLogin()) return;
  // Use error (not warning) so the banner is clearly visible.
  toast.error(i18n.t('error.401.title'), i18n.t('error.401.sub'));
  lastLoginRedirectAt = Date.now();
  void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
}

export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const i18n = inject(I18nService);
  const router = inject(Router);
  const clientLogger = inject(ClientLoggerService);
  const t = (k: string) => i18n.t(k);
  const connectivity = inject(ConnectivityService);

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
  // Binding a browser to a till is about the *register's* credentials, never
  // the operator's login. A 401 from these routes must not be read as an
  // expired session: /login bounces straight back to /pos while the session is
  // valid, so the pair looped forever and only clearing cookies escaped it.
  // The server now answers 409/403 here, and this is the second belt.
  const isRegisterBinding = /\/api\/pos\/registers\/(check-in|claim|enroll|release)$/.test(req.url);

  return next(req).pipe(
    // Any answer from the API proves it is reachable again.
    tap((event) => { if (event instanceof HttpResponse) connectivity.reportSuccess(); }),
    catchError((err: HttpErrorResponse) => {
      // Any HTTP status (even an error) also means the API answered.
      if (err.status !== 0) connectivity.reportSuccess();
      // Ship the failure before any toast logic: this is the record that makes
      // a phone call from the shop diagnosable. Skipped for expected rejections
      // (a mistyped manager PIN, a "not logged in" probe, a register probe
      // before enrollment) so the error list stays signal, not noise.
      const isExpectedRejection = isAuthProbe || isManagerPinVerify
        || (err.status === 428 && isRegisterProbe)
        // A stale register credential and a refused till takeover are both
        // normal outcomes of the picker, not incidents worth an error row.
        || (err.status === 409 && isRegisterBinding)
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

      // A register lease can be replaced while this tab is already on the
      // selling screen (for example, an owner deliberately moves the till to
      // another tablet). Initialization handles this case, but an already-open
      // tab also needs an immediate signal: stop accepting work and revalidate
      // its local identity. Register setup calls are excluded because their
      // component-level handlers already drive the picker and including them
      // here would create a recovery loop.
      const registerCode = err.error?.code;
      if (
        isPosRequest
        && !isRegisterProbe
        && !isRegisterBinding
        && [
          'REGISTER_CREDENTIAL_INVALID',
          'REGISTER_LEASE_INVALID',
          'REGISTER_NOT_FOUND',
          'REGISTER_DISABLED',
          'REGISTER_OUT_OF_BRANCH',
        ].includes(registerCode)
      ) {
        window.dispatchEvent(new CustomEvent(POS_REGISTER_REJECTED_EVENT, {
          detail: { code: registerCode, message: err.error?.message || '' },
        }));
      }

      // status 0 covers network failures, CORS blocks, DNS errors, and timeouts
      if (err.status === 0) {
        if (!isPosRequest) {
          connectivity.reportFailure();
          markToastShown(err);
        }
      } else if (err.status === 401) {
        if (isManagerPinVerify) {
          // Let pos.component.ts's own catch block show the specific
          // "Manager PIN is incorrect" / "temporarily locked" message instead
          // of the generic session-expired toast, and do not redirect.
        } else if (isRegisterBinding) {
          // Handled by pos.component.ts, which sends the cashier to the till
          // picker — the actual fix for a register that no longer matches.
        } else if (!isAuthProbe) {
          sendToLoginAfterSessionExpiry(router, toast, i18n);
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
      } else if (err.status === 409 && err.error?.code === 'CUSTOMER_IDENTIFIER_TAKEN') {
        // Create, edit, and undo-delete all use this interceptor. Keep the
        // server's actionable message, including the blocking customer on restore.
        toast.warning(t('error.422.title'), err.error.message);
      } else if (err.status === 422) {
        // validationError() (server/routes/lib.js) sends the real problems in
        // `errors` under a generic "Validation failed." message; show them.
        const list = Array.isArray(err.error?.errors) ? err.error.errors.filter(Boolean).join(' ') : '';
        const msg = list || err.error?.message || err.error?.error || '';
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
        // One message for however many requests failed at once. No Retry:
        // there is nothing it could safely re-send on the user's behalf.
        toast.push({ key: 'server-error', kind: 'error', title: t('error.server.title'), sub: t('error.server.sub') });
      } else if (!(err.status === 428 && isRegisterProbe)) {
        // Prefer the backend's own friendly `message` (e.g. "Only CSV files are
        // accepted.") over the raw HTTP status line — the latter is only shown
        // when there's truly no parseable body to explain what happened.
        toast.error(
          t('error.unknown.title'),
          err.error?.message || `${err.status} — ${err.statusText || t('error.unknown.sub')}`,
        );
      }

      // Everything above except silent cases (auth probe, handled 401s, a
      // mistyped PIN, the pre-enrollment 428) put a message on screen.
      const silent = (err.status === 401 && (isAuthProbe || isManagerPinVerify || isRegisterBinding))
        || (err.status === 403 && isManagerPinVerify)
        || (err.status === 428 && isRegisterProbe)
        || (err.status === 0 && isPosRequest);
      if (!silent) markToastShown(err);

      return throwError(() => err);
    }),
  );
};
