import { Component, OnDestroy, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Subscription, combineLatest, firstValueFrom } from 'rxjs';
import { ProductsService } from '../../services/products.service';
import { Product, ProductVariant } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';
import { CartService } from '../../services/cart.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { resolveClientMediaUrl } from '../../utils/media-url';
import { SeoService } from '../../services/seo.service';
import { API_BASE, PUBLIC_API_BASE } from '../../core/api-base';

import { colorKey, colorSlug } from '../../utils/color-slug';
import { sizeOptions, colorState, productSoldOut, defaultColor, colorStock, availableStock, selectedVariant, productColors, carriedSize } from '../../shared/stock-availability';
import { SizeSheetComponent, SizeOption } from '../../shared/size-sheet/size-sheet.component';
import { RestockFormComponent } from '../../shared/restock/restock-form.component';
import { MOBILE_SHEET_QUERY, prefersReducedMotion } from '../../shared/overlay/body-scroll-lock';

const SORT_OPTIONS = ['Featured', 'Price: Low–High', 'Price: High–Low', 'Newest'] as const;
const FALLBACK_IMAGE = '/assets/brand/elite-logo-green.png';
/**
 * Swatches a card shows before the `+N` link takes over; the rest are one tap away on the
 * product page. Some products carry thirty colourways, and a full row of finger-sized
 * targets would be taller than the card's photo. The home hero makes the same trade at four
 * (`HERO_MAX_SWATCHES`).
 *
 * Two numbers because the targets are 24px under a mouse and 44px under a finger: at 375px
 * a card has 321px of row, which takes six 24px targets and the link easily, but only five
 * 44px ones (5x44 + 4x10 gaps + the link = 314px). Six would wrap to a second row.
 */
const MAX_CARD_SWATCHES = 6;
const MAX_CARD_SWATCHES_TOUCH = 5;
/**
 * Translation key per filter group.
 *
 * These were English literals rendered straight into the sidebar, so an Arabic
 * visitor got a translated sort control sitting next to eight English group
 * headings. The map still doubles as the source of `FilterGroupId`, which is
 * why the shape is kept and only the values moved to keys.
 *
 * `filterGroups` is a computed that resolves them through `t()`, and `t()`
 * reads the locale signal, so the sidebar re-labels itself on a locale switch
 * without anything else being wired up.
 */
const FILTER_TITLE_KEYS = {
  category: 'collection.filter.category',
  price: 'collection.filter.price',
  color: 'collection.filter.color',
  leather: 'collection.filter.leather',
  material: 'collection.filter.material',
  size: 'collection.filter.size',
  brand: 'collection.filter.brand',
  tag: 'collection.filter.tag',
} as const;

const COLOR_LABELS: Record<string, string> = {
  '170': 'Shade 170',
  '36/8': 'Shade 36/8',
  '390': 'Shade 390',
  n10: 'Shade N10',
  brwon: 'Brown',
  cezzane: 'Cezanne',
  greyserp: 'Grey Serpentine',
  'irish blue - chocolate': 'Irish Blue / Chocolate',
  'irish blue -navy': 'Irish Blue / Navy',
  'milk -wod': 'Milk / Wood',
  'milk-offwhite': 'Milk / Off-white',
  serpertine: 'Serpentine',
};

