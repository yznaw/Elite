import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { MEDIA_INIT } from '../../data/mock';
import { ME, Product } from '../../models';

interface FormShape {
  name: string; sku: string; brand: string; category: string;
  price: number; stock: number; hidden: boolean;
  enDesc: string; arDesc: string;
  metaTitle: string; metaDesc: string; slug: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'ap-product-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer">
      <div class="drawer-head">
        <div style="min-width:0;">
          <div class="row gap-sm" style="flex-wrap:wrap;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ form().name }}</div>
            <span class="save-badge" [class]="'save-badge ' + saveState()">
              @if (saveState() === 'saving') { <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> }
              @if (saveState() === 'saved')  { <ap-icon name="check" [size]="12"/> }
              {{ saveLabel() }}
            </span>
            @if (form().hidden) { <ap-pill kind="red">Hidden from store</ap-pill> }
          </div>
          <div class="card-sub">{{ form().sku }} · {{ form().brand }}{{ lastSavedAt() ? ' · saved at ' + lastSavedAt() : '' }}</div>
        </div>
        <button class="x-btn" (click)="handleClose()"><ap-icon name="x" [size]="14"/></button>
      </div>

      <div class="drawer-body">
        @if (draftRestoredAt()) {
          <div class="draft-banner">
            <span><span class="strong">Draft restored</span> · You have unsaved changes from {{ draftRestoredLabel() }}</span>
            <button class="btn btn-ghost btn-sm" (click)="discardDraft()">Discard draft</button>
          </div>
        }

        <div class="vis-block mb-24" [class.hidden-state]="form().hidden">
          <div>
            <div class="strong" style="font-size:13px;margin-bottom:2px;" [style.color]="form().hidden ? 'var(--danger)' : 'var(--ink)'">
              {{ form().hidden ? 'Hidden from storefront' : 'Visible on storefront' }}
            </div>
            <div class="muted small">
              {{ form().hidden ? 'This product is not shown to shoppers. Existing orders and links keep working.' : 'Customers can find and purchase this product. Toggle off to hide while editing.' }}
            </div>
          </div>
          <button class="toggle" [class.on]="!form().hidden" (click)="toggle('hidden')" [attr.aria-label]="form().hidden ? 'Show' : 'Hide'"></button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
          <div class="prod-img" style="border-radius:10px;">
            <img [src]="product.image" [alt]="form().name" (error)="onImgError($event)"/>
          </div>
          <div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">3D Status</span>
              <ap-pill [kind]="product.has3d ? 'green' : 'grey'">{{ product.has3d ? '3D Linked' : '3D Missing' }}</ap-pill>
            </div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">Linked media</span>
              <span class="strong">{{ linkedMediaCount }} {{ linkedMediaCount === 1 ? 'file' : 'files' }}</span>
            </div>
            <div class="row" style="justify-content:space-between;margin-bottom:14px;">
              <span class="muted small">3D Views (30d)</span>
              <span class="strong">{{ product.views3d.toLocaleString() }}</span>
            </div>
            <div class="row" style="justify-content:space-between;">
              <span class="muted small">Product ID</span>
              <span class="strong mono" style="font-size:11px;">{{ product.id }}</span>
            </div>
          </div>
        </div>

        <div class="mb-24">
          <label class="lbl">Product Name</label>
          <input class="inp mb-16" [ngModel]="form().name" (ngModelChange)="set('name', $event)"/>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">SKU</label>
              <input class="inp mono" [ngModel]="form().sku" (ngModelChange)="set('sku', $event)"/>
            </div>
            <div>
              <label class="lbl">Brand</label>
              <input class="inp" [ngModel]="form().brand" (ngModelChange)="set('brand', $event)"/>
            </div>
          </div>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">Category</label>
              <select class="inp" [ngModel]="form().category" (ngModelChange)="set('category', $event)">
                @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </div>
            <div>
              <label class="lbl">Stock (units)</label>
              <input class="inp" type="number" min="0" [ngModel]="form().stock" (ngModelChange)="setNum('stock', $event)"/>
            </div>
          </div>

