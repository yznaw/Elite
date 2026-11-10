import { Component, OnDestroy, OnInit, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CartService, stockShortages } from '../../services/cart.service';
import { CartItem } from '../../models/product.model';
import { CheckoutService } from '../../services/checkout.service';
import { DeliveryQuote } from '../../services/checkout.service';
import { PaymentService } from '../../services/payment.service';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { API_BASE } from '../../core/api-base';

// Written just before the browser is sent to Sadad. On Back, ngOnInit reads
// this and silently resumes the checkout at the Payment step.
const PENDING_ORDER_KEY  = 'elite_pending_order';
// Persists the form data across the Sadad redirect so it can be restored after
// a bfcache reload. Cleared together with PENDING_ORDER_KEY on resume.
const PENDING_FORM_KEY   = 'elite_pending_form';
const PENDING_QUOTE_KEY  = 'elite_pending_quote';
const CHECKOUT_COUNTRIES_KEY = 'elite_checkout_countries';

const STEPS = ['checkout.step.details', 'checkout.step.delivery', 'checkout.step.payment'] as const;
const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

const CALLING_CODE_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['+1', 'AG AI AS BB BM BS CA DM DO GD GU JM KN KY LC MP MS PR SX TC TT VC VG VI UM US'],
  ['+7', 'KZ RU'], ['+20', 'EG'], ['+27', 'ZA'], ['+30', 'GR'], ['+31', 'NL'], ['+32', 'BE'],
  ['+33', 'FR'], ['+34', 'ES'], ['+36', 'HU'], ['+39', 'IT VA'], ['+40', 'RO'], ['+41', 'CH'],
  ['+43', 'AT'], ['+44', 'GB GG IM JE'], ['+45', 'DK'], ['+46', 'SE'], ['+47', 'NO SJ'], ['+48', 'PL'],
  ['+49', 'DE'], ['+51', 'PE'], ['+52', 'MX'], ['+53', 'CU'], ['+54', 'AR'], ['+55', 'BR'], ['+56', 'CL'],
  ['+57', 'CO'], ['+58', 'VE'], ['+60', 'MY'], ['+61', 'AU CC CX'], ['+62', 'ID'], ['+63', 'PH'],
  ['+64', 'NZ PN'], ['+65', 'SG'], ['+66', 'TH'], ['+81', 'JP'], ['+82', 'KR'], ['+84', 'VN'], ['+86', 'CN'],
  ['+90', 'TR'], ['+91', 'IN'], ['+92', 'PK'], ['+93', 'AF'], ['+94', 'LK'], ['+95', 'MM'], ['+98', 'IR'],
  ['+211', 'SS'], ['+212', 'EH MA'], ['+213', 'DZ'], ['+216', 'TN'], ['+218', 'LY'], ['+220', 'GM'],
  ['+221', 'SN'], ['+222', 'MR'], ['+223', 'ML'], ['+224', 'GN'], ['+225', 'CI'], ['+226', 'BF'],
  ['+227', 'NE'], ['+228', 'TG'], ['+229', 'BJ'], ['+230', 'MU'], ['+231', 'LR'], ['+232', 'SL'],
  ['+233', 'GH'], ['+234', 'NG'], ['+235', 'TD'], ['+236', 'CF'], ['+237', 'CM'], ['+238', 'CV'],
  ['+239', 'ST'], ['+240', 'GQ'], ['+241', 'GA'], ['+242', 'CG'], ['+243', 'CD'], ['+244', 'AO'],
  ['+245', 'GW'], ['+246', 'IO'], ['+248', 'SC'], ['+249', 'SD'], ['+250', 'RW'], ['+251', 'ET'],
  ['+252', 'SO'], ['+253', 'DJ'], ['+254', 'KE'], ['+255', 'TZ'], ['+256', 'UG'], ['+257', 'BI'],
  ['+258', 'MZ'], ['+260', 'ZM'], ['+261', 'MG'], ['+262', 'RE TF YT'], ['+263', 'ZW'], ['+264', 'NA'],
  ['+265', 'MW'], ['+266', 'LS'], ['+267', 'BW'], ['+268', 'SZ'], ['+269', 'KM'], ['+290', 'SH'],
  ['+291', 'ER'], ['+297', 'AW'], ['+298', 'FO'], ['+299', 'GL'], ['+350', 'GI'], ['+351', 'PT'],
  ['+352', 'LU'], ['+353', 'IE'], ['+354', 'IS'], ['+355', 'AL'], ['+356', 'MT'], ['+357', 'CY'],
  ['+358', 'AX FI'], ['+359', 'BG'], ['+370', 'LT'], ['+371', 'LV'], ['+372', 'EE'], ['+373', 'MD'],
  ['+374', 'AM'], ['+375', 'BY'], ['+376', 'AD'], ['+377', 'MC'], ['+378', 'SM'], ['+380', 'UA'],
  ['+381', 'RS'], ['+382', 'ME'], ['+385', 'HR'], ['+386', 'SI'], ['+387', 'BA'], ['+389', 'MK'],
  ['+420', 'CZ'], ['+421', 'SK'], ['+423', 'LI'], ['+500', 'FK GS'], ['+501', 'BZ'], ['+502', 'GT'],
  ['+503', 'SV'], ['+504', 'HN'], ['+505', 'NI'], ['+506', 'CR'], ['+507', 'PA'], ['+508', 'PM'],
  ['+509', 'HT'], ['+590', 'BL GP MF'], ['+591', 'BO'], ['+592', 'GY'], ['+593', 'EC'], ['+594', 'GF'],
  ['+595', 'PY'], ['+596', 'MQ'], ['+597', 'SR'], ['+598', 'UY'], ['+599', 'BQ CW'], ['+670', 'TL'],
  ['+672', 'HM NF'], ['+673', 'BN'], ['+674', 'NR'], ['+675', 'PG'], ['+676', 'TO'], ['+677', 'SB'],
  ['+678', 'VU'], ['+679', 'FJ'], ['+680', 'PW'], ['+681', 'WF'], ['+682', 'CK'], ['+683', 'NU'],
  ['+685', 'WS'], ['+686', 'KI'], ['+687', 'NC'], ['+688', 'TV'], ['+689', 'PF'], ['+690', 'TK'],
  ['+691', 'FM'], ['+692', 'MH'], ['+850', 'KP'], ['+852', 'HK'], ['+853', 'MO'], ['+855', 'KH'],
  ['+856', 'LA'], ['+880', 'BD'], ['+886', 'TW'], ['+960', 'MV'], ['+961', 'LB'], ['+962', 'JO'],
  ['+963', 'SY'], ['+964', 'IQ'], ['+965', 'KW'], ['+966', 'SA'], ['+967', 'YE'], ['+968', 'OM'],
  ['+970', 'PS'], ['+971', 'AE'], ['+972', 'IL'], ['+973', 'BH'], ['+974', 'QA'], ['+975', 'BT'],
  ['+976', 'MN'], ['+977', 'NP'], ['+992', 'TJ'], ['+993', 'TM'], ['+994', 'AZ'], ['+995', 'GE'],
  ['+996', 'KG'], ['+998', 'UZ'],
];
const CALLING_CODE_BY_COUNTRY = Object.fromEntries(
  CALLING_CODE_GROUPS.flatMap(([dialCode, countries]) => countries.split(' ').map((country) => [country, dialCode])),
) as Record<string, string>;

