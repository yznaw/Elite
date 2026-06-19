import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Subscription, combineLatest, firstValueFrom } from 'rxjs';
import { ProductsService } from '../../services/products.service';
import { Product, ProductVariant } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';
import { CartService } from '../../services/cart.service';
import { ReferenceDataService } from '../../services/reference-data.service';

const SORT_OPTIONS = ['Featured', 'Price: Low–High', 'Price: High–Low', 'Newest'] as const;
const FALLBACK_IMAGE = '/assets/brand/elite-logo-green.png';
const FILTER_TITLES = {
  category: 'Categories',
  price: 'Price',
  color: 'Colors',
  leather: 'Leather',
  material: 'Materials',
  size: 'Sizes',
  brand: 'Brand',
  tag: 'Best For',
} as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type FilterGroupId = keyof typeof FILTER_TITLES;
type CollapsibleFilterGroupId = FilterGroupId | 'sort';

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

interface FilterGroup {
  id: FilterGroupId;
  title: string;
  options: FilterOption[];
}

type SelectedFilters = Record<FilterGroupId, string[]>;

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface StorefrontChildCollection {
  id: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  productIds: string[];
}

interface StorefrontCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  imageUrl: string | null;
  productIds: string[];
  parentId: string | null;
  children: StorefrontChildCollection[];
}

