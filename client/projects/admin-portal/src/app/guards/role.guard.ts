import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService, UserRole } from '../services/auth.service';

/**
 * Restrict a route to one or more roles. Composes with `authGuard`:
 *
 *   { path: 'settings', canMatch: [authGuard, roleGuard(['owner', 'admin'])], ... }
 */
export function roleGuard(allowed: UserRole[]): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(...allowed)) return true;
    return router.createUrlTree(['/dashboard']);
  };
}
