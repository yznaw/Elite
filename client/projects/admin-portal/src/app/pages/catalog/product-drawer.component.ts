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
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { AdminRefService, RefColor, RefMaterial, RefSizeSet } from '../../services/admin-ref.service';
import { MediaUploadService, ProductImageUploadResult } from '../../services/media-upload.service';
import { AdminMediaService } from '../../services/admin-media.service';
import { StorageService } from '../../services/storage.service';
import { Collection, ME, Product, ProductVariant } from '../../models';

interface FormShape {
  name: string; nameAr: string; sku: string; brand: string; collectionIds: string[];
  relatedProductIds: string[];
  price: number; stock: number; hidden: boolean;
  enDesc: string; arDesc: string;
  metaTitle: string; metaDesc: string; slug: string;
  variants: ProductVariant[];
  images: string[];
  imageColors: Record<string, string>;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';


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
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, RichTextComponent, SaveBarComponent],
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
          @if (!product.id.startsWith('P-NEW-')) {
            <span class="head-divider" aria-hidden="true"></span>
            <button class="head-icon-btn" (click)="duplicateProduct()" [disabled]="duplicating()" title="Duplicate product">
              <ap-icon name="copy" [size]="14"/>
            </button>
          }
          <span class="head-divider" aria-hidden="true"></span>
          <button class="head-icon-btn" (click)="handleClose()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
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
              <span class="muted small">{{ t('product.fact.linkedMedia') }}</span>
              <span class="strong">{{ linkedMediaCount }} {{ linkedMediaCount === 1 ? t('product.fact.file') : t('product.fact.files') }}</span>
            </div>
            <div class="row" style="justify-content:space-between;">
              <span class="muted small">{{ t('product.fact.id') }}</span>
              <span class="strong mono" style="font-size:11px;">{{ product.id }}</span>
            </div>
          </div>
        </div>

        <!-- ① Section: Image Gallery — visual anchor, first like Shopify -->
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
                    @if (colorLinkedToImage(img); as linkedColor) {
                      <div class="thumb-color-badge">
                        <span class="color-dot" [style.background]="colorHex(linkedColor)"></span>
                        <span>{{ linkedColor }}</span>
                      </div>
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
            <button class="btn btn-outline btn-sm" type="button" (click)="openMediaPicker()">
              <ap-icon name="media" [size]="12"/> Pick from Media
            </button>
            <button class="btn btn-outline btn-sm" type="button" (click)="addImageUrl()">
              <ap-icon name="link" [size]="12"/> {{ t('product.gallery.addUrl') }}
            </button>
          </div>
        </div>

        <!-- ② Section: Basics — title + identity fields -->
        <div class="section-title">
          <ap-icon name="catalog" [size]="14"/>
          <span>{{ t('product.section.basics') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.name') }}</label>
          <input class="inp mb-8" [ngModel]="form().name" (ngModelChange)="set('name', $event)"/>
          <label class="lbl">{{ t('product.field.nameAr') }}</label>
          <input class="inp mb-16" dir="auto" [placeholder]="t('product.field.nameAr.placeholder')" [ngModel]="form().nameAr" (ngModelChange)="set('nameAr', $event)"/>

          <div class="grid-2">
            <div>
              <label class="lbl">{{ t('product.field.brand') }}</label>
              <input class="inp" [ngModel]="form().brand" (ngModelChange)="set('brand', $event)"/>
            </div>
            <div>
              <label class="lbl">{{ t('product.field.sku') }}</label>
              <input class="inp mono" [ngModel]="form().sku" (ngModelChange)="set('sku', $event)"/>
            </div>
          </div>
        </div>

        <!-- ③ Section: Pricing & Stock -->
        <div class="section-title">
          <ap-icon name="chart" [size]="14"/>
          <span>{{ t('product.section.pricing') }}</span>
        </div>

        <div class="mb-24">
          <div class="grid-2">
            <div>
              <label class="lbl">{{ t('product.field.price') }} (QAR)</label>
              <input class="inp mono" type="number" min="0" [ngModel]="form().price" (ngModelChange)="setNum('price', $event)"/>
            </div>
            <div>
              <label class="lbl">{{ t('product.field.stock') }}</label>
              @if (hasVariants()) {
                <div class="inp" style="background:var(--bg);cursor:default;color:var(--ink-2);">{{ variantsTotalStock() }}</div>
                <div class="muted small mt-8">{{ t('product.field.stock.fromVariants') }}</div>
              } @else {
                <input class="inp" type="number" min="0" [ngModel]="form().stock" (ngModelChange)="setNum('stock', $event)"/>
                @if (form().stock === 0) {
                  <div class="muted small mt-8" style="color:var(--danger);">{{ t('product.field.stock.out') }}</div>
                } @else if (form().stock < 8) {
                  <div class="muted small mt-8" style="color:var(--warning);">{{ t('product.field.stock.low') }}</div>
                }
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

        <div class="mb-24" style="position:relative;">
          @if (form().variants.length === 0) {
            <div class="variants-empty">
              <div class="strong">{{ t('product.variants.empty.title') }}</div>
              <div class="muted small mt-8">{{ t('product.variants.empty.sub') }}</div>
              <button class="btn btn-outline btn-sm mt-16" (click)="addVariant()">
                <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
              </button>
            </div>
          } @else {
            <!-- Transparent backdrop to close image picker on outside click -->
            @if (variantPickerOpenId()) {
              <div class="vc-backdrop" (click)="closeVariantPicker()"></div>
            }
            <div class="variants-cards">
              <!-- Column headers: Photo | Color | Size | Stock | Price | SKU | Actions -->
              <div class="vc-header">
                <span>{{ t('product.gallery.primary') }}</span>
                <span>{{ t('product.variants.col.color') }}</span>
                <span>{{ t('product.variants.col.size') }}</span>
                <span>{{ t('product.variants.col.stock') }}</span>
                <span>{{ t('product.variants.col.price') }}</span>
                <span>{{ t('product.variants.col.sku') }}</span>
                <span></span>
              </div>

              @for (v of form().variants; track v.id; let i = $index) {
                <div class="vc" [class.vc-expanded]="expandedVariants().has(v.id)" [class.vc-no-id]="!v.color && !v.size">

                  <!-- Compact row: always visible -->
                  <div class="vc-row">

                    <!-- ① Photo — image linked to this color variant -->
                    <div class="vc-cell vc-cell--img">
                      <div class="vc-img-cell"
                           [class.has-img]="!!imageForColor(v.color)"
                           [class.no-color]="!v.color"
                           [attr.title]="v.color ? ('Link photo · ' + v.color) : 'Set a color first to link a photo'"
                           (click)="v.color ? toggleVariantPicker(v.id) : null">
                        @if (imageForColor(v.color); as linkedImg) {
                          <img class="vc-img-thumb" [src]="linkedImg" [alt]="v.color"/>
                          <span class="vc-img-edit-icon"><ap-icon name="edit" [size]="10"/></span>
                        } @else {
                          <span class="vc-img-placeholder">
                            <ap-icon name="media" [size]="14"/>
                          </span>
                        }
                      </div>
                      <!-- Image picker popover -->
                      @if (variantPickerOpenId() === v.id) {
                        <div class="vc-img-picker" (click)="$event.stopPropagation()">
                          <div class="vc-img-picker-head">
                            Link photo for <strong>{{ v.color }}</strong>
                            <button class="vc-img-picker-close" type="button" (click)="closeVariantPicker()">✕</button>
                          </div>
                          @if (form().images.length === 0) {
                            <p class="vc-img-picker-empty">Upload gallery images first</p>
                          } @else {
                            <div class="vc-img-picker-grid">
                              <button class="vc-img-opt vc-img-opt--none" type="button" [class.is-sel]="!imageForColor(v.color)"
                                      (click)="setColorImage(v.color, ''); closeVariantPicker()">
                                <span class="vc-img-none-label">None</span>
                              </button>
                              @for (img of form().images; track img) {
                                <button class="vc-img-opt" type="button"
                                        [class.is-sel]="imageForColor(v.color) === img"
                                        (click)="setColorImage(v.color, img); closeVariantPicker()">
                                  <img [src]="img" [alt]="''"/>
                                </button>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>

                    <!-- ② Color — swatch + select -->
                    <div class="vc-cell vc-cell--color">
                      @if (refColors().length > 0) {
                        <div class="color-select-wrap">
                          <span class="color-dot" [style.background]="colorHex(v.color)"></span>
                          <select class="inp inp-sm color-select" [ngModel]="v.color" (ngModelChange)="updateVariant(i, { color: $event })">
                            <option value="">—</option>
                            @for (c of refColors(); track c.id) {
                              <option [value]="c.name_en">{{ c.name_en }}</option>
                            }
                          </select>
                        </div>
                      } @else {
                        <input class="inp inp-sm" [placeholder]="'—'" [ngModel]="v.color" (ngModelChange)="updateVariant(i, { color: $event })"/>
                      }
                    </div>

                    <!-- ③ Size — text input with datalist -->
                    <div class="vc-cell vc-cell--size">
                      <input class="inp inp-sm vc-size-inp" list="size-options"
                             [placeholder]="'—'"
                             [ngModel]="v.size" (ngModelChange)="updateVariant(i, { size: $event })"/>
                    </div>

                    <!-- ④ Stock — with live out/low-stock colouring -->
                    <div class="vc-cell vc-cell--num">
                      <input class="inp inp-sm mono vc-stock-inp"
                             [class.stock-out]="v.stock === 0"
                             [class.stock-low]="v.stock > 0 && v.stock < 5"
                             type="number" min="0"
                             [ngModel]="v.stock" (ngModelChange)="updateVariant(i, { stock: +$event || 0 })"/>
                    </div>

                    <!-- ⑤ Price — QAR prefixed -->
                    <div class="vc-cell vc-cell--num vc-cell--price">
                      <div class="vc-price-wrap">
                        <span class="vc-price-pfx">QAR</span>
                        <input class="inp inp-sm mono" type="number" min="0"
                               [ngModel]="v.price" (ngModelChange)="updateVariant(i, { price: +$event || 0 })"/>
                      </div>
                    </div>

                    <!-- ⑥ SKU — always visible (warehouse / POS reference) -->
                    <div class="vc-cell vc-cell--sku">
                      <input class="inp inp-sm mono" [placeholder]="'SKU'"
                             [ngModel]="v.sku" (ngModelChange)="updateVariant(i, { sku: $event })"/>
                    </div>

                    <!-- Actions: expand (Material + Cost inside) + delete -->
                    <div class="vc-cell vc-cell--actions">
                      <button class="vt-expand" type="button"
                              [class.is-open]="expandedVariants().has(v.id)"
                              (click)="toggleVariantExpand(v.id)"
                              [attr.title]="expandedVariants().has(v.id) ? 'Collapse' : 'Material · Cost · Margin'">
                        <ap-icon name="arrowDn" [size]="12"/>
                      </button>
                      <button class="vt-remove" type="button" (click)="removeVariant(i)" [attr.aria-label]="t('common.remove')">
                        <ap-icon name="trash" [size]="12"/>
                      </button>
                    </div>
                  </div>

                  <!-- Validation hint -->
                  @if (!v.color && !v.size) {
                    <div class="vc-hint">Add a color or size so this variant can be distinguished</div>
                  }

                  <!-- Expandable detail: Material | Cost | Margin (calculated) -->
                  @if (expandedVariants().has(v.id)) {
                    <div class="vc-detail">
                      <div class="vc-field">
                        <label class="vc-lbl">{{ t('product.variants.col.material') }}</label>
                        @if (refMaterials().length > 0) {
                          <select class="inp inp-sm" [ngModel]="v.material" (ngModelChange)="updateVariant(i, { material: $event })">
                            <option value="">—</option>
                            @for (m of refMaterials(); track m.id) {
                              <option [value]="m.name_en">{{ m.name_en }}</option>
                            }
                          </select>
                        } @else {
                          <input class="inp inp-sm" [placeholder]="t('product.variants.placeholder.material')"
                                 [ngModel]="v.material" (ngModelChange)="updateVariant(i, { material: $event })"/>
                        }
                      </div>
                      <div class="vc-field">
                        <label class="vc-lbl">{{ t('product.variants.col.cost') }} (QAR)</label>
                        <input class="inp inp-sm mono" type="number" min="0" step="0.01" [placeholder]="'—'"
                               [ngModel]="v.costPrice ?? null"
                               (ngModelChange)="updateVariant(i, { costPrice: $event !== null && $event !== '' ? +$event : undefined })"/>
                      </div>
                      <div class="vc-field vc-field--margin">
                        <label class="vc-lbl">{{ t('product.variants.col.margin') }}</label>
                        @if (variantMargin(v); as m) {
                          <span class="margin-pill" [class.margin-green]="m >= 40" [class.margin-amber]="m >= 20 && m < 40" [class.margin-red]="m < 20">{{ m }}%</span>
                        } @else {
                          <span class="margin-dash muted small">— set cost to calculate</span>
                        }
                      </div>
                    </div>
                  }

                </div>
              }

              <!-- Size datalist for free-text with suggestions -->
              <datalist id="size-options">
                @for (ss of refSizeSets(); track ss.id) {
                  @for (sz of ss.sizes; track sz) { <option [value]="sz">{{ sz }}</option> }
                }
              </datalist>

              <div class="vt-foot">
                <div class="muted small" style="display:flex;gap:16px;flex-wrap:wrap;">
                  @if (variantsPriceRange()) {
                    <span>{{ t('product.variants.priceRange') }}: <span class="strong mono">{{ variantsPriceRange() }}</span></span>
                  }
                  @if (avgMargin() !== null) {
                    <span>{{ t('product.variants.avgMargin') }}: <span class="strong mono">{{ avgMargin() }}%</span></span>
                  }
                </div>
                <div class="row gap-sm" style="flex-wrap:wrap;">
                  @if (refSizeSets().length > 0) {
                    <div class="gen-sizes-wrap">
                      <select class="inp inp-sm" #sizeSetSel style="font-size:11px;">
                        <option value="">Generate sizes…</option>
                        @for (ss of refSizeSets(); track ss.id) {
                          <option [value]="ss.id">{{ ss.name }}</option>
                        }
                      </select>
                      <button class="btn btn-outline btn-sm" [disabled]="!sizeSetSel.value"
                              (click)="generateSizes(sizeSetSel.value); sizeSetSel.value=''">
                        <ap-icon name="wand" [size]="12"/> Go
                      </button>
                    </div>
                  }
                  <button class="btn btn-outline btn-sm" (click)="addVariant()">
                    <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
                  </button>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- ⑤ Section: Description —rich content after key commerce fields -->
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

        <!-- ⑥ Section: Organization — collections & related products -->
        <div class="section-title">
          <ap-icon name="list" [size]="14"/>
          <span>{{ t('product.section.organization') }}</span>
        </div>

        <div class="mb-24">
          <div class="mb-16">
            <label class="lbl">{{ t('nav.collections') }}</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
              @for (c of collections; track c.id) {
                <label class="row gap-sm" style="align-items:center;background:var(--bg-2);padding:6px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--border-2);transition:0.12s;" [style.border-color]="form().collectionIds.includes(c.id) ? 'var(--gold)' : ''" [style.background]="form().collectionIds.includes(c.id) ? 'var(--gold-3)' : ''">
                  <input type="checkbox" [checked]="form().collectionIds.includes(c.id)" (change)="toggleCollection(c.id)" style="margin:0;"/>
                  <span class="small">{{ c.title }}</span>
                </label>
              }
            </div>
          </div>

          <div>
            <label class="lbl">{{ t('product.related.label') }}</label>
            <div class="muted small mb-8">{{ t('product.related.sub') }}</div>
            <div class="related-picker">
              @for (p of relatedOptions(); track p.id) {
                <button
                  type="button"
                  class="related-option"
                  [class.selected]="form().relatedProductIds.includes(p.id)"
                  (click)="toggleRelatedProduct(p.id)"
                >
                  <span class="related-thumb">
                    @if (productThumb(p)) {
                      <img [src]="productThumb(p)" [alt]="p.name" (error)="onImgError($event)" />
                    }
                  </span>
                  <span class="related-copy">
                    <strong>{{ p.name }}</strong>
                    <small>{{ p.sku }} · QAR {{ p.price.toLocaleString() }}</small>
                  </span>
                  <span class="related-check">{{ form().relatedProductIds.includes(p.id) ? '✓' : '+' }}</span>
                </button>
              }
            </div>
          </div>
        </div>

        <!-- ⑦ Section: SEO -->
        <div class="section-title">
          <ap-icon name="search" [size]="14"/>
          <span>{{ t('product.section.seo') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('product.field.metaTitle') }}</label>
          <input class="inp mb-16" [ngModel]="form().metaTitle" (ngModelChange)="set('metaTitle', $event)"/>
          <label class="lbl">{{ t('product.field.metaDesc') }}</label>
          <div class="meta-desc-wrap mb-16">
            <textarea class="inp" rows="3" [ngModel]="form().metaDesc" (ngModelChange)="set('metaDesc', $event)" maxlength="160" style="resize:vertical;"></textarea>
            <div class="char-counter" [class.over]="form().metaDesc.length > 160">{{ form().metaDesc.length }}/160</div>
          </div>
          <label class="lbl">{{ t('product.field.slug') }}</label>
          <input class="inp mono" [ngModel]="form().slug" (ngModelChange)="set('slug', $event)" [class.inp-invalid]="slugError()"/>
          @if (slugError()) {
            <div class="field-error mt-6">Lowercase letters, numbers, and hyphens only (e.g. my-product-name)</div>
          }
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
              <span class="strong">{{ product.stock }}</span>
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

    <!-- ── Media Picker Modal ── -->
    @if (mediaPicker()) {
      <div class="overlay" style="z-index:260;" (click)="mediaPicker.set(false)"></div>
      <div class="media-pick-panel" style="z-index:270;">
        <div class="mpp-head">
          <div>
            <p class="mpp-eyebrow">Media Library</p>
            <div class="card-title">Select images to add</div>
          </div>
          <button class="x-btn" type="button" (click)="mediaPicker.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="mpp-search">
          <ap-icon name="search" [size]="13"/>
          <input class="inp" placeholder="Search by filename…"
                 [ngModel]="mediaSearch()" (ngModelChange)="mediaSearch.set($event)"/>
        </div>
        <div class="mpp-body">
          @if (mediaLoading()) {
            <div class="mpp-state"><ap-spinner [size]="20"/> Loading media…</div>
          } @else if (filteredMediaFiles().length === 0) {
            <div class="mpp-state">No images found in your media library.</div>
          } @else {
            <div class="mpp-grid">
              @for (f of filteredMediaFiles(); track f.id) {
                <button type="button" class="mpp-item"
                        [class.picked]="mediaSelected().has(f.preview || '')"
                        (click)="toggleMediaSelect(f.preview || '')">
                  <img [src]="f.preview" [alt]="f.name"/>
                  @if (mediaSelected().has(f.preview || '')) {
                    <div class="mpp-check"><ap-icon name="check" [size]="12"/></div>
                  }
                  <span class="mpp-name">{{ f.name }}</span>
                </button>
              }
            </div>
          }
        </div>
        <div class="drawer-foot">
          <span class="muted small">{{ mediaSelected().size }} selected</span>
          <div class="row gap-sm">
            <button class="btn btn-outline" type="button" (click)="mediaPicker.set(false)">Cancel</button>
            <button class="btn btn-primary" type="button" [disabled]="mediaSelected().size === 0" (click)="applyMediaSelection()">
              Add {{ mediaSelected().size > 0 ? mediaSelected().size : '' }} Image{{ mediaSelected().size !== 1 ? 's' : '' }}
            </button>
          </div>
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

    /* SEO meta desc + slug validation */
    .meta-desc-wrap { position: relative; }
    .char-counter { font-size: 11px; color: var(--muted); text-align: right; margin-top: 4px; }
    .char-counter.over { color: var(--danger); font-weight: 600; }
    .field-error { font-size: 12px; color: var(--danger); margin-top: 4px; }
    .inp-invalid { border-color: var(--danger) !important; }

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



    /* ── Media Picker Panel ── */
    .media-pick-panel {
      position: fixed;
      inset-inline-end: 0;
      top: 0;
      bottom: 0;
      width: min(540px, 100vw);
      background: var(--surface);
      border-inline-start: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      box-shadow: -8px 0 32px rgba(0,0,0,.2);
    }
    .mpp-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 12px;
      border-bottom: 1px solid var(--border-2);
    }
    .mpp-eyebrow {
      margin: 0 0 4px;
      color: var(--gold);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .mpp-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-2);
      background: var(--bg);
    }
    .mpp-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .mpp-search .inp { border: none; background: transparent; flex: 1; padding: 0; }
    .mpp-search .inp:focus { outline: none; box-shadow: none; }
    .mpp-body { flex: 1; overflow-y: auto; padding: 14px; }
    .mpp-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }
    .mpp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 10px;
    }
    .mpp-item {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 5px;
      border: 2px solid transparent;
      border-radius: 10px;
      background: var(--bg);
      padding: 0;
      cursor: pointer;
      overflow: hidden;
      transition: border-color .13s, transform .13s;
    }
    .mpp-item:hover { border-color: var(--border); transform: scale(1.02); }
    .mpp-item.picked { border-color: var(--gold); }
    .mpp-item img { width: 100%; height: 110px; object-fit: cover; display: block; }
    .mpp-check {
      position: absolute;
      top: 6px;
      inset-inline-end: 6px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--gold);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(0,0,0,.3);
    }
    .mpp-name {
      padding: 0 8px 8px;
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
    /* Read-only color badge on gallery thumbnails (color is now managed from Variants) */
    .thumb-color-badge {
      position: absolute;
      bottom: 6px;
      inset-inline: 6px;
      display: flex; align-items: center; gap: 5px;
      background: rgba(255,255,255,0.94);
      backdrop-filter: blur(4px);
      border-radius: 6px;
      padding: 3px 7px;
      font-size: 10px;
      font-weight: 600;
      color: var(--ink);
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      pointer-events: none;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .thumb-color-badge .color-dot { width: 10px; height: 10px; flex-shrink: 0; }
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

    /* ── Variant cards ─────────────────────────────────── */
    .variants-cards {
      border: 1px solid var(--border-2);
      border-radius: 10px;
      /* No overflow:hidden — popover must escape the container */
      background: #fff;
    }
    .variants-cards > .vc-header { border-radius: 10px 10px 0 0; }
    .variants-cards > .vc:last-of-type { border-radius: 0 0 10px 10px; }

    /* Grid: Photo | Color | Size | Stock | Price | SKU | Actions
       Rationale:
         - Photo 44px   : thumbnail, fixed
         - Color 130px+ : swatch + select, needs room for color name
         - Size  60px   : short (42, XL) — narrower than other fields
         - Stock 68px   : number only, inline status colour
         - Price 96px   : "QAR" prefix + number
         - SKU   100px+ : monospace, variable length (critical for ops)
         - Actions 54px : expand + delete                              */
    .vc-header,
    .vc-row {
      grid-template-columns: 44px minmax(120px,1.7fr) 60px 68px 96px minmax(100px,1.3fr) 54px;
    }

    /* Column header row */
    .vc-header {
      display: grid;
      gap: 8px;
      padding: 6px 14px;
      background: var(--bg);
      border-bottom: 1px solid var(--border-2);
    }
    .vc-header span {
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--muted);
    }
    .vc-header span:first-child { text-align: center; }

    /* Each variant wrapper */
    .vc {
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-2);
      display: flex; flex-direction: column; gap: 0;
      transition: background 0.12s;
    }
    .vc:last-of-type { border-bottom: none; }
    .vc.vc-no-id { background: rgba(251,191,36,0.04); }
    .vc.vc-expanded { background: var(--bg); }

    /* Compact row: all primary fields in one line */
    .vc-row {
      display: grid;
      gap: 8px;
      align-items: center;
      min-height: 46px;
    }

    /* Generic cell */
    .vc-cell { display: flex; align-items: center; min-width: 0; }
    .vc-cell--actions { gap: 4px; justify-content: flex-end; }

    /* Size — centred mono text for numeric values (38, 42, XL…) */
    .vc-size-inp { text-align: center; }

    /* Stock — live status colouring */
    .vc-stock-inp { text-align: center; transition: border-color 0.15s, background 0.15s, color 0.15s; }
    .vc-stock-inp.stock-out {
      border-color: var(--danger) !important;
      background: rgba(239,68,68,0.05);
      color: var(--danger);
      font-weight: 600;
    }
    .vc-stock-inp.stock-low { border-color: var(--warning, #d97706) !important; }

    /* Price — "QAR" prefix inside the input */
    .vc-cell--price { flex-direction: column; }
    .vc-price-wrap { position: relative; width: 100%; display: flex; align-items: center; }
    .vc-price-pfx {
      position: absolute; left: 7px;
      font-size: 8px; font-weight: 800;
      color: var(--muted); pointer-events: none;
      letter-spacing: 0.05em; text-transform: uppercase;
      line-height: 1;
    }
    .vc-price-wrap .inp { padding-left: 30px; width: 100%; }

    /* SKU — monospace, always visible (warehouse / POS reference) */
    .vc-cell--sku { min-width: 0; }
    .vc-cell--sku .inp { font-family: var(--ff-mono, monospace); font-size: 12px; }

    /* Image link cell — first column, centered */
    .vc-cell--img { justify-content: center; position: relative; }
    .vc-img-cell {
      position: relative;
      width: 40px; height: 40px;
      border-radius: 8px;
      cursor: pointer;
      border: 1.5px dashed var(--border);
      display: flex; align-items: center; justify-content: center;
      background: var(--bg);
      transition: border-color 0.15s, background 0.15s;
      flex-shrink: 0;
      overflow: hidden;
    }
    .vc-img-cell:hover:not(.no-color) { border-color: var(--gold); background: var(--gold-3); }
    .vc-img-cell.has-img { border-style: solid; border-color: var(--gold); }
    .vc-img-cell.no-color { cursor: not-allowed; opacity: 0.35; }
    .vc-img-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
    .vc-img-edit-icon {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4);
      color: #fff;
      opacity: 0;
      transition: opacity 0.12s;
    }
    .vc-img-cell:hover:not(.no-color) .vc-img-edit-icon { opacity: 1; }
    .vc-img-placeholder { color: var(--muted); display: flex; }

    /* Image picker popover — opens to the right of the photo cell */
    .vc-img-picker {
      position: absolute;
      top: 0;
      left: calc(100% + 10px);
      z-index: 300;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08);
      min-width: 224px;
      max-width: 280px;
    }
    .vc-img-picker-head {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 11px; color: var(--muted);
      margin-bottom: 10px; padding-bottom: 8px;
      border-bottom: 1px solid var(--border-2);
    }
    .vc-img-picker-head strong { color: var(--ink); }
    .vc-img-picker-close {
      width: 20px; height: 20px;
      border: none; background: none; cursor: pointer;
      color: var(--muted); font-size: 11px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 4px;
      transition: color 0.12s, background 0.12s;
    }
    .vc-img-picker-close:hover { color: var(--ink); background: var(--bg); }
    .vc-img-picker-empty {
      font-size: 12px; color: var(--muted);
      text-align: center; padding: 8px 0 4px; margin: 0;
    }
    .vc-img-picker-grid {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .vc-img-opt {
      width: 56px; height: 56px;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid var(--border-2);
      cursor: pointer;
      padding: 0;
      background: var(--bg);
      display: flex; align-items: center; justify-content: center;
      transition: border-color 0.12s, transform 0.1s, box-shadow 0.12s;
    }
    .vc-img-opt img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .vc-img-opt.is-sel {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(193,154,91,0.2);
    }
    .vc-img-opt:hover:not(.is-sel) { border-color: var(--ink-2); transform: scale(1.05); }
    .vc-img-opt--none { border-style: dashed; }
    .vc-img-none-label {
      font-size: 9px; font-weight: 700;
      color: var(--muted); text-align: center;
      line-height: 1.3; text-transform: uppercase; letter-spacing: 0.04em;
    }

    /* Transparent backdrop to catch outside clicks */
    .vc-backdrop {
      position: fixed;
      inset: 0;
      z-index: 299;
      background: transparent;
    }

    /* Validation hint */
    .vc-hint {
      font-size: 11px; color: var(--warning, #d97706);
      padding: 4px 0 6px;
      display: flex; align-items: center; gap: 5px;
    }

    /* Expandable detail: Material | Cost | Margin (3 equal columns) */
    .vc-detail {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr;
      gap: 10px;
      padding: 10px 0 4px;
      border-top: 1px dashed var(--border-2);
      margin-top: 8px;
      animation: vc-reveal 0.14s ease-out;
    }
    /* Margin field inside detail: label + pill stacked */
    .vc-field--margin { flex-direction: column; align-items: flex-start; gap: 5px; }
    @keyframes vc-reveal {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Shared field wrapper (for detail row) */
    .vc-field { display: flex; flex-direction: column; gap: 4px; }
    .vc-lbl {
      font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--muted);
    }

    /* Expand button */
    .vt-expand {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.12s;
      flex-shrink: 0;
    }
    .vt-expand ap-icon { transition: transform 0.18s ease; display: flex; }
    .vt-expand.is-open ap-icon { transform: rotate(180deg); }
    .vt-expand:hover { color: var(--gold); border-color: rgba(193,154,91,0.3); background: var(--gold-3); }

    .vt-remove {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.12s;
      flex-shrink: 0;
    }
    .vt-remove:hover {
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.3);
      background: rgba(239, 68, 68, 0.06);
    }

    .margin-pill {
      display: inline-block;
      font-size: 11px; font-weight: 600;
      padding: 3px 8px; border-radius: 99px;
    }
    .margin-green { background: #d1fae5; color: #065f46; }
    .margin-amber { background: #fef3c7; color: #92400e; }
    .margin-red   { background: #fee2e2; color: #991b1b; }
    .margin-dash  { color: var(--muted); }

    /* Footer: summary + add button */
    .vt-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: var(--bg);
      border-top: 1px solid var(--border-2);
      gap: 12px;
      flex-wrap: wrap;
    }

    /* Color swatch select */
    .color-select-wrap {
      display: flex; align-items: center; gap: 6px; width: 100%;
    }
    .color-dot {
      width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.15);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.3);
      transition: background 0.12s;
    }
    .color-select { flex: 1; min-width: 0; }

    /* Generate sizes row */
    .gen-sizes-wrap { display: flex; gap: 4px; align-items: center; }

    /* Responsive: stack on narrow screens */
    @media (max-width: 600px) {
      .vc-header { display: none; }
      .vc-header,
      .vc-row {
        grid-template-columns: 40px 1fr 52px 52px 44px;
        grid-template-rows: auto auto;
      }
      .vc-cell--img   { grid-column: 1; grid-row: 1 / 3; align-self: center; }
      .vc-cell--color { grid-column: 2 / 5; grid-row: 1; }
      .vc-cell--size  { grid-column: 2; grid-row: 2; }
      .vc-cell--num   { grid-column: 3; grid-row: 2; }
      .vc-cell--price { grid-column: 4; grid-row: 2; }
      .vc-cell--sku   { display: none; }
      .vc-cell--actions { grid-column: 5; grid-row: 1 / 3; align-self: center; flex-direction: column; }
      .vc-detail { grid-template-columns: 1fr 1fr; }
      .vc-field--margin { display: none; }
    }
    .related-picker {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      max-height: 250px;
      overflow: auto;
      padding: 2px;
    }
    .related-option {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 24px;
      align-items: center;
      gap: 10px;
      min-height: 58px;
      padding: 7px;
      border: 1px solid var(--border-2);
      border-radius: 8px;
      background: var(--bg);
      color: var(--ink);
      cursor: pointer;
      text-align: start;
      transition: border-color 0.14s, background 0.14s;
    }
    .related-option:hover,
    .related-option.selected {
      border-color: var(--gold);
      background: var(--gold-3);
    }
    .related-thumb {
      width: 42px;
      height: 42px;
      overflow: hidden;
      border-radius: 6px;
      background: var(--bg-2);
    }
    .related-thumb img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
    .related-copy {
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .related-copy strong,
    .related-copy small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .related-copy strong { font-size: 12px; }
    .related-copy small { color: var(--muted); font-size: 10px; }
    .related-check {
      display: inline-grid;
      width: 22px;
      height: 22px;
      place-items: center;
      border-radius: 999px;
      background: #fff;
      color: var(--green);
      font-weight: 800;
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
  @Input() collections: Collection[] = [];

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
  /** Emitted when a duplicate is created — carries the new product so the parent can add it. */
  @Output() duplicated = new EventEmitter<Product>();

  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly productsApi = inject(AdminProductsService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  private readonly refApi = inject(AdminRefService);
  private readonly uploads = inject(MediaUploadService);
  private readonly mediaApi = inject(AdminMediaService);
  private readonly storage = inject(StorageService);

  readonly refColors   = signal<RefColor[]>([]);
  readonly refMaterials = signal<RefMaterial[]>([]);
  readonly refSizeSets  = signal<RefSizeSet[]>([]);

  readonly t = (k: string): string => this.i18n.t(k);

  /** Initial form snapshot — re-set whenever `currentId` changes. */
  private readonly initial = signal<FormShape>(this.makeEmptyForm());
  readonly form = signal<FormShape>(this.makeEmptyForm());
  readonly draftRestoredAt = signal<string | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);

  // ── Media picker ──────────────────────────────────────────────────────────
  readonly mediaPicker = signal(false);
  readonly mediaFiles = signal<import('../../models').MediaFile[]>([]);
  readonly mediaLoading = signal(false);
  readonly mediaSearch = signal('');
  readonly mediaSelected = signal(new Set<string>());

  readonly filteredMediaFiles = computed(() => {
    const s = this.mediaSearch().toLowerCase();
    return this.mediaFiles().filter(f =>
      f.kind === 'image' && (!s || f.name.toLowerCase().includes(s)),
    );
  });
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

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial()));

  readonly slugError = computed(() => {
    const s = this.form().slug;
    return !!s && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
  });

  readonly duplicating = signal(false);
  readonly expandedVariants = signal(new Set<string>());
  readonly variantPickerOpenId = signal<string | null>(null);

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
    return this.form().images.length;
  }

  get draftBase(): string { return 'draft:' + this._currentId(); }

  ngOnInit(): void {
    if (!this.initial()) this.resetForCurrent();
    // Load reference lists in the background — non-blocking
    Promise.all([
      this.refApi.getColors(),
      this.refApi.getMaterials(),
      this.refApi.getSizeSets(),
    ]).then(([colors, materials, sizes]) => {
      this.refColors.set(colors);
      this.refMaterials.set(materials);
      this.refSizeSets.set(sizes);
    }).catch(() => { /* silently degrade to free-text inputs */ });
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

    this.initial.set(this.makeFormFromProduct(p));
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
    this.lastSavedAt.set(null);
    this.draftRestoredAt.set(null);
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);

    // Try to restore a draft for this product
    try {
      const raw = this.storage.get(this.draftBase);
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
      name: '', nameAr: '', sku: '', brand: '', collectionIds: [],
      price: 0, stock: 0, hidden: false,
      enDesc: '', arDesc: '',
      metaTitle: '', metaDesc: '', slug: '',
      variants: [],
      images: [],
      imageColors: {},
      relatedProductIds: [],
    };
  }

  private makeFormFromProduct(p: Product): FormShape {
    return {
      name: p.name,
      nameAr: p.nameAr || '',
      sku: p.sku,
      brand: p.brand,
      collectionIds: this.collections.filter(c => c.productIds.includes(p.id)).map(c => c.id),
      price: p.price,
      stock: p.stock,
      hidden: p.hidden,
      enDesc: 'Hand-stitched in our Doha atelier from full-grain camel leather. Each pair takes 48 hours of single-artisan attention. Limited to 40 pairs per season.',
      arDesc: 'مصنوع يدويًا في ورشتنا في الدوحة من جلد الجمل الكامل الحبيبات. كل زوج يستغرق 48 ساعة من الاهتمام الحرفي الواحد. محدود بـ 40 زوجًا في الموسم.',
      metaTitle: p.metaTitle || `${p.name} · ${p.brand} · Elite Collection`,
      metaDesc: p.metaDesc || `Buy the ${p.name} from our Doha atelier. Hand-crafted leather. Free shipping in Qatar.`,
      slug: p.slug || p.name.toLowerCase().replace(/\s+/g, '-'),
      variants: (p.variants ?? []).map(v => ({ ...v })),
      images: p.images && p.images.length > 0 ? [...p.images] : (p.image ? [p.image] : []),
      imageColors: { ...(p.imageColors ?? {}) },
      relatedProductIds: [...(p.relatedProductIds ?? [])],
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

  async openMediaPicker(): Promise<void> {
    this.mediaSelected.set(new Set());
    this.mediaSearch.set('');
    this.mediaPicker.set(true);
    if (this.mediaFiles().length === 0) {
      this.mediaLoading.set(true);
      try {
        const files = await this.mediaApi.list();
        this.mediaFiles.set(files);
      } catch {
        this.toast.error('Could not load media library');
      } finally {
        this.mediaLoading.set(false);
      }
    }
  }

  toggleMediaSelect(preview: string): void {
    this.mediaSelected.update(set => {
      const next = new Set(set);
      next.has(preview) ? next.delete(preview) : next.add(preview);
      return next;
    });
  }

  applyMediaSelection(): void {
    const selected = [...this.mediaSelected()];
    if (selected.length === 0) return;
    const existing = new Set(this.form().images);
    const toAdd = selected.filter(u => !existing.has(u));
    if (toAdd.length > 0) {
      this.set('images', [...this.form().images, ...toAdd]);
    }
    this.mediaPicker.set(false);
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
                const imageColors = this.pruneImageColors(this.form().imageColors, result.images);
                this.set('imageColors', imageColors);
                this.initial.set({ ...this.initial(), images: [...result.images], imageColors: { ...imageColors } });
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
    const images = this.form().images.filter((_, i) => i !== index);
    this.set('images', images);
    this.set('imageColors', this.pruneImageColors(this.form().imageColors, images));
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

  imageColor(img: string): string {
    return this.form().imageColors[img] || '';
  }

  imageColorOptions(): string[] {
    const variantColors = this.compact(this.form().variants.map((variant) => variant.color));
    if (variantColors.length > 0) return variantColors;
    return this.refColors().map((color) => color.name_en).filter(Boolean);
  }

  setImageColor(img: string, color: string): void {
    const next = { ...this.form().imageColors };
    const value = String(color || '').trim();
    if (value) {
      next[img] = value;
    } else {
      delete next[img];
    }
    this.set('imageColors', next);
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

  colorHex(name: string | undefined): string {
    if (!name) return '#e5e7eb';
    return this.refColors().find(c => c.name_en === name)?.hex ?? '#e5e7eb';
  }

  generateSizes(sizeSetId: string): void {
    const ss = this.refSizeSets().find(s => s.id === sizeSetId);
    if (!ss) return;
    const f = this.form();
    const existing = new Set(f.variants.map(v => v.size));
    const toAdd = ss.sizes.filter(sz => !existing.has(sz));
    const newVariants: ProductVariant[] = toAdd.map(sz => ({
      id: 'V-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      sku: f.sku ? `${f.sku}-${sz}` : '',
      size: sz,
      color: '',
      material: '',
      price: f.price || 0,
      stock: 0,
    }));
    if (newVariants.length === 0) {
      this.toast.info('All sizes already added', ss.name);
      return;
    }
    this.set('variants', [...f.variants, ...newVariants]);
    this.toast.success(`${newVariants.length} sizes added`, ss.name);
  }

  readonly hasVariants = computed(() => this.form().variants.length > 0);

  variantMargin(v: ProductVariant): number | null {
    if (v.costPrice == null || !v.price) return null;
    return Math.round(((v.price - v.costPrice) / v.price) * 100);
  }

  readonly avgMargin = computed((): number | null => {
    const margins = this.form().variants
      .map(v => this.variantMargin(v))
      .filter((m): m is number => m !== null);
    if (margins.length === 0) return null;
    return Math.round(margins.reduce((s, m) => s + m, 0) / margins.length);
  });

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

  toggleVariantExpand(id: string): void {
    const s = new Set(this.expandedVariants());
    s.has(id) ? s.delete(id) : s.add(id);
    this.expandedVariants.set(s);
  }

  toggleVariantPicker(id: string): void {
    this.variantPickerOpenId.set(this.variantPickerOpenId() === id ? null : id);
  }

  closeVariantPicker(): void {
    this.variantPickerOpenId.set(null);
  }

  imageForColor(colorName: string): string | null {
    if (!colorName) return null;
    const entry = Object.entries(this.form().imageColors).find(([, c]) => c === colorName);
    return entry ? entry[0] : null;
  }

  setColorImage(colorName: string, imageUrl: string): void {
    const next = Object.fromEntries(
      Object.entries(this.form().imageColors).filter(([, c]) => c !== colorName)
    );
    if (imageUrl) next[imageUrl] = colorName;
    this.set('imageColors', next);
  }

  colorLinkedToImage(imageUrl: string): string | null {
    return this.form().imageColors[imageUrl] || null;
  }

  private pruneImageColors(imageColors: Record<string, string>, images: string[]): Record<string, string> {
    const imageSet = new Set(images);
    return Object.entries(imageColors).reduce<Record<string, string>>((map, [url, color]) => {
      const value = String(color || '').trim();
      if (imageSet.has(url) && value) map[url] = value;
      return map;
    }, {});
  }

  private compact(values: Array<string | undefined | null>): string[] {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
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

  relatedOptions(): Product[] {
    const currentId = this.product?.id;
    return this._products().filter((product) => product.id !== currentId && !product.id.startsWith('P-NEW-'));
  }

  productThumb(product: Product): string {
    return product.images?.[0] || product.image || '';
  }

  toggleRelatedProduct(id: string): void {
    const ids = this.form().relatedProductIds;
    this.set('relatedProductIds', ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  }

  private scheduleAutoSave(): void {
    if (!this.dirty()) {
      this.storage.remove(this.draftBase);
      if (this.saveState() === 'dirty') this.saveState.set('idle');
      return;
    }
    if (this.saveState() === 'idle') this.saveState.set('dirty');
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => {
      this.storage.set(this.draftBase, JSON.stringify({ form: this.form(), savedAt: new Date().toISOString() }));
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
      const previousId = this.product.id;
      const payload = f.variants.length > 0
        ? { ...f, stock: this.variantsTotalStock() }
        : { ...f };
      const saved = this.product.id.startsWith('P-NEW-')
        ? await this.productsApi.saveProduct(payload)
        : await this.productsApi.update(this.product.id, payload);

      this.saveState.set('saved');
      const ts = new Date().toTimeString().slice(0, 5);
      this.lastSavedAt.set(ts);
      this.storage.remove(this.draftBase);
      this.draftRestoredAt.set(null);
      this.initial.set({ ...this.form() });

      await this.syncCollections(previousId, saved.id, this.form().collectionIds);

      // Persist editable fields back on the underlying product so the current
      // catalog reflects the saved API state.
      this.product.id = saved.id;
      this.product.name = saved.name;
      this.product.sku = saved.sku;
      this.product.brand = saved.brand;
      this.product.price = saved.price;
      this.product.stock = saved.stock;
      this.product.hidden = saved.hidden;
      this.product.variants = (saved.variants ?? []).map(v => ({ ...v }));
      this.product.images = [...(saved.images ?? f.images)];
      this.product.imageColors = { ...(saved.imageColors ?? f.imageColors) };
      this.product.relatedProductIds = [...(saved.relatedProductIds ?? f.relatedProductIds)];
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
    this.form.set({ ...this.initial() });
    this.storage.remove(this.draftBase);
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
    this.toast.info(this.t('product.toast.discarded.title'), this.t('product.toast.discarded.sub'));
  }

  discardDraft(): void {
    this.form.set({ ...this.initial() });
    this.storage.remove(this.draftBase);
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
  }

  private async syncCollections(previousProductId: string, savedProductId: string, selectedCollectionIds: string[]): Promise<void> {
    const selected = new Set(selectedCollectionIds);
    const updates = this.collections
      .filter((collection) => !collection.id.startsWith('COL-NEW-'))
      .map(async (collection) => {
        const ids = collection.productIds.filter((id) => id !== previousProductId && id !== savedProductId);
        const shouldInclude = selected.has(collection.id);
        const nextIds = shouldInclude ? [...ids, savedProductId] : ids;
        const wasIncluded = collection.productIds.includes(previousProductId) || collection.productIds.includes(savedProductId);
        if (wasIncluded === shouldInclude && nextIds.length === collection.productIds.length) return;

        const saved = await this.collectionsApi.update(collection.id, { productIds: nextIds });
        collection.productIds = [...saved.productIds];
      });

    await Promise.all(updates);
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

  async duplicateProduct(): Promise<void> {
    if (this.duplicating()) return;
    this.duplicating.set(true);
    try {
      const copy = await this.productsApi.duplicate(this.product.id);
      this.toast.success('Product duplicated', copy.sku);
      this.duplicated.emit(copy);
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.duplicating.set(false);
    }
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