          <div>
            <label class="lbl">Price (QAR)</label>
            <input class="inp" type="number" min="0" [ngModel]="form().price" (ngModelChange)="setNum('price', $event)"/>
          </div>
        </div>

        <div class="mb-24">
          <label class="lbl">3D Model (.glb)</label>
          <div style="padding:18px;border:1px dashed var(--border);border-radius:10px;background:var(--bg);text-align:center;">
            @if (product.has3d) {
              <div class="strong">elite-{{ product.id.toLowerCase() }}.glb</div>
              <div class="muted small mt-8">linked · 4.2 MB · uploaded 2026-04-12</div>
              <div class="row gap-sm mt-16" style="justify-content:center;">
                <button class="btn btn-outline btn-sm"><ap-icon name="upload" [size]="12"/> Replace</button>
                <button class="btn btn-danger btn-sm"><ap-icon name="trash" [size]="12"/> Unlink</button>
              </div>
            } @else {
              <div class="muted"><ap-icon name="cube" [size]="14"/></div>
              <div class="strong mt-8">No 3D model linked</div>
              <div class="muted small mt-8">Upload a .glb file or paste a Sketchfab URL</div>
              <div class="row gap-sm mt-16" style="justify-content:center;">
                <button class="btn btn-gold btn-sm"><ap-icon name="upload" [size]="12"/> Upload .glb</button>
                <button class="btn btn-outline btn-sm">Link Sketchfab</button>
              </div>
            }
          </div>
        </div>

        <div class="mb-24">
          <label class="lbl">Description (English)</label>
          <textarea class="inp" rows="3" [ngModel]="form().enDesc" (ngModelChange)="set('enDesc', $event)"></textarea>
        </div>
        <div class="mb-24">
          <label class="lbl">Description (Arabic)</label>
          <textarea class="inp" rows="3" dir="rtl" [ngModel]="form().arDesc" (ngModelChange)="set('arDesc', $event)"></textarea>
        </div>

        <div class="mb-24">
          <label class="lbl">SEO Metadata</label>
          <input class="inp mb-8" placeholder="Meta title" [ngModel]="form().metaTitle" (ngModelChange)="set('metaTitle', $event)"/>
          <input class="inp mb-8" placeholder="Meta description" [ngModel]="form().metaDesc" (ngModelChange)="set('metaDesc', $event)"/>
          <input class="inp mono" placeholder="URL slug" [ngModel]="form().slug" (ngModelChange)="set('slug', $event)"/>
        </div>

        <div class="mb-24">
          <label class="lbl">Manual Sync · Counterpoint POS</label>
          <div class="ms-block">
            <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
              <div>
                <div class="strong" style="font-size:13px;color:var(--green);margin-bottom:2px;">Refresh from POS</div>
                <div class="muted small">Pulls live stock, price, and barcode for SKU <span class="mono">{{ product.sku }}</span></div>
              </div>
              <ap-pill kind="green">In sync</ap-pill>
            </div>
            <div class="ms-row">
              <span class="muted small">Last automatic sync</span>
              <span class="row gap-sm">
                <span class="mono" style="font-size:11px;color:var(--ink-2);">2026-04-29 06:00</span>
                <span class="trigger auto" style="padding:2px 8px;font-size:10px;">
                  <ap-icon name="clock" [size]="11"/>
                  Schedule
                </span>
              </span>
            </div>
            <div class="ms-row">
              <span class="muted small">Last manual sync</span>
              <span class="row gap-sm">
                <span class="mono" style="font-size:11px;color:var(--ink-2);">{{ lastManual().when }}</span>
                <span class="trigger" style="padding:2px 10px 2px 3px;font-size:10px;">
                  <span class="avatar" style="width:18px;height:18px;font-size:8px;">{{ lastManual().initials }}</span>
                  {{ firstName(lastManual().by) }}
                </span>
              </span>
            </div>
            <div class="ms-row">
              <span class="muted small">Stock from POS</span>
              <span class="strong">{{ product.stock }} units · {{ product.has3d ? '3D linked' : 'no 3D' }}</span>
            </div>
            <div class="row gap-sm" style="margin-top:14px;">
              <button class="btn btn-gold" style="flex:1;" [disabled]="syncing()" (click)="runProductSync()">
                @if (syncing()) {
                  <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> Syncing this product…
                } @else {
                  <ap-icon name="sync" [size]="14"/> Sync This Product Now
                }
              </button>
              <button class="btn btn-outline" [disabled]="syncing()">View Sync History</button>
            </div>
            <div class="muted small mt-8" style="line-height:1.5;">
              Manual product syncs are logged in <span class="strong" style="color:var(--ink-2);">Sync Logs</span> with your name. Use this when a stock count looks wrong or after editing in Counterpoint.
            </div>
          </div>
        </div>
      </div>