interface CheckoutForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneCountry: string;
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
    imports: [CommonModule, RouterLink],
    templateUrl: './checkout.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './checkout.component.scss'
})
export class CheckoutComponent implements OnInit, OnDestroy {
  readonly cart = inject(CartService);
  private readonly checkoutApi = inject(CheckoutService);
  private readonly paymentService = inject(PaymentService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);
  private readonly apiBase = inject(API_BASE);

  readonly termsHandle   = signal<string | null>(null);
  readonly privacyHandle = signal<string | null>(null);


  // Stable idempotency key for the current checkout attempt. Generated lazily on
  // the first placeOrder() call and reused on retries, so a double-tap or retry
  // returns the same order instead of creating a duplicate. Cleared after a
  // successful order so the next checkout gets a fresh key.
  private idempotencyKey: string | null = null;


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
      if (savedForm) {
        const restored = JSON.parse(savedForm) as CheckoutForm;
        const oldCountryCodes: Record<string, string> = {
          Qatar: 'QA', UAE: 'AE', Kuwait: 'KW', 'Saudi Arabia': 'SA', Bahrain: 'BH', Oman: 'OM',
        };
        const country = oldCountryCodes[restored.country] || restored.country;
        this.form.set({
          ...restored,
          country: COUNTRY_CODES.includes(country) ? country : 'QA',
          phoneCountry: COUNTRY_CODES.includes(restored.phoneCountry) ? restored.phoneCountry : 'QA',
        });
      }

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
    // The bag may have been filled days ago. Re-read it so lines that sold out
    // since are flagged now, not when the customer presses Proceed to Payment.
    void this.cart.refresh();
    this.restoreCountryChoices();
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
  readonly countries = computed(() => {
    const displayNames = new Intl.DisplayNames([this.locale.locale() === 'ar' ? 'ar' : 'en'], { type: 'region' });
    return [...COUNTRY_CODES].sort((a, b) => this.countryLabel(a, displayNames).localeCompare(this.countryLabel(b, displayNames)));
  });
  readonly phoneCountries = this.countries;

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
    phoneCountry: 'QA',
    address: '',
    zone: '',
    street: '',
    building: '',
    additionalDetails: '',
    city: '',
    country: 'QA',
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

