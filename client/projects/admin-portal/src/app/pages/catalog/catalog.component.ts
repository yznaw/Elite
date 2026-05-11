import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ProductDrawerComponent } from './product-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { COLLECTIONS } from '../../data/mock';
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
          <select class="inp" style="width:auto;" [ngModel]="collectionId()" (ngModelChange)="collectionId.set($event)">
            <option value="All">{{ t('catalog.allCollections') }}</option>
            @for (c of collections; track c.id) {
              <option [value]="c.id">{{ c.title }}</option>
            }
          </select>
          <select class="inp" style="width:auto;" [ngModel]="v3d()" (ngModelChange)="v3d.set($event)">
            <option value="All">{{ t('catalog.allCollections') }}</option>
            <option value="Linked">{{ t('catalog.linked') }}</option>
            <option value="Missing">{{ t('catalog.missing') }}</option>
          </select>
          <button class="btn btn-gold" (click)="createProduct()"><ap-icon name="plus" [size]="14"/> {{ t('catalog.newProduct') }}</button>
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
        (closed)="onDrawerClosed()"
        (currentIdChange)="activeId.set($event)"
        (deleted)="onDeleted($event)"
      />
    }
  `,
})
export class CatalogComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly productsApi = inject(AdminProductsService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;
  readonly collections = COLLECTIONS.filter(c => !c.hidden);
  readonly viewOptions = ['All', 'Linked', 'Missing'];

  /** Live, mutable product list — supports delete + undo. */
  private readonly _products = signal<Product[]>([]);
  /** Public computed for templates. */
  readonly products = computed(() => this._products());
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.productsApi.list();
      this._products.set(list);
    } catch {
      // The HTTP error interceptor has already toasted; leave the list empty
      // so the user sees the standard empty-state instead of stale mocks.
      this._products.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  readonly search = signal('');
  readonly collectionId = signal('All');
  readonly v3d = signal('All');

  /** ID-based — drawer navigation just updates this. */
  readonly activeId = signal<string | null>(null);

  readonly filtered = computed(() => {
    const s = this.search().toLowerCase();
    const colId = this.collectionId();
    const v = this.v3d();
    return this._products().filter((p) => {
      if (colId !== 'All') {
        const col = COLLECTIONS.find(c => c.id === colId);
        if (col && !col.productIds.includes(p.id)) return false;
      }
      if (v !== 'All') {
        if (v === 'Linked' && !p.has3d) return false;
        if (v === 'Missing' && p.has3d) return false;
      }
      if (s && !(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))) return false;
      return true;
    });
  });

  openProduct(p: Product): void { this.activeId.set(p.id); }

  /** Drawer closed — discard any never-saved create stub so the catalog
      doesn't keep a blank placeholder around. */
  onDrawerClosed(): void {
    const id = this.activeId();
    if (id && id.startsWith('P-NEW-')) {
      const p = this._products().find((x) => x.id === id);
      if (p && !p.name) {
        this._products.update((all) => all.filter((x) => x.id !== id));
      }
    }
    this.activeId.set(null);
  }

  /** New Product flow: synthesize a blank product, prepend it to the list,
      and open the drawer so the user can fill it in. The drawer's existing
      save/discard pipeline takes care of persistence and toast feedback. */
  createProduct(): void {
    const id = 'P-NEW-' + Date.now().toString(36).slice(-5).toUpperCase();
    const draft: Product = {
      id,
      name: '',
      sku: '',
      brand: '',
      price: 0,
      stock: 0,
      has3d: false,
      views3d: 0,
      hidden: true,
      image: 'https://images.unsplash.com/photo-1519415943484-9fa1873496d4?w=600&q=80&auto=format&fit=crop',
      variants: [],
    };
    this._products.update((all) => [draft, ...all]);
    this.clearFilters();
    this.activeId.set(id);
  }

  clearFilters(): void {
    this.search.set('');
    this.collectionId.set('All');
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

    // Remove from the live list, then archive on the server. A reject is
    // swallowed silently — the global error interceptor surfaces the toast,
    // and the user can refresh to recover. (Create-stubs use a P-NEW- prefix
    // and were never persisted, so we skip the server call for those.)
    if (!deleted.id.startsWith('P-NEW-')) {
      this.productsApi.archive(deleted.id).catch(() => {});
    }
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
