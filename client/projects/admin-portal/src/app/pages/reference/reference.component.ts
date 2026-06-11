import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ToastService } from '../../services/toast.service';
import { AdminRefService, RefColor, RefMaterial, RefSizeSet } from '../../services/admin-ref.service';
import { I18nService } from '../../services/i18n.service';

type Tab = 'colors' | 'materials' | 'sizes';

@Component({
  selector: 'ap-reference',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  template: `
    <div class="page-fade">

      <!-- ── Page header ── -->
      <div class="ref-header">
        <div>
          <h1 class="ref-title">Reference Lists</h1>
          <p class="ref-sub">Manage the brand's approved colors, materials and size charts. These appear as dropdowns throughout the catalog.</p>
        </div>
      </div>

      <!-- ── Tabs ── -->
      <div class="ref-tabs">
        <button class="ref-tab" [class.active]="tab() === 'colors'"    (click)="tab.set('colors')">
          <span class="tab-dot" style="background:#c9a84c;"></span> Colors <span class="tab-count">{{ colors().length }}</span>
        </button>
        <button class="ref-tab" [class.active]="tab() === 'materials'" (click)="tab.set('materials')">
          <span class="tab-dot" style="background:#7c3aed;"></span> Materials <span class="tab-count">{{ materials().length }}</span>
        </button>
        <button class="ref-tab" [class.active]="tab() === 'sizes'"     (click)="tab.set('sizes')">
          <span class="tab-dot" style="background:#2563eb;"></span> Size Charts <span class="tab-count">{{ sizeSets().length }}</span>
        </button>
      </div>

      <!-- ════════════════ COLORS ════════════════ -->
      @if (tab() === 'colors') {
        <div class="ref-section">
          <div class="ref-toolbar">
            <span class="ref-count">{{ colors().length }} color{{ colors().length !== 1 ? 's' : '' }}</span>
            <button class="btn btn-gold btn-sm" (click)="addColor()" title="Add Color">
              <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">Add Color</span>
            </button>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (colors().length === 0) {
            <div class="ref-empty">No colors yet. Add your first brand color.</div>
          } @else {
            <div class="color-grid">
              @for (c of colors(); track c.id) {
                <div class="color-card" [class.editing]="editingId() === c.id">
                  @if (editingId() === c.id) {
                    <!-- Inline edit form -->
                    <div class="color-edit">
                      <div class="swatch-preview" [style.background]="editColor.hex"></div>
                      <div class="edit-fields">
                        <div class="ef-row">
                          <input class="inp inp-sm" placeholder="Name (EN)" [(ngModel)]="editColor.name_en"/>
                          <input class="inp inp-sm" placeholder="اسم عربي" dir="rtl" [(ngModel)]="editColor.name_ar"/>
                        </div>
                        <div class="ef-row">
                          <label class="ef-hex-wrap">
                            <input type="color" class="ef-color-picker" [(ngModel)]="editColor.hex"/>
                            <span class="inp inp-sm mono ef-hex-text">{{ editColor.hex }}</span>
                          </label>
                          <input class="inp inp-sm mono" type="number" placeholder="Order" style="width:72px;" [(ngModel)]="editColor.sort_order"/>
                        </div>
                      </div>
                      <div class="edit-actions">
                        <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveColor(c.id)">
                          @if (saving()) { <ap-spinner [size]="10"/> } Save
                        </button>
                        <button class="btn btn-sm btn-outline" (click)="cancelEdit()">Cancel</button>
                      </div>
                    </div>
                  } @else {
                    <!-- Display row -->
                    <div class="color-swatch" [style.background]="c.hex"></div>
                    <div class="color-info">
                      <span class="color-name-en">{{ c.name_en }}</span>
                      <span class="color-name-ar">{{ c.name_ar }}</span>
                      <span class="color-hex mono">{{ c.hex }}</span>
                    </div>
                    <div class="color-acts">
                      <button class="act-btn" (click)="startEditColor(c)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                      <button class="act-btn danger" (click)="deleteColor(c.id)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ════════════════ MATERIALS ════════════════ -->
      @if (tab() === 'materials') {
        <div class="ref-section">
          <div class="ref-toolbar">
            <span class="ref-count">{{ materials().length }} material{{ materials().length !== 1 ? 's' : '' }}</span>
            <button class="btn btn-gold btn-sm" (click)="addMaterial()">
              <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">Add Material</span>
            </button>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (materials().length === 0) {
            <div class="ref-empty">No materials yet.</div>
          } @else {
            <div class="mat-list">
              @for (m of materials(); track m.id) {
                <div class="mat-row" [class.editing]="editingId() === m.id">
                  @if (editingId() === m.id) {
                    <div class="mat-edit">
                      <input class="inp inp-sm" placeholder="Name (EN)" [(ngModel)]="editMaterial.name_en" style="flex:1;min-width:140px;"/>
                      <input class="inp inp-sm" placeholder="اسم عربي" dir="rtl" [(ngModel)]="editMaterial.name_ar" style="flex:1;min-width:120px;"/>
                      <input class="inp inp-sm mono" type="number" placeholder="Order" style="width:72px;" [(ngModel)]="editMaterial.sort_order"/>
                      <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveMaterial(m.id)">
                        @if (saving()) { <ap-spinner [size]="10"/> } Save
                      </button>
                      <button class="btn btn-sm btn-outline" (click)="cancelEdit()">Cancel</button>
                    </div>
                  } @else {
                    <div class="mat-icon">🧵</div>
                    <span class="mat-name-en">{{ m.name_en }}</span>
                    <span class="mat-name-ar muted">{{ m.name_ar }}</span>
                    <div class="mat-acts">
                      <button class="act-btn" (click)="startEditMaterial(m)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                      <button class="act-btn danger" (click)="deleteMaterial(m.id)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ════════════════ SIZE SETS ════════════════ -->
      @if (tab() === 'sizes') {
        <div class="ref-section">
          <div class="ref-toolbar">
            <span class="ref-count">{{ sizeSets().length }} size set{{ sizeSets().length !== 1 ? 's' : '' }}</span>
            <button class="btn btn-gold btn-sm" (click)="addSizeSet()">
              <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">Add Size Set</span>
            </button>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (sizeSets().length === 0) {
            <div class="ref-empty">No size sets yet.</div>
          } @else {
            <div class="size-list">
              @for (s of sizeSets(); track s.id) {
                <div class="size-card" [class.editing]="editingId() === s.id">
                  @if (editingId() === s.id) {
                    <div class="size-edit">
                      <div class="ef-row" style="margin-bottom:10px;">
                        <input class="inp inp-sm" placeholder="Set name (e.g. Men's Footwear)" [(ngModel)]="editSizeSet.name" style="flex:1;"/>
                        <input class="inp inp-sm mono" type="number" placeholder="Order" style="width:72px;" [(ngModel)]="editSizeSet.sort_order"/>
                      </div>
                      <label class="lbl">Sizes (comma-separated)</label>
                      <input class="inp inp-sm mono" [ngModel]="sizesText()" (ngModelChange)="setSizesFromText($event)" placeholder="39, 40, 41, 42 ..."/>
                      <div class="size-preview">
                        @for (sz of editSizeSet.sizes; track sz) {
                          <span class="size-chip">{{ sz }}</span>
                        }
                      </div>
                      <div class="edit-actions" style="margin-top:10px;">
                        <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveSizeSet(s.id)">
                          @if (saving()) { <ap-spinner [size]="10"/> } Save
                        </button>
                        <button class="btn btn-sm btn-outline" (click)="cancelEdit()">Cancel</button>
                      </div>
                    </div>
                  } @else {
                    <div class="size-head">
                      <span class="size-name">📐 {{ s.name }}</span>
                      <div class="mat-acts">
                        <button class="act-btn" (click)="startEditSizeSet(s)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                        <button class="act-btn danger" (click)="deleteSizeSet(s.id)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
                      </div>
                    </div>
                    <div class="size-chips">
                      @for (sz of s.sizes; track sz) {
                        <span class="size-chip">{{ sz }}</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .ref-header {
      margin-bottom: 24px;
    }
    .ref-title {
      font-size: 22px; font-weight: 800;
      font-family: var(--ff-disp);
      color: var(--ink); margin-bottom: 4px;
    }
    .ref-sub { font-size: 13px; color: var(--muted); max-width: 560px; }

    /* ── Tabs ── */
    .ref-tabs {
      display: flex; gap: 4px; flex-wrap: wrap;
      border-bottom: 2px solid var(--border);
      margin-bottom: 24px;
    }
    .ref-tab {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 10px 18px; font-size: 13px; font-weight: 600;
      border: none; background: none; cursor: pointer;
      color: var(--muted); border-bottom: 2px solid transparent;
      margin-bottom: -2px; border-radius: 8px 8px 0 0;
      transition: all 0.15s;
    }
    .ref-tab:hover { color: var(--ink); background: var(--bg-2); }
    .ref-tab.active { color: var(--green); border-bottom-color: var(--green); }
    .tab-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .tab-count {
      font-size: 11px; font-weight: 700;
      background: var(--bg-2); border-radius: 10px;
      padding: 1px 7px; color: var(--muted);
    }
    .ref-tab.active .tab-count { background: var(--green); color: #fff; }

    /* ── Section ── */
    .ref-section { }
    .ref-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
    }
    .ref-count { font-size: 13px; color: var(--muted); }
    .ref-loading { padding: 40px; text-align: center; }
    .ref-empty {
      padding: 32px; text-align: center; color: var(--muted);
      border: 1px dashed var(--border); border-radius: 10px;
      background: var(--bg);
    }

    /* ── Color cards ── */
    .color-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 10px;
    }
    .color-card {
      display: flex; align-items: center; gap: 12px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 14px;
      transition: box-shadow 0.15s;
    }
    .color-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.07); }
    .color-card.editing { border-color: var(--gold); flex-direction: column; align-items: stretch; }
    .color-swatch {
      width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2);
    }
    .color-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .color-name-en { font-size: 13px; font-weight: 600; }
    .color-name-ar { font-size: 12px; color: var(--muted); direction: rtl; text-align: start; }
    .color-hex { font-size: 11px; color: var(--muted); }
    .color-acts { display: flex; gap: 4px; flex-shrink: 0; }

    /* Color edit form */
    .color-edit { display: flex; flex-direction: column; gap: 8px; }
    .swatch-preview {
      width: 100%; height: 48px; border-radius: 8px;
      border: 1px solid rgba(0,0,0,.1);
      transition: background 0.15s;
    }
    .edit-fields { display: flex; flex-direction: column; gap: 8px; }
    .ef-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .ef-row .inp { flex: 1; min-width: 100px; }
    .ef-hex-wrap { display: flex; align-items: center; gap: 6px; flex: 1; cursor: pointer; }
    .ef-color-picker { width: 32px; height: 32px; border: none; padding: 0; cursor: pointer; border-radius: 6px; background: none; }
    .ef-hex-text { flex: 1; }
    .edit-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    /* ── Action buttons ── */
    .act-btn {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: 1px solid transparent;
      border-radius: 6px; cursor: pointer; color: var(--muted);
      transition: all 0.12s;
    }
    .act-btn:hover { background: var(--bg-2); border-color: var(--border); color: var(--ink); }
    .act-btn.danger:hover { color: var(--danger); border-color: rgba(239,68,68,.3); background: rgba(239,68,68,.06); }

    /* ── Material list ── */
    .mat-list { display: flex; flex-direction: column; gap: 6px; }
    .mat-row {
      display: flex; align-items: center; gap: 12px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 14px; flex-wrap: wrap;
    }
    .mat-row.editing { border-color: var(--gold); }
    .mat-icon { font-size: 18px; flex-shrink: 0; }
    .mat-name-en { font-size: 13px; font-weight: 600; flex: 1; min-width: 100px; }
    .mat-name-ar { font-size: 12px; direction: rtl; }
    .mat-acts { display: flex; gap: 4px; margin-inline-start: auto; }
    .mat-edit { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }

    /* ── Size sets ── */
    .size-list { display: flex; flex-direction: column; gap: 10px; }
    .size-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px;
    }
    .size-card.editing { border-color: var(--gold); }
    .size-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
    .size-name { font-size: 14px; font-weight: 600; }
    .size-edit { display: flex; flex-direction: column; gap: 8px; }
    .size-chips, .size-preview {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
    }
    .size-chip {
      font-size: 12px; font-weight: 600; font-family: var(--ff-mono);
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 6px; padding: 3px 10px; color: var(--ink-2);
    }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      .ref-title { font-size: 18px; }
      .ref-tab { padding: 8px 12px; font-size: 12px; }
      .color-grid { grid-template-columns: 1fr; }
      .ef-row { flex-direction: column; }
      .mat-edit { flex-direction: column; align-items: stretch; }
    }
  `],
})
export class ReferenceComponent implements OnInit {
  private readonly refApi = inject(AdminRefService);
  private readonly toast  = inject(ToastService);
  private readonly i18n   = inject(I18nService);

