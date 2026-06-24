import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'cw-thank-you',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './thank-you.component.html',
  styleUrl: './thank-you.component.scss',
})
export class ThankYouComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly cart = inject(CartService);

  readonly orderNumber = signal(this.route.snapshot.queryParamMap.get('order') || '');
  readonly t = (key: string): string => this.i18n.t(key);

  constructor() {
    this.cart.clear();
  }
}