@Component({
  selector: 'cw-collection',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection.component.html',
  styleUrl: './collection.component.scss',
})
export class CollectionComponent implements OnInit, OnDestroy {
  private readonly products = inject(ProductsService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly cart = inject(CartService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly apiBase = this.resolveApiBase();
  private addedTimer: number | undefined;
  private mobileMediaQuery?: MediaQueryList;
  private mobileMediaQueryHandler?: () => void;
  private routeSyncSub?: Subscription;

  readonly sortOptions = SORT_OPTIONS;
  readonly sort = signal<SortOption>('Featured');
  readonly hovered = signal<string | null>(null);
  readonly addedProductId = signal<string | null>(null);
  readonly collections = signal<StorefrontCollection[]>([]);
  readonly collectionsLoaded = signal(false);
  readonly productsLoading = this.products.loading;
  readonly productsLoaded = this.products.loaded;
  readonly productsError = this.products.error;
  readonly activeCollectionKey = signal<string | null>(null);
  readonly activeSubCollectionKey = signal<string | null>(null);
  readonly colorHexByName = this.referenceData.colorHexByName;
  readonly colorSwatchImageByName = this.referenceData.colorSwatchImageByName;
  readonly filtersOpen = signal(false);
  readonly expandedFilterGroups = signal<Partial<Record<CollapsibleFilterGroupId, boolean>>>({});
  readonly isMobileView = signal(false);
  readonly mobilePage = signal(0);
  readonly mobilePageSize = 10;
  readonly selectedSizes = signal<Record<string, number>>({});
  readonly selectedColors = signal<Record<string, string>>({});
  readonly selectedFilters = signal<SelectedFilters>(this.emptySelectedFilters());

  readonly t = (key: string): string => this.i18n.t(key);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productStyle = (value: string): string => this.i18n.productStyle(value);
  readonly productTag = (value: string): string => this.i18n.productTag(value);

  readonly allProducts = computed<Product[]>(() => this.products.getAll());
  readonly activeCollection = computed(() => (
    this.findCollection(this.activeCollectionKey()) ?? null
  ));

  readonly activeSubCollection = computed((): StorefrontChildCollection | null => {
    const key = this.activeSubCollectionKey();
    if (!key) return null;
    const children = this.activeCollection()?.children ?? [];
    return children.find((c) => c.handle === key || c.id === key) ?? null;
  });

  readonly activeCollectionDisplayTitle = computed(() => {
    if (this.activeSubCollectionKey() === 'all') {
      return `${this.activeCollection()?.title ?? ''} / All`;
    }
    const sub = this.activeSubCollection();
    if (sub) return `${this.activeCollection()?.title ?? ''} / ${sub.title}`;
    return this.activeCollection()?.title ?? '';
  });

  readonly showCollectionCatalog = computed(() => {
    const collection = this.activeCollection();
    if (!collection) return false;
    return collection.children.length === 0 || this.activeSubCollectionKey() !== null;
  });

  /** Total unique product count across the parent + all its sub-collections. */
  readonly activeCollectionTotalCount = computed((): number => {
    const col = this.activeCollection();
    if (!col) return 0;
    const ids = new Set<string>([
      ...col.productIds,
      ...(col.children ?? []).flatMap((c) => c.productIds),
    ]);
    return ids.size;
  });

  readonly isCollectionLanding = computed(() => !this.activeCollectionKey());

  readonly filterGroups = computed<FilterGroup[]>(() => {
    const products = this.collectionScopedProducts();
    const groups: FilterGroup[] = [
      {
        id: 'category',
        title: FILTER_TITLES.category,
        options: this.optionsFromProducts(products, (p) => this.productCategories(p), (value) => this.productStyle(value)),
      },
      {
        id: 'price',
        title: FILTER_TITLES.price,
        options: this.priceOptions(products),
      },
      {
        id: 'color',
        title: FILTER_TITLES.color,
        options: this.optionsFromProducts(products, (p) => this.productColors(p)),
      },
      {
        id: 'leather',
        title: FILTER_TITLES.leather,
        options: this.optionsFromProducts(products, (p) => this.productLeathers(p), (value) => this.productLeather(value)),
      },
      {
        id: 'material',
        title: FILTER_TITLES.material,
        options: this.optionsFromProducts(products, (p) => this.productMaterials(p)),
      },
      {
        id: 'size',
        title: FILTER_TITLES.size,
        options: this.optionsFromProducts(products, (p) => p.sizes.map(String), (value) => value, true),
      },
      {
        id: 'brand',
        title: FILTER_TITLES.brand,
        options: this.optionsFromProducts(products, (p) => this.compact([p.brand])),
      },
      {
        id: 'tag',
        title: FILTER_TITLES.tag,
        options: this.optionsFromProducts(products, (p) => this.compact([p.tag]), (value) => this.productTag(value)),
      },
    ];

    return groups.filter((group) => group.options.length > 0);
  });

  readonly activeFilterCount = computed(() => (
    Object.values(this.selectedFilters()).reduce((total, values) => total + values.length, 0)
  ));

  readonly filtered = computed<Product[]>(() => {
    const selected = this.selectedFilters();
    let list = this.collectionScopedProducts().filter((product) => this.matchesFilters(product, selected));
    const so = this.sort();

    if (so === 'Price: Low–High') list = [...list].sort((a, b) => a.price - b.price);
    if (so === 'Price: High–Low') list = [...list].sort((a, b) => b.price - a.price);

    return list;
  });

  readonly visibleProducts = computed<Product[]>(() => {
    const list = this.filtered();
    if (!this.isMobileView()) return list;
    const start = this.mobilePage() * this.mobilePageSize;
    return list.slice(start, start + this.mobilePageSize);
  });

  readonly mobileTotalPages = computed(() => (
    this.isMobileView() ? Math.max(1, Math.ceil(this.filtered().length / this.mobilePageSize)) : 1
  ));

  readonly showMobilePagination = computed(() => (
    this.isMobileView() && this.filtered().length > this.mobilePageSize
  ));

  ngOnInit(): void {
    void this.products.ensureLoaded();
    void this.loadCollections();
    void this.referenceData.ensureColors();
    this.setupMobilePagination();
    this.routeSyncSub = combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, query]) => {
      this.syncRouteState(params, query);
    });
  }

  ngOnDestroy(): void {
    this.routeSyncSub?.unsubscribe();
    if (this.mobileMediaQuery && this.mobileMediaQueryHandler) {
      this.mobileMediaQuery.removeEventListener('change', this.mobileMediaQueryHandler);
    }
  }

  goToProduct(p: Product): void {
    const active = this.activeCollection();
    const sub = this.activeSubCollection();
    const selectedColor = this.selectedProductColor(p);
    const queryParams: Record<string, string> = {};
    if (sub) {
      queryParams['col'] = sub.handle || sub.id;
      queryParams['colName'] = sub.title;
    } else if (active) {
      queryParams['col'] = active.handle || active.id;
      queryParams['colName'] = active.title;
    }
    if (selectedColor) queryParams['color'] = this.colorSlug(selectedColor);
    const extras = Object.keys(queryParams).length ? { queryParams } : undefined;
    void this.router.navigate(['/product', p.id], extras);
    window.scrollTo(0, 0);
  }

  setSort(s: SortOption): void {
    this.sort.set(s);
    this.mobilePage.set(0);
  }

  toggleFilterGroup(groupId: CollapsibleFilterGroupId): void {
    this.expandedFilterGroups.update((groups) => ({
      ...groups,
      [groupId]: !this.isFilterGroupExpanded(groupId),
    }));
  }

  expandAllFilters(): void {
    this.setAllFilterGroups(true);
  }

  collapseAllFilters(): void {
    this.setAllFilterGroups(false);
  }

  isFilterGroupExpanded(groupId: CollapsibleFilterGroupId): boolean {
    return this.expandedFilterGroups()[groupId] ?? true;
  }

  filterGroupPanelId(groupId: CollapsibleFilterGroupId): string {
    return `collection-filter-${groupId}`;
  }

  private setAllFilterGroups(expanded: boolean): void {
    const groups = this.filterGroups().reduce<Partial<Record<CollapsibleFilterGroupId, boolean>>>(
      (map, group) => ({ ...map, [group.id]: expanded }),
      { sort: expanded },
    );
    this.expandedFilterGroups.set(groups);
  }

  openFilters(): void {
    this.filtersOpen.set(true);
  }

  closeFilters(): void {
    this.filtersOpen.set(false);
  }

  selectCollection(collection: StorefrontCollection | null): void {
    this.selectedFilters.set(this.emptySelectedFilters());
    this.mobilePage.set(0);
    const route = collection
      ? ['/collection', collection.handle || collection.id]
      : ['/collection'];
    void this.router.navigate(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  selectSubCollection(sub: StorefrontChildCollection | null): void {
    const parent = this.activeCollection();
    if (!parent) return;
    this.selectedFilters.set(this.emptySelectedFilters());
    this.mobilePage.set(0);
    if (!sub) {
      void this.router.navigate(['/collection', parent.handle || parent.id, 'all']);
    } else {
      void this.router.navigate(['/collection', parent.handle || parent.id, sub.handle || sub.id]);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  selectSize(product: Product, size: number): void {
    this.selectedSizes.update((sizes) => ({ ...sizes, [product.id]: size }));
  }

  sizeSelectValue(event: Event): number {
    return Number.parseInt((event.target as HTMLSelectElement).value, 10);
  }

  previewProductColor(product: Product, color: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.selectedColors.update((colors) => ({ ...colors, [product.id]: color }));
    this.selectedSizes.update((sizes) => {
      const available = this.availableSizes(product, color);
      const current = sizes[product.id];
      if (current && available.includes(current)) return sizes;
      const nextSize = available[0] ?? product.sizes[0] ?? 40;
      return { ...sizes, [product.id]: nextSize };
    });
  }

  selectProductColor(product: Product, color: string, event?: Event): void {
    this.previewProductColor(product, color, event);
  }

  clearProductColorPreview(product: Product): void {
    this.selectedColors.update((colors) => {
      const next = { ...colors };
      delete next[product.id];
      return next;
    });
  }

  onProductColorKeydown(product: Product, color: string, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    this.selectProductColor(product, color, event);
  }

  addToCart(product: Product): void {
    this.cart.add(this.cartItem(product));

    this.addedProductId.set(product.id);
    if (this.addedTimer) window.clearTimeout(this.addedTimer);
    this.addedTimer = window.setTimeout(() => this.addedProductId.set(null), 1800);
  }

  buyNow(product: Product): void {
    this.cart.add(this.cartItem(product));
    this.cart.closeDrawer();
    void this.router.navigate(['/checkout']);
    window.scrollTo(0, 0);
  }

  selectedSize(product: Product): number {
    const available = this.availableSizes(product);
    const selected = this.selectedSizes()[product.id];
    if (selected && available.includes(selected)) return selected;
    return available[0] ?? product.sizes[0] ?? 40;
  }

  selectedProductColor(product: Product): string | null {
    return this.selectedColors()[product.id] || null;
  }

  selectedProductImage(product: Product): string {
    const selectedColor = this.selectedProductColor(product);
    if (!selectedColor) return product.image;

    return this.productImageForColor(product, selectedColor) || product.image;
  }

  productImageSrcset(product: Product): string | null {
    return this.srcsetFor(this.selectedProductImage(product), product);
  }

  productColorNames(product: Product): string[] {
    return this.productColors(product);
  }

  availableSizes(product: Product, color = this.selectedProductColor(product)): number[] {
    const variants = product.variants || [];
    if (!color || variants.length === 0) return product.sizes;

    const colorKey = this.colorKey(color);
    const sizes = variants
      .filter((variant) => this.colorKey(variant.color || '') === colorKey)
      .filter((variant) => Number(variant.stock) > 0)
      .map((variant) => Number(variant.size))
      .filter(Number.isFinite);

    return [...new Set(sizes)].sort((a, b) => a - b);
  }

  colorHex(name: string): string {
    const value = name.trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;

    return this.colorHexByName()[value.toLowerCase()] ?? '#d8d2c8';
  }

  colorSwatchImage(name: string): string | null {
    return this.colorSwatchImageByName()[this.colorKey(name)] ?? null;
  }

  colorSelected(product: Product, color: string): boolean {
    return this.colorKey(this.selectedProductColor(product) || '') === this.colorKey(color);
  }

  onProductTileLeave(product: Product): void {
    this.hovered.set(null);
    this.clearProductColorPreview(product);
  }

  toggleFilter(groupId: FilterGroupId, value: string): void {
    this.selectedFilters.update((current) => {
      const values = current[groupId];
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];

      return { ...current, [groupId]: nextValues };
    });
    this.mobilePage.set(0);
  }

  isFilterSelected(groupId: FilterGroupId, value: string): boolean {
    return this.selectedFilters()[groupId].includes(value);
  }

  selectedFilterCount(groupId: FilterGroupId): number {
    return this.selectedFilters()[groupId].length;
  }

  clearFilters(): void {
    this.selectedFilters.set(this.emptySelectedFilters());
    this.sort.set('Featured');
    this.filtersOpen.set(false);
    this.mobilePage.set(0);
  }

  retryProducts(): void {
    void this.products.refresh();
  }

  showAllCollections(): void {
    this.selectedFilters.set(this.emptySelectedFilters());
    this.sort.set('Featured');
    this.mobilePage.set(0);
    void this.router.navigate(['/collection']);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  prevMobilePage(): void {
    this.mobilePage.update((page) => Math.max(0, page - 1));
  }

  nextMobilePage(): void {
    this.mobilePage.update((page) => Math.min(this.mobileTotalPages() - 1, page + 1));
  }

  sortLabel(value: SortOption): string {
    const keys: Record<SortOption, string> = {
      Featured: 'collection.sort.featured',
      'Price: Low–High': 'collection.sort.priceLowHigh',
      'Price: High–Low': 'collection.sort.priceHighLow',
      Newest: 'collection.sort.newest',
    };
    return this.t(keys[value]);
  }

  private syncRouteState(params: ParamMap, query: ParamMap): void {
    // `/collection/:parent/:child` → parent is the collection, child is the sub-collection.
    // `/collection/:collection` → single-level, no sub-collection active.
    const parentKey = params.get('parent') ?? params.get('collection');
    const childKey = params.get('child') ?? null;
    const hasQueryFilter = query.has('sort') || query.has('tag');
    this.activeCollectionKey.set(parentKey || (hasQueryFilter ? 'all-products' : null));
    this.activeSubCollectionKey.set(childKey);
    this.selectedFilters.set(this.emptySelectedFilters());
    this.filtersOpen.set(false);
    this.mobilePage.set(0);

    const sort = query.get('sort');
    if (sort) {
      const normalizedSort = this.normalizeSort(sort);
      if (normalizedSort) this.sort.set(normalizedSort);
    } else {
      this.sort.set('Featured');
    }

    const tag = query.get('tag');
    if (tag) {
      this.selectedFilters.update((filters) => ({
        ...filters,
        tag: [this.normalizeTag(tag)],
      }));
    }
  }

  onImgError(e: Event): void {
    const img = e.target as HTMLImageElement;
    if (img.src !== FALLBACK_IMAGE) {
      img.src = FALLBACK_IMAGE;
      return;
    }
    img.style.display = 'none';
  }

  private matchesFilters(product: Product, selected: SelectedFilters): boolean {
    return this.matchesTextFilter(selected.category, this.productCategories(product))
      && this.matchesTextFilter(selected.color, this.productColors(product))
      && this.matchesTextFilter(selected.leather, this.productLeathers(product))
      && this.matchesTextFilter(selected.material, this.productMaterials(product))
      && this.matchesTextFilter(selected.size, product.sizes.map(String))
      && this.matchesTextFilter(selected.brand, this.compact([product.brand]))
      && this.matchesTextFilter(selected.tag, this.compact([product.tag]))
      && this.matchesPriceFilter(selected.price, product.price);
  }

  private cartItem(product: Product) {
    const variant = this.selectedVariant(product);
    const color = this.selectedProductColor(product) || variant?.color || this.productColors(product)[0] || null;
    return {
      id: product.id,
      variantId: variant?.id,
      sku: variant?.sku,
      name: product.name,
      price: variant?.price || product.price,
      image: color ? this.productImageForColor(product, color) || product.image : this.selectedProductImage(product),
      leather: product.leather,
      color,
      size: this.selectedSize(product),
      qty: 1,
    };
  }

  private collectionScopedProducts(): Product[] {
    const collection = this.activeCollection();
    if (!collection) return this.allProducts();
    if (collection.handle === 'all-products') return this.allProducts();

    const sub = this.activeSubCollection();
    if (sub) {
      // Viewing a specific sub-collection: keep the sub's own ordering.
      return this.productsFromIds(sub.productIds);
    }

    // Viewing a parent collection: show child-linked products first, then parent-only products.
    const orderedIds = this.orderedCollectionProductIds(collection);
    return this.productsFromIds(orderedIds);
  }

  private findCollection(key: string | null): StorefrontCollection | undefined {
    if (!key) return undefined;
    return this.collections().find((collection) => collection.id === key || collection.handle === key);
  }

  private productsFromIds(ids: string[]): Product[] {
    if (!ids.length) return [];

    const byId = new Map(this.allProducts().map((product) => [product.id, product] as const));
    const seen = new Set<string>();
    const ordered: Product[] = [];

    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const product = byId.get(id);
      if (product) ordered.push(product);
    }

    return ordered;
  }

  private orderedCollectionProductIds(collection: StorefrontCollection): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const pushIds = (ids: string[]) => {
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        ordered.push(id);
      }
    };

    // Child collections first, then any products linked directly to the parent.
    for (const child of collection.children ?? []) {
      pushIds(child.productIds || []);
    }
    pushIds(collection.productIds || []);

    return ordered;
  }

  private matchesTextFilter(selected: string[], values: string[]): boolean {
    return selected.length === 0 || selected.some((value) => values.includes(value));
  }

  private matchesPriceFilter(selected: string[], price: number): boolean {
    if (selected.length === 0) return true;

    return selected.some((range) => {
      const [minRaw, maxRaw] = range.split(':');
      const min = Number(minRaw);
      const max = Number(maxRaw);
      return price >= min && (Number.isNaN(max) || price <= max);
    });
  }

  private optionsFromProducts(
    products: Product[],
    readValues: (product: Product) => string[],
    labelFor: (value: string) => string = (value) => value,
    numeric = false,
  ): FilterOption[] {
    const counts = new Map<string, number>();

    products.forEach((product) => {
      new Set(readValues(product)).forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });

    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: labelFor(value), count }))
      .sort((a, b) => numeric
        ? Number(a.value) - Number(b.value)
        : a.label.localeCompare(b.label));
  }

  private priceOptions(products: Product[]): FilterOption[] {
    const prices = products
      .map((product) => product.price)
      .filter((price) => Number.isFinite(price))
      .sort((a, b) => a - b);

    if (prices.length === 0) return [];

    const min = prices[0];
    const max = prices[prices.length - 1];

    if (min === max) {
      return [{
        value: `${min}:`,
        label: this.price(min),
        count: prices.length,
      }];
    }

    const lowEnd = this.roundPrice(min + ((max - min) / 3));
    const midEnd = this.roundPrice(min + (((max - min) / 3) * 2));
    const ranges = [
      { value: `${min}:${lowEnd}`, label: `Under ${this.price(lowEnd)}` },
      { value: `${lowEnd + 1}:${midEnd}`, label: `${this.price(lowEnd + 1)} - ${this.price(midEnd)}` },
      { value: `${midEnd + 1}:`, label: `${this.price(midEnd + 1)}+` },
    ];

    return ranges
      .map((range) => ({
        ...range,
        count: products.filter((product) => this.matchesPriceFilter([range.value], product.price)).length,
      }))
      .filter((range) => range.count > 0);
  }

  private roundPrice(value: number): number {
    if (value < 500) return Math.ceil(value / 50) * 50;
    return Math.ceil(value / 500) * 500;
  }

  private productCategories(product: Product): string[] {
    return this.compact([product.category, ...(product.categories || []), product.style]);
  }

  private productColors(product: Product): string[] {
    return this.compact([product.color, ...(product.colors || [])]);
  }

  private productImageForColor(product: Product, color: string): string | null {
    const key = this.colorKey(color);
    const mappedImage = this.mappedImageForColor(product, key);
    if (mappedImage) return mappedImage;

    const colors = this.productColors(product);
    const images = product.images || [];
    const colorIndex = colors.findIndex((item) => this.colorKey(item) === key);
    return colorIndex >= 0 && images.length >= colors.length ? images[colorIndex] || null : null;
  }

  private selectedVariant(product: Product): ProductVariant | undefined {
    const size = this.selectedSize(product);
    const selectedColorKey = this.selectedProductColor(product)
      ? this.colorKey(this.selectedProductColor(product) || '')
      : '';
    const variants = product.variants || [];
    return variants.find((variant) => {
      const sizeMatches = Number(variant.size) === size;
      const colorMatches = !selectedColorKey || this.colorKey(variant.color || '') === selectedColorKey;
      return sizeMatches && colorMatches;
    });
  }

  private srcsetFor(src: string, product: Product): string | null {
    const variants = product.imageVariants?.[src];
    if (!variants) return null;

    const srcset = ['thumb', 'card', 'grid', 'pdp']
      .map((key) => variants[key])
      .filter((variant): variant is { url: string; width?: number } => !!variant?.url && !!variant?.width)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ');

    return srcset || null;
  }

  private colorKey(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private colorSlug(value: string): string {
    return this.colorKey(value).replace(/[^a-z0-9]+/g, '');
  }

  private normalizeSort(value: string): SortOption | null {
    const normalized = this.colorKey(value);
    if (normalized === 'featured') return 'Featured';
    if (normalized === 'price lowhigh' || normalized === 'price low high') return 'Price: Low–High';
    if (normalized === 'price highlow' || normalized === 'price high low') return 'Price: High–Low';
    if (normalized === 'newest') return 'Newest';
    return null;
  }

  private normalizeTag(value: string): string {
    const normalized = this.colorKey(value);
    if (normalized === 'signature') return 'Signature';
    if (normalized === 'limited') return 'Limited';
    if (normalized === 'limitededition') return 'Limited';
    if (normalized === 'newarrival' || normalized === 'new arrivals' || normalized === 'newarrival') return 'New Arrival';
    return value.trim();
  }

  private mappedImageForColor(product: Product, key: string): string | null {
    const colorImages = product.colorImages || {};
    const direct = colorImages[key];
    if (direct) return direct;

    const target = this.colorSlug(key);
    const match = Object.entries(colorImages).find(([color]) => this.colorSlug(color) === target);
    return match?.[1] || null;
  }

  private productLeathers(product: Product): string[] {
    return this.compact([product.leather]);
  }

  private productMaterials(product: Product): string[] {
    return this.compact([product.material, ...(product.materials || [])]);
  }

  private compact(values: Array<string | undefined | null>): string[] {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  private emptySelectedFilters(): SelectedFilters {
    return {
      category: [],
      price: [],
      color: [],
      leather: [],
      material: [],
      size: [],
      brand: [],
      tag: [],
    };
  }

  private async loadCollections(): Promise<void> {
    this.collectionsLoaded.set(false);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<StorefrontCollection[]>>(`${this.apiBase}/collections?limit=12`),
      );
      const collections = Array.isArray(res.data)
        ? res.data.map((collection) => ({
          ...collection,
          imageUrl: this.resolveMediaUrl(collection.imageUrl),
          productIds: Array.isArray(collection.productIds) ? collection.productIds : [],
          parentId: collection.parentId ?? null,
          children: Array.isArray(collection.children)
            ? collection.children.map((c: StorefrontChildCollection) => ({
                ...c,
                imageUrl: this.resolveMediaUrl(c.imageUrl),
                productIds: Array.isArray(c.productIds) ? c.productIds : [],
              }))
            : [],
        }))
        : [];
      this.collections.set(collections);
    } catch {
      this.collections.set([]);
    } finally {
      this.collectionsLoaded.set(true);
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

  private resolveMediaUrl(url: string | null): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.apiBase}${value}`;
  }

  private setupMobilePagination(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    this.mobileMediaQuery = window.matchMedia('(max-width: 767px)');
    this.mobileMediaQueryHandler = () => {
      this.isMobileView.set(this.mobileMediaQuery?.matches ?? false);
      if (!this.isMobileView()) this.mobilePage.set(0);
    };

    this.mobileMediaQueryHandler();
    this.mobileMediaQuery.addEventListener('change', this.mobileMediaQueryHandler);
  }
}
