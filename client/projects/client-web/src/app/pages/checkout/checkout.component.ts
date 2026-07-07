import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CartService } from '../../services/cart.service';
import { CheckoutService } from '../../services/checkout.service';
import { DeliveryQuote } from '../../services/checkout.service';
import { PaymentService } from '../../services/payment.service';
import { I18nService } from '../../services/i18n.service';

// Written just before the browser is sent to Sadad. On Back, ngOnInit reads
// this and silently resumes the checkout at the Payment step.
const PENDING_ORDER_KEY  = 'elite_pending_order';
// Persists the form data across the Sadad redirect so it can be restored after
// a bfcache reload. Cleared together with PENDING_ORDER_KEY on resume.
const PENDING_FORM_KEY   = 'elite_pending_form';
const PENDING_QUOTE_KEY  = 'elite_pending_quote';

const STEPS = ['checkout.step.details', 'checkout.step.delivery', 'checkout.step.payment'] as const;

interface CheckoutForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  zone: string;
  street: string;
  building: string;
  additionalDetails: string;
  city: string;
  country: string;
}

type CustomerField = 'firstName' | 'lastName' | 'email' | 'phone';
type DeliveryField = 'zone' | 'street' | 'building' | 'city';

@Component({
  selector: 'cw-checkout',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss',
})
export class CheckoutComponent implements OnInit, OnDestroy {
  readonly cart = inject(CartService);
  private readonly checkoutApi = inject(CheckoutService);
  private readonly paymentService = inject(PaymentService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);

  readonly termsHandle   = signal<string | null>(null);
  readonly privacyHandle = signal<string | null>(null);


  // Stable idempotency key for the current checkout attempt. Generated lazily on
  // the first placeOrder() call and reused on retries, so a double-tap or retry
  // returns the same order instead of creating a duplicate. Cleared after a
  // successful order so the next checkout gets a fresh key.
  private idempotencyKey: string | null = null;

