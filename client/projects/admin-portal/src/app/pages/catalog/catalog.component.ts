import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ProductDrawerComponent } from './product-drawer.component';
import { PRODUCTS } from '../../data/mock';
import { Product, QAR } from '../../models';

@Component({
  selector: 'ap-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, EmptyStateComponent, ProductDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="card mb-24" style="padding:14px 18px;">
        <div class="row gap-sm" style="flex-wrap:wrap;">
          <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
            <ap-icon name="search" [size]="14"/>
            <input class="inp with-icon" placeholder="Search by name or SKU…" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
          </div>
          <select class="inp" style="width:auto;" [ngModel]="cat()" (ngModelChange)="cat.set($event)">
            @for (c of cats; track c) { <option [value]="c">{{ c }}</option> }
          </select>
          <select class="inp" style="width:auto;" [ngModel]="v3d()" (ngModelChange)="v3d.set($event)">
            @for (s of viewOptions; track s) { <option [value]="s">{{ s }}</option> }
          </select>
          <button class="btn btn-gold"><ap-icon name="plus" [size]="14"/> New Product</button>
        </div>
      </div>

      <div class="row mb-16" style="justify-content:space-between;">
        <div class="muted small">{{ filtered().length }} products</div>
        <div class="row gap-sm small">
          <span class="row gap-sm"><ap-pill kind="green">✓</ap-pill> 3D linked</span>
          <span class="row gap-sm"><ap-pill kind="grey">○</ap-pill> 3D missing</span>
        </div>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="catalog" title="No products match your filters"
            sub="Try a broader category or clear the search box. Add a new SKU with the button above.">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">Clear filters</button>
          </ap-empty-state>
        </div>
      } @else {
      <div class="grid-cards">
        @for (p of filtered(); track p.id) {
          <div class="prod-card" (click)="openProduct(p)" [style.opacity]="p.hidden ? 0.65 : 1">
            <div class="prod-img">
              <img [src]="p.image" [alt]="p.name" (error)="onImgError($event)" [style.filter]="p.hidden ? 'grayscale(0.6)' : null"/>
              <span class="prod-3d-badge" [class.linked]="p.has3d" [class.missing]="!p.has3d">
                {{ p.has3d ? '✓ 3D' : '○ No 3D' }}
              </span>
              @if (p.hidden) {
                <span class="prod-3d-badge" style="top:10px;right:10px;left:auto;background:rgba(239,68,68,0.92);">○ Hidden</span>
              }
            </div>
            <div class="prod-body">
              <div class="prod-name">{{ p.name }}</div>
              <div class="prod-sku">{{ p.sku }} · {{ p.brand }}</div>
              <div class="prod-meta">
                <span class="prod-price">{{ QAR(p.price) }}</span>
                <span class="prod-stock" [class.low]="p.stock > 0 && p.stock < 8" [class.out]="p.stock === 0">
                  {{ stockLabel(p) }}
                </span>
              </div>
            </div>
          </div>
        }
      </div>
      }
    </div>

    @if (active()) {
      <ap-product-drawer [product]="active()!" (closed)="active.set(null)"/>
    }
  `,
})
export class CatalogComponent {
  readonly QAR = QAR;
  readonly products = PRODUCTS;
  readonly cats = ['All', ...Array.from(new Set(PRODUCTS.map((p) => p.category)))];
  readonly viewOptions = ['All', 'Linked', 'Missing'];

  readonly search = signal('');
  readonly cat = signal('All');
  readonly v3d = signal('All');
  readonly active = signal<Product | null>(null);

  readonly filtered = computed(() => {
    const s = this.search().toLowerCase();
    const c = this.cat();
    const v = this.v3d();
    return this.products.filter((p) => {
      if (c !== 'All' && p.category !== c) return false;
      if (v !== 'All') {
        if (v === 'Linked' && !p.has3d) return false;
        if (v === 'Missing' && p.has3d) return false;
      }
      if (s && !(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))) return false;
      return true;
    });
  });

  openProduct(p: Product): void { this.active.set(p); }

  clearFilters(): void {
    this.search.set('');
    this.cat.set('All');
    this.v3d.set('All');
  }

  stockLabel(p: Product): string {
    if (p.stock === 0) return 'Out of stock';
    if (p.stock < 8) return `Low · ${p.stock}`;
    return `${p.stock} in stock`;
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