type SortOption = (typeof SORT_OPTIONS)[number];
type FilterGroupId = keyof typeof FILTER_TITLE_KEYS;
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
    imports: [CommonModule, FormsModule, RouterLink, SizeSheetComponent, RestockFormComponent],
    templateUrl: './collection.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './collection.component.scss'
})
export class CollectionComponent implements OnInit, OnDestroy {
  private readonly products = inject(ProductsService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly cart = inject(CartService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly seo = inject(SeoService);
  private readonly apiBase = inject(API_BASE);
  private readonly publicApiBase = inject(PUBLIC_API_BASE);

  /**
   * Head tags for whichever collection the route is pointing at. Returns null
   * until the collection list has loaded on a deep link, so the landing-page
   * copy is not briefly published as the title of a specific collection.
   *
   * The canonical is built from the route rather than the current URL because
   * this page carries filter and sort query params: without that every filter
   * combination would present itself to Google as a separate page.
   */
  private readonly seoTags = this.seo.watch(() => {
    const collection = this.activeCollection();
    const sub = this.activeSubCollection();

    if (!this.activeCollectionKey()) {
      return {
        title: this.i18n.t('seo.collection.title'),
        description: this.i18n.t('seo.collection.description'),
        canonicalPath: '/collection',
      };
    }
    if (!collection) return null;

    const title = this.activeCollectionDisplayTitle() || collection.title;
    const path = sub
      ? `/collection/${collection.handle}/${sub.handle}`
      : `/collection/${collection.handle}`;

    return {
      title,
      description: collection.description?.trim()
        || this.i18n.t('seo.collection.pageDescription', {
          title,
          count: this.activeCollectionTotalCount(),
        }),
      image: collection.imageUrl || undefined,
      canonicalPath: path,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        url: `${this.seo.origin()}${path}`,
      },
    };
  });
  private addedTimer: number | undefined;
  private sizeErrorTimer: number | undefined;
  private mobileMediaQuery?: MediaQueryList;
  private mobileMediaQueryHandler?: () => void;
  private sheetMediaQuery?: MediaQueryList;
  private sheetMediaQueryHandler?: () => void;
  private pointerMediaQuery?: MediaQueryList;
  private pointerMediaQueryHandler?: () => void;
  private routeSyncSub?: Subscription;

  readonly sortOptions = SORT_OPTIONS;
  readonly sort = signal<SortOption>('Featured');
  readonly hovered = signal<string | null>(null);
  readonly addedProductId = signal<string | null>(null);
  /** At most one card shows the alert form or the size sheet, so both are page-level. */
  readonly notifyTarget = signal<Product | null>(null);
  /** The one card currently being told to pick a size. */
  readonly sizeErrorProductId = signal<string | null>(null);
  readonly sizeSheetTarget = signal<Product | null>(null);
  /** Below this width the card swaps its native select for the same sheet the product page uses. */
  readonly isSheetView = signal(false);
  /** Mirrors the `(pointer: coarse)` swatch sizing in the stylesheet. */
  readonly isCoarsePointer = signal(false);
  readonly loadedProductImages = signal<Record<string, boolean>>({});
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
  /** The colour each size above was picked on (colour key). */
  private readonly selectedSizeColors = signal<Record<string, string>>({});
  /** Colours the customer clicked. They stay until another colour is clicked. */
  readonly selectedColors = signal<Record<string, string>>({});
  /** Colours under the pointer or keyboard focus: shown while there, never kept. */
  private readonly previewColors = signal<Record<string, string>>({});
  readonly selectedFilters = signal<SelectedFilters>(this.emptySelectedFilters());
  private readonly productQueryParamsCache = new Map<string, { key: string; value: Record<string, string> | null }>();

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);
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

  /**
   * Unique products in a collection, counting everything in its sub-collections.
   *
   * A parent such as Men keeps no products of its own, so counting only its direct links
   * advertised "0 pieces" on a collection holding forty of them.
   */
  collectionTotalCount(collection: { productIds: string[]; children?: { productIds: string[] }[] }): number {
    const ids = new Set<string>([
      ...collection.productIds,
      ...(collection.children ?? []).flatMap((child) => child.productIds),
    ]);
    return ids.size;
  }

  /** Total for the collection currently being viewed. */
  readonly activeCollectionTotalCount = computed((): number => {
    const col = this.activeCollection();
    return col ? this.collectionTotalCount(col) : 0;
  });

  readonly isCollectionLanding = computed(() => !this.activeCollectionKey());

