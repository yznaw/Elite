import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';

const STYLE_FILTERS = ['All', 'Oxford', 'Derby', 'Loafer', 'Boot'] as const;
const LEATHER_FILTERS = ['All', 'Camel Nappa', 'Camel Full-Grain', 'Goat Suede', 'Calf Leather'] as const;
const SORT_OPTIONS = ['Featured', 'Price: Low–High', 'Price: High–Low', 'Newest'] as const;

type StyleFilter = (typeof STYLE_FILTERS)[number];
type LeatherFilter = (typeof LEATHER_FILTERS)[number];
type SortOption = (typeof SORT_OPTIONS)[number];

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

  readonly styleFilters = STYLE_FILTERS;
  readonly leatherFilters = LEATHER_FILTERS;
  readonly sortOptions = SORT_OPTIONS;

  readonly styleFilter = signal<StyleFilter>('All');
  readonly leatherFilter = signal<LeatherFilter>('All');
  readonly sort = signal<SortOption>('Featured');
  readonly hovered = signal<string | null>(null);

  readonly filtered = computed<Product[]>(() => {
    let list = this.products.getAll();
    const sf = this.styleFilter();
    const lf = this.leatherFilter();
    const so = this.sort();
    if (sf !== 'All') list = list.filter((p) => p.style === sf);
    if (lf !== 'All') list = list.filter((p) => p.leather === lf);
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

  setStyle(f: StyleFilter): void { this.styleFilter.set(f); }
  setLeather(f: LeatherFilter): void { this.leatherFilter.set(f); }
  setSort(s: SortOption): void { this.sort.set(s); }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
