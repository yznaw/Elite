import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

/**
 * Restrict a child route after its parent's authGuard resolved the session.
 * For authentication and roles on the same route, use authenticatedRoleGuard:
 * putting authGuard and roleGuard in one canMatch array runs them concurrently.
 */
export function roleGuard(allowed: UserRole[]): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(...allowed)) return true;
    return router.createUrlTree(['/dashboard']);
  };
}
