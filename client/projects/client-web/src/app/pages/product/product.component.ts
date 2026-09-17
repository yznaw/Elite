import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { CartService } from '../../services/cart.service';
import { ProductsService } from '../../services/products.service';
import { Product, ProductVariant } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { AnalyticsService } from '../../services/analytics.service';
import { colorKey, colorSlug } from '../../utils/color-slug';
import { SeoService } from '../../services/seo.service';
import { API_BASE } from '../../core/api-base';

import { sizeOptions, productSoldOut, defaultColor, colorStock, availableStock, selectedVariant, productColors } from '../../shared/stock-availability';
import { SizeSheetComponent } from '../../shared/size-sheet/size-sheet.component';
import { BodyScrollLock, MOBILE_SHEET_QUERY, prefersReducedMotion } from '../../shared/overlay/body-scroll-lock';
import { RestockService } from '../../shared/restock/restock.service';

interface Accordion {
  id: string;
  titleKey: string;
  contentKey: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface AvailableSize {
  size: number;
  available: boolean;
  inStock: boolean;
}

interface StorefrontCollectionLink {
  id: string;
  handle: string;
  title: string;
  children?: StorefrontCollectionLink[];
}

interface ReviewFieldErrors {
  rating?: string;
  phone?: string;
  email?: string;
  contact?: string;
}

const FALLBACK_IMAGE = '/assets/brand/elite-logo-green.png';

@Component({
    selector: 'cw-product',
    imports: [CommonModule, SizeSheetComponent],
    templateUrl: './product.component.html',
    /**
     * `Eager` here was written by the v17 to v22 migration, which preserved the
     * old framework default rather than making a choice about this component.
     * It means the whole template is re-evaluated every time change detection
     * reaches it, and with zone.js that is every touch, scroll and timer on the
     * page: roughly a hundred translation lookups, the price formatter, the
     * per-image srcset builders and every loop, on each one. On a phone that is
     * what the delay between pressing a size and seeing it select is made of.
     *
     * Every value this template reads comes from a signal, so OnPush is safe:
     * the signals read during rendering (including the ones read inside the
     * methods the template calls) mark the view dirty on their own. Anything
     * added later that the template must react to has to be a signal too.
     */
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './product.component.scss'
})
export class ProductComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly scrollLock = inject(BodyScrollLock);
  private readonly restock = inject(RestockService);
  private readonly cart = inject(CartService);
  private readonly productsSvc = inject(ProductsService);
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly analytics = inject(AnalyticsService);
  private readonly seo = inject(SeoService);
  private readonly apiBase = inject(API_BASE);

