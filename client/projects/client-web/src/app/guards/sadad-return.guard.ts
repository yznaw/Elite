import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

function displayOrderId(value: string): string {
  const compact = value.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) return value;
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join('-');
}

/** Redirect Sadad's root-level Cancel return before the heavy Home page loads. */
export const sadadRootReturnGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const orderId = route.queryParamMap.get('order_id') || route.queryParamMap.get('ORDER_ID');
  if (!orderId) return true;

  return router.createUrlTree(['/checkout/failure'], {
    queryParams: {
      order: displayOrderId(orderId),
      reason: 'cancelled',
    },
  });
};
