import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';

@Component({
    selector: 'cw-checkout-result',
    imports: [CommonModule, RouterLink],
    templateUrl: './checkout-result.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './checkout-result.component.scss'
})
export class CheckoutResultComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);

  readonly orderNumber = signal(this.route.snapshot.queryParamMap.get('order') || '');
  readonly reason = signal(this.route.snapshot.queryParamMap.get('reason') || '');
  readonly isPending = signal(this.route.snapshot.routeConfig?.path === 'checkout/pending');
  readonly isCancelled = signal(this.reason() === 'cancelled');
  readonly t = (key: string): string => this.i18n.t(key);

  constructor() {
    // Payment completed (success or failure) — clear the back-navigation flag
    // so the recovery screen does not appear if the user navigates back later.
    //
    // Browser only. Sadad's cancel return lands on `/?order_id=…`, which is
    // server-rendered, and its guard redirects here, so this constructor also
    // runs during that server render. Node 22 has no `sessionStorage`; the
    // ReferenceError failed the whole navigation and the customer got a bare
    // "Cannot GET /" instead of this page.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      sessionStorage.removeItem('elite_pending_order');
    }
  }
}