  /** Explains which bag lines block checkout. Empty when every line is in stock. */
  readonly stockMessage = computed(() => {
    const issues = this.cart.stockIssues();
    if (issues.length === 0) return '';
    if (issues.length > 1) return this.tp('checkout.stock.many', { count: issues.length });
    const [item] = issues;
    const params = { name: this.itemName(item), size: item.size, count: item.available ?? 0 };
    return item.available ? this.tp('checkout.stock.short', params) : this.tp('checkout.stock.soldOut', params);
  });

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
  readonly tp = (key: string, params: Record<string, string | number>): string => this.i18n.t(key, params);
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
    if (key === 'country' || key === 'phoneCountry') this.persistCountryChoices();
    if (['phone', 'phoneCountry', 'address', 'zone', 'street', 'building', 'city', 'country'].includes(String(key))) {
      this.quoteRequestVersion += 1;
      this.quotedDeliveryKey = '';
      this.shippingQuote.set(null);
      this.error.set('');
    }
    // Any field change invalidates the pending order — a different submission
    // must create a new order, not return the old one via idempotency dedup.
    this.idempotencyKey = null;
  }

  private restoreCountryChoices(): void {
    try {
      const raw = sessionStorage.getItem(CHECKOUT_COUNTRIES_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { country?: string; phoneCountry?: string };
      this.form.update((form) => ({
        ...form,
        country: COUNTRY_CODES.includes(saved.country || '') ? saved.country! : form.country,
        phoneCountry: COUNTRY_CODES.includes(saved.phoneCountry || '') ? saved.phoneCountry! : form.phoneCountry,
      }));
    } catch { /* keep the checkout defaults */ }
  }

  private persistCountryChoices(): void {
    try {
      const { country, phoneCountry } = this.form();
      sessionStorage.setItem(CHECKOUT_COUNTRIES_KEY, JSON.stringify({ country, phoneCountry }));
    } catch { /* storage can be unavailable in private browsing */ }
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
    if (this.cart.stockIssues().length) return;
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

    // Last cheap look at stock before the payment step, since filling in the
    // form can take a while.
    if (this.step() === 1) {
      await this.cart.refresh();
      if (this.cart.stockIssues().length) return;
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


  stockLabel(item: CartItem): string {
    if (item.available == null || item.qty <= item.available) return '';
    return item.available === 0
      ? this.t('cart.stock.soldOut')
      : this.tp('cart.stock.onlyLeft', { count: item.available });
  }

  /** Removes a sold-out line, or lowers it to what is left. */
  fixStock(item: CartItem): void {
    // The bag changed, so a retry must not reuse the previous attempt's key.
    this.idempotencyKey = null;
    this.error.set('');
    void this.cart.setQty(item, item.available ?? 0);
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }

  countryLabel(country: string, displayNames = new Intl.DisplayNames([this.locale.locale() === 'ar' ? 'ar' : 'en'], { type: 'region' })): string {
    if (/^[A-Z]{2}$/.test(country)) return displayNames.of(country) || country;
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

  phoneCallingCode(country: string): string {
    return CALLING_CODE_BY_COUNTRY[country] || '';
  }

  phoneForApi(form: CheckoutForm): string {
    const phone = form.phone.trim();
    if (!phone) return '';
    if (phone.startsWith('+') || phone.startsWith('00')) return phone;
    return `${this.phoneCallingCode(form.phoneCountry)} ${phone}`.trim();
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
    const acceptedDelivery = this.shippingQuote();
    const quoteWasCurrent = acceptedDelivery?.available && (!acceptedDelivery.expiresAt || Date.parse(acceptedDelivery.expiresAt) > Date.now())
      && this.deliveryQuoteKey(this.form(), this.cart.items()) === this.quotedDeliveryKey;
    if (!(await this.ensureDeliveryQuote())) return;
    if (!quoteWasCurrent) { this.error.set(this.t('checkout.delivery.reviewChanged')); return; }

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
          phone: this.phoneForApi(form),
        },
        shippingAddress: {
          fullName,
          phone: this.phoneForApi(form),
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
    } catch (err) {
      if (err instanceof HttpErrorResponse && ['QUOTE_CHANGED','INVALID_ID','RESERVATION_EXPIRED'].includes(err.error?.code)) {
        this.shippingQuote.set(null);
        this.idempotencyKey = '';
        await this.ensureDeliveryQuote();
        this.error.set(this.t('checkout.delivery.reviewChanged'));
        this.placing.set(false);
        return;
      }
      this.error.set(await this.orderErrorMessage(err));
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
    } catch (err) {
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      sessionStorage.removeItem(PENDING_FORM_KEY);
      sessionStorage.removeItem(PENDING_QUOTE_KEY);
      this.redirecting.set(false);
      if (err instanceof HttpErrorResponse && err.error?.code === 'RESERVATION_EXPIRED') {
        this.idempotencyKey = '';
        this.shippingQuote.set(null);
        this.error.set(this.t('checkout.delivery.reviewChanged'));
      } else {
        this.error.set(this.t('checkout.error.payment'));
      }
    }
  }

  private async orderErrorMessage(err: unknown): Promise<string> {
    const shortages = stockShortages(err);
    if (shortages.length) {
      await this.cart.refresh();
      // The refreshed bag flags the lines itself and stockMessage explains them.
      if (this.cart.stockIssues().length) return '';
      if (shortages.length > 1) return this.tp('checkout.stock.many', { count: shortages.length });
      const [s] = shortages;
      const params = { name: this.itemName({ id: '', name: s.name }), size: s.size ?? '', count: s.available };
      return s.available ? this.tp('checkout.stock.short', params) : this.tp('checkout.stock.soldOut', params);
    }
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409 && err.error?.code === 'ITEM_UNAVAILABLE') {
        // The catalog changed under the bag (hidden product, removed size, new price).
        await this.cart.refresh();
        const [line] = Array.isArray(err.error.details) ? err.error.details : [];
        return this.tp('checkout.error.itemUnavailable', { name: this.itemName({ id: '', name: line?.name || '' }) });
      }
      if (err.status === 0) return this.t('checkout.error.network');
      if (err.status === 422) return this.t('checkout.error.validation');
    }
    return this.t('checkout.error.submit');
  }

  private async ensureDeliveryQuote(): Promise<boolean> {
    const existing = this.shippingQuote();
    const deliveryKey = this.deliveryQuoteKey(this.form(), this.cart.items());
    if (existing?.available && (!existing.expiresAt || Date.parse(existing.expiresAt)>Date.now()) && deliveryKey === this.quotedDeliveryKey) return true;
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
          phone: this.phoneForApi(form),
        },
        shippingAddress: {
          fullName,
          phone: this.phoneForApi(form),
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
    return Boolean(value.trim());
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
      customer: [form.firstName.trim(), form.lastName.trim(), this.phoneForApi(form)],
      address: [
        this.deliveryLine1(form),
        form.city.trim(),
        form.country,
      ],
      items: items.map((item) => [item.id, item.variantId || '', item.size, item.qty]),
    });
  }
}
