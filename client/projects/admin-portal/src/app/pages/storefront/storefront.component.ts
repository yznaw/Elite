import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { HOME_LAYOUT_BLOCKS, StorefrontService } from '../../services/storefront.service';
import { ToastService } from '../../services/toast.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { ApiClient } from '../../services/api-client.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { AdminMediaService } from '../../services/admin-media.service';
import { Collection, MediaFile, StorefrontBlock } from '../../models';

// ── Page-tab types ────────────────────────────────────────────────────
type PageTab = 'home' | 'story' | 'contact';
type HomeSubTab = 'order' | 'hero-slider' | 'collections' | 'discount' | 'promise' | 'stats';
type StorySubTab = 'hero' | 'hero-facts' | 'intro' | 'chapters' | 'quote' | 'atelier';
type ContactSubTab = 'header' | 'info' | 'phone';

// ── Content data shapes (mirrors server defaults) ─────────────────────
interface HeroCallout   { id: string; titleAr: string; subtitleEn: string; thumbnail: string; alt: string; }
interface HeroSliderItem { id: string; name: string; subtitle: string; imageUrl: string; alt: string; callouts: HeroCallout[]; }
interface PromiseCard   { id: string; icon: string; labelEn: string; labelAr: string; subEn: string; subAr: string; }
interface StatItem      { id: string; value: string; labelEn: string; labelAr: string; }
interface ContactBlock  { id: string; icon: string; titleEn: string; titleAr: string; lines: string[]; }
interface SocialLink    { id: string; platform: string; handle: string; enabled: boolean; }
interface HeroFact      { id: string; label: string; }

interface StorefrontContent {
  hero: { imageUrl: string; title: string; body: string; discountText: string; ctaText: string; ctaLink: string; };
  collections: Array<{ id: string; collectionId?: string; title: string; imageUrl: string; link: string; ctaText?: string; }>;
  heroSlider: { ctaEn: string; ctaAr: string; items: HeroSliderItem[]; };
  promise: { cards: PromiseCard[]; };
  stats: StatItem[];
  contact: {
    kicker: string; headlineEn: string; headlineAccentEn: string;
    headlineAr: string; headlineAccentAr: string; subhead: string;
    email: string; phone: string; whatsapp: string;
    promiseLine: string; promiseSignature: string;
    infoBlocks: ContactBlock[]; socialLinks: SocialLink[];
  };
  story: {
    hero:      { kicker: string; title: string; accent: string; body: string; imageUrl: string; imageAlt: string; };
    heroFacts: HeroFact[];
    intro:     { kicker: string; headline: string; body: string; };
    chapters:  Array<{ id: string; eyebrow: string; title: string; body: string; imageUrl: string; imageAlt: string; }>;
    quote:     { text: string; accent: string; author: string; };
    atelier:   { kicker: string; title: string; body: string; items: Array<{ id: string; title: string; meta: string; }>; };
  };
}