  /**
   * Head tags for the product on screen. Null while it loads, so a shared link
   * never resolves to an empty title.
   *
   * The canonical deliberately drops the `?color=` query: each colour is the
   * same product at the same price, and letting four colour URLs compete would
   * split whatever ranking the product earns.
   */
  private readonly seoTags = this.seo.watch(() => {
    const p = this.product();
    if (!p) return null;

    const name = this.i18n.productName(p);
    const inStock = !productSoldOut(p);
    // Product copy is rich text, so it is flattened before it goes anywhere
    // a crawler reads it verbatim.
    const description = this.seo.plainText(
      this.productTeaser(p) || this.productDescription(p),
    ) || this.i18n.t('seo.product.description', {
      name,
      leather: this.i18n.productLeather(p.leather),
      price: this.i18n.price(p.price),
    });
    const material = this.i18n.productLeather(p.leather).trim();

    return {
      title: name,
      description,
      image: this.gallery()[0],
      canonicalPath: `/product/${p.id}`,
      type: 'product' as const,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name,
        description,
        image: this.gallery().slice(0, 6).map((src) => this.seo.absolute(src)),
        brand: { '@type': 'Brand', name: p.brand?.trim() || this.i18n.t('seo.siteName') },
        // Omitted rather than emitted empty: a blank property is worse than
        // an absent one, and not every product has a leather on record.
        ...(material ? { material } : {}),
        offers: {
          '@type': 'Offer',
          price: p.price,
          priceCurrency: 'QAR',
          availability: inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          url: `${this.seo.origin()}/product/${p.id}`,
        },
      },
    };
  });

  private feedbackTimer: number | undefined;
  private routeSub?: Subscription;
  private querySub?: Subscription;
  private loadToken = 0;
  private thumbStrip?: HTMLElement;
  private thumbStripResizeObserver?: ResizeObserver;
  private thumbStripMutationObserver?: MutationObserver;
  private gallerySyncFrame: number | undefined;
  private gallerySwipeStart: { x: number; y: number; pointerId: number } | null = null;
  private reviewTrigger?: HTMLElement;

  readonly accordions: Accordion[] = [
    {
      id: 'material',
      titleKey: 'product.accordion.material',
      contentKey: 'product.accordion.material.body',
    },
    {
      id: 'shipping',
      titleKey: 'product.accordion.delivery',
      contentKey: 'product.accordion.delivery.body',
    },
    {
      id: 'sizing',
      titleKey: 'product.accordion.sizing',
      contentKey: 'product.accordion.sizing.body',
    },
  ];

  readonly product = signal<Product | null>(null);
  readonly productLoading = signal(true);
  readonly productError = signal('');
  readonly galleryIdx = signal(0);
  readonly loadedGalleryImages = signal<Record<string, boolean>>({});
  readonly thumbStripCanScrollStart = signal(false);
  readonly thumbStripCanScrollEnd = signal(false);
  readonly selectedSize = signal<number | null>(null);
  readonly sizeSelectionError = signal(false);
  readonly selectedColor = signal<string | null>(null);
  readonly colorHexByName = this.referenceData.colorHexByName;
  readonly colorSwatchImageByName = this.referenceData.colorSwatchImageByName;
  readonly colorNameArByName = this.referenceData.colorNameArByName;
  readonly sizeSets = this.referenceData.sizeSets;
  readonly openAccordion = signal<string | null>(null);
  readonly addedFeedback = signal(false);
  readonly wishlisted = signal(false);
  readonly qty = signal(1);
  readonly sizePickerOpen = signal(false);
  readonly sizeGuideOpen = signal(false);
  readonly sizeGuideLoading = signal(false);
  readonly sizeGuideError = signal('');
  readonly restockFormOpen = signal(false);
  readonly restockEmail = signal('');
  readonly restockSize = signal<number | null>(null);
  readonly productSoldOut = productSoldOut;
  readonly maxQty = computed(() => {
    const p = this.product();
    if (!p) return 0;
    // Before a size is picked, the colour's best stock stands in. Asking `availableStock` with a
    // null size would answer 0 for every sized product, which would freeze the quantity stepper
    // and render the restock panel on a product that is perfectly in stock. `selectSize` clamps
    // the quantity down once a specific size is known.
    const size = this.selectedSize();
    return size === null ? colorStock(p, this.selectedColor()) : availableStock(p, this.selectedColor(), size);
  });
  readonly restockSizes = computed(() => this.availableSizes().filter(s => s.available && !s.inStock));
  readonly restockSubmitting = signal(false);
  readonly restockSubmitted = signal(false);
  readonly restockError = signal('');
  readonly reviewOpen = signal(false);
  readonly reviewRating = signal<number | null>(null);
  readonly reviewDescription = signal('');
  readonly reviewName = signal('');
  readonly reviewPhone = signal('');
  readonly reviewEmail = signal('');
  readonly reviewContactConsent = signal(false);
  readonly reviewFieldErrors = signal<ReviewFieldErrors>({});
  readonly reviewSubmitting = signal(false);
  readonly reviewSubmitted = signal(false);
  readonly reviewError = signal('');
  readonly fromCollectionHandle = signal<string | null>(null);
  readonly fromCollectionName = signal<string | null>(null);
  readonly fromParentCollectionHandle = signal<string | null>(null);
  readonly fromParentCollectionName = signal<string | null>(null);

  readonly gallery = computed(() => {
    const p = this.product();
    if (!p) return [FALLBACK_IMAGE];
    const images = [...(p.images ?? []), p.image]
      .map((src) => String(src || '').trim())
      .filter(Boolean);
    const selectedColorImage = this.selectedColor()
      ? this.productImageForColor(p, this.selectedColor() || '', images)
      : null;
    const galleryImages = [selectedColorImage, ...images]
      .map((src) => String(src || '').trim())
      .filter(Boolean);
    return galleryImages.length ? [...new Set(galleryImages)] : [FALLBACK_IMAGE];
  });

  readonly attributes = computed(() => {
    const p = this.product();
    if (!p) return [];
    return [
      { key: 'product.attr.leather', value: this.i18n.productLeather(p.leather) },
      { key: 'product.attr.style', value: this.i18n.productStyle(p.style) },
      { key: 'product.attr.origin', value: this.i18n.t('product.attr.originValue') },
      { key: 'product.attr.edition', value: this.i18n.t('product.attr.editionValue') },
    ];
  });

  readonly recommendedProducts = computed(() => {
    const p = this.product();
    if (!p?.relatedProductIds?.length) return [];
    return p.relatedProductIds
      .map((id) => this.productsSvc.getById(id))
      .filter((item): item is Product => item != null && item.id !== p.id)
      .slice(0, 4);
  });

  readonly availableSizes = computed<AvailableSize[]>(() => {
    const p = this.product();
    if (!p) return [];

    // Driven by `sizeOptions`, not `product.sizes`: a product can carry its sizes only on its
    // variants. Bailing out on an empty `product.sizes` used to render no size UI at all for
    // those, which left the purchase ungated.
    const offered = sizeOptions(p, this.selectedColor());
    return [
      ...offered.map(s => ({ size: s.size, available: true, inStock: s.state === 'available' })),
      ...(p.sizes ?? []).filter(size => !offered.some(s => s.size === size)).sort((a, b) => a - b)
        .map(size => ({ size, available: false, inStock: false })),
    ];
  });

  /**
   * Product-wide note: a fact that holds for every size, so it shows from the
   * moment the page loads rather than waiting for a size to be picked. Sits
   * above selectedSizeNote() when both exist — the general statement first,
   * then the one that only applies to the size in hand.
   */
  readonly productNote = computed<string>(() => {
    const p = this.product();
    if (!p) return '';
    const ar = (p.noteAr || '').trim();
    const en = (p.noteEn || '').trim();
    return this.locale.locale() === 'ar' ? (ar || en) : (en || ar);
  });

  /**
   * Note attached to the size the customer has picked, e.g. "Back zipper" on
   * the small sizes of a dress whose larger sizes have none. The same gallery
   * covers the whole range, so this line is what tells the two apart.
   *
   * Scoped by colour the same way availableSizes is: a note set on the sage
   * variant must not surface while the customer is looking at the navy one.
   * Empty string means the template renders nothing at all.
   */
  readonly selectedSizeNote = computed<string>(() => {
    const p = this.product();
    const size = this.selectedSize();
    if (!p || size === null) return '';

    const selectedColorKey = this.selectedColor() ? this.colorKey(this.selectedColor() || '') : '';
    const matches = (p.variants || []).filter((variant) => {
      if (Number(variant.size) !== size) return false;
      if (!selectedColorKey || !variant.color) return true;
      return this.colorKey(variant.color) === selectedColorKey;
    });

    const isArabic = this.locale.locale() === 'ar';
    for (const variant of matches) {
      const ar = (variant.noteAr || '').trim();
      const en = (variant.noteEn || '').trim();
      const note = isArabic ? (ar || en) : (en || ar);
      if (note) return note;
    }
    return '';
  });

  readonly selectedSizeInStock = computed(() => {
    return this.maxQty() > 0;
  });

  /**
   * Whether there is a size here the customer could actually pick.
   *
   * Counts selectable sizes, not rows: `availableSizes()` also lists sizes the product has but
   * this colour does not offer, as struck-out disabled chips. A colour whose variants carry no
   * size at all lists every size that way, and counting rows made the purchase gate demand a
   * size that no chip could satisfy. 30 of the 43 products in the catalogue have such a colour.
   */
  readonly hasSizeOptions = computed(() => this.availableSizes().some((option) => option.available));

  /**
   * Only show the stock hint once it refers to something real. Before a size is picked `maxQty`
   * is the colour's best size, and printing "Max 3" for a size the customer has not chosen would
   * be a promise about the wrong variant.
   */
  readonly showStockHint = computed(
    () => (!this.hasSizeOptions() || this.selectedSize() !== null) && this.maxQty() > 0,
  );

  readonly canPurchaseProduct = computed(() => {
    const p = this.product();
    if (!p) return false;
    // `hasSizeOptions`, not `p.sizes`, so a product whose sizes live on its variants is treated
    // as sized here too.
    if (!this.hasSizeOptions()) return this.selectedSizeInStock();
    if (this.selectedSize() === null) {
      return this.availableSizes().some((item) => item.available && item.inStock);
    }
    return this.selectedSizeInStock();
  });

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);

  /**
   * Long description in the active locale, falling back to the other language
   * so a product with copy in only one still shows it. Empty means the template
   * renders the generic house description instead.
   */
  productDescription(product: Product): string {
    const ar = (product.descriptionAr || '').trim();
    const en = (product.descriptionEn || '').trim();
    return (this.locale.locale() === 'ar' ? (ar || en) : (en || ar));
  }

  /**
   * Short description shown under the product name, locale-aware with a
   * same-fallback-shape as productDescription. Empty means the template
   * renders nothing rather than a placeholder line.
   */
  productTeaser(product: Product): string {
    const ar = (product.teaserAr || '').trim();
    const en = (product.teaserEn || '').trim();
    return (this.locale.locale() === 'ar' ? (ar || en) : (en || ar));
  }

  /**
   * Material & Care copy. Falls back to the legacy long description so
   * products saved before this field existed still show something in that
   * section during the transition period.
   */
  productCareInstructions(product: Product): string {
    const ar = (product.careInstructionsAr || '').trim();
    const en = (product.careInstructionsEn || '').trim();
    const direct = this.locale.locale() === 'ar' ? (ar || en) : (en || ar);
    return direct || this.productDescription(product);
  }
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productTag = (value: string): string => this.i18n.productTag(value);

  @ViewChild('thumbStrip')
  set thumbStripElement(element: ElementRef<HTMLElement> | undefined) {
    this.thumbStripResizeObserver?.disconnect();
    this.thumbStripMutationObserver?.disconnect();
    this.thumbStrip = element?.nativeElement;

    if (!this.thumbStrip) {
      this.thumbStripCanScrollStart.set(false);
      this.thumbStripCanScrollEnd.set(false);
      return;
    }

    queueMicrotask(() => this.updateThumbStripState());

    if (typeof ResizeObserver !== 'undefined') {
      this.thumbStripResizeObserver = new ResizeObserver(() => this.updateThumbStripState());
      this.thumbStripResizeObserver.observe(this.thumbStrip);
    }

    if (typeof MutationObserver !== 'undefined') {
      this.thumbStripMutationObserver = new MutationObserver(() => this.updateThumbStripState());
      this.thumbStripMutationObserver.observe(this.thumbStrip, { childList: true });
    }
  }

  ngOnInit(): void {
    this.querySub = this.route.queryParamMap.subscribe((queryParams) => {
      const collectionHandle = queryParams.get('col');
      this.fromCollectionHandle.set(collectionHandle);
      this.fromCollectionName.set(queryParams.get('colName'));
      this.fromParentCollectionHandle.set(queryParams.get('parentCol'));
      this.fromParentCollectionName.set(queryParams.get('parentColName'));
      if (collectionHandle && !queryParams.get('parentCol')) {
        void this.resolveLegacyCollectionParent(collectionHandle);
      }
      this.applyColorParam(queryParams.get('color'));
      this.applySizeAndNotifyParams();
    });

    this.routeSub = this.route.paramMap.subscribe((params) => {
      void this.loadProduct(params.get('id'));
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.querySub?.unsubscribe();
    this.thumbStripResizeObserver?.disconnect();
    this.thumbStripMutationObserver?.disconnect();
    if (this.gallerySyncFrame) cancelAnimationFrame(this.gallerySyncFrame);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    if (this.reviewOpen()) this.scrollLock.release();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // The size sheet closes itself; cw-overlay owns Escape for everything it renders.
    if (this.reviewOpen()) this.closeReview();
  }

  async goCollection(): Promise<void> {
    const handle = this.fromCollectionHandle();
    if (handle && !this.fromParentCollectionHandle()) {
      await this.resolveLegacyCollectionParent(handle);
    }

    const parentHandle = this.fromParentCollectionHandle();
    const route = parentHandle && handle
      ? ['/collection', parentHandle, handle]
      : handle
        ? ['/collection', handle]
        : ['/collection'];
    void this.router.navigate(route);
  }

  goParentCollection(): void {
    const parentHandle = this.fromParentCollectionHandle();
    void this.router.navigate(parentHandle ? ['/collection', parentHandle] : ['/collection']);
  }

  retryProduct(): void {
    void this.loadProduct(this.route.snapshot.paramMap.get('id'), true);
  }

  private async loadProduct(idParam: string | null, force = false): Promise<void> {
    const token = ++this.loadToken;
    this.productLoading.set(true);
    this.productError.set('');
    this.product.set(null);
    await (force ? this.productsSvc.refresh() : this.productsSvc.ensureLoaded());
    if (token !== this.loadToken) return;

    const p = idParam ? this.productsSvc.getById(idParam) : undefined;
    const nextProduct = p ?? (idParam ? undefined : this.productsSvc.getAll()[0]);
    if (!nextProduct) {
      this.productError.set(this.productsSvc.error() || 'Product not found.');
      this.productLoading.set(false);
      return;
    }
    this.product.set(nextProduct);
    // Record a product view so "Most Engaged Products" reflects views, not just
    // cart clicks. Fired here (canonical load path) to avoid double counting.
    this.analytics.track('product_view', { productId: nextProduct.id });
    this.galleryIdx.set(0);
    this.selectedColor.set(defaultColor(nextProduct, this.route.snapshot.queryParamMap.get('color')));
    // No size is chosen for the customer: a shoe size is their decision, not the first one in stock.
    this.selectedSize.set(null);
    this.sizeSelectionError.set(false);
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.sizeGuideOpen.set(false);
    this.resetRestockForm();
    this.resetReviewForm();
    void this.referenceData.ensureColors();
    this.productLoading.set(false);
    this.applySizeAndNotifyParams();
  }

  goToProduct(nextProduct: Product): void {
    this.product.set(nextProduct);
    this.galleryIdx.set(0);
    this.selectedSize.set(null);
    this.sizeSelectionError.set(false);
    this.selectedColor.set(null);
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.sizeGuideOpen.set(false);
    this.resetRestockForm();
    this.resetReviewForm();
    void this.router.navigate(['/product', nextProduct.id], {
      queryParamsHandling: 'preserve',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setGalleryIdx(i: number): void {
    this.selectGalleryIndex(i);
  }

  scrollThumbnails(toward: 'start' | 'end'): void {
    this.navGallery(toward === 'end' ? 1 : -1);
  }

  navGallery(dir: number): void {
    this.selectGalleryIndex(this.galleryIdx() + dir);
  }

  onGalleryPointerDown(event: PointerEvent): void {
    if (
      this.gallery().length < 2 ||
      (event.target instanceof HTMLElement && event.target.closest('button'))
    ) {
      return;
    }
    this.gallerySwipeStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  }

  onGalleryPointerUp(event: PointerEvent): void {
    const start = this.gallerySwipeStart;
    this.gallerySwipeStart = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 42 || Math.abs(dx) <= Math.abs(dy)) return;
    this.navGallery(dx < 0 ? 1 : -1);
  }

  onGalleryPointerCancel(event: PointerEvent): void {
    if (this.gallerySwipeStart?.pointerId === event.pointerId) {
      this.gallerySwipeStart = null;
    }
  }

  galleryImageLoading(index: number): 'eager' | 'lazy' {
    const count = this.gallery().length;
    if (count <= 3) return 'eager';
    const distance = Math.abs(index - this.galleryIdx());
    return distance <= 1 || distance >= count - 1 ? 'eager' : 'lazy';
  }

  private selectGalleryIndex(index: number): void {
    const count = this.gallery().length;
    if (!count) return;

    const normalizedIndex = (index + count) % count;
    this.galleryIdx.set(normalizedIndex);

    if (this.gallerySyncFrame) cancelAnimationFrame(this.gallerySyncFrame);
    this.gallerySyncFrame = requestAnimationFrame(() => {
      this.gallerySyncFrame = undefined;
      const activeThumbnail = this.thumbStrip?.querySelector<HTMLElement>('.thumb.is-active');
      activeThumbnail?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      });
      this.updateThumbStripState();
    });
  }

  updateThumbStripState(): void {
    const strip = this.thumbStrip;
    if (!strip) {
      this.thumbStripCanScrollStart.set(false);
      this.thumbStripCanScrollEnd.set(false);
      return;
    }

    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const scrollPosition = Math.min(maxScroll, Math.abs(strip.scrollLeft));
    this.thumbStripCanScrollStart.set(scrollPosition > 1);
    this.thumbStripCanScrollEnd.set(scrollPosition < maxScroll - 1);
  }

  selectSize(s: number): void {
    if (!this.availableSizes().some(option => option.size === s && option.available)) return;
    this.selectedSize.set(s);
    this.qty.set(Math.max(1, Math.min(this.qty(), this.maxQty())));
    this.sizeSelectionError.set(false);
    this.closeSizePicker();
    this.resetRestockForm();
  }

  selectProductColor(color: string): void {
    this.selectedColor.set(color);
    this.selectGalleryIndex(0);
    this.selectedSize.set(null);
    this.qty.set(1);
    this.sizeSelectionError.set(false);
    this.resetRestockForm();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { color: this.colorSlug(color) || null, size: null, notify: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onProductColorKeydown(color: string, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectProductColor(color);
  }

  openSizePicker(): void {
    this.sizePickerOpen.set(true);
  }

  closeSizePicker(): void {
    this.sizePickerOpen.set(false);
    // `sizeSelectionError` is deliberately left set: dismissing the sheet without picking does not
    // answer the question, and the inline message under the trigger is what keeps asking it.
  }

  async openSizeGuide(): Promise<void> {
    this.sizeGuideOpen.set(true);
    this.sizeGuideError.set('');
    if (this.sizeSets().length > 0) return;

    this.sizeGuideLoading.set(true);
    try {
      await this.referenceData.ensureSizeSets();
      if (this.sizeSets().length === 0) this.sizeGuideError.set(this.t('product.size.guideEmpty'));
    } catch {
      this.sizeGuideError.set(this.t('product.size.guideError'));
    } finally {
      this.sizeGuideLoading.set(false);
    }
  }

  closeSizeGuide(): void {
    this.sizeGuideOpen.set(false);
  }

  decQty(): void { this.qty.update((q) => Math.max(1, q - 1)); }
  incQty(): void { this.qty.update((q) => Math.max(1, Math.min(q + 1, this.maxQty()))); }

  toggleAccordion(id: string): void {
    this.openAccordion.update((cur) => (cur === id ? null : id));
  }

  toggleWishlist(): void {
    this.wishlisted.update((w) => !w);
  }

  add(): void {
    const p = this.product();
    if (!p) return;
    if (!this.requireSizeSelection()) return;
    if (!this.selectedSizeInStock()) {
      this.openRestockForm();
      return;
    }
    const size = this.selectedSize();
    if (size === null && this.hasSizeOptions()) return;
    this.cart.add(this.cartItem(p, size ?? 0));
    this.addedFeedback.set(true);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => this.addedFeedback.set(false), 2200);
  }

  buyNow(): void {
    const p = this.product();
    if (!p) return;
    if (!this.requireSizeSelection()) return;
    if (!this.selectedSizeInStock()) {
      this.openRestockForm();
      return;
    }
    const size = this.selectedSize();
    if (size === null && this.hasSizeOptions()) return;
    this.cart.add(this.cartItem(p, size ?? 0));
    this.cart.closeDrawer();
    void this.router.navigate(['/checkout']);
    window.scrollTo(0, 0);
  }

  onImgError(e: Event): void {
    const img = e.target as HTMLImageElement;
    if (img.src !== FALLBACK_IMAGE) {
      img.src = FALLBACK_IMAGE;
      return;
    }
    img.style.display = 'none';
  }

  isGalleryImageLoaded(src: string): boolean {
    return !!this.loadedGalleryImages()[src];
  }

  markGalleryImageLoaded(src: string): void {
    this.loadedGalleryImages.update((loaded) => loaded[src] ? loaded : { ...loaded, [src]: true });
  }

  productColorNames(product: Product): string[] {
    return this.productColors(product);
  }

  colorHex(name: string): string {
    const value = name.trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;

    return this.colorHexByName()[value.toLowerCase()] ?? '#d8d2c8';
  }

  colorSwatchImage(name: string): string | null {
    return this.colorSwatchImageByName()[this.colorKey(name)] ?? null;
  }

  /**
   * Display name for a colour. Products store the English name (it is the join
   * key for swatches, variants and the ?color= deep link), so the Arabic name
   * is looked up from ref_colors at render time and never persisted here.
   *
   * Falls back to the stored name when a colour has no Arabic translation yet,
   * or when it is a free-text value with no ref_colors row at all — better an
   * English label than a blank one.
   */
  colorLabel(name: string | null | undefined): string {
    const value = String(name || '').trim();
    if (!value) return '';
    if (this.locale.locale() !== 'ar') return value;
    return this.colorNameArByName()[this.colorKey(value)] || value;
  }

  colorSelected(name: string): boolean {
    return this.colorKey(this.selectedColor() || '') === this.colorKey(name);
  }

  imageSrcset(src: string, product: Product): string | null {
    const variants = product.imageVariants?.[src];
    if (!variants) return null;

    const srcset = ['thumb', 'card', 'grid', 'pdp', 'zoom']
      .map((key) => variants[key])
      .filter((variant): variant is { url: string; width?: number } => !!variant?.url && !!variant?.width)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ');

    return srcset || null;
  }

  openRestockForm(): void {
    this.restockSize.set(this.restockSizes().some(s => s.size === this.selectedSize()) ? this.selectedSize() : null);
    this.restockFormOpen.set(true);
    this.restockSubmitted.set(false);
    this.restockError.set('');
    if (typeof window === 'undefined') return;
    requestAnimationFrame(() => {
      const panel = document.getElementById('restock-panel');
      panel?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      document.getElementById(this.hasSizeOptions() && this.restockSize() === null ? 'restock-size' : 'restock-email')?.focus({ preventScroll: true });
    });
  }

  onRestockEmailInput(event: Event): void {
    this.restockEmail.set((event.target as HTMLInputElement).value);
  }

  async submitRestockRequest(event?: Event): Promise<void> {
    event?.preventDefault();
    const p = this.product();
    if (!p || this.restockSubmitting()) return;

    const size = this.restockSize();
    this.restockSubmitting.set(true);
    this.restockError.set('');
    const result = await this.restock.submit({
      productId: p.id,
      size,
      hasSizes: this.hasSizeOptions(),
      soldOutSizes: this.restockSizes().map((s) => s.size),
      color: this.selectedColor(),
      email: this.restockEmail(),
    });
    this.restockSubmitting.set(false);

    if (result.kind === 'ok') {
      this.restockSubmitted.set(true);
      this.restockFormOpen.set(false);
      return;
    }

    if (result.kind === 'error') {
      this.restockError.set(this.t(result.messageKey));
      return;
    }

    // Back in stock while the form was open: reload the catalogue and put the page into a
    // buyable state on the selection they asked about, rather than showing them an error.
    const requestedColor = this.selectedColor();
    await this.productsSvc.refresh();
    if (this.product()?.id === p.id) {
      this.product.set(this.productsSvc.getById(p.id) || p);
      this.selectedColor.set(requestedColor);
      this.selectedSize.set(size);
      this.qty.set(1);
      this.restockFormOpen.set(false);
    }
  }

  openReview(): void {
    if (this.reviewSubmitted()) this.resetReviewForm();
    this.reviewTrigger = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    this.reviewOpen.set(true);
    this.scrollLock.acquire();
  }

  closeReview(): void {
    this.reviewOpen.set(false);
    this.scrollLock.release();
    requestAnimationFrame(() => this.reviewTrigger?.focus());
  }

  selectReviewRating(rating: number): void {
    this.reviewRating.set(this.reviewRating() === rating ? null : rating);
    this.reviewFieldErrors.update(({ rating: _rating, ...errors }) => errors);
    this.reviewError.set('');
  }

  onReviewDescriptionInput(event: Event): void {
    this.reviewDescription.set((event.target as HTMLTextAreaElement).value);
    this.reviewError.set('');
  }

  onReviewNameInput(event: Event): void {
    this.reviewName.set((event.target as HTMLInputElement).value);
  }

  onReviewPhoneInput(event: Event): void {
    this.reviewPhone.set((event.target as HTMLInputElement).value);
    this.reviewFieldErrors.update(({ phone: _phone, contact: _contact, ...errors }) => errors);
  }

  onReviewEmailInput(event: Event): void {
    this.reviewEmail.set((event.target as HTMLInputElement).value);
    this.reviewFieldErrors.update(({ email: _email, contact: _contact, ...errors }) => errors);
  }

  onReviewContactConsentChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.reviewContactConsent.set(checked);
    this.reviewFieldErrors.update(({ phone: _phone, email: _email, contact: _contact, ...errors }) => errors);
    if (!checked) {
      this.reviewPhone.set('');
      this.reviewEmail.set('');
    }
  }

  async submitReview(event?: Event): Promise<void> {
    event?.preventDefault();
    const product = this.product();
    const body = this.reviewDescription().trim();
    const rating = this.reviewRating();
    const phone = this.reviewPhone().trim();
    const email = this.reviewEmail().trim();
    const contactConsent = this.reviewContactConsent();
    if (!product || this.reviewSubmitting()) return;

    const fieldErrors: ReviewFieldErrors = {};
    if (!rating) {
      fieldErrors.rating = this.t('product.review.ratingError');
    }
    if (contactConsent && !phone && !email) {
      fieldErrors.contact = this.t('product.review.contactValidation');
    }
    if (contactConsent && phone && !this.validReviewPhone(phone)) {
      fieldErrors.phone = this.t('product.review.phoneError');
    }
    if (contactConsent && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fieldErrors.email = this.t('product.review.emailError');
    }
    this.reviewFieldErrors.set(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      this.reviewError.set('');
      this.focusFirstReviewError(fieldErrors);
      return;
    }

    this.reviewSubmitting.set(true);
    this.reviewError.set('');
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<{ id: string; createdAt: string }>>(
          `${this.apiBase}/products/${encodeURIComponent(product.id)}/reviews`,
          {
            rating,
            body: body || null,
            authorName: this.reviewName().trim() || null,
            authorPhone: contactConsent ? phone || null : null,
            authorEmail: contactConsent ? email || null : null,
            contactConsent,
            source: 'storefront',
          },
        ),
      );
      this.reviewSubmitted.set(true);
    } catch (error) {
      this.reviewError.set(
        error instanceof HttpErrorResponse && error.status === 429
          ? this.t('product.review.rateLimitError')
          : this.t('product.review.error'),
      );
    } finally {
      this.reviewSubmitting.set(false);
    }
  }

  startAnotherReview(): void {
    this.resetReviewForm();
  }

  private cartItem(p: Product, size: number) {
    const variant = this.selectedVariant(p);
    return {
      id: p.id,
      variantId: variant?.id,
      sku: variant?.sku,
      name: p.name,
      price: variant?.price || p.price,
      image: this.gallery()[this.galleryIdx()] ?? p.image,
      leather: p.leather,
      color: this.selectedColor(),
      size,
      qty: this.qty(),
    };
  }

  private productColors(product: Product): string[] {
    return productColors(product);
  }

  private applyColorParam(colorParam: string | null, product = this.product()): void {
    if (!product || !colorParam) return;
    const target = this.colorSlug(colorParam);
    const match = this.productColors(product).find((color) => this.colorSlug(color) === target);
    if (!match || this.colorSelected(match)) return;

    this.selectedColor.set(match);
    this.selectedSize.set(null);
    this.qty.set(1);
    this.selectGalleryIndex(0);
    this.resetRestockForm();
  }

  onRestockSizeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.restockSize.set(value === '' ? null : Number(value));
  }

  private applySizeAndNotifyParams(): void {
    if (!this.product()) return;
    const params = this.route.snapshot.queryParamMap;
    const size = params.get('size');
    if (size !== null && this.availableSizes().some(s => s.size === Number(size) && s.inStock)) {
      this.selectedSize.set(Number(size));
      this.qty.set(1);
    }
    if (params.get('notify') === '1' && (this.restockSizes().length || (!this.hasSizeOptions() && !this.selectedSizeInStock()))) {
      this.openRestockForm();
    }
  }

  /**
   * Refuse to buy without a size, and put the size picker where the customer is looking.
   *
   * Keyed off the sizes actually offered rather than `product.sizes`: `sizeOptions` also derives
   * sizes from the variants, and a product whose sizes come only from variants used to pass this
   * guard and then silently open the restock form instead of adding to the cart.
   */
  private requireSizeSelection(): boolean {
    if (!this.hasSizeOptions() || this.selectedSize() !== null) return true;
    this.sizeSelectionError.set(true);

    if (typeof window === 'undefined') return false;

    // On a phone the sheet *is* the size picker. On a laptop the sizes are already on the page, so
    // opening a panel over them would hide the thing we are asking them to look at.
    if (window.matchMedia(MOBILE_SHEET_QUERY).matches) {
      this.openSizePicker();
      return false;
    }

    requestAnimationFrame(() => {
      const section = document.getElementById('size-section');
      section?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      section?.querySelector<HTMLElement>('.size-options .size-btn:not([disabled])')?.focus({ preventScroll: true });
    });
    return false;
  }

  private selectedVariant(product: Product): ProductVariant | undefined {
    return selectedVariant(product, this.selectedColor(), this.selectedSize());
  }

  private productImageForColor(product: Product, color: string, galleryImages: string[]): string | null {
    const key = this.colorKey(color);
    const mappedImage = this.mappedImageForColor(product, key);
    if (mappedImage) return this.resolveGalleryImage(product, mappedImage, galleryImages);

    // Filename hints are a real signal; gallery position is not, so there is no positional guess.
    return galleryImages.find((image) => this.urlContainsColor(image, key)) || null;
  }

  private mappedImageForColor(product: Product, key: string): string | null {
    const colorImages = product.colorImages || {};
    const direct = colorImages[key];
    if (direct) return direct;

    const target = this.colorSlug(key);
    const match = Object.entries(colorImages).find(([color]) => this.colorSlug(color) === target);
    return match?.[1] || null;
  }

  private resolveGalleryImage(product: Product, mappedImage: string, galleryImages: string[]): string {
    const mapped = String(mappedImage || '').trim();
    if (!mapped) return mapped;
    if (galleryImages.includes(mapped)) return mapped;

    const normalizedMapped = this.mediaIdentity(mapped);
    const galleryMatch = galleryImages.find((image) => this.mediaIdentity(image) === normalizedMapped);
    if (galleryMatch) return galleryMatch;

    const variants = product.imageVariants?.[mapped];
    const variantMatch = ['pdp', 'zoom', 'grid', 'card', 'thumb']
      .map((name) => variants?.[name]?.url)
      .find((url): url is string => !!url && galleryImages.includes(url));
    return variantMatch || mapped;
  }

  private urlContainsColor(url: string, colorKey: string): boolean {
    const color = this.colorSlug(colorKey);
    if (!color) return false;
    return this.colorSlug(decodeURIComponent(String(url || ''))).includes(color);
  }

  // Delegate to the shared helpers so the home hero generates `?color=` slugs
  // that match what this page resolves. See utils/color-slug.ts.
  private colorKey(value: string): string {
    return colorKey(value);
  }

  private colorSlug(value: string): string {
    return colorSlug(value);
  }

  private mediaIdentity(url: string): string {
    return String(url || '')
      .trim()
      .split('?')[0]
      .replace(/-(thumb|card|grid|pdp|zoom)(?=\.[a-z0-9]+$)/i, '');
  }

  private compact(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  private resetRestockForm(): void {
    this.restockSize.set(null);
    this.restockFormOpen.set(false);
    this.restockSubmitted.set(false);
    this.restockError.set('');
  }

  private resetReviewForm(): void {
    this.reviewRating.set(null);
    this.reviewDescription.set('');
    this.reviewName.set('');
    this.reviewPhone.set('');
    this.reviewEmail.set('');
    this.reviewContactConsent.set(false);
    this.reviewFieldErrors.set({});
    this.reviewSubmitting.set(false);
    this.reviewSubmitted.set(false);
    this.reviewError.set('');
  }

  private validReviewPhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');
    return /^[+\d\s().-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15;
  }

  private focusFirstReviewError(errors: ReviewFieldErrors): void {
    const id = errors.rating
      ? 'review-star-1'
      : errors.phone
        ? 'review-mobile'
        : errors.email
          ? 'review-email'
          : 'review-contact-consent';
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  private async resolveLegacyCollectionParent(childKey: string): Promise<void> {
    if (!childKey || childKey === 'all' || this.fromParentCollectionHandle()) return;

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<StorefrontCollectionLink[]>>(`${this.apiBase}/collections?limit=100`),
      );
      if (this.fromCollectionHandle() !== childKey || this.fromParentCollectionHandle()) return;

      const parent = (Array.isArray(response.data) ? response.data : []).find((collection) =>
        (collection.children ?? []).some((child) => child.id === childKey || child.handle === childKey),
      );
      if (!parent) return;

      this.fromParentCollectionHandle.set(parent.handle || parent.id);
      this.fromParentCollectionName.set(parent.title);
    } catch {
      // Keep the original top-level collection fallback if hierarchy lookup fails.
    }
  }

}
