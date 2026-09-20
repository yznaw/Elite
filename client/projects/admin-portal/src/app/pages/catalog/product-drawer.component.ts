import { RestockRequestsService, RestockSummary } from '../../services/restock-requests.service';
import { colorKey } from '../../../../../../../shared/color-key.js';
import {
  Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output,
  computed, inject, signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { RichTextComponent } from '../../shared/rich-text/rich-text.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { BarcodeComponent } from '../../shared/barcode/barcode.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { AdminProductsService, SaveProductPayload } from '../../services/admin-products.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { AdminRefService, RefColor, RefMaterial, RefSizeSet } from '../../services/admin-ref.service';
import { MediaUploadService, ProductImageUploadResult } from '../../services/media-upload.service';
import { AdminMediaService } from '../../services/admin-media.service';
import { StorageService } from '../../services/storage.service';
import { LabelPrinterService, arabicPrice } from '../../services/label-printer.service';
import { Collection, ME, Product, ProductVariant } from '../../models';
import { formatVariantSku, variantBaseSku } from '../../utils/variant-sku';
import { NO_IMAGE_LOGO, onProductImgError } from '../../utils/no-image';

interface FormShape {
  name: string; nameAr: string; sku: string; brand: string; collectionIds: string[];
  relatedProductIds: string[];
  price: number; defaultCostPrice: number | null; defaultShippingCost: number | null;
  stock: number; hidden: boolean; posHidden: boolean;
  duplicatedFromProductId: string | null;
  enDesc: string; arDesc: string;
  shortEn: string; shortAr: string;
  teaserEn: string; teaserAr: string;
  noteEn: string; noteAr: string;
  careEn: string; careAr: string;
  metaTitle: string; metaDesc: string; slug: string;
  variants: ProductVariant[];
  images: string[];
  imageColors: Record<string, string>;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

// A brand-new product isn't saved yet, so its gallery images ride along as
// base64 data URLs inside the JSON create-product request (see uploadFiles
// below) instead of the multipart upload used everywhere else — and that
// request is capped at 10 MB (server/index.js), not the 50 MB per-file
// limit the rest of the app promises. Base64 inflates raw bytes by ~4/3, so
// these caps sit well below 50 MB to leave headroom for that encoding plus
// the rest of the product form.
const PRESAVE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const PRESAVE_IMAGE_TOTAL_BUDGET_BYTES = 7 * 1024 * 1024;


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
    imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, RichTextComponent, SaveBarComponent, BarcodeComponent],
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
        <!-- HIDDEN-POS-TOGGLE: "Available on POS" hidden at the client's request
             (2026-09-01) — every product is forced available on POS (posHidden
             always false, see makeEmptyForm/makeFormFromProduct below) until
             they ask for this control back. Search "HIDDEN-POS-TOGGLE" to
             restore: un-comment this block and remove the two forced-false
             overrides. -->
        @if (false) {
          <div class="vis-block mb-24" [class.hidden-state]="form().posHidden">
            <div>
              <div class="strong" style="font-size:13px;margin-bottom:2px;" [style.color]="form().posHidden ? 'var(--danger)' : 'var(--ink)'">
                {{ form().posHidden ? t('product.posVisibility.hiddenTitle') : t('product.posVisibility.visibleTitle') }}
              </div>
              <div class="muted small">
                {{ form().posHidden ? t('product.posVisibility.hiddenSub') : t('product.posVisibility.visibleSub') }}
              </div>
            </div>
            <button class="toggle" [class.on]="!form().posHidden" (click)="toggle('posHidden')"></button>
          </div>
        }

        <!-- Image preview + key facts -->
        <div class="mb-24" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="prod-img" style="border-radius:10px;">
            @if (primaryImage()) {
              <img [src]="primaryImage()" [alt]="form().name" (error)="onImgError($event)"/>
            } @else {
              <img class="no-img" [src]="noImageLogo" [alt]="form().name"/>
            }
            @if (form().images.length > 1) {
              <span class="corner-badge" style="top:10px;inset-inline-start:10px;background:rgba(2,70,56,0.92);">{{ form().images.length }}</span>
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
            <button class="btn btn-outline btn-sm" type="button" (click)="openGDrive()">
              <ap-icon name="link" [size]="12"/> {{ t('product.gallery.addGDrive') }}
            </button>
          </div>
        </div>

        <!-- ── Google Drive import modal ── -->
        @if (gdriveOpen()) {
          <div class="overlay" (click)="gdriveOpen.set(false)"></div>
          <div class="modal gdrive-modal">
            <div class="modal-head">
              <div>
                <p class="gdrive-eyebrow">{{ t('media.gdrive.eyebrow') }}</p>
                <div class="card-title">{{ t('media.gdrive.title') }}</div>
              </div>
              <button class="x-btn" type="button" (click)="gdriveOpen.set(false)"><ap-icon name="x" [size]="14"/></button>
            </div>
            <div class="modal-body">
              <div class="gdrive-info">
                <ap-icon name="info" [size]="14"/>
                <span>{{ t('media.gdrive.info') }}</span>
              </div>
              <label class="lbl mb-8">{{ t('media.gdrive.label') }}</label>
              <input class="inp mb-6" [placeholder]="t('media.gdrive.placeholder')"
                     [ngModel]="gdriveUrl()" (ngModelChange)="gdriveUrl.set($event)"
                     (keydown.enter)="importGDrive()" [disabled]="gdriveLoading()"/>
              <div class="muted small mb-16">{{ t('media.gdrive.hint') }}</div>

              @if (gdriveError()) {
                <div class="gdrive-error">{{ gdriveError() }}</div>
              }
            </div>
            <div class="drawer-foot">
              <button class="btn btn-outline" type="button" (click)="gdriveOpen.set(false)" [disabled]="gdriveLoading()">{{ t('common.cancel') }}</button>
              <button class="btn btn-gold" type="button" (click)="importGDrive()" [disabled]="gdriveLoading() || !gdriveUrl().trim()">
                @if (gdriveLoading()) { <ap-spinner [size]="13"/> {{ t('media.gdrive.importing') }} } @else { {{ t('media.gdrive.import') }} }
              </button>
            </div>
          </div>
        }

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
              <span class="muted small">{{ t('product.field.sku.hint') }}</span>
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
              <label class="lbl">{{ t('product.field.price') }}</label>
              <input class="inp mono" type="number" min="0" step="1" [ngModel]="form().price" (ngModelChange)="setNum('price', $event)"/>
              <!-- A new size copies this field, so editing it afterwards leaves the two
                   disagreeing silently. The storefront sells at the size's price. -->
              @if (basePriceMismatch(); as gap) {
                <div class="price-mismatch mt-8">
                  <div>{{ t('product.price.mismatch').replace('{min}', gap.min.toLocaleString()) }}</div>
                  <button class="btn btn-outline btn-sm" type="button" (click)="alignBasePrice()">
                    {{ t('product.price.useLowest') }}
                  </button>
                </div>
              }
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
          <div class="grid-2 mt-16">
            <div>
              <label class="lbl">{{ t('product.field.defaultCost') }}</label>
              <input class="inp mono" type="number" min="0" step="0.01"
                     [ngModel]="form().defaultCostPrice"
                     (ngModelChange)="setDefaultCost('defaultCostPrice', 'costPrice', $event)"/>
              <div class="muted small mt-8">{{ t('product.field.defaultCost.hint') }}</div>
            </div>
            <div>
              <label class="lbl">{{ t('product.field.defaultShipping') }}</label>
              <input class="inp mono" type="number" min="0" step="0.01"
                     [ngModel]="form().defaultShippingCost"
                     (ngModelChange)="setDefaultCost('defaultShippingCost', 'shippingCost', $event)"/>
              <div class="muted small mt-8">{{ t('product.field.defaultShipping.hint') }}</div>
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
              <!-- ══ Color groups accordion ══ -->
              @for (group of colorGroups(); track group.colorKey) {
                <div class="vcg" [class.vcg--open]="expandedGroups().has(group.colorKey)"
                     [class.vcg--new]="group.colorKey === newGroupKey"
                     [attr.data-group-key]="group.colorKey">

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
                    @if (group.colorKey === newGroupKey) {
                      <span class="vcg-new-label">{{ t('product.variants.newGroup') }}</span>
                    }

                    <!-- Color selector — click stops group toggle, select changes all variants in group -->
                    <div class="vcg-color-wrap" (click)="$event.stopPropagation()">
                      @if (refColors().length > 0) {
                        <select class="inp inp-sm vcg-color-sel"
                                [ngModel]="group.colorName"
                                (ngModelChange)="renameGroupColor(group.colorKey, $event)">
                          <option value="">{{ group.colorKey === newGroupKey ? t('product.variants.chooseColor') : t('product.variants.noColor') }}</option>
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
                          <!-- The grid above is this product's gallery only. The library stays one
                               click away for the case where the colour's shot is not in it yet. -->
                          <button class="vc-img-picker-more" type="button"
                                  (click)="openLibraryForVariantPicker('group-' + group.colorKey)">
                            <ap-icon name="media" [size]="12"/> {{ t('product.variants.browseLibrary') }}
                          </button>
                        </div>
                      }
                    </div>

                    <!-- Spacer -->
                    <span style="flex:1;"></span>

                    <!-- Add size in this color -->
                    @if (group.colorKey === newGroupKey) {
                      <button class="vt-remove" type="button"
                              (click)="$event.stopPropagation(); removeVariant(group.items[0].globalIndex)"
                              [attr.aria-label]="t('common.remove')">
                        <ap-icon name="trash" [size]="12"/>
                      </button>
                    } @else if (expandedGroups().has(group.colorKey)) {
                      <button class="btn btn-outline btn-sm" type="button"
                              (click)="$event.stopPropagation(); addVariantForColor(group.colorName)">
                        <ap-icon name="plus" [size]="11"/> {{ t('product.variants.addSize') }}
                      </button>
                    }
                  </div>

                  <!-- Size rows — shown only when group is expanded -->
                  @if (group.colorKey === newGroupKey) {
                    <p class="vcg-new-hint">{{ t('product.variants.pickColorFirst') }}</p>
                  } @else if (expandedGroups().has(group.colorKey)) {
                    <div class="vcg-sku-tools" (click)="$event.stopPropagation()">
                      <label class="vcg-sku-field">
                        <span>{{ t('product.variants.colorBaseSku') }}</span>
                        <input class="inp inp-sm mono"
                               [placeholder]="t('product.variants.colorBaseSku.placeholder')"
                               [ngModel]="colorVariantBaseSku(group.colorName, group.items)"
                               (ngModelChange)="setColorVariantBaseSku(group.colorName, $event)"/>
                      </label>
                      <span class="muted small vcg-sku-example">
                        {{ colorVariantBaseSku(group.colorName, group.items) || t('product.variants.colorBaseSku.placeholder') }}-SIZE
                      </span>
                      @if (refSizeSets().length > 0) {
                        <div class="gen-sizes-wrap">
                          <select class="inp inp-sm" [value]="groupSizeSet()[group.colorKey] || ''"
                                  (change)="pickGroupSizeSet(group.colorKey, $any($event.target).value)">
                            <option value="">{{ t('product.variants.generateSizes') }}</option>
                            @for (ss of refSizeSets(); track ss.id) {
                              <option [value]="ss.id">{{ ss.name }}</option>
                            }
                          </select>
                          <button class="btn btn-outline btn-sm" type="button"
                                  [disabled]="!groupSizeSet()[group.colorKey] || !colorVariantBaseSku(group.colorName, group.items).trim()"
                                  (click)="generateSizesForColor(groupSizeSet()[group.colorKey], group.colorName); pickGroupSizeSet(group.colorKey, '')">
                            <ap-icon name="plus" [size]="12"/> {{ t('product.variants.generate') }}
                          </button>
                        </div>
                      }
                    </div>

                    <!-- Column headers -->
                    <div class="vc-header vc-header--group">
                      <span>{{ t('product.variants.col.size') }}</span>
                      <span>{{ t('product.variants.col.stock') }}</span>
                      <span>{{ t('product.variants.col.price') }}</span>
                      <span>{{ t('product.variants.col.sku') }}</span>
                      <span></span>
                    </div>

                    @for (item of group.items; track item.v.id) {
                      <div class="vc vc--grouped" [class.vc-expanded]="expandedVariants().has(item.v.id)"
                           [class.vc--flash]="flashVariantId() === item.v.id"
                           [attr.data-variant-id]="item.v.id">
                        <div class="vc-row vc-row--grouped">

                          <!-- Size -->
                          <div class="vc-cell vc-cell--size">
                            @if (refSizeSets().length > 0) {
                              <select class="inp inp-sm vc-size-inp"
                                      [ngModel]="item.v.size"
                                      (ngModelChange)="updateVariant(item.globalIndex, { size: $event })">
                                <option value="">—</option>
                                @for (ss of refSizeSets(); track ss.id) {
                                  <optgroup [label]="ss.name">
                                    @for (sz of ss.sizes; track sz) { <option [value]="sz">{{ sz }}</option> }
                                  </optgroup>
                                }
                              </select>
                            } @else {
                              <input class="inp inp-sm vc-size-inp"
                                     [placeholder]="'—'"
                                     [ngModel]="item.v.size"
                                     (ngModelChange)="updateVariant(item.globalIndex, { size: $event })"/>
                            }
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
                                     (ngModelChange)="updateVariant(item.globalIndex, { price: wholeQar($event) })"/>
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
                            <button class="vt-print" type="button"
                                    (click)="printVariantLabel(item.v)"
                                    [title]="t('product.variants.printLabel')"
                                    [attr.aria-label]="t('product.variants.printLabel')">
                              <ap-icon name="barcode" [size]="13"/>
                            </button>
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

                        @if (waitingForVariant(item.v); as count) {
                          <p class="muted small" style="margin:0;padding:0 12px 8px;">{{ count }} {{ t('restock.customersWaiting') }}</p>
                        }
                        <!-- Expandable detail: Material | Barcode | Cost | Shipping | Total Cost · Margin -->
                        @if (expandedVariants().has(item.v.id)) {
                          <div class="vc-detail vc-detail--6col">
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
                              <label class="vc-lbl">{{ t('product.variants.col.barcode') }}</label>
                              <input class="inp inp-sm mono" [placeholder]="variantBarcodePreview(item.v)"
                                     [ngModel]="item.v.barcode"
                                     (ngModelChange)="updateVariant(item.globalIndex, { barcode: $event })"/>
                              <!-- What the printer will actually put on the
                                   label, live as the code is typed. -->
                              @if (variantBarcodePreview(item.v)) {
                                <ap-barcode class="vc-barcode" [value]="variantBarcodePreview(item.v)" [height]="26" [width]="1.3"/>
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

                          <!-- Size-specific note. Explains a detail that only this
                               size has (e.g. a back zipper on the small sizes) so
                               the storefront can say it without a separate photo. -->
                          <div class="vc-detail vc-detail--notes">
                            <div class="vc-field">
                              <label class="vc-lbl">{{ t('product.variants.note.en') }}</label>
                              <input class="inp inp-sm"
                                     [placeholder]="t('product.variants.note.placeholderEn')"
                                     [ngModel]="item.v.noteEn"
                                     (ngModelChange)="updateVariant(item.globalIndex, { noteEn: $event })"/>
                            </div>
                            <div class="vc-field">
                              <label class="vc-lbl">{{ t('product.variants.note.ar') }}</label>
                              <input class="inp inp-sm" dir="rtl"
                                     [placeholder]="t('product.variants.note.placeholderAr')"
                                     [ngModel]="item.v.noteAr"
                                     (ngModelChange)="updateVariant(item.globalIndex, { noteAr: $event })"/>
                            </div>
                          </div>
                          <p class="vc-note-hint muted small">{{ t('product.variants.note.hint') }}</p>
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
                  <button class="btn btn-outline btn-sm" [class.is-active]="barcodeSheetOpen()" (click)="toggleBarcodeSheet()">
                    <ap-icon name="barcode" [size]="12"/>
                    {{ barcodeSheetOpen() ? t('product.variants.hideBarcodes') : t('product.variants.showBarcodes') }}
                  </button>
                  <button class="btn btn-outline btn-sm" (click)="printAllVariantLabels()">
                    <ap-icon name="barcode" [size]="12"/> {{ t('product.variants.printAllLabels') }}
                  </button>
                  <button class="btn btn-outline btn-sm" (click)="addVariant()">
                    <ap-icon name="plus" [size]="12"/> {{ t('product.variants.add') }}
                  </button>
                </div>
              </div>

              <!-- Every variant's barcode, on the page. The same JsBarcode
                   render and the same four lines the label printer emits, so
                   the codes can be checked (and scan-tested off the screen)
                   without burning a roll of labels first. -->
              @if (barcodeSheetOpen()) {
                <div class="barcode-sheet">
                  <div class="barcode-sheet-head">
                    <div>
                      <div class="strong small">{{ t('product.variants.barcodeSheet.title') }}</div>
                      <div class="muted small">{{ t('product.variants.barcodeSheet.sub') }}</div>
                    </div>
                    <button class="btn btn-outline btn-sm" (click)="printAllVariantLabels()">
                      <ap-icon name="barcode" [size]="12"/> {{ t('product.variants.printAllLabels') }}
                    </button>
                  </div>
                  <div class="barcode-grid">
                    @for (v of form().variants; track v.id) {
                      <div class="barcode-card">
                        <div class="bc-brand">{{ product?.brand || 'Elite' }}</div>
                        <div class="bc-name">{{ form().name }}</div>
                        @if (variantLabelText(v)) { <div class="bc-variant">{{ variantLabelText(v) }}</div> }
                        <ap-barcode [value]="variantBarcodePreview(v)" [height]="40"/>
                        <div class="bc-code mono">{{ variantBarcodePreview(v) || '—' }}</div>
                        <div class="bc-price-row">
                          <span class="bc-price">QAR {{ (+v.price || 0).toFixed(2) }}</span>
                          <span class="bc-price-ar" dir="rtl">{{ arabicPrice(+v.price || 0) }}</span>
                        </div>
                        <button class="btn btn-ghost btn-sm bc-print" (click)="printVariantLabel(v)">
                          <ap-icon name="barcode" [size]="11"/> {{ t('product.variants.printLabel') }}
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }
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
          <!-- Hook: single line, used on the home hero and other compact
               surfaces. Plain text on purpose — no rich formatting fits there. -->
          <div class="short-desc-grid mb-24">
            <div>
              <label class="lbl">
                {{ t('product.field.shortEn') }}
                <span class="short-desc-count" [class.over]="(form().shortEn || '').length > 90">
                  {{ (form().shortEn || '').length }}/90
                </span>
              </label>
              <textarea class="inp" rows="2" dir="ltr"
                        [placeholder]="t('product.field.shortEn.ph')"
                        [ngModel]="form().shortEn"
                        (ngModelChange)="set('shortEn', $event)"></textarea>
            </div>
            <div>
              <label class="lbl">
                {{ t('product.field.shortAr') }}
                <span class="short-desc-count" [class.over]="(form().shortAr || '').length > 90">
                  {{ (form().shortAr || '').length }}/90
                </span>
              </label>
              <textarea class="inp" rows="2" dir="rtl"
                        [placeholder]="t('product.field.shortAr.ph')"
                        [ngModel]="form().shortAr"
                        (ngModelChange)="set('shortAr', $event)"></textarea>
            </div>
          </div>
          <p class="short-desc-hint">{{ t('product.field.shortHint') }}</p>

          <!-- Short description: shown directly under the product name on the
               product detail page. Plain text, same compact shape as the Hook. -->
          <div class="short-desc-grid mb-24">
            <div>
              <label class="lbl">
                {{ t('product.field.teaserEn') }}
                <span class="short-desc-count" [class.over]="(form().teaserEn || '').length > 160">
                  {{ (form().teaserEn || '').length }}/160
                </span>
              </label>
              <textarea class="inp" rows="2" dir="ltr"
                        [placeholder]="t('product.field.teaserEn.ph')"
                        [ngModel]="form().teaserEn"
                        (ngModelChange)="set('teaserEn', $event)"></textarea>
            </div>
            <div>
              <label class="lbl">
                {{ t('product.field.teaserAr') }}
                <span class="short-desc-count" [class.over]="(form().teaserAr || '').length > 160">
                  {{ (form().teaserAr || '').length }}/160
                </span>
              </label>
              <textarea class="inp" rows="2" dir="rtl"
                        [placeholder]="t('product.field.teaserAr.ph')"
                        [ngModel]="form().teaserAr"
                        (ngModelChange)="set('teaserAr', $event)"></textarea>
            </div>
          </div>
          <p class="short-desc-hint">{{ t('product.field.teaserHint') }}</p>

          <!-- Product note: a fact that holds for the whole product, shown on
               the storefront without waiting for a size to be picked. A size
               note set on a variant stacks underneath it rather than replacing
               it, so both can be true at once. -->
          <div class="short-desc-grid mb-24">
            <div>
              <label class="lbl">
                {{ t('product.field.noteEn') }}
                <span class="short-desc-count" [class.over]="(form().noteEn || '').length > 80">
                  {{ (form().noteEn || '').length }}/80
                </span>
              </label>
              <input class="inp" dir="ltr"
                     [placeholder]="t('product.field.noteEn.ph')"
                     [ngModel]="form().noteEn"
                     (ngModelChange)="set('noteEn', $event)"/>
            </div>
            <div>
              <label class="lbl">
                {{ t('product.field.noteAr') }}
                <span class="short-desc-count" [class.over]="(form().noteAr || '').length > 80">
                  {{ (form().noteAr || '').length }}/80
                </span>
              </label>
              <input class="inp" dir="rtl"
                     [placeholder]="t('product.field.noteAr.ph')"
                     [ngModel]="form().noteAr"
                     (ngModelChange)="set('noteAr', $event)"/>
            </div>
          </div>
          <p class="short-desc-hint">{{ t('product.field.noteHint') }}</p>

          <div class="mb-24">
            <label class="lbl">{{ t('product.field.careEn') }}</label>
            <ap-rich-text
              dir="ltr"
              [value]="form().careEn"
              [ariaLabel]="t('product.field.careEn')"
              (valueChange)="set('careEn', $event)"/>
          </div>
          <div class="mb-24">
            <label class="lbl">{{ t('product.field.careAr') }}</label>
            <ap-rich-text
              dir="rtl"
              [value]="form().careAr"
              [ariaLabel]="t('product.field.careAr')"
              (valueChange)="set('careAr', $event)"/>
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
                    } @else {
                      <img class="no-img" [src]="noImageLogo" [alt]="p.name" />
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
          <input class="inp mb-16" [placeholder]="seoTitlePlaceholder()" [ngModel]="form().metaTitle" (ngModelChange)="set('metaTitle', $event)"/>
          <label class="lbl">{{ t('product.field.metaDesc') }}</label>
          <div class="meta-desc-wrap mb-16">
            <textarea class="inp" rows="3" [placeholder]="seoDescPlaceholder()" [ngModel]="form().metaDesc" (ngModelChange)="set('metaDesc', $event)" maxlength="160" style="resize:vertical;"></textarea>
            <div class="char-counter" [class.over]="form().metaDesc.length > 160">{{ form().metaDesc.length }}/160</div>
          </div>
          <label class="lbl">{{ t('product.field.slug') }}</label>
          <input class="inp mono" [placeholder]="slugPlaceholder()" [ngModel]="form().slug" (ngModelChange)="set('slug', $event)" [class.inp-invalid]="slugError()"/>
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
      <div class="overlay" style="z-index:260;" (click)="closeMediaPicker()"></div>
      <div class="media-pick-panel" style="z-index:270;">
        <div class="mpp-head">
          <div>
            <p class="mpp-eyebrow">{{ t('product.gallery.library') }}</p>
            <div class="card-title">{{ t('product.gallery.selectImages') }}</div>
          </div>
          <button class="x-btn" type="button" (click)="closeMediaPicker()"><ap-icon name="x" [size]="14"/></button>
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
            <button class="btn btn-outline" type="button" (click)="closeMediaPicker()">{{ t('common.cancel') }}</button>
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
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    /* Short description: plain text, two columns, with a soft length guide.
       The counter turns amber past 90 chars because longer copy wraps past
       two lines in the home hero rather than being truncated. */
    .short-desc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 700px) { .short-desc-grid { grid-template-columns: 1fr; } }
    .short-desc-count { float: inline-end; font-size: 11px; color: var(--muted); font-weight: 400; }
    .short-desc-count.over { color: var(--warning, #b8860b); font-weight: 600; }
    .price-mismatch {
      display: grid;
      justify-items: start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--warning, #d97706);
      background: color-mix(in srgb, var(--warning, #d97706) 8%, transparent);
      color: var(--ink);
      font-size: 12px;
      line-height: 1.4;
    }
    .short-desc-hint { margin: -16px 0 24px; font-size: 12px; color: var(--muted); }

    /* Google Drive import modal — mirrors media.component.ts's own gdrive-*
       styles; component-scoped styles don't cross component boundaries, so
       this small block is duplicated rather than shared. */
    .gdrive-modal { width: min(520px, 96vw); }
    .gdrive-eyebrow {
      margin: 0 0 4px;
      color: var(--gold);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .gdrive-info {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border-2);
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .gdrive-info ap-icon { flex-shrink: 0; margin-top: 1px; }
    .gdrive-error {
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.25);
      color: #dc2626;
      font-size: 12px;
      font-weight: 600;
    }

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
    /* A variant started with "Add variant", waiting for its colour */
    .vcg--new { box-shadow: inset 0 0 0 2px var(--warning, #d97706); border-radius: 8px; }
    .vcg-new-label { font-size: 11px; font-weight: 600; color: var(--ink); white-space: nowrap; }
    .vcg-new-hint { margin: 0; padding: 10px 12px 12px; font-size: 12px; color: var(--ink); }

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

    .vcg-sku-tools {
      display: grid;
      grid-template-columns: minmax(230px, 1fr) auto minmax(250px, auto);
      gap: 12px;
      align-items: end;
      padding: 12px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border-2);
    }
    .vcg-sku-field { display: grid; gap: 5px; color: var(--text-2); font-size: 11px; font-weight: 700; }
    .vcg-sku-example { align-self: center; white-space: nowrap; }

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
    .vc-img-picker-more {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; margin-top: 10px; padding: 7px 8px;
      border: 1px dashed var(--border); border-radius: 8px;
      background: none; cursor: pointer;
      font-size: 11px; font-weight: 600; color: var(--muted);
      transition: color 0.12s, border-color 0.12s, background 0.12s;
    }
    .vc-img-picker-more:hover { color: var(--ink); border-color: var(--ink-2); background: var(--bg); }
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

    /* Row the save check or "Add variant" just pointed at */
    .vc--flash { box-shadow: inset 0 0 0 2px var(--warning, #d97706); border-radius: 8px; }

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
    .vc-detail--6col { grid-template-columns: 1.2fr 1.3fr 0.9fr 0.9fr 0.8fr 0.8fr; }
    /* Notes are sentences, not figures — they get their own full-width row. */
    .vc-detail--notes { grid-template-columns: 1fr 1fr; border-top-style: solid; }
    .vc-note-hint { margin: 2px 0 6px; line-height: 1.5; }
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

    /* Live barcode under the code field, so a typo is visible where it is
       made rather than on the printed sticker. */
    .vc-barcode { margin-top: 4px; }

    /* Every variant's barcode, on the page. Cards mirror the printed label's
       stacking order: brand, name, Arabic name, variant, bars, code, price,
       Arabic price. */
    .barcode-sheet {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .barcode-sheet-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
    }
    .barcode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 12px;
    }
    .barcode-card {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: 12px 10px 8px;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      text-align: center;
    }
    .bc-brand {
      font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--muted);
    }
    .bc-name { font-size: 11px; font-weight: 700; line-height: 1.2; }
    .bc-variant { font-size: 9.5px; color: var(--muted); margin-bottom: 4px; }
    .bc-code { font-size: 8.5px; letter-spacing: 0.03em; color: #333; }
    /* Both prices on one line, at the two edges — same as the printed label. */
    .bc-price-row {
      display: flex; align-items: baseline; justify-content: space-between;
      width: 100%; gap: 6px; margin-top: 2px;
    }
    .bc-price, .bc-price-ar { font-size: 11px; font-weight: 700; }
    .bc-print { margin-top: 6px; }

    @media (max-width: 640px) {
      .barcode-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
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

    .vt-print {
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
    .vt-print:hover { color: var(--gold); border-color: rgba(193,154,91,0.3); background: var(--gold-3); }

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
    .gen-sizes-wrap { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }

    @media (max-width: 900px) {
      .vcg-sku-tools { grid-template-columns: 1fr; align-items: stretch; }
      .vcg-sku-example { white-space: normal; }
      .gen-sizes-wrap { justify-content: stretch; }
      .gen-sizes-wrap select { flex: 1; }
    }

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
      .vc-cell--sku   { grid-column: 2 / 5; grid-row: 3; display: block; margin-top: 4px; }
      .vc-cell--actions { grid-column: 5; grid-row: 1 / 4; align-self: center; flex-direction: column; }
      .vc-detail { grid-template-columns: 1fr 1fr; }
      .vc-detail--5col { grid-template-columns: 1fr 1fr 1fr; }
      .vc-detail--6col { grid-template-columns: 1fr 1fr; }
      .vc-detail--notes { grid-template-columns: 1fr; }
      .vc-field--margin,
      .vc-field--total-cost { display: none; }

      /* Grouped (color-accordion) size rows: Size | Stock | Price + stacked
         actions, with the editable SKU on a second row.
         Every cell's grid-row is reset to 1 here — the generic (ungrouped)
         mobile rules above target these same cell classes with grid-row: 2,
         and since those selectors share this rule's specificity, leaving
         any cell's row unset lets that stale rule win and reopens a phantom
         second row that the actions column (grid-row: 1 / 3) bleeds into. */
      .vc-header--group { display: none; }
      .vc-row--grouped {
        grid-template-columns: 1fr 1fr 1fr 44px !important;
        grid-template-rows: auto auto !important;
      }
      .vc-row--grouped .vc-cell--size   { grid-column: 1; grid-row: 1; }
      .vc-row--grouped .vc-cell--num    { grid-column: 2; grid-row: 1; }
      .vc-row--grouped .vc-cell--price  { grid-column: 3; grid-row: 1; }
      .vc-row--grouped .vc-cell--sku    { display: block; grid-column: 1 / 4; grid-row: 2; margin-top: 4px; }
      .vc-row--grouped .vc-cell--actions {
        grid-column: 4;
        grid-row: 1 / 3;
        flex-direction: column;
        align-self: center;
      }
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
  `]
})
export class ProductDrawerComponent implements OnInit, OnDestroy {
  readonly noImageLogo = NO_IMAGE_LOGO;

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

  private readonly restockApi = inject(RestockRequestsService);
  readonly restockDemand = signal<RestockSummary[]>([]);
  waitingForVariant(v: ProductVariant): number {
    return this.restockDemand().find(r => r.color_key === colorKey(v.color) && r.size === (String(v.size ?? '').trim() || 'ONE_SIZE'))?.waiting_count || 0;
  }
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly productsApi = inject(AdminProductsService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  private readonly refApi = inject(AdminRefService);
  private readonly uploads = inject(MediaUploadService);
  private readonly mediaApi = inject(AdminMediaService);
  private readonly storage = inject(StorageService);
  private readonly labelPrinter = inject(LabelPrinterService);

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

  /** What the server generates when these are left empty, shown as placeholders. */
  seoTitlePlaceholder(): string {
    const f = this.form();
    return [f.name, f.brand, 'Elite Collection'].filter(Boolean).join(' · ');
  }
  seoDescPlaceholder(): string {
    const name = this.form().name;
    return name ? `Buy the ${name} from our Doha atelier. Hand-crafted leather. Free shipping in Qatar.` : '';
  }
  /** Same rule as server `slugify()` in routes/lib.js. */
  slugPlaceholder(): string {
    return this.form().name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  readonly slugError = computed(() => {
    const s = this.form().slug;
    return !!s && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
  });

  readonly duplicating = signal(false);
  readonly expandedVariants = signal(new Set<string>());
  /** Only IDs created during this open editor session are safe to regenerate. */
  private readonly autoGeneratedVariantIds = signal(new Set<string>());
  /** Keeps the prefix while the product SKU field is temporarily empty during
      a replace-all edit, so variant suffixes do not get lost between keys. */
  private readonly lastNonEmptyProductSku = signal('');
  /** Unsaved typing state for each colour's base SKU. It deliberately lives
      outside the product schema: the generated variant SKUs are the durable
      source of truth and the base is recovered from them when reopening. */
  private readonly colorSkuDrafts = signal<Record<string, string>>({});
  readonly barcodeSheetOpen = signal(false);

  // ── Bulk Stock Update ─────────────────────────────────────────────────
  readonly bulkStockOpen = signal(false);
  readonly bulkStockSaving = signal(false);
  readonly bulkStockSetAll = signal<number | null>(null);
  readonly bulkStockRows = signal<{ id: string; color: string; size: string; sku: string; stock: number }[]>([]);
  readonly variantPickerOpenId = signal<string | null>(null);
  /** Colour picker to reopen once the media library closes (set by openLibraryForVariantPicker). */
  private readonly variantPickerResumeId = signal<string | null>(null);

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

    this.restockDemand.set([]);
    if (!p.id.startsWith('P-NEW-')) void this.restockApi.summary(`productId=${encodeURIComponent(p.id)}`).then(rows => {
      if (this.product?.id === p.id) this.restockDemand.set(rows);
    }).catch(() => {});
    this.initial.set(this.makeFormFromProduct(p));
    this.form.set({ ...this.initial() });
    this.lastNonEmptyProductSku.set(p.sku || '');
    this.saveState.set('idle');
    this.lastSavedAt.set(null);
    this.draftRestoredAt.set(null);
    this.autoGeneratedVariantIds.set(new Set());
    this.colorSkuDrafts.set({});
    this.pendingVariantIds.set(new Set());
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);

    // Try to restore a draft for this product
    try {
      const raw = this.storage.get(this.draftBase);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Resume only a draft made against the data loaded now. If the product
        // changed since (a sale, another admin's save), replaying the draft
        // would write old stock and prices back.
        if (parsed && parsed.savedAt && JSON.stringify(parsed.base) === JSON.stringify(this.initial())) {
          this.form.set(parsed.form);
          this.draftRestoredAt.set(parsed.savedAt);
          this.saveState.set('dirty');
        } else {
          this.storage.remove(this.draftBase);
        }
      }
    } catch {}
  }

  private makeEmptyForm(): FormShape {
    return {
      name: '', nameAr: '', sku: '', brand: '', collectionIds: [],
      // HIDDEN-POS-TOGGLE: forced false while the toggle is hidden (see template).
      price: 0, defaultCostPrice: null, defaultShippingCost: null,
      stock: 0, hidden: false, posHidden: false,
      duplicatedFromProductId: null,
      enDesc: '', arDesc: '',
      shortEn: '', shortAr: '',
      teaserEn: '', teaserAr: '',
      noteEn: '', noteAr: '',
      careEn: '', careAr: '',
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
      defaultCostPrice: p.defaultCostPrice ?? null,
      defaultShippingCost: p.defaultShippingCost ?? null,
      stock: p.stock,
      duplicatedFromProductId: p.duplicatedFromProductId ?? null,
      hidden: p.hidden,
      // HIDDEN-POS-TOGGLE: ignore the stored value and force every product
      // available on POS while the toggle is hidden — otherwise a product
      // that already had posHidden=true would stay stuck hidden from POS
      // with no visible control left to fix it. Restore `p.posHidden ?? false`
      // when un-hiding the toggle above.
      posHidden: false,
      enDesc: p.enDesc ?? '',
      arDesc: p.arDesc ?? '',
      shortEn: p.shortEn ?? '',
      shortAr: p.shortAr ?? '',
      teaserEn: p.teaserEn ?? '',
      teaserAr: p.teaserAr ?? '',
      noteEn: p.noteEn ?? '',
      noteAr: p.noteAr ?? '',
      careEn: p.careEn ?? '',
      careAr: p.careAr ?? '',
      // Empty means "generate": the server fills slug from the name, and the
      // inputs show the generated SEO text as placeholders only.
      metaTitle: p.metaTitle || '',
      metaDesc: p.metaDesc || '',
      slug: p.slug || '',
      variants: (p.variants ?? []).map(v => ({ ...v })),
      images: p.images && p.images.length > 0 ? [...p.images] : (p.image ? [p.image] : []),
      imageColors: { ...(p.imageColors ?? {}) },
      relatedProductIds: [...(p.relatedProductIds ?? [])],
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Image gallery
  // ────────────────────────────────────────────────────────────────────

  readonly gdriveOpen = signal(false);
  readonly gdriveUrl = signal('');
  readonly gdriveLoading = signal(false);
  readonly gdriveError = signal('');

  openGDrive(): void {
    this.gdriveUrl.set('');
    this.gdriveError.set('');
    this.gdriveOpen.set(true);
  }

  async importGDrive(): Promise<void> {
    const url = this.gdriveUrl().trim();
    if (!url || this.gdriveLoading()) return;
    this.gdriveError.set('');
    this.gdriveLoading.set(true);
    try {
      const imported = await this.mediaApi.importFromGDrive(url);
      if (imported.length === 0) {
        this.gdriveError.set('No images were found at that URL. Make sure the file/folder is publicly shared.');
        return;
      }
      const existing = new Set(this.form().images);
      const newUrls = imported
        .map(f => f.preview || f.storageUrl)
        .filter((u): u is string => !!u && !existing.has(u));
      if (newUrls.length > 0) {
        this.set('images', [...this.form().images, ...newUrls]);
      }
      this.gdriveOpen.set(false);
      this.toast.success(
        `${imported.length} image${imported.length === 1 ? '' : 's'} added`,
        this.t('product.gallery.upload'),
      );
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || this.t('media.toast.importFailed');
      this.gdriveError.set(msg);
    } finally {
      this.gdriveLoading.set(false);
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
    this.closeMediaPicker();
  }

  closeMediaPicker(): void {
    this.mediaPicker.set(false);
    const resumeId = this.variantPickerResumeId();
    if (resumeId) {
      this.variantPickerResumeId.set(null);
      this.variantPickerOpenId.set(resumeId);
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

  /** Estimates the raw byte size already sitting in the draft's local (not
      yet uploaded) gallery images, by inverting base64's ~4/3 expansion.
      Used to budget how many more pre-save images the JSON request can
      still fit under its 10 MB limit. */
  private presaveImageBytes(): number {
    return this.form().images
      .filter((src) => src.startsWith('data:'))
      .reduce((total, src) => total + Math.floor(((src.length - src.indexOf(',') - 1) * 3) / 4), 0);
  }

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
      // works before the product exists on the server. These ride inside
      // the JSON create-product request (10 MB limit), not the multipart
      // upload's 50 MB one, so they're validated against the much lower
      // pre-save budget instead of the real per-file limit.
      let runningBytes = this.presaveImageBytes();
      let added = 0;
      for (const file of files) {
        const reason = this.uploads.validate(file, PRESAVE_IMAGE_MAX_BYTES);
        if (reason) {
          this.toast.error(reason, file.name);
          continue;
        }
        if (runningBytes + file.size > PRESAVE_IMAGE_TOTAL_BUDGET_BYTES) {
          this.toast.warning(
            'These photos are getting large for an unsaved product',
            'Save the product first, then add the rest from its gallery — that path allows up to 50 MB per image.',
          );
          break;
        }
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            const url = reader.result as string;
            this.set('images', [...this.form().images, url]);
            resolve();
          };
          reader.readAsDataURL(file);
        });
        runningBytes += file.size;
        added += 1;
      }
      if (added > 0) this.toast.info(this.t('product.gallery.upload'), this.t('product.gallery.empty.sub'));
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

    const uploadProductId = this.product.id;
    const uploadProductName = this.product.name;
    try {
      await new Promise<void>((resolve, reject) => {
        const filesToSend = accepted.map((a) => a.file);
        let lastPercent = 0;
        this.uploads.uploadProductImages(uploadProductId, filesToSend).subscribe({
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
              // Saved on its own product. If the editor moved on meanwhile, leave
              // the other product's form alone.
              if (result?.images && this.product?.id === uploadProductId) {
                // Add the new server images without dropping unsaved gallery
                // edits (reorder, removals); the baseline is the server list.
                const added = result.images.filter((url) => !this.initial().images.includes(url));
                const images = [...this.form().images, ...added.filter((url) => !this.form().images.includes(url))];
                this.set('images', images);
                this.set('imageColors', this.pruneImageColors(this.form().imageColors, images));
                this.initial.set({
                  ...this.initial(),
                  images: [...result.images],
                  imageColors: this.pruneImageColors(this.initial().imageColors, result.images),
                });
              }
              this.toast.success(
                `${result?.uploaded ?? accepted.length} ${this.t('product.gallery.upload').toLowerCase()}`,
                uploadProductName,
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

  /** Cost and shipping cost a new variant should start with: whatever an
   *  existing variant of the same colour already has, so generating sizes
   *  or adding a row never resets them to blank. Falls back to any variant
   *  on the product when the colour has none yet. */
  private inheritedCosts(colorName: string): Pick<ProductVariant, 'costPrice' | 'shippingCost'> {
    const variants = this.form().variants;
    const sameColor = variants.find(v =>
      colorName && this.colorKey(v.color || '') === this.colorKey(colorName)
      && (v.costPrice != null || v.shippingCost != null));
    const source = sameColor ?? variants.find(v => v.costPrice != null || v.shippingCost != null);
    return {
      costPrice: source?.costPrice ?? this.form().defaultCostPrice ?? undefined,
      shippingCost: source?.shippingCost ?? this.form().defaultShippingCost ?? undefined,
    };
  }

  addVariant(): void {
    // One new variant at a time: a second click brings back the one still
    // waiting for its colour instead of stacking blank rows.
    const waiting = this.form().variants.find(v => !v.color && this.pendingVariantIds().has(v.id));
    if (waiting) {
      this.revealVariant(waiting.id);
      return;
    }
    const f = this.form();
    const id = 'V-' + Date.now().toString(36);
    const next: ProductVariant = {
      id,
      sku: '',
      size: '',
      color: '',
      material: '',
      price: f.price || 0,
      stock: 0,
      ...this.inheritedCosts(''),
    };
    this.markVariantSkuAutomatic(id);
    this.pendingVariantIds.update(ids => new Set(ids).add(id));
    this.set('variants', [...f.variants, next]);
    // Its own group opens at the top with the colour select focused.
    this.revealVariant(id);
  }

  updateVariant(index: number, patch: Partial<ProductVariant>): void {
    const current = this.form().variants[index];
    if (!current) return;
    const nextSize = String(patch.size ?? '').trim();
    if (nextSize && this.form().variants.some(v => v.id !== current.id
      && this.groupKeyOf(v) === this.groupKeyOf(current)
      && String(v.size || '').trim() === nextSize)) {
      this.toast.error(this.t('product.variants.duplicateSize.title'), `${nextSize} · ${this.t('product.variants.duplicateSize.sub')}`);
      return;
    }
    if (this.flashVariantId() === current.id) this.flashVariantId.set(null);
    const manualSkuEdit = Object.prototype.hasOwnProperty.call(patch, 'sku');
    if (manualSkuEdit) this.unmarkVariantSkuAutomatic(current.id);
    const currentBaseSku = this.baseSkuForVariant(current);
    const followsGeneratedFormat = !!current.size
      && current.sku === formatVariantSku(currentBaseSku, current.size);
    const updateSkuAutomatically = !manualSkuEdit && (
      this.autoGeneratedVariantIds().has(current.id)
      || (Object.prototype.hasOwnProperty.call(patch, 'size') && followsGeneratedFormat)
    );
    const next = this.form().variants.map((v, i) => {
      if (i !== index) return v;
      const updated = { ...v, ...patch };
      return updateSkuAutomatically
        ? { ...updated, sku: formatVariantSku(currentBaseSku, updated.size) }
        : updated;
    });
    this.set('variants', next);
    if (Object.prototype.hasOwnProperty.call(patch, 'size')) this.warnIfDuplicateVariantSkus(next);
  }

  async removeVariant(index: number): Promise<void> {
    const removed = this.form().variants[index];
    if (!removed) return;
    // Rows added in this session and holding no stock go straight away; a saved
    // row or one with stock asks first, because saving zeroes that stock.
    const isSaved = this.initial().variants.some(v => v.id === removed.id);
    if (isSaved || removed.stock > 0) {
      const key = removed.stock > 0 ? 'product.variants.removeConfirm.stock' : 'product.variants.removeConfirm.saved';
      const confirmed = await this.confirm.ask({
        title: this.t('product.variants.removeConfirm'),
        message: this.t(key).replace('{sku}', removed.sku || removed.size || '-').replace('{n}', String(removed.stock)),
        confirmLabel: this.t('common.remove'),
        variant: 'danger',
      });
      if (!confirmed) return;
    }
    // By id, not index: the list can change while the dialog is open.
    const next = this.form().variants.filter(v => v.id !== removed.id);
    this.unmarkVariantSkuAutomatic(removed.id);
    this.expandedVariants.update(ids => { const n = new Set(ids); n.delete(removed.id); return n; });
    const groupKey = this.groupKeyOf(removed);
    this.pendingVariantIds.update(ids => { const n = new Set(ids); n.delete(removed.id); return n; });
    if (!next.some(v => this.groupKeyOf(v) === groupKey)) {
      // Last size of that colour: drop the colour's UI state and photo links
      // so they do not come back if the colour is added again.
      this.expandedGroups.update(keys => { const n = new Set(keys); n.delete(groupKey); return n; });
      this.colorSkuDrafts.update(drafts => { const n = { ...drafts }; delete n[groupKey]; return n; });
      const imageColors = Object.fromEntries(Object.entries(this.form().imageColors)
        .filter(([, color]) => this.colorKey(color) !== groupKey));
      if (Object.keys(imageColors).length !== Object.keys(this.form().imageColors).length) {
        this.set('imageColors', imageColors);
      }
    }
    this.set('variants', next);
  }

  readonly flashVariantId = signal<string | null>(null);

  /** Opens the row's colour group, scrolls it into view and focuses its first
      control, so an added or invalid variant is never hidden in a collapsed group. */
  private revealVariant(id: string, flash = false): void {
    const variant = this.form().variants.find(v => v.id === id);
    if (!variant) return;
    const groupKey = this.groupKeyOf(variant);
    this.expandedGroups.update(keys => new Set(keys).add(groupKey));
    if (flash) this.flashVariantId.set(id);
    setTimeout(() => {
      // A new variant has no rows yet, only its colour select.
      const target = groupKey === this.newGroupKey
        ? document.querySelector<HTMLElement>(`[data-group-key="${this.newGroupKey}"]`)
        : document.querySelector<HTMLElement>(`[data-variant-id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
    });
  }

  private markVariantSkuAutomatic(id: string): void {
    this.autoGeneratedVariantIds.update(ids => new Set(ids).add(id));
  }

  private markVariantSkusAutomatic(ids: string[]): void {
    this.autoGeneratedVariantIds.update(current => {
      const next = new Set(current);
      ids.forEach(id => next.add(id));
      return next;
    });
  }

  private unmarkVariantSkuAutomatic(id: string): void {
    this.autoGeneratedVariantIds.update(ids => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }

  private duplicateVariantSku(variants = this.form().variants): string | null {
    const seen = new Set<string>();
    for (const variant of variants) {
      const sku = String(variant.sku || '').trim();
      if (!sku) continue;
      if (seen.has(sku)) return sku;
      seen.add(sku);
    }
    return null;
  }

  private warnIfDuplicateVariantSkus(variants: ProductVariant[]): boolean {
    const duplicate = this.duplicateVariantSku(variants);
    if (duplicate) {
      this.toast.error(this.t('product.variants.duplicateSku.title'), `${duplicate} · ${this.t('product.variants.duplicateSku.sub')}`);
      return true;
    }
    return false;
  }

  colorHex(name: string | undefined): string {
    if (!name) return '#e5e7eb';
    return this.refColors().find(c => c.name_en === name)?.hex ?? '#e5e7eb';
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
      const key = this.groupKeyOf(v);
      if (!map.has(key)) map.set(key, { colorKey: key, colorName: v.color || '', items: [] });
      map.get(key)!.items.push({ v, globalIndex });
    });

    // A variant started with "Add variant" sits on top, apart from older
    // colourless rows, until its colour is chosen.
    const groups = [...map.values()];
    return [
      ...groups.filter(g => g.colorKey === this.newGroupKey),
      ...groups.filter(g => g.colorKey !== this.newGroupKey),
    ];
  });

  readonly expandedGroups = signal<Set<string>>(new Set());

  /** Ids made by "Add variant" whose colour is not chosen yet. They get their
      own group so they never mix with older rows that have no colour. */
  readonly pendingVariantIds = signal<Set<string>>(new Set());
  readonly newGroupKey = '__new__';

  private groupKeyOf(v: ProductVariant): string {
    return !v.color && this.pendingVariantIds().has(v.id) ? this.newGroupKey : this.colorKey(v.color || '');
  }

  /** This colour's rows added in this session that are still blank (no size, no SKU). */
  private emptySessionRows(colorName: string): ProductVariant[] {
    const saved = new Set(this.initial().variants.map(v => v.id));
    const key = this.colorKey(colorName);
    return this.form().variants.filter(v => !saved.has(v.id)
      && this.groupKeyOf(v) === key
      && !String(v.size || '').trim()
      && !String(v.sku || '').trim());
  }

  private colorKey(colorName: string): string {
    return String(colorName || '').trim().toLowerCase() || '__none__';
  }

  colorVariantBaseSku(
    colorName: string,
    items: { v: ProductVariant; globalIndex: number }[] = [],
  ): string {
    const key = this.colorKey(colorName);
    const drafts = this.colorSkuDrafts();
    if (Object.prototype.hasOwnProperty.call(drafts, key)) return drafts[key];
    // A legacy size-less row (e.g. 1493-GF-WHT beside 1493-GF-WHI-5) has no
    // size suffix to strip, so its whole SKU would read as the base and flip
    // once that row is removed. Read the base from a sized row first.
    const hasSku = (item: { v: ProductVariant }) => !!String(item.v.sku || '').trim();
    const saved = items.find(item => hasSku(item) && String(item.v.size || '').trim())
      ?? items.find(hasSku);
    return saved ? variantBaseSku(saved.v.sku, saved.v.size) : '';
  }

  setColorVariantBaseSku(colorName: string, value: string): void {
    const key = this.colorKey(colorName);
    const rawBase = String(value || '');
    this.colorSkuDrafts.update(drafts => ({ ...drafts, [key]: rawBase }));
    const affectedIds: string[] = [];
    const next = this.form().variants.map(variant => {
      if (this.colorKey(variant.color || '') !== key || !variant.size) return variant;
      affectedIds.push(variant.id);
      return { ...variant, sku: formatVariantSku(rawBase, variant.size) };
    });
    this.markVariantSkusAutomatic(affectedIds);
    this.set('variants', next);
    this.warnIfDuplicateVariantSkus(next);
  }

  private baseSkuForVariant(variant: ProductVariant): string {
    if (!variant.color) return this.form().sku;
    const groupItems = this.form().variants
      .map((v, globalIndex) => ({ v, globalIndex }))
      .filter(item => this.colorKey(item.v.color || '') === this.colorKey(variant.color || ''));
    return this.colorVariantBaseSku(variant.color, groupItems) || variantBaseSku(variant.sku, variant.size);
  }

  toggleGroup(key: string): void {
    this.expandedGroups.update(s => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  addVariantForColor(colorName: string): void {
    // Fill this colour's empty new row first (e.g. the one "Add variant" made).
    const empty = this.emptySessionRows(colorName)[0];
    if (empty) {
      this.revealVariant(empty.id, true);
      return;
    }
    const f = this.form();
    const id = 'V-' + Date.now().toString(36);
    const next: ProductVariant = {
      id,
      sku:      '',
      size:     '',
      color:    colorName,
      material: '',
      price:    f.price || 0,
      stock:    0,
      ...this.inheritedCosts(colorName),
    };
    this.markVariantSkuAutomatic(id);
    this.set('variants', [...f.variants, next]);
    this.revealVariant(id);
  }

  /** Size chart picked per colour group. A signal, not a template reference:
      reading `#ref.value` never re-rendered, so Generate stayed disabled after
      a chart was picked until something else happened on the page. */
  readonly groupSizeSet = signal<Record<string, string>>({});

  pickGroupSizeSet(colorKey: string, sizeSetId: string): void {
    this.groupSizeSet.update(choices => ({ ...choices, [colorKey]: sizeSetId }));
  }

  generateSizesForColor(sizeSetId: string, colorName: string): void {
    const ss = this.refSizeSets().find(s => s.id === sizeSetId);
    if (!ss) return;
    const f = this.form();
    const groupItems = f.variants
      .map((v, globalIndex) => ({ v, globalIndex }))
      .filter(item => this.colorKey(item.v.color || '') === this.colorKey(colorName));
    const colorBaseSku = this.colorVariantBaseSku(colorName, groupItems);
    if (!String(colorBaseSku || '').trim().replace(/-+$/, '')) {
      this.toast.error(this.t('product.variants.baseSkuRequired.title'), this.t('product.variants.baseSkuRequired.sub'));
      return;
    }
    const existingSizes = new Set(
      f.variants
        .filter(v => this.colorKey(v.color || '') === this.colorKey(colorName))
        .map(v => v.size)
    );
    const toAdd = ss.sizes.filter(sz => !existingSizes.has(sz));
    if (toAdd.length === 0) { this.toast.info(this.t('product.variants.allSizesAdded'), ss.name); return; }
    const costs = this.inheritedCosts(colorName);
    const newVariants: ProductVariant[] = toAdd.map(sz => ({
      id:       'V-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      sku:      formatVariantSku(colorBaseSku, sz),
      size:     sz,
      color:    colorName,
      material: '',
      price:    f.price || 0,
      stock:    0,
      ...costs,
    }));
    this.markVariantSkusAutomatic(newVariants.map(v => v.id));
    // The generated sizes replace this colour's blank new rows.
    const blanks = new Set(this.emptySessionRows(colorName).map(v => v.id));
    const next = [...f.variants.filter(v => !blanks.has(v.id)), ...newVariants];
    this.set('variants', next);
    if (!this.warnIfDuplicateVariantSkus(next)) {
      this.toast.success(`${newVariants.length} ${this.t('product.variants.sizesAdded')}`, `${colorName} · ${ss.name}`);
    }
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

  /** Rename a color without rewriting stable SKU identifiers. */
  renameGroupColor(colorKey: string, newColor: string): void {
    if (colorKey === this.newGroupKey) {
      if (!String(newColor || '').trim()) return;
      const pending = this.pendingVariantIds();
      this.pendingVariantIds.set(new Set());
      this.set('variants', this.form().variants.map(v => (pending.has(v.id) && !v.color ? { ...v, color: newColor } : v)));
      // Next step is the size: open that colour's group at the new row.
      const first = this.form().variants.find(v => pending.has(v.id));
      if (first) this.revealVariant(first.id);
      return;
    }
    const f = this.form();
    const targetKey = this.colorKey(newColor);
    if (targetKey !== colorKey) {
      const sizesIn = (key: string) => new Set(f.variants
        .filter(v => this.groupKeyOf(v) === key)
        .map(v => String(v.size || '').trim())
        .filter(Boolean));
      const target = sizesIn(targetKey);
      if ([...sizesIn(colorKey)].some(size => target.has(size))) {
        this.toast.error(this.t('product.variants.renameConflict.title'), this.t('product.variants.renameConflict.sub'));
        // Re-emit the list so the colour <select> snaps back to the old value.
        this.form.update(current => ({ ...current, variants: [...current.variants] }));
        return;
      }
    }
    const next = f.variants.map(v => {
      if (this.groupKeyOf(v) !== colorKey) return v;
      return { ...v, color: newColor };
    });
    const draft = this.colorSkuDrafts()[colorKey];
    if (draft !== undefined) {
      this.colorSkuDrafts.update(drafts => {
        const renamed = { ...drafts };
        delete renamed[colorKey];
        renamed[this.colorKey(newColor)] = draft;
        return renamed;
      });
    }
    this.set('variants', next);
  }

  generateSizes(sizeSetId: string): void {
    const ss = this.refSizeSets().find(s => s.id === sizeSetId);
    if (!ss) return;
    const f = this.form();
    if (!String(f.sku || '').trim().replace(/-+$/, '')) {
      this.toast.error(this.t('product.variants.baseSkuRequired.title'), this.t('product.variants.baseSkuRequired.sub'));
      return;
    }
    const existing = new Set(f.variants.map(v => v.size));
    const toAdd = ss.sizes.filter(sz => !existing.has(sz));
    const costs = this.inheritedCosts('');
    const newVariants: ProductVariant[] = toAdd.map(sz => ({
      id: 'V-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      sku: formatVariantSku(f.sku, sz),
      size: sz,
      color: '',
      material: '',
      price: f.price || 0,
      stock: 0,
      ...costs,
    }));
    this.markVariantSkusAutomatic(newVariants.map(v => v.id));
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

  /**
   * Set when the product's own price is not the cheapest a customer can pay.
   *
   * The storefront prices from the variant, so this field mostly feeds sorting, the admin
   * list and older reports; leaving it above the cheapest size understates nothing but
   * overstates the product, and leaving it below advertises a price that does not exist.
   */
  basePriceMismatch(): { min: number } | null {
    const prices = this.form().variants.map(v => Number(v.price) || 0).filter(n => n > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    return min === (Number(this.form().price) || 0) ? null : { min };
  }

  alignBasePrice(): void {
    const gap = this.basePriceMismatch();
    if (gap) this.setNum('price', gap.min);
  }

  variantsSummary(): string {
    const n = this.form().variants.length;
    if (n === 0) return '';
    const tpl = n === 1 ? this.t('product.variants.summary.one') : this.t('product.variants.summary.many');
    return tpl.replace('{n}', String(n));
  }

  /** Barcode preview — mirrors the server default (falls back to SKU) so the
      admin sees what will actually be saved before it round-trips. */
  variantBarcodePreview(v: ProductVariant): string {
    return (v.barcode || '').trim() || (v.sku || '').trim();
  }

  /** Colour and size as one line, shared by the label and the on-page sheet. */
  variantLabelText(v: ProductVariant): string {
    return [v.color, v.size].filter(Boolean).join(' · ');
  }

  /** Same formatter the printed label uses, so screen and paper never drift. */
  readonly arabicPrice = arabicPrice;

  private variantLabelData(v: ProductVariant) {
    return {
      brand: this.product?.brand || 'Elite',
      productName: this.form().name || '',
      variantLabel: this.variantLabelText(v),
      sku: v.sku || '',
      barcode: this.variantBarcodePreview(v),
      price: Number(v.price) || 0,
      currency: 'QAR',
    };
  }

  /** The on-page barcode sheet: every variant's code, checkable without
      printing anything. Collapsed by default so the drawer stays short. */
  toggleBarcodeSheet(): void {
    this.barcodeSheetOpen.update((open) => !open);
  }

  printVariantLabel(v: ProductVariant): void {
    this.labelPrinter.printLabels([this.variantLabelData(v)]);
  }

  printAllVariantLabels(): void {
    const labels = this.form().variants.flatMap((variant) => {
      // A stock label represents one physical unit. Printing one label per
      // variant was misleading for a variant with ten pieces in stock.
      const quantity = Math.max(0, Math.floor(Number(variant.stock) || 0));
      return Array.from({ length: quantity }, () => this.variantLabelData(variant));
    });
    if (labels.length === 0) {
      this.toast.warning('No labels to print', 'The current variants have zero stock.');
      return;
    }
    this.labelPrinter.printLabels(labels);
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
    this.variantPickerResumeId.set(null);
  }

  /** Open the media library from inside a colour's picker, and come back to that
      picker afterwards so the newly added image can be linked to the colour. */
  openLibraryForVariantPicker(pickerId: string): void {
    this.variantPickerResumeId.set(pickerId);
    this.variantPickerOpenId.set(null);
    void this.openMediaPicker();
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
    if (k === 'sku') {
      const baseSku = String(v || '');
      const before = this.form();
      const oldBase = String(before.sku || this.lastNonEmptyProductSku() || '').trim();
      if (String(before.sku || '').trim()) this.lastNonEmptyProductSku.set(String(before.sku).trim());
      const cascadeIds = new Set(this.autoGeneratedVariantIds());
      for (const variant of before.variants) {
        const currentSku = String(variant.sku || '').trim();
        if (oldBase && (currentSku === oldBase || currentSku.startsWith(`${oldBase}-`))) {
          cascadeIds.add(variant.id);
        }
      }
      this.autoGeneratedVariantIds.set(cascadeIds);
      this.form.update(f => ({
        ...f,
        sku: baseSku,
        variants: f.variants.map(variant => {
          const currentSku = String(variant.sku || '').trim();
          const followsProductSku = !!oldBase
            && (currentSku === oldBase || currentSku.startsWith(`${oldBase}-`));
          const automatic = cascadeIds.has(variant.id);
          if (!followsProductSku && !automatic) return variant;
          const suffix = followsProductSku
            ? currentSku.slice(oldBase.length).replace(/^-+/, '')
            : [variant.color, variant.size].map(part => String(part || '').trim()).filter(Boolean).join('-');
          const cleanBase = baseSku.trim().replace(/-+$/, '');
          const sku = !cleanBase
            ? currentSku
            : suffix ? `${cleanBase}-${suffix}` : formatVariantSku(cleanBase, variant.size);
          const autoBarcode = variant.barcodeSource === 'auto' || !variant.barcode || variant.barcode === currentSku;
          return { ...variant, sku, barcode: autoBarcode ? sku : variant.barcode, barcodeSource: autoBarcode ? 'auto' : 'manual' };
        }),
      }));
      if (baseSku.trim()) this.lastNonEmptyProductSku.set(baseSku.trim());
      this.scheduleAutoSave();
      return;
    }
    this.form.update((f) => ({ ...f, [k]: v }));
    this.scheduleAutoSave();
  }

  wholeQar(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }

  setNum(k: 'price' | 'stock', v: string | number): void {
    // Whole QAR and whole units: round what was typed so the field shows what is saved.
    const raw = typeof v === 'number' ? v : parseFloat(v);
    const n = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    this.set(k, n);
  }

  setDefaultCost(
    formKey: 'defaultCostPrice' | 'defaultShippingCost',
    variantKey: 'costPrice' | 'shippingCost',
    value: string | number | null,
  ): void {
    const parsed = value === '' || value == null ? null : Math.max(0, Number(value));
    const nextValue = parsed != null && Number.isFinite(parsed) ? parsed : null;
    this.form.update(f => {
      const previousDefault = f[formKey];
      return {
        ...f,
        [formKey]: nextValue,
        // Blank/default-managed sizes follow the product value. A deliberately
        // different size-specific override remains untouched.
        variants: f.variants.map(variant => nextValue != null
          && (variant[variantKey] == null || variant[variantKey] === previousDefault)
          ? { ...variant, [variantKey]: nextValue }
          : variant),
      };
    });
    this.scheduleAutoSave();
  }

  toggle(k: 'hidden' | 'posHidden'): void {
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
      this.storage.set(this.draftBase, JSON.stringify({ form: this.form(), base: this.initial(), savedAt: new Date().toISOString() }));
    }, 400);
  }

  // ────────────────────────────────────────────────────────────────────
  // Save / Discard / Delete
  // ────────────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.dirty() || this.saveState() === 'saving') return;
    // A pending draft write would re-create the draft right after this save.
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    const basics = this.form();
    if (!basics.name.trim() || !basics.brand.trim() || !basics.sku.trim()) {
      this.saveState.set('error');
      this.toast.error(this.t('product.validation.required.title'), this.t('product.validation.required.sub'));
      return;
    }
    if (this.slugError()) {
      this.saveState.set('error');
      this.toast.error(this.t('product.field.slugError'));
      return;
    }
    if (this.form().variants.length === 0) {
      this.saveState.set('error');
      this.toast.error(this.t('product.variants.required.title'), this.t('product.variants.required.sub'));
      return;
    }
    // Every row needs a size (owner decision 2026-09-15): a colour with no size,
    // or a SKU without a size, is not a sellable variant.
    const sizeless = this.form().variants.find(variant => !String(variant.size || '').trim());
    if (sizeless) {
      this.saveState.set('error');
      this.toast.error(
        this.t('product.variants.missingSize.title'),
        this.t(this.pendingVariantIds().has(sizeless.id) ? 'product.variants.pickColorFirst' : 'product.variants.missingSize.sub'),
      );
      this.revealVariant(sizeless.id, true);
      return;
    }
    const incomplete = this.form().variants.find(variant => !String(variant.sku || '').trim());
    if (incomplete) {
      this.saveState.set('error');
      this.toast.error(this.t('product.variants.missingSku.title'), this.t('product.variants.missingSku.sub'));
      this.revealVariant(incomplete.id, true);
      return;
    }
    const duplicateSku = this.duplicateVariantSku();
    if (duplicateSku) {
      this.saveState.set('error');
      this.toast.error(this.t('product.variants.duplicateSku.title'), `${duplicateSku} · ${this.t('product.variants.duplicateSku.sub')}`);
      const clash = [...this.form().variants].reverse().find(v => String(v.sku || '').trim() === duplicateSku);
      if (clash) this.revealVariant(clash.id, true);
      return;
    }
    // What is on screen now is what gets saved. Edits made while the request is
    // in flight (deleting a size right after pressing Save) must stay unsaved;
    // comparing against this snapshot is what keeps the save bar up for them.
    const submitted: FormShape = structuredClone(this.form());
    this.saveState.set('saving');

    try {
      const f = submitted;
      // Resolved once: the getter follows `_currentId`, which only moves to the
      // saved id at the end, so reading it mid-way can return another product.
      const target = this.product;
      const previousId = target.id;
      const payload = f.variants.length > 0
        ? { ...f, stock: this.variantsTotalStock() }
        : { ...f };
      const saved = target.id.startsWith('P-NEW-')
        ? await this.productsApi.saveProduct(payload)
        : await this.productsApi.update(target.id, {
          ...payload,
          // The stock the editor loaded; the server refuses the save if a sale
          // or stock update changed it since (STOCK_CHANGED).
          expectedStock: Object.fromEntries(this.initial().variants.map(v => [v.id || v.sku, v.stock])),
        } as Partial<SaveProductPayload>);

      const editedDuringSave = JSON.stringify(this.form()) !== JSON.stringify(submitted);
      // The baseline is what the server stored (real variant ids, barcode
      // defaulting to the SKU), not the client copy that was sent.
      const savedForm: FormShape = { ...this.makeFormFromProduct(saved), collectionIds: [...f.collectionIds] };
      this.initial.set(savedForm);
      const ts = new Date().toTimeString().slice(0, 5);
      this.lastSavedAt.set(ts);
      this.draftRestoredAt.set(null);
      if (editedDuringSave) {
        this.saveState.set('dirty');
        this.scheduleAutoSave();
      } else {
        this.saveState.set('saved');
        this.form.set(structuredClone(savedForm));
        this.storage.remove(this.draftBase);
        this.autoGeneratedVariantIds.set(new Set());
        this.colorSkuDrafts.set({});
        this.pendingVariantIds.set(new Set());
      }


      // Persist editable fields back on the underlying product so the current
      // catalog reflects the saved API state.
      target.id = saved.id;
      target.name = saved.name;
      target.sku = saved.sku;
      target.brand = saved.brand;
      target.price = saved.price;
      target.defaultCostPrice = saved.defaultCostPrice ?? null;
      target.defaultShippingCost = saved.defaultShippingCost ?? null;
      target.duplicatedFromProductId = saved.duplicatedFromProductId ?? null;
      target.catalogRevision = saved.catalogRevision;
      target.stock = saved.stock;
      target.hidden = saved.hidden;
      target.posHidden = saved.posHidden;
      target.enDesc = saved.enDesc ?? f.enDesc;
      target.arDesc = saved.arDesc ?? f.arDesc;
      target.shortEn = saved.shortEn ?? f.shortEn;
      target.shortAr = saved.shortAr ?? f.shortAr;
      target.teaserEn = saved.teaserEn ?? f.teaserEn;
      target.teaserAr = saved.teaserAr ?? f.teaserAr;
      target.noteEn = saved.noteEn ?? f.noteEn;
      target.noteAr = saved.noteAr ?? f.noteAr;
      target.careEn = saved.careEn ?? f.careEn;
      target.careAr = saved.careAr ?? f.careAr;
      target.variants = (saved.variants ?? []).map(v => ({ ...v }));
      target.images = [...(saved.images ?? f.images)];
      target.imageColors = { ...(saved.imageColors ?? f.imageColors) };
      target.relatedProductIds = [...(saved.relatedProductIds ?? f.relatedProductIds)];
      // Keep the legacy `image` field in sync with images[0] so the catalog
      // grid, dashboard heatmap, and order rows use the new primary.
      target.image = saved.image || target.images?.[0] || target.image;
      if (previousId !== saved.id) {
        this._currentId.set(saved.id);
        this.currentIdChange.emit(saved.id);
      }
      
      this.productSaved.emit({ ...target });
      // Last, and on its own: the product is already saved, so a collection
      // failure must not leave the drawer on a stale id or a nameless new row.
      try {
        await this.syncCollections(previousId, saved.id, f.collectionIds);
      } catch {
        this.toast.error(this.t('product.toast.collectionsFailed.title'), this.t('product.toast.collectionsFailed.sub'));
      }
      this.toast.success(this.t('product.toast.saved.title'), `${f.name}`);
      if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => this.saveState.set(this.dirty() ? 'dirty' : 'idle'), 1800);
    } catch (err) {
      this.saveState.set('error');
      this.triggerShake();
      const body = (err as { error?: { code?: string; errors?: string[] } })?.error;
      if (body?.code === 'STOCK_CHANGED') {
        await this.reloadVariantStock();
      } else if (body?.errors?.length) {
        this.toast.error(this.t('product.toast.saveInvalid'), body.errors.join('; '));
      }
    }
  }

  /** After a STOCK_CHANGED refusal: take the stock the server holds now into
      both the baseline and the form, keeping every other edit, so the next
      save goes through without undoing the sale. */
  private async reloadVariantStock(): Promise<void> {
    const id = this.product?.id;
    if (!id || id.startsWith('P-NEW-')) return;
    try {
      const fresh = await this.productsApi.get(id);
      if (this.product?.id !== id) return;
      const stockBySku = new Map((fresh.variants ?? []).map(v => [v.sku, v.stock]));
      const withFreshStock = (shape: FormShape): FormShape => ({
        ...shape,
        variants: shape.variants.map(v => stockBySku.has(v.sku) ? { ...v, stock: stockBySku.get(v.sku)! } : v),
      });
      this.initial.update(withFreshStock);
      this.form.update(withFreshStock);
    } catch {
      // The error interceptor already reported it.
    }
  }

  async discard(): Promise<void> {
    if (!this.dirty()) return;
    this.form.set({ ...this.initial() });
    this.autoGeneratedVariantIds.set(new Set());
    this.colorSkuDrafts.set({});
    this.pendingVariantIds.set(new Set());
    this.storage.remove(this.draftBase);
    this.draftRestoredAt.set(null);
    this.saveState.set('idle');
    this.toast.info(this.t('product.toast.discarded.title'), this.t('product.toast.discarded.sub'));
  }

  discardDraft(): void {
    this.form.set({ ...this.initial() });
    this.autoGeneratedVariantIds.set(new Set());
    this.colorSkuDrafts.set({});
    this.pendingVariantIds.set(new Set());
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
    const target = this.product;
    const draftKey = this.draftBase;
    this.deleting.set(true);
    setTimeout(() => {
      this.deleting.set(false);
      this.storage.remove(draftKey);
      this.deleted.emit(target);
    }, 600);
  }

  // ────────────────────────────────────────────────────────────────────
  // Navigation (prev / next) with dirty-aware guard
  // ────────────────────────────────────────────────────────────────────

  async navigate(dir: -1 | 1): Promise<void> {
    if (this.deleting()) return;
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

  /** Closing the tab or reloading with unsaved edits asks the browser to confirm. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  /** Used by the catalog route guard: leaving the page with unsaved edits
      asks first instead of silently dropping them. */
  async confirmLeaveIfDirty(): Promise<boolean> {
    if (!this.dirty()) return true;
    const leave = await this.confirm.ask({
      title: this.t('product.leaveConfirm.title'),
      message: this.t('product.leaveConfirm.message'),
      confirmLabel: this.t('product.leaveConfirm.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'warning',
    });
    if (!leave) this.triggerShake();
    return leave;
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
  onImgError(e: Event): void { onProductImgError(e); }
}