@Component({
  selector: 'ap-storefront',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, SaveBarComponent],
  template: `
  <div class="page-fade sf-shell">

    <!-- ── Single unified action bar (Shopify-style) ─────────── -->
    <div class="pub-bar" [class.pub-bar--content-dirty]="contentDirty()">
      <div class="pub-bar__left">
        <div class="pub-bar__title">Storefront Editor</div>
        @if (contentDirty()) {
          <span class="pub-bar__badge pub-bar__badge--content">Content unsaved</span>
        } @else if (storefront.hasUnpublishedChanges()) {
          <span class="pub-bar__badge pub-bar__badge--layout">Layout unpublished</span>
        }
      </div>
      <div class="pub-bar__actions">
        <button class="btn btn-outline btn-sm" type="button" (click)="viewStorefront()">
          <ap-icon name="eye" [size]="13"/> Preview
        </button>
        <!-- Content actions — appear only when dirty -->
        @if (contentDirty()) {
          <div class="pub-bar__divider"></div>
          <button class="btn btn-ghost btn-sm pub-bar__discard" type="button"
                  [disabled]="savingContent()" (click)="discardContent()">
            Discard
          </button>
          <button class="btn btn-primary btn-sm" type="button"
                  [disabled]="savingContent()" (click)="saveContent()">
            @if (savingContent()) { <ap-spinner [size]="12"/> Saving… } @else { Save content }
          </button>
        }
        <!-- Layout publish — always available -->
        <button class="btn btn-gold btn-sm" type="button" [disabled]="publishing()" (click)="publish()">
          @if (publishing()) { <ap-spinner [size]="12"/> Publishing… } @else { Publish Layout }
        </button>
      </div>
    </div>

    <!-- ── Page tabs ───────────────────────────────────────── -->
    <div class="page-tabs">
      <button class="ptab" [class.active]="pageTab() === 'home'"    (click)="pageTab.set('home')">
        <ap-icon name="dash" [size]="14"/> Home Page
      </button>
      <button class="ptab" [class.active]="pageTab() === 'story'"   (click)="pageTab.set('story')">
        <ap-icon name="edit" [size]="14"/> Our Story
      </button>
      <button class="ptab" [class.active]="pageTab() === 'contact'" (click)="pageTab.set('contact')">
        <ap-icon name="mail" [size]="14"/> Contact Us
      </button>
    </div>

    <!-- ════════════════════════════════════════════════════════
         HOME PAGE TAB
    ═══════════════════════════════════════════════════════════ -->
    @if (pageTab() === 'home') {
      <div class="sub-tabs">
        @for (st of homeSubTabs; track st.id) {
          <button class="stab" [class.active]="homeSubTab() === st.id" (click)="homeSubTab.set(st.id)">{{ st.label }}</button>
        }
      </div>

      <!-- Home: Section Order ──────────────────── -->
      @if (homeSubTab() === 'order') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Section Order</div>
                <div class="card-sub">Drag to reorder · toggle to show / hide sections on the home page.</div>
              </div>
              <button class="btn btn-outline btn-sm" type="button" (click)="resetLayout()">
                <ap-icon name="sync" [size]="13"/> Reset
              </button>
            </div>
            <div class="card-pad">
              <div class="layout-list">
                @for (block of blocks(); track block.id) {
                  <article class="layout-block" draggable="true"
                    [class.dragging]="draggingId() === block.id"
                    [class.drop-target]="dropTargetId() === block.id"
                    [class.is-hidden]="!block.visible"
                    (dragstart)="onDragStart(block.id)" (dragover)="onDragOver($event, block.id)"
                    (drop)="onDrop($event, block.id)" (dragend)="onDragEnd()">
                    <span class="layout-handle"><ap-icon name="drag" [size]="14"/></span>
                    <div class="layout-copy">
                      <div class="layout-title">{{ block.title }}</div>
                      <div class="layout-meta">{{ block.config }}</div>
                    </div>
                    <button class="toggle" type="button" [class.on]="block.visible" (click)="toggleVisible(block.id)"></button>
                  </article>
                }
                <div class="layout-drop-end" [class.drop-target]="dropTargetId() === '__end__'"
                  (dragover)="onDragOver($event,'__end__')" (drop)="onDrop($event,'__end__')">
                  <ap-icon name="drag" [size]="14"/>
                  <span>Drop here to place at end</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Home: Landing Hero ───────────────────── -->
      @if (homeSubTab() === 'hero-slider') {
        <div class="tab-content">
          <div class="card mb-24">
            <div class="card-header"><div><div class="card-title">Hero Slider</div><div class="card-sub">CTA button labels shown on every slide.</div></div></div>
            <div class="card-pad field-stack">
              <div class="two-col">
                <label><span class="lbl">CTA (English)</span><input class="inp" [ngModel]="content().heroSlider.ctaEn" (ngModelChange)="patchHeroSlider('ctaEn', $event)"/></label>
                <label><span class="lbl">CTA (Arabic)</span><input class="inp" dir="rtl" [ngModel]="content().heroSlider.ctaAr" (ngModelChange)="patchHeroSlider('ctaAr', $event)"/></label>
              </div>
            </div>
          </div>

          @for (item of content().heroSlider.items; track item.id; let i = $index) {
            <div class="card mb-16">
              <div class="card-header">
                <div>
                  <div class="card-title">Slide {{ i + 1 }}</div>
                  <div class="card-sub mono small">{{ item.id }}</div>
                </div>
                @if (content().heroSlider.items.length > 1) {
                  <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" type="button" (click)="removeSliderItem(i)">
                    <ap-icon name="trash" [size]="12"/> Remove
                  </button>
                }
              </div>
              <div class="card-pad field-stack">
                <div class="two-col">
                  <label><span class="lbl">Product Name</span><input class="inp" [ngModel]="item.name" (ngModelChange)="patchSliderItem(i,'name',$event)"/></label>
                  <label><span class="lbl">Subtitle (bilingual)</span><input class="inp" [ngModel]="item.subtitle" (ngModelChange)="patchSliderItem(i,'subtitle',$event)"/></label>
                </div>
                <label>
                  <span class="lbl">Slide Image</span>
                  <div class="image-picker-row">
                    @if (item.imageUrl) { <img class="img-thumb" [src]="item.imageUrl" [alt]="item.name"/> }
                    <div class="ip-info">
                      <span class="small mono">{{ imageName(item.imageUrl) }}</span>
                      <div class="row gap-sm">
                        <input #slFile type="file" accept="image/*" (change)="uploadSliderImage(i, $event)" hidden/>
                        <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="slFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                        <button class="btn btn-outline btn-sm" (click)="openMediaPicker('slider-item-'+i)"><ap-icon name="media" [size]="12"/> Media</button>
                      </div>
                      <input class="inp mt-8" placeholder="or paste URL…" [ngModel]="item.imageUrl" (ngModelChange)="patchSliderItem(i,'imageUrl',$event)"/>
                    </div>
                  </div>
                </label>
                <label><span class="lbl">Alt text (accessibility)</span><input class="inp" [ngModel]="item.alt" (ngModelChange)="patchSliderItem(i,'alt',$event)"/></label>

                <!-- Per-slide collapsible callouts — clear accordion UI -->
                <div class="callouts-section" [class.callouts-open]="expandedSlide() === i">
                  <button class="callouts-toggle" type="button" (click)="toggleSlideCallouts(i)"
                          [attr.aria-expanded]="expandedSlide() === i">
                    <span class="callouts-toggle__icon">
                      <ap-icon name="catalog" [size]="12"/>
                    </span>
                    <span class="callouts-toggle__label">Feature Callouts</span>
                    <span class="callouts-toggle__count">{{ item.callouts.length }}</span>
                    <span class="callouts-toggle__hint">{{ expandedSlide() === i ? 'Collapse' : 'Expand' }}</span>
                    <span class="callouts-toggle__arrow" [class.open]="expandedSlide() === i">
                      <ap-icon name="arrowDn" [size]="13"/>
                    </span>
                  </button>
                  @if (expandedSlide() === i) {
                    <div class="callouts-body">
                      @for (callout of item.callouts; track callout.id; let ci = $index) {
                        <div class="callout-row">
                          <div class="callout-row__head">
                            <span class="callout-row__id">
                              <ap-icon name="drag" [size]="11"/>
                              {{ callout.id }}
                            </span>
                            <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" type="button" (click)="removeCallout(i,ci)">
                              <ap-icon name="trash" [size]="11"/>
                            </button>
                          </div>
                          <div class="callout-row__fields">
                            <label><span class="lbl">Arabic label</span><input class="inp inp-sm" dir="rtl" [ngModel]="callout.titleAr" (ngModelChange)="patchCallout(i,ci,'titleAr',$event)"/></label>
                            <label><span class="lbl">English label</span><input class="inp inp-sm" [ngModel]="callout.subtitleEn" (ngModelChange)="patchCallout(i,ci,'subtitleEn',$event)"/></label>
                            <label>
                              <span class="lbl">Thumbnail</span>
                              <div class="callout-thumb-row">
                                @if (callout.thumbnail) {
                                  <img class="callout-thumb" [src]="callout.thumbnail" [alt]="callout.alt"/>
                                } @else {
                                  <div class="callout-thumb callout-thumb--empty">
                                    <ap-icon name="media" [size]="16"/>
                                  </div>
                                }
                                <div style="flex:1;min-width:0;">
                                  <input #ctFile type="file" accept="image/*" (change)="uploadCalloutImage(i,ci,$event)" hidden/>
                                  <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="ctFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                                  <input class="inp mt-6" style="font-size:11px;" placeholder="or paste URL…" [ngModel]="callout.thumbnail" (ngModelChange)="patchCallout(i,ci,'thumbnail',$event)"/>
                                </div>
                              </div>
                            </label>
                            <label><span class="lbl">Alt text</span><input class="inp inp-sm" [ngModel]="callout.alt" (ngModelChange)="patchCallout(i,ci,'alt',$event)"/></label>
                          </div>
                        </div>
                        @if (ci < item.callouts.length - 1) { <hr class="callout-sep"/> }
                      }
                      <button class="btn btn-outline btn-sm mt-12" style="width:100%;" type="button" (click)="addCallout(i)">
                        <ap-icon name="plus" [size]="12"/> Add callout
                      </button>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- Add slide button -->
          <button class="btn btn-outline add-slide-btn" type="button" (click)="addSliderItem()">
            <ap-icon name="plus" [size]="14"/> Add new slide
          </button>
        </div>
      }

      <!-- Home: Collections ───────────────────── -->
      @if (homeSubTab() === 'collections') {
        <div class="tab-content">
          <!-- Featured collection IDs picker -->
          <div class="card mb-24">
            <div class="card-header">
              <div><div class="card-title">Featured Collections</div><div class="card-sub">Collections shown in the home layout block.</div></div>
              <button class="btn btn-outline btn-sm" type="button" (click)="showCollectionPicker.set(!showCollectionPicker())">
                <ap-icon name="plus" [size]="13"/> Add from list
              </button>
            </div>
            <div class="card-pad">
              @if (featuredRefs().length > 0) {
                <div class="featured-chips mb-16">
                  @for (ref of featuredRefs(); track ref) {
                    <div class="feat-chip">
                      <div class="feat-chip-info">
                        @if (collectionByRef(ref); as col) {
                          <span class="feat-chip-title">{{ col.title }}</span>
                          <span class="feat-chip-path mono">/collection/{{ col.handle }}</span>
                        } @else {
                          <span class="feat-chip-title">{{ ref }}</span>
                          <span class="feat-chip-path muted small">manual handle</span>
                        }
                      </div>
                      <button class="feat-chip-remove" type="button" (click)="removeFeatured(ref)"><ap-icon name="x" [size]="10"/></button>
                    </div>
                  }
                </div>
              } @else {
                <div class="feat-empty mb-16"><ap-icon name="catalog" [size]="20"/><span>No collections featured yet.</span></div>
              }
              @if (showCollectionPicker()) {
                <div class="col-picker mb-16">
                  <div class="col-picker-search">
                    <ap-icon name="search" [size]="13"/>
                    <input class="inp with-icon" placeholder="Search…" [ngModel]="pickerSearch()" (ngModelChange)="pickerSearch.set($event)"/>
                  </div>
                  <div class="col-picker-list">
                    @if (collectionsLoading()) { <div class="col-picker-row muted"><ap-spinner [size]="12"/> Loading…</div> }
                    @else {
                      @for (col of filteredPickerCollections(); track col.id) {
                        <div class="col-picker-row" [class.selected]="featuredRefs().includes(col.id)" (click)="toggleFeatured(col.id)">
                          @if (col.imageUrl) { <img [src]="col.imageUrl" [alt]="col.title" class="col-picker-img"/> }
                          @else { <div class="col-picker-img-empty"><ap-icon name="catalog" [size]="14"/></div> }
                          <div class="col-picker-info"><div class="col-picker-name">{{ col.title }}</div><div class="col-picker-path mono">/collection/{{ col.handle }}</div></div>
                          <div class="col-picker-check" [class.on]="featuredRefs().includes(col.id)"></div>
                        </div>
                      }
                      @if (filteredPickerCollections().length === 0) { <div class="col-picker-row muted">No collections found.</div> }
                    }
                  </div>
                </div>
              }
              <div class="manual-entry">
                <span class="manual-prefix">/collection/</span>
                <input class="inp manual-inp" [(ngModel)]="manualHandle" placeholder="type-a-handle" (keydown.enter)="addManualHandle()"/>
                <button class="btn btn-outline btn-sm" type="button" (click)="addManualHandle()" [disabled]="!manualHandle.trim()">Add</button>
              </div>
            </div>
          </div>
          <!-- Collection tiles (3 tiles) -->
          <div class="card">
            <div class="card-header"><div><div class="card-title">Collection Tiles</div><div class="card-sub">3 tiles displayed in the home collections grid.</div></div></div>
            <div class="card-pad">
              <div class="tile-editor-grid">
                @for (tile of content().collections; track tile.id; let ti = $index) {
                  <article class="tile-editor">
                    <div class="tile-thumb"><img [src]="tile.imageUrl" [alt]="tile.title"/><span>{{ tile.title }}</span><span class="tile-num">{{ ti + 1 }}</span></div>
                    <div class="field-stack compact">
                      <label><span class="lbl">Linked Collection</span>
                        <select class="inp inp-sm" [ngModel]="tile.collectionId || ''" (ngModelChange)="selectTileCollection(ti, $event)">
                          <option value="">— None (custom) —</option>
                          @for (col of allCollections(); track col.id) { <option [value]="col.id">{{ col.title }}</option> }
                        </select>
                      </label>

                      @if (tile.collectionId) {
                        <div class="live-badge-row">
                          <span class="live-badge">⟳ Live from catalog</span>
                          <span class="live-hint">Title, image &amp; link auto-sync when collection is updated.</span>
                        </div>
                        <label><span class="lbl">Title <em>(read-only — from catalog)</em></span><input class="inp" [ngModel]="tile.title" readonly style="opacity:0.5;cursor:not-allowed;"/></label>
                        <label><span class="lbl">Image <em>(read-only — from catalog)</em></span>
                          <div class="row gap-sm">
                            @if (tile.imageUrl) { <img class="img-thumb" [src]="tile.imageUrl" [alt]="tile.title"/> }
                            <input class="inp" [ngModel]="tile.imageUrl" readonly style="opacity:0.5;cursor:not-allowed;flex:1;"/>
                          </div>
                        </label>
                        <label><span class="lbl">Collection link <em>(read-only)</em></span><input class="inp" [ngModel]="tile.link" readonly style="opacity:0.5;cursor:not-allowed;"/></label>
                      } @else {
                        <label><span class="lbl">Title</span><input class="inp" [ngModel]="tile.title" (ngModelChange)="patchTile(ti,'title',$event)"/></label>
                        <label><span class="lbl">Image URL</span>
                          <div class="row gap-sm">
                            @if (tile.imageUrl) { <img class="img-thumb" [src]="tile.imageUrl" [alt]="tile.title"/> }
                            <div style="flex:1">
                              <div class="row gap-sm mb-4">
                                <input #tileFile type="file" accept="image/*" (change)="uploadTileImage(ti, $event)" hidden/>
                                <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="tileFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                                <button class="btn btn-outline btn-sm" (click)="openMediaPicker('tile-'+ti)"><ap-icon name="media" [size]="12"/> Media</button>
                              </div>
                              <input class="inp" [ngModel]="tile.imageUrl" (ngModelChange)="patchTile(ti,'imageUrl',$event)" placeholder="https://…"/>
                            </div>
                          </div>
                        </label>
                        <label><span class="lbl">Collection link</span><input class="inp" [ngModel]="tile.link" (ngModelChange)="patchTile(ti,'link',$event)"/></label>
                      }
                      <label><span class="lbl">CTA button text (optional)</span><input class="inp" [ngModel]="tile.ctaText || ''" (ngModelChange)="patchTile(ti,'ctaText',$event)"/></label>
                    </div>
                  </article>
                }
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Home: Promotion Section ─────────────────── -->
      @if (homeSubTab() === 'discount') {
        <div class="tab-content">
          <div class="editor-grid">
            <div class="card">
              <div class="card-header"><div><div class="card-title">Promotion Section</div><div class="card-sub">The split showcase section on the home page.</div></div></div>
              <div class="card-pad field-stack">
                <label><span class="lbl">Showcase image</span>
                  <div class="image-picker-row">
                    @if (content().hero.imageUrl) { <img class="img-thumb" [src]="content().hero.imageUrl" [alt]="content().hero.title"/> }
                    <div class="ip-info">
                      <div class="row gap-sm mb-4">
                        <input #heroFile type="file" accept="image/*" (change)="uploadHeroImage($event)" hidden/>
                        <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="heroFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                        <button class="btn btn-outline btn-sm" (click)="openMediaPicker('hero')"><ap-icon name="media" [size]="12"/> Media</button>
                      </div>
                      <input class="inp" placeholder="https://…" [ngModel]="content().hero.imageUrl" (ngModelChange)="patchHero('imageUrl',$event)"/>
                    </div>
                  </div>
                </label>
                <label><span class="lbl">Header text</span><input class="inp" [ngModel]="content().hero.title" (ngModelChange)="patchHero('title',$event)"/></label>
                <label><span class="lbl">Body text</span><textarea class="inp" rows="3" [ngModel]="content().hero.body" (ngModelChange)="patchHero('body',$event)"></textarea></label>
                <div class="two-col">
                  <label><span class="lbl">Discount badge text</span><input class="inp" [ngModel]="content().hero.discountText" (ngModelChange)="patchHero('discountText',$event)"/></label>
                  <label><span class="lbl">Button label</span><input class="inp" [ngModel]="content().hero.ctaText" (ngModelChange)="patchHero('ctaText',$event)"/></label>
                </div>
                <label><span class="lbl">Button destination link</span><input class="inp" [ngModel]="content().hero.ctaLink" (ngModelChange)="patchHero('ctaLink',$event)"/></label>
              </div>
            </div>
            <div class="card preview-card">
              <div class="card-header"><div><div class="card-title">Preview</div></div></div>
              <div class="card-pad preview-hero">
                <img [src]="content().hero.imageUrl" [alt]="content().hero.title"/>
                <div>
                  <small>Elite Collection</small>
                  <h3>{{ content().hero.title }}</h3>
                  <p>{{ content().hero.body }}</p>
                  <strong>{{ content().hero.discountText }}</strong>
                  <span>{{ content().hero.ctaText }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Home: Craft Promise ─────────────────── -->
      @if (homeSubTab() === 'promise') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header"><div><div class="card-title">Craft Promise</div><div class="card-sub">3 cards in the craft promise section.</div></div></div>
            <div class="card-pad">
              @for (card of content().promise.cards; track card.id; let i = $index) {
                <div class="promise-card-editor">
                  <div class="promise-icon-wrap">
                    <input class="inp inp-sm" style="width:48px;text-align:center;font-size:18px;" [ngModel]="card.icon" (ngModelChange)="patchPromiseCard(i,'icon',$event)"/>
                  </div>
                  <div class="promise-fields">
                    <div class="two-col">
                      <label><span class="lbl">Label (English)</span><input class="inp" [ngModel]="card.labelEn" (ngModelChange)="patchPromiseCard(i,'labelEn',$event)"/></label>
                      <label><span class="lbl">Label (Arabic)</span><input class="inp" dir="rtl" [ngModel]="card.labelAr" (ngModelChange)="patchPromiseCard(i,'labelAr',$event)"/></label>
                    </div>
                    <div class="two-col">
                      <label><span class="lbl">Sub-text (English)</span><input class="inp" [ngModel]="card.subEn" (ngModelChange)="patchPromiseCard(i,'subEn',$event)"/></label>
                      <label><span class="lbl">Sub-text (Arabic)</span><input class="inp" dir="rtl" [ngModel]="card.subAr" (ngModelChange)="patchPromiseCard(i,'subAr',$event)"/></label>
                    </div>
                  </div>
                </div>
                @if (i < content().promise.cards.length - 1) { <hr class="callout-sep"/> }
              }
            </div>
          </div>
        </div>
      }

      <!-- Home: Stats Reel ────────────────────── -->
      @if (homeSubTab() === 'stats') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header"><div><div class="card-title">Stats Reel</div><div class="card-sub">4 numbers displayed in the stats band.</div></div></div>
            <div class="card-pad stats-grid-editor">
              @for (stat of content().stats; track stat.id; let i = $index) {
                <div class="stat-editor card">
                  <label><span class="lbl">Value</span><input class="inp" style="font-size:20px;font-weight:700;text-align:center;" [ngModel]="stat.value" (ngModelChange)="patchStat(i,'value',$event)"/></label>
                  <label><span class="lbl">Label (EN)</span><input class="inp" [ngModel]="stat.labelEn" (ngModelChange)="patchStat(i,'labelEn',$event)"/></label>
                  <label><span class="lbl">Label (AR)</span><input class="inp" dir="rtl" [ngModel]="stat.labelAr" (ngModelChange)="patchStat(i,'labelAr',$event)"/></label>
                </div>
              }
            </div>
          </div>
        </div>
      }
    }

    <!-- ════════════════════════════════════════════════════════
         OUR STORY TAB
    ═══════════════════════════════════════════════════════════ -->
    @if (pageTab() === 'story') {
      <div class="sub-tabs">
        @for (st of storySubTabs; track st.id) {
          <button class="stab" [class.active]="storySubTab() === st.id" (click)="storySubTab.set(st.id)">{{ st.label }}</button>
        }
      </div>

      <!-- Story: Hero ──────────────────────────── -->
      @if (storySubTab() === 'hero') {
        <div class="tab-content">
          <div class="editor-grid">
            <div class="card">
              <div class="card-header"><div class="card-title">Story Hero</div></div>
              <div class="card-pad field-stack">
                <label><span class="lbl">Kicker (small text above title)</span><input class="inp" [ngModel]="content().story.hero.kicker" (ngModelChange)="patchStoryHero('kicker',$event)"/></label>
                <label><span class="lbl">Title</span><input class="inp" [ngModel]="content().story.hero.title" (ngModelChange)="patchStoryHero('title',$event)"/></label>
                <label><span class="lbl">Accent (italic line)</span><input class="inp" [ngModel]="content().story.hero.accent" (ngModelChange)="patchStoryHero('accent',$event)"/></label>
                <label><span class="lbl">Body paragraph</span><textarea class="inp" rows="3" [ngModel]="content().story.hero.body" (ngModelChange)="patchStoryHero('body',$event)"></textarea></label>
                <label><span class="lbl">Hero image</span>
                  <div class="image-picker-row">
                    @if (content().story.hero.imageUrl) { <img class="img-thumb" [src]="content().story.hero.imageUrl" [alt]="content().story.hero.imageAlt"/> }
                    <div class="ip-info">
                      <div class="row gap-sm mb-4">
                        <input #shFile type="file" accept="image/*" (change)="uploadStoryHeroImage($event)" hidden/>
                        <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="shFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                        <button class="btn btn-outline btn-sm" (click)="openMediaPicker('story-hero')"><ap-icon name="media" [size]="12"/> Media</button>
                      </div>
                      <input class="inp" placeholder="https://…" [ngModel]="content().story.hero.imageUrl" (ngModelChange)="patchStoryHero('imageUrl',$event)"/>
                    </div>
                  </div>
                </label>
                <label><span class="lbl">Image alt text</span><input class="inp" [ngModel]="content().story.hero.imageAlt" (ngModelChange)="patchStoryHero('imageAlt',$event)"/></label>
              </div>
            </div>
            <div class="card preview-card">
              <div class="card-header"><div class="card-title">Preview</div></div>
              <div class="card-pad story-preview-hero">
                <img [src]="content().story.hero.imageUrl" [alt]="content().story.hero.imageAlt"/>
                <div><small>{{ content().story.hero.kicker }}</small><h3>{{ content().story.hero.title }}</h3><em>{{ content().story.hero.accent }}</em></div>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Story: Hero Facts Strip ─────────────────── -->
      @if (storySubTab() === 'hero-facts') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header">
              <div><div class="card-title">Hero Facts Strip</div><div class="card-sub">Short highlight tags shown at the bottom of the story hero image.</div></div>
            </div>
            <div class="card-pad field-stack">
              @for (fact of content().story.heroFacts; track fact.id; let fi = $index) {
                <div class="row gap-sm align-center">
                  <input class="inp" style="flex:1" [placeholder]="'Fact label…'" [ngModel]="fact.label" (ngModelChange)="patchHeroFact(fi,'label',$event)"/>
                  @if (content().story.heroFacts.length > 1) {
                    <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" type="button" (click)="removeHeroFact(fi)">
                      <ap-icon name="trash" [size]="12"/>
                    </button>
                  }
                </div>
              }
              <button class="btn btn-outline btn-sm" style="align-self:flex-start;" type="button" (click)="addHeroFact()">
                <ap-icon name="plus" [size]="12"/> Add fact
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Story: Intro ─────────────────────────── -->
      @if (storySubTab() === 'intro') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header"><div><div class="card-title">Philosophy Intro</div><div class="card-sub">The "Our philosophy" block between the hero and the chapter timeline.</div></div></div>
            <div class="card-pad field-stack">
              <label><span class="lbl">Kicker</span><input class="inp" [ngModel]="content().story.intro.kicker" (ngModelChange)="patchStoryIntro('kicker',$event)"/></label>
              <label><span class="lbl">Headline</span><input class="inp" [ngModel]="content().story.intro.headline" (ngModelChange)="patchStoryIntro('headline',$event)"/></label>
              <label><span class="lbl">Body paragraph</span><textarea class="inp" rows="3" [ngModel]="content().story.intro.body" (ngModelChange)="patchStoryIntro('body',$event)"></textarea></label>
            </div>
          </div>
        </div>
      }

      <!-- Story: Chapters ──────────────────────── -->
      @if (storySubTab() === 'chapters') {
        <div class="tab-content">
          @for (chapter of content().story.chapters; track chapter.id; let i = $index) {
            <div class="card mb-16">
              <div class="card-header">
                <div><div class="card-title">Chapter {{ i + 1 }}</div><div class="card-sub mono">{{ chapter.id }}</div></div>
                @if (content().story.chapters.length > 1) {
                  <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" type="button" (click)="removeChapter(i)">
                    <ap-icon name="trash" [size]="12"/> Remove
                  </button>
                }
              </div>
              <div class="card-pad field-stack">
                <label><span class="lbl">Eyebrow (year · label)</span><input class="inp" [ngModel]="chapter.eyebrow" (ngModelChange)="patchChapter(i,'eyebrow',$event)"/></label>
                <label><span class="lbl">Title</span><input class="inp" [ngModel]="chapter.title" (ngModelChange)="patchChapter(i,'title',$event)"/></label>
                <label><span class="lbl">Body paragraph</span><textarea class="inp" rows="3" [ngModel]="chapter.body" (ngModelChange)="patchChapter(i,'body',$event)"></textarea></label>
                <label><span class="lbl">Chapter image</span>
                  <div class="image-picker-row">
                    @if (chapter.imageUrl) { <img class="img-thumb" [src]="chapter.imageUrl" [alt]="chapter.imageAlt"/> }
                    <div class="ip-info">
                      <div class="row gap-sm mb-4">
                        <input #chFile type="file" accept="image/*" (change)="uploadChapterImage(i,$event)" hidden/>
                        <button class="btn btn-outline btn-sm" [disabled]="uploading()" (click)="chFile.click()">@if(uploading()){<ap-spinner [size]="10"/>}@else{<ap-icon name="upload" [size]="12"/>} Upload</button>
                        <button class="btn btn-outline btn-sm" (click)="openMediaPicker('chapter-'+i)"><ap-icon name="media" [size]="12"/> Media</button>
                      </div>
                      <input class="inp" placeholder="https://…" [ngModel]="chapter.imageUrl" (ngModelChange)="patchChapter(i,'imageUrl',$event)"/>
                    </div>
                  </div>
                </label>
                <label><span class="lbl">Image alt text</span><input class="inp" [ngModel]="chapter.imageAlt" (ngModelChange)="patchChapter(i,'imageAlt',$event)"/></label>
              </div>
            </div>
          }
          <button class="btn btn-outline add-slide-btn" type="button" (click)="addChapter()">
            <ap-icon name="plus" [size]="14"/> Add chapter
          </button>
        </div>
      }

      <!-- Story: Quote ─────────────────────────── -->
      @if (storySubTab() === 'quote') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header"><div class="card-title">Quote Band</div></div>
            <div class="card-pad field-stack">
              <label><span class="lbl">Quote text</span><input class="inp" [ngModel]="content().story.quote.text" (ngModelChange)="patchQuote('text',$event)"/></label>
              <label><span class="lbl">Accent (continuation)</span><input class="inp" [ngModel]="content().story.quote.accent" (ngModelChange)="patchQuote('accent',$event)"/></label>
              <label><span class="lbl">Attribution</span><input class="inp" [ngModel]="content().story.quote.author" (ngModelChange)="patchQuote('author',$event)"/></label>
              <div class="quote-preview">
                <p>"{{ content().story.quote.text }}</p>
                <p>{{ content().story.quote.accent }}"</p>
                <strong>— {{ content().story.quote.author }}</strong>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Story: Atelier ───────────────────────── -->
      @if (storySubTab() === 'atelier') {
        <div class="tab-content">
          <div class="card mb-16">
            <div class="card-header"><div class="card-title">Atelier Section Header</div></div>
            <div class="card-pad field-stack">
              <label><span class="lbl">Kicker</span><input class="inp" [ngModel]="content().story.atelier.kicker" (ngModelChange)="patchAtelier('kicker',$event)"/></label>
              <label><span class="lbl">Title</span><input class="inp" [ngModel]="content().story.atelier.title" (ngModelChange)="patchAtelier('title',$event)"/></label>
              <label><span class="lbl">Body</span><textarea class="inp" rows="2" [ngModel]="content().story.atelier.body" (ngModelChange)="patchAtelier('body',$event)"></textarea></label>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div><div class="card-title">Artisan Cards</div><div class="card-sub">Role cards displayed in the atelier grid.</div></div></div>
            <div class="card-pad atelier-grid-editor">
              @for (item of content().story.atelier.items; track item.id; let i = $index) {
                <div class="card atelier-card-editor">
                  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span class="mono small muted">{{ item.id }}</span>
                    @if (content().story.atelier.items.length > 1) {
                      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);padding:2px 6px;" type="button" (click)="removeAtelierItem(i)">
                        <ap-icon name="trash" [size]="10"/>
                      </button>
                    }
                  </div>
                  <label><span class="lbl">Title</span><input class="inp" [ngModel]="item.title" (ngModelChange)="patchAtelierItem(i,'title',$event)"/></label>
                  <label><span class="lbl">Meta</span><input class="inp" [ngModel]="item.meta" (ngModelChange)="patchAtelierItem(i,'meta',$event)"/></label>
                </div>
              }
            </div>
            <div class="card-pad" style="padding-top:0;">
              <button class="btn btn-outline btn-sm" type="button" (click)="addAtelierItem()">
                <ap-icon name="plus" [size]="12"/> Add artisan card
              </button>
            </div>
          </div>
        </div>
      }
    }

    <!-- ════════════════════════════════════════════════════════
         CONTACT US TAB
    ═══════════════════════════════════════════════════════════ -->
    @if (pageTab() === 'contact') {
      <div class="sub-tabs">
        @for (st of contactSubTabs; track st.id) {
          <button class="stab" [class.active]="contactSubTab() === st.id" (click)="contactSubTab.set(st.id)">{{ st.label }}</button>
        }
      </div>

      <!-- Contact: Page Header ─────────────────── -->
      @if (contactSubTab() === 'header') {
        <div class="tab-content">
          <div class="card">
            <div class="card-header"><div class="card-title">Page Header</div></div>
            <div class="card-pad field-stack">
              <label><span class="lbl">Kicker (small label above headline)</span><input class="inp" [ngModel]="content().contact.kicker" (ngModelChange)="patchContact('kicker',$event)"/></label>
              <div class="two-col">
                <label><span class="lbl">Headline (English)</span><input class="inp" [ngModel]="content().contact.headlineEn" (ngModelChange)="patchContact('headlineEn',$event)"/></label>
                <label><span class="lbl">Headline Accent (EN)</span><input class="inp" [ngModel]="content().contact.headlineAccentEn" (ngModelChange)="patchContact('headlineAccentEn',$event)"/></label>
              </div>
              <div class="two-col">
                <label><span class="lbl">Headline (Arabic)</span><input class="inp" dir="rtl" [ngModel]="content().contact.headlineAr" (ngModelChange)="patchContact('headlineAr',$event)"/></label>
                <label><span class="lbl">Headline Accent (AR)</span><input class="inp" dir="rtl" [ngModel]="content().contact.headlineAccentAr" (ngModelChange)="patchContact('headlineAccentAr',$event)"/></label>
              </div>
              <label><span class="lbl">Sub-heading paragraph</span><textarea class="inp" rows="2" [ngModel]="content().contact.subhead" (ngModelChange)="patchContact('subhead',$event)"></textarea></label>
            </div>
          </div>
        </div>
      }

      <!-- Contact: Info Blocks ─────────────────── -->
      @if (contactSubTab() === 'info') {
        <div class="tab-content">
          @for (block of content().contact.infoBlocks; track block.id; let i = $index) {
            <div class="card mb-16">
              <div class="card-header">
                <div><div class="card-title">{{ block.titleEn || 'Info Block ' + (i+1) }}</div><div class="card-sub mono">{{ block.id }}</div></div>
                @if (content().contact.infoBlocks.length > 1) {
                  <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);" type="button" (click)="removeInfoBlock(i)">
                    <ap-icon name="trash" [size]="12"/> Remove
                  </button>
                }
              </div>
              <div class="card-pad field-stack">
                <div class="row gap-sm align-center">
                  <label style="width:64px"><span class="lbl">Icon</span><input class="inp" style="text-align:center;font-size:18px;" [ngModel]="block.icon" (ngModelChange)="patchInfoBlock(i,'icon',$event)"/></label>
                  <div class="two-col" style="flex:1">
                    <label><span class="lbl">Title (EN)</span><input class="inp" [ngModel]="block.titleEn" (ngModelChange)="patchInfoBlock(i,'titleEn',$event)"/></label>
                    <label><span class="lbl">Title (AR)</span><input class="inp" dir="rtl" [ngModel]="block.titleAr" (ngModelChange)="patchInfoBlock(i,'titleAr',$event)"/></label>
                  </div>
                </div>
                @for (line of block.lines; track line; let li = $index) {
                  <div class="row gap-sm">
                    <input class="inp" style="flex:1" [placeholder]="'Line ' + (li+1)" [ngModel]="line" (ngModelChange)="patchInfoBlockLine(i, li, $event)"/>
                    @if (block.lines.length > 1) {
                      <button class="btn btn-outline btn-sm" style="color:var(--danger);" type="button" (click)="removeInfoBlockLine(i, li)">
                        <ap-icon name="x" [size]="11"/>
                      </button>
                    }
                  </div>
                }
                <button class="btn btn-outline btn-sm" style="align-self:flex-start;" type="button" (click)="addInfoBlockLine(i)">
                  <ap-icon name="plus" [size]="11"/> Add line
                </button>
              </div>
            </div>
          }
          <button class="btn btn-outline add-slide-btn" type="button" (click)="addInfoBlock()">
            <ap-icon name="plus" [size]="14"/> Add info block
          </button>
        </div>
      }

      <!-- Contact: Phone & Promise ─────────────── -->
      @if (contactSubTab() === 'phone') {
        <div class="tab-content">
          <div class="card mb-20">
            <div class="card-header"><div class="card-title">Contact Details</div></div>
            <div class="card-pad field-stack">
              <label><span class="lbl">Email address</span><input class="inp" type="email" [ngModel]="content().contact.email" (ngModelChange)="patchContact('email',$event)"/></label>
              <div class="two-col">
                <label><span class="lbl">Phone number</span><input class="inp" [ngModel]="content().contact.phone" (ngModelChange)="patchContact('phone',$event)"/></label>
                <label><span class="lbl">WhatsApp number</span><input class="inp mono" placeholder="+974 XXXX XXXX" [ngModel]="content().contact.whatsapp" (ngModelChange)="patchContact('whatsapp',$event)"/></label>
              </div>
              <div class="hint-box">Enter in any format — <span class="mono">+974 XXXX XXXX</span> or <span class="mono">974XXXXXXXX</span>. The +, spaces, and dashes are stripped automatically when building the wa.me link.</div>
              <label><span class="lbl">Promise line (italic quote card)</span><textarea class="inp" rows="2" [ngModel]="content().contact.promiseLine" (ngModelChange)="patchContact('promiseLine',$event)"></textarea></label>
              <label><span class="lbl">Signature</span><input class="inp" [ngModel]="content().contact.promiseSignature" (ngModelChange)="patchContact('promiseSignature',$event)"/></label>
            </div>
          </div>

          <!-- Social links editor -->
          <div class="card">
            <div class="card-header">
              <div><div class="card-title">Social Media Links</div><div class="card-sub">Toggle, edit handle. WhatsApp uses your WhatsApp number above.</div></div>
              <button class="btn btn-outline btn-sm" type="button" (click)="addSocialLink()">
                <ap-icon name="plus" [size]="13"/> Add platform
              </button>
            </div>
            <div class="card-pad">
              @for (link of content().contact.socialLinks; track link.id; let si = $index) {
                <div class="social-editor-row">
                  <div class="social-editor-platform">
                    <span class="social-editor-icon" [class]="'social-editor-icon social-icon--' + link.platform">
                      {{ platformAbbr(link.platform) }}
                    </span>
                    <select class="inp inp-sm" style="width:110px;" [ngModel]="link.platform" (ngModelChange)="patchSocialLink(si,'platform',$event)">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="instagram">Instagram</option>
                      <option value="twitter">X (Twitter)</option>
                      <option value="facebook">Facebook</option>
                      <option value="tiktok">TikTok</option>
                      <option value="snapchat">Snapchat</option>
                      <option value="youtube">YouTube</option>
                      <option value="linkedin">LinkedIn</option>
                    </select>
                  </div>
                  <input class="inp inp-sm" style="flex:1;" [placeholder]="link.platform === 'whatsapp' ? 'Uses phone above' : '@handle or page name'" [disabled]="link.platform === 'whatsapp'" [ngModel]="link.platform === 'whatsapp' ? content().contact.whatsapp : link.handle" (ngModelChange)="patchSocialLink(si,'handle',$event)"/>
                  <button class="toggle" [class.on]="link.enabled" type="button" (click)="toggleSocialLink(si)"></button>
                  <button class="btn btn-outline btn-sm" style="color:var(--danger);" type="button" (click)="removeSocialLink(si)">
                    <ap-icon name="trash" [size]="12"/>
                  </button>
                </div>
              }
            </div>
          </div>
        </div>
      }
    }

  </div><!-- /sf-shell -->

  <!-- ── Media picker slide-in (shared) ──────────────────────── -->
  @if (mediaPickerTarget()) {
    <div class="overlay" (click)="mediaPickerTarget.set(null)"></div>
    <div class="drawer media-picker-drawer">

      <!-- Header -->
      <div class="mpp-head">
        <div style="min-width:0;">
          <p class="mpp-eyebrow">Media Library</p>
          <div class="card-title" style="margin:0;">Pick an Image</div>
          @if (!mediaPickerLoading()) {
            <div class="muted small mt-4">{{ filteredMediaFiles().length }} image{{ filteredMediaFiles().length === 1 ? '' : 's' }}</div>
          }
        </div>
        <button class="x-btn" style="flex-shrink:0;" (click)="mediaPickerTarget.set(null)">
          <ap-icon name="x" [size]="14"/>
        </button>
      </div>

      <!-- Toolbar: search + upload -->
      <div class="mpp-toolbar">
        <div class="mpp-search">
          <ap-icon name="search" [size]="13"/>
          <input class="inp" placeholder="Search files…"
                 [ngModel]="mediaPickerSearch()" (ngModelChange)="mediaPickerSearch.set($event)"/>
        </div>
        <label class="btn btn-gold btn-sm mpp-upload-btn" style="cursor:pointer;flex-shrink:0;">
          @if (uploading()) { <ap-spinner [size]="10"/> Uploading… }
          @else { <ap-icon name="upload" [size]="12"/> Upload }
          <input type="file" accept="image/*" hidden [disabled]="uploading()" (change)="uploadAndPick($event)"/>
        </label>
      </div>

      <!-- Grid body -->
      <div class="mpp-body">
        @if (mediaPickerLoading()) {
          <div class="mpp-state">
            <ap-spinner/> <span>Loading library…</span>
          </div>
        } @else if (filteredMediaFiles().length === 0) {
          <div class="mpp-state mpp-empty">
            <ap-icon name="media" [size]="36"/>
            <p class="strong">No images found</p>
            <p class="muted small">{{ mediaPickerSearch() ? 'Try a different search term' : 'Upload an image to get started' }}</p>
          </div>
        } @else {
          <div class="media-picker-grid">
            @for (m of filteredMediaFiles(); track m.id) {
              <button class="mp-item" type="button" (click)="applyMediaPick(m.preview || '')">
                <div class="mp-item__img-wrap">
                  <img [src]="m.preview" [alt]="m.name" (error)="onMediaImgError($event)"/>
                  <div class="mp-item__overlay">
                    <ap-icon name="check" [size]="20"/>
                  </div>
                </div>
                <div class="mp-item__name">{{ mediaFileName(m.name) }}</div>
              </button>
            }
          </div>
        }
      </div>

    </div>
  }
  `,
  styles: [`
    .sf-shell { padding-bottom: 60px; }

    /* ── Unified storefront action bar ─────────── */
    .pub-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 28px;
      height: 54px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
      gap: 12px; flex-wrap: wrap;
      transition: background 0.2s, border-color 0.2s;
    }
    /* When content is dirty: shift to green (matches save-bar-top colour) */
    .pub-bar--content-dirty {
      background: var(--green);
      border-bottom-color: rgba(0,0,0,0.1);
    }
    .pub-bar--content-dirty .pub-bar__title { color: #fff; }
    .pub-bar__left { display: flex; align-items: center; gap: 10px; }
    .pub-bar__title { font-size: 15px; font-weight: 700; transition: color 0.2s; }
    .pub-bar__actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    /* Status badges */
    .pub-bar__badge {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 3px 9px; border-radius: 99px;
    }
    .pub-bar__badge--content {
      background: rgba(255,255,255,0.18);
      color: rgba(255,255,255,0.9);
      border: 1px solid rgba(255,255,255,0.25);
    }
    .pub-bar__badge--layout {
      background: rgba(193,154,91,0.12);
      color: var(--gold);
      border: 1px solid rgba(193,154,91,0.3);
    }

    /* Contextual button overrides inside dirty bar */
    .pub-bar--content-dirty .btn-ghost.pub-bar__discard {
      background: rgba(239,68,68,0.15);
      border-color: rgba(239,68,68,0.4);
      color: #fca5a5;
    }
    .pub-bar--content-dirty .btn-ghost.pub-bar__discard:hover {
      background: rgba(239,68,68,0.28);
      color: #fff;
    }
    .pub-bar--content-dirty .btn-primary {
      background: #fff; color: var(--green);
    }
    .pub-bar--content-dirty .btn-primary:hover { background: var(--bg-2); }
    .pub-bar--content-dirty .btn-outline {
      border-color: rgba(255,255,255,0.35);
      color: rgba(255,255,255,0.85);
      background: transparent;
    }
    .pub-bar--content-dirty .btn-outline:hover {
      border-color: rgba(255,255,255,0.7);
      color: #fff;
    }
    .pub-bar__divider {
      width: 1px; height: 20px;
      background: rgba(255,255,255,0.2);
      margin: 0 4px;
    }

    /* ── Page tabs ──────────────────────────────── */
    .page-tabs {
      display: flex; gap: 0;
      border-bottom: 2px solid var(--border);
      padding: 0 32px;
      background: var(--surface);
    }
    .ptab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 14px 20px;
      font-size: 13px; font-weight: 600;
      color: var(--muted);
      background: transparent;
      border: none; border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .ptab:hover { color: var(--ink); }
    .ptab.active { color: var(--green); border-bottom-color: var(--green); }

    /* ── Sub tabs ───────────────────────────────── */
    .sub-tabs {
      display: flex; gap: 4px; flex-wrap: wrap;
      padding: 12px 32px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .stab {
      padding: 6px 14px;
      font-size: 12px; font-weight: 500;
      border-radius: 99px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      cursor: pointer;
      transition: all 0.12s;
    }
    .stab:hover { border-color: var(--green); color: var(--green); }
    .stab.active { background: var(--green); color: #fff; border-color: var(--green); }

    /* ── Tab content ────────────────────────────── */
    .tab-content { padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; }

    /* ── Section order (drag/drop) ──────────────── */
    .layout-list { display: flex; flex-direction: column; gap: 6px; }
    .layout-block {
      display: grid; grid-template-columns: 32px 1fr auto;
      align-items: center; gap: 12px;
      padding: 14px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: grab;
      transition: all 0.12s;
    }
    .layout-block.dragging { opacity: 0.4; }
    .layout-block.drop-target { border-color: var(--gold); background: var(--gold-3); }
    .layout-block.is-hidden { opacity: 0.5; }
    .layout-handle { color: var(--muted); display: flex; align-items: center; }
    .layout-title { font-size: 14px; font-weight: 600; }
    .layout-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .layout-drop-end {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 48px;
      border: 1px dashed var(--border);
      border-radius: 8px; color: var(--muted); font-size: 12px;
    }
    .layout-drop-end.drop-target { border-color: var(--gold); background: var(--gold-3); }

    /* ── Editor grids ───────────────────────────── */
    .editor-grid {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 900px) { .editor-grid { grid-template-columns: 1fr; } }

    /* ── Field helpers ──────────────────────────── */
    .field-stack { display: flex; flex-direction: column; gap: 14px; }
    .field-stack label { display: flex; flex-direction: column; gap: 4px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 640px) { .two-col { grid-template-columns: 1fr; } }
    .image-picker-row { display: flex; gap: 12px; align-items: flex-start; }
    .img-thumb { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; flex-shrink: 0; border: 1px solid var(--border); }
    .ip-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

    .add-slide-btn {
      width: 100%; justify-content: center;
      border-style: dashed; padding: 14px;
      font-size: 13px; color: var(--muted);
    }
    .add-slide-btn:hover { color: var(--green); border-color: var(--green); }

    /* ── Callout editor ─────────────────────────── */
    .callout-editor { display: grid; grid-template-columns: 80px 1fr; gap: 16px; padding: 12px 0; }
    .callout-id { font-family: monospace; color: var(--muted); }
    .callout-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .callout-fields label { display: flex; flex-direction: column; gap: 4px; }
    .callout-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; flex-shrink: 0; border: 1px solid var(--border); }
    .callout-sep { border: none; border-top: 1px dashed var(--border); margin: 4px 0; }

    /* ── Per-slide collapsible callouts ─────────── */
    .callouts-section { margin-top: 16px; }

    /* Accordion trigger button */
    .callouts-toggle {
      display: flex; align-items: center; gap: 8px;
      width: 100%; padding: 10px 14px;
      background: var(--bg);
      border: 1.5px solid var(--border-2);
      border-radius: 8px;
      font-size: 13px; font-weight: 600; color: var(--ink-2);
      cursor: pointer; text-align: start;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .callouts-toggle:hover {
      border-color: var(--gold);
      color: var(--green);
      background: var(--gold-3);
    }
    /* When open: connect visually to the body below */
    .callouts-open .callouts-toggle {
      border-color: var(--gold);
      border-radius: 8px 8px 0 0;
      border-bottom-color: transparent;
      background: var(--gold-3);
      color: var(--green);
    }

    .callouts-toggle__icon {
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      background: var(--green); color: #fff;
      border-radius: 5px; flex-shrink: 0;
    }
    .callouts-open .callouts-toggle__icon { background: var(--gold); }

    .callouts-toggle__label { flex: 1; }

    .callouts-toggle__count {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 20px;
      background: var(--green); color: #fff;
      font-size: 10px; font-weight: 700;
      padding: 0 6px; border-radius: 99px;
    }
    .callouts-open .callouts-toggle__count { background: var(--gold); }

    .callouts-toggle__hint {
      font-size: 10px; font-weight: 400;
      color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;
    }

    .callouts-toggle__arrow {
      display: flex; transition: transform 0.22s cubic-bezier(0.22,1,0.36,1);
    }
    .callouts-toggle__arrow.open { transform: rotate(180deg); }

    /* Accordion body — connected border */
    .callouts-body {
      border: 1.5px solid var(--gold);
      border-top: none;
      border-radius: 0 0 8px 8px;
      padding: 14px 14px 10px;
      background: var(--surface);
    }

    /* Individual callout rows */
    .callout-row { padding: 10px 0; }
    .callout-row__head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px;
    }
    .callout-row__id {
      display: flex; align-items: center; gap: 6px;
      font-family: monospace; font-size: 11px;
      color: var(--muted); font-weight: 600;
    }
    .callout-row__fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .callout-thumb-row { display: flex; align-items: flex-start; gap: 10px; }
    .callout-thumb {
      width: 52px; height: 52px;
      object-fit: cover; border-radius: 7px; flex-shrink: 0;
      border: 1px solid var(--border);
    }
    .callout-thumb--empty {
      display: flex; align-items: center; justify-content: center;
      background: var(--bg); color: var(--muted);
    }
    @media (max-width: 640px) { .callout-row__fields { grid-template-columns: 1fr; } }

    /* ── Social links editor ────────────────────── */
    .social-editor-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-2);
    }
    .social-editor-row:last-child { border-bottom: none; }
    .social-editor-platform { display: flex; align-items: center; gap: 8px; }
    .social-editor-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: 700; flex-shrink: 0;
      background: var(--bg); color: var(--muted);
      border: 1px solid var(--border);
    }
    .social-icon--whatsapp  { background: #25d366; color: #fff; border-color: #25d366; }
    .social-icon--instagram { background: #e1306c; color: #fff; border-color: #e1306c; }
    .social-icon--twitter   { background: #000;    color: #fff; border-color: #000; }
    .social-icon--facebook  { background: #1877f2; color: #fff; border-color: #1877f2; }
    .social-icon--tiktok    { background: #010101; color: #fff; border-color: #010101; }
    .social-icon--snapchat  { background: #fffc00; color: #000; border-color: #fffc00; }
    .social-icon--youtube   { background: #ff0000; color: #fff; border-color: #ff0000; }
    .social-icon--linkedin  { background: #0a66c2; color: #fff; border-color: #0a66c2; }

    /* ── Hint box ───────────────────────────────── */
    /* ── Live-from-catalog badge ─────────────────── */
    .live-badge-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .live-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 99px;
      background: rgba(74,222,128,0.12); color: #4ade80;
      border: 1px solid rgba(74,222,128,0.3);
      font-size: 10px; font-weight: 600; white-space: nowrap;
    }
    .live-hint { font-size: 10px; color: var(--muted); }

    .hint-box {
      padding: 10px 14px;
      background: var(--bg);
      border-radius: 8px;
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      line-height: 1.5;
    }
    .hint-box .mono { color: var(--green); font-family: monospace; }

    /* ── Promise cards ──────────────────────────── */
    .promise-card-editor { display: grid; grid-template-columns: 64px 1fr; gap: 16px; padding: 12px 0; align-items: start; }
    .promise-icon-wrap { display: flex; align-items: center; justify-content: center; padding-top: 20px; }
    .promise-fields { display: flex; flex-direction: column; gap: 8px; }

    /* ── Stats ──────────────────────────────────── */
    .stats-grid-editor { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 900px) { .stats-grid-editor { grid-template-columns: repeat(2,1fr); } }
    .stat-editor { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .stat-editor label { display: flex; flex-direction: column; gap: 4px; }

    /* ── Atelier grid ───────────────────────────── */
    .atelier-grid-editor { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
    @media (max-width: 900px) { .atelier-grid-editor { grid-template-columns: repeat(2,1fr); } }
    .atelier-card-editor { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .atelier-card-editor label { display: flex; flex-direction: column; gap: 4px; }

    /* ── Tile editor ────────────────────────────── */
    .tile-editor-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
    @media (max-width: 900px) { .tile-editor-grid { grid-template-columns: 1fr; } }
    .tile-editor { display: flex; flex-direction: column; gap: 12px; }
    .tile-thumb {
      position: relative; border-radius: 8px; overflow: hidden;
      aspect-ratio: 16/9; background: var(--bg);
    }
    .tile-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .tile-thumb span { position: absolute; inset-inline-start: 8px; bottom: 8px; background: rgba(0,0,0,0.55); color: #fff; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
    .tile-num { inset-inline-start: auto !important; inset-inline-end: 8px !important; background: rgba(197,165,114,0.9) !important; color: #1a1208 !important; }
    .field-stack.compact label { display: flex; flex-direction: column; gap: 3px; }

    /* ── Story preview ──────────────────────────── */
    .story-preview-hero { display: flex; flex-direction: column; gap: 12px; }
    .story-preview-hero img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; }
    .story-preview-hero small { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
    .story-preview-hero h3 { font-size: 18px; font-weight: 600; }
    .story-preview-hero em { font-size: 14px; color: var(--muted); font-style: italic; }

    /* ── Promotion Section preview ──────────────────── */
    .preview-hero { display: flex; flex-direction: column; gap: 12px; }
    .preview-hero img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; }
    .preview-hero div { display: flex; flex-direction: column; gap: 6px; }
    .preview-hero small { font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); }
    .preview-hero h3 { font-size: 16px; font-weight: 700; }
    .preview-hero p { font-size: 12px; color: var(--muted); }
    .preview-hero strong { font-size: 24px; font-weight: 700; color: var(--gold); }
    .preview-hero span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--green); }

    /* ── Quote preview ──────────────────────────── */
    .quote-preview {
      padding: 20px; border: 1px solid var(--border); border-radius: 8px;
      background: var(--bg);
    }
    .quote-preview p { font-size: 14px; font-style: italic; color: var(--ink-2); margin-bottom: 4px; }
    .quote-preview strong { font-size: 12px; color: var(--muted); }

    /* ── Featured chips ─────────────────────────── */
    .featured-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .feat-chip { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; border: 1px solid var(--border-2); border-radius: 8px; background: var(--surface); }
    .feat-chip-info { display: flex; flex-direction: column; min-width: 0; }
    .feat-chip-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .feat-chip-path { font-size: 11px; color: var(--green); }
    .feat-chip-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; padding: 0; transition: all 0.12s; }
    .feat-chip-remove:hover { background: rgba(239,68,68,.1); border-color: var(--danger); color: var(--danger); }
    .feat-empty { display: flex; align-items: center; gap: 10px; padding: 20px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 13px; font-weight: 600; background: var(--bg); }

    /* ── Collection picker ──────────────────────── */
    .col-picker { border: 1px solid var(--border-2); border-radius: 10px; overflow: hidden; background: var(--surface); }
    .col-picker-search { position: relative; padding: 10px 12px; border-bottom: 1px solid var(--border-2); background: var(--bg); display: flex; align-items: center; gap: 8px; }
    .col-picker-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .col-picker-search .inp { border: none; background: transparent; flex: 1; padding: 0; }
    .col-picker-search .inp:focus { outline: none; box-shadow: none; }
    .col-picker-list { max-height: 260px; overflow-y: auto; }
    .col-picker-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-size: 13px; transition: background 0.12s; }
    .col-picker-row:hover { background: var(--bg); }
    .col-picker-row.selected { background: rgba(2,70,56,0.05); }
    .col-picker-img { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
    .col-picker-img-empty { width: 36px; height: 36px; border: 1px dashed var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--muted); flex-shrink: 0; }
    .col-picker-info { flex: 1; min-width: 0; }
    .col-picker-name { font-weight: 600; }
    .col-picker-path { font-size: 11px; color: var(--muted); }
    .col-picker-check { width: 18px; height: 18px; border: 2px solid var(--border); border-radius: 4px; flex-shrink: 0; transition: all 0.12s; }
    .col-picker-check.on { background: var(--green); border-color: var(--green); }
    .manual-entry { display: flex; align-items: center; gap: 8px; }
    .manual-prefix { font-size: 13px; color: var(--muted); white-space: nowrap; }
    .manual-inp { flex: 1; }

    /* ── Media picker drawer ────────────────────── */
    .media-picker-drawer {
      position: fixed; inset-block: 0; inset-inline-end: 0;
      width: 380px; z-index: 200;
      display: flex; flex-direction: column;
      background: var(--surface);
      box-shadow: -10px 0 40px rgba(0,0,0,.18);
    }

    /* Header */
    .mpp-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--border-2);
      flex-shrink: 0;
    }
    .mpp-eyebrow {
      margin: 0 0 3px;
      font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--gold);
    }

    /* Toolbar */
    .mpp-toolbar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: var(--bg);
      border-bottom: 1px solid var(--border-2);
      flex-shrink: 0;
    }
    .mpp-search {
      display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
    }
    .mpp-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .mpp-search .inp { border: none; background: transparent; padding: 0; flex: 1; }
    .mpp-search .inp:focus { outline: none; box-shadow: none; }
    .mpp-upload-btn { white-space: nowrap; }

    /* Scrollable body */
    .mpp-body { flex: 1; overflow-y: auto; padding: 14px; }

    /* Loading / empty state */
    .mpp-state {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 10px; padding: 56px 24px;
      color: var(--muted); font-size: 13px;
    }
    .mpp-empty p { margin: 0; }

    /* 2-column grid — larger cards, easier to click and see */
    .media-picker-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    /* Image card */
    .mp-item {
      display: flex; flex-direction: column;
      border: 2px solid var(--border-2);
      padding: 0; background: var(--bg);
      border-radius: 10px; overflow: hidden;
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
      text-align: left;
    }
    .mp-item:hover {
      border-color: var(--gold);
      box-shadow: 0 6px 20px rgba(0,0,0,.12);
      transform: translateY(-2px);
    }
    .mp-item__img-wrap {
      position: relative;
      aspect-ratio: 1;
      overflow: hidden;
      background: var(--bg-2);
    }
    .mp-item__img-wrap img {
      width: 100%; height: 100%;
      object-fit: cover; display: block;
      transition: transform 0.2s;
    }
    .mp-item:hover .mp-item__img-wrap img { transform: scale(1.04); }

    /* Gold overlay with checkmark on hover */
    .mp-item__overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(197,165,114,0.82);
      color: #fff;
      opacity: 0; transition: opacity 0.15s;
    }
    .mp-item:hover .mp-item__overlay { opacity: 1; }

    /* Filename label */
    .mp-item__name {
      padding: 6px 8px;
      font-size: 10px; font-weight: 500;
      color: var(--ink-2);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-top: 1px solid var(--border-2);
      background: var(--surface);
      line-height: 1.3;
    }
  `],
})
export class StorefrontComponent implements OnInit, OnDestroy {
  private readonly toast         = inject(ToastService);
  private readonly confirm       = inject(ConfirmService);
  private readonly i18n          = inject(I18nService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  private readonly api           = inject(ApiClient);
  private readonly mediaApi      = inject(AdminMediaService);
  private readonly uploadApi     = inject(MediaUploadService);
  readonly storefront            = inject(StorefrontService);

  readonly t = (key: string): string => this.i18n.t(key);

  // ── Tab state ─────────────────────────────────────────────────────────
  readonly pageTab     = signal<PageTab>('home');
  readonly homeSubTab  = signal<HomeSubTab>('order');
  readonly storySubTab = signal<StorySubTab>('hero');
  readonly contactSubTab = signal<ContactSubTab>('header');

  readonly homeSubTabs    = [
    { id: 'order' as HomeSubTab,       label: 'Section Order' },
    { id: 'hero-slider' as HomeSubTab, label: 'Landing Hero' },
    { id: 'collections' as HomeSubTab, label: 'Collections' },
    { id: 'discount' as HomeSubTab,    label: 'Promotion Section' },
    { id: 'promise' as HomeSubTab,     label: 'Craft Promise' },
    { id: 'stats' as HomeSubTab,       label: 'Stats Reel' },
  ];
  readonly storySubTabs   = [
    { id: 'hero' as StorySubTab,      label: 'Hero' },
    { id: 'hero-facts' as StorySubTab, label: 'Facts Strip' },
    { id: 'intro' as StorySubTab,     label: 'Intro' },
    { id: 'chapters' as StorySubTab,  label: 'Chapters' },
    { id: 'quote' as StorySubTab,     label: 'Quote' },
    { id: 'atelier' as StorySubTab,   label: 'Atelier' },
  ];
  readonly contactSubTabs = [
    { id: 'header' as ContactSubTab, label: 'Page Header' },
    { id: 'info' as ContactSubTab,   label: 'Info Blocks' },
    { id: 'phone' as ContactSubTab,  label: 'Phone & Promise' },
  ];

  // ── Layout blocks (drag/drop + visibility) ────────────────────────────
  readonly blocks       = signal<StorefrontBlock[]>(this.normalizeBlocks(this.storefront.draft()?.blocks));
  readonly draggingId   = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly publishing   = signal(false);
  readonly draftLoaded  = signal(false);
  readonly visibleCount = computed(() => this.blocks().filter((b) => b.visible).length);
  private draftSaveTimer: number | undefined;

  // ── Featured collections ──────────────────────────────────────────────
  readonly allCollections       = signal<Collection[]>([]);
  readonly collectionsLoading   = signal(true);
  readonly showCollectionPicker = signal(false);
  readonly pickerSearch         = signal('');
  manualHandle = '';

  readonly featuredRefs = computed(() => this.blocks().find((b) => b.id === 'home-collections')?.collectionIds ?? []);
  readonly filteredPickerCollections = computed(() => {
    const s = this.pickerSearch().toLowerCase();
    return this.allCollections().filter((c) => !s || c.title.toLowerCase().includes(s) || c.handle.toLowerCase().includes(s));
  });

  collectionByRef(ref: string): Collection | undefined {
    return this.allCollections().find((c) => c.id === ref || c.handle === ref);
  }

  // ── Storefront content (home page + story + contact) ──────────────────
  readonly content       = signal<StorefrontContent>({} as StorefrontContent);
  readonly contentDirty  = signal(false);
  readonly savingContent = signal(false);
  private contentLoaded  = false;

  // ── Media picker ──────────────────────────────────────────────────────
  readonly mediaPickerTarget = signal<string | null>(null);
  readonly mediaPickerSearch = signal('');
  readonly mediaPickerLoading = signal(false);
  readonly uploading = signal(false);
  private _mediaFiles = signal<MediaFile[]>([]);
  readonly filteredMediaFiles = computed(() => {
    const s = this.mediaPickerSearch().toLowerCase();
    return this._mediaFiles().filter((m) => m.kind === 'image' && (!s || m.name.toLowerCase().includes(s)));
  });

  constructor() {
    effect(() => {
      if (!this.draftLoaded()) return;
      this.storefront.saveDraft(this.blocks());
      this.scheduleDraftSave();
    });
  }

  async ngOnInit(): Promise<void> {
    // Load collections
    void this.collectionsApi.list()
      .then((list) => { this.allCollections.set(list); this.collectionsLoading.set(false); })
      .catch(() => this.collectionsLoading.set(false));

    // Load storefront layout draft
    try {
      const draft = await this.storefront.loadDraft();
      this.blocks.set(this.normalizeBlocks(draft?.blocks));
      this.draftLoaded.set(true);
    } catch {
      this.draftLoaded.set(true);
    }

    // Load content data
    try {
      const data = await firstValueFrom(this.api.get<StorefrontContent>('/admin/storefront-content'));
      this.content.set(data);
      this.contentLoaded = true;
    } catch {
      this.toast.warning('Could not load content', 'Using defaults.');
    }
  }

  ngOnDestroy(): void {
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
  }

  // ── Content save ──────────────────────────────────────────────────────
  async saveContent(): Promise<void> {
    if (this.savingContent()) return;
    this.savingContent.set(true);
    try {
      await firstValueFrom(this.api.patch<StorefrontContent>('/admin/storefront-content', this.content()));
      this.contentDirty.set(false);
      this.toast.success('Content saved', 'Changes are now live on the storefront.');
    } catch {
      this.toast.error('Save failed', 'Could not save content changes.');
    } finally {
      this.savingContent.set(false);
    }
  }

  discardContent(): void { this.contentDirty.set(false); }

  // ── Patch helpers ─────────────────────────────────────────────────────
  private markDirty(): void { this.contentDirty.set(true); }

  patchHero(key: string, value: string): void {
    this.content.update((c) => ({ ...c, hero: { ...c.hero, [key]: value } }));
    this.markDirty();
  }

  patchHeroSlider(key: string, value: string): void {
    this.content.update((c) => ({ ...c, heroSlider: { ...c.heroSlider, [key]: value } }));
    this.markDirty();
  }

  patchSliderItem(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const items = c.heroSlider.items.map((item, idx) => idx === i ? { ...item, [key]: value } : item);
      return { ...c, heroSlider: { ...c.heroSlider, items } };
    });
    this.markDirty();
  }

  addSliderItem(): void {
    const newId = `slide-${Date.now()}`;
    const newItem: HeroSliderItem = { id: newId, name: '', subtitle: '', imageUrl: '', alt: '', callouts: [] };
    this.content.update((c) => ({
      ...c,
      heroSlider: { ...c.heroSlider, items: [...c.heroSlider.items, newItem] },
    }));
    this.markDirty();
  }

  removeSliderItem(i: number): void {
    this.content.update((c) => {
      const items = c.heroSlider.items.filter((_, idx) => idx !== i);
      return { ...c, heroSlider: { ...c.heroSlider, items } };
    });
    this.markDirty();
  }

  patchCallout(slideIdx: number, calloutIdx: number, key: string, value: string): void {
    this.content.update((c) => {
      const items = c.heroSlider.items.map((item, si) => {
        if (si !== slideIdx) return item;
        const callouts = item.callouts.map((cl, ci) => ci === calloutIdx ? { ...cl, [key]: value } : cl);
        return { ...item, callouts };
      });
      return { ...c, heroSlider: { ...c.heroSlider, items } };
    });
    this.markDirty();
  }

  addCallout(slideIdx: number): void {
    const newId = `callout-${Date.now()}`;
    this.content.update((c) => {
      const items = c.heroSlider.items.map((item, si) => {
        if (si !== slideIdx) return item;
        return { ...item, callouts: [...item.callouts, { id: newId, titleAr: '', subtitleEn: '', thumbnail: '', alt: '' }] };
      });
      return { ...c, heroSlider: { ...c.heroSlider, items } };
    });
    this.markDirty();
  }

  removeCallout(slideIdx: number, calloutIdx: number): void {
    this.content.update((c) => {
      const items = c.heroSlider.items.map((item, si) => {
        if (si !== slideIdx) return item;
        return { ...item, callouts: item.callouts.filter((_, ci) => ci !== calloutIdx) };
      });
      return { ...c, heroSlider: { ...c.heroSlider, items } };
    });
    this.markDirty();
  }

  patchTile(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const collections = c.collections.map((t, idx) => idx === i ? { ...t, [key]: value } : t);
      return { ...c, collections };
    });
    this.markDirty();
  }

  selectTileCollection(i: number, colId: string): void {
    const col = this.allCollections().find((c) => c.id === colId);
    this.content.update((c) => {
      const collections = c.collections.map((t, idx) => {
        if (idx !== i) return t;
        return {
          ...t,
          collectionId: colId || undefined,
          title: col?.title || t.title,
          imageUrl: col?.imageUrl || t.imageUrl,
          link: col ? `/collection/${col.handle}` : t.link,
        };
      });
      return { ...c, collections };
    });
    this.markDirty();
  }

  patchPromiseCard(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const cards = c.promise.cards.map((card, idx) => idx === i ? { ...card, [key]: value } : card);
      return { ...c, promise: { ...c.promise, cards } };
    });
    this.markDirty();
  }

  patchStat(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const stats = c.stats.map((s, idx) => idx === i ? { ...s, [key]: value } : s);
      return { ...c, stats };
    });
    this.markDirty();
  }

  patchContact(key: string, value: string): void {
    this.content.update((c) => ({ ...c, contact: { ...c.contact, [key]: value } }));
    this.markDirty();
  }

  patchInfoBlock(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const infoBlocks = c.contact.infoBlocks.map((b, idx) => idx === i ? { ...b, [key]: value } : b);
      return { ...c, contact: { ...c.contact, infoBlocks } };
    });
    this.markDirty();
  }

  patchInfoBlockLine(blockIdx: number, lineIdx: number, value: string): void {
    this.content.update((c) => {
      const infoBlocks = c.contact.infoBlocks.map((b, bi) => {
        if (bi !== blockIdx) return b;
        const lines = b.lines.map((l, li) => li === lineIdx ? value : l);
        return { ...b, lines };
      });
      return { ...c, contact: { ...c.contact, infoBlocks } };
    });
    this.markDirty();
  }

  // ── Story hero facts ─────────────────────────────────────────────────
  patchHeroFact(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const heroFacts = c.story.heroFacts.map((f, idx) => idx === i ? { ...f, [key]: value } : f);
      return { ...c, story: { ...c.story, heroFacts } };
    });
    this.markDirty();
  }

  addHeroFact(): void {
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, heroFacts: [...c.story.heroFacts, { id: `fact-${Date.now()}`, label: '' }] },
    }));
    this.markDirty();
  }

  removeHeroFact(i: number): void {
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, heroFacts: c.story.heroFacts.filter((_, idx) => idx !== i) },
    }));
    this.markDirty();
  }

  // ── Story chapters add/remove ─────────────────────────────────────────
  addChapter(): void {
    const id = `chapter-${Date.now()}`;
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, chapters: [...c.story.chapters, { id, eyebrow: '', title: '', body: '', imageUrl: '', imageAlt: '' }] },
    }));
    this.markDirty();
  }

  removeChapter(i: number): void {
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, chapters: c.story.chapters.filter((_, idx) => idx !== i) },
    }));
    this.markDirty();
  }

  // ── Atelier items add/remove ──────────────────────────────────────────
  addAtelierItem(): void {
    const id = `artisan-${Date.now()}`;
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, atelier: { ...c.story.atelier, items: [...c.story.atelier.items, { id, title: '', meta: '' }] } },
    }));
    this.markDirty();
  }

  removeAtelierItem(i: number): void {
    this.content.update((c) => ({
      ...c,
      story: { ...c.story, atelier: { ...c.story.atelier, items: c.story.atelier.items.filter((_, idx) => idx !== i) } },
    }));
    this.markDirty();
  }

  // ── Info blocks add/remove/lines ──────────────────────────────────────
  addInfoBlock(): void {
    const id = `block-${Date.now()}`;
    this.content.update((c) => ({
      ...c,
      contact: { ...c.contact, infoBlocks: [...c.contact.infoBlocks, { id, icon: '◆', titleEn: '', titleAr: '', lines: [''] }] },
    }));
    this.markDirty();
  }

  removeInfoBlock(i: number): void {
    this.content.update((c) => ({
      ...c,
      contact: { ...c.contact, infoBlocks: c.contact.infoBlocks.filter((_, idx) => idx !== i) },
    }));
    this.markDirty();
  }

  addInfoBlockLine(blockIdx: number): void {
    this.content.update((c) => {
      const infoBlocks = c.contact.infoBlocks.map((b, bi) =>
        bi === blockIdx ? { ...b, lines: [...b.lines, ''] } : b
      );
      return { ...c, contact: { ...c.contact, infoBlocks } };
    });
    this.markDirty();
  }

  removeInfoBlockLine(blockIdx: number, lineIdx: number): void {
    this.content.update((c) => {
      const infoBlocks = c.contact.infoBlocks.map((b, bi) =>
        bi === blockIdx ? { ...b, lines: b.lines.filter((_, li) => li !== lineIdx) } : b
      );
      return { ...c, contact: { ...c.contact, infoBlocks } };
    });
    this.markDirty();
  }

  // ── Social links add/remove/patch ─────────────────────────────────────
  addSocialLink(): void {
    this.content.update((c) => ({
      ...c,
      contact: { ...c.contact, socialLinks: [...(c.contact.socialLinks || []), { id: `social-${Date.now()}`, platform: 'instagram', handle: '', enabled: true }] },
    }));
    this.markDirty();
  }

  removeSocialLink(i: number): void {
    this.content.update((c) => ({
      ...c,
      contact: { ...c.contact, socialLinks: c.contact.socialLinks.filter((_, idx) => idx !== i) },
    }));
    this.markDirty();
  }

  patchSocialLink(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const socialLinks = c.contact.socialLinks.map((s, idx) => idx === i ? { ...s, [key]: value } : s);
      return { ...c, contact: { ...c.contact, socialLinks } };
    });
    this.markDirty();
  }

  platformAbbr(platform: string): string {
    const map: Record<string,string> = { whatsapp:'WA', instagram:'IG', twitter:'X', facebook:'FB', tiktok:'TK', snapchat:'SC', youtube:'YT', linkedin:'LI' };
    return map[platform] ?? platform.slice(0,2).toUpperCase();
  }

  toggleSocialLink(i: number): void {
    this.content.update((c) => {
      const socialLinks = c.contact.socialLinks.map((s, idx) => idx === i ? { ...s, enabled: !s.enabled } : s);
      return { ...c, contact: { ...c.contact, socialLinks } };
    });
    this.markDirty();
  }

  // ── Slide callout expand/collapse ─────────────────────────────────────
  readonly expandedSlide = signal<number | null>(null);
  toggleSlideCallouts(i: number): void {
    this.expandedSlide.update((v) => v === i ? null : i);
  }

  patchStoryHero(key: string, value: string): void {
    this.content.update((c) => ({ ...c, story: { ...c.story, hero: { ...c.story.hero, [key]: value } } }));
    this.markDirty();
  }

  patchStoryIntro(key: string, value: string): void {
    this.content.update((c) => ({ ...c, story: { ...c.story, intro: { ...c.story.intro, [key]: value } } }));
    this.markDirty();
  }

  patchChapter(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const chapters = c.story.chapters.map((ch, idx) => idx === i ? { ...ch, [key]: value } : ch);
      return { ...c, story: { ...c.story, chapters } };
    });
    this.markDirty();
  }

  patchQuote(key: string, value: string): void {
    this.content.update((c) => ({ ...c, story: { ...c.story, quote: { ...c.story.quote, [key]: value } } }));
    this.markDirty();
  }

  patchAtelier(key: string, value: string): void {
    this.content.update((c) => ({ ...c, story: { ...c.story, atelier: { ...c.story.atelier, [key]: value } } }));
    this.markDirty();
  }

  patchAtelierItem(i: number, key: string, value: string): void {
    this.content.update((c) => {
      const items = c.story.atelier.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it);
      return { ...c, story: { ...c.story, atelier: { ...c.story.atelier, items } } };
    });
    this.markDirty();
  }

  // ── Layout block methods ──────────────────────────────────────────────
  toggleVisible(id: string): void {
    this.blocks.update((blocks) => blocks.map((b) => b.id === id ? { ...b, visible: !b.visible } : b));
  }

  resetLayout(): void {
    this.blocks.set(HOME_LAYOUT_BLOCKS.map((b) => ({ ...b })));
  }

  viewStorefront(): void {
    window.open(this.storefront.storefrontUrl(), '_blank', 'noopener,noreferrer');
  }

  async publish(): Promise<void> {
    if (this.publishing()) return;
    const ok = await this.confirm.ask({
      title: this.t('storefront.publishConfirm.title'),
      message: `Publish ${this.visibleCount()} visible sections to the storefront?`,
      confirmLabel: this.t('storefront.publish'),
      cancelLabel: this.t('common.cancel'),
      variant: 'info',
    });
    if (!ok) return;
    this.publishing.set(true);
    try {
      const blocks = this.normalizeBlocks(this.blocks());
      await this.storefront.saveDraftRemote(blocks);
      await this.storefront.publishRemote();
      this.blocks.set(blocks);
      this.toast.success(this.t('storefront.publish.toast.title'), this.t('storefront.publish.toast.sub'));
    } catch {
      this.toast.error('Publish failed', 'Could not publish layout.');
    } finally {
      this.publishing.set(false);
    }
  }

  // ── Featured collections ──────────────────────────────────────────────
  toggleFeatured(id: string): void {
    const current = this.featuredRefs();
    this.setFeaturedRefs(current.includes(id) ? current.filter((r) => r !== id) : [...current, id]);
  }

  removeFeatured(ref: string): void {
    this.setFeaturedRefs(this.featuredRefs().filter((r) => r !== ref));
  }

  addManualHandle(): void {
    const raw = this.manualHandle.trim().replace(/^\/collections\//i, '').replace(/\//g, '');
    if (!raw || this.featuredRefs().includes(raw)) { this.manualHandle = ''; return; }
    this.setFeaturedRefs([...this.featuredRefs(), raw]);
    this.manualHandle = '';
  }

  private setFeaturedRefs(refs: string[]): void {
    this.blocks.update((blocks) => blocks.map((b) => b.id === 'home-collections' ? { ...b, collectionIds: refs } : b));
  }

  // ── Drag/drop ─────────────────────────────────────────────────────────
  onDragStart(id: string): void { this.draggingId.set(id); }

  onDragOver(event: DragEvent, id: string): void {
    event.preventDefault();
    this.dropTargetId.set(id);
  }

  onDrop(event: DragEvent, id: string): void {
    event.preventDefault();
    const fromId = this.draggingId();
    if (!fromId || fromId === id) { this.onDragEnd(); return; }
    this.blocks.update((blocks) => {
      const fromIdx = blocks.findIndex((b) => b.id === fromId);
      if (fromIdx === -1) return blocks;
      const next = [...blocks];
      const [moved] = next.splice(fromIdx, 1);
      const toIdx = id === '__end__' ? next.length : next.findIndex((b) => b.id === id);
      next.splice(toIdx === -1 ? next.length : toIdx, 0, moved);
      return next;
    });
    this.onDragEnd();
  }

  onDragEnd(): void { this.draggingId.set(null); this.dropTargetId.set(null); }

  // ── Media picker ──────────────────────────────────────────────────────
  openMediaPicker(target: string): void {
    this.mediaPickerTarget.set(target);
    if (this._mediaFiles().length === 0) {
      this.mediaPickerLoading.set(true);
      void this.mediaApi.list().then((files) => { this._mediaFiles.set(files); this.mediaPickerLoading.set(false); }).catch(() => this.mediaPickerLoading.set(false));
    }
  }

  applyMediaPick(url: string): void {
    const target = this.mediaPickerTarget();
    if (!target || !url) { this.mediaPickerTarget.set(null); return; }

    if (target === 'hero') { this.patchHero('imageUrl', url); }
    else if (target === 'story-hero') { this.patchStoryHero('imageUrl', url); }
    else if (target.startsWith('slider-item-')) {
      const i = parseInt(target.split('-').pop()!, 10);
      this.patchSliderItem(i, 'imageUrl', url);
    } else if (target.startsWith('tile-')) {
      const i = parseInt(target.split('-').pop()!, 10);
      this.patchTile(i, 'imageUrl', url);
    } else if (target.startsWith('chapter-')) {
      const i = parseInt(target.split('-').pop()!, 10);
      this.patchChapter(i, 'imageUrl', url);
    }

    this.mediaPickerTarget.set(null);
  }

  // ── Image upload helpers ──────────────────────────────────────────────
  imageName(url: string): string {
    if (!url) return 'No image selected';
    try { return decodeURIComponent(url.split('/').pop() ?? url).slice(0, 40); } catch { return url.slice(0, 40); }
  }

  async uploadHeroImage(event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchHero('imageUrl', url);
  }

  async uploadSliderImage(i: number, event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchSliderItem(i, 'imageUrl', url);
  }

  async uploadCalloutImage(slideIdx: number, calloutIdx: number, event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchCallout(slideIdx, calloutIdx, 'thumbnail', url);
  }

  async uploadTileImage(i: number, event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchTile(i, 'imageUrl', url);
  }

  async uploadStoryHeroImage(event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchStoryHero('imageUrl', url);
  }

  async uploadChapterImage(i: number, event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) this.patchChapter(i, 'imageUrl', url);
  }

  async uploadAndPick(event: Event): Promise<void> {
    const url = await this.uploadFile(event);
    if (url) {
      void this.mediaApi.list().then((files) => this._mediaFiles.set(files));
      this.applyMediaPick(url);
    }
  }

  private async uploadFile(event: Event): Promise<string | null> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return null;
    const err = this.uploadApi.validate(file);
    if (err) { this.toast.error('Invalid file', err); return null; }
    this.uploading.set(true);
    return new Promise<string | null>((resolve) => {
      this.uploadApi.uploadMedia([file]).subscribe({
        next: (progress) => {
          if (progress.stage === 'done' && progress.result) {
            this.uploading.set(false);
            const r = progress.result as { storage_url?: string; preview_url?: string } | Array<{ storage_url?: string; preview_url?: string }>;
            const item = Array.isArray(r) ? r[0] : r;
            resolve(this.api.mediaUrl(item?.preview_url || item?.storage_url || ''));
          }
        },
        error: () => {
          this.uploading.set(false);
          this.toast.error('Upload failed', 'Could not upload image.');
          resolve(null);
        },
      });
    });
  }

  mediaFileName(name: string): string {
    const base = name.replace(/\.[^.]+$/, '');
    return base.length > 20 ? base.slice(0, 18) + '…' : base;
  }

  onMediaImgError(e: Event): void {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';
  }

  // ── Private helpers ───────────────────────────────────────────────────
  private normalizeBlocks(blocks: StorefrontBlock[] | undefined | null): StorefrontBlock[] {
    const incoming = Array.isArray(blocks) ? blocks : [];
    const defaults = HOME_LAYOUT_BLOCKS;
    const allowed  = new Set(defaults.map((b) => b.id));
    const ordered  = incoming
      .filter((b) => allowed.has(b.id))
      .map((b) => ({ ...defaults.find((fb) => fb.id === b.id)!, visible: b.visible !== false, collectionIds: b.collectionIds || [] }));
    const missing = defaults.filter((fb) => !ordered.some((b) => b.id === fb.id)).map((b) => ({ ...b }));
    return [...ordered, ...missing];
  }

  private scheduleDraftSave(): void {
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = window.setTimeout(
      () => void this.storefront.saveDraftRemote(this.normalizeBlocks(this.blocks())).catch(() => undefined),
      600,
    );
  }
}
