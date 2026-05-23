import {
  Component, EventEmitter, Input, OnDestroy, OnInit, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { RichTextComponent } from '../../shared/rich-text/rich-text.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { MediaUploadService, ProductImageUploadResult } from '../../services/media-upload.service';
import { MEDIA_INIT, COLLECTIONS } from '../../data/mock';
import { ME, Product, ProductVariant } from '../../models';

interface FormShape {
  name: string; sku: string; brand: string; collectionIds: string[];
  price: number; stock: number; hidden: boolean;
  enDesc: string; arDesc: string;
  metaTitle: string; metaDesc: string; slug: string;
  variants: ProductVariant[];
  images: string[];
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const DRAFT_KEY_PREFIX = 'elite-admin:draft:';

/** Read a File as a data URL — used for the upload-row thumbnail before
    the server returns the canonical URL. Resolves to '' on non-images. */
function readPreview(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.resolve('');
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

@Component({
  selector: 'ap-product-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, RichTextComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide product-drawer" [class.is-dirty]="dirty()">
      <!-- Header: title + status + save state — nav buttons live alongside close -->
      <div class="drawer-head product-head">
        <div style="min-width:0;flex:1;">
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">{{ form().name || t('catalog.newProduct') }}</div>
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
            <img [src]="primaryImage()" [alt]="form().name" (error)="onImgError($event)"/>
            @if (form().images.length > 1) {
              <span class="prod-3d-badge" style="top:10px;inset-inline-start:10px;background:rgba(2,70,56,0.92);">{{ form().images.length }}</span>
            }
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

          <div class="mb-16">
            <label class="lbl">{{ t('nav.collections') }}</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              @for (c of collections; track c.id) {
                <label class="row gap-sm" style="align-items:center;background:var(--bg-2);padding:6px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border-2);transition:0.12s;" [style.border-color]="form().collectionIds.includes(c.id) ? 'var(--gold)' : ''" [style.background]="form().collectionIds.includes(c.id) ? 'var(--gold-3)' : ''">
                  <input type="checkbox" [checked]="form().collectionIds.includes(c.id)" (change)="toggleCollection(c.id)" style="margin:0;"/>
                  <span class="small">{{ c.title }}</span>
                </label>
              }
            </div>
          </div>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">{{ t('product.field.price') }}</label>
              <input class="inp mono" type="number" min="0" [ngModel]="form().price" (ngModelChange)="setNum('price', $event)"/>
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
        </div>

        <!-- Section: Variants -->
        <div class="section-title">
          <ap-icon name="catalog" [size]="14"/>
          <span>{{ t('product.section.variants') }}</span>
          @if (form().variants.length > 0) {
            <span class="muted small" style="font-weight:400;margin-inline-start:auto;">{{ variantsSummary() }} · {{ variantsTotalStock() }} {{ t('product.field.stock') }}</span>
          }
        </div>

        <div class="mb-24">
          @if (form().variants.length === 0) {
            <div class="variants-empty">
              <div class="strong">{{ t('product.variants.empty.title') }}</div>
              <div class="muted small mt-8">{{ t('product.variants.empty.sub') }}</div>
              <button class="btn btn-outline btn-sm mt-16" (click)="addVariant()">
                <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
              </button>
            </div>
          } @else {
            <div class="variants-table">
              <div class="vt-head">
                <div class="vt-c-sku">{{ t('product.variants.col.sku') }}</div>
                <div class="vt-c-size">{{ t('product.variants.col.size') }}</div>
                <div class="vt-c-color">{{ t('product.variants.col.color') }}</div>
                <div class="vt-c-mat">{{ t('product.variants.col.material') }}</div>
                <div class="vt-c-price">{{ t('product.variants.col.price') }}</div>
                <div class="vt-c-stock">{{ t('product.variants.col.stock') }}</div>
                <div class="vt-c-act"></div>
              </div>
              @for (v of form().variants; track v.id; let i = $index) {
                <div class="vt-row">
                  <div class="vt-c-sku"><input class="inp inp-sm mono" [placeholder]="t('product.variants.placeholder.sku')" [ngModel]="v.sku" (ngModelChange)="updateVariant(i, { sku: $event })"/></div>
                  <div class="vt-c-size"><input class="inp inp-sm" [placeholder]="t('product.variants.placeholder.size')" [ngModel]="v.size" (ngModelChange)="updateVariant(i, { size: $event })"/></div>
                  <div class="vt-c-color"><input class="inp inp-sm" [placeholder]="t('product.variants.placeholder.color')" [ngModel]="v.color" (ngModelChange)="updateVariant(i, { color: $event })"/></div>
                  <div class="vt-c-mat"><input class="inp inp-sm" [placeholder]="t('product.variants.placeholder.material')" [ngModel]="v.material" (ngModelChange)="updateVariant(i, { material: $event })"/></div>
                  <div class="vt-c-price"><input class="inp inp-sm mono" type="number" min="0" [ngModel]="v.price" (ngModelChange)="updateVariant(i, { price: +$event || 0 })"/></div>
                  <div class="vt-c-stock"><input class="inp inp-sm mono" type="number" min="0" [ngModel]="v.stock" (ngModelChange)="updateVariant(i, { stock: +$event || 0 })"/></div>
                  <div class="vt-c-act">
                    <button class="vt-remove" (click)="removeVariant(i)" [attr.aria-label]="t('common.remove')">
                      <ap-icon name="trash" [size]="12"/>
                    </button>
                  </div>
                </div>
              }
              <div class="vt-foot">
                <div class="muted small">
                  @if (variantsPriceRange()) {
                    <span>{{ t('product.variants.priceRange') }}: <span class="strong mono">{{ variantsPriceRange() }}</span></span>
                  }
                </div>
                <button class="btn btn-outline btn-sm" (click)="addVariant()">
                  <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Section: Image Gallery -->
        <div class="section-title">
          <ap-icon name="media" [size]="14"/>
          <span>{{ t('product.section.gallery') }}</span>
          @if (form().images.length > 0) {
            <span class="muted small" style="font-weight:400;margin-inline-start:auto;">{{ form().images.length }} · {{ t('product.gallery.dragHint') }}</span>
          }
        </div>

        <div class="mb-24">
          <div class="gallery-drop"
               (dragover)="onDragOver($event)"
               (drop)="onDropImages($event)">
            @if (form().images.length === 0 && pendingUploads().length === 0) {
              <div class="gallery-empty">
                <div class="strong">{{ t('product.gallery.empty.title') }}</div>
                <div class="muted small mt-8">{{ t('product.gallery.empty.sub') }}</div>
              </div>
            } @else {
              <div class="gallery-grid">
                @for (u of pendingUploads(); track u.id) {
                  <div class="thumb thumb-uploading" [class.thumb-error]="!!u.error">
                    @if (u.thumb) {
                      <img [src]="u.thumb" [alt]="u.name"/>
                    }
                    <div class="thumb-overlay">
                      @if (u.error) {
                        <span class="thumb-error-msg">{{ u.error }}</span>
                      } @else {
                        <div class="thumb-progress-track">
                          <div class="thumb-progress-fill" [style.width.%]="u.percent"></div>
                        </div>
                        <span class="thumb-progress-pct">{{ u.percent }}%</span>
                      }
                    </div>
                  </div>
                }
                @for (img of form().images; track img; let i = $index) {
                  <div class="thumb"
                       [class.is-primary]="i === 0"
                       draggable="true"
                       (dragstart)="onThumbDragStart(i, $event)"
                       (dragover)="onThumbDragOver($event)"
                       (drop)="onThumbDrop(i, $event)">
                    <img [src]="img" [alt]="form().name" (error)="onImgError($event)"/>
                    @if (i === 0) {
                      <span class="thumb-primary">{{ t('product.gallery.primary') }}</span>
                    }
                    <div class="thumb-actions">
                      @if (i !== 0) {
                        <button class="thumb-act" type="button" (click)="setPrimaryImage(i)" [attr.aria-label]="t('product.gallery.makePrimary')" [attr.title]="t('product.gallery.makePrimary')">
                          <ap-icon name="check" [size]="12"/>
                        </button>
                      }
                      <button class="thumb-act danger" type="button" (click)="removeImage(i)" [attr.aria-label]="t('product.gallery.remove')" [attr.title]="t('product.gallery.remove')">
                        <ap-icon name="trash" [size]="12"/>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
            <label class="btn btn-gold btn-sm" style="cursor:pointer;">
              <ap-icon name="upload" [size]="12"/> {{ t('product.gallery.upload') }}
              <input type="file" multiple accept="image/*" hidden (change)="onUploadImages($event)"/>
            </label>
            <button class="btn btn-outline btn-sm" type="button" (click)="addImageUrl()">
              <ap-icon name="link" [size]="12"/> {{ t('product.gallery.addUrl') }}
            </button>
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
          <ap-rich-text
            dir="ltr"
            [value]="form().enDesc"
            [ariaLabel]="t('product.field.descEn')"
            (valueChange)="set('enDesc', $event)"/>
        </div>
        <div class="mb-24">
          <label class="lbl">{{ t('product.field.descAr') }}</label>
          <ap-rich-text
            dir="rtl"
            [value]="form().arDesc"
            [ariaLabel]="t('product.field.descAr')"
            (valueChange)="set('arDesc', $event)"/>
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
    </div>
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



    /* Image Gallery */
    .gallery-drop {
      border: 1px dashed var(--border);
      border-radius: 12px;
      background: var(--bg);
      padding: 14px;
      transition: border-color 0.15s, background 0.15s;
    }
    .gallery-drop:hover { border-color: var(--gold); }
    .gallery-empty {
      padding: 22px;
      text-align: center;
    }
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
    }
    .thumb {
      position: relative;
      aspect-ratio: 1 / 1;
      border-radius: 10px;
      overflow: hidden;
      border: 2px solid transparent;
      background: #fff;
      cursor: grab;
      transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    }
    .thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .thumb.is-primary { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(193, 154, 91, 0.18); }
    .thumb:active { cursor: grabbing; transform: scale(0.98); }
    .thumb-primary {
      position: absolute;
      top: 6px;
      inset-inline-start: 6px;
      background: var(--gold);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 3px 8px;
      border-radius: 99px;
      text-transform: uppercase;
    }
    .thumb-actions {
      position: absolute;
      top: 6px;
      inset-inline-end: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .thumb:hover .thumb-actions,
    .thumb:focus-within .thumb-actions { opacity: 1; }
    .thumb-act {
      width: 24px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.12s;
    }
    .thumb-act:hover { color: var(--green); border-color: var(--green); }
    .thumb-act.danger:hover { color: var(--danger); border-color: var(--danger); }

    /* Upload-in-flight thumbnail state */
    .thumb-uploading { cursor: progress; border: 2px solid var(--gold-2, var(--gold)); }
    .thumb-uploading img { filter: brightness(0.55) saturate(0.85); }
    .thumb-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
      justify-content: center;
      padding: 10px;
      pointer-events: none;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.4);
    }
    .thumb-progress-track {
      width: 80%;
      height: 4px;
      background: rgba(255,255,255,0.25);
      border-radius: 999px;
      overflow: hidden;
    }
    .thumb-progress-fill {
      height: 100%;
      background: var(--gold);
      transition: width 0.18s ease;
    }
    .thumb-progress-pct {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      font-family: var(--ff-disp);
    }
    .thumb-error { border-color: var(--danger); }
    .thumb-error img { filter: brightness(0.4) saturate(0); }
    .thumb-error-msg {
      font-size: 10px;
      text-align: center;
      color: #fff;
      background: rgba(239,68,68,0.85);
      padding: 4px 8px;
      border-radius: 6px;
    }

    /* Mobile-friendly gallery grid + drop zone — touch-tap reaches the file
       picker because the upload button is a <label for=""> wrapping a hidden
       input, no drag required. */
    @media (max-width: 560px) {
      .gallery-drop { padding: 10px; }
      .gallery-grid {
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 8px;
      }
      .thumb-actions { opacity: 1; }   /* always visible on touch — no hover */
      .thumb-act { width: 28px; height: 28px; }
    }

    /* Variants */
    .variants-empty {
      padding: 22px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      background: var(--bg);
      text-align: center;
    }
    .variants-table {
      border: 1px solid var(--border-2);
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
    }
    .variants-table .vt-head,
    .variants-table .vt-row {
      display: grid;
      grid-template-columns: minmax(140px, 1.4fr) 70px 90px minmax(110px, 1.1fr) 90px 80px 32px;
      gap: 8px;
      align-items: center;
      padding: 10px 12px;
    }
    .variants-table .vt-head {
      background: var(--bg);
      border-bottom: 1px solid var(--border-2);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ink-2);
    }
    .variants-table .vt-row { border-top: 1px solid var(--border-2); }
    .variants-table .vt-row:first-of-type { border-top: none; }
    .variants-table .inp-sm {
      height: 32px;
      padding: 4px 8px;
      font-size: 12px;
    }
    .vt-remove {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.12s;
    }
    .vt-remove:hover {
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.3);
      background: rgba(239, 68, 68, 0.06);
    }
    .vt-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--bg);
      border-top: 1px solid var(--border-2);
      gap: 12px;
      flex-wrap: wrap;
    }
    @media (max-width: 720px) {
      .variants-table .vt-head { display: none; }
      .variants-table .vt-row {
        grid-template-columns: 1fr 1fr;
        row-gap: 6px;
      }
      .vt-c-sku, .vt-c-mat { grid-column: 1 / -1; }
      .vt-c-act { grid-column: 1 / -1; justify-self: end; }
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
  private readonly productsApi = inject(AdminProductsService);
  private readonly uploads = inject(MediaUploadService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly collections = COLLECTIONS.filter(c => !c.hidden);

  /** Initial form snapshot — re-set whenever `currentId` changes. */
  private initial!: FormShape;
  readonly form = signal<FormShape>(this.makeEmptyForm());
  readonly draftRestoredAt = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);
  readonly lastSavedAt = signal<string | null>(null);
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

  /** Live primary image — drives the preview tile in the drawer header
      area and stays in sync with reordering / uploads. */
  primaryImage(): string {
    const imgs = this.form().images;
    if (imgs.length > 0) return imgs[0];
    return this.product?.image ?? '';
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
      name: '', sku: '', brand: '', collectionIds: [],
      price: 0, stock: 0, hidden: false,
      enDesc: '', arDesc: '',
      metaTitle: '', metaDesc: '', slug: '',
      variants: [],
      images: [],
    };
  }

  private makeFormFromProduct(p: Product): FormShape {
    return {
      name: p.name,
      sku: p.sku,
      brand: p.brand,
      collectionIds: COLLECTIONS.filter(c => c.productIds.includes(p.id)).map(c => c.id),
      price: p.price,
      stock: p.stock,
      hidden: p.hidden,
      enDesc: 'Hand-stitched in our Doha atelier from full-grain camel leather. Each pair takes 48 hours of single-artisan attention. Limited to 40 pairs per season.',
      arDesc: 'مصنوع يدويًا في ورشتنا في الدوحة من جلد الجمل الكامل الحبيبات. كل زوج يستغرق 48 ساعة من الاهتمام الحرفي الواحد. محدود بـ 40 زوجًا في الموسم.',
      metaTitle: `${p.name} · ${p.brand} · Elite Collection`,
      metaDesc: `Buy the ${p.name} from our Doha atelier. Hand-crafted leather. Free shipping in Qatar.`,
      slug: p.name.toLowerCase().replace(/\s+/g, '-'),
      variants: (p.variants ?? []).map(v => ({ ...v })),
      images: p.images && p.images.length > 0 ? [...p.images] : (p.image ? [p.image] : []),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Image gallery
  // ────────────────────────────────────────────────────────────────────

  addImageUrl(): void {
    const url = window.prompt(this.t('product.gallery.urlPrompt'), 'https://');
    if (url && url.trim()) {
      this.set('images', [...this.form().images, url.trim()]);
    }
  }

  /** Per-pending-file progress UI state. We render one row per active upload
      with a thumbnail (data URL while uploading), filename, percent + status. */
  readonly pendingUploads = signal<Array<{
    id: string;
    name: string;
    thumb: string;
    percent: number;
    error?: string;
  }>>([]);
  readonly isUploading = computed(() => this.pendingUploads().length > 0);

  onUploadImages(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    void this.uploadFiles(files);
    input.value = '';
  }

  onDropImages(ev: DragEvent): void {
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) void this.uploadFiles(files);
  }

  onDragOver(ev: DragEvent): void { ev.preventDefault(); }

  /**
   * Uploads images via the storage adapter. We buffer files into the
   * pendingUploads signal so the UI renders a thumbnail + progress bar per
   * file in flight. On success we replace the form's images[] with the
   * authoritative list returned by the server (so order stays in sync if
   * the user uploaded multiple at once).
   *
   * Brand-new product stubs (P-NEW-*) don't have a server-side row yet, so
   * we fall back to the legacy data-URL preview path; the URL gets persisted
   * the first time the user saves the product.
   */
  private async uploadFiles(files: File[]): Promise<void> {
    if (this.product?.id?.startsWith('P-NEW-')) {
      // Pre-save stub: keep using local data URLs so the gallery preview
      // works before the product exists on the server.
      for (const file of files) {
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            const url = reader.result as string;
            this.set('images', [...this.form().images, url]);
            resolve();
          };
          reader.readAsDataURL(file);
        });
      }
      this.toast.info(this.t('product.gallery.upload'), this.t('product.gallery.empty.sub'));
      return;
    }

    // Pre-flight: validate + seed thumbnails so the UI renders progress rows
    // immediately rather than after the first network event.
    const accepted: { file: File; id: string }[] = [];
    for (const file of files) {
      const reason = this.uploads.validate(file);
      if (reason) {
        this.toast.error(reason, file.name);
        continue;
      }
      const id = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      accepted.push({ file, id });
      const thumb = await readPreview(file);
      this.pendingUploads.update((rows) => [...rows, { id, name: file.name, thumb, percent: 0 }]);
    }
    if (accepted.length === 0) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const filesToSend = accepted.map((a) => a.file);
        let lastPercent = 0;
        this.uploads.uploadProductImages(this.product.id, filesToSend).subscribe({
          next: (ev) => {
            if (ev.stage === 'uploading') {
              lastPercent = ev.percent;
              // Mirror the same percent across all rows in this batch — the
              // browser only reports a single combined progress event.
              this.pendingUploads.update((rows) =>
                rows.map((r) => (accepted.some((a) => a.id === r.id) ? { ...r, percent: lastPercent } : r)),
              );
            }
            if (ev.stage === 'done') {
              const result = ev.result as ProductImageUploadResult;
              if (result?.images) {
                this.set('images', result.images);
                this.initial = { ...this.initial, images: [...result.images] };
              }
              this.toast.success(
                `${result?.uploaded ?? accepted.length} ${this.t('product.gallery.upload').toLowerCase()}`,
                this.product.name,
              );
              resolve();
            }
          },
          error: (err) => reject(err),
        });
      });
    } catch {
      // The HTTP error interceptor already toasted — flag the rows.
      this.pendingUploads.update((rows) =>
        rows.map((r) =>
          accepted.some((a) => a.id === r.id) ? { ...r, error: this.t('error.unknown.title') } : r,
        ),
      );
    } finally {
      // Clear the rows after a brief delay so the user sees the 100% / error
      // state before it disappears.
      window.setTimeout(() => {
        this.pendingUploads.update((rows) =>
          rows.filter((r) => !accepted.some((a) => a.id === r.id)),
        );
      }, 700);
    }
  }

  removeImage(index: number): void {
    this.set('images', this.form().images.filter((_, i) => i !== index));
  }

  setPrimaryImage(index: number): void {
    if (index === 0) return;
    const imgs = [...this.form().images];
    const [picked] = imgs.splice(index, 1);
    imgs.unshift(picked);
    this.set('images', imgs);
  }

  /** HTML5 drag-to-reorder for thumbnails. We track the dragged index in a
      transient property — no service needed since drag is per-component. */
  private dragFromIndex: number | null = null;

  onThumbDragStart(index: number, ev: DragEvent): void {
    this.dragFromIndex = index;
    ev.dataTransfer?.setData('text/plain', String(index));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  onThumbDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  }

  onThumbDrop(targetIndex: number, ev: DragEvent): void {
    ev.preventDefault();
    const from = this.dragFromIndex ?? Number(ev.dataTransfer?.getData('text/plain'));
    this.dragFromIndex = null;
    if (Number.isNaN(from) || from === targetIndex) return;
    const imgs = [...this.form().images];
    const [moved] = imgs.splice(from, 1);
    imgs.splice(targetIndex, 0, moved);
    this.set('images', imgs);
  }

  // ────────────────────────────────────────────────────────────────────
  // Variants
  // ────────────────────────────────────────────────────────────────────

  addVariant(): void {
    const f = this.form();
    const next: ProductVariant = {
      id: 'V-' + Date.now().toString(36),
      sku: f.sku ? `${f.sku}-NEW` : '',
      size: '',
      color: '',
      material: '',
      price: f.price || 0,
      stock: 0,
    };
    this.set('variants', [...f.variants, next]);
  }

  updateVariant(index: number, patch: Partial<ProductVariant>): void {
    const next = this.form().variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    this.set('variants', next);
  }

  removeVariant(index: number): void {
    const next = this.form().variants.filter((_, i) => i !== index);
    this.set('variants', next);
  }

  variantsTotalStock(): number {
    return this.form().variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
  }

  variantsPriceRange(): string {
    const prices = this.form().variants.map(v => Number(v.price) || 0).filter(n => n > 0);
    if (prices.length === 0) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `QAR ${min.toLocaleString()}` : `QAR ${min.toLocaleString()} – ${max.toLocaleString()}`;
  }

  variantsSummary(): string {
    const n = this.form().variants.length;
    if (n === 0) return '';
    const tpl = n === 1 ? this.t('product.variants.summary.one') : this.t('product.variants.summary.many');
    return tpl.replace('{n}', String(n));
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

  toggleCollection(id: string): void {
    const ids = this.form().collectionIds;
    this.set('collectionIds', ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
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

  async save(): Promise<void> {
    if (!this.dirty() || this.saveState() === 'saving') return;
    this.saveState.set('saving');

    try {
      const f = this.form();
      const payload = {
        ...f,
        has3d: this.product.has3d,
        views3d: this.product.views3d,
      };
      const saved = this.product.id.startsWith('P-NEW-')
        ? await this.productsApi.saveProduct(payload)
        : await this.productsApi.update(this.product.id, payload);

      this.saveState.set('saved');
      const ts = new Date().toTimeString().slice(0, 5);
      this.lastSavedAt.set(ts);
      try { localStorage.removeItem(this.draftKey); } catch {}
      this.draftRestoredAt.set(null);
      this.initial = { ...this.form() };

      // Update the actual mock collections for the sake of the prototype
      this.collections.forEach(c => {
        const wasInCol = c.productIds.includes(this.product.id);
        const shouldBeInCol = this.form().collectionIds.includes(c.id);
        if (shouldBeInCol && !wasInCol) {
          c.productIds.push(this.product.id);
        } else if (!shouldBeInCol && wasInCol) {
          c.productIds = c.productIds.filter(id => id !== this.product.id);
        }
      });

      // Persist editable fields back on the underlying product (mock-only
      // mutation so the current mock catalog reflects the saved API state.
      const previousId = this.product.id;
      this.product.id = saved.id;
      this.product.name = saved.name;
      this.product.sku = saved.sku;
      this.product.brand = saved.brand;
      this.product.price = saved.price;
      this.product.stock = saved.stock;
      this.product.hidden = saved.hidden;
      this.product.has3d = saved.has3d;
      this.product.views3d = saved.views3d;
      this.product.variants = (saved.variants ?? []).map(v => ({ ...v }));
      this.product.images = [...(saved.images ?? f.images)];
      // Keep the legacy `image` field in sync with images[0] so the catalog
      // grid, dashboard heatmap, and order rows use the new primary.
      this.product.image = saved.image || this.product.images?.[0] || this.product.image;
      if (previousId !== saved.id) {
        this._currentId.set(saved.id);
        this.currentIdChange.emit(saved.id);
      }
      
      this.toast.success(this.t('product.toast.saved.title'), `${this.form().name}`);
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => this.saveState.set('idle'), 1800);
    } catch {
      this.saveState.set('error');
      this.triggerShake();
    }
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
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
      this.triggerShake();
      return;
    }
    this.currentIdChange.emit(list[newIdx].id);
  }

  triggerShake(): void {
    this.shakeSaveBar.set(false);
    setTimeout(() => this.shakeSaveBar.set(true), 10);
  }

  // ────────────────────────────────────────────────────────────────────
  // Close (with dirty check)
  // ────────────────────────────────────────────────────────────────────

  handleClose(): void {
    if (this.dirty()) { 
      this.triggerShake(); 
      return; 
    }
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
