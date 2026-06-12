import {
  Component, EventEmitter, Input, OnDestroy, OnInit, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { Collection, Product } from '../../models';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { AdminProductsService } from '../../services/admin-products.service';

interface FormShape {
  title: string;
  handle: string;
  description: string;
  imageUrl: string | null;
  productIds: string[];
  hidden: boolean;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const DRAFT_KEY_PREFIX = 'elite-admin:col-draft:';

@Component({
  selector: 'ap-collection-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, SaveBarComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide product-drawer" [class.is-dirty]="dirty()">
      <div class="drawer-head product-head">
        <div style="min-width:0;flex:1;">
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">{{ form().title || t('collections.new') }}</div>
            <ap-pill [kind]="form().hidden ? 'red' : 'green'">
              {{ form().hidden ? t('collections.hidden') : t('collections.visible') }}
            </ap-pill>
            <span class="save-badge" [class]="'save-badge ' + saveState()">
              @if (saveState() === 'saving') { <ap-spinner [size]="10"/> }
              @if (saveState() === 'saved')  { <ap-icon name="check" [size]="10"/> }
              {{ saveLabel() }}
            </span>
          </div>
          <div class="card-sub">
            <span class="mono">{{ collection.id }}</span>
            @if (collectionList().length > 1) {
              <span class="muted"> · {{ currentIndex() + 1 }} {{ t('product.of') }} {{ collectionList().length }}</span>
            }
          </div>
        </div>

        <div class="head-actions">
          <button class="head-icon-btn" (click)="navigate(-1)" [disabled]="!canPrev()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button class="head-icon-btn" (click)="navigate(1)" [disabled]="!canNext()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <span class="head-divider" aria-hidden="true"></span>
          <button class="head-icon-btn" (click)="handleClose()"><ap-icon name="x" [size]="14"/></button>
        </div>
      </div>
      
      <ap-save-bar
        [dirty]="dirty()"
        [saving]="saveState() === 'saving'"
        [justSaved]="saveState() === 'saved'"
        [shake]="shakeSaveBar()"
        [label]="t('product.unsaved.title')"
        (saved)="save()"
        (discarded)="discard()"/>

      <div class="drawer-body">
        <div class="vis-block mb-24" [class.hidden-state]="form().hidden">
          <div>
            <div class="strong" style="font-size:13px;margin-bottom:2px;" [style.color]="form().hidden ? 'var(--danger)' : 'var(--ink)'">
              {{ isSystemCollection() ? 'Always visible' : (form().hidden ? t('collections.hidden') : t('collections.visible')) }}
            </div>
            <div class="muted small">{{ isSystemCollection() ? 'Managed by the storefront and kept active.' : t('collections.visibility') }}</div>
          </div>
          <button class="toggle" [class.on]="!form().hidden" (click)="toggle('hidden')" [disabled]="isSystemCollection()"></button>
        </div>

        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('collections.drawer.title') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('collections.drawer.name') }}</label>
          <input class="inp mb-16" [ngModel]="form().title" (ngModelChange)="set('title', $event)"/>

          <label class="lbl">URL Handle <span class="muted" style="font-weight:500;">(collection path)</span></label>
          <div class="handle-row mb-16">
            <span class="handle-prefix">/collection/</span>
            <input class="inp handle-inp"
                   [ngModel]="form().handle"
                   (ngModelChange)="setHandle($event)"
                   [disabled]="isSystemCollection()"
                   placeholder="auto-generated-from-title"/>
            @if (handleManual() && !isSystemCollection()) {
              <button class="btn btn-ghost btn-sm" type="button" (click)="resetHandleToTitle()" title="Reset to auto-generated">
                <ap-icon name="sync" [size]="12"/>
              </button>
            }
          </div>
          <div class="handle-preview mb-16">
            <span class="muted small">Preview: </span>
            <span class="handle-link mono small">/collection/{{ form().handle || 'your-collection-name' }}</span>
          </div>

          <label class="lbl">{{ t('collections.drawer.desc') }}</label>
          <textarea class="inp mb-16" rows="3" [placeholder]="t('collections.drawer.descHolder')" [ngModel]="form().description" (ngModelChange)="set('description', $event)"></textarea>

          <label class="lbl">{{ t('collections.cover.title') }}</label>
          <div class="cover-drop"
               [class.has-image]="!!form().imageUrl"
               (dragover)="onCoverDragOver($event)"
               (drop)="onCoverDrop($event)">
            @if (form().imageUrl) {
              <img class="cover-preview" [src]="form().imageUrl" [alt]="form().title"/>
            } @else {
              <div class="cover-empty">
                <div class="muted"><ap-icon name="media" [size]="24"/></div>
                <div class="strong mt-8">{{ t('collections.cover.empty.title') }}</div>
                <div class="muted small mt-8">{{ t('collections.cover.empty.sub') }}</div>
              </div>
            }
          </div>
          <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
            <label class="btn btn-gold btn-sm" style="cursor:pointer;">
              <ap-icon name="upload" [size]="12"/> {{ form().imageUrl ? t('collections.cover.replace') : t('collections.cover.upload') }}
              <input type="file" accept="image/*" hidden (change)="onCoverPick($event)"/>
            </label>
            <button class="btn btn-outline btn-sm" type="button" (click)="addCoverUrl()">
              <ap-icon name="link" [size]="12"/> {{ t('collections.cover.addUrl') }}
            </button>
            @if (form().imageUrl) {
              <button class="btn btn-danger btn-sm" type="button" (click)="set('imageUrl', null)">
                <ap-icon name="trash" [size]="12"/> {{ t('common.remove') }}
              </button>
            }
          </div>
        </div>

        <div class="section-title">
          <ap-icon name="catalog" [size]="14"/>
          <span>{{ t('collections.drawer.manageProducts') }}</span>
        </div>

        <div class="mb-24">
          @if (isSystemCollection()) {
            <div style="padding:24px;border:1px solid var(--border);border-radius:10px;background:var(--bg);">
              <div class="strong" style="margin-bottom:4px;">All Products is system-managed</div>
              <div class="muted small">It always reflects the full active catalog, so the product list is read-only here.</div>
            </div>
          } @else {
            <div class="row gap-sm mb-16" style="justify-content:space-between;align-items:center;">
              <div class="strong">{{ form().productIds.length }} {{ t('collections.products') }}</div>
              <button class="btn btn-outline btn-sm" (click)="pickingProducts.set(true)">{{ t('collections.drawer.linkProducts') }}</button>
            </div>
            
            @if (form().productIds.length === 0) {
              <div style="padding:24px;border:1px solid var(--border);border-radius:10px;text-align:center;background:var(--bg);">
                <div class="muted mb-8"><ap-icon name="catalog" [size]="24"/></div>
                <div class="strong">{{ t('collections.drawer.noProducts') }}</div>
                <div class="muted small">{{ t('collections.drawer.noProducts.sub') }}</div>
              </div>
            } @else {
              <div class="muted small mb-8">{{ t('collections.products.dragHint') }}</div>
              <div class="grid-cards collection-products-grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));">
                @for (p of linkedProducts(); track p.id; let i = $index) {
                  <div class="prod-card collection-prod"
                       draggable="true"
                       (dragstart)="onProductDragStart(i, $event)"
                       (dragover)="onProductDragOver($event)"
                       (drop)="onProductDrop(i, $event)">
                    <div class="prod-img">
                      <img [src]="p.image" [alt]="p.name"/>
                      <span class="prod-3d-badge" style="top:8px;inset-inline-start:8px;background:rgba(2,70,56,0.85);">{{ i + 1 }}</span>
                      <button class="head-icon-btn" style="position:absolute;top:8px;inset-inline-end:8px;background:rgba(255,255,255,0.9);" (click)="removeProduct(p.id)"><ap-icon name="x" [size]="12"/></button>
                    </div>
                    <div class="prod-body">
                      <div class="prod-name">{{ p.name }}</div>
                      <div class="prod-sku">{{ p.sku }}</div>
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>

        <div class="section-title danger-section">
          <ap-icon name="trash" [size]="14"/>
          <span>{{ t('product.section.danger') }}</span>
        </div>

        @if (!isSystemCollection()) {
          <div class="danger-zone mb-24">
            <div style="flex:1;min-width:0;">
              <div class="strong" style="font-size:13px;color:var(--danger);margin-bottom:2px;">{{ t('collections.section.danger.title') }}</div>
            </div>
            <button class="btn btn-danger" [disabled]="deleting()" (click)="onDelete()">
              @if (deleting()) {
                <ap-spinner/> {{ t('common.working') }}
              } @else {
                <ap-icon name="trash" [size]="12"/> {{ t('product.delete.button') }}
              }
            </button>
          </div>
        }
      </div>
    </div>

    <!-- Product Picker Modal -->
    @if (pickingProducts()) {
      <div class="overlay" style="z-index:220;" (click)="pickingProducts.set(false)"></div>
      <div class="modal" style="z-index:230;width:min(600px,96vw);max-height:85vh;display:flex;flex-direction:column;">
        <div class="modal-head">
          <div class="card-title">{{ t('collections.drawer.addProducts.title') }}</div>
          <button class="x-btn" (click)="pickingProducts.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="modal-body" style="flex:1;overflow-y:auto;padding-top:0;">
          <div class="inp-search mb-16" style="position:sticky;top:0;background:var(--surface);padding-top:16px;z-index:10;">
            <ap-icon name="search" [size]="14"/>
            <input class="inp with-icon" [placeholder]="t('collections.drawer.addProducts.search')" [ngModel]="pickerSearch()" (ngModelChange)="pickerSearch.set($event)"/>
          </div>
          <div class="col gap-sm">
            @for (p of pickerProducts(); track p.id) {
              <div class="row gap-sm" style="padding:8px;border:1px solid var(--border);border-radius:8px;align-items:center;cursor:pointer;" (click)="toggleProduct(p.id)">
                <input type="checkbox" [checked]="form().productIds.includes(p.id)" style="pointer-events:none;"/>
                <img [src]="p.image" style="width:32px;height:32px;border-radius:4px;object-fit:cover;"/>
                <div style="flex:1;">
                  <div class="strong">{{ p.name }}</div>
                  <div class="muted small">{{ p.sku }}</div>
                </div>
              </div>
            }
          </div>
        </div>
        <div class="drawer-foot">
          <div class="muted">{{ form().productIds.length }} {{ t('collections.drawer.addProducts.selected') }}</div>
          <button class="btn btn-primary" (click)="pickingProducts.set(false)">Done</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .drawer-wide { width: min(720px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

    .product-head { gap: 12px; align-items: flex-start; }
    .head-actions { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .head-icon-btn {
      width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid transparent; border-radius: 8px; color: var(--ink-2);
      cursor: pointer; padding: 0; transition: all 0.12s;
    }
    .head-icon-btn:hover:not(:disabled) { background: var(--bg); border-color: var(--border); color: var(--green); }
    .head-icon-btn:disabled { color: var(--muted-2); cursor: not-allowed; }
    .head-icon-btn svg { width: 14px; height: 14px; }
    .head-divider { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
    html[dir='rtl'] .head-icon-btn svg { transform: scaleX(-1); }
    html[dir='rtl'] .head-icon-btn ap-icon[name='x'] svg { transform: none; }

    .section-title {
      display: flex; align-items: center; gap: 8px; padding: 16px 0 12px; margin-top: 4px;
      border-top: 1px solid var(--border-2); color: var(--green); font-family: var(--ff-disp); font-size: 16px; font-weight: 500;
    }
    .section-title:first-of-type { border-top: none; padding-top: 0; }
    .section-title.danger-section { color: var(--danger); }
    .section-title ap-icon { color: var(--gold); flex-shrink: 0; }
    .section-title.danger-section ap-icon { color: var(--danger); }


    .product-drawer.is-dirty .product-head { box-shadow: inset 4px 0 0 var(--gold); }
    html[dir='rtl'] .product-drawer.is-dirty .product-head { box-shadow: inset -4px 0 0 var(--gold); }

    /* Cover image upload */
    .cover-drop {
      position: relative;
      min-height: 160px;
      border: 1px dashed var(--border);
      border-radius: 12px;
      background: var(--bg);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
      transition: border-color 0.15s, background 0.15s;
    }
    .cover-drop:hover { border-color: var(--gold); }
    .cover-drop.has-image { padding: 0; min-height: 200px; }
    .cover-empty { padding: 20px; text-align: center; }
    .cover-preview {
      width: 100%;
      max-height: 240px;
      object-fit: cover;
      display: block;
    }

    /* URL handle field */
    .handle-row {
      display: flex;
      align-items: center;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }
    .handle-row:focus-within { border-color: var(--green); }
    .handle-prefix {
      padding: 0 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--bg);
      border-right: 1px solid var(--border);
      height: 38px;
      display: flex;
      align-items: center;
    }
    .handle-inp {
      flex: 1;
      border: none !important;
      border-radius: 0 !important;
      background: transparent;
      font-family: var(--ff-mono, monospace);
      font-size: 13px;
    }
    .handle-row button { margin: 0 6px; flex-shrink: 0; }
    .handle-preview { padding: 4px 0; }
    .handle-link { color: var(--green); word-break: break-all; }

    /* Collection products: drag-to-reorder */
    .collection-prod {
      cursor: grab;
      transition: transform 0.12s, box-shadow 0.12s;
    }
    .collection-prod:active { cursor: grabbing; transform: scale(0.98); }
  `],
})
export class CollectionDrawerComponent implements OnInit, OnDestroy {
  private readonly _collections = signal<Collection[]>([]);
  private readonly _currentId = signal<string>('');

  @Input({ required: true }) set collections(list: Collection[]) { this._collections.set(list || []); }
  @Input({ required: true }) set currentId(id: string) {
    if (this._currentId() === id) return;
    this._currentId.set(id);
    this.resetForCurrent();
  }

  readonly collectionList = this._collections.asReadonly();
  @Output() closed = new EventEmitter<void>();
  @Output() currentIdChange = new EventEmitter<string>();
  @Output() deleted = new EventEmitter<Collection>();

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  private readonly productsApi = inject(AdminProductsService);
  readonly t = (k: string): string => this.i18n.t(k);

  private readonly initial = signal<FormShape>({ title: '', handle: '', description: '', imageUrl: null, productIds: [], hidden: false });
  readonly form = signal<FormShape>({ title: '', handle: '', description: '', imageUrl: null, productIds: [], hidden: false });
  readonly handleManual = signal(false);
  readonly saveState = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);
  readonly deleting = signal(false);
  readonly pickingProducts = signal(false);
  readonly pickerSearch = signal('');
  readonly products = signal<Product[]>([]);

  readonly currentIndex = computed(() => this._collections().findIndex((c) => c.id === this._currentId()));
  readonly canPrev = computed(() => this.currentIndex() > 0);
  readonly canNext = computed(() => {
    const idx = this.currentIndex();
    return idx >= 0 && idx < this._collections().length - 1;
  });
  readonly isSystemCollection = computed(() => this.collection?.handle === 'all-products');

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial()));

  get collection(): Collection {
    const list = this._collections();
    return list.find((c) => c.id === this._currentId()) ?? list[0];
  }

  readonly linkedProducts = computed(() => {
    if (this.isSystemCollection()) return [];
    // Render in the order saved on `productIds` so drag-to-reorder is
    // meaningful for storefront display order.
    const ids = this.form().productIds;
    const byId = new Map(this.products().map(p => [p.id, p]));
    return ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  });

  readonly pickerProducts = computed(() => {
    const s = this.pickerSearch().toLowerCase();
    const products = this.products();
    if (!s) return products;
    return products.filter(p => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
  });

  private autoSaveTimer: number | undefined;

  get draftKey(): string { return DRAFT_KEY_PREFIX + this._currentId(); }

  ngOnInit(): void {
    this.resetForCurrent();
    void this.loadProducts();
  }
  ngOnDestroy(): void { if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer); }

  private async loadProducts(): Promise<void> {
    try {
      const products = await this.productsApi.list();
      this.products.set(products.filter((product) => !product.hidden));
    } catch {
      this.products.set([]);
      this.toast.warning('Products unavailable', 'Could not load products for this collection.');
    }
  }

  private resetForCurrent(): void {
    const c = this.collection;
    if (!c) return;
    this.initial.set({ title: c.title, handle: c.handle || '', description: c.description, imageUrl: c.imageUrl, productIds: [...c.productIds], hidden: c.hidden });
    this.handleManual.set(!!c.handle);
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          this.form.set(parsed.form);
          this.saveState.set('dirty');
        }
      }
    } catch {}
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

  set<K extends keyof FormShape>(k: K, v: FormShape[K]): void {
    this.form.update((f) => {
      const next = { ...f, [k]: v };
      if (k === 'title' && !this.handleManual()) {
        next.handle = this.slugify(String(v));
      }
      return next;
    });
    this.scheduleAutoSave();
  }

  setHandle(raw: string): void {
    this.handleManual.set(true);
    this.form.update((f) => ({ ...f, handle: this.slugify(raw) }));
    this.scheduleAutoSave();
  }

  resetHandleToTitle(): void {
    this.handleManual.set(false);
    this.form.update((f) => ({ ...f, handle: this.slugify(f.title) }));
    this.scheduleAutoSave();
  }

  private slugify(str: string): string {
    return str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '');
  }

  toggle(k: 'hidden'): void { this.set(k, !this.form()[k] as never); }

  removeProduct(id: string): void {
    if (this.isSystemCollection()) return;
    this.set('productIds', this.form().productIds.filter(pid => pid !== id));
  }

  toggleProduct(id: string): void {
    if (this.isSystemCollection()) return;
    const ids = this.form().productIds;
    if (ids.includes(id)) this.set('productIds', ids.filter(pid => pid !== id));
    else this.set('productIds', [...ids, id]);
  }

  // ────────────────────────────────────────────────────────────────────
  // Cover image upload (file picker, drag & drop, paste-URL)
  // ────────────────────────────────────────────────────────────────────

  onCoverPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readCover(file);
    input.value = '';
  }

  onCoverDragOver(ev: DragEvent): void { ev.preventDefault(); }

  onCoverDrop(ev: DragEvent): void {
    ev.preventDefault();
    const file = Array.from(ev.dataTransfer?.files ?? []).find(f => f.type.startsWith('image/'));
    if (file) this.readCover(file);
  }

  addCoverUrl(): void {
    const url = window.prompt(this.t('collections.cover.urlPrompt'), 'https://');
    if (url && url.trim()) this.set('imageUrl', url.trim());
  }

  private readCover(file: File): void {
    const reader = new FileReader();
    reader.onload = () => this.set('imageUrl', reader.result as string);
    reader.readAsDataURL(file);
  }

  // ────────────────────────────────────────────────────────────────────
  // Drag-to-reorder products (controls storefront display order)
  // ────────────────────────────────────────────────────────────────────

  private dragFromIndex: number | null = null;

  onProductDragStart(index: number, ev: DragEvent): void {
    this.dragFromIndex = index;
    ev.dataTransfer?.setData('text/plain', String(index));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  onProductDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  }

  onProductDrop(targetIndex: number, ev: DragEvent): void {
    ev.preventDefault();
    const from = this.dragFromIndex ?? Number(ev.dataTransfer?.getData('text/plain'));
    this.dragFromIndex = null;
    if (Number.isNaN(from) || from === targetIndex) return;
    const ids = [...this.form().productIds];
    const [moved] = ids.splice(from, 1);
    ids.splice(targetIndex, 0, moved);
    this.set('productIds', ids);
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
      try { localStorage.setItem(this.draftKey, JSON.stringify({ form: this.form() })); } catch {}
    }, 400);
  }

  async save(): Promise<void> {
    if (!this.dirty() || this.saveState() === 'saving') return;
    this.saveState.set('saving');

    const f = this.form();
    const system = this.isSystemCollection();
    const payload = {
      title: f.title,
      handle: f.handle || undefined,
      description: f.description,
      imageUrl: f.imageUrl,
      productIds: system ? [] : f.productIds,
      hidden: f.hidden,
    };
    const id = this.collection.id;
    const isDraft = !id || id.startsWith('COL-NEW-');

    try {
      const saved = isDraft
        ? await this.collectionsApi.create(payload)
        : await this.collectionsApi.update(id, payload);

      // Update the underlying collection in the parent's list — keep ids in
      // sync if the server replaced our temporary draft id with a real UUID.
      Object.assign(this.collection, saved);

      try { localStorage.removeItem(this.draftKey); } catch {}
      this.initial.set({ ...this.form() });
      this.saveState.set('saved');
      this.toast.success(this.t('collections.toast.saved.title'), `${saved.title}`);
      window.setTimeout(() => this.saveState.set('idle'), 1800);
    } catch {
      this.saveState.set('error');
      this.triggerShake();
    }
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
    this.form.set({ ...this.initial() });
    try { localStorage.removeItem(this.draftKey); } catch {}
    this.saveState.set('idle');
  }

  async onDelete(): Promise<void> {
    if (this.isSystemCollection()) return;
    if (this.deleting()) return;
    const ok = await this.confirm.ask({
      title: this.t('collections.deleteConfirm.title'),
      message: this.t('collections.deleteConfirm.message') + ` "${this.collection.title}".`,
      confirmLabel: this.t('collections.deleteConfirm.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.deleting.set(true);
    setTimeout(() => {
      this.deleting.set(false);
      this.deleted.emit(this.collection);
    }, 600);
  }

  async navigate(dir: -1 | 1): Promise<void> {
    const list = this._collections();
    const idx = this.currentIndex();
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;

    if (this.dirty()) {
      this.triggerShake();
      return;
    }
    this.currentIdChange.emit(list[newIdx].id);
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
}
