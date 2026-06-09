import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'cw-checkout-result',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './checkout-result.component.html',
  styleUrl: './checkout-result.component.scss',
})
export class CheckoutResultComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);

  readonly orderNumber = signal(this.route.snapshot.queryParamMap.get('order') || '');
  readonly reason = signal(this.route.snapshot.queryParamMap.get('reason') || '');
  readonly isPending = signal(this.route.snapshot.routeConfig?.path === 'checkout/pending');
  readonly t = (key: string): string => this.i18n.t(key);
}
