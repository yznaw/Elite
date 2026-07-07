import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ProductDrawerComponent } from './product-drawer.component';
import { BulkImportDialogComponent } from './bulk-import-dialog.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { AdminRefService, RefColor } from '../../services/admin-ref.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { Collection, Product, QAR } from '../../models';
import { StorageService } from '../../services/storage.service';
import { StoreConfigService } from '../../services/store-config.service';
import { COLLECTIONS } from '../../data/mock';
// import { Product, QAR } from '../../models';

type SortKey = 'name-az' | 'name-za' | 'price-asc' | 'price-desc' | 'stock-asc' | 'stock-desc' | 'newest';
type ViewMode = 'grid' | 'list';
type StatusFilter = 'all' | 'active' | 'hidden' | 'low-stock' | 'out-of-stock';
type BulkAction = 'status-active' | 'status-hidden' | 'delete';

@Component({
  selector: 'ap-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, EmptyStateComponent, SpinnerComponent, ProductDrawerComponent, BulkImportDialogComponent],
  template: `
    <div class="page-fade">

      <!-- ── Top bar ── -->
      <div class="card mb-16" style="padding:12px 14px;">

        <!-- Row 1: search (full width) -->
        <div class="tb-row1">
          <div class="inp-search search-box">
            <ap-icon name="search" [size]="14"/>
            <input class="inp with-icon" [placeholder]="t('catalog.search.placeholder')"
                   [ngModel]="search()" (ngModelChange)="search.set($event); page.set(0)"/>
          </div>
        </div>

        <!-- Row 2: status quick-filter pills -->
        <div class="tb-row2">
          <div class="status-pills">
            <button class="status-pill" [class.active]="statusFilter() === 'all'"    (click)="statusFilter.set('all'); page.set(0)">{{ t('catalog.status.all') }}</button>
            <button class="status-pill" [class.active]="statusFilter() === 'active'" (click)="statusFilter.set('active'); page.set(0)">{{ t('catalog.status.active') }}</button>
            <button class="status-pill" [class.active]="statusFilter() === 'hidden'" (click)="statusFilter.set('hidden'); page.set(0)">{{ t('catalog.status.hidden') }}</button>
            <button class="status-pill danger" [class.active]="statusFilter() === 'out-of-stock'" (click)="statusFilter.set('out-of-stock'); page.set(0)">
              {{ t('catalog.status.outOfStock') }}
              @if (outOfStockCount() > 0) { <span class="ls-badge danger-badge">{{ outOfStockCount() }}</span> }
            </button>
            <button class="status-pill warn" [class.active]="statusFilter() === 'low-stock'" (click)="statusFilter.set('low-stock'); page.set(0)">
              {{ t('catalog.status.lowStock') }}
              @if (lowStockCount() > 0) { <span class="ls-badge">{{ lowStockCount() }}</span> }
            </button>
          </div>
        </div>

        <!-- Row 3: CTAs -->
        <div class="tb-row3">
          <select class="inp ctrl-inp" [ngModel]="sortKey()" (ngModelChange)="sortKey.set($event)">
            <option value="newest">{{ t('catalog.sort.newest') }}</option>
            <option value="name-az">{{ t('catalog.sort.nameAsc') }}</option>
            <option value="name-za">{{ t('catalog.sort.nameDesc') }}</option>
            <option value="price-asc">{{ t('catalog.sort.priceAsc') }}</option>
            <option value="price-desc">{{ t('catalog.sort.priceDesc') }}</option>
            <option value="stock-asc">{{ t('catalog.sort.stockAsc') }}</option>
            <option value="stock-desc">{{ t('catalog.sort.stockDesc') }}</option>
          </select>
          <div class="view-toggle">
            <button class="vt-btn" [class.active]="viewMode() === 'grid'" (click)="setView('grid')" [title]="t('catalog.btn.gridView')">
              <ap-icon name="grid" [size]="14"/>
            </button>
            <button class="vt-btn" [class.active]="viewMode() === 'list'" (click)="setView('list')" [title]="t('catalog.btn.listView')">
              <ap-icon name="rows" [size]="14"/>
            </button>
          </div>
          <button class="btn btn-outline btn-sm" [class.btn-filter-active]="hasAdvancedFilters()"
                  (click)="toggleFilters()" [title]="t('catalog.btn.filters')">
            <ap-icon name="filter" [size]="13"/>
            <span class="btn-lbl">{{ t('catalog.btn.filters') }}</span>
            @if (hasAdvancedFilters()) { <span class="filter-badge">{{ activeFilterCount() }}</span> }
          </button>
          <button class="btn btn-sm" [class.btn-outline]="!selectionMode()" [class.btn-active]="selectionMode()"
                  (click)="toggleSelectionMode()" [title]="t('catalog.btn.select')">
            <ap-icon name="check" [size]="13"/> <span class="btn-lbl">{{ selectionMode() ? t('common.cancel') : t('catalog.btn.select') }}</span>
          </button>
          <div class="tb-row3-end">
            <button class="btn btn-outline btn-sm" (click)="exportCsv()" [disabled]="filtered().length === 0" [title]="t('common.exportCsv')">
              <ap-icon name="download" [size]="14"/> <span class="btn-lbl">{{ t('common.export') }}</span>
            </button>
            <button class="btn btn-outline btn-sm" (click)="showBulkImport.set(true)" [title]="t('catalog.btn.import')">
              <ap-icon name="upload" [size]="14"/> <span class="btn-lbl">{{ t('catalog.btn.import') }}</span>
            </button>
            <button class="btn btn-gold btn-sm" (click)="createProduct()" [disabled]="selectionMode()" title="New Product">
              <ap-icon name="plus" [size]="14"/> <span class="btn-lbl">{{ t('catalog.newProduct') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ── Advanced filter panel ── -->
      @if (showFilters() && isMobile()) {
        <div class="filter-backdrop" (click)="toggleFilters()" aria-hidden="true"></div>
      }
      @if (showFilters()) {
        <div class="filter-panel card mb-16">
          <div class="filter-panel-grid">

            <div class="fp-group">
              <label class="fp-label">{{ t('catalog.filter.collection') }}</label>
              <select class="inp inp-sm" [ngModel]="collectionId()" (ngModelChange)="collectionId.set($event); page.set(0)">
                <option value="All">{{ t('catalog.filter.allCollections') }}</option>
                @for (c of collections(); track c.id) {
                  <option [value]="c.id">{{ c.title }}</option>
                }
              </select>
            </div>

            <div class="fp-group">
              <label class="fp-label">{{ t('catalog.filter.brand') }}</label>
              <select class="inp inp-sm" [ngModel]="brandFilter()" (ngModelChange)="brandFilter.set($event); page.set(0)">
                <option value="all">{{ t('catalog.filter.allBrands') }}</option>
                @for (b of brands(); track b) {
                  <option [value]="b">{{ b }}</option>
                }
              </select>
            </div>

            <div class="fp-group cf-wrap" (click)="$event.stopPropagation()">
              <label class="fp-label">{{ t('catalog.filter.color') }}</label>
              <!-- Trigger button -->
              <button type="button" class="inp inp-sm cf-trigger"
                      [class.cf-active]="colorFilter() !== 'all'"
                      (click)="colorFilterOpen.set(!colorFilterOpen())">
                @if (colorFilter() !== 'all') {
                  @if (colorSwatchImageFor(colorFilter()); as swatchImg) {
                    <img class="cf-swatch cf-swatch--img" [src]="swatchImg" [alt]="colorFilter()"/>
                  } @else {
                    <span class="cf-swatch" [style.background]="colorHexFor(colorFilter())"></span>
                  }
                  <span class="cf-trigger-name">{{ colorFilter() }}</span>
                } @else {
                  <span class="cf-trigger-name muted">{{ t('catalog.filter.allColors') }}</span>
                }
                <ap-icon name="arrowDn" [size]="10" class="cf-chev"
                         [class.open]="colorFilterOpen()"/>
              </button>
              <!-- Dropdown panel -->
              @if (colorFilterOpen()) {
                <div class="cf-panel">
                  <button type="button" class="cf-option"
                          [class.cf-option--sel]="colorFilter() === 'all'"
                          (click)="colorFilter.set('all'); colorFilterOpen.set(false); page.set(0)">
                    <span class="cf-swatch cf-swatch--all">✕</span>
                    {{ t('catalog.filter.allColors') }}
                  </button>
                  @for (c of refColors(); track c.id) {
                    <button type="button" class="cf-option"
                            [class.cf-option--sel]="colorFilter() === c.name_en"
                            (click)="colorFilter.set(c.name_en); colorFilterOpen.set(false); page.set(0)">
                      @if (c.swatch_image_url) {
                        <img class="cf-swatch cf-swatch--img" [src]="c.swatch_image_url" [alt]="c.name_en"/>
                      } @else {
                        <span class="cf-swatch" [style.background]="c.hex"></span>
                      }
                      {{ c.name_en }}
                    </button>
                  }
                </div>
              }
            </div>

            <div class="fp-group fp-price">
              <label class="fp-label">{{ t('catalog.filter.priceRange') }}</label>
              <div class="price-range">
                <input class="inp inp-sm mono" type="number" min="0" [placeholder]="t('catalog.filter.min')"
                       [ngModel]="priceMin()" (ngModelChange)="priceMin.set(+$event || 0); page.set(0)"/>
                <span class="price-sep">–</span>
                <input class="inp inp-sm mono" type="number" min="0" [placeholder]="t('catalog.filter.max')"
                       [ngModel]="priceMax()" (ngModelChange)="priceMax.set(+$event || 0); page.set(0)"/>
              </div>
            </div>

            <div class="fp-group fp-page">
              <label class="fp-label">{{ t('common.perPage') }}</label>
              <select class="inp inp-sm" [ngModel]="pageSize()" (ngModelChange)="pageSize.set(+$event)">
                <option [value]="25">25</option>
                <option [value]="50">50</option>
                <option [value]="100">100</option>
                <option [value]="0">{{ t('catalog.filter.all') }}</option>
              </select>
            </div>

          </div>

          @if (hasAdvancedFilters()) {
            <div class="filter-chips">
              @if (collectionId() !== 'All') {
                <span class="fchip">{{ t('catalog.filter.collectionLabel') }} {{ collectionLabel() }} <button (click)="collectionId.set('All')">×</button></span>
              }
              @if (brandFilter() !== 'all') {
                <span class="fchip">{{ t('catalog.filter.brandLabel') }} {{ brandFilter() }} <button (click)="brandFilter.set('all')">×</button></span>
              }
              @if (colorFilter() !== 'all') {
                <span class="fchip fchip--color">
                  @if (colorSwatchImageFor(colorFilter()); as swatchImg) {
                    <img class="fchip-swatch fchip-swatch--img" [src]="swatchImg" [alt]="colorFilter()"/>
                  } @else {
                    <span class="fchip-swatch" [style.background]="colorHexFor(colorFilter())"></span>
                  }
                  {{ colorFilter() }}
                  <button (click)="colorFilter.set('all'); colorFilterOpen.set(false)">×</button>
                </span>
              }
              @if (priceMin() > 0 || priceMax() > 0) {
                <span class="fchip">{{ t('catalog.filter.priceLabel') }} {{ priceMin() }}–{{ priceMax() || '∞' }} QAR <button (click)="priceMin.set(0);priceMax.set(0)">×</button></span>
              }
              <button class="btn btn-sm btn-outline" style="font-size:11px;padding:2px 10px;" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
            </div>
          }
        </div>
      }

      <!-- ── Selection toolbar ── -->
      @if (selectionMode()) {
        <div class="sel-bar mb-16">
          <div class="sel-count">
            @if (selectedIds().size === 0) {
              <span class="muted">{{ t('catalog.selection.tap') }}</span>
            } @else {
              <strong>{{ selectedIds().size }}</strong> {{ t('catalog.selection.of') }} {{ paged().length }} {{ t('catalog.selection.selected') }}
            }
          </div>
          <div class="sel-actions">
            <button class="btn btn-sm btn-outline" (click)="selectAll()">{{ t('catalog.selection.selectAll') }} ({{ paged().length }})</button>
            @if (selectedIds().size > 0) {
              <button class="btn btn-sm btn-outline" (click)="clearSelection()">{{ t('catalog.selection.clear') }}</button>

              <!-- Bulk status dropdown -->
              <div class="bulk-status-wrap">
                <select class="inp inp-sm" (change)="onBulkStatusChange($event)">
                  <option value="">{{ t('catalog.bulk.setStatus') }}</option>
                  <option value="status-active">{{ t('catalog.bulk.makeActive') }}</option>
                  <option value="status-hidden">{{ t('catalog.bulk.makeHidden') }}</option>
                </select>
              </div>

              @if (confirmingDelete()) {
                <div class="del-confirm">
                  <span class="del-warn">{{ t('common.delete') }} {{ selectedIds().size }} {{ selectedIds().size === 1 ? t('catalog.product') : t('catalog.products') }}?</span>
                  <button class="btn btn-sm btn-danger" (click)="confirmDelete()">{{ t('catalog.bulk.confirmDelete') }}</button>
                  <button class="btn btn-sm btn-outline" (click)="confirmingDelete.set(false)">{{ t('common.cancel') }}</button>
                </div>
              } @else {
                <button class="btn btn-sm btn-danger" (click)="confirmingDelete.set(true)">
                  <ap-icon name="trash" [size]="13"/> {{ t('common.delete') }} ({{ selectedIds().size }})
                </button>
              }
            }
          </div>
        </div>
      }

      <!-- ── Count + result bar ── -->
      @if (!selectionMode()) {
        <div class="result-bar mb-12">
          <span class="muted small">
            {{ pagedLabel() }}
          </span>
          <div class="row gap-sm small">
            <span class="row gap-sm"><ap-pill kind="green">✓</ap-pill> {{ t('catalog.linked') }}</span>
            <span class="row gap-sm"><ap-pill kind="grey">○</ap-pill> {{ t('catalog.missing') }}</span>
          </div>
        </div>
      }

      <!-- ── GRID view ── -->
      @if (effectiveView() === 'grid') {
        @if (paged().length === 0) {
          <div class="card">
            <ap-empty-state icon="catalog" [title]="t('catalog.empty.title')" [sub]="t('catalog.empty.sub')">
              <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
            </ap-empty-state>
          </div>
        } @else {
          <div class="grid-cards">
            @for (p of paged(); track p.id) {
              <div class="prod-card" [class.selected]="selectedIds().has(p.id)"
                   [style.opacity]="p.hidden && !selectionMode() ? 0.65 : 1"
                   (click)="selectionMode() ? toggleSelect(p.id) : openProduct(p)">

                @if (selectionMode()) {
                  <div class="sel-check" [class.checked]="selectedIds().has(p.id)">
                    @if (selectedIds().has(p.id)) { <ap-icon name="check" [size]="12"/> }
                  </div>
                }

                <div class="prod-img">
                  @if (p.image) {
                    <img [src]="p.image" [alt]="p.name" (error)="onImgError($event)"
                         [style.filter]="p.hidden && !selectionMode() ? 'grayscale(0.6)' : null"/>
                  } @else {
                    <div class="prod-img-empty">
                      <ap-icon name="catalog" [size]="32"/>
                    </div>
                  }
                  @if (!selectionMode()) {
                    @if (p.hidden) {
                      <span class="prod-hidden-badge">○ {{ t('catalog.hidden') }}</span>
                    }
                    @if (!p.hidden && p.stock === 0) {
                      <span class="prod-oos-badge">{{ t('catalog.status.outOfStock') }}</span>
                    }
                  }
                </div>
                <div class="prod-body">
                  <div class="prod-name">{{ p.name }}</div>
                  <div class="prod-sku">{{ p.sku }} · {{ p.brand }}</div>
                  <div class="prod-meta">
                    <span class="prod-price">{{ QAR(p.price) }}</span>
                    @if (!selectionMode()) {
                      <span class="prod-stock" [class.low]="p.stock > 0 && p.stock < lowStockThreshold()" [class.out]="p.stock === 0">
                        {{ stockLabel(p) }}
                      </span>
                    }
                    @if (selectionMode() && p.variants?.length) {
                      <span class="var-count">{{ p.variants!.length }} {{ t('catalog.colors') }}</span>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        }
      }

      <!-- ── LIST view ── -->
      @if (effectiveView() === 'list') {
        @if (paged().length === 0) {
          <div class="card">
            <ap-empty-state icon="catalog" [title]="t('catalog.empty.title')" [sub]="t('catalog.empty.sub')">
              <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
            </ap-empty-state>
          </div>
        } @else {
          <div class="list-view card">
            <div class="lv-head">
              <div class="lv-c-img"></div>
              <div class="lv-c-name">{{ t('catalog.header.product') }}</div>
              <div class="lv-c-sku hide-mobile">{{ t('catalog.header.sku') }}</div>
              <div class="lv-c-price">{{ t('catalog.header.price') }}</div>
              <div class="lv-c-stock hide-mobile">{{ t('catalog.header.stock') }}</div>
              <div class="lv-c-variants hide-mobile">{{ t('catalog.header.variants') }}</div>
              <div class="lv-c-status hide-small">{{ t('catalog.header.status') }}</div>
            </div>
            @for (p of paged(); track p.id) {
              <div class="lv-row" [class.selected]="selectedIds().has(p.id)"
                   [style.opacity]="p.hidden && !selectionMode() ? 0.7 : 1"
                   (click)="selectionMode() ? toggleSelect(p.id) : openProduct(p)">
                @if (selectionMode()) {
                  <div class="sel-check lv-check" [class.checked]="selectedIds().has(p.id)">
                    @if (selectedIds().has(p.id)) { <ap-icon name="check" [size]="11"/> }
                  </div>
                }
                <div class="lv-c-img">
                  @if (p.image) {
                    <img class="lv-thumb" [src]="p.image" [alt]="p.name" (error)="onImgError($event)"/>
                  } @else {
                    <div class="lv-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-2);color:var(--muted);">
                      <ap-icon name="catalog" [size]="16"/>
                    </div>
                  }
                </div>
                <div class="lv-c-name">
                  <span class="lv-name">{{ p.name }}</span>
                  <span class="lv-brand muted small">{{ p.brand }}</span>
                </div>
                <div class="lv-c-sku hide-mobile mono small muted">{{ p.sku }}</div>
                <div class="lv-c-price mono">{{ QAR(p.price) }}</div>
                <div class="lv-c-stock hide-mobile">
                  <span class="prod-stock" [class.low]="p.stock > 0 && p.stock < lowStockThreshold()" [class.out]="p.stock === 0">
                    {{ p.stock === 0 ? t('catalog.outOfStock') : p.stock }}
                  </span>
                </div>
                <div class="lv-c-variants hide-mobile small muted">{{ p.variants?.length ?? 0 }}</div>
                <div class="lv-c-status hide-small">
                  <ap-pill [kind]="p.hidden ? 'red' : 'green'">
                    {{ p.hidden ? t('catalog.status.hidden') : t('catalog.status.active') }}
                  </ap-pill>
                </div>
              </div>
            }
          </div>
        }
      }

      <!-- ── Pagination ── -->
      @if (pageSize() > 0 && filtered().length > pageSize()) {
        <div class="pagination mt-16">
          <button class="btn btn-sm btn-outline" [disabled]="page() === 0" (click)="prevPage()">← {{ t('common.prev') }}</button>
          <span class="muted small">{{ t('catalog.pagination.page') }} {{ page() + 1 }} {{ t('catalog.pagination.of') }} {{ totalPages() }}</span>
          <button class="btn btn-sm btn-outline" [disabled]="page() >= totalPages() - 1" (click)="nextPage()">{{ t('common.next') }} →</button>
        </div>
      }
    </div>

    @if (showBulkImport()) {
      <ap-bulk-import-dialog
        (closed)="showBulkImport.set(false)"
        (imported)="onBulkImported()"
      />
    }

    @if (activeId(); as id) {
      <ap-product-drawer
        [products]="paged()"
        [collections]="collections()"
        [currentId]="id"
        (closed)="onDrawerClosed()"
        (currentIdChange)="activeId.set($event)"
        (deleted)="onDeleted($event)"
        (duplicated)="onDuplicated($event)"
        (productSaved)="onProductSaved($event)"
      />
    }
  `,
  styles: [`
    /* ── Top bar rows ── */
    .tb-row1 { margin-bottom: 10px; }
    .search-box { width: 100%; position: relative; }
    .tb-row2 {
      margin-bottom: 8px;
    }
    .tb-row3 {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .tb-row3-end {
      display: flex; align-items: center; gap: 6px; margin-inline-start: auto;
    }
    .status-pills {
      display: flex; gap: 2px; flex-shrink: 0;
      background: var(--bg-2); border-radius: 8px; padding: 3px;
    }
    .status-pill {
      border: none; background: none; padding: 5px 12px;
      font-size: 12px; font-weight: 600; border-radius: 6px;
      cursor: pointer; color: var(--muted); transition: all 0.13s;
    }
    .status-pill.active { background: var(--surface); color: var(--green); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .status-pill.warn, .status-pill.danger { display: flex; align-items: center; gap: 4px; }
    .status-pill.warn.active  { color: var(--warning, #f59e0b); }
    .status-pill.danger.active { color: var(--danger, #dc2626); }
    .ls-badge { background: var(--warning, #f59e0b); color: #fff; font-size: 10px; font-weight: 800; border-radius: 10px; padding: 0 5px; line-height: 16px; }
    .danger-badge { background: var(--danger, #dc2626) !important; }
    .ctrl-inp { width: auto; min-width: 110px; font-size: 12px; padding: 6px 10px; }

    /* ── View toggle ── */
    .view-toggle {
      display: flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden;
    }
    .vt-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: none; cursor: pointer; color: var(--muted);
      transition: all 0.12s;
    }
    .vt-btn:hover { background: var(--bg-2); color: var(--ink); }
    .vt-btn.active { background: var(--green); color: #fff; }
    .vt-btn + .vt-btn { border-inline-start: 1px solid var(--border); }

    /* ── Filter button ── */
    .btn-filter-active { border-color: var(--gold); color: var(--gold); background: rgba(201,168,76,.06); }
    .filter-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--gold); color: #fff; font-size: 10px; font-weight: 700;
    }

    /* ── Advanced filter panel ── */
    .filter-panel { padding: 16px; }
    .filter-panel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .fp-group { display: flex; flex-direction: column; gap: 4px; }
    .fp-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
    .price-range { display: flex; align-items: center; gap: 6px; }
    .price-sep { color: var(--muted); flex-shrink: 0; }
    .price-range .inp { flex: 1; min-width: 60px; }

    /* ── Filter chips ── */
    .filter-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border-2); }
    .fchip {
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--gold-3, rgba(201,168,76,.1)); border: 1px solid rgba(201,168,76,.3);
      border-radius: 20px; padding: 3px 10px; font-size: 12px; color: var(--ink-2);
    }
    .fchip button {
      background: none; border: none; cursor: pointer; color: var(--muted);
      font-size: 14px; line-height: 1; padding: 0 0 0 4px;
    }
    .fchip button:hover { color: var(--danger); }
    .fchip--color { gap: 6px; }
    .fchip-swatch {
      width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.1); display: inline-block;
    }
    .fchip-swatch--img { object-fit: cover; }

    /* ── Custom color filter picker ─────────────────────────── */
    .cf-wrap { position: relative; }

    .cf-trigger {
      display: flex; align-items: center; gap: 6px;
      text-align: left; cursor: pointer; width: 100%;
      background: var(--surface);
    }
    .cf-trigger.cf-active { border-color: var(--gold); background: rgba(201,168,76,.04); }
    .cf-trigger-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cf-chev { color: var(--muted); transition: transform .2s; flex-shrink: 0; }
    .cf-chev.open { transform: rotate(180deg); }

    .cf-swatch {
      width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.1); display: inline-flex;
      align-items: center; justify-content: center;
    }
    .cf-swatch--img { object-fit: cover; }
    .cf-swatch--all {
      font-size: 9px; color: var(--muted); background: var(--bg-2);
      border-style: dashed;
    }

    .cf-panel {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12);
      z-index: 200; max-height: 240px; overflow-y: auto;
      display: flex; flex-direction: column;
    }
    .cf-option {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; font-size: 13px; text-align: left;
      background: none; border: none; cursor: pointer;
      color: var(--ink); transition: background .1s;
    }
    .cf-option:hover { background: var(--bg-2); }
    .cf-option--sel { background: rgba(2,70,56,.06); color: var(--green); font-weight: 600; }
    .cf-option--sel:hover { background: rgba(2,70,56,.1); }

    /* ── Selection toolbar ── */
    .sel-bar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 10px 14px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; flex-wrap: wrap;
    }
    .sel-count { font-size: 13px; flex-shrink: 0; }
    .sel-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .del-confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .del-warn { font-size: 12px; color: #dc2626; font-weight: 600; }
    .btn-active { background: #c9a84c22; border-color: #c9a84c; color: #a07830; }
    .btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
    .btn-danger:hover { background: #b91c1c; border-color: #b91c1c; }
    .bulk-status-wrap select { font-size: 12px; }

    /* ── Result bar ── */
    .result-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }

    /* ── Card grid (existing) ── */
    .prod-img-empty {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-2); color: var(--muted);
    }
    .prod-card { position: relative; cursor: pointer; transition: outline .1s; }
    .prod-card.selected { outline: 2px solid #c9a84c; outline-offset: 2px; border-radius: 10px; }
    .sel-check {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      width: 22px; height: 22px; border-radius: 6px;
      background: rgba(255,255,255,0.92); border: 2px solid #d4d4d8;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,.12);
    }
    .sel-check.checked { background: #c9a84c; border-color: #c9a84c; color: #fff; }
    .var-count { font-size: 11px; opacity: .55; }
    .prod-hidden-badge {
      position: absolute; top: 10px; inset-inline-end: 10px;
      background: rgba(239,68,68,0.92); color: #fff;
      font-size: 10px; font-weight: 700; border-radius: 6px;
      padding: 2px 7px;
    }
    .prod-oos-badge {
      position: absolute; bottom: 10px; inset-inline-start: 10px;
      background: rgba(15,23,42,0.82); color: #fff;
      font-size: 10px; font-weight: 700; border-radius: 6px;
      padding: 2px 7px; backdrop-filter: blur(4px);
    }

    /* ── List view ── */
    .list-view { overflow: hidden; }
    .lv-head, .lv-row {
      display: grid;
      grid-template-columns: 44px minmax(180px,1fr) 120px 90px 70px 70px 80px;
      gap: 10px; align-items: center;
      padding: 10px 14px;
    }
    .lv-head {
      background: var(--bg); border-bottom: 1px solid var(--border-2);
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em; color: var(--muted);
    }
    .lv-row { border-top: 1px solid var(--border-2); cursor: pointer; transition: background 0.12s; }
    .lv-row:first-of-type { border-top: none; }
    .lv-row:hover { background: var(--bg-2); }
    .lv-row.selected { background: rgba(201,168,76,.07); outline: none; }
    .lv-check { position: relative; top: 0; left: 0; }
    .lv-thumb {
      width: 36px; height: 36px; object-fit: cover;
      border-radius: 6px; display: block;
    }
    .lv-name { font-size: 13px; font-weight: 600; display: block; }
    .lv-brand { display: block; }
    .lv-c-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow: hidden; }

    /* ── Pagination ── */
    .pagination { display: flex; align-items: center; justify-content: center; gap: 14px; }

    /* ── Responsive breakpoints ── */
    @media (max-width: 900px) {
      .lv-head, .lv-row { grid-template-columns: 36px minmax(120px,1fr) 80px 70px; }
      .hide-mobile { display: none !important; }
    }

    @media (max-width: 640px) {
      /* Row 2: pills scroll horizontally */
      .status-pills {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        border-radius: 10px;
        width: 100%;
      }
      .status-pills::-webkit-scrollbar { display: none; }

      /* Row 3: full-width equal buttons */
      .tb-row3 { gap: 6px; width: 100%; }
      .tb-row3 .btn-lbl { display: none; }
      .ctrl-inp { display: none; }
      /* Dissolve the end-group so its children join the parent flex */
      .tb-row3-end { display: contents; }
      /* Every direct flex child stretches equally */
      .tb-row3 > * { flex: 1 1 0; min-width: 0; justify-content: center; padding-inline: 0; }
      /* New Product is the primary CTA — double width, show label */
      .tb-row3 .btn-gold { flex: 2 1 0; }
      .tb-row3 .btn-gold .btn-lbl { display: inline; }

      /* List view on narrow: 3 columns */
      .lv-head, .lv-row { grid-template-columns: 36px 1fr 80px; }
      .hide-small { display: none !important; }

      /* Filter panel: 2 columns */
      .filter-panel-grid { grid-template-columns: 1fr 1fr; }

      /* Selection bar: stack vertically */
      .sel-bar { flex-direction: column; align-items: flex-start; }
      .sel-actions { width: 100%; flex-wrap: wrap; }

      /* Hide view toggle on phone — grid is forced */
      .view-toggle { display: none !important; }
    }

    /* ── Mobile filter bottom sheet ── */
    @media (max-width: 768px) {
      .filter-backdrop {
        position: fixed; inset: 0; z-index: 180;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        animation: fadeIn 0.18s ease;
      }
      .filter-panel {
        position: fixed;
        inset-inline: 0;
        bottom: calc(56px + env(safe-area-inset-bottom, 0px));
        max-height: 72vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        z-index: 190;
        border-radius: 20px 20px 0 0 !important;
        margin-bottom: 0 !important;
        box-shadow: 0 -8px 40px rgba(2,70,56,.15);
        animation: sheetUp 0.28s cubic-bezier(.34,1.1,.64,1);
      }
      @keyframes sheetUp {
        from { transform: translateY(100%); }
        to   { transform: translateY(0); }
      }
      /* Compact grid inside the sheet */
      .filter-panel-grid { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class CatalogComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly productsApi = inject(AdminProductsService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  private readonly refApi = inject(AdminRefService);
  private readonly storage = inject(StorageService);
  private readonly storeConfig = inject(StoreConfigService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;
  readonly collections = signal<Collection[]>([]);

  private readonly _products = signal<Product[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const [list, collections, colors] = await Promise.all([
        this.productsApi.list(),
        this.collectionsApi.list().catch(() => [] as Collection[]),
        this.refApi.getColors().catch(() => [] as RefColor[]),
      ]);
      this._products.set(list);
      this.collections.set(collections.filter((collection) => !collection.hidden));
      this.refColors.set(colors);
    } catch {
      this._products.set([]);
    } finally {
      this.loading.set(false);
    }
    const stockParam = this.route.snapshot.queryParamMap.get('stock');
    if (stockParam === 'low') this.statusFilter.set('low-stock');
    const colorParam = this.route.snapshot.queryParamMap.get('color');
    if (colorParam) { this.colorFilter.set(colorParam); this.showFilters.set(true); }
    const qParam = this.route.snapshot.queryParamMap.get('q');
    if (qParam) this.search.set(qParam);
  }

  // ── Filter / sort / view state ────────────────────────────────────────────
  readonly search        = signal('');
  readonly collectionId  = signal('All');
  readonly brandFilter   = signal('all');

  readonly statusFilter  = signal<StatusFilter>('all');
  readonly colorFilter   = signal('all');
  readonly priceMin      = signal(0);
  readonly priceMax      = signal(0);
  readonly sortKey       = signal<SortKey>('newest');
  readonly viewMode      = signal<ViewMode>(
    (this.storage.get('catalog-view') as ViewMode) || 'grid',
  );
  readonly showFilters   = signal(false);
  readonly isMobile      = signal(window.innerWidth <= 768);

  @HostListener('window:resize')
  onResize(): void { this.isMobile.set(window.innerWidth <= 768); }

  @HostListener('document:click')
  onDocClick(): void { this.colorFilterOpen.set(false); }

  readonly effectiveView = computed<ViewMode>(() =>
    this.isMobile() ? 'grid' : this.viewMode()
  );
  readonly page          = signal(0);
  readonly pageSize      = signal(25);
  readonly refColors        = signal<RefColor[]>([]);
  readonly colorFilterOpen  = signal(false);

  colorHexFor(name: string): string {
    return this.refColors().find(c => c.name_en === name)?.hex ?? '#e5e7eb';
  }
  colorSwatchImageFor(name: string): string | null {
    return this.refColors().find(c => c.name_en === name)?.swatch_image_url ?? null;
  }

  readonly activeId        = signal<string | null>(null);
  readonly showBulkImport  = signal(false);

  readonly lowStockThreshold = computed(() => this.storeConfig.lowStockThreshold());

  readonly lowStockCount = computed(() =>
    this._products().filter(p => p.stock > 0 && p.stock < this.lowStockThreshold()).length,
  );

  readonly outOfStockCount = computed(() =>
    this._products().filter(p => !p.hidden && p.stock === 0).length,
  );

  readonly brands = computed(() => {
    const set = new Set(this._products().map(p => p.brand).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  });
  readonly selectionMode   = signal(false);
  readonly selectedIds     = signal(new Set<string>());
  readonly confirmingDelete = signal(false);

  setView(v: ViewMode): void {
    this.viewMode.set(v);
    this.storage.set('catalog-view', v);
  }

  toggleFilters(): void { this.showFilters.update(v => !v); }
  prevPage(): void { this.page.update(p => p - 1); }
  nextPage(): void { this.page.update(p => p + 1); }

  // ── Computed ──────────────────────────────────────────────────────────────

  readonly hasAdvancedFilters = computed(() =>
    this.collectionId() !== 'All' ||
    this.brandFilter() !== 'all' ||
    this.colorFilter() !== 'all' ||
    this.priceMin() > 0 ||
    this.priceMax() > 0,
  );

  readonly activeFilterCount = computed(() => {
    let n = 0;
    if (this.collectionId() !== 'All') n++;
    if (this.brandFilter() !== 'all') n++;
    if (this.colorFilter() !== 'all') n++;
    if (this.priceMin() > 0 || this.priceMax() > 0) n++;
    return n;
  });

  readonly filtered = computed(() => {
    const s         = this.search().toLowerCase();
    const colId     = this.collectionId();
    const brand     = this.brandFilter();
    const status    = this.statusFilter();
    const colF      = this.colorFilter();
    const pMin      = this.priceMin();
    const pMax      = this.priceMax();
    const sort      = this.sortKey();
    const threshold = this.lowStockThreshold();

    let list = this._products().filter(p => {
      if (status === 'active'       && p.hidden) return false;
      if (status === 'hidden'       && !p.hidden) return false;
      if (status === 'out-of-stock' && p.stock !== 0) return false;
      if (status === 'low-stock'    && !(p.stock > 0 && p.stock < threshold)) return false;

      if (colId !== 'All') {
        const col = this.collections().find(c => c.id === colId);
        if (col && !col.productIds.includes(p.id)) return false;
      }

      if (brand !== 'all' && p.brand !== brand) return false;

      if (colF !== 'all') {
        const variantColors = p.variants?.map(v => v.color?.toLowerCase()) ?? [];
        if (!variantColors.includes(colF.toLowerCase())) return false;
      }

      if (pMin > 0 && p.price < pMin) return false;
      if (pMax > 0 && p.price > pMax) return false;

      if (s && !(p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.brand.toLowerCase().includes(s))) return false;

      return true;
    });

    // Sort
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'name-az':    return a.name.localeCompare(b.name);
        case 'name-za':    return b.name.localeCompare(a.name);
        case 'price-asc':  return a.price - b.price;
        case 'price-desc': return b.price - a.price;
        case 'stock-asc':  return a.stock - b.stock;
        case 'stock-desc': return b.stock - a.stock;
        default:           return 0; // newest = insertion order from API
      }
    });

    return list;
  });

  readonly totalPages = computed(() =>
    this.pageSize() > 0 ? Math.ceil(this.filtered().length / this.pageSize()) : 1,
  );

  readonly paged = computed(() => {
    const all = this.filtered();
    if (this.pageSize() === 0) return all;
    const start = this.page() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  readonly pagedLabel = computed(() => {
    const total = this.filtered().length;
    const ps = this.pageSize();
    if (ps === 0 || total <= ps) return `${total} ${total !== 1 ? this.t('catalog.products') : this.t('catalog.product')}`;
    const start = this.page() * ps + 1;
    const end = Math.min((this.page() + 1) * ps, total);
    return `${start}–${end} ${this.t('catalog.pagination.of')} ${total}`;
  });

  collectionLabel(): string {
    const c = this.collections().find(x => x.id === this.collectionId());
    return c?.title ?? this.collectionId();
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  toggleSelectionMode(): void {
    this.selectionMode.update(v => !v);
    this.selectedIds.set(new Set());
    this.confirmingDelete.set(false);
    this.activeId.set(null);
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  selectAll(): void { this.selectedIds.set(new Set(this.paged().map(p => p.id))); }
  clearSelection(): void { this.selectedIds.set(new Set()); }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  onBulkStatusChange(ev: Event): void {
    const action = (ev.target as HTMLSelectElement).value as BulkAction | '';
    (ev.target as HTMLSelectElement).value = '';
    if (!action || this.selectedIds().size === 0) return;
    if (action === 'status-active') void this.bulkSetStatus(false);
    if (action === 'status-hidden') void this.bulkSetStatus(true);
  }

  async bulkSetStatus(hidden: boolean): Promise<void> {
    const ids = [...this.selectedIds()];
    this._products.update(all =>
      all.map(p => ids.includes(p.id) ? { ...p, hidden } : p),
    );
    this.clearSelection();
    this.selectionMode.set(false);
    try {
      await Promise.all(ids.map(id =>
        this.productsApi.update(id, { hidden }),
      ));
      this.toast.success(`${ids.length} ${ids.length === 1 ? this.t('catalog.product') : this.t('catalog.products')} — ${hidden ? this.t('catalog.status.hidden') : this.t('catalog.status.active')}`);
    } catch {
      const list = await this.productsApi.list().catch(() => this._products());
      this._products.set(list);
      this.toast.error(this.t('catalog.toast.statusError'));
    }
  }

  async confirmDelete(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.confirmingDelete.set(false);
    this._products.update(all => all.filter(p => !ids.includes(p.id)));
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    try {
      const { deleted } = await this.productsApi.bulkDelete(ids);
      this.toast.success(`${deleted} ${deleted === 1 ? this.t('catalog.product') : this.t('catalog.products')} — ${this.t('common.delete').toLowerCase()}`);
    } catch {
      const list = await this.productsApi.list().catch(() => this._products());
      this._products.set(list);
      this.toast.error(this.t('catalog.toast.deleteError'));
    }
  }

  // ── Product CRUD ──────────────────────────────────────────────────────────

  openProduct(p: Product): void { this.activeId.set(p.id); }

  onDrawerClosed(): void {
    const id = this.activeId();
    if (id?.startsWith('P-NEW-')) {
      const p = this._products().find(x => x.id === id);
      if (p && !p.name) this._products.update(all => all.filter(x => x.id !== id));
    }
    this.activeId.set(null);
  }

  onProductSaved(saved: Product): void {
    this._products.update(all => {
      const idx = all.findIndex(p => p.id === saved.id);
      if (idx === -1) return [saved, ...all];
      const next = [...all];
      next[idx] = saved;
      return next;
    });
  }

  createProduct(): void {
    const id = 'P-NEW-' + Date.now().toString(36).slice(-5).toUpperCase();
    const draft: Product = {
      id, name: '', sku: '', brand: '', price: 0, stock: 0,
      hidden: true,
      image: 'https://images.unsplash.com/photo-1519415943484-9fa1873496d4?w=600&q=80&auto=format&fit=crop',
      variants: [],
    };
    this._products.update(all => [draft, ...all]);
    this.clearFilters();
    this.activeId.set(id);
  }

  clearFilters(): void {
    this.search.set('');
    this.collectionId.set('All');
    this.brandFilter.set('all');
    this.statusFilter.set('all');
    this.colorFilter.set('all');
    this.colorFilterOpen.set(false);
    this.priceMin.set(0);
    this.priceMax.set(0);
    this.page.set(0);
  }

  onDeleted(deleted: Product): void {
    const before = this._products();
    const beforeIndex = before.findIndex(p => p.id === deleted.id);
    if (beforeIndex < 0) return;

    const visible = this.filtered();
    const visibleIndex = visible.findIndex(p => p.id === deleted.id);

    if (!deleted.id.startsWith('P-NEW-')) {
      this.productsApi.archive(deleted.id).catch(() => {});
    }
    this._products.update(all => all.filter(p => p.id !== deleted.id));

    const nextVisible = this.filtered();
    if (nextVisible.length === 0) {
      this.activeId.set(null);
    } else {
      this.activeId.set(nextVisible[Math.min(Math.max(visibleIndex, 0), nextVisible.length - 1)].id);
    }

    this.toast.success(
      this.t('product.toast.deleted.title'),
      `${deleted.name} (${deleted.sku})`,
      {
        label: this.t('common.undo'),
        run: () => {
          this._products.update(all => {
            const r = [...all];
            r.splice(beforeIndex, 0, deleted);
            return r;
          });
          this.activeId.set(deleted.id);
          this.toast.info(this.t('product.toast.restored.title'), deleted.name);
        },
      },
    );
  }

  async onBulkImported(): Promise<void> {
    try {
      const list = await this.productsApi.list();
      this._products.set(list);
      this.toast.success(this.t('catalog.toast.importComplete'), this.t('catalog.toast.importSub'));
    } catch { /* silent */ }
  }

  exportCsv(): void {
    const products = this.filtered();
    if (products.length === 0) return;
    const rows = [
      'SKU,Name,Brand,Price (QAR),Stock,Status,Variants',
      ...products.map(p => [
        `"${p.sku}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.brand.replace(/"/g, '""')}"`,
        p.price,
        p.stock,
        p.hidden ? 'Hidden' : 'Active',
        p.variants?.length ?? 0,
      ].join(',')),
    ];
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success(this.t('catalog.toast.exported'), `${products.length} ${products.length === 1 ? this.t('catalog.product') : this.t('catalog.products')}`);
  }

  onDuplicated(copy: Product): void {
    this._products.update(all => [copy, ...all]);
    this.activeId.set(copy.id);
  }

  stockLabel(p: Product): string {
    if (p.stock === 0) return this.t('catalog.outOfStock');
    if (p.stock < this.storeConfig.lowStockThreshold()) return `${this.t('catalog.lowStock')} · ${p.stock}`;
    return `${p.stock} ${this.t('catalog.inStock')}`;
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