  readonly filterGroups = computed<FilterGroup[]>(() => {
    const products = this.collectionScopedProducts();
    const groups: FilterGroup[] = [
      {
        id: 'category',
        title: this.t(FILTER_TITLE_KEYS.category),
        options: this.optionsFromProducts(products, (p) => this.productCategories(p), (value) => this.categoryLabel(value)),
      },
      {
        id: 'price',
        title: this.t(FILTER_TITLE_KEYS.price),
        options: this.priceOptions(products),
      },
      {
        id: 'color',
        title: this.t(FILTER_TITLE_KEYS.color),
        options: this.optionsFromProducts(products, (p) => this.filterProductColors(p), (value) => this.colorLabel(value)),
      },
      {
        id: 'leather',
        title: this.t(FILTER_TITLE_KEYS.leather),
        options: this.optionsFromProducts(products, (p) => this.productLeathers(p), (value) => this.productLeather(value)),
      },
      {
        id: 'material',
        title: this.t(FILTER_TITLE_KEYS.material),
        options: this.optionsFromProducts(products, (p) => this.productMaterials(p)),
      },
      {
        id: 'size',
        title: this.t(FILTER_TITLE_KEYS.size),
        options: this.optionsFromProducts(products, (p) => p.sizes.map(String), (value) => value, true),
      },
      {
        id: 'brand',
        title: this.t(FILTER_TITLE_KEYS.brand),
        options: this.optionsFromProducts(products, (p) => this.compact([p.brand])),
      },
      {
        id: 'tag',
        title: this.t(FILTER_TITLE_KEYS.tag),
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
    if (this.sheetMediaQuery && this.sheetMediaQueryHandler) {
      this.sheetMediaQuery.removeEventListener('change', this.sheetMediaQueryHandler);
    }
    if (this.pointerMediaQuery && this.pointerMediaQueryHandler) {
      this.pointerMediaQuery.removeEventListener('change', this.pointerMediaQueryHandler);
    }
    if (this.mobileMediaQuery && this.mobileMediaQueryHandler) {
      this.mobileMediaQuery.removeEventListener('change', this.mobileMediaQueryHandler);
    }
  }

  productPath(p: Product): unknown[] {
    return ['/product', this.products.productKey(p)];
  }

  /**
   * The breadcrumb context a product page shows, and the colourway the visitor
   * is looking at on this card.
   *
   * Memoised because this feeds a template binding rather than a click
   * handler now: a fresh object on every change-detection pass would make
   * `routerLink` rebuild every card's href on every pass, forty-eight times
   * over. The cache key carries everything the result is derived from, so a
   * changed collection or swatch still produces a new object.
   */
  productQueryParams(p: Product): Record<string, string> | null {
    const active = this.activeCollection();
    const sub = this.activeSubCollection();
    const selectedColor = this.selectedProductColor(p);
    const size = this.selectedSize(p);
    // The product page applies ?size only when it is in stock, so only send one that is.
    const carrySize = size !== null && availableStock(p, selectedColor, size) > 0 ? size : null;
    const cacheKey = [
      p.id,
      active?.id ?? '',
      sub?.id ?? '',
      this.activeSubCollectionKey() ?? '',
      selectedColor ?? '',
      carrySize ?? '',
    ].join('|');

    const cached = this.productQueryParamsCache.get(p.id);
    if (cached && cached.key === cacheKey) return cached.value;

    const queryParams: Record<string, string> = {};
    if (sub) {
      queryParams['col'] = sub.handle || sub.id;
      queryParams['colName'] = sub.title;
      queryParams['parentCol'] = active?.handle || active?.id || '';
      queryParams['parentColName'] = active?.title || '';
    } else if (active && this.activeSubCollectionKey() === 'all') {
      queryParams['col'] = 'all';
      queryParams['colName'] = 'All';
      queryParams['parentCol'] = active.handle || active.id;
      queryParams['parentColName'] = active.title;
    } else if (active) {
      queryParams['col'] = active.handle || active.id;
      queryParams['colName'] = active.title;
    }
    if (selectedColor) queryParams['color'] = this.colorSlug(selectedColor);
    if (carrySize !== null) queryParams['size'] = String(carrySize);

    const value = Object.keys(queryParams).length ? queryParams : null;
    this.productQueryParamsCache.set(p.id, { key: cacheKey, value });
    return value;
  }

  /** Side effects only. `routerLink` on the anchor does the navigating. */
  onProductLinkClick(event: MouseEvent): void {
    if (!this.navigatesInPlace(event)) return;
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
    return this.expandedFilterGroups()[groupId] ?? (groupId === 'price' || groupId === 'sort');
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

  /**
   * Where a collection card points.
   *
   * Every card in this page used to be a `<button>` that called
   * `router.navigate`. That works for a person and is invisible to a crawler:
   * the served HTML carried the names of all 48 products and not one `href`,
   * so Google could read the catalogue but never walk into it. Search Console
   * reported 47 product pages as "Discovered - currently not indexed", the
   * signature of URLs known only from a sitemap with nothing linking to them.
   *
   * The cards are anchors now. `routerLink` still navigates in-app on a plain
   * click, and additionally emits the href that makes the catalogue crawlable,
   * middle-clickable and openable in a new tab.
   */
  collectionPath(collection: StorefrontCollection | null): unknown[] {
    return collection ? ['/collection', collection.handle || collection.id] : ['/collection'];
  }

  subCollectionPath(sub: StorefrontChildCollection | null): unknown[] {
    const parent = this.activeCollection();
    if (!parent) return ['/collection'];
    return ['/collection', parent.handle || parent.id, sub ? sub.handle || sub.id : 'all'];
  }

  /**
   * A click the browser itself should handle: a new tab, a new window, a
   * download. `routerLink` already leaves these alone, so the side effects
   * below have to leave them alone too, or opening a card in a background tab
   * would reset the filters on the tab the visitor is still looking at.
   */
  private navigatesInPlace(event: MouseEvent): boolean {
    return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  }

  /** Side effects only. `routerLink` on the anchor does the navigating. */
  onCollectionLinkClick(event: MouseEvent): void {
    if (!this.navigatesInPlace(event)) return;
    this.selectedFilters.set(this.emptySelectedFilters());
    this.mobilePage.set(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Leaving the catalogue entirely also drops the sort, as the old button did. */
  onAllCollectionsLinkClick(event: MouseEvent): void {
    if (!this.navigatesInPlace(event)) return;
    this.sort.set('Featured');
    this.onCollectionLinkClick(event);
  }

  selectSize(product: Product, size: number): void {
    this.selectedSizes.update((sizes) => ({ ...sizes, [product.id]: size }));
    const color = this.colorKey(this.selectedProductColor(product) || '');
    this.selectedSizeColors.update((colors) => ({ ...colors, [product.id]: color }));
    if (this.sizeErrorProductId() === product.id) this.sizeErrorProductId.set(null);
  }

  sizeSelectValue(event: Event): number {
    return Number.parseInt((event.target as HTMLSelectElement).value, 10);
  }

  previewProductColor(product: Product, color: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    // Hover and focus only preview. They used to write the chosen colour, and leaving the tile
    // then reset it to the first colour, so opening "Notify me" (which covers the tile) or just
    // moving the pointer away threw away the colour the customer had clicked.
    this.previewColors.update((colors) => ({ ...colors, [product.id]: color }));
  }

  selectProductColor(product: Product, color: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.selectedColors.update((colors) => ({ ...colors, [product.id]: color }));
    this.clearProductColorPreview(product);
  }

  clearProductColorPreview(product: Product): void {
    if (!(product.id in this.previewColors())) return;
    this.previewColors.update((colors) => {
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
    if (!this.canPurchase(product)) return;
    if (!this.requireCardSize(product)) return;
    this.cart.add(this.cartItem(product));

    this.addedProductId.set(product.id);
    if (this.addedTimer) window.clearTimeout(this.addedTimer);
    this.addedTimer = window.setTimeout(() => this.addedProductId.set(null), 1800);
  }

  buyNow(product: Product): void {
    if (!this.canPurchase(product)) return;
    if (!this.requireCardSize(product)) return;
    this.cart.add(this.cartItem(product));
    this.cart.closeDrawer();
    void this.router.navigate(['/checkout']);
    window.scrollTo(0, 0);
  }

  /**
   * Only what the customer picked. Nothing is chosen for them, and a sold-out size counts as a
   * pick, because picking one is how they ask to be told when it returns.
   */
  selectedSize(product: Product): number | null {
    return carriedSize(
      product,
      this.selectedSizes()[product.id],
      this.selectedSizeColors()[product.id],
      this.selectedProductColor(product),
    );
  }

  selectedProductColor(product: Product): string | null {
    return this.previewColors()[product.id]
      || this.selectedColors()[product.id]
      || defaultColor(product, this.filterDefaultColor(product));
  }

  /**
   * With a colour filter on, a card opens on the colour that matched it, preferring one in
   * stock. It used to open on the product's first colour, so filtering for Brown showed a
   * page of black shoes whose links also pointed at black.
   */
  private filterDefaultColor(product: Product): string | null {
    const wanted = this.selectedFilters().color;
    if (!wanted.length) return null;
    const matches = this.productColors(product).filter((color) => wanted.includes(this.canonicalColor(color)));
    return matches.find((color) => colorStock(product, color) > 0) ?? matches[0] ?? null;
  }

  selectedProductImage(product: Product): string {
    const selectedColor = this.selectedProductColor(product);
    if (!selectedColor) return product.image;

    return this.productImageForColor(product, selectedColor) || product.image;
  }

  isProductImageLoaded(product: Product): boolean {
    return !!this.loadedProductImages()[this.productImageKey(product)];
  }

  markProductImageLoaded(product: Product): void {
    const key = this.productImageKey(product);
    this.loadedProductImages.update((loaded) => loaded[key] ? loaded : { ...loaded, [key]: true });
  }

  private productImageKey(product: Product): string {
    return `${product.id}:${this.selectedProductImage(product)}`;
  }

  productImageSrcset(product: Product): string | null {
    return this.srcsetFor(this.selectedProductImage(product), product);
  }

  productColorNames(product: Product): string[] {
    return this.productColors(product);
  }

  /**
   * Swatches shown on a card. Some products carry thirty colourways, and a full row of
   * finger-sized targets would be taller than the card's photo; the rest are one tap away
   * behind the `+N` link, the same bargain the home hero makes.
   *
   * The colour on show is never hidden behind the cap: it takes the last visible slot when
   * its own position is past it, so clicking a swatch, or filtering by a colour that sorts
   * late, still shows the colour the card is displaying.
   */
  visibleColorNames(product: Product): string[] {
    const colors = this.productColorNames(product);
    const max = this.maxCardSwatches();
    if (colors.length <= max) return colors;
    const visible = colors.slice(0, max);
    const shown = this.selectedProductColor(product);
    if (shown && !visible.some((color) => this.colorKey(color) === this.colorKey(shown))) {
      visible[visible.length - 1] = shown;
    }
    return visible;
  }

  hiddenColorCount(product: Product): number {
    return Math.max(0, this.productColorNames(product).length - this.maxCardSwatches());
  }

  private maxCardSwatches(): number {
    return this.isCoarsePointer() ? MAX_CARD_SWATCHES_TOUCH : MAX_CARD_SWATCHES;
  }

  availableSizes(product: Product, color = this.selectedProductColor(product)): number[] {
    return sizeOptions(product, color).filter(s => s.state === 'available').map(s => s.size);
  }

  readonly sizeOptions = sizeOptions;
  readonly productSoldOut = productSoldOut;
  colorSoldOut(product: Product, color: string | null): boolean { return colorState(product, color) === 'sold-out'; }
  /**
   * Whether this card can lead to a sale at all.
   *
   * Colour-level while no size is picked: asking `availableStock` with a null size answers 0 for
   * every sized product, which would hide Add to Cart on the whole grid. The size itself is
   * required at the moment of purchase instead, by `requireCardSize`.
   */
  canPurchase(product: Product): boolean {
    const color = this.selectedProductColor(product);
    const size = this.selectedSize(product);
    return size === null ? colorStock(product, color) > 0 : availableStock(product, color, size) > 0;
  }

  /**
   * Two states. A customer who picked a sold-out size gets an alert for that exact size; one who
   * picked nothing gets the buy buttons and is asked for a size when they press.
   */
  cardCta(product: Product): 'buy' | 'notify' {
    return this.canPurchase(product) ? 'buy' : 'notify';
  }

  /** Sold-out sizes offered for the selected colour; the only ones the API accepts. */
  soldOutSizes(product: Product): number[] {
    return this.sizeOptions(product, this.selectedProductColor(product))
      .filter((option) => option.state === 'sold-out')
      .map((option) => option.size);
  }

  sheetSizes(product: Product): SizeOption[] {
    return this.sizeOptions(product, this.selectedProductColor(product)).map((option) => ({
      size: option.size,
      available: true,
      inStock: option.state === 'available',
    }));
  }

  notifyMe(product: Product): void {
    this.notifyTarget.set(product);
  }

  openSizeSheet(product: Product): void {
    this.sizeSheetTarget.set(product);
  }

  onSheetSizePicked(product: Product, size: number): void {
    this.selectSize(product, size);
    this.sizeSheetTarget.set(null);
  }

  /**
   * Refuse to buy without a size, and put the size picker in front of the customer.
   *
   * There is no toast anywhere in the storefront, so the message is an inline line in this card's
   * own purchase panel, which keeps it next to the control it is about.
   */
  private requireCardSize(product: Product): boolean {
    if (this.sizeOptions(product, this.selectedProductColor(product)).length === 0) return true;
    if (this.selectedSize(product) !== null) return true;

    this.sizeErrorProductId.set(product.id);
    if (this.sizeErrorTimer) window.clearTimeout(this.sizeErrorTimer);
    this.sizeErrorTimer = window.setTimeout(() => this.sizeErrorProductId.set(null), 6000);

    if (typeof window === 'undefined') return false;

    if (this.isSheetView()) {
      this.openSizeSheet(product);
      return false;
    }

    requestAnimationFrame(() => {
      const picker = document.getElementById(`size-select-${product.id}`);
      picker?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
      picker?.focus({ preventScroll: true });
    });
    return false;
  }

  /** The alert was refused because the selection is buyable again; reload and let the card update. */
  async onRestockBackInStock(): Promise<void> {
    this.notifyTarget.set(null);
    await this.products.refresh();
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

  prevMobilePage(): void {
    this.mobilePage.update((page) => Math.max(0, page - 1));
  }

  nextMobilePage(): void {
    this.mobilePage.update((page) => Math.min(this.mobileTotalPages() - 1, page + 1));
  }

  /**
   * "3 pieces", and its Arabic equivalents.
   *
   * English needs two forms, Arabic needs four and picks between them by the
   * number itself: one, two, a few (3 to 10), and everything else. Writing
   * `{{ n }} pieces` in the template produced "3 قطعة" on the Arabic
   * storefront, which reads the way "3 piece" does in English.
   *
   * `en` has no `few` key, so it falls through to `other` for 3 to 10, which is
   * the correct English form anyway. The 11-and-above Arabic case is `other`
   * too, and takes the singular noun by the same rule that makes "11 قطعة"
   * right where "11 قطع" is not.
   */
  pieceCount(count: number): string {
    const n = Math.abs(Math.trunc(count));
    const remainder = n % 100;
    let form: string;
    if (n === 1) form = 'one';
    else if (n === 2) form = 'two';
    else if (remainder >= 3 && remainder <= 10) form = 'few';
    else form = 'other';

    const key = `collection.pieces.${form}`;
    const label = this.t(key, { count: n });
    // A locale that does not define the form falls back to `other` rather than
    // rendering the raw key.
    return label === key ? this.t('collection.pieces.other', { count: n }) : label;
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
      && this.matchesTextFilter(selected.color, this.filterProductColors(product))
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
      size: this.selectedSize(product) ?? 0,
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
    return [this.productType(product)];
  }

  private productColors(product: Product): string[] {
    return productColors(product);
  }

  colorLabel(value: string): string {
    const trimmed = String(value || '').trim();
    const known = COLOR_LABELS[trimmed.toLowerCase()];
    if (known) return known;
    return trimmed.replace(/[A-Za-z]+/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
  }

  private filterProductColors(product: Product): string[] {
    return [...new Set(this.productColors(product).map((color) => this.canonicalColor(color)))];
  }

  private canonicalColor(value: string): string {
    const normalized = this.colorKey(value);
    const aliases: Record<string, string> = {
      brwon: 'brown',
      cezzane: 'cezanne',
      greyserp: 'grey serpentine',
      serpertine: 'serpentine',
    };
    return aliases[normalized] || normalized;
  }

  private categoryLabel(value: string): string {
    const normalized = this.colorKey(value);
    if (normalized === 'shoe' || normalized === 'shoes' || normalized === 'footwear') return 'Shoes';
    if (normalized === 'sunglasses' || normalized === 'eyewear') return 'Sunglasses';
    if (normalized === 'kids' || normalized === 'children') return 'Kids';
    if (normalized === 'sandal' || normalized === 'sandals') return 'Sandals';
    return value;
  }

  productType(product: Product): string {
    const source = this.colorKey([
      product.name,
      product.category,
      ...(product.categories || []),
      product.style,
    ].filter(Boolean).join(' '));
    if (source.includes('sunglass') || source.includes('eyewear')) return 'Sunglasses';
    if (source.includes('kid') || source.includes('children')) return 'Kids';
    if (source.includes('sandal') || source.includes('slide')) return 'Sandals';
    return 'Shoes';
  }

  // Only an image the admin explicitly bound to this colour counts. Callers fall back to the
  // product's primary image, which beats guessing a colour's image from its gallery position.
  private productImageForColor(product: Product, color: string): string | null {
    return this.mappedImageForColor(product, this.colorKey(color));
  }

  private selectedVariant(product: Product): ProductVariant | undefined {
    return selectedVariant(product, this.selectedProductColor(product), this.selectedSize(product));
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
    return colorKey(value);
  }

  private colorSlug(value: string): string {
    return colorSlug(value);
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


  private resolveMediaUrl(url: string | null): string {
    return resolveClientMediaUrl(url, this.publicApiBase);
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

    /*
     * Deliberately a second query rather than reusing the one above. Mobile pagination
     * switches at 767px and the size sheet at 759px, matching the product page, and
     * dragging pagination to a new breakpoint to save one listener would change a feature
     * this work has nothing to do with.
     */
    this.sheetMediaQuery = window.matchMedia(MOBILE_SHEET_QUERY);
    this.sheetMediaQueryHandler = () => {
      const isSheet = this.sheetMediaQuery?.matches ?? false;
      this.isSheetView.set(isSheet);
      if (!isSheet) this.sizeSheetTarget.set(null);
    };
    this.sheetMediaQueryHandler();
    this.sheetMediaQuery.addEventListener('change', this.sheetMediaQueryHandler);

    // Swatch targets grow to 44px under a finger, so one fewer fits before the `+N` link.
    // Same query as the stylesheet, so the count and the layout cannot disagree.
    this.pointerMediaQuery = window.matchMedia('(pointer: coarse)');
    this.pointerMediaQueryHandler = () => this.isCoarsePointer.set(this.pointerMediaQuery?.matches ?? false);
    this.pointerMediaQueryHandler();
    this.pointerMediaQuery.addEventListener('change', this.pointerMediaQueryHandler);
  }
}
