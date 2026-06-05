import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CartService } from '../../services/cart.service';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';

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

interface RefColor {
  id: string;
  name_en: string;
  name_ar: string;
  hex: string;
  sort_order: number;
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
  private readonly apiBase = this.resolveApiBase();

  private feedbackTimer: number | undefined;

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
  readonly galleryIdx = signal(0);
  readonly selectedSize = signal<number | null>(null);
  readonly selectedColor = signal<string | null>(null);
  readonly colorHexByName = signal<Record<string, string>>({});
  readonly openAccordion = signal<string | null>(null);
  readonly addedFeedback = signal(false);
  readonly wishlisted = signal(false);
  readonly qty = signal(1);
  readonly sizePickerOpen = signal(false);
  readonly restockFormOpen = signal(false);
  readonly restockEmail = signal('');
  readonly restockSubmitting = signal(false);
  readonly restockSubmitted = signal(false);
  readonly restockError = signal('');

  readonly gallery = computed(() => {
    const p = this.product();
    if (!p) return [FALLBACK_IMAGE];
    const selectedColorImage = this.selectedColor()
      ? this.productImageForColor(p, this.selectedColor() || '')
      : null;
    const images = [...(p.images ?? []), p.image]
      .map((src) => String(src || '').trim())
      .filter(Boolean);
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

  readonly selectedSizeInStock = computed(() => {
    const p = this.product();
    if (!p) return false;
    // Size-optional products (sunglasses, accessories): always in-stock check by total stock
    if (!p.sizes?.length) return p.variants?.some(v => v.stock > 0) ?? true;
    const size = this.selectedSize();
    if (!size) return true; // no size chosen yet — don't block CTA
    return this.sizeInStock(p, size);
  });

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productTag = (value: string): string => this.i18n.productTag(value);

  async ngOnInit(): Promise<void> {
    const idParam = this.route.snapshot.paramMap.get('id');
    await this.productsSvc.refresh();
    const p = idParam ? this.productsSvc.getById(idParam) : undefined;
    const nextProduct = p ?? this.productsSvc.getAll()[0];
    this.product.set(nextProduct);
    this.galleryIdx.set(0);
    this.selectedSize.set(nextProduct?.sizes[0] ?? null);
    this.selectedColor.set(null);
    this.sizePickerOpen.set(false);
    this.resetRestockForm();
    void this.loadReferenceColors();
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  goCollection(): void {
    void this.router.navigate(['/collection']);
  }

  goToProduct(nextProduct: Product): void {
    this.product.set(nextProduct);
    this.galleryIdx.set(0);
    this.selectedSize.set(nextProduct.sizes[0] ?? null);
    this.selectedColor.set(null);
    this.qty.set(1);
    this.sizePickerOpen.set(false);
    this.resetRestockForm();
    void this.router.navigate(['/product', nextProduct.id]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setGalleryIdx(i: number): void {
    this.galleryIdx.set(i);
  }

  navGallery(dir: number): void {
    this.galleryIdx.update(
      (i) => (i + dir + this.gallery().length) % this.gallery().length,
    );
  }

  selectSize(s: number): void {
    this.selectedSize.set(s);
    this.sizePickerOpen.set(false);
    this.resetRestockForm();
  }

  selectProductColor(color: string): void {
    this.selectedColor.set(color);
    this.galleryIdx.set(0);
    this.resetRestockForm();
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

  sizeInStock(product: Product, size: number): boolean {
    const variants = product.variants || [];
    if (variants.length === 0) return true;

    const matchingSize = variants.filter((variant) => Number(variant.size) === size);
    if (matchingSize.length === 0) return true;

    const selectedColor = this.selectedColor();
    if (selectedColor && matchingSize.some((variant) => variant.color)) {
      return matchingSize
        .filter((variant) => this.colorKey(variant.color || '') === this.colorKey(selectedColor))
        .some((variant) => Number(variant.stock) > 0);
    }

    return matchingSize.some((variant) => Number(variant.stock) > 0);
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

  private cartItem(p: Product) {
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      image: this.gallery()[this.galleryIdx()] ?? p.image,
      leather: p.leather,
      size: this.selectedSize() ?? p.sizes?.[0] ?? 0,
      qty: this.qty(),
    };
  }

  private productColors(product: Product): string[] {
    return this.compact([product.color, ...(product.colors || [])]);
  }

  private productImageForColor(product: Product, color: string): string | null {
    const key = this.colorKey(color);
    const mappedImage = product.colorImages?.[key];
    if (mappedImage) return mappedImage;

    const colors = this.productColors(product);
    const images = product.images || [];
    const colorIndex = colors.findIndex((item) => this.colorKey(item) === key);
    return colorIndex >= 0 && images.length >= colors.length ? images[colorIndex] || null : null;
  }

  private colorKey(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private compact(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  private resetRestockForm(): void {
    this.restockFormOpen.set(false);
    this.restockSubmitted.set(false);
    this.restockError.set('');
  }

  private async loadReferenceColors(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<RefColor[]>>(`${this.apiBase}/ref/colors`),
      );
      const colors = Array.isArray(res.data) ? res.data : [];
      this.colorHexByName.set(colors.reduce<Record<string, string>>((map, color) => {
        const name = String(color.name_en || '').trim().toLowerCase();
        const hex = String(color.hex || '').trim();
        if (name && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
          map[name] = hex;
        }
        return map;
      }, {}));
    } catch {
      this.colorHexByName.set({});
    }
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
