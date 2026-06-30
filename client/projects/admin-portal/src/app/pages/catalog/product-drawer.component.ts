import {
  Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output,
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
            class="head-icon-btn nav-prev"
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
            class="head-icon-btn nav-next"
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
              <ap-icon name="media" [size]="12"/> {{ t('product.gallery.pickFromMedia') }}
            </button>
            <button class="btn btn-outline btn-sm" type="button" (click)="addImageUrl()">
              <ap-icon name="link" [size]="12"/> {{ t('product.gallery.addUrl') }}
            </button>
          </div>
        </div>

        <!-- ② Section: Basics — title + identity fields -->
        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
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
        <div class="section-title" [class.sec-collapsed]="isMobile() && !openSections().has('pricing')" (click)="toggleSection('pricing')">
          <ap-icon name="chart" [size]="14"/>
          <span>{{ t('product.section.pricing') }}</span>
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('pricing')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div class="mb-24" [style.display]="isMobile() && !openSections().has('pricing') ? 'none' : ''"  >
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
        <div class="section-title" [class.sec-collapsed]="isMobile() && !openSections().has('variants')" (click)="toggleSection('variants')">
          <ap-icon name="grid" [size]="14"/>
          <span>{{ t('product.section.variants') }}</span>
          @if (form().variants.length > 0) {
            <span class="muted small" style="font-weight:400;margin-inline-start:auto;">{{ variantsSummary() }} · {{ variantsTotalStock() }} {{ t('product.field.stock') }}</span>
          }
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('variants')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div class="mb-24" style="position:relative;" [style.display]="isMobile() && !openSections().has('variants') ? 'none' : ''"  >
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
              <datalist id="size-options">
                @for (ss of refSizeSets(); track ss.id) {
                  @for (sz of ss.sizes; track sz) { <option [value]="sz">{{ sz }}</option> }
                }
              </datalist>

              <!-- ══ Color groups accordion ══ -->
              @for (group of colorGroups(); track group.colorKey) {
                <div class="vcg" [class.vcg--open]="expandedGroups().has(group.colorKey)">

                  <!-- Group header row -->
                  <div class="vcg-head" (click)="toggleGroup(group.colorKey)">
                    <!-- Expand chevron -->
                    <ap-icon name="arrowDn" [size]="11" class="vcg-chev"
                             [class.open]="expandedGroups().has(group.colorKey)"/>

                    <!-- Color swatch (updates live as selector changes) -->
                    @if (colorSwatchImage(group.colorName); as swatchImg) {
                      <img class="vcg-swatch vcg-swatch--img" [src]="swatchImg" [alt]="group.colorName"/>
                    } @else {
                      <span class="vcg-swatch" [style.background]="colorHex(group.colorName)"></span>
                    }

                    <!-- Color selector — click stops group toggle, select changes all variants in group -->
                    <div class="vcg-color-wrap" (click)="$event.stopPropagation()">
                      @if (refColors().length > 0) {
                        <select class="inp inp-sm vcg-color-sel"
                                [ngModel]="group.colorName"
                                (ngModelChange)="renameGroupColor(group.colorKey, $event)">
                          <option value="">{{ t('product.variants.noColor') }}</option>
                          @for (c of refColors(); track c.id) {
                            <option [value]="c.name_en">{{ c.name_en }}</option>
                          }
                        </select>
                      } @else {
                        <input class="inp inp-sm vcg-color-sel"
                               [placeholder]="'Color name'"
                               [ngModel]="group.colorName"
                               (ngModelChange)="renameGroupColor(group.colorKey, $event)"/>
                      }
                    </div>

                    <!-- Stock total badge -->
                    <span class="vcg-stock-badge"
                          [class.vcg-stock--out]="groupStock(group.items) === 0">
                      {{ groupStock(group.items) }} {{ t('product.variants.inStock') }}
                    </span>

                    <!-- Image picker trigger + popover, wrapped so picker anchors to button -->
                    <div class="vcg-img-wrap" (click)="$event.stopPropagation()">
                      <button class="vcg-img-btn" type="button"
                              (click)="toggleVariantPicker('group-' + group.colorKey)"
                              [class.has-img]="!!imageForColor(group.colorName)"
                              [attr.title]="group.colorName ? t('product.variants.linkPhotoFor') + ' ' + group.colorName : t('product.variants.linkPhoto')">
                        @if (imageForColor(group.colorName); as img) {
                          <img [src]="img" [alt]="group.colorName" style="width:100%;height:100%;object-fit:cover;border-radius:4px;"/>
                          <span class="vc-img-edit-icon"><ap-icon name="edit" [size]="9"/></span>
                        } @else {
                          <ap-icon name="media" [size]="13"/>
                        }
                      </button>

                      @if (variantPickerOpenId() === 'group-' + group.colorKey) {
                        <div class="vc-img-picker vc-img-picker--group" (click)="$event.stopPropagation()">
                          <div class="vc-img-picker-head">
                            {{ t('product.variants.linkPhotoFor') }} <strong>{{ group.colorName }}</strong>
                            <button class="vc-img-picker-close" type="button" (click)="closeVariantPicker()">✕</button>
                          </div>
                          @if (form().images.length === 0) {
                            <p class="vc-img-picker-empty">{{ t('product.variants.uploadFirst') }}</p>
                          } @else {
                            <div class="vc-img-picker-grid">
                              <button class="vc-img-opt vc-img-opt--none" type="button"
                                      [class.is-sel]="!imageForColor(group.colorName)"
                                      (click)="setColorImage(group.colorName, ''); closeVariantPicker()">
                                <span class="vc-img-none-label">{{ t('product.variants.noneOption') }}</span>
                              </button>
                              @for (img of form().images; track img) {
                                <button class="vc-img-opt" type="button"
                                        [class.is-sel]="imageForColor(group.colorName) === img"
                                        (click)="setColorImage(group.colorName, img); closeVariantPicker()">
                                  <img [src]="img" [alt]="''"/>
                                </button>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>

                    <!-- Spacer -->
                    <span style="flex:1;"></span>

                    <!-- Generate sizes for this color -->
                    @if (refSizeSets().length > 0 && expandedGroups().has(group.colorKey)) {
                      <div class="gen-sizes-wrap" (click)="$event.stopPropagation()">
                        <select class="inp inp-sm" #grpSizeSetSel style="font-size:11px;">
                          <option value="">{{ t('product.variants.generateSizes') }}</option>
                          @for (ss of refSizeSets(); track ss.id) {
                            <option [value]="ss.id">{{ ss.name }}</option>
                          }
                        </select>
                        <button class="btn btn-outline btn-sm" [disabled]="!grpSizeSetSel.value"
                                (click)="generateSizesForColor(grpSizeSetSel.value, group.colorName); grpSizeSetSel.value=''">
                          <ap-icon name="wand" [size]="12"/>
                        </button>
                      </div>
                    }

                    <!-- Add size in this color -->
                    @if (expandedGroups().has(group.colorKey)) {
                      <button class="btn btn-outline btn-sm" type="button"
                              (click)="$event.stopPropagation(); addVariantForColor(group.colorName)">
                        <ap-icon name="plus" [size]="11"/> {{ t('product.variants.addSize') }}
                      </button>
                    }
                  </div>

                  <!-- Size rows — shown only when group is expanded -->
                  @if (expandedGroups().has(group.colorKey)) {
                    <!-- Column headers -->
                    <div class="vc-header vc-header--group">
                      <span>{{ t('product.variants.col.size') }}</span>
                      <span>{{ t('product.variants.col.stock') }}</span>
                      <span>{{ t('product.variants.col.price') }}</span>
                      <span>{{ t('product.variants.col.sku') }}</span>
                      <span></span>
                    </div>

                    @for (item of group.items; track item.v.id) {
                      <div class="vc vc--grouped" [class.vc-expanded]="expandedVariants().has(item.v.id)">
                        <div class="vc-row vc-row--grouped">

                          <!-- Size -->
                          <div class="vc-cell vc-cell--size">
                            <input class="inp inp-sm vc-size-inp" list="size-options"
                                   [placeholder]="'—'"
                                   [ngModel]="item.v.size"
                                   (ngModelChange)="updateVariant(item.globalIndex, { size: $event })"/>
                          </div>

                          <!-- Stock -->
                          <div class="vc-cell vc-cell--num">
                            <input class="inp inp-sm mono vc-stock-inp"
                                   [class.stock-out]="item.v.stock === 0"
                                   [class.stock-low]="item.v.stock > 0 && item.v.stock < 5"
                                   type="number" min="0"
                                   [ngModel]="item.v.stock"
                                   (ngModelChange)="updateVariant(item.globalIndex, { stock: +$event || 0 })"/>
                          </div>

                          <!-- Price -->
                          <div class="vc-cell vc-cell--num vc-cell--price">
                            <div class="vc-price-wrap">
                              <span class="vc-price-pfx">QAR</span>
                              <input class="inp inp-sm mono" type="number" min="0"
                                     [ngModel]="item.v.price"
                                     (ngModelChange)="updateVariant(item.globalIndex, { price: +$event || 0 })"/>
                            </div>
                          </div>

                          <!-- SKU -->
                          <div class="vc-cell vc-cell--sku">
                            <input class="inp inp-sm mono" placeholder="SKU"
                                   [ngModel]="item.v.sku"
                                   (ngModelChange)="updateVariant(item.globalIndex, { sku: $event })"/>
                          </div>

                          <!-- Actions -->
                          <div class="vc-cell vc-cell--actions">
                            <button class="vt-expand" type="button"
                                    [class.is-open]="expandedVariants().has(item.v.id)"
                                    (click)="toggleVariantExpand(item.v.id)"
                                    [title]="t('product.variants.costMarginTitle')">
                              <ap-icon name="arrowDn" [size]="12"/>
                            </button>
                            <button class="vt-remove" type="button"
                                    (click)="removeVariant(item.globalIndex)"
                                    [attr.aria-label]="t('common.remove')">
                              <ap-icon name="trash" [size]="12"/>
                            </button>
                          </div>
                        </div>

                        <!-- Expandable detail: Material | Cost | Shipping | Total Cost · Margin -->
                        @if (expandedVariants().has(item.v.id)) {
                          <div class="vc-detail vc-detail--5col">
                            <div class="vc-field">
                              <label class="vc-lbl">{{ t('product.variants.col.material') }}</label>
                              @if (refMaterials().length > 0) {
                                <select class="inp inp-sm" [ngModel]="item.v.material"
                                        (ngModelChange)="updateVariant(item.globalIndex, { material: $event })">
                                  <option value="">—</option>
                                  @for (m of refMaterials(); track m.id) {
                                    <option [value]="m.name_en">{{ m.name_en }}</option>
                                  }
                                </select>
                              } @else {
                                <input class="inp inp-sm"
                                       [placeholder]="t('product.variants.placeholder.material')"
                                       [ngModel]="item.v.material"
                                       (ngModelChange)="updateVariant(item.globalIndex, { material: $event })"/>
                              }
                            </div>
                            <div class="vc-field">
                              <label class="vc-lbl">{{ t('product.variants.col.cost') }} (QAR)</label>
                              <input class="inp inp-sm mono" type="number" min="0" step="0.01" placeholder="—"
                                     [ngModel]="item.v.costPrice ?? null"
                                     (ngModelChange)="updateVariant(item.globalIndex, { costPrice: $event !== null && $event !== '' ? +$event : undefined })"/>
                            </div>
                            <div class="vc-field">
                              <label class="vc-lbl">{{ t('product.variants.shipping') }}</label>
                              <input class="inp inp-sm mono" type="number" min="0" step="0.01" placeholder="—"
                                     [ngModel]="item.v.shippingCost ?? null"
                                     (ngModelChange)="updateVariant(item.globalIndex, { shippingCost: $event !== null && $event !== '' ? +$event : undefined })"/>
                            </div>
                            <div class="vc-field vc-field--total-cost">
                              <label class="vc-lbl">{{ t('product.variants.totalCost') }}</label>
                              @if (variantTotalCost(item.v); as tc) {
                                <span class="total-cost-val mono">{{ tc | number:'1.2-2' }}</span>
                              } @else {
                                <span class="margin-dash muted small">—</span>
                              }
                            </div>
                            <div class="vc-field vc-field--margin">
                              <label class="vc-lbl">{{ t('product.variants.col.margin') }}</label>
                              @if (variantMargin(item.v); as m) {
                                <span class="margin-pill"
                                      [class.margin-green]="m >= 40"
                                      [class.margin-amber]="m >= 20 && m < 40"
                                      [class.margin-red]="m < 20">{{ m }}%</span>
                              } @else {
                                <span class="margin-dash muted small">{{ t('product.variants.setCostToCalc') }}</span>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              }

              <!-- Footer: global stats + add color -->
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
                  <button class="btn btn-outline btn-sm" (click)="openBulkStock()">
                    <ap-icon name="chart" [size]="12"/> {{ t('product.variants.bulkStock') }}
                  </button>
                  <button class="btn btn-outline btn-sm" (click)="addVariant()">
                    <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
                  </button>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- ⑤ Section: Description -->
        <div class="section-title" [class.sec-collapsed]="isMobile() && !openSections().has('desc')" (click)="toggleSection('desc')">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('product.section.description') }}</span>
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('desc')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div [style.display]="isMobile() && !openSections().has('desc') ? 'none' : ''">
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
        </div>

        <!-- ⑥ Section: Organization — collections & related products -->
        <div class="section-title" [class.sec-collapsed]="isMobile() && !openSections().has('org')" (click)="toggleSection('org')">
          <ap-icon name="collections" [size]="14"/>
          <span>{{ t('product.section.organization') }}</span>
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('org')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div class="mb-24" [style.display]="isMobile() && !openSections().has('org') ? 'none' : ''"  >
          <div class="mb-16">
            <label class="lbl">{{ t('nav.collections') }}</label>
            <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;">
              @for (c of topLevelCollections(); track c.id) {
                <label class="col-check-row" [class.col-check-selected]="form().collectionIds.includes(c.id)">
                  <input type="checkbox" [checked]="form().collectionIds.includes(c.id)" (change)="toggleCollection(c.id)" style="margin:0;flex-shrink:0;"/>
                  <span class="small strong">{{ c.title }}</span>
                </label>
                @for (child of subCollectionsOf(c.id); track child.id) {
                  <label class="col-check-row col-check-sub" [class.col-check-selected]="form().collectionIds.includes(child.id)">
                    <ap-icon name="hierarchy" [size]="10" style="color:var(--muted);flex-shrink:0;"/>
                    <input type="checkbox" [checked]="form().collectionIds.includes(child.id)" (change)="toggleCollection(child.id)" style="margin:0;flex-shrink:0;"/>
                    <span class="small">{{ child.title }}</span>
                  </label>
                }
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
        <div class="section-title" [class.sec-collapsed]="isMobile() && !openSections().has('seo')" (click)="toggleSection('seo')">
          <ap-icon name="search" [size]="14"/>
          <span>{{ t('product.section.seo') }}</span>
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('seo')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div class="mb-24" [style.display]="isMobile() && !openSections().has('seo') ? 'none' : ''"  >
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
            <div class="field-error mt-6">{{ t('product.field.slugError') }}</div>
          }
        </div>

        <!-- Section: Danger zone -->
        <div class="section-title danger-section" [class.sec-collapsed]="isMobile() && !openSections().has('danger')" (click)="toggleSection('danger')">
          <ap-icon name="trash" [size]="14"/>
          <span>{{ t('product.section.danger') }}</span>
          <ap-icon name="arrowDn" [size]="11" class="sec-chev" [class.open]="openSections().has('danger')" [style.display]="isMobile() ? 'block' : 'none'"/>
        </div>

        <div class="danger-zone mb-24" [style.display]="isMobile() && !openSections().has('danger') ? 'none' : ''"  >
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
            <p class="mpp-eyebrow">{{ t('product.gallery.library') }}</p>
            <div class="card-title">{{ t('product.gallery.selectImages') }}</div>
          </div>
          <button class="x-btn" type="button" (click)="mediaPicker.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="mpp-search">
          <ap-icon name="search" [size]="13"/>
          <input class="inp" [placeholder]="t('product.gallery.searchFilename')"
                 [ngModel]="mediaSearch()" (ngModelChange)="mediaSearch.set($event)"/>
        </div>
        <div class="mpp-body">
          @if (mediaLoading()) {
            <div class="mpp-state"><ap-spinner [size]="20"/> {{ t('product.gallery.loadingMedia') }}</div>
          } @else if (filteredMediaFiles().length === 0) {
            <div class="mpp-state">{{ t('product.gallery.noImages') }}</div>
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
          <span class="muted small">{{ mediaSelected().size }} {{ t('product.gallery.selected') }}</span>
          <div class="row gap-sm">
            <button class="btn btn-outline" type="button" (click)="mediaPicker.set(false)">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" type="button" [disabled]="mediaSelected().size === 0" (click)="applyMediaSelection()">
              {{ mediaSelected().size !== 1 ? t('product.gallery.addImages') : t('product.gallery.addImage') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Bulk Stock Update Modal ── -->
    @if (bulkStockOpen()) {
      <div class="overlay" style="z-index:260;" (click)="closeBulkStock()"></div>
      <div class="media-pick-panel bulk-stock-panel" style="z-index:270;">
        <div class="mpp-head">
          <div>
            <p class="mpp-eyebrow">{{ t('product.section.variants') }}</p>
            <div class="card-title">{{ t('product.variants.bulkStock.title') }}</div>
          </div>
          <button class="x-btn" type="button" (click)="closeBulkStock()"><ap-icon name="x" [size]="14"/></button>
        </div>

        <div class="bsu-sub muted small">{{ t('product.variants.bulkStock.sub') }}</div>

        <!-- Set-all shortcut -->
        <div class="bsu-set-all">
          <span class="muted small">{{ t('product.variants.bulkStock.setAll') }}</span>
          <input class="inp inp-sm mono bsu-set-all-inp" type="number" min="0"
                 [ngModel]="bulkStockSetAll()"
                 (ngModelChange)="setBulkStockAll($event)"/>
        </div>

        <!-- Variant rows -->
        <div class="mpp-body bsu-body">
          <div class="bsu-header">
            <span>{{ t('product.variants.col.color') }}</span>
            <span>{{ t('product.variants.col.size') }}</span>
            <span>{{ t('product.variants.col.sku') }}</span>
            <span>{{ t('product.variants.col.stock') }}</span>
          </div>
          @for (row of bulkStockRows(); track row.id) {
            <div class="bsu-row">
              <span class="bsu-color">
                @if (colorSwatchImage(row.color)) {
                  <img class="bsu-swatch bsu-swatch--img" [src]="colorSwatchImage(row.color)" [alt]="row.color"/>
                } @else {
                  <span class="bsu-swatch" [style.background]="colorHex(row.color)"></span>
                }
                <span class="small">{{ row.color || '—' }}</span>
              </span>
              <span class="small mono">{{ row.size || '—' }}</span>
              <span class="small mono muted">{{ row.sku || '—' }}</span>
              <input class="inp inp-sm mono bsu-stock-inp"
                     [class.stock-out]="row.stock === 0"
                     [class.stock-low]="row.stock > 0 && row.stock < 5"
                     type="number" min="0"
                     [ngModel]="row.stock"
                     (ngModelChange)="updateBulkStockRow(row.id, +$event || 0)"/>
            </div>
          }
        </div>

        <div class="drawer-foot">
          <span class="muted small">{{ bulkStockRows().length }} {{ t('common.variants') }}</span>
          <div class="row gap-sm">
            <button class="btn btn-outline" type="button" (click)="closeBulkStock()">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" type="button"
                    [disabled]="bulkStockSaving()"
                    (click)="applyBulkStock()">
              @if (bulkStockSaving()) {
                <ap-spinner [size]="12"/> {{ t('product.variants.bulkStock.applying') }}
              } @else {
                <ap-icon name="check" [size]="12"/> {{ t('product.variants.bulkStock.apply') }}
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Wider drawer for the editor — full screen on phones */
    .drawer-wide { width: min(800px, 100vw); }
    @media (max-width: 800px) { .drawer-wide { width: 100vw; } }

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
    /* In RTL swap the nav chevrons so prev/next point the correct inline direction */
    :host-context([dir='rtl']) .nav-prev svg,
    :host-context([dir='rtl']) .nav-next svg { transform: scaleX(-1); }

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

    /* Bulk Stock Panel */
    .bulk-stock-panel { width: min(480px, 100vw); }
    .bsu-sub { padding: 10px 20px 0; }
    .bsu-set-all {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--border-2);
      background: var(--bg);
    }
    .bsu-set-all-inp { width: 80px; }
    .bsu-body { padding: 0; }
    .bsu-header {
      display: grid;
      grid-template-columns: 1.6fr 0.8fr 1.4fr 0.8fr;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border-2);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--muted);
      position: sticky;
      top: 0;
    }
    .bsu-row {
      display: grid;
      grid-template-columns: 1.6fr 0.8fr 1.4fr 0.8fr;
      gap: 8px;
      align-items: center;
      padding: 7px 16px;
      border-bottom: 1px solid var(--border-2);
      transition: background 0.1s;
    }
    .bsu-row:last-child { border-bottom: none; }
    .bsu-row:hover { background: var(--bg); }
    .bsu-color {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      overflow: hidden;
    }
    .bsu-color .small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bsu-swatch {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.12);
    }
    .bsu-swatch--img {
      border-radius: 4px;
      object-fit: cover;
    }
    .bsu-stock-inp { width: 100%; }

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

    /* ── Color group accordion ──────────────────────────────── */
    .vcg {
      border-bottom: 1px solid var(--border-2);
    }
    .vcg:last-child { border-bottom: none; }

    .vcg-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; cursor: pointer;
      background: var(--bg); transition: background .12s;
      position: relative;
    }
    .vcg-head:hover { background: var(--bg-2); }
    .vcg--open .vcg-head { background: var(--bg-2); border-bottom: 1px solid var(--border-2); }

    .vcg-chev {
      color: var(--muted); transition: transform .2s; flex-shrink: 0;
    }
    .vcg-chev.open { transform: rotate(180deg); }

    .vcg-swatch {
      width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,.1);
    }
    .vcg-swatch--img { object-fit: cover; }

    .vcg-name {
      font-size: 13px; font-weight: 600; min-width: 80px;
    }
    .vcg-color-wrap { display: flex; align-items: center; }
    .vcg-color-sel {
      font-size: 13px; font-weight: 600;
      min-width: 100px; max-width: 160px;
      padding-inline-start: 6px;
      border-color: transparent; background: transparent;
      cursor: pointer;
    }
    .vcg-color-sel:hover,
    .vcg-color-sel:focus { border-color: var(--border); background: var(--surface); }

    .vcg-stock-badge {
      font-size: 11px; color: var(--muted);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 99px; padding: 1px 8px; white-space: nowrap;
    }
    .vcg-stock--out { color: var(--danger); border-color: rgba(239,68,68,.3); }

    /* Wrapper gives the picker a tight anchor right next to the button */
    .vcg-img-wrap { position: relative; flex-shrink: 0; }

    .vcg-img-btn {
      width: 32px; height: 32px; border-radius: 6px;
      border: 1px dashed var(--border); background: var(--bg);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      color: var(--muted); position: relative; overflow: hidden;
      transition: border-color .12s;
    }
    .vcg-img-btn.has-img { border-style: solid; border-color: var(--gold); }
    .vcg-img-btn.no-color { opacity: 0.3; cursor: not-allowed; }

    /* Grouped size rows use narrower grid (no photo/color columns) */
    .vc-header--group,
    .vc-row--grouped {
      grid-template-columns: 80px 80px 1fr 1fr 56px !important;
    }
    .vc--grouped { border-radius: 0 !important; }

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
    /* Group picker anchors to .vcg-img-wrap (32 px button).
       Opens downward; right edge aligns with button right edge.
       Extends leftward so it never escapes the drawer. */
    .vc-img-picker--group {
      top: calc(100% + 6px);
      left: auto;
      right: 0;
      min-width: 260px;
      max-width: 300px;
    }
    .vc-img-picker--group .vc-img-picker-grid {
      max-height: 220px;
      overflow-y: auto;
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
    .vc-detail--5col { grid-template-columns: 1.4fr 1fr 1fr 0.9fr 0.9fr; }
    /* Margin/total-cost fields inside detail: label + value stacked */
    .vc-field--margin,
    .vc-field--total-cost { flex-direction: column; align-items: flex-start; gap: 5px; }
    .total-cost-val { font-size: 13px; font-weight: 700; color: var(--text); }
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
      .vc-detail--5col { grid-template-columns: 1fr 1fr 1fr; }
      .vc-field--margin,
      .vc-field--total-cost { display: none; }
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
    /* Collection hierarchy checkboxes */
    .col-check-row {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid var(--border-2); background: var(--bg-2);
      transition: border-color 0.12s, background 0.12s;
    }
    .col-check-row:hover { border-color: var(--gold); }
    .col-check-selected { border-color: var(--gold) !important; background: var(--gold-3) !important; }
    .col-check-sub { margin-inline-start: 20px; }

    @media (max-width: 720px) {
      .nav-pos { padding: 0 4px; min-width: 28px; font-size: 10px; }
      .section-title { font-size: 15px; padding: 14px 0 10px; }
      .save-bar-hint .kbd { display: none; }
    }

    /* ── Collapsible sections (mobile only) ── */
    @media (max-width: 768px) {
      /* Make section headers feel tappable */
      .section-title { cursor: pointer; -webkit-tap-highlight-color: transparent; user-select: none; }
      /* Chevron icon: rotates open/closed */
      .sec-chev { flex-shrink: 0; opacity: 0.45; transition: transform 0.2s ease; }
      .sec-chev.open { transform: rotate(180deg); }
      /* Muted look when collapsed */
      .section-title.sec-collapsed { opacity: 0.72; }
      /* Prevent chevron overlapping the variant summary text */
      .section-title .sec-chev { margin-inline-start: 8px; }
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
  /** Emitted after a successful save so the catalog can update _products signal. */
  @Output() productSaved = new EventEmitter<Product>();

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

  /* ── Mobile collapsible sections ── */
  readonly isMobile = signal(window.innerWidth <= 768);
  // Gallery and Basics are always open; the rest start collapsed on mobile.
  readonly openSections = signal(new Set(['gallery', 'basics', 'pricing', 'variants']));

  @HostListener('window:resize')
  onDrawerResize(): void { this.isMobile.set(window.innerWidth <= 768); }

  toggleSection(id: string): void {
    if (!this.isMobile()) return;
    this.openSections.update(s => {
      const next = new Set(s);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }
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
  readonly deleting = signal(false);

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

  // ── Bulk Stock Update ─────────────────────────────────────────────────
  readonly bulkStockOpen = signal(false);
  readonly bulkStockSaving = signal(false);
  readonly bulkStockSetAll = signal<number | null>(null);
  readonly bulkStockRows = signal<{ id: string; color: string; size: string; sku: string; stock: number }[]>([]);
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
      enDesc: p.enDesc ?? '',
      arDesc: p.arDesc ?? '',
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
    // Always fetch fresh — user may have uploaded images in another tab
    this.mediaLoading.set(true);
    try {
      const files = await this.mediaApi.list();
      this.mediaFiles.set(files);
    } catch {
      this.toast.error(this.t('product.gallery.loadError'));
    } finally {
      this.mediaLoading.set(false);
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

  /**
   * Derives the SKU color segment for a given color name.
   * Strategy: strip non-letters, uppercase, take up to 3 chars.
   * e.g. "Taupe" → "TAU", "Milk White" → "MIL", "Black" → "BLA"
   * This is used when generating new variant SKUs in the product editor.
   * Bulk-imported SKUs carry their own codes from the CSV.
   */
  private colorToSkuCode(colorName: string): string {
    return colorName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3) || 'CLR';
  }

  /**
   * Extracts the color code segment from an existing variant SKU.
   * Given baseSku = "3513-RBR" and variantSku = "3513-RBR-RP-5",
   * returns "RP". Returns null if the SKU doesn't start with baseSku or
   * has no extra segments to parse.
   */
  private extractColorCodeFromSku(baseSku: string, variantSku: string): string | null {
    if (!baseSku || !variantSku || !variantSku.startsWith(baseSku + '-')) return null;
    const rest = variantSku.slice(baseSku.length + 1); // e.g. "RP-5" or "RP-5.5"
    const segments = rest.split('-');
    // The last segment is typically numeric (the size); the one before it is the color code.
    if (segments.length >= 2) {
      const last = segments[segments.length - 1];
      const isSize = /^\d+(\.\d+)?$/.test(last) || /^(XS|S|M|L|XL|XXL|XXXL|OS)$/i.test(last);
      if (isSize) return segments[segments.length - 2];
    }
    // Only one segment after base — could be just a color code (no size yet)
    return segments[0] || null;
  }

  colorSwatchImage(name: string | undefined): string | null {
    if (!name) return null;
    return this.refColors().find(c => c.name_en === name)?.swatch_image_url ?? null;
  }

  // Groups the flat variants[] by color for the accordion UI.
  // The underlying flat array is preserved — this is purely a computed view.
  readonly colorGroups = computed(() => {
    const variants = this.form().variants;
    const map = new Map<string, {
      colorKey:  string;
      colorName: string;
      items:     { v: ProductVariant; globalIndex: number }[];
    }>();

    variants.forEach((v, globalIndex) => {
      const key = (v.color || '').trim().toLowerCase() || '__none__';
      if (!map.has(key)) map.set(key, { colorKey: key, colorName: v.color || '', items: [] });
      map.get(key)!.items.push({ v, globalIndex });
    });

    return [...map.values()];
  });

  readonly expandedGroups = signal<Set<string>>(new Set());

  toggleGroup(key: string): void {
    this.expandedGroups.update(s => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  addVariantForColor(colorName: string): void {
    const f = this.form();
    const colorCode = this.colorToSkuCode(colorName);
    const next: ProductVariant = {
      id:       'V-' + Date.now().toString(36),
      sku:      f.sku ? `${f.sku}-${colorCode}-NEW` : '',
      size:     '',
      color:    colorName,
      material: '',
      price:    f.price || 0,
      stock:    0,
    };
    this.set('variants', [...f.variants, next]);
    // Ensure the group is expanded so the new row is visible
    this.expandedGroups.update(s => {
      const next = new Set(s);
      next.add(colorName.trim().toLowerCase() || '__none__');
      return next;
    });
  }

  generateSizesForColor(sizeSetId: string, colorName: string): void {
    const ss = this.refSizeSets().find(s => s.id === sizeSetId);
    if (!ss) return;
    const f = this.form();
    const existingSizes = new Set(
      f.variants.filter(v => v.color === colorName).map(v => v.size)
    );
    const toAdd = ss.sizes.filter(sz => !existingSizes.has(sz));
    if (toAdd.length === 0) { this.toast.info(this.t('product.variants.allSizesAdded'), ss.name); return; }
    const colorCode = this.colorToSkuCode(colorName);
    const newVariants: ProductVariant[] = toAdd.map(sz => ({
      id:       'V-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      sku:      f.sku ? `${f.sku}-${colorCode}-${sz}` : '',
      size:     sz,
      color:    colorName,
      material: '',
      price:    f.price || 0,
      stock:    0,
    }));
    this.set('variants', [...f.variants, ...newVariants]);
    this.toast.success(`${newVariants.length} ${this.t('product.variants.sizesAdded')}`, `${colorName} · ${ss.name}`);
  }

  setBulkPriceForColor(colorName: string, price: number): void {
    const next = this.form().variants.map(v =>
      v.color === colorName ? { ...v, price } : v
    );
    this.set('variants', next);
  }

  groupStock(items: { v: ProductVariant; globalIndex: number }[]): number {
    return items.reduce((sum, item) => sum + (Number(item.v.stock) || 0), 0);
  }

  /** Renames all variants in a color group to a new color name, updating SKU segments too. */
  renameGroupColor(colorKey: string, newColor: string): void {
    const f = this.form();
    const baseSku = f.sku;
    const newCode = this.colorToSkuCode(newColor);

    // Find the old color code by inspecting the first matching variant's SKU
    const firstMatch = f.variants.find(v => (v.color || '').trim().toLowerCase() === colorKey);
    const oldCode = firstMatch && baseSku
      ? this.extractColorCodeFromSku(baseSku, firstMatch.sku)
      : null;

    const next = f.variants.map(v => {
      const key = (v.color || '').trim().toLowerCase() || '__none__';
      if (key !== colorKey) return v;

      let newSku = v.sku;
      if (baseSku && oldCode && newSku.startsWith(baseSku + '-')) {
        // Replace only the first occurrence of the old code segment after baseSku
        const afterBase = newSku.slice(baseSku.length + 1);
        const replaced = afterBase.replace(
          new RegExp(`^${oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-|$)`),
          `${newCode}$1`
        );
        newSku = `${baseSku}-${replaced}`;
      }

      return { ...v, color: newColor, sku: newSku };
    });
    this.set('variants', next);
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
      this.toast.info(this.t('product.variants.allSizesAdded'), ss.name);
      return;
    }
    this.set('variants', [...f.variants, ...newVariants]);
    this.toast.success(`${newVariants.length} ${this.t('product.variants.sizesAdded')}`, ss.name);
  }

  readonly hasVariants = computed(() => this.form().variants.length > 0);

  variantTotalCost(v: ProductVariant): number | null {
    if (v.costPrice == null && v.shippingCost == null) return null;
    return (v.costPrice ?? 0) + (v.shippingCost ?? 0);
  }

  variantMargin(v: ProductVariant): number | null {
    const cost = this.variantTotalCost(v) ?? v.costPrice;
    if (cost == null || !v.price) return null;
    return Math.round(((v.price - cost) / v.price) * 100);
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

  topLevelCollections(): Collection[] {
    return this.collections.filter(c => !c.parentId);
  }

  subCollectionsOf(parentId: string): Collection[] {
    return this.collections.filter(c => c.parentId === parentId);
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
      this.product.enDesc = saved.enDesc ?? f.enDesc;
      this.product.arDesc = saved.arDesc ?? f.arDesc;
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
      
      this.productSaved.emit({ ...this.product });
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

  async duplicateProduct(): Promise<void> {
    if (this.duplicating()) return;
    this.duplicating.set(true);
    try {
      const copy = await this.productsApi.duplicate(this.product.id);
      this.toast.success(this.t('product.toast.duplicated'), copy.sku);
      this.duplicated.emit(copy);
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.duplicating.set(false);
    }
  }

  // ── Bulk Stock Update ────────────────────────────────────────────────

  openBulkStock(): void {
    const rows = this.form().variants.map(v => ({
      id: v.id,
      color: v.color ?? '',
      size: v.size ?? '',
      sku: v.sku ?? '',
      stock: v.stock ?? 0,
    }));
    this.bulkStockRows.set(rows);
    this.bulkStockSetAll.set(null);
    this.bulkStockOpen.set(true);
  }

  closeBulkStock(): void {
    this.bulkStockOpen.set(false);
  }

  updateBulkStockRow(id: string, stock: number): void {
    this.bulkStockRows.update(rows =>
      rows.map(r => r.id === id ? { ...r, stock } : r),
    );
  }

  setBulkStockAll(value: number | string): void {
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(n) || n < 0) return;
    this.bulkStockSetAll.set(n);
    this.bulkStockRows.update(rows => rows.map(r => ({ ...r, stock: n })));
  }

  async applyBulkStock(): Promise<void> {
    if (this.bulkStockSaving()) return;
    const rows = this.bulkStockRows();
    const updates = rows
      .filter(r => r.sku)
      .map(r => ({ sku: r.sku, stock: r.stock }));

    if (updates.length === 0) {
      this.toast.info(this.t('common.noChanges') || 'No variants with SKUs to update.');
      return;
    }

    this.bulkStockSaving.set(true);
    try {
      const result = await this.productsApi.bulkStockUpdate(updates);

      // Build a SKU -> new stock map for reliable matching (same key the server uses)
      const stockBySku = new Map<string, number>(rows.filter(r => r.sku).map(r => [r.sku, r.stock]));

      const patchVariants = <T extends { sku: string; stock: number }>(variants: T[]): T[] =>
        variants.map(v => {
          const newStock = stockBySku.get(v.sku);
          return newStock !== undefined ? { ...v, stock: newStock } : v;
        });

      // Mirror changes into form signal (drives colorGroups computed + variant rows)
      this.form.update(f => ({ ...f, variants: patchVariants(f.variants) }));

      // Mirror into initial so dirty() stays false and the save bar doesn't appear
      this.initial.update(i => ({ ...i, variants: patchVariants(i.variants) }));

      // Mirror into the underlying product object so resetForCurrent() doesn't
      // revert the stock when the user navigates away and back (or closes/reopens)
      if (this.product) {
        this.product.variants = patchVariants((this.product.variants ?? []).map(v => ({ ...v })));
        this.product.stock = this.product.variants.reduce((s, v) => s + (v.stock ?? 0), 0);
      }

      const successMsg = this.t('product.variants.bulkStock.success').replace('{n}', String(result.updated));
      if (result.notFound?.length) {
        const notFoundMsg = this.t('product.variants.bulkStock.notFound').replace('{n}', String(result.notFound.length));
        this.toast.info(successMsg, notFoundMsg);
      } else {
        this.toast.success(successMsg);
      }
      this.bulkStockOpen.set(false);
    } catch {
      // Global error interceptor handles the toast
    } finally {
      this.bulkStockSaving.set(false);
    }
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
