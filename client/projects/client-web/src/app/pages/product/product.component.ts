import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { CartService } from '../../services/cart.service';
import { ProductsService } from '../../services/products.service';
import { Product, ProductVariant } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { AnalyticsService } from '../../services/analytics.service';

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

const FALLBACK_IMAGE = '/assets/brand/elite-logo-green.png';

@Component({
  selector: 'cw-product',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product.component.html',
  styleUrl: './product.component.scss',
})
export class ProductComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly cart = inject(CartService);
  private readonly productsSvc = inject(ProductsService);
  private readonly i18n = inject(I18nService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly analytics = inject(AnalyticsService);
  private readonly apiBase = this.resolveApiBase();

  private feedbackTimer: number | undefined;
  private routeSub?: Subscription;
  private querySub?: Subscription;
  private loadToken = 0;
  private previousBodyOverflow = '';
  private bodyScrollLocked = false;
  private thumbStrip?: HTMLElement;
  private thumbStripResizeObserver?: ResizeObserver;
  private thumbStripMutationObserver?: MutationObserver;

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
  readonly thumbStripOverflows = signal(false);
  readonly selectedSize = signal<number | null>(null);
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

  readonly selectedSizeInStock = computed(() => {
    const p = this.product();
    if (!p) return false;
    if (!p.sizes?.length) {
      if (p.variants?.length) return p.variants.some(v => v.stock > 0);
      return (p.stock ?? 1) > 0;
    }
    const size = this.selectedSize();
    if (!size) return true;
    const state = this.availableSizes().find((item) => item.size === size);
    return state ? state.available && state.inStock : false;
  });

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productTag = (value: string): string => this.i18n.productTag(value);

  @ViewChild('thumbStrip')
  set thumbStripElement(element: ElementRef<HTMLElement> | undefined) {
    this.thumbStripResizeObserver?.disconnect();
    this.thumbStripMutationObserver?.disconnect();
    this.thumbStrip = element?.nativeElement;

    if (!this.thumbStrip) {
      this.thumbStripOverflows.set(false);
      return;
    }

    queueMicrotask(() => this.updateThumbStripOverflow());

    if (typeof ResizeObserver !== 'undefined') {
      this.thumbStripResizeObserver = new ResizeObserver(() => this.updateThumbStripOverflow());
      this.thumbStripResizeObserver.observe(this.thumbStrip);
    }

    if (typeof MutationObserver !== 'undefined') {
      this.thumbStripMutationObserver = new MutationObserver(() => this.updateThumbStripOverflow());
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
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.unlockBodyScroll();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
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
    this.selectedColor.set(null);
    this.applyColorParam(this.route.snapshot.queryParamMap.get('color'), nextProduct);
    this.selectedSize.set(this.defaultSizeForProduct(nextProduct));
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.sizeGuideOpen.set(false);
    this.resetRestockForm();
    void this.referenceData.ensureColors();
    this.productLoading.set(false);
  }

  goToProduct(nextProduct: Product): void {
    this.product.set(nextProduct);
    this.galleryIdx.set(0);
    this.selectedSize.set(nextProduct.sizes[0] ?? null);
    this.selectedColor.set(null);
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.sizeGuideOpen.set(false);
    this.resetRestockForm();
    void this.router.navigate(['/product', nextProduct.id], {
      queryParamsHandling: 'preserve',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setGalleryIdx(i: number): void {
    this.galleryIdx.set(i);
  }

  scrollThumbnails(): void {
    if (!this.thumbStrip) return;
    const direction = getComputedStyle(this.thumbStrip).direction === 'rtl' ? -1 : 1;
    this.thumbStrip.scrollBy({
      left: direction * Math.max(this.thumbStrip.clientWidth * 0.7, 160),
      behavior: 'smooth',
    });
  }

  navGallery(dir: number): void {
    this.galleryIdx.update(
      (i) => (i + dir + this.gallery().length) % this.gallery().length,
    );
  }

  private updateThumbStripOverflow(): void {
    const strip = this.thumbStrip;
    this.thumbStripOverflows.set(!!strip && strip.scrollWidth > strip.clientWidth + 1);
  }

  selectSize(s: number): void {
    this.selectedSize.set(s);
    this.sizePickerOpen.set(false);
    this.resetRestockForm();
  }

  selectProductColor(color: string): void {
    this.selectedColor.set(color);
    this.galleryIdx.set(0);
    this.selectedSize.set(this.defaultSizeForProduct(this.product()));
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
  }

  closeSizePicker(): void {
    this.sizePickerOpen.set(false);
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
    this.resetReviewForm();
    this.reviewOpen.set(true);
    if (!this.bodyScrollLocked) {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      this.bodyScrollLocked = true;
    }
  }

  closeReview(): void {
    this.reviewOpen.set(false);
    this.unlockBodyScroll();
  }

  selectReviewRating(rating: number): void {
    this.reviewRating.set(this.reviewRating() === rating ? null : rating);
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
  }

  onReviewEmailInput(event: Event): void {
    this.reviewEmail.set((event.target as HTMLInputElement).value);
  }

  async submitReview(event?: Event): Promise<void> {
    event?.preventDefault();
    const product = this.product();
    const body = this.reviewDescription().trim();
    const rating = this.reviewRating();
    const email = this.reviewEmail().trim();
    if (!product || this.reviewSubmitting()) return;

    if (!rating && !body) {
      this.reviewError.set(this.t('product.review.validation'));
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.reviewError.set(this.t('product.review.emailError'));
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
            authorPhone: this.reviewPhone().trim() || null,
            authorEmail: email || null,
            source: 'storefront',
          },
        ),
      );
      this.reviewSubmitted.set(true);
    } catch {
      this.reviewError.set(this.t('product.review.error'));
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
    this.galleryIdx.set(0);
    this.resetRestockForm();
  }

  private defaultSizeForProduct(product: Product | null): number | null {
    if (!product?.sizes?.length) return null;
    const current = this.selectedSize();
    const sizes = this.availableSizes();
    if (current && sizes.some((item) => item.size === current && item.available && item.inStock)) return current;

    return sizes.find((item) => item.available && item.inStock)?.size
      ?? sizes.find((item) => item.available)?.size
      ?? product.sizes[0]
      ?? null;
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

  private colorKey(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private colorSlug(value: string): string {
    return this.colorKey(value).replace(/[^a-z0-9]+/g, '');
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
    this.reviewSubmitting.set(false);
    this.reviewSubmitted.set(false);
    this.reviewError.set('');
  }

  private unlockBodyScroll(): void {
    if (!this.bodyScrollLocked) return;
    document.body.style.overflow = this.previousBodyOverflow;
    this.bodyScrollLocked = false;
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
