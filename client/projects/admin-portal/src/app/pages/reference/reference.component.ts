import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { AdminRefService, RefColor, RefMaterial, RefSizeSet, SizeChartRow } from '../../services/admin-ref.service';
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
          <h1 class="ref-title">{{ t('reference.title') }}</h1>
          <p class="ref-sub">{{ t('reference.sub') }}</p>
        </div>
      </div>

      <!-- ── Tabs ── -->
      <div class="ref-tabs">
        <button class="ref-tab" [class.active]="tab() === 'colors'"    (click)="tab.set('colors')">
          <span class="tab-dot" style="background:#c9a84c;"></span> {{ t('reference.tab.colors') }}
          <span class="tab-count">{{ colors().length }}</span>
        </button>
        <button class="ref-tab" [class.active]="tab() === 'materials'" (click)="tab.set('materials')">
          <span class="tab-dot" style="background:#7c3aed;"></span> {{ t('reference.tab.materials') }}
          <span class="tab-count">{{ materials().length }}</span>
        </button>
        <button class="ref-tab" [class.active]="tab() === 'sizes'"     (click)="tab.set('sizes')">
          <span class="tab-dot" style="background:#2563eb;"></span> {{ t('reference.tab.sizeCharts') }}
          <span class="tab-count">{{ sizeSets().length }}</span>
        </button>
      </div>

      <!-- ════════════════ COLORS ════════════════ -->
      @if (tab() === 'colors') {
        <div class="ref-section">
          <div class="ref-toolbar">
            <span class="ref-count">{{ colors().length }} {{ colors().length !== 1 ? t('reference.color.countMany') : t('reference.color.count') }}</span>
            <div class="toolbar-right">
              @if (savingSort()) {
                <span class="sort-saving"><ap-spinner [size]="12"/> {{ t('reference.savingOrder') }}</span>
              }
              <button class="btn btn-gold btn-sm" (click)="addColor()">
                <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">{{ t('reference.addColor') }}</span>
              </button>
            </div>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (colors().length === 0) {
            <div class="ref-empty">{{ t('reference.colors.empty') }}</div>
          } @else {
            <div class="color-grid">

              <!-- NEW COLOR form card -->
              @if (editingId() === '__new_color__') {
                <div class="color-card editing">
                  <ng-container *ngTemplateOutlet="colorEditForm; context: { $implicit: null }"/>
                </div>
              }

              @for (c of colors(); track c.id) {
                <div class="color-card"
                     [class.editing]="editingId() === c.id"
                     [class.dragging]="draggingColorId() === c.id"
                     [class.drop-target]="dropTargetColorId() === c.id"
                     [attr.draggable]="editingId() ? null : 'true'"
                     (dragstart)="onColorDragStart(c.id)"
                     (dragover)="onColorDragOver($event, c.id)"
                     (drop)="onColorDrop($event, c.id)"
                     (dragend)="onColorDragEnd()">
                  @if (editingId() === c.id) {
                    <ng-container *ngTemplateOutlet="colorEditForm; context: { $implicit: c }"/>
                  } @else {
                    <!-- Drag handle -->
                    <div class="drag-handle" title="Drag to reorder"><ap-icon name="drag" [size]="12"/></div>
                    <!-- Swatch -->
                    @if (c.swatch_image_url) {
                      <img class="color-swatch color-swatch--img" [src]="c.swatch_image_url" [alt]="c.name_en"/>
                    } @else {
                      <div class="color-swatch" [style.background]="c.hex"></div>
                    }
                    <!-- Info -->
                    <div class="color-info">
                      <span class="color-name-en">{{ c.name_en }}</span>
                      <span class="color-name-ar">{{ c.name_ar }}</span>
                      <span class="color-hex mono">{{ c.hex }}</span>
                    </div>
                    <!-- Usage badge -->
                    @if ((c.variant_count ?? 0) > 0) {
                      <button class="usage-badge" (click)="goToCatalogFilter(c.name_en)" title="View products using this color">
                        {{ c.variant_count }} {{ (c.variant_count ?? 0) !== 1 ? t('common.variants') : t('common.variant') }}
                      </button>
                    } @else {
                      <span class="usage-badge usage-badge--zero">{{ t('common.unused') }}</span>
                    }
                    <!-- Actions -->
                    <div class="color-acts">
                      <button class="act-btn" (click)="startEditColor(c)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                      <button class="act-btn danger" (click)="deleteColor(c)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
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
            <span class="ref-count">{{ materials().length }} {{ materials().length !== 1 ? t('reference.material.countMany') : t('reference.material.count') }}</span>
            <div class="toolbar-right">
              @if (savingSort()) {
                <span class="sort-saving"><ap-spinner [size]="12"/> {{ t('reference.savingOrder') }}</span>
              }
              <button class="btn btn-gold btn-sm" (click)="addMaterial()">
                <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">{{ t('reference.addMaterial') }}</span>
              </button>
            </div>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (materials().length === 0) {
            <div class="ref-empty">{{ t('reference.materials.empty') }}</div>
          } @else {
            <div class="mat-list">

              @if (editingId() === '__new_material__') {
                <div class="mat-row editing">
                  <ng-container *ngTemplateOutlet="matEditForm; context: { $implicit: null }"/>
                </div>
              }

              @for (m of materials(); track m.id) {
                <div class="mat-row"
                     [class.editing]="editingId() === m.id"
                     [class.dragging]="draggingMatId() === m.id"
                     [class.drop-target]="dropTargetMatId() === m.id"
                     [attr.draggable]="editingId() ? null : 'true'"
                     (dragstart)="onMatDragStart(m.id)"
                     (dragover)="onMatDragOver($event, m.id)"
                     (drop)="onMatDrop($event, m.id)"
                     (dragend)="onMatDragEnd()">
                  @if (editingId() === m.id) {
                    <ng-container *ngTemplateOutlet="matEditForm; context: { $implicit: m }"/>
                  } @else {
                    <div class="drag-handle"><ap-icon name="drag" [size]="12"/></div>
                    <div class="mat-icon">{{ materialIcon(m.name_en) }}</div>
                    <span class="mat-name-en">{{ m.name_en }}</span>
                    <span class="mat-name-ar muted">{{ m.name_ar }}</span>
                    @if ((m.variant_count ?? 0) > 0) {
                      <span class="usage-badge">{{ m.variant_count }} {{ (m.variant_count ?? 0) !== 1 ? t('common.variants') : t('common.variant') }}</span>
                    } @else {
                      <span class="usage-badge usage-badge--zero">{{ t('common.unused') }}</span>
                    }
                    <div class="mat-acts">
                      <button class="act-btn" (click)="startEditMaterial(m)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                      <button class="act-btn danger" (click)="deleteMaterial(m)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
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
            <span class="ref-count">{{ sizeSets().length }} {{ sizeSets().length !== 1 ? t('reference.sizeSet.countMany') : t('reference.sizeSet.count') }}</span>
            <button class="btn btn-gold btn-sm" (click)="addSizeSet()">
              <ap-icon name="plus" [size]="13"/> <span class="btn-lbl">{{ t('reference.addSizeSet') }}</span>
            </button>
          </div>

          @if (loading()) {
            <div class="ref-loading"><ap-spinner/></div>
          } @else if (sizeSets().length === 0) {
            <div class="ref-empty">{{ t('reference.sizeSets.empty') }}</div>
          } @else {
            <div class="size-list">
              @for (s of sizeSets(); track s.id) {
                <div class="size-card" [class.editing]="editingId() === s.id">
                  @if (editingId() === s.id) {
                    <div class="size-edit">

                      <!-- Name + order row -->
                      <div class="ef-row" style="margin-bottom:12px;">
                        <input class="inp inp-sm" [placeholder]="t('reference.field.sizeName')" [(ngModel)]="editSizeSet.name" style="flex:1;"/>
                        <input class="inp inp-sm mono" type="number" [placeholder]="t('reference.field.order')" style="width:72px;" [(ngModel)]="editSizeSet.sort_order"/>
                      </div>

                      <!-- Size Conversion Chart -->
                      <label class="lbl">{{ t('reference.field.sizeChart') }}</label>
                      <div class="chart-editor">
                        <div class="chart-head">
                          <span class="chart-col-label">{{ t('reference.field.sizeChart.uk') }}</span>
                          <span class="chart-col-label">{{ t('reference.field.sizeChart.eu') }}</span>
                          <span class="chart-col-label">{{ t('reference.field.sizeChart.us') }}</span>
                          <span class="chart-col-label chart-col-del"></span>
                        </div>
                        @for (row of editSizeSet.size_chart; track row; let ri = $index) {
                          <div class="chart-row">
                            <input class="inp inp-xs mono" [(ngModel)]="row.uk" placeholder="UK"/>
                            <input class="inp inp-xs mono" [(ngModel)]="row.eu" placeholder="EU"/>
                            <input class="inp inp-xs mono" [(ngModel)]="row.us" placeholder="US"/>
                            <button class="chart-del-btn" (click)="removeChartRow(ri)" title="Remove row">
                              <ap-icon name="trash" [size]="12"/>
                            </button>
                          </div>
                        }
                        <button class="btn btn-sm btn-outline chart-add-btn" (click)="addChartRow()">
                          <ap-icon name="plus" [size]="12"/> {{ t('reference.field.sizeChart.addRow') }}
                        </button>
                      </div>

                      <!-- Tip -->
                      <div style="margin-top:10px;">
                        <label class="lbl">{{ t('reference.field.sizeChart.tip') }}</label>
                        <input class="inp inp-sm" [placeholder]="t('reference.field.sizeChart.tipPlaceholder')" [(ngModel)]="editSizeSet.tip" style="width:100%;"/>
                      </div>

                      <!-- Fallback sizes (hidden if chart is populated) -->
                      @if (editSizeSet.size_chart.length === 0) {
                        <div style="margin-top:10px;">
                          <label class="lbl">{{ t('reference.field.sizes') }}</label>
                          <input class="inp inp-sm mono" [ngModel]="sizesText()" (ngModelChange)="setSizesFromText($event)" placeholder="39, 40, 41, 42 ..."/>
                          <div class="size-preview">
                            @for (sz of editSizeSet.sizes; track sz; let si = $index) {
                              <span class="size-chip size-chip--reorder">
                                {{ sz }}
                                <button class="chip-btn" (click)="moveSizeChip(si, -1)" [disabled]="si === 0">‹</button>
                                <button class="chip-btn" (click)="moveSizeChip(si, 1)" [disabled]="si === editSizeSet.sizes.length - 1">›</button>
                                <button class="chip-btn chip-btn--rm" (click)="removeSizeChip(si)">×</button>
                              </span>
                            }
                          </div>
                        </div>
                      }

                      <div class="edit-actions" style="margin-top:14px;">
                        <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveSizeSet(s.id)">
                          @if (saving()) { <ap-spinner [size]="10"/> } {{ t('common.save') }}
                        </button>
                        <button class="btn btn-sm btn-outline" (click)="cancelEdit()">{{ t('common.cancel') }}</button>
                      </div>
                    </div>
                  } @else {
                    <div class="size-head">
                      <div class="size-name-wrap">
                        <span class="size-name">{{ s.name }}</span>
                        @if ((s.usage_hint ?? 0) > 0) {
                          <span class="usage-badge">{{ s.usage_hint }} {{ (s.usage_hint ?? 0) !== 1 ? t('reference.product.countMany') : t('reference.product.count') }}</span>
                        } @else {
                          <span class="usage-badge usage-badge--zero">{{ t('common.unused') }}</span>
                        }
                      </div>
                      <div class="mat-acts">
                        <button class="act-btn" (click)="duplicateSizeSet(s.id)" title="Duplicate"><ap-icon name="copy" [size]="13"/></button>
                        <button class="act-btn" (click)="startEditSizeSet(s)" title="Edit"><ap-icon name="edit" [size]="13"/></button>
                        <button class="act-btn danger" (click)="deleteSizeSet(s.id)" title="Delete"><ap-icon name="trash" [size]="13"/></button>
                      </div>
                    </div>

                    <!-- Conversion chart view -->
                    @if (s.size_chart && s.size_chart.length > 0) {
                      <div class="chart-view">
                        <table class="chart-table">
                          <thead>
                            <tr>
                              <th>UK</th>
                              <th>EU</th>
                              <th>US</th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (row of s.size_chart; track row) {
                              <tr>
                                <td>{{ row.uk }}</td>
                                <td class="td-highlight">{{ row.eu }}</td>
                                <td>{{ row.us }}</td>
                              </tr>
                            }
                          </tbody>
                        </table>
                        @if (s.tip) {
                          <p class="chart-tip">{{ s.tip }}</p>
                        }
                      </div>
                    } @else {
                      <!-- Fallback: flat size chips -->
                      <div class="size-chips">
                        @for (sz of s.sizes; track sz) {
                          <span class="size-chip">{{ sz }}</span>
                        }
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ════ Color edit form template ════ -->
      <ng-template #colorEditForm let-c>
        <div class="color-edit">
          <div class="swatch-preview-wrap">
            @if (editColor.swatch_image_url) {
              <img class="swatch-preview swatch-preview--img" [src]="editColor.swatch_image_url" alt="Swatch preview"/>
            } @else {
              <div class="swatch-preview" [style.background]="editColor.hex"></div>
            }
          </div>
          <div class="edit-fields">
            <div class="ef-row">
              <input class="inp inp-sm" [placeholder]="t('reference.field.nameEn')" [(ngModel)]="editColor.name_en"/>
              <input class="inp inp-sm" [placeholder]="t('reference.field.nameAr')" dir="rtl" [(ngModel)]="editColor.name_ar"/>
            </div>
            <div class="ef-row">
              <label class="ef-hex-wrap">
                <input type="color" class="ef-color-picker" [(ngModel)]="editColor.hex"/>
                <span class="inp inp-sm mono ef-hex-text">{{ editColor.hex }}</span>
              </label>
              <input class="inp inp-sm mono" type="number" [placeholder]="t('reference.field.order')" style="width:72px;" [(ngModel)]="editColor.sort_order"/>
            </div>
            <div class="ef-row">
              <input class="inp inp-sm" [placeholder]="t('reference.field.swatchUrl')" [(ngModel)]="editColor.swatch_image_url" style="flex:1;"/>
            </div>
            <p class="ef-hint">{{ t('reference.field.swatchHint') }}</p>
          </div>
          <div class="edit-actions">
            <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveColor(c?.id)">
              @if (saving()) { <ap-spinner [size]="10"/> } {{ t('common.save') }}
            </button>
            <button class="btn btn-sm btn-outline" (click)="cancelEdit()">{{ t('common.cancel') }}</button>
          </div>
        </div>
      </ng-template>

      <!-- ════ Material edit form template ════ -->
      <ng-template #matEditForm let-m>
        <div class="mat-edit">
          <input class="inp inp-sm" [placeholder]="t('reference.field.nameEn')" [(ngModel)]="editMaterial.name_en" style="flex:1;min-width:140px;"/>
          <input class="inp inp-sm" [placeholder]="t('reference.field.nameAr')" dir="rtl" [(ngModel)]="editMaterial.name_ar" style="flex:1;min-width:120px;"/>
          <input class="inp inp-sm mono" type="number" [placeholder]="t('reference.field.order')" style="width:72px;" [(ngModel)]="editMaterial.sort_order"/>
          <button class="btn btn-sm btn-gold" [disabled]="saving()" (click)="saveMaterial(m?.id)">
            @if (saving()) { <ap-spinner [size]="10"/> } {{ t('common.save') }}
          </button>
          <button class="btn btn-sm btn-outline" (click)="cancelEdit()">{{ t('common.cancel') }}</button>
        </div>
      </ng-template>

    </div>
  `,
  styles: [`
    .ref-header { margin-bottom: 24px; }
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
    .ref-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
    }
    .toolbar-right { display: flex; align-items: center; gap: 10px; }
    .sort-saving { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
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
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
    }
    .color-card {
      display: flex; align-items: center; gap: 10px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 10px 12px;
      transition: box-shadow 0.15s, opacity 0.15s;
      cursor: grab;
    }
    .color-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.07); }
    .color-card.editing { border-color: var(--gold); flex-direction: column; align-items: stretch; cursor: default; }
    .color-card.dragging { opacity: 0.45; cursor: grabbing; }
    .color-card.drop-target { border-color: var(--green); box-shadow: 0 0 0 2px rgba(2,70,56,.15); }

    .drag-handle {
      color: var(--muted); cursor: grab; padding: 2px 0; flex-shrink: 0;
      opacity: 0.4; transition: opacity 0.12s;
    }
    .color-card:hover .drag-handle,
    .mat-row:hover .drag-handle { opacity: 1; }

    .color-swatch {
      width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2);
    }
    .color-swatch--img { object-fit: cover; }
    .color-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .color-name-en { font-size: 13px; font-weight: 600; }
    .color-name-ar { font-size: 12px; color: var(--muted); direction: rtl; text-align: start; }
    .color-hex { font-size: 11px; color: var(--muted); }
    .color-acts { display: flex; gap: 4px; flex-shrink: 0; }

    /* Usage badge */
    .usage-badge {
      font-size: 10px; font-weight: 600; letter-spacing: .04em;
      padding: 3px 8px; border-radius: 99px; white-space: nowrap; flex-shrink: 0;
      background: #fef3c7; color: #92400e;
      border: none; cursor: pointer; transition: background .12s;
    }
    .usage-badge:hover { background: #fde68a; }
    .usage-badge--zero {
      background: var(--bg-2); color: var(--muted);
      cursor: default; pointer-events: none;
    }

    /* Color edit form */
    .color-edit { display: flex; flex-direction: column; gap: 8px; }
    .swatch-preview-wrap { width: 100%; }
    .swatch-preview {
      width: 100%; height: 48px; border-radius: 8px;
      border: 1px solid rgba(0,0,0,.1);
      transition: background 0.15s;
    }
    .swatch-preview--img { object-fit: cover; height: 48px; border-radius: 8px; display: block; }
    .edit-fields { display: flex; flex-direction: column; gap: 8px; }
    .ef-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .ef-row .inp { flex: 1; min-width: 100px; }
    .ef-hex-wrap { display: flex; align-items: center; gap: 6px; flex: 1; cursor: pointer; }
    .ef-color-picker { width: 32px; height: 32px; border: none; padding: 0; cursor: pointer; border-radius: 6px; background: none; }
    .ef-hex-text { flex: 1; }
    .ef-hint { font-size: 11px; color: var(--muted); line-height: 1.5; margin-top: -2px; }
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
      display: flex; align-items: center; gap: 10px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 10px 12px; flex-wrap: wrap;
      cursor: grab; transition: box-shadow 0.15s, opacity 0.15s;
    }
    .mat-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,.07); }
    .mat-row.editing { border-color: var(--gold); cursor: default; }
    .mat-row.dragging { opacity: 0.45; cursor: grabbing; }
    .mat-row.drop-target { border-color: var(--green); box-shadow: 0 0 0 2px rgba(2,70,56,.15); }
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
    .size-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px; gap: 8px;
    }
    .size-name-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .size-name { font-size: 14px; font-weight: 700; color: var(--ink); }
    .size-edit { display: flex; flex-direction: column; gap: 8px; }
    .size-chips, .size-preview {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
    }
    .size-chip {
      font-size: 12px; font-weight: 600; font-family: var(--ff-mono);
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 6px; padding: 3px 10px; color: var(--ink-2);
    }
    .size-chip--reorder {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 2px 4px 2px 8px;
    }
    .chip-btn {
      background: none; border: none; cursor: pointer;
      color: var(--muted); font-size: 13px; line-height: 1;
      padding: 0 2px; border-radius: 3px; transition: color .1s;
    }
    .chip-btn:hover:not(:disabled) { color: var(--ink); }
    .chip-btn:disabled { opacity: 0.25; cursor: default; }
    .chip-btn--rm:hover:not(:disabled) { color: var(--danger); }

    /* ── Size Conversion Chart (view mode) ── */
    .chart-view { overflow-x: auto; }
    .chart-table {
      width: 100%; border-collapse: collapse;
      font-size: 13px; font-family: var(--ff-mono);
    }
    .chart-table thead tr {
      background: var(--bg-2); border-bottom: 2px solid var(--border);
    }
    .chart-table th {
      padding: 7px 16px; text-align: center; font-size: 11px;
      font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--muted); white-space: nowrap;
    }
    .chart-table td {
      padding: 6px 16px; text-align: center; font-weight: 500;
      border-bottom: 1px solid var(--border); color: var(--ink-2);
    }
    .chart-table .td-highlight {
      font-weight: 700; color: var(--ink);
      background: color-mix(in srgb, var(--gold) 6%, transparent);
    }
    .chart-table tbody tr:last-child td { border-bottom: none; }
    .chart-table tbody tr:hover td { background: var(--bg-2); }
    .chart-table tbody tr:hover td.td-highlight {
      background: color-mix(in srgb, var(--gold) 12%, transparent);
    }
    .chart-tip {
      font-size: 12px; color: var(--muted); margin-top: 10px;
      padding: 8px 12px; background: var(--bg-2); border-radius: 6px;
      border-inline-start: 3px solid var(--gold);
    }

    /* ── Size Chart Editor ── */
    .chart-editor {
      border: 1px solid var(--border); border-radius: 8px;
      overflow: hidden; margin-top: 4px;
    }
    .chart-head {
      display: grid; grid-template-columns: 1fr 1fr 1fr 32px;
      background: var(--bg-2); border-bottom: 1px solid var(--border);
      padding: 6px 8px; gap: 6px;
    }
    .chart-col-label {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .08em; color: var(--muted); text-align: center;
    }
    .chart-col-del { width: 32px; }
    .chart-row {
      display: grid; grid-template-columns: 1fr 1fr 1fr 32px;
      gap: 6px; padding: 5px 8px; align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .chart-row:last-of-type { border-bottom: none; }
    .chart-row:hover { background: var(--bg); }
    .inp-xs {
      padding: 4px 6px; font-size: 12px; text-align: center;
      width: 100%; box-sizing: border-box;
    }
    .chart-del-btn {
      width: 26px; height: 26px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: 1px solid transparent;
      border-radius: 6px; cursor: pointer; color: var(--muted);
      transition: all .12s;
    }
    .chart-del-btn:hover { color: var(--danger); border-color: rgba(239,68,68,.3); background: rgba(239,68,68,.06); }
    .chart-add-btn {
      width: 100%; border-radius: 0; border: none; border-top: 1px dashed var(--border);
      padding: 8px; font-size: 12px;
    }

    .lbl { font-size: 11px; font-weight: 600; color: var(--muted); display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .06em; }

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
  private readonly refApi  = inject(AdminRefService);
  private readonly toast   = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router  = inject(Router);
  private readonly i18n    = inject(I18nService);

  readonly t = (k: string) => this.i18n.t(k);

  readonly tab       = signal<Tab>('colors');
  readonly loading   = signal(true);
  readonly saving    = signal(false);
  readonly savingSort = signal(false);
  readonly editingId  = signal<string | null>(null);

  readonly colors    = signal<RefColor[]>([]);
  readonly materials = signal<RefMaterial[]>([]);
  readonly sizeSets  = signal<RefSizeSet[]>([]);

  // Drag state — colors
  readonly draggingColorId   = signal<string | null>(null);
  readonly dropTargetColorId = signal<string | null>(null);

  // Drag state — materials
  readonly draggingMatId   = signal<string | null>(null);
  readonly dropTargetMatId = signal<string | null>(null);

  // Edit buffers (plain objects — they change on every keystroke)
  editColor: Omit<RefColor, 'id' | 'variant_count'> = { name_en: '', name_ar: '', hex: '#000000', swatch_image_url: null, sort_order: 0 };
  editMaterial: Omit<RefMaterial, 'id' | 'variant_count'> = { name_en: '', name_ar: '', sort_order: 0 };
  editSizeSet: Omit<RefSizeSet, 'id'> = { name: '', sizes: [], size_chart: [], tip: null, sort_order: 0 };

  async ngOnInit(): Promise<void> { await this.reload(); }

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
      this.toast.error(this.t('reference.toast.loadError'));
    } finally {
      this.loading.set(false);
    }
  }

  cancelEdit(): void { this.editingId.set(null); }

  goToCatalogFilter(colorName: string): void {
    void this.router.navigate(['/catalog'], { queryParams: { color: colorName } });
  }

  materialIcon(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('suede') || n.includes('nubuck'))   return '🪨';
    if (n.includes('patent'))                           return '✨';
    if (n.includes('exotic') || n.includes('croc') || n.includes('ostrich')) return '🐊';
    if (n.includes('velvet'))                           return '🟣';
    if (n.includes('canvas'))                           return '🎨';
    if (n.includes('leather'))                          return '🟤';
    return '🧵';
  }

  // ── Colors ────────────────────────────────────────────────────────────────

  addColor(): void {
    this.editColor = { name_en: '', name_ar: '', hex: '#C9A84C', swatch_image_url: null, sort_order: this.colors().length };
    this.editingId.set('__new_color__');
  }

  startEditColor(c: RefColor): void {
    this.editColor = { name_en: c.name_en, name_ar: c.name_ar, hex: c.hex, swatch_image_url: c.swatch_image_url ?? null, sort_order: c.sort_order };
    this.editingId.set(c.id);
  }

  async saveColor(existingId?: string): Promise<void> {
    if (!this.editColor.name_en.trim()) { this.toast.error(this.t('reference.toast.colorNameRequired')); return; }
    this.saving.set(true);
    try {
      const payload = {
        name_en:          this.editColor.name_en.trim(),
        name_ar:          this.editColor.name_ar,
        hex:              this.editColor.hex,
        swatch_image_url: this.editColor.swatch_image_url || null,
        sort_order:       this.editColor.sort_order,
      };
      if (existingId && existingId !== '__new_color__') {
        const updated = await this.refApi.updateColor(existingId, payload);
        this.colors.update(list => list.map(c => c.id === existingId ? { ...c, ...updated } : c));
      } else {
        const created = await this.refApi.createColor(payload);
        this.colors.update(list => [...list, { ...created, variant_count: 0 }]);
      }
      this.editingId.set(null);
      this.toast.success(this.t('reference.toast.colorSaved'));
    } catch { this.toast.error(this.t('reference.toast.colorSaveError')); }
    finally { this.saving.set(false); }
  }

  async deleteColor(c: RefColor): Promise<void> {
    const count = c.variant_count ?? 0;
    const confirmed = await this.confirm.ask({
      title:        count > 0 ? this.t('reference.confirm.deleteColor.inUseTitle') : `${this.t('reference.confirm.deleteColor.title')} "${c.name_en}"`,
      message:      this.t('reference.confirm.deleteColor.message'),
      variant:      'danger',
      confirmLabel: count > 0 ? this.t('reference.confirm.deleteColor.forceLabel') : this.t('reference.confirm.deleteColor.confirmLabel'),
      cancelLabel:  this.t('common.cancel'),
    });
    if (!confirmed) return;

    try {
      await this.refApi.deleteColor(c.id, count > 0);
      this.colors.update(list => list.filter(x => x.id !== c.id));
      this.toast.success(this.t('reference.toast.colorDeleted'));
    } catch { this.toast.error(this.t('reference.toast.colorDeleteError')); }
  }

  // ── Color drag-to-reorder ─────────────────────────────────────────────────

  onColorDragStart(id: string): void { this.draggingColorId.set(id); }

  onColorDragOver(e: DragEvent, id: string): void {
    e.preventDefault();
    this.dropTargetColorId.set(id);
  }

  onColorDrop(e: DragEvent, targetId: string): void {
    e.preventDefault();
    const fromId = this.draggingColorId();
    this.onColorDragEnd();
    if (!fromId || fromId === targetId) return;

    this.colors.update(list => {
      const next = [...list];
      const fromIdx = next.findIndex(c => c.id === fromId);
      const toIdx   = next.findIndex(c => c.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return list;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next.map((c, i) => ({ ...c, sort_order: i }));
    });

    void this.saveColorOrder();
  }

  onColorDragEnd(): void {
    this.draggingColorId.set(null);
    this.dropTargetColorId.set(null);
  }

  private async saveColorOrder(): Promise<void> {
    this.savingSort.set(true);
    try {
      const items = this.colors().map((c, i) => ({ id: c.id, sort_order: i }));
      await this.refApi.saveColorSortOrders(items);
    } catch { this.toast.error(this.t('reference.toast.colorOrderError')); }
    finally { this.savingSort.set(false); }
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
    if (!this.editMaterial.name_en.trim()) { this.toast.error(this.t('reference.toast.materialNameRequired')); return; }
    this.saving.set(true);
    try {
      if (existingId && existingId !== '__new_material__') {
        const updated = await this.refApi.updateMaterial(existingId, this.editMaterial);
        this.materials.update(list => list.map(m => m.id === existingId ? { ...m, ...updated } : m));
      } else {
        const created = await this.refApi.createMaterial(this.editMaterial);
        this.materials.update(list => [...list, { ...created, variant_count: 0 }]);
      }
      this.editingId.set(null);
      this.toast.success(this.t('reference.toast.materialSaved'));
    } catch { this.toast.error(this.t('reference.toast.materialSaveError')); }
    finally { this.saving.set(false); }
  }

  async deleteMaterial(m: RefMaterial): Promise<void> {
    const count = m.variant_count ?? 0;
    const confirmed = await this.confirm.ask({
      title:        count > 0 ? this.t('reference.confirm.deleteMaterial.inUseTitle') : `${this.t('reference.confirm.deleteMaterial.title')} "${m.name_en}"`,
      message:      this.t('reference.confirm.deleteColor.message'),
      variant:      'danger',
      confirmLabel: count > 0 ? this.t('reference.confirm.deleteColor.forceLabel') : this.t('reference.confirm.deleteColor.confirmLabel'),
      cancelLabel:  this.t('common.cancel'),
    });
    if (!confirmed) return;

    try {
      await this.refApi.deleteMaterial(m.id, count > 0);
      this.materials.update(list => list.filter(x => x.id !== m.id));
      this.toast.success(this.t('reference.toast.materialDeleted'));
    } catch { this.toast.error(this.t('reference.toast.materialDeleteError')); }
  }

  // ── Material drag-to-reorder ──────────────────────────────────────────────

  onMatDragStart(id: string): void { this.draggingMatId.set(id); }

  onMatDragOver(e: DragEvent, id: string): void {
    e.preventDefault();
    this.dropTargetMatId.set(id);
  }

  onMatDrop(e: DragEvent, targetId: string): void {
    e.preventDefault();
    const fromId = this.draggingMatId();
    this.onMatDragEnd();
    if (!fromId || fromId === targetId) return;

    this.materials.update(list => {
      const next = [...list];
      const fromIdx = next.findIndex(m => m.id === fromId);
      const toIdx   = next.findIndex(m => m.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return list;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next.map((m, i) => ({ ...m, sort_order: i }));
    });

    void this.saveMatOrder();
  }

  onMatDragEnd(): void {
    this.draggingMatId.set(null);
    this.dropTargetMatId.set(null);
  }

  private async saveMatOrder(): Promise<void> {
    this.savingSort.set(true);
    try {
      const items = this.materials().map((m, i) => ({ id: m.id, sort_order: i }));
      await this.refApi.saveMaterialSortOrders(items);
    } catch { this.toast.error(this.t('reference.toast.materialOrderError')); }
    finally { this.savingSort.set(false); }
  }

  // ── Size Sets ─────────────────────────────────────────────────────────────

  addSizeSet(): void {
    this.editSizeSet = { name: '', sizes: [], size_chart: [], tip: null, sort_order: this.sizeSets().length };
    this.editingId.set('__new_sizeset__');
  }

  startEditSizeSet(s: RefSizeSet): void {
    this.editSizeSet = {
      name: s.name,
      sizes: [...s.sizes],
      size_chart: (s.size_chart ?? []).map(r => ({ ...r })),
      tip: s.tip ?? null,
      sort_order: s.sort_order,
    };
    this.editingId.set(s.id);
  }

  sizesText(): string { return this.editSizeSet.sizes.join(', '); }

  setSizesFromText(text: string): void {
    this.editSizeSet = {
      ...this.editSizeSet,
      sizes: text.split(',').map(s => s.trim()).filter(Boolean),
    };
  }

  moveSizeChip(index: number, dir: -1 | 1): void {
    const sizes = [...this.editSizeSet.sizes];
    const target = index + dir;
    if (target < 0 || target >= sizes.length) return;
    [sizes[index], sizes[target]] = [sizes[target], sizes[index]];
    this.editSizeSet = { ...this.editSizeSet, sizes };
  }

  removeSizeChip(index: number): void {
    const sizes = this.editSizeSet.sizes.filter((_, i) => i !== index);
    this.editSizeSet = { ...this.editSizeSet, sizes };
  }

  addChartRow(): void {
    this.editSizeSet = {
      ...this.editSizeSet,
      size_chart: [...this.editSizeSet.size_chart, { uk: '', eu: '', us: '' }],
    };
  }

  removeChartRow(index: number): void {
    this.editSizeSet = {
      ...this.editSizeSet,
      size_chart: this.editSizeSet.size_chart.filter((_, i) => i !== index),
    };
  }

  async duplicateSizeSet(id: string): Promise<void> {
    try {
      const created = await this.refApi.duplicateSizeSet(id);
      this.sizeSets.update(list => [...list, created]);
      this.toast.success(this.t('reference.toast.sizeSetDuplicated'));
    } catch { this.toast.error(this.t('reference.toast.sizeSetDuplicateError')); }
  }

  async saveSizeSet(existingId?: string): Promise<void> {
    if (!this.editSizeSet.name.trim()) { this.toast.error(this.t('reference.toast.sizeSetNameRequired')); return; }
    this.saving.set(true);
    try {
      // Auto-derive sizes from EU column when a conversion chart is defined
      const chart = this.editSizeSet.size_chart ?? [];
      const sizes = chart.length > 0
        ? chart.map(r => r.eu).filter(Boolean)
        : this.editSizeSet.sizes;

      const payload = { ...this.editSizeSet, sizes };

      if (existingId && existingId !== '__new_sizeset__') {
        const updated = await this.refApi.updateSizeSet(existingId, payload);
        this.sizeSets.update(list => list.map(s => s.id === existingId ? { ...updated } : s));
      } else {
        const created = await this.refApi.createSizeSet(payload);
        this.sizeSets.update(list => [...list, created]);
      }
      this.editingId.set(null);
      this.toast.success(this.t('reference.toast.sizeSetSaved'));
    } catch { this.toast.error(this.t('reference.toast.sizeSetSaveError')); }
    finally { this.saving.set(false); }
  }

  async deleteSizeSet(id: string): Promise<void> {
    const confirmed = await this.confirm.ask({
      title:        this.t('reference.confirm.deleteSizeSet.title'),
      message:      this.t('reference.confirm.deleteSizeSet.message'),
      variant:      'danger',
      confirmLabel: this.t('reference.confirm.deleteColor.confirmLabel'),
      cancelLabel:  this.t('common.cancel'),
    });
    if (!confirmed) return;
    try {
      await this.refApi.deleteSizeSet(id);
      this.sizeSets.update(list => list.filter(s => s.id !== id));
      this.toast.success(this.t('reference.toast.sizeSetDeleted'));
    } catch { this.toast.error(this.t('reference.toast.sizeSetDeleteError')); }
  }
}