      <div class="drawer-foot" style="justify-content:space-between;">
        <div class="row gap-sm">
          <span class="save-badge" [class]="'save-badge ' + saveState()">
            @if (saveState() === 'saving') { <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> }
            @if (saveState() === 'saved')  { <ap-icon name="check" [size]="12"/> }
            {{ saveLabel() }}
          </span>
          @if (dirty()) { <span class="muted small" style="font-size:10px;">· Draft auto-saved locally</span> }
        </div>
        <div class="row gap-sm">
          <button class="btn btn-ghost" (click)="discard()" [disabled]="!dirty() || saveState() === 'saving'">Discard</button>
          <button class="btn btn-primary" (click)="save()" [disabled]="!dirty() || saveState() === 'saving'">
            @if (saveState() === 'saving') { <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> Saving… }
            @else if (saveState() === 'saved') { <ap-icon name="check" [size]="12"/> Saved }
            @else { Save Changes }
          </button>
        </div>
      </div>
    </div>

    @if (confirmClose()) {
      <div class="overlay" style="z-index:220;" (click)="confirmClose.set(false)"></div>
      <div class="modal" style="z-index:230;width:min(440px,92vw);">
        <div class="modal-head">
          <div>
            <div class="card-title">Unsaved changes</div>
            <div class="card-sub">Draft will be kept locally</div>
          </div>
          <button class="x-btn" (click)="confirmClose.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="modal-body">
          <p style="line-height:1.6;margin-bottom:16px;">
            You have unsaved changes to <span class="strong">{{ form().name }}</span>. They are auto-saved as a draft on this device, so you can come back later — or you can save now.
          </p>
          <div class="muted small">If you discard, the draft will also be removed and cannot be recovered.</div>
        </div>
        <div class="drawer-foot">
          <button class="btn btn-danger" (click)="closeAndDiscardDraft()">Discard draft &amp; close</button>
          <button class="btn btn-outline" (click)="closeAndKeepDraft()">Keep draft, close</button>
          <button class="btn btn-primary" (click)="confirmClose.set(false); save()">Save &amp; close</button>
        </div>
      </div>
    }
  `,
})
export class ProductDrawerComponent implements OnInit, OnDestroy {
  @Input({ required: true }) product!: Product;
  @Output() closed = new EventEmitter<void>();

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly categories = ['Oxford', 'Derby', 'Loafer', 'Boot', 'Sneaker', 'Mule'];

  initial!: FormShape;
  readonly form = signal<FormShape>({
    name: '', sku: '', brand: '', category: '',
    price: 0, stock: 0, hidden: false,
    enDesc: '', arDesc: '',
    metaTitle: '', metaDesc: '', slug: '',
  });
  readonly draftRestoredAt = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<string | null>(null);
  readonly confirmClose = signal(false);
  readonly syncing = signal(false);
  readonly lastManual = signal({ when: '2026-04-29 09:42', by: 'Mona Al-Sayed', initials: 'MS' });

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial));

  private feedbackTimer: number | undefined;
  private autoSaveTimer: number | undefined;
  private syncTimer: number | undefined;

  get linkedMediaCount(): number {
    return MEDIA_INIT.filter((m) => m.linkedTo === this.product.id).length;
  }

  get draftKey(): string { return 'elite-admin:draft:' + this.product.id; }

  ngOnInit(): void {
    this.initial = {
      name: this.product.name,
      sku: this.product.sku,
      brand: this.product.brand,
      category: this.product.category,
      price: this.product.price,
      stock: this.product.stock,
      hidden: this.product.hidden,
      enDesc: 'Hand-stitched in our Doha atelier from full-grain camel leather. Each pair takes 48 hours of single-artisan attention. Limited to 40 pairs per season.',
      arDesc: 'مصنوع يدويًا في ورشتنا في الدوحة من جلد الجمل الكامل الحبيبات. كل زوج يستغرق 48 ساعة من الاهتمام الحرفي الواحد. محدود بـ 40 زوجًا في الموسم.',
      metaTitle: `${this.product.name} · ${this.product.brand} · Elite Collection`,
      metaDesc: `Buy the ${this.product.name} from our Doha atelier. Hand-crafted leather. Free shipping in Qatar.`,
      slug: this.product.name.toLowerCase().replace(/\s+/g, '-'),
    };
    this.form.set({ ...this.initial });

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
    } catch { }
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  saveLabel(): string {
    return {
      idle: 'No changes', dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Error · draft kept',
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
      try { localStorage.removeItem(this.draftKey); } catch { }
      if (this.saveState() === 'dirty') this.saveState.set('idle');
      return;
    }
    if (this.saveState() === 'idle') this.saveState.set('dirty');
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(this.draftKey, JSON.stringify({ form: this.form(), savedAt: new Date().toISOString() }));
      } catch { }
    }, 400);
  }

  save(): void {
    this.saveState.set('saving');
    setTimeout(() => {
      this.saveState.set('saved');
      const ts = '2026-04-29 ' + new Date().toTimeString().slice(0, 5);
      this.lastSavedAt.set(ts);
      try { localStorage.removeItem(this.draftKey); } catch { }
      this.draftRestoredAt.set(null);
      this.initial = { ...this.form() };
      this.toast.success('Product saved', `${this.form().name} · all changes applied`);
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => this.saveState.set('idle'), 1800);
    }, 1200);
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
    const ok = await this.confirm.ask({
      title: 'Discard unsaved changes?',
      message: 'All edits since the last save will be lost. Your saved draft on this device will also be removed.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      variant: 'danger',
    });
    if (!ok) return;
    this.form.set({ ...this.initial });
    try { localStorage.removeItem(this.draftKey); } catch { }
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
    this.toast.info('Changes discarded', 'Reverted to last saved version');
  }

  discardDraft(): void {
    this.form.set({ ...this.initial });
    try { localStorage.removeItem(this.draftKey); } catch { }
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
  }

  handleClose(): void {
    if (this.dirty()) { this.confirmClose.set(true); return; }
    this.closed.emit();
  }

  closeAndKeepDraft(): void {
    this.confirmClose.set(false);
    this.closed.emit();
  }

  closeAndDiscardDraft(): void {
    try { localStorage.removeItem(this.draftKey); } catch { }
    this.confirmClose.set(false);
    this.closed.emit();
  }

  runProductSync(): void {
    this.syncing.set(true);
    this.toast.info('Product sync started', `${this.product.name} · triggered by ${ME.name}`);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      const stamp = '2026-04-29 ' + new Date().toTimeString().slice(0, 5);
      this.lastManual.set({ when: stamp, by: ME.name, initials: ME.initials });
      this.syncing.set(false);
      this.toast.success('Product synced', `${this.product.sku} · stock & price refreshed from POS`);
    }, 2200);
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
