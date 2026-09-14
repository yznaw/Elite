import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CartService, StockShortage } from '../../services/cart.service';
import { CartItem } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';

@Component({
    selector: 'cw-cart-drawer',
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    @if (cart.isOpen()) {
      <div class="cart-overlay" (click)="onOverlayClick($event)">
        <div class="cart-drawer">
          <!-- Header -->
          <div style="padding: 28px 28px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-family: var(--ff-serif); font-size: 22px; font-weight: 400; color: var(--cream); letter-spacing: 0.04em;">{{ t('cart.title') }}</div>
              <div style="font-family: var(--ff-sans); font-size: 10px; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; margin-top: 2px;">
                {{ cart.items().length }} {{ cart.items().length === 1 ? t('cart.piece') : t('cart.pieces') }}
              </div>
            </div>
            <button (click)="cart.closeDrawer()" [attr.aria-label]="t('common.close')"
              style="background: none; border: 1px solid var(--border); width: 36px; height: 36px; cursor: pointer; color: var(--cream-dim); font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
          </div>

          <!-- Items -->
          <div style="flex: 1; overflow-y: auto; padding: 8px 0;">
            @if (cart.rejectedAdd(); as rejected) {
              <p role="alert" style="margin: 12px 28px 4px; padding: 12px 14px; border: 1px solid rgba(243, 167, 167, 0.45); font-family: var(--ff-sans); font-size: 12px; line-height: 1.5; color: #f3a7a7;">
                {{ rejectedMessage(rejected) }}
              </p>
            }
            @if (cart.items().length === 0) {
              <div style="padding: 60px 28px; text-align: center;">
                <div style="font-family: var(--ff-serif); font-size: 32px; font-style: italic; color: var(--muted); margin-bottom: 12px;">{{ t('cart.empty.title') }}</div>
                <p style="font-family: var(--ff-sans); font-size: 12px; color: var(--muted); letter-spacing: 0.06em;">
                  {{ t('cart.empty.sub') }}
                </p>
              </div>
            } @else {
              @for (item of cart.items(); track item.id + '-' + item.size + '-' + (item.variantId || item.color || ''); let idx = $index) {
                <div
                  style="padding: 20px 28px; border-bottom: 1px solid var(--border2); display: flex; gap: 16px; align-items: flex-start; animation: fadeUp 0.4s ease both;"
                  [style.animation-delay]="(idx * 0.06) + 's'"
                >
                  <div class="img-placeholder" style="width: 72px; height: 72px; flex-shrink: 0;">
                    <img [src]="item.image" [alt]="itemName(item)"
                      style="width: 100%; height: 100%; object-fit: cover; display: block; mix-blend-mode: luminosity; opacity: 0.9;"
                      (error)="onImgError($event)" />
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <div style="font-family: var(--ff-serif); font-size: 16px; color: var(--cream); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      {{ itemName(item) }}
                    </div>
                    <div style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px;">
                      {{ itemDetails(item) }}
                    </div>
                    @if (stockLabel(item); as label) {
                      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-family: var(--ff-sans); font-size: 11px; color: #f3a7a7;">
                        <span>{{ label }}</span>
                        @if (item.available) {
                          <button (click)="cart.setQty(item, item.available)"
                            style="background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: var(--cream); text-decoration: underline;">
                            {{ tp('cart.stock.changeTo', { count: item.available }) }}
                          </button>
                        }
                      </div>
                    }
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                      <span style="font-family: var(--ff-sans); font-size: 13px; color: var(--gold);">
                        {{ formatPrice(item.price * item.qty) }}
                      </span>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-family: var(--ff-sans); font-size: 12px; color: var(--cream-dim);">
                          {{ t('cart.qty') }} {{ item.qty }}
                        </span>
                        <button (click)="cart.remove(item.id, item.size, item.variantId, item.color)"
                          style="background: none; border: none; cursor: pointer; color: var(--muted); font-size: 12px; padding: 2px 6px; transition: color 0.2s;">
                          {{ t('cart.remove') }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              }
            }
          </div>

          <!-- Footer -->
          @if (cart.items().length > 0) {
            <div style="border-top: 1px solid var(--border); padding: 20px 28px 28px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-family: var(--ff-sans); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);">{{ t('cart.subtotal') }}</span>
                <span style="font-family: var(--ff-serif); font-size: 18px; color: var(--cream);">{{ formatPrice(cart.subtotal()) }}</span>
              </div>
              <div style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em; margin-bottom: 20px;">
                {{ t('cart.dutiesIncluded') }}
              </div>

              <div class="divider" style="margin-bottom: 20px;"></div>

              <button class="btn-gold" (click)="goToCheckout()" data-track="cart-checkout"
                style="width: 100%; padding: 16px; font-size: 11px; letter-spacing: 0.16em;">
                {{ t('cart.proceedToCheckout') }}
              </button>

              <button (click)="cart.closeDrawer()"
                style="width: 100%; margin-top: 10px; padding: 12px; background: none; border: none; cursor: pointer; font-family: var(--ff-sans); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); transition: color 0.2s;">
                {{ t('common.continueBrowsing') }}
              </button>

              <div style="margin-top: 20px; display: flex; justify-content: center; gap: 24px;">
                @for (signalKey of trustSignals; track signalKey) {
                  <span style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.08em; color: var(--muted); text-align: center;">{{ t(signalKey) }}</span>
                }
              </div>
            </div>
          }
        </div>
      </div>
    }
  `
})
export class CartDrawerComponent {
  readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly t = (key: string): string => this.i18n.t(key);
  readonly tp = (key: string, params: Record<string, string | number>): string => this.i18n.t(key, params);
  readonly trustSignals = ['cart.trust.shipping', 'cart.trust.secure', 'cart.trust.returns'];

  onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.cart.closeDrawer();
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }

  stockLabel(item: CartItem): string {
    if (item.available == null || item.qty <= item.available) return '';
    return item.available === 0
      ? this.t('cart.stock.soldOut')
      : this.tp('cart.stock.onlyLeft', { count: item.available });
  }

  rejectedMessage(r: StockShortage): string {
    const params = { name: this.itemName({ id: '', name: r.name }), size: r.size ?? '', count: r.available, inBag: r.inBag ?? 0 };
    return r.available === 0 ? this.tp('cart.stock.addSoldOut', params) : this.tp('cart.stock.addLimit', params);
  }

  goToCheckout(): void {
    this.cart.closeDrawer();
    void this.router.navigate(['/checkout']);
    window.scrollTo(0, 0);
  }

  formatPrice(n: number): string {
    return this.i18n.price(n);
  }

  itemName(item: { id: string; name: string }): string {
    return this.i18n.productName(item);
  }

  leather(value: string): string {
    return this.i18n.productLeather(value);
  }

  itemDetails(item: { size: number; color?: string | null; leather: string }): string {
    return [
      `${this.t('cart.size')} ${item.size}`,
      item.color,
      this.leather(item.leather),
    ].filter(Boolean).join(' · ');
  }
}
