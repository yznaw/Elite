import { HttpInterceptorFn } from '@angular/common/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_COOKIE = 'elite.csrf';
const TOKEN_HEADER = 'X-CSRF-Token';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Mirrors the readable `elite.csrf` cookie (set by the server's double-submit
 * CSRF middleware, server/middleware/csrf.js) into the X-CSRF-Token header on
 * mutating requests. A cross-site attacker can trigger the request but can't
 * read the cookie to copy its value, so this proves the request came from
 * this origin's JS.
 */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next(req);

  const token = readCookie(TOKEN_COOKIE);
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { [TOKEN_HEADER]: token } }));
};
