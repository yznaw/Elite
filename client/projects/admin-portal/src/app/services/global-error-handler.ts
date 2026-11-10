import { ErrorHandler, Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ClientLoggerService } from './client-logger.service';

/**
 * Catches everything Angular would otherwise only print to the console, and
 * ships it to the server (see client-logger.service.ts for why that matters on
 * a register sitting in the shop).
 *
 * Two deliberate behaviours:
 *
 * 1. **The console output is kept.** DevTools on the actual terminal is how
 *    three real hardware bugs were diagnosed during the 2026-07 sessions
 *    (QZ signing, the AsyncFunction detection, the receipt width). Replacing
 *    console logging with remote logging would have removed the tool that
 *    actually worked. This adds a second destination, it does not swap one.
 *
 * 2. **HTTP errors are skipped here.** `httpErrorInterceptor` already sees them
 *    with full request context and reports them itself; logging them in both
 *    places would double every API failure in the error list and corrupt the
 *    grouping counts.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly clientLogger = inject(ClientLoggerService);

  handleError(error: unknown): void {
    // Never let the handler itself throw: an exception raised inside
    // ErrorHandler.handleError is unrecoverable for the Angular app.
    try {
      console.error(error);
    } catch {
      /* console unavailable */
    }

    try {
      if (error instanceof HttpErrorResponse) return;
      if (this.clientLogger.isSuspended()) return;
      const source = location.pathname.startsWith('/pos') ? 'pos-client' : 'admin-client';
      this.clientLogger.logError(source, error, { code: 'UNCAUGHT_ERROR' });
    } catch {
      /* logging is best effort */
    }
  }
}

/**
 * Window-level handlers for what never reaches Angular's ErrorHandler: script
 * errors outside the zone, and rejected promises nobody awaited. Registered
 * once from main.ts.
 */
export function registerWindowErrorHandlers(clientLogger: ClientLoggerService): void {
  const source = () => (location.pathname.startsWith('/pos') ? 'pos-client' : 'admin-client');

  window.addEventListener('error', (event) => {
    try {
      if (clientLogger.isSuspended()) return;
      clientLogger.log({
        source: source(),
        severity: 'error',
        code: 'WINDOW_ERROR',
        message: event.message || 'Uncaught window error',
        stack: event.error?.stack ?? null,
        context: { filename: event.filename, line: event.lineno, column: event.colno },
      });
    } catch {
      /* best effort */
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      if (clientLogger.isSuspended()) return;
      const reason = event.reason as { message?: string; stack?: string } | undefined;
      clientLogger.log({
        source: source(),
        severity: 'error',
        code: 'UNHANDLED_REJECTION',
        message: reason?.message || String(event.reason || 'Unhandled promise rejection'),
        stack: reason?.stack ?? null,
      });
    } catch {
      /* best effort */
    }
  });

  // A tab being hidden or closed is the last chance to deliver what is
  // buffered; without this, a cashier closing the browser after a fault takes
  // the evidence with them.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void clientLogger.flush();
  });
  window.addEventListener('online', () => void clientLogger.flush());
}
