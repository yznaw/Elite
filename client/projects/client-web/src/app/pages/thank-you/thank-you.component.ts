import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../../core/api-base';
import { DestroyRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';
import { CartService } from '../../services/cart.service';

interface CustomerDelivery {id:string;status:string;trackingNumber?:string;trackingUrl?:string;items:{name:string;size?:string;quantity:number}[];}

@Component({
    selector: 'cw-thank-you',
    imports: [CommonModule, RouterLink],
    templateUrl: './thank-you.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './thank-you.component.scss'
})
export class ThankYouComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly cart = inject(CartService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE);
  private readonly destroy = inject(DestroyRef);
  readonly deliveries = signal<CustomerDelivery[]>([]);
  readonly deliveryError = signal(false);
  private async loadDeliveries(): Promise<void> {
    if (!this.orderNumber()) return;
    try {
      const response = await firstValueFrom(this.http.get<{data:{deliveries:CustomerDelivery[]}}>(`${this.apiBase}/payments/delivery-status/${encodeURIComponent(this.orderNumber())}`, {withCredentials:true}));
      this.deliveries.set(response.data.deliveries); this.deliveryError.set(false);
    } catch (error:any) { if(error?.status !== 404) this.deliveryError.set(true); }
  }

  readonly orderNumber = signal(this.route.snapshot.queryParamMap.get('order') || '');
  readonly t = (key: string): string => this.i18n.t(key);

  constructor() {
    this.cart.clear();
    // Payment confirmed — clear the back-navigation flag so the recovery screen
    // does not appear if the user navigates back to /checkout later.
    // Browser only: see checkout-result.component.ts for how a server-side
    // redirect into these pages made an unguarded call take down the render.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      sessionStorage.removeItem('elite_pending_order');
      void this.loadDeliveries();
      const timer = setInterval(() => { if(!this.deliveries().length || this.deliveries().some(s => !['delivered','cancelled','returned'].includes(s.status))) void this.loadDeliveries(); }, 30000);
      this.destroy.onDestroy(() => clearInterval(timer));
    }
  }
}
