import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'cw-cart-drawer',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (cart.isOpen()) {
      <div class="cart-overlay" (click)="onOverlayClick($event)">
        <div class="cart-drawer">
          <!-- Header -->
          <div style="padding: 28px 28px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-family: var(--ff-serif); font-size: 22px; font-weight: 400; color: var(--cream); letter-spacing: 0.04em;">Your Selection</div>
              <div style="font-family: var(--ff-sans); font-size: 10px; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; margin-top: 2px;">
                {{ cart.items().length }} {{ cart.items().length === 1 ? 'piece' : 'pieces' }} reserved
              </div>
            </div>
            <button (click)="cart.closeDrawer()" aria-label="Close cart"
              style="background: none; border: 1px solid var(--border); width: 36px; height: 36px; cursor: pointer; color: var(--cream-dim); font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
          </div>

          <!-- Items -->
          <div style="flex: 1; overflow-y: auto; padding: 8px 0;">
            @if (cart.items().length === 0) {
              <div style="padding: 60px 28px; text-align: center;">
                <div style="font-family: var(--ff-serif); font-size: 32px; font-style: italic; color: var(--muted); margin-bottom: 12px;">Empty</div>
                <p style="font-family: var(--ff-sans); font-size: 12px; color: var(--muted); letter-spacing: 0.06em;">
                  Your curated collection awaits
                </p>
              </div>
            } @else {
              @for (item of cart.items(); track item.id + '-' + item.size; let idx = $index) {
                <div
                  style="padding: 20px 28px; border-bottom: 1px solid var(--border2); display: flex; gap: 16px; align-items: flex-start; animation: fadeUp 0.4s ease both;"
                  [style.animation-delay]="(idx * 0.06) + 's'"
                >
                  <div class="img-placeholder" style="width: 72px; height: 72px; flex-shrink: 0;">
                    <img [src]="item.image" [alt]="item.name"
                      style="width: 100%; height: 100%; object-fit: cover; display: block; mix-blend-mode: luminosity; opacity: 0.9;"
                      (error)="onImgError($event)" />
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <div style="font-family: var(--ff-serif); font-size: 16px; color: var(--cream); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      {{ item.name }}
                    </div>
                    <div style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px;">
                      Size {{ item.size }} · {{ item.leather }}
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                      <span style="font-family: var(--ff-sans); font-size: 13px; color: var(--gold);">
                        {{ formatPrice(item.price * item.qty) }}
                      </span>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-family: var(--ff-sans); font-size: 12px; color: var(--cream-dim);">
                          Qty {{ item.qty }}
                        </span>
                        <button (click)="cart.remove(item.id, item.size)"
                          style="background: none; border: none; cursor: pointer; color: var(--muted); font-size: 12px; padding: 2px 6px; transition: color 0.2s;">
                          Remove
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
                <span style="font-family: var(--ff-sans); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);">Subtotal</span>
                <span style="font-family: var(--ff-serif); font-size: 18px; color: var(--cream);">{{ formatPrice(cart.subtotal()) }}</span>
              </div>
              <div style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em; margin-bottom: 20px;">
                Duties & bespoke packaging included
              </div>

              <div class="divider" style="margin-bottom: 20px;"></div>

              <button class="btn-gold" (click)="goToCheckout()"
                style="width: 100%; padding: 16px; font-size: 11px; letter-spacing: 0.16em;">
                Proceed to Checkout
              </button>

              <button (click)="cart.closeDrawer()"
                style="width: 100%; margin-top: 10px; padding: 12px; background: none; border: none; cursor: pointer; font-family: var(--ff-sans); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); transition: color 0.2s;">
                Continue Browsing
              </button>

              <div style="margin-top: 20px; display: flex; justify-content: center; gap: 24px;">
                @for (t of trustSignals; track t) {
                  <span style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.08em; color: var(--muted); text-align: center;">{{ t }}</span>
                }
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class CartDrawerComponent {
  readonly cart = inject(CartService);
  private readonly router = inject(Router);

  readonly trustSignals = ['Complimentary Shipping', 'Secure Checkout', 'Returns 30D'];

  onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.cart.closeDrawer();
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }

  goToCheckout(): void {
    this.cart.closeDrawer();
    void this.router.navigate(['/checkout']);
    window.scrollTo(0, 0);
  }

  formatPrice(n: number): string {
    return 'SAR ' + n.toLocaleString('en-SA');
  }
}
