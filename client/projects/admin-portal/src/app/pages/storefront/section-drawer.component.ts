import {
  Component, EventEmitter, Input, OnDestroy, OnInit, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { PRODUCTS, COLLECTIONS } from '../../data/mock';
import { StorefrontBlock } from '../../models';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface FormShape extends StorefrontBlock {
  // Just StorefrontBlock with all optional fields normalised to non-undefined.
  productIds: string[];
}



@Component({
  selector: 'ap-section-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide section-drawer" [class.is-dirty]="dirty()">
      <div class="drawer-head section-head">
        <div style="min-width:0;flex:1;">
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">{{ form().title || form().type }}</div>
            <ap-pill [kind]="form().visible ? 'green' : 'red'">
              {{ form().visible ? t('storefront.section.visible') : t('storefront.section.hidden') }}
            </ap-pill>
            <span class="save-badge" [class]="'save-badge ' + saveState()">
              @if (saveState() === 'saving') { <ap-spinner [size]="10"/> }
              @if (saveState() === 'saved')  { <ap-icon name="check" [size]="10"/> }
              {{ saveLabel() }}
            </span>
          </div>
          <div class="card-sub">
            <span class="strong" style="color:var(--gold);">{{ form().type }}</span>
            <span> · {{ t('storefront.section.id') }} <span class="mono">{{ form().id }}</span></span>
          </div>
        </div>

        <button class="x-btn" (click)="handleClose()" [attr.aria-label]="t('common.close')">
          <ap-icon name="x" [size]="14"/>
        </button>
      </div>
      

      <div class="save-bar-top" [class.dirty]="dirty()" [class.shake]="shakeSaveBar()">
        <div class="row gap-sm" style="min-width:0;flex:1;">
          <span class="save-badge" style="background:transparent;border-color:transparent;color:#fff;">
            {{ t('product.unsaved.title') }}
          </span>
        </div>
        <div class="row gap-sm" style="flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" (click)="discard()" [disabled]="saveState() === 'saving'">
            {{ t('common.discard') }}
          </button>
          <button class="btn btn-primary btn-sm" (click)="save()" [disabled]="saveState() === 'saving'">
            @if (saveState() === 'saving') {
              <ap-spinner/> {{ t('common.saving') }}
            } @else if (saveState() === 'saved') {
              <ap-icon name="check" [size]="12"/> {{ t('common.save') }}d
            } @else {
              {{ t('common.saveChanges') }}
            }
          </button>
        </div>
      </div>

      <div class="drawer-body">
        <!-- Visibility -->
        <div class="vis-block mb-24" [class.hidden-state]="!form().visible">
          <div>
            <div class="strong" style="font-size:13px;margin-bottom:2px;" [style.color]="form().visible ? 'var(--ink)' : 'var(--danger)'">
              {{ form().visible ? t('storefront.vis.shownTitle') : t('storefront.vis.hiddenTitle') }}
            </div>
            <div class="muted small">
              {{ form().visible ? t('storefront.vis.shownSub') : t('storefront.vis.hiddenSub') }}
            </div>
          </div>
          <button class="toggle" [class.on]="form().visible" (click)="toggle('visible')" [attr.aria-label]="t('storefront.section.toggleVisibility')"></button>
        </div>

        <!-- Section: Content (title / subtitle / config description) -->
        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('storefront.section.content') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('storefront.field.title') }}</label>
          <input class="inp mb-16" [ngModel]="form().title" (ngModelChange)="set('title', $event)"/>

          <label class="lbl">{{ t('storefront.field.subtitle') }}</label>
          <input class="inp mb-16" [ngModel]="form().subtitle || ''" (ngModelChange)="set('subtitle', $event)" [placeholder]="t('storefront.field.subtitle.placeholder')"/>

          <label class="lbl">{{ t('storefront.field.config') }}</label>
          <input class="inp" [ngModel]="form().config" (ngModelChange)="set('config', $event)" [placeholder]="t('storefront.field.config.placeholder')"/>
          <div class="muted small mt-8">{{ t('storefront.field.config.help') }}</div>
        </div>

        <!-- Type-specific configuration -->
        @switch (form().type) {
          @case ('Hero Banner') {
            <div class="section-title">
              <ap-icon name="media" [size]="14"/>
              <span>{{ t('storefront.section.hero') }}</span>
            </div>

            <div class="mb-24">
              <label class="lbl">{{ t('storefront.field.imageUrl') }}</label>
              <input class="inp mono mb-16" [ngModel]="form().imageUrl || ''" (ngModelChange)="set('imageUrl', $event)" placeholder="https://…"/>

              @if (form().imageUrl) {
                <div style="aspect-ratio: 21/9; background: var(--bg-2); border-radius: 10px; overflow: hidden; margin-bottom: 16px;">
                  <img [src]="form().imageUrl" alt="" style="width:100%;height:100%;object-fit:cover;" (error)="onImgError($event)"/>
                </div>
              }

              <div class="grid-2 mb-16">
                <div>
                  <label class="lbl">{{ t('storefront.field.ctaText') }}</label>
                  <input class="inp" [ngModel]="form().ctaText || ''" (ngModelChange)="set('ctaText', $event)" [placeholder]="t('storefront.field.ctaText.placeholder')"/>
                </div>
                <div>
                  <label class="lbl">{{ t('storefront.field.ctaLink') }}</label>
                  <input class="inp mono" [ngModel]="form().ctaLink || ''" (ngModelChange)="set('ctaLink', $event)" placeholder="/collection"/>
                </div>
              </div>
            </div>
          }

          @case ('Featured Products') {
            <div class="section-title">
              <ap-icon name="catalog" [size]="14"/>
              <span>{{ t('storefront.section.products') }}</span>
            </div>

            <div class="mb-24">
              <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                <label class="lbl" style="margin:0;">{{ t('storefront.field.products') }}</label>
                <span class="muted small">{{ form().productIds.length }} {{ t('storefront.field.products.selected') }}</span>
              </div>
              <div class="inp-search" style="position:relative;margin-bottom:8px;">
                <input class="inp" [ngModel]="productSearch()" (ngModelChange)="productSearch.set($event)"
                       placeholder="Search by name or SKU…" style="padding-left:10px;"/>
              </div>
              <div class="product-picker">
                @for (p of filteredProducts(); track p.id) {
                  <button class="product-chip"
                    type="button"
                    [class.selected]="isProductSelected(p.id)"
                    (click)="toggleProduct(p.id)">
                    <div class="product-chip-thumb">
                      <img [src]="p.image" [alt]="p.name" (error)="onImgError($event)"/>
                    </div>
                    <div style="flex:1;min-width:0;text-align:start;">
                      <div class="strong" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ p.name }}</div>
                      <div class="muted small mono" style="font-size:10px;">{{ p.sku }}</div>
                    </div>
                    @if (isProductSelected(p.id)) {
                      <span class="product-chip-check"><ap-icon name="check" [size]="10"/></span>
                    }
                  </button>
                }
              </div>
              <div class="muted small mt-8">{{ t('storefront.field.products.help') }}</div>
            </div>
          }

          @case ('New Arrivals') {
            <div class="section-title">
              <ap-icon name="catalog" [size]="14"/>
              <span>{{ t('storefront.section.dynamic') }}</span>
            </div>

            <div class="mb-24">
              <div class="grid-2 mb-16">
                <div>
                  <label class="lbl">{{ t('storefront.field.itemLimit') }}</label>
                  <input class="inp" type="number" min="1" max="100" [ngModel]="form().itemLimit || 12" (ngModelChange)="setNum('itemLimit', $event)"/>
                </div>
                <div>
                  <label class="lbl">{{ t('storefront.field.sortBy') }}</label>
                  <select class="inp" [ngModel]="form().sortBy || 'newest'" (ngModelChange)="set('sortBy', $event)">
                    <option value="newest">{{ t('storefront.sort.newest') }}</option>
                    <option value="bestseller">{{ t('storefront.sort.bestseller') }}</option>
                    <option value="price-asc">{{ t('storefront.sort.priceAsc') }}</option>
                    <option value="price-desc">{{ t('storefront.sort.priceDesc') }}</option>
                  </select>
                </div>
              </div>
              <label class="lbl">{{ t('storefront.field.collection') }}</label>
              <select class="inp" [ngModel]="form().collectionId || 'all'" (ngModelChange)="set('collectionId', $event)">
                <option value="all">{{ t('catalog.allCollections') }}</option>
                @for (c of collections; track c.id) {
                  <option [value]="c.id">{{ c.title }}</option>
                }
              </select>
            </div>
          }

          @case ('Sale Items') {
            <div class="section-title">
              <ap-icon name="catalog" [size]="14"/>
              <span>{{ t('storefront.section.dynamic') }}</span>
            </div>

            <div class="mb-24">
              <div class="grid-2 mb-16">
                <div>
                  <label class="lbl">{{ t('storefront.field.itemLimit') }}</label>
                  <input class="inp" type="number" min="1" max="100" [ngModel]="form().itemLimit || 12" (ngModelChange)="setNum('itemLimit', $event)"/>
                </div>
                <div>
                  <label class="lbl">{{ t('storefront.field.sortBy') }}</label>
                  <select class="inp" [ngModel]="form().sortBy || 'price-desc'" (ngModelChange)="set('sortBy', $event)">
                    <option value="price-desc">{{ t('storefront.sort.priceDesc') }}</option>
                    <option value="price-asc">{{ t('storefront.sort.priceAsc') }}</option>
                    <option value="bestseller">{{ t('storefront.sort.bestseller') }}</option>
                  </select>
                </div>
              </div>
              <label class="lbl">{{ t('storefront.field.collection') }}</label>
              <select class="inp" [ngModel]="form().collectionId || 'all'" (ngModelChange)="set('collectionId', $event)">
                <option value="all">{{ t('catalog.allCollections') }}</option>
                @for (c of collections; track c.id) {
                  <option [value]="c.id">{{ c.title }}</option>
                }
              </select>
            </div>
          }

          @case ('Brand Story') {
            <div class="section-title">
              <ap-icon name="edit" [size]="14"/>
              <span>{{ t('storefront.section.story') }}</span>
            </div>

            <div class="mb-24">
              <label class="lbl">{{ t('storefront.field.body') }}</label>
              <textarea class="inp" rows="6" [ngModel]="form().body || ''" (ngModelChange)="set('body', $event)" [placeholder]="t('storefront.field.body.placeholder')"></textarea>
              <div class="muted small mt-8">{{ t('storefront.field.body.help') }}</div>
            </div>
          }
        }

        <!-- Danger zone -->
        <div class="section-title danger-section">
          <ap-icon name="trash" [size]="14"/>
          <span>{{ t('storefront.section.danger') }}</span>
        </div>

        <div class="danger-zone mb-24">
          <div style="flex:1;min-width:0;">
            <div class="strong" style="font-size:13px;color:var(--danger);margin-bottom:2px;">{{ t('storefront.delete.title') }}</div>
            <div class="muted small">{{ t('storefront.delete.sub') }}</div>
          </div>
          <button class="btn btn-danger" (click)="onDelete()">
            <ap-icon name="trash" [size]="12"/> {{ t('storefront.delete.button') }}
          </button>
        </div>
      </div>
    </div>


  `,
  styles: [`
    .drawer-wide { width: min(640px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

    .section-head { gap: 12px; align-items: flex-start; }

    /* Section dividers (same pattern as ProductDrawer) */
    .section-title {
      display: flex; align-items: center; gap: 8px;
      padding: 16px 0 12px;
      margin-top: 4px;
      border-top: 1px solid var(--border-2);
      color: var(--green);
      font-family: var(--ff-disp);
      font-size: 16px;
      font-weight: 500;
    }
    .section-title:first-of-type { border-top: none; padding-top: 0; }
    .section-title.danger-section { color: var(--danger); }
    .section-title ap-icon { color: var(--gold); flex-shrink: 0; }
    .section-title.danger-section ap-icon { color: var(--danger); }

    /* Product picker grid */
    .product-picker {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 6px;
      max-height: 320px;
      overflow-y: auto;
      padding: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .product-chip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: var(--surface);
      border: 1px solid var(--border-2);
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
      color: inherit;
      transition: all 0.12s;
      position: relative;
    }
    .product-chip:hover { border-color: var(--gold-4); }
    .product-chip.selected {
      border-color: var(--gold);
      background: var(--gold-3);
    }
    .product-chip-thumb {
      width: 36px; height: 36px;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-2);
      flex-shrink: 0;
    }
    .product-chip-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .product-chip-check {
      width: 18px; height: 18px;
      border-radius: 50%;
      background: var(--gold);
      color: var(--green);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Danger zone */
    .danger-zone {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px;
      border: 1px solid rgba(239, 68, 68, 0.18);
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.03);
      flex-wrap: wrap;
    }

    /* Save bar — promote when dirty */
    .save-bar {
      justify-content: space-between !important;
      flex-wrap: wrap;
      gap: 10px !important;
      transition: background 0.2s, border-color 0.2s;
      position: sticky;
      bottom: 0;
    }
    .save-bar.dirty {
      background: linear-gradient(0deg, rgba(197, 165, 114, 0.10), var(--bg)) !important;
      border-top-color: var(--gold-4) !important;
      box-shadow: 0 -4px 14px rgba(2, 70, 56, 0.04);
    }

    .section-drawer.is-dirty .section-head {
      box-shadow: inset 4px 0 0 var(--gold);
    }
    html[dir='rtl'] .section-drawer.is-dirty .section-head {
      box-shadow: inset -4px 0 0 var(--gold);
    }

    @media (max-width: 720px) {
      .product-picker { max-height: 260px; grid-template-columns: 1fr; }
      .section-title { font-size: 15px; padding: 14px 0 10px; }
    }
  `],
})
export class SectionDrawerComponent implements OnInit, OnDestroy {
  /** The block being edited. Setter swaps state cleanly. */
  @Input({ required: true }) set block(b: StorefrontBlock) {
    if (this._currentBlockId === b.id && this.initial()) return;
    this._currentBlockId = b.id;
    this.initial.set(this.normalize(b));
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
  }

  @Output() closed = new EventEmitter<void>();
  /** Emitted with the saved form so the parent can update its block list. */
  @Output() saved = new EventEmitter<StorefrontBlock>();
  /** Emitted when the user confirms deletion. */
  @Output() deletedBlock = new EventEmitter<StorefrontBlock>();

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly allProducts = PRODUCTS;
  readonly collections = COLLECTIONS.filter(c => !c.hidden);

  readonly productSearch = signal('');
  readonly filteredProducts = computed(() => {
    const q = this.productSearch().toLowerCase().trim();
    if (!q) return this.allProducts;
    return this.allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  });

  private _currentBlockId = '';
  private readonly initial = signal<FormShape>(this.makeEmptyForm());

  readonly form = signal<FormShape>(this.makeEmptyForm());
  readonly saveState = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial()));

  private feedbackTimer: number | undefined;

  ngOnInit(): void {
    // Block setter already initialised state via @Input.
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  private makeEmptyForm(): FormShape {
    return {
      id: '', type: '', title: '', visible: true, config: '',
      productIds: [],
    };
  }

  private normalize(b: StorefrontBlock): FormShape {
    return {
      ...b,
      productIds: b.productIds ? [...b.productIds] : [],
    };
  }

  saveLabel(): string {
    return {
      idle:   this.t('product.save.idle'),
      dirty:  this.t('product.save.dirty'),
      saving: this.t('product.save.saving'),
      saved:  this.t('product.save.saved'),
      error:  this.t('product.save.error'),
    }[this.saveState()];
  }

  // ── Mutations ────────────────────────────────────────────────────────

  set<K extends keyof FormShape>(k: K, v: FormShape[K]): void {
    this.form.update((f) => ({ ...f, [k]: v }));
    if (this.dirty() && this.saveState() === 'idle') this.saveState.set('dirty');
    if (!this.dirty() && this.saveState() === 'dirty') this.saveState.set('idle');
  }

  setNum(k: 'itemLimit', v: string | number): void {
    const n = typeof v === 'number' ? v : parseInt(v, 10) || 0;
    this.set(k, n);
  }

  toggle(k: 'visible'): void {
    this.set(k, !this.form()[k] as never);
  }

  isProductSelected(id: string): boolean {
    return this.form().productIds.includes(id);
  }

  toggleProduct(id: string): void {
    const ids = this.form().productIds;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    this.set('productIds', next);
  }

  // ── Save / Discard / Delete / Close ──────────────────────────────────

  save(closeAfter: boolean = false): void {
    if (!this.dirty() || this.saveState() === 'saving') return;
    this.saveState.set('saving');
    setTimeout(() => {
      const snapshot = { ...this.form() };
      this.initial.set({ ...snapshot });
      this.saveState.set('saved');
      this.toast.success(this.t('storefront.toast.saved.title'), snapshot.title || snapshot.type);
      this.saved.emit(snapshot);
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => this.saveState.set('idle'), 1600);
      if (closeAfter) {
        setTimeout(() => this.closed.emit(), 200);
      }
    }, 700);
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
    this.toast.info(this.t('product.toast.discarded.title'), this.t('product.toast.discarded.sub'));
  }

  async onDelete(): Promise<void> {
    const f = this.form();
    const ok = await this.confirm.ask({
      title: this.t('storefront.deleteConfirm.title'),
      message: this.t('storefront.deleteConfirm.message') + ` "${f.type} · ${f.title}".`,
      confirmLabel: this.t('storefront.delete.button'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.deletedBlock.emit({ ...f });
  }

  triggerShake(): void {
    this.shakeSaveBar.set(false);
    setTimeout(() => this.shakeSaveBar.set(true), 10);
  }

  handleClose(): void {
    if (this.dirty()) { 
      this.triggerShake(); 
      return; 
    }
    this.closed.emit();
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
