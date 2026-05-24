import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';

interface Accordion {
  id: string;
  titleKey: string;
  contentKey: string;
}

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=900&q=85&auto=format&fit=crop';

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
  private readonly cart = inject(CartService);
  private readonly productsSvc = inject(ProductsService);
  private readonly i18n = inject(I18nService);

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
  readonly openAccordion = signal<string | null>(null);
  readonly addedFeedback = signal(false);
  readonly wishlisted = signal(false);
  readonly qty = signal(1);
  readonly sizePickerOpen = signal(false);

  readonly gallery = computed(() => {
    const p = this.product();
    if (!p) return [FALLBACK_IMAGE];
    const images = [...(p.images ?? []), p.image]
      .map((src) => String(src || '').trim())
      .filter(Boolean);
    return images.length ? [...new Set(images)] : [FALLBACK_IMAGE];
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
    this.sizePickerOpen.set(false);
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
    this.qty.set(1);
    this.sizePickerOpen.set(false);
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
    this.cart.add(this.cartItem(p));
    this.addedFeedback.set(true);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => this.addedFeedback.set(false), 2200);
  }

  buyNow(): void {
    const p = this.product();
    if (!p) return;
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

  private cartItem(p: Product) {
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      image: this.gallery()[this.galleryIdx()] ?? p.image,
      leather: p.leather,
      size: this.selectedSize() ?? p.sizes[0] ?? 40,
      qty: this.qty(),
    };
  }
}