  readonly tab      = signal<Tab>('colors');
  readonly loading  = signal(true);
  readonly saving   = signal(false);
  readonly editingId = signal<string | null>(null);

  readonly colors    = signal<RefColor[]>([]);
  readonly materials = signal<RefMaterial[]>([]);
  readonly sizeSets  = signal<RefSizeSet[]>([]);

  // Mutable edit buffers (plain objects, not signals — they change frequently)
  editColor:    Omit<RefColor, 'id'>    = { name_en: '', name_ar: '', hex: '#000000', sort_order: 0 };
  editMaterial: Omit<RefMaterial, 'id'> = { name_en: '', name_ar: '', sort_order: 0 };
  editSizeSet:  Omit<RefSizeSet, 'id'>  = { name: '', sizes: [], sort_order: 0 };

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [c, m, s] = await Promise.all([
        this.refApi.getColors(),
        this.refApi.getMaterials(),
        this.refApi.getSizeSets(),
      ]);
      this.colors.set(c);
      this.materials.set(m);
      this.sizeSets.set(s);
    } catch {
      this.toast.error('Could not load reference lists');
    } finally {
      this.loading.set(false);
    }
  }

  cancelEdit(): void { this.editingId.set(null); }

  // ── Colors ────────────────────────────────────────────────────────────────

  addColor(): void {
    this.editColor = { name_en: '', name_ar: '', hex: '#C9A84C', sort_order: this.colors().length };
    this.editingId.set('__new_color__');
  }

  startEditColor(c: RefColor): void {
    this.editColor = { name_en: c.name_en, name_ar: c.name_ar, hex: c.hex, sort_order: c.sort_order };
    this.editingId.set(c.id);
  }

  async saveColor(existingId?: string): Promise<void> {
    if (!this.editColor.name_en.trim()) { this.toast.error('Color name (EN) is required'); return; }
    this.saving.set(true);
    try {
      if (existingId && existingId !== '__new_color__') {
        const updated = await this.refApi.updateColor(existingId, this.editColor);
        this.colors.update(list => list.map(c => c.id === existingId ? { ...updated } : c));
      } else {
        const created = await this.refApi.createColor(this.editColor);
        this.colors.update(list => [...list, created]);
      }
      this.editingId.set(null);
      this.toast.success('Color saved');
    } catch { this.toast.error('Could not save color'); }
    finally { this.saving.set(false); }
  }

  async deleteColor(id: string): Promise<void> {
    if (!confirm('Delete this color?')) return;
    try {
      await this.refApi.deleteColor(id);
      this.colors.update(list => list.filter(c => c.id !== id));
      this.toast.success('Color deleted');
    } catch { this.toast.error('Could not delete color'); }
  }

  // ── Materials ─────────────────────────────────────────────────────────────

  addMaterial(): void {
    this.editMaterial = { name_en: '', name_ar: '', sort_order: this.materials().length };
    this.editingId.set('__new_material__');
  }

  startEditMaterial(m: RefMaterial): void {
    this.editMaterial = { name_en: m.name_en, name_ar: m.name_ar, sort_order: m.sort_order };
    this.editingId.set(m.id);
  }

  async saveMaterial(existingId?: string): Promise<void> {
    if (!this.editMaterial.name_en.trim()) { this.toast.error('Material name (EN) is required'); return; }
    this.saving.set(true);
    try {
      if (existingId && existingId !== '__new_material__') {
        const updated = await this.refApi.updateMaterial(existingId, this.editMaterial);
        this.materials.update(list => list.map(m => m.id === existingId ? { ...updated } : m));
      } else {
        const created = await this.refApi.createMaterial(this.editMaterial);
        this.materials.update(list => [...list, created]);
      }
      this.editingId.set(null);
      this.toast.success('Material saved');
    } catch { this.toast.error('Could not save material'); }
    finally { this.saving.set(false); }
  }

  async deleteMaterial(id: string): Promise<void> {
    if (!confirm('Delete this material?')) return;
    try {
      await this.refApi.deleteMaterial(id);
      this.materials.update(list => list.filter(m => m.id !== id));
      this.toast.success('Material deleted');
    } catch { this.toast.error('Could not delete material'); }
  }

  // ── Size Sets ─────────────────────────────────────────────────────────────

  addSizeSet(): void {
    this.editSizeSet = { name: '', sizes: [], sort_order: this.sizeSets().length };
    this.editingId.set('__new_sizeset__');
  }

  startEditSizeSet(s: RefSizeSet): void {
    this.editSizeSet = { name: s.name, sizes: [...s.sizes], sort_order: s.sort_order };
    this.editingId.set(s.id);
  }

  sizesText(): string { return this.editSizeSet.sizes.join(', '); }

  setSizesFromText(text: string): void {
    this.editSizeSet = {
      ...this.editSizeSet,
      sizes: text.split(',').map(s => s.trim()).filter(Boolean),
    };
  }

  async saveSizeSet(existingId?: string): Promise<void> {
    if (!this.editSizeSet.name.trim()) { this.toast.error('Size set name is required'); return; }
    this.saving.set(true);
    try {
      if (existingId && existingId !== '__new_sizeset__') {
        const updated = await this.refApi.updateSizeSet(existingId, this.editSizeSet);
        this.sizeSets.update(list => list.map(s => s.id === existingId ? { ...updated } : s));
      } else {
        const created = await this.refApi.createSizeSet(this.editSizeSet);
        this.sizeSets.update(list => [...list, created]);
      }
      this.editingId.set(null);
      this.toast.success('Size set saved');
    } catch { this.toast.error('Could not save size set'); }
    finally { this.saving.set(false); }
  }

  async deleteSizeSet(id: string): Promise<void> {
    if (!confirm('Delete this size set?')) return;
    try {
      await this.refApi.deleteSizeSet(id);
      this.sizeSets.update(list => list.filter(s => s.id !== id));
      this.toast.success('Size set deleted');
    } catch { this.toast.error('Could not delete size set'); }
  }
}
