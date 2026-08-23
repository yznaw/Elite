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
    imports: [CommonModule],
    templateUrl: './product.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './product.component.scss'
})
export class ProductComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly cart = inject(CartService);
  private readonly productsSvc = inject(ProductsService);
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly analytics = inject(AnalyticsService);
  private readonly apiBase = this.resolveApiBase();

  private feedbackTimer: number | undefined;
  private routeSub?: Subscription;
  private querySub?: Subscription;
  private loadToken = 0;
  private previousBodyOverflow = '';
  private previousBodyPosition = '';
  private previousBodyTop = '';
  private previousBodyWidth = '';
  private previousHtmlOverflow = '';
  private lockedScrollY = 0;
  private bodyScrollLocked = false;
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
    if (!p?.sizes?.length) return [];

    const sizes = [...p.sizes].sort((a, b) => a - b);
    const variants = p.variants || [];
    const fallbackStock = (p.stock ?? 1) > 0;
    if (variants.length === 0) {
      return sizes.map((size) => ({ size, available: true, inStock: fallbackStock }));
    }

    const selectedColorKey = this.selectedColor() ? this.colorKey(this.selectedColor() || '') : '';
    return sizes.map((size) => {
      const sizeVariants = variants.filter((variant) => Number(variant.size) === size);
      if (sizeVariants.length === 0) {
        return { size, available: false, inStock: false };
      }

      const colorScoped = selectedColorKey && sizeVariants.some((variant) => variant.color)
        ? sizeVariants.filter((variant) => this.colorKey(variant.color || '') === selectedColorKey)
        : sizeVariants;
      const available = colorScoped.length > 0;
      const inStock = available && colorScoped.some((variant) => Number(variant.stock) > 0);
      return { size, available, inStock };
    });
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
    const p = this.product();
    if (!p) return false;
    if (!p.sizes?.length) {
      if (p.variants?.length) return p.variants.some(v => v.stock > 0);
      return (p.stock ?? 1) > 0;
    }
    const size = this.selectedSize();
    if (size === null) return false;
    const state = this.availableSizes().find((item) => item.size === size);
    return state ? state.available && state.inStock : false;
  });

  readonly canPurchaseProduct = computed(() => {
    const p = this.product();
    if (!p) return false;
    if (!p.sizes?.length) return this.selectedSizeInStock();
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
    this.unlockBodyScroll();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.reviewOpen()) this.closeReview();
    else if (this.sizePickerOpen()) this.closeSizePicker();
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
    this.selectedColor.set(null);
    this.applyColorParam(this.route.snapshot.queryParamMap.get('color'), nextProduct);
    this.selectedSize.set(null);
    this.sizeSelectionError.set(false);
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.sizeGuideOpen.set(false);
    this.resetRestockForm();
    this.resetReviewForm();
    void this.referenceData.ensureColors();
    this.productLoading.set(false);
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
        behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
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
    this.selectedSize.set(s);
    this.sizeSelectionError.set(false);
    this.closeSizePicker();
    this.resetRestockForm();
  }

  selectProductColor(color: string): void {
    this.selectedColor.set(color);
    this.selectGalleryIndex(0);
    this.selectedSize.set(null);
    this.sizeSelectionError.set(false);
    this.resetRestockForm();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { color: this.colorSlug(color) || null },
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
    this.lockBodyScroll();
  }

  closeSizePicker(): void {
    this.sizePickerOpen.set(false);
    this.unlockBodyScroll();
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
  incQty(): void { this.qty.update((q) => q + 1); }

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
    this.cart.add(this.cartItem(p));
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
    this.cart.add(this.cartItem(p));
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
    this.restockFormOpen.set(true);
    this.restockSubmitted.set(false);
    this.restockError.set('');
    requestAnimationFrame(() => {
      const panel = document.getElementById('restock-panel');
      panel?.scrollIntoView({
        behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      document.getElementById('restock-email')?.focus({ preventScroll: true });
    });
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  onRestockEmailInput(event: Event): void {
    this.restockEmail.set((event.target as HTMLInputElement).value);
  }

  async submitRestockRequest(event?: Event): Promise<void> {
    event?.preventDefault();
    const p = this.product();
    const size = this.selectedSize() ?? p?.sizes?.[0] ?? 0;
    const email = this.restockEmail().trim();
    if (!p || this.restockSubmitting()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.restockError.set(this.t('product.restock.emailError'));
      return;
    }

    this.restockSubmitting.set(true);
    this.restockError.set('');
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiBase}/products/${encodeURIComponent(p.id)}/restock-notifications`, {
          email,
          size,
          color: this.selectedColor(),
          locale: document.documentElement.lang || 'en',
        }),
      );
      this.restockSubmitted.set(true);
      this.restockFormOpen.set(false);
    } catch {
      this.restockError.set(this.t('product.restock.submitError'));
    } finally {
      this.restockSubmitting.set(false);
    }
  }

  openReview(): void {
    if (this.reviewSubmitted()) this.resetReviewForm();
    this.reviewTrigger = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
    this.reviewOpen.set(true);
    this.lockBodyScroll();
  }

  closeReview(): void {
    this.reviewOpen.set(false);
    this.unlockBodyScroll();
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

  private cartItem(p: Product) {
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
      size: this.selectedSize() ?? p.sizes?.[0] ?? 0,
      qty: this.qty(),
    };
  }

  private productColors(product: Product): string[] {
    return this.compact([product.color, ...(product.colors || [])]);
  }

  private applyColorParam(colorParam: string | null, product = this.product()): void {
    if (!product || !colorParam) return;
    const target = this.colorSlug(colorParam);
    const match = this.productColors(product).find((color) => this.colorSlug(color) === target);
    if (!match || this.colorSelected(match)) return;

    this.selectedColor.set(match);
    this.selectGalleryIndex(0);
    this.resetRestockForm();
  }

  private requireSizeSelection(): boolean {
    const p = this.product();
    if (!p?.sizes?.length || this.selectedSize() !== null) return true;
    this.sizeSelectionError.set(true);
    this.openSizePicker();
    return false;
  }

  private selectedVariant(product: Product): ProductVariant | undefined {
    const size = this.selectedSize();
    const selectedColorKey = this.selectedColor() ? this.colorKey(this.selectedColor() || '') : '';
    const variants = product.variants || [];
    return variants.find((variant) => {
      const sizeMatches = !size || Number(variant.size) === size;
      const colorMatches = !selectedColorKey || this.colorKey(variant.color || '') === selectedColorKey;
      return sizeMatches && colorMatches;
    });
  }

  private productImageForColor(product: Product, color: string, galleryImages: string[]): string | null {
    const key = this.colorKey(color);
    const mappedImage = this.mappedImageForColor(product, key);
    if (mappedImage) return this.resolveGalleryImage(product, mappedImage, galleryImages);

    const hintedImage = galleryImages.find((image) => this.urlContainsColor(image, key));
    if (hintedImage) return hintedImage;

    const colors = this.productColors(product);
    const colorIndex = colors.findIndex((item) => this.colorKey(item) === key);
    return colorIndex >= 0 && galleryImages.length >= colors.length ? galleryImages[colorIndex] || null : null;
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

  private unlockBodyScroll(): void {
    if (!this.bodyScrollLocked) return;
    const scrollY = this.lockedScrollY;
    document.body.style.overflow = this.previousBodyOverflow;
    document.body.style.position = this.previousBodyPosition;
    document.body.style.top = this.previousBodyTop;
    document.body.style.width = this.previousBodyWidth;
    document.documentElement.style.overflow = this.previousHtmlOverflow;
    this.bodyScrollLocked = false;
    window.scrollTo(0, scrollY);
  }

  private lockBodyScroll(): void {
    if (this.bodyScrollLocked) return;

    this.lockedScrollY = window.scrollY;
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousBodyPosition = document.body.style.position;
    this.previousBodyTop = document.body.style.top;
    this.previousBodyWidth = document.body.style.width;
    this.previousHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    if (window.matchMedia('(max-width: 759px)').matches) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${this.lockedScrollY}px`;
      document.body.style.width = '100%';
    }

    this.bodyScrollLocked = true;
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

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
