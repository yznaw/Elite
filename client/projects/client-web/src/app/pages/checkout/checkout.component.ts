import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { DeliveryQuote } from '../../services/checkout.service';
import { I18nService } from '../../services/i18n.service';

const STEPS = ['checkout.step.details', 'checkout.step.delivery', 'checkout.step.payment'] as const;

interface CheckoutForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

@Component({
  selector: 'cw-checkout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss',
})
export class CheckoutComponent {
  readonly cart = inject(CartService);
  private readonly checkoutApi = inject(CheckoutService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly steps = STEPS;
  readonly countries = ['Qatar', 'UAE', 'Kuwait', 'Saudi Arabia', 'Bahrain', 'Oman'];

  readonly step = signal(0);
  readonly placed = signal(false);
  readonly placedTotal = signal(0);
  readonly placing = signal(false);
  readonly quoteLoading = signal(false);
  readonly shippingQuote = signal<DeliveryQuote | null>(null);
  readonly error = signal('');
  readonly orderNumber = signal('');

  readonly form = signal<CheckoutForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: 'Qatar',
  });

  readonly subtotal = computed(() => this.cart.subtotal());
  readonly deliveryFee = computed(() => this.shippingQuote()?.amount || 0);
  readonly total = computed(() => (this.placed() ? this.placedTotal() : this.subtotal() + this.deliveryFee()));

  readonly t = (key: string): string => this.i18n.t(key);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly itemName = (item: { id: string; name: string }): string => this.i18n.productName(item);

  set<K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
    if (['phone', 'address', 'city', 'country'].includes(String(key))) {
      this.shippingQuote.set(null);
    }
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  async next(): Promise<void> {
    this.error.set('');
    if (!this.isCurrentStepValid()) {
      this.error.set(this.t(`checkout.error.step${this.step()}`));
      return;
    }

    if (this.step() === 1 && !(await this.ensureDeliveryQuote())) {
      return;
    }

    if (this.step() < STEPS.length - 1) {
      this.step.update((s) => s + 1);
    } else {
      await this.placeOrder();
    }
  }

  back(): void {
    this.error.set('');
    this.step.update((s) => Math.max(0, s - 1));
  }

  jumpTo(i: number): void {
    if (i < this.step()) this.step.set(i);
  }

  goCollection(): void {
    void this.router.navigate(['/collection']);
    window.scrollTo(0, 0);
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }

  countryLabel(country: string): string {
    const keys: Record<string, string> = {
      Qatar: 'checkout.country.qatar',
      UAE: 'checkout.country.uae',
      Kuwait: 'checkout.country.kuwait',
      'Saudi Arabia': 'checkout.country.saudi',
      Bahrain: 'checkout.country.bahrain',
      Oman: 'checkout.country.oman',
    };
    return this.t(keys[country] ?? country);
  }

  deliveryStatus(): string {
    if (this.quoteLoading()) return this.t('checkout.delivery.checking');
    const quote = this.shippingQuote();
    if (!quote) return this.t('checkout.delivery.prompt');
    if (!quote.available) return this.t('checkout.delivery.unavailable');
    const eta = quote.eta ? ` - ${quote.eta}` : '';
    return `${quote.serviceName || this.t('checkout.delivery.nbox')}${eta}`;
  }

  deliveryPrice(): string {
    if (this.quoteLoading()) return this.t('checkout.delivery.checkingShort');
    const quote = this.shippingQuote();
    if (!quote?.available) return this.t('checkout.delivery.pending');
    return quote.amount > 0 ? this.price(quote.amount) : this.t('checkout.delivery.free');
  }

  private async placeOrder(): Promise<void> {
    if (this.placing()) return;
    if (this.cart.items().length === 0) {
      this.error.set(this.t('checkout.error.empty'));
      return;
    }
    if (!(await this.ensureDeliveryQuote())) return;

    const form = this.form();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    this.placing.set(true);
    try {
      const order = await this.checkoutApi.createOrder({
        customer: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        },
        shippingAddress: {
          fullName,
          phone: form.phone.trim(),
          line1: form.address.trim(),
          city: form.city.trim(),
          country: form.country,
        },
        items: this.cart.items(),
        shippingQuote: this.shippingQuote()!,
      });

      this.placedTotal.set(order.total || this.total());
      this.orderNumber.set(order.id);
      this.placed.set(true);
      this.cart.clear();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      this.error.set(this.t('checkout.error.submit'));
    } finally {
      this.placing.set(false);
    }
  }

  private async ensureDeliveryQuote(): Promise<boolean> {
    const existing = this.shippingQuote();
    if (existing?.available) return true;
    if (this.quoteLoading()) return false;

    const form = this.form();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    this.quoteLoading.set(true);
    try {
      const quote = await this.checkoutApi.getDeliveryQuote({
        customer: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        },
        shippingAddress: {
          fullName,
          phone: form.phone.trim(),
          line1: form.address.trim(),
          city: form.city.trim(),
          country: form.country,
        },
        items: this.cart.items(),
      });
      this.shippingQuote.set(quote);
      if (!quote.available) {
        this.error.set(quote.message || this.t('checkout.error.deliveryUnavailable'));
        return false;
      }
      return true;
    } catch {
      this.shippingQuote.set(null);
      this.error.set(this.t('checkout.error.deliveryQuote'));
      return false;
    } finally {
      this.quoteLoading.set(false);
    }
  }

  private isCurrentStepValid(): boolean {
    if (this.cart.items().length === 0) return false;
    const form = this.form();
    if (this.step() === 0) {
      return Boolean(
        form.firstName.trim() &&
        form.lastName.trim() &&
        form.email.trim() &&
        form.phone.trim(),
      );
    }
    if (this.step() === 1) {
      return Boolean(form.address.trim() && form.city.trim() && form.country);
    }
    return true;
  }
}