  private get apiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  // Bound reference so we can add AND remove the same listener.
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    // event.persisted is true when the page is restored from the bfcache —
    // e.g. the user hit Back from the Sadad payment page. ngOnInit does NOT
    // run, and Angular's change detection does not re-run on frozen signals
    // (redirecting, shippingQuote, etc. are all stale). Force a clean reload
    // so ngOnInit runs fresh and silentResume() works correctly.
    if (event.persisted && sessionStorage.getItem(PENDING_ORDER_KEY)) {
      window.location.reload();
    }
  };

  // If the user hit Back from Sadad, silently put them back at the Payment step.
  // Called from ngOnInit (normal navigation) — bfcache case triggers a reload
  // so ngOnInit always runs fresh here.
  private silentResume(): void {
    const pendingId = sessionStorage.getItem(PENDING_ORDER_KEY);
    if (!pendingId) return;

    // Restore form data so the delivery quote re-fetch has all required fields.
    try {
      const savedForm = sessionStorage.getItem(PENDING_FORM_KEY);
      if (savedForm) this.form.set(JSON.parse(savedForm));

      const savedQuote = sessionStorage.getItem(PENDING_QUOTE_KEY);
      if (savedQuote) {
        const q = JSON.parse(savedQuote);
        this.shippingQuote.set(q);
        this.quotedDeliveryKey = this.deliveryQuoteKey(this.form(), this.cart.items());
      }
    } catch { /* ignore — form stays at defaults */ }

    sessionStorage.removeItem(PENDING_ORDER_KEY);
    sessionStorage.removeItem(PENDING_FORM_KEY);
    sessionStorage.removeItem(PENDING_QUOTE_KEY);
    this.redirecting.set(false);
    this.placing.set(false);
    this.step.set(2);
    window.scrollTo(0, 0);
  }

  ngOnDestroy(): void {
    window.removeEventListener('pageshow', this.onPageShow);
  }

  async ngOnInit(): Promise<void> {
    // Covers the normal navigation case (fresh load / SPA route).
    this.silentResume();
    // Covers the bfcache case (browser Back from Sadad restores a frozen page).
    window.addEventListener('pageshow', this.onPageShow);

    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: { handle: string; policyType: string }[] }>(`${this.apiBase}/policies`),
      );
      for (const p of (res.data ?? [])) {
        if (p.policyType === 'terms_of_service') this.termsHandle.set(p.handle);
        if (p.policyType === 'privacy_policy')   this.privacyHandle.set(p.handle);
      }
    } catch {
      // keep signals null — fallback to plain text
    }
  }

  readonly steps = STEPS;
  readonly countries = ['Qatar'];

  readonly step = signal(0);
  readonly placed = signal(false);
  readonly placedTotal = signal(0);
  readonly placing = signal(false);
  readonly redirecting = signal(false);
  readonly quoteLoading = signal(false);
  readonly shippingQuote = signal<DeliveryQuote | null>(null);
  readonly error = signal('');
  readonly orderNumber = signal('');

  private quoteRequestVersion = 0;
  private quotedDeliveryKey = '';

  readonly form = signal<CheckoutForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    zone: '',
    street: '',
    building: '',
    additionalDetails: '',
    city: '',
    country: 'Qatar',
  });

  readonly touched = signal<Record<CustomerField, boolean>>({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
  });

  readonly deliveryTouched = signal<Record<DeliveryField, boolean>>({
    zone: false,
    street: false,
    building: false,
    city: false,
  });

  readonly subtotal = computed(() => this.cart.subtotal());
  readonly deliveryFee = computed(() => this.shippingQuote()?.amount || 0);
  readonly total = computed(() => (this.placed() ? this.placedTotal() : this.subtotal() + this.deliveryFee()));

  constructor() {
    effect((onCleanup) => {
      const currentStep = this.step();
      const form = this.form();
      const items = this.cart.items();
      const requestVersion = ++this.quoteRequestVersion;

      if (currentStep !== 1 || !this.canRequestDeliveryQuote(form, items.length)) {
        this.quoteLoading.set(false);
        return;
      }

      const deliveryKey = this.deliveryQuoteKey(form, items);
      if (deliveryKey === this.quotedDeliveryKey) return;

      this.quoteLoading.set(true);
      const timer = window.setTimeout(() => {
        void this.requestDeliveryQuote(deliveryKey, requestVersion);
      }, 700);

      onCleanup(() => window.clearTimeout(timer));
    }, { allowSignalWrites: true });
  }

  readonly t = (key: string): string => this.i18n.t(key);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly itemName = (item: { id: string; name: string }): string => this.i18n.productName(item);

  itemDetails(item: { size: number; color?: string | null }): string {
    return [
      `${this.t('cart.size')} ${item.size}`,
      item.color,
    ].filter(Boolean).join(' · ');
  }

  set<K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
    if (['phone', 'address', 'zone', 'street', 'building', 'city', 'country'].includes(String(key))) {
      this.quoteRequestVersion += 1;
      this.quotedDeliveryKey = '';
      this.shippingQuote.set(null);
      this.error.set('');
    }
    // Any field change invalidates the pending order — a different submission
    // must create a new order, not return the old one via idempotency dedup.
    this.idempotencyKey = null;
  }

  markTouched(field: CustomerField): void {
    this.touched.update((current) => ({ ...current, [field]: true }));
  }

  showFieldError(field: CustomerField): boolean {
    return this.touched()[field] && !this.isCustomerFieldValid(field);
  }

  markDeliveryTouched(field: DeliveryField): void {
    this.deliveryTouched.update((current) => ({ ...current, [field]: true }));
  }

  showDeliveryFieldError(field: DeliveryField): boolean {
    return this.deliveryTouched()[field] && !this.isDeliveryFieldValid(field);
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
      if (this.step() === 0) {
        this.touched.set({ firstName: true, lastName: true, email: true, phone: true });
      } else if (this.step() === 1) {
        this.deliveryTouched.set({ zone: true, street: true, building: true, city: true });
      }
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
    // Going back means the user may change details — reset the key so the next
    // Place Order creates a fresh order instead of returning the old one.
    this.idempotencyKey = null;
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

  private newIdempotencyKey(): string {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `co-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private async placeOrder(): Promise<void> {
    if (this.placing() || this.redirecting()) return;
    if (this.cart.items().length === 0) {
      this.error.set(this.t('checkout.error.empty'));
      return;
    }
    if (!(await this.ensureDeliveryQuote())) return;

    const form = this.form();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();

    // Reuse the key across retries; only mint a new one if none exists yet.
    if (!this.idempotencyKey) {
      this.idempotencyKey = this.newIdempotencyKey();
    }

    // ── Step 1: Create the order (payment_status = pending) ───────────────
    this.placing.set(true);
    let orderId: string;
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
          line1: this.deliveryLine1(form),
          zone: form.zone.trim(),
          street: form.street.trim(),
          building: form.building.trim(),
          additionalDetails: form.additionalDetails.trim(),
          city: form.city.trim(),
          country: form.country,
        },
        items: this.cart.items(),
        shippingQuote: this.shippingQuote()!,
        idempotencyKey: this.idempotencyKey,
      });
      orderId = order.id; // UUID for payment gateway
    } catch {
      this.error.set(this.t('checkout.error.submit'));
      this.placing.set(false);
      return;
    }
    this.placing.set(false);

    // ── Step 2: Redirect to Sadad payment page ────────────────────────────
    // Persist state before navigation so silentResume() can restore it on Back.
    sessionStorage.setItem(PENDING_ORDER_KEY, orderId);
    sessionStorage.setItem(PENDING_FORM_KEY, JSON.stringify(this.form()));
    const quote = this.shippingQuote();
    if (quote) sessionStorage.setItem(PENDING_QUOTE_KEY, JSON.stringify(quote));
    this.redirecting.set(true);
    try {
      // This call builds a hidden form and submits it — browser navigates away.
      await this.paymentService.redirectToSadadCheckout(orderId);
    } catch {
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      sessionStorage.removeItem(PENDING_FORM_KEY);
      sessionStorage.removeItem(PENDING_QUOTE_KEY);
      this.redirecting.set(false);
      this.error.set(this.t('checkout.error.payment'));
    }
  }

  private async ensureDeliveryQuote(): Promise<boolean> {
    const existing = this.shippingQuote();
    const deliveryKey = this.deliveryQuoteKey(this.form(), this.cart.items());
    if (existing?.available && deliveryKey === this.quotedDeliveryKey) return true;
    if (this.quoteLoading()) return false;

    const requestVersion = ++this.quoteRequestVersion;
    this.quoteLoading.set(true);
    return this.requestDeliveryQuote(deliveryKey, requestVersion);
  }

  private async requestDeliveryQuote(deliveryKey: string, requestVersion: number): Promise<boolean> {
    if (requestVersion !== this.quoteRequestVersion) return false;
    const form = this.form();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
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
          line1: this.deliveryLine1(form),
          zone: form.zone.trim(),
          street: form.street.trim(),
          building: form.building.trim(),
          additionalDetails: form.additionalDetails.trim(),
          city: form.city.trim(),
          country: form.country,
        },
        items: this.cart.items(),
      });

      if (requestVersion !== this.quoteRequestVersion) return false;
      this.quotedDeliveryKey = deliveryKey;
      this.shippingQuote.set(quote);
      if (!quote.available) {
        this.error.set(quote.message || this.t('checkout.error.deliveryUnavailable'));
        return false;
      }
      this.error.set('');
      return true;
    } catch {
      if (requestVersion !== this.quoteRequestVersion) return false;
      this.shippingQuote.set(null);
      this.error.set(this.t('checkout.error.deliveryQuote'));
      return false;
    } finally {
      if (requestVersion === this.quoteRequestVersion) this.quoteLoading.set(false);
    }
  }

  isCurrentStepValid(): boolean {
    if (this.cart.items().length === 0) return false;
    const form = this.form();
    if (this.step() === 0) {
      return this.isCustomerFieldValid('firstName')
        && this.isCustomerFieldValid('lastName')
        && this.isCustomerFieldValid('email')
        && this.isCustomerFieldValid('phone');
    }
    if (this.step() === 1) {
      return this.isDeliveryFieldValid('zone')
        && this.isDeliveryFieldValid('street')
        && this.isDeliveryFieldValid('building')
        && this.isDeliveryFieldValid('city')
        && Boolean(form.country);
    }
    return true;
  }

  private isCustomerFieldValid(field: CustomerField): boolean {
    const value = this.form()[field];
    if (field === 'firstName' || field === 'lastName') return this.isValidName(value);
    if (field === 'email') return this.isValidEmail(value);
    return this.isValidQatarPhone(value);
  }

  private isDeliveryFieldValid(field: DeliveryField): boolean {
    return Boolean(this.form()[field].trim());
  }

  private isValidName(value: string): boolean {
    const name = value.trim();
    const letterCount = name.match(/\p{L}/gu)?.length ?? 0;
    return letterCount >= 2 && /^[\p{L}\p{M}][\p{L}\p{M}'’ -]*$/u.test(name);
  }

  private isValidEmail(value: string): boolean {
    const email = value.trim();
    if (!email || email.length > 254 || email.includes('..')) return false;
    return /^[^\s@.]+(?:\.[^\s@.]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email);
  }

  private isValidQatarPhone(value: string): boolean {
    const normalized = value
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[\s().-]/g, '');
    return /^(?:\+974|00974|974)?[3-7]\d{7}$/.test(normalized);
  }

  private canRequestDeliveryQuote(form: CheckoutForm, itemCount: number): boolean {
    return itemCount > 0
      && this.isCustomerFieldValid('firstName')
      && this.isCustomerFieldValid('lastName')
      && this.isCustomerFieldValid('phone')
      && Boolean(
        form.zone.trim()
        && form.street.trim()
        && form.building.trim()
        && form.city.trim()
        && form.country,
      );
  }

  private deliveryLine1(form: CheckoutForm): string {
    if (form.address.trim()) return form.address.trim();
    return [
      `Zone ${form.zone.trim()}`,
      `Street ${form.street.trim()}`,
      `Building ${form.building.trim()}`,
    ].join(', ');
  }

  private deliveryQuoteKey(form: CheckoutForm, items: ReadonlyArray<{ id: string; variantId?: string; size: number; qty: number }>): string {
    return JSON.stringify({
      customer: [form.firstName.trim(), form.lastName.trim(), form.phone.trim()],
      address: [
        this.deliveryLine1(form),
        form.city.trim(),
        form.country,
      ],
      items: items.map((item) => [item.id, item.variantId || '', item.size, item.qty]),
    });
  }
}
