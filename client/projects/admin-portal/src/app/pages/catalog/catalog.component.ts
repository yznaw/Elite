import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ProductDrawerComponent } from './product-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
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
            <input class="inp with-icon" [placeholder]="t('catalog.search.placeholder')" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
          </div>
          <select class="inp" style="width:auto;" [ngModel]="cat()" (ngModelChange)="cat.set($event)">
            @for (c of cats; track c) {
              <option [value]="c">{{ c === 'All' ? t('catalog.allCategories') : c }}</option>
            }
          </select>
          <select class="inp" style="width:auto;" [ngModel]="v3d()" (ngModelChange)="v3d.set($event)">
            <option value="All">{{ t('catalog.allCategories') }}</option>
            <option value="Linked">{{ t('catalog.linked') }}</option>
            <option value="Missing">{{ t('catalog.missing') }}</option>
          </select>
          <button class="btn btn-gold"><ap-icon name="plus" [size]="14"/> {{ t('catalog.newProduct') }}</button>
        </div>
      </div>

      <div class="row mb-16" style="justify-content:space-between;">
        <div class="muted small">{{ filtered().length }}</div>
        <div class="row gap-sm small">
          <span class="row gap-sm"><ap-pill kind="green">✓</ap-pill> {{ t('catalog.linked') }}</span>
          <span class="row gap-sm"><ap-pill kind="grey">○</ap-pill> {{ t('catalog.missing') }}</span>
        </div>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="catalog" [title]="t('catalog.empty.title')" [sub]="t('catalog.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
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
                <span class="prod-3d-badge" style="top:10px;inset-inline-end:10px;inset-inline-start:auto;background:rgba(239,68,68,0.92);">○ {{ t('catalog.hidden') }}</span>
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

    @if (activeId(); as id) {
      <ap-product-drawer
        [products]="filtered()"
        [currentId]="id"
        (closed)="activeId.set(null)"
        (currentIdChange)="activeId.set($event)"
        (deleted)="onDeleted($event)"
      />
    }
  `,
})
export class CatalogComponent {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;
  readonly cats = ['All', ...Array.from(new Set(PRODUCTS.map((p) => p.category)))];
  readonly viewOptions = ['All', 'Linked', 'Missing'];

  /** Live, mutable product list — supports delete + undo. */
  private readonly _products = signal<Product[]>([...PRODUCTS]);
  /** Public computed for templates. */
  readonly products = computed(() => this._products());

  readonly search = signal('');
  readonly cat = signal('All');
  readonly v3d = signal('All');

  /** ID-based — drawer navigation just updates this. */
  readonly activeId = signal<string | null>(null);

  readonly filtered = computed(() => {
    const s = this.search().toLowerCase();
    const c = this.cat();
    const v = this.v3d();
    return this._products().filter((p) => {
      if (c !== 'All' && p.category !== c) return false;
      if (v !== 'All') {
        if (v === 'Linked' && !p.has3d) return false;
        if (v === 'Missing' && p.has3d) return false;
      }
      if (s && !(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))) return false;
      return true;
    });
  });

  openProduct(p: Product): void { this.activeId.set(p.id); }

  clearFilters(): void {
    this.search.set('');
    this.cat.set('All');
    this.v3d.set('All');
  }

  /**
   * Delete handler from the drawer. We:
   *   1. Remove the product from the live list (this also drops it from `filtered()`)
   *   2. Decide what to show next: the next product at the same index, the
   *      previous one, or close the drawer if the list is now empty
   *   3. Show a success toast with an "Undo" action that re-inserts at the
   *      original index and reopens the product
   */
  onDeleted(deleted: Product): void {
    const before = this._products();
    const beforeIndex = before.findIndex((p) => p.id === deleted.id);
    if (beforeIndex < 0) return;

    const visible = this.filtered();
    const visibleIndex = visible.findIndex((p) => p.id === deleted.id);

    // Remove from the live list
    this._products.update((all) => all.filter((p) => p.id !== deleted.id));

    // Decide what to focus next (within the filtered list)
    const nextVisible = this.filtered();
    if (nextVisible.length === 0) {
      this.activeId.set(null);
    } else {
      const nextIdx = Math.min(Math.max(visibleIndex, 0), nextVisible.length - 1);
      this.activeId.set(nextVisible[nextIdx].id);
    }

    this.toast.success(
      this.t('product.toast.deleted.title'),
      `${deleted.name} (${deleted.sku})`,
      {
        label: this.t('common.undo'),
        run: () => {
          this._products.update((all) => {
            const restored = [...all];
            restored.splice(beforeIndex, 0, deleted);
            return restored;
          });
          this.activeId.set(deleted.id);
          this.toast.info(this.t('product.toast.restored.title'), deleted.name);
        },
      },
    );
  }

  stockLabel(p: Product): string {
    if (p.stock === 0) return this.t('catalog.outOfStock');
    if (p.stock < 8) return `${this.t('catalog.lowStock')} · ${p.stock}`;
    return `${p.stock} ${this.t('catalog.inStock')}`;
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
