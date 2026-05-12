import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';
import { I18nService } from '../../services/i18n.service';
import { CartService } from '../../services/cart.service';

const SORT_OPTIONS = ['Featured', 'Price: Low–High', 'Price: High–Low', 'Newest'] as const;
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

@Component({
  selector: 'cw-collection',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './collection.component.html',
  styleUrl: './collection.component.scss',
})
export class CollectionComponent implements OnInit {
  private readonly products = inject(ProductsService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly cart = inject(CartService);
  private addedTimer: number | undefined;

  readonly sortOptions = SORT_OPTIONS;
  readonly sort = signal<SortOption>('Featured');
  readonly hovered = signal<string | null>(null);
  readonly addedProductId = signal<string | null>(null);
  readonly selectedSizes = signal<Record<string, number>>({});
  readonly selectedFilters = signal<SelectedFilters>(this.emptySelectedFilters());

  readonly t = (key: string): string => this.i18n.t(key);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productStyle = (value: string): string => this.i18n.productStyle(value);
  readonly productTag = (value: string): string => this.i18n.productTag(value);

  readonly allProducts = computed<Product[]>(() => this.products.getAll());

  readonly filterGroups = computed<FilterGroup[]>(() => {
    const products = this.allProducts();
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
    let list = this.allProducts().filter((product) => this.matchesFilters(product, selected));
    const so = this.sort();

    if (so === 'Price: Low–High') list = [...list].sort((a, b) => a.price - b.price);
    if (so === 'Price: High–Low') list = [...list].sort((a, b) => b.price - a.price);

    return list;
  });

  ngOnInit(): void {
    void this.products.refresh();
  }

  goToProduct(p: Product): void {
    void this.router.navigate(['/product', p.id]);
    window.scrollTo(0, 0);
  }

  setSort(s: SortOption): void { this.sort.set(s); }

  selectSize(product: Product, size: number): void {
    this.selectedSizes.update((sizes) => ({ ...sizes, [product.id]: size }));
  }

  addToCart(product: Product): void {
    const size = this.selectedSize(product);

    this.cart.add({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      leather: product.leather,
      size,
      qty: 1,
    });

    this.addedProductId.set(product.id);
    if (this.addedTimer) window.clearTimeout(this.addedTimer);
    this.addedTimer = window.setTimeout(() => this.addedProductId.set(null), 1800);
  }

  selectedSize(product: Product): number {
    return this.selectedSizes()[product.id] || product.sizes[0] || 40;
  }

  toggleFilter(groupId: FilterGroupId, value: string): void {
    this.selectedFilters.update((current) => {
      const values = current[groupId];
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];

      return { ...current, [groupId]: nextValues };
    });
  }

  isFilterSelected(groupId: FilterGroupId, value: string): boolean {
    return this.selectedFilters()[groupId].includes(value);
  }

  clearFilters(): void {
    this.selectedFilters.set(this.emptySelectedFilters());
    this.sort.set('Featured');
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

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
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

  private productLeathers(product: Product): string[] {
    return this.compact([product.leather]);
  }

  private productMaterials(product: Product): string[] {
    return this.compact([product.material, ...(product.materials || [])]);
  }

  private compact(values: Array<string | undefined | null>): string[] {
    return values.map((value) => String(value || '').trim()).filter(Boolean);
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
}
