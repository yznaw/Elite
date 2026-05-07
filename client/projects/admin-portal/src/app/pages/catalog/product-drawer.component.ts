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
import { MEDIA_INIT } from '../../data/mock';
import { ME, Product } from '../../models';

interface FormShape {
  name: string; sku: string; brand: string; category: string;
  price: number; stock: number; hidden: boolean;
  enDesc: string; arDesc: string;
  metaTitle: string; metaDesc: string; slug: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const DRAFT_KEY_PREFIX = 'elite-admin:draft:';

@Component({
  selector: 'ap-product-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide product-drawer" [class.is-dirty]="dirty()">
      <!-- Header: title + status + save state — nav buttons live alongside close -->
      <div class="drawer-head product-head">
        <div style="min-width:0;flex:1;">
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">{{ form().name }}</div>
            <ap-pill [kind]="form().hidden ? 'red' : 'green'">
              {{ form().hidden ? t('product.status.hidden') : t('product.status.visible') }}
            </ap-pill>
            <span class="save-badge" [class]="'save-badge ' + saveState()">
              @if (saveState() === 'saving') { <ap-spinner [size]="10"/> }
              @if (saveState() === 'saved')  { <ap-icon name="check" [size]="10"/> }
              {{ saveLabel() }}
            </span>
          </div>
          <div class="card-sub">
            <span class="mono">{{ form().sku }}</span>
            <span> · {{ form().brand }}</span>
            @if (productList().length > 1) {
              <span class="muted"> · {{ currentIndex() + 1 }} {{ t('product.of') }} {{ productList().length }}</span>
            }
            @if (lastSavedAt()) {
              <span class="muted"> · {{ t('product.savedAt') }} {{ lastSavedAt() }}</span>
            }
          </div>
        </div>

        <!-- Right-side actions: prev / next / close -->
        <div class="head-actions">
          <button
            class="head-icon-btn"
            (click)="navigate(-1)"
            [disabled]="!canPrev()"
            [attr.aria-label]="t('product.prev')"
            [attr.title]="t('product.prev')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button
            class="head-icon-btn"
            (click)="navigate(1)"
            [disabled]="!canNext()"
            [attr.aria-label]="t('product.next')"
            [attr.title]="t('product.next')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <span class="head-divider" aria-hidden="true"></span>
          <button class="head-icon-btn" (click)="handleClose()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
        </div>
      </div>

      <!-- Body: scrollable form -->
      <div class="drawer-body">
        @if (draftRestoredAt()) {
          <div class="draft-banner">
            <span>
              <span class="strong">{{ t('product.draftRestored') }}</span> · {{ t('product.draftRestored.sub') }} {{ draftRestoredLabel() }}
            </span>
            <button class="btn btn-ghost btn-sm" (click)="discardDraft()">{{ t('product.discardDraft') }}</button>
          </div>
        }

        <!-- Visibility -->
        <div class="vis-block mb-24" [class.hidden-state]="form().hidden">
          <div>
            <div class="strong" style="font-size:13px;margin-bottom:2px;" [style.color]="form().hidden ? 'var(--danger)' : 'var(--ink)'">
              {{ form().hidden ? t('product.visibility.hiddenTitle') : t('product.visibility.visibleTitle') }}
            </div>
            <div class="muted small">
              {{ form().hidden ? t('product.visibility.hiddenSub') : t('product.visibility.visibleSub') }}
            </div>
          </div>
          <button class="toggle" [class.on]="!form().hidden" (click)="toggle('hidden')" [attr.aria-label]="form().hidden ? t('product.show') : t('product.hide')"></button>
        </div>

        <!-- Image preview + key facts -->
        <div class="mb-24" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="prod-img" style="border-radius:10px;">
            <img [src]="product.image" [alt]="form().name" (error)="onImgError($event)"/>
          </div>
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">{{ t('product.fact.3dStatus') }}</span>
              <ap-pill [kind]="product.has3d ? 'green' : 'grey'">{{ product.has3d ? t('product.fact.3dLinked') : t('product.fact.3dMissing') }}</ap-pill>
            </div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">{{ t('product.fact.linkedMedia') }}</span>
              <span class="strong">{{ linkedMediaCount }} {{ linkedMediaCount === 1 ? t('product.fact.file') : t('product.fact.files') }}</span>
            </div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">{{ t('product.fact.views30d') }}</span>
              <span class="strong mono">{{ product.views3d.toLocaleString() }}</span>
            </div>
            <div class="row" style="justify-content:space-between;">
              <span class="muted small">{{ t('product.fact.id') }}</span>
              <span class="strong mono" style="font-size:11px;">{{ product.id }}</span>
            </div>
          </div>
        </div>

        <!-- Section: Basics -->
        <div class="section-title">
          <ap-icon name="catalog" [size]="14"/>
          <span>{{ t('product.section.basics') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.name') }}</label>
          <input class="inp mb-16" [ngModel]="form().name" (ngModelChange)="set('name', $event)"/>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">{{ t('product.field.sku') }}</label>
              <input class="inp mono" [ngModel]="form().sku" (ngModelChange)="set('sku', $event)"/>
            </div>
            <div>
              <label class="lbl">{{ t('product.field.brand') }}</label>
              <input class="inp" [ngModel]="form().brand" (ngModelChange)="set('brand', $event)"/>
            </div>
          </div>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">{{ t('product.field.category') }}</label>
              <select class="inp" [ngModel]="form().category" (ngModelChange)="set('category', $event)">
                @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </div>
            <div>
              <label class="lbl">{{ t('product.field.stock') }}</label>
              <input class="inp" type="number" min="0" [ngModel]="form().stock" (ngModelChange)="setNum('stock', $event)"/>
              @if (form().stock === 0) {
                <div class="muted small mt-8" style="color:var(--danger);">{{ t('product.field.stock.out') }}</div>
              } @else if (form().stock < 8) {
                <div class="muted small mt-8" style="color:var(--warning);">{{ t('product.field.stock.low') }}</div>
              }
            </div>
          </div>

          <div>
            <label class="lbl">{{ t('product.field.price') }}</label>
            <input class="inp mono" type="number" min="0" [ngModel]="form().price" (ngModelChange)="setNum('price', $event)"/>
          </div>
        </div>

        <!-- Section: Media -->
        <div class="section-title">
          <ap-icon name="cube" [size]="14"/>
          <span>{{ t('product.section.media') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.glb') }}</label>
          <div style="padding:18px;border:1px dashed var(--border);border-radius:10px;background:var(--bg);text-align:center;">
            @if (product.has3d) {
              <div class="strong mono">elite-{{ product.id.toLowerCase() }}.glb</div>
              <div class="muted small mt-8">{{ t('product.field.glb.linked') }}</div>
              <div class="row gap-sm mt-16" style="justify-content:center;flex-wrap:wrap;">
                <button class="btn btn-outline btn-sm"><ap-icon name="upload" [size]="12"/> {{ t('product.field.glb.replace') }}</button>
                <button class="btn btn-danger btn-sm"><ap-icon name="trash" [size]="12"/> {{ t('product.field.glb.unlink') }}</button>
              </div>
            } @else {
              <div class="muted"><ap-icon name="cube" [size]="14"/></div>
              <div class="strong mt-8">{{ t('product.field.glb.empty') }}</div>
              <div class="muted small mt-8">{{ t('product.field.glb.emptySub') }}</div>
              <div class="row gap-sm mt-16" style="justify-content:center;flex-wrap:wrap;">
                <button class="btn btn-gold btn-sm"><ap-icon name="upload" [size]="12"/> {{ t('product.field.glb.upload') }}</button>
                <button class="btn btn-outline btn-sm">{{ t('product.field.glb.linkUrl') }}</button>
              </div>
            }
          </div>
        </div>

        <!-- Section: Description -->
        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('product.section.description') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.descEn') }}</label>
          <textarea class="inp" rows="3" [ngModel]="form().enDesc" (ngModelChange)="set('enDesc', $event)"></textarea>
        </div>
        <div class="mb-24">
          <label class="lbl">{{ t('product.field.descAr') }}</label>
          <textarea class="inp" rows="3" dir="rtl" [ngModel]="form().arDesc" (ngModelChange)="set('arDesc', $event)"></textarea>
        </div>

        <!-- Section: SEO -->
        <div class="section-title">
          <ap-icon name="search" [size]="14"/>
          <span>{{ t('product.section.seo') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.metaTitle') }}</label>
          <input class="inp mb-8" [ngModel]="form().metaTitle" (ngModelChange)="set('metaTitle', $event)"/>
          <label class="lbl">{{ t('product.field.metaDesc') }}</label>
          <input class="inp mb-8" [ngModel]="form().metaDesc" (ngModelChange)="set('metaDesc', $event)"/>
          <label class="lbl">{{ t('product.field.slug') }}</label>
          <input class="inp mono" [ngModel]="form().slug" (ngModelChange)="set('slug', $event)"/>
        </div>

        <!-- Section: Sync -->
        <div class="section-title">
          <ap-icon name="sync" [size]="14"/>
          <span>{{ t('product.section.sync') }}</span>
        </div>

        <div class="mb-24">
          <div class="ms-block">
            <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
              <div>
                <div class="strong" style="font-size:13px;color:var(--green);margin-bottom:2px;">{{ t('product.sync.title') }}</div>
                <div class="muted small">{{ t('product.sync.sub') }} <span class="mono">{{ product.sku }}</span></div>
              </div>
              <ap-pill kind="green">{{ t('product.sync.inSync') }}</ap-pill>
            </div>
            <div class="ms-row">
              <span class="muted small">{{ t('product.sync.lastAuto') }}</span>
              <span class="row gap-sm">
                <span class="mono" style="font-size:11px;color:var(--ink-2);">2026-04-29 06:00</span>
              </span>
            </div>
            <div class="ms-row">
              <span class="muted small">{{ t('product.sync.lastManual') }}</span>
              <span class="row gap-sm">
                <span class="mono" style="font-size:11px;color:var(--ink-2);">{{ lastManual().when }}</span>
                <span class="trigger" style="padding:2px 10px 2px 3px;font-size:10px;">
                  <span class="avatar" style="width:18px;height:18px;font-size:8px;">{{ lastManual().initials }}</span>
                  {{ firstName(lastManual().by) }}
                </span>
              </span>
            </div>
            <div class="ms-row">
              <span class="muted small">{{ t('product.sync.posStock') }}</span>
              <span class="strong">{{ product.stock }} · {{ product.has3d ? t('product.fact.3dLinked') : t('product.fact.3dMissing') }}</span>
            </div>
            <div class="row gap-sm" style="margin-top:14px;flex-wrap:wrap;">
              <button class="btn btn-gold" style="flex:1;min-width:200px;" [disabled]="syncing()" (click)="runProductSync()">
                @if (syncing()) {
                  <ap-spinner/> {{ t('product.sync.syncing') }}
                } @else {
                  <ap-icon name="sync" [size]="14"/> {{ t('product.sync.syncNow') }}
                }
              </button>
              <button class="btn btn-outline" [disabled]="syncing()">{{ t('product.sync.history') }}</button>
            </div>
          </div>
        </div>

        <!-- Section: Danger zone -->
        <div class="section-title danger-section">
          <ap-icon name="trash" [size]="14"/>
          <span>{{ t('product.section.danger') }}</span>
        </div>

        <div class="danger-zone mb-24">
          <div style="flex:1;min-width:0;">
            <div class="strong" style="font-size:13px;color:var(--danger);margin-bottom:2px;">{{ t('product.delete.title') }}</div>
            <div class="muted small">{{ t('product.delete.sub') }}</div>
          </div>
          <button class="btn btn-danger" [disabled]="deleting()" (click)="onDelete()">
            @if (deleting()) {
              <ap-spinner/> {{ t('common.working') }}
            } @else {
              <ap-icon name="trash" [size]="12"/> {{ t('product.delete.button') }}
            }
          </button>
        </div>
      </div>

      <!-- Sticky save bar — prominent when dirty -->
      <div class="drawer-foot save-bar" [class.dirty]="dirty()">
        <div class="row gap-sm" style="min-width:0;flex:1;">
          <span class="save-badge" [class]="'save-badge ' + saveState()">
            @if (saveState() === 'saving') { <ap-spinner [size]="10"/> }
            @if (saveState() === 'saved')  { <ap-icon name="check" [size]="10"/> }
            {{ saveLabel() }}
          </span>
          @if (dirty()) {
            <span class="muted small save-bar-hint">
              <ap-icon name="check" [size]="10"/> {{ t('product.draftAutoSaved') }}
            </span>
          }
        </div>
        <div class="row gap-sm" style="flex-shrink:0;">
          <button class="btn btn-ghost" (click)="discard()" [disabled]="!dirty() || saveState() === 'saving'">
            {{ t('common.discard') }}
          </button>
          <button class="btn btn-primary" (click)="save()" [disabled]="!dirty() || saveState() === 'saving'">
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
    </div>

    <!-- Unsaved-changes confirm modal (legacy — now handled by ConfirmService) -->
    @if (confirmCloseOpen()) {
      <div class="overlay" (click)="confirmCloseOpen.set(false)" style="z-index:220;"></div>
      <div class="modal" style="z-index:230;width:min(440px,92vw);">
        <div class="modal-head">
          <div>
            <div class="card-title">{{ t('product.unsaved.title') }}</div>
            <div class="card-sub">{{ t('product.unsaved.draftKept') }}</div>
          </div>
          <button class="x-btn" (click)="confirmCloseOpen.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="modal-body">
          <p style="line-height:1.6;margin-bottom:16px;">
            {{ t('product.unsaved.body1') }} <span class="strong">{{ form().name }}</span>. {{ t('product.unsaved.body2') }}
          </p>
          <div class="muted small">{{ t('product.unsaved.body3') }}</div>
        </div>
        <div class="drawer-foot">
          <button class="btn btn-danger" (click)="closeAndDiscardDraft()">{{ t('product.unsaved.discardClose') }}</button>
          <button class="btn btn-outline" (click)="closeAndKeepDraft()">{{ t('product.unsaved.keepClose') }}</button>
          <button class="btn btn-primary" (click)="confirmCloseOpen.set(false); save()">{{ t('product.unsaved.saveClose') }}</button>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Wider drawer for the editor — full screen on phones */
    .drawer-wide { width: min(720px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

    .product-head {
      gap: 12px;
      align-items: flex-start;
    }

    /* Right-side header actions: prev / next / close
       Uniform 32×32 icon buttons, no joined container — just three buttons
       on a row, with a 1px divider between nav and close. */
    .head-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .head-icon-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--ink-2);
      cursor: pointer;
      padding: 0;
      transition: all 0.12s;
    }
    .head-icon-btn:hover:not(:disabled) {
      background: var(--bg);
      border-color: var(--border);
      color: var(--green);
    }
    .head-icon-btn:disabled { color: var(--muted-2); cursor: not-allowed; }
    .head-icon-btn svg { width: 14px; height: 14px; }
    .head-divider {
      width: 1px; height: 18px;
      background: var(--border);
      margin: 0 4px;
    }
    /* In RTL, flip the chevrons so "previous" still points to the inline-start direction */
    html[dir='rtl'] .head-icon-btn svg { transform: scaleX(-1); }
    /* But the close icon (X) is symmetric — un-flip it */
    html[dir='rtl'] .head-icon-btn ap-icon[name='x'] svg { transform: none; }

    /* Section dividers with icon */
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

    /* Save bar — promote visually when dirty */
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
    .save-bar-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }

    /* Pulsing dirty marker on the drawer when there are unsaved changes */
    .product-drawer.is-dirty .product-head {
      box-shadow: inset 4px 0 0 var(--gold);
    }
    html[dir='rtl'] .product-drawer.is-dirty .product-head {
      box-shadow: inset -4px 0 0 var(--gold);
    }

    @media (max-width: 720px) {
      .nav-pos { padding: 0 4px; min-width: 28px; font-size: 10px; }
      .section-title { font-size: 15px; padding: 14px 0 10px; }
      .save-bar-hint .kbd { display: none; }
    }
  `],
})
export class ProductDrawerComponent implements OnInit, OnDestroy {
  /** Internal signals — reactive so `currentIndex` / `canPrev` / `canNext`
      re-run when the inputs change. Plain @Input properties don't trigger
      computed re-evaluation. */
  private readonly _products = signal<Product[]>([]);
  private readonly _currentId = signal<string>('');

  /** The full navigable list (e.g. the current filtered catalog). */
  @Input({ required: true }) set products(list: Product[]) {
    this._products.set(list || []);
  }
  /** ID of the currently shown product. Setter swaps everything. */
  @Input({ required: true }) set currentId(id: string) {
    if (this._currentId() === id) return;
    this._currentId.set(id);
    this.resetForCurrent();
  }

  /** Reactive view onto the inputs (template-friendly — same data as the
      `products` input setter, but readable as a signal).  Don't reuse the
      `products` name because TypeScript won't allow both a setter and a
      same-name field. */
  readonly productList = this._products.asReadonly();

  @Output() closed = new EventEmitter<void>();
  /** Emitted when the user navigates with arrows — parent updates its active product. */
  @Output() currentIdChange = new EventEmitter<string>();
  /** Emitted when the user confirms deletion of the current product. */
  @Output() deleted = new EventEmitter<Product>();

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly categories = ['Oxford', 'Derby', 'Loafer', 'Boot', 'Sneaker', 'Mule'];

  /** Initial form snapshot — re-set whenever `currentId` changes. */
  private initial!: FormShape;
  readonly form = signal<FormShape>(this.makeEmptyForm());
  readonly draftRestoredAt = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<string | null>(null);
  readonly confirmCloseOpen = signal(false);
  readonly syncing = signal(false);
  readonly deleting = signal(false);
  readonly lastManual = signal({ when: '2026-04-29 09:42', by: 'Mona Al-Sayed', initials: 'MS' });

  readonly currentIndex = computed(() => this._products().findIndex((p) => p.id === this._currentId()));
  readonly canPrev = computed(() => this.currentIndex() > 0);
  readonly canNext = computed(() => {
    const idx = this.currentIndex();
    return idx >= 0 && idx < this._products().length - 1;
  });

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial));

  /** Convenience: the current product object (or first as fallback). */
  get product(): Product {
    const list = this._products();
    return list.find((p) => p.id === this._currentId()) ?? list[0];
  }

  private feedbackTimer: number | undefined;
  private autoSaveTimer: number | undefined;
  private syncTimer: number | undefined;

  get linkedMediaCount(): number {
    return MEDIA_INIT.filter((m) => m.linkedTo === this.product?.id).length;
  }

  get draftKey(): string { return DRAFT_KEY_PREFIX + this._currentId(); }

  ngOnInit(): void {
    // currentId setter already ran via @Input — but if not yet, hydrate now.
    if (!this.initial) this.resetForCurrent();
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  // ────────────────────────────────────────────────────────────────────
  // Hydration on product change
  // ────────────────────────────────────────────────────────────────────

  private resetForCurrent(): void {
    const p = this.product;
    if (!p) return;

    this.initial = this.makeFormFromProduct(p);
    this.form.set({ ...this.initial });
    this.saveState.set('idle');
    this.lastSavedAt.set(null);
    this.draftRestoredAt.set(null);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);

    // Try to restore a draft for this product
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.savedAt) {
          this.form.set(parsed.form);
          this.draftRestoredAt.set(parsed.savedAt);
          this.saveState.set('dirty');
        }
      }
    } catch {}
  }

  private makeEmptyForm(): FormShape {
    return {
      name: '', sku: '', brand: '', category: '',
      price: 0, stock: 0, hidden: false,
      enDesc: '', arDesc: '',
      metaTitle: '', metaDesc: '', slug: '',
    };
  }

  private makeFormFromProduct(p: Product): FormShape {
    return {
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      category: p.category,
      price: p.price,
      stock: p.stock,
      hidden: p.hidden,
      enDesc: 'Hand-stitched in our Doha atelier from full-grain camel leather. Each pair takes 48 hours of single-artisan attention. Limited to 40 pairs per season.',
      arDesc: 'مصنوع يدويًا في ورشتنا في الدوحة من جلد الجمل الكامل الحبيبات. كل زوج يستغرق 48 ساعة من الاهتمام الحرفي الواحد. محدود بـ 40 زوجًا في الموسم.',
      metaTitle: `${p.name} · ${p.brand} · Elite Collection`,
      metaDesc: `Buy the ${p.name} from our Doha atelier. Hand-crafted leather. Free shipping in Qatar.`,
      slug: p.name.toLowerCase().replace(/\s+/g, '-'),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Form mutations + auto-save
  // ────────────────────────────────────────────────────────────────────

  saveLabel(): string {
    return {
      idle:   this.t('product.save.idle'),
      dirty:  this.t('product.save.dirty'),
      saving: this.t('product.save.saving'),
      saved:  this.t('product.save.saved'),
      error:  this.t('product.save.error'),
    }[this.saveState()];
  }

  draftRestoredLabel(): string {
    const v = this.draftRestoredAt();
    return v ? new Date(v).toLocaleString() : '';
  }

  set<K extends keyof FormShape>(k: K, v: FormShape[K]): void {
    this.form.update((f) => ({ ...f, [k]: v }));
    this.scheduleAutoSave();
  }

  setNum(k: 'price' | 'stock', v: string | number): void {
    const n = typeof v === 'number' ? v : parseInt(v, 10) || 0;
    this.set(k, n);
  }

  toggle(k: 'hidden'): void {
    this.set(k, !this.form()[k] as never);
  }

  private scheduleAutoSave(): void {
    if (!this.dirty()) {
      try { localStorage.removeItem(this.draftKey); } catch {}
      if (this.saveState() === 'dirty') this.saveState.set('idle');
      return;
    }
    if (this.saveState() === 'idle') this.saveState.set('dirty');
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.draftKey, JSON.stringify({ form: this.form(), savedAt: new Date().toISOString() }));
      } catch {}
    }, 400);
  }

  // ────────────────────────────────────────────────────────────────────
  // Save / Discard / Delete
  // ────────────────────────────────────────────────────────────────────

  save(): void {
    if (!this.dirty() || this.saveState() === 'saving') return;
    this.saveState.set('saving');
    setTimeout(() => {
      this.saveState.set('saved');
      const ts = new Date().toTimeString().slice(0, 5);
      this.lastSavedAt.set(ts);
      try { localStorage.removeItem(this.draftKey); } catch {}
      this.draftRestoredAt.set(null);
      this.initial = { ...this.form() };
      this.toast.success(this.t('product.toast.saved.title'), `${this.form().name}`);
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => this.saveState.set('idle'), 1800);
    }, 1000);
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
    const ok = await this.confirm.ask({
      title: this.t('product.discardConfirm.title'),
      message: this.t('product.discardConfirm.message'),
      confirmLabel: this.t('product.discardConfirm.confirm'),
      cancelLabel: this.t('product.discardConfirm.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.form.set({ ...this.initial });
    try { localStorage.removeItem(this.draftKey); } catch {}
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
    this.toast.info(this.t('product.toast.discarded.title'), this.t('product.toast.discarded.sub'));
  }

  discardDraft(): void {
    this.form.set({ ...this.initial });
    try { localStorage.removeItem(this.draftKey); } catch {}
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
  }

  async onDelete(): Promise<void> {
    if (this.deleting()) return;
    const ok = await this.confirm.ask({
      title: this.t('product.deleteConfirm.title'),
      message: this.t('product.deleteConfirm.message') + ` "${this.product.name}" (${this.product.sku}).`,
      confirmLabel: this.t('product.deleteConfirm.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.deleting.set(true);
    setTimeout(() => {
      this.deleting.set(false);
      this.deleted.emit(this.product);
    }, 600);
  }

  // ────────────────────────────────────────────────────────────────────
  // Navigation (prev / next) with dirty-aware guard
  // ────────────────────────────────────────────────────────────────────

  async navigate(dir: -1 | 1): Promise<void> {
    const list = this._products();
    const idx = this.currentIndex();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;

    if (this.dirty()) {
      const ok = await this.confirm.ask({
        title: this.t('product.navAway.title'),
        message: this.t('product.navAway.message'),
        confirmLabel: this.t('product.navAway.confirm'),
        cancelLabel: this.t('product.navAway.cancel'),
        variant: 'warning',
      });
      if (!ok) return;
    }
    this.currentIdChange.emit(list[newIdx].id);
  }

  // ────────────────────────────────────────────────────────────────────
  // Close (with dirty check)
  // ────────────────────────────────────────────────────────────────────

  handleClose(): void {
    if (this.dirty()) { this.confirmCloseOpen.set(true); return; }
    this.closed.emit();
  }

  closeAndKeepDraft(): void {
    this.confirmCloseOpen.set(false);
    this.closed.emit();
  }

  closeAndDiscardDraft(): void {
    try { localStorage.removeItem(this.draftKey); } catch {}
    this.confirmCloseOpen.set(false);
    this.closed.emit();
  }

  // ────────────────────────────────────────────────────────────────────
  // Manual sync action
  // ────────────────────────────────────────────────────────────────────

  runProductSync(): void {
    this.syncing.set(true);
    this.toast.info(this.t('product.toast.syncStart.title'), `${this.product.name} · ${ME.name}`);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      const stamp = '2026-04-29 ' + new Date().toTimeString().slice(0, 5);
      this.lastManual.set({ when: stamp, by: ME.name, initials: ME.initials });
      this.syncing.set(false);
      this.toast.success(this.t('product.toast.syncDone.title'), `${this.product.sku}`);
    }, 1800);
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
