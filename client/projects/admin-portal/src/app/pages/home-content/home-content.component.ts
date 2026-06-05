import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Collection, MediaFile } from '../../models';
import { ApiClient } from '../../services/api-client.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { AdminMediaService } from '../../services/admin-media.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';

const HOME_COLLECTION_LIMIT = 3;

interface HomeDiscountHeroContent {
  imageUrl: string;
  title: string;
  body: string;
  discountText: string;
  ctaText: string;
  ctaLink: string;
}

interface HomeCollectionTileContent {
  id: string;
  /** UUID of a system collection linked to this tile. */
  collectionId?: string;
  title: string;
  imageUrl: string;
  link: string;
  ctaText?: string;
}

interface StoryHeroContent {
  kicker: string;
  title: string;
  accent: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

interface StoryChapterContent {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

interface StoryAtelierItemContent {
  id: string;
  title: string;
  meta: string;
}

interface StoryContentData {
  hero: StoryHeroContent;
  chapters: StoryChapterContent[];
  quote: {
    text: string;
    accent: string;
    author: string;
  };
  atelier: {
    kicker: string;
    title: string;
    body: string;
    items: StoryAtelierItemContent[];
  };
}

interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
  story: StoryContentData;
}

const DEFAULT_HOME_CONTENT: HomeContentData = {
  hero: {
    imageUrl: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1500&q=85&auto=format&fit=crop',
    title: "Find Your Perfect Look at Elite's New Collection",
    body: 'Step into a sharper wardrobe with curated footwear, outerwear, and everyday essentials selected for modern city style.',
    discountText: '50%',
    ctaText: 'Shop Now',
    ctaLink: '/collection',
  },
  collections: [
    {
      id: 'footwear',
      title: 'Footwear',
      imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=footwear',
    },
    {
      id: 'headwear',
      title: 'Headwear',
      imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=headwear',
      ctaText: 'Discover',
    },
    {
      id: 'jacket',
      title: 'Jacket',
      imageUrl: 'https://images.unsplash.com/photo-1520975682031-ae4edb553dcc?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=jacket',
    },
  ],
  story: {
    hero: {
      kicker: 'Est. 1962 · Doha',
      title: 'A House Built by Hand',
      accent: 'and carried by craft',
      body: 'Elite began as a small atelier serving men who wanted shoes with presence, patience, and a story in every stitch.',
      imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1600&q=85&auto=format&fit=crop',
      imageAlt: 'Handcrafted leather shoes arranged in warm atelier light',
    },
    chapters: [
      {
        id: 'origin',
        eyebrow: '1962 · The first bench',
        title: 'A single workbench in old Doha',
        body: 'Our first pairs were measured by hand, cut in quiet batches, and finished for customers who cared about the feel of leather as much as the look of it.',
        imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Leather artisan working on shoe details',
      },
      {
        id: 'materials',
        eyebrow: '1978 · Material codes',
        title: 'Leather selected like a signature',
        body: 'As the atelier grew, the ritual stayed strict: choose the hide for character, cut for longevity, and polish until the grain carries depth.',
        imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Polished formal leather shoes',
      },
      {
        id: 'shape',
        eyebrow: '1995 · The modern last',
        title: 'Classic proportions, sharper lines',
        body: 'We refined the last for city movement: leaner profiles, softer break-in, and a silhouette that works from majlis to evening.',
        imageUrl: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Craft tools and leather details',
      },
      {
        id: 'today',
        eyebrow: 'Today · Made to endure',
        title: 'Every pair still passes through human hands',
        body: 'Digital tools help us serve faster, but the final judgment remains tactile: balance, edge, polish, and the quiet confidence of a pair ready to be worn.',
        imageUrl: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Brown leather shoes on a minimal surface',
      },
    ],
    quote: {
      text: 'Luxury is not loud.',
      accent: 'It is the evidence of care, repeated until it feels effortless.',
      author: 'Elite Atelier',
    },
    atelier: {
      kicker: 'Inside the atelier',
      title: 'Many hands, one standard',
      body: 'Each role protects a different part of the promise, from the first leather inspection to the final edge finish.',
      items: [
        { id: 'leather', title: 'Leather selector', meta: '30 years of material instinct' },
        { id: 'pattern', title: 'Pattern cutter', meta: '22 years shaping the silhouette' },
        { id: 'last', title: 'Last maker', meta: '18 years balancing comfort' },
        { id: 'welt', title: 'Welt stitcher', meta: '25 years securing the build' },
        { id: 'heel', title: 'Heel builder', meta: '15 years refining stance' },
        { id: 'finish', title: 'Edge finisher', meta: '28 years of final polish' },
      ],
    },
  },
};

function cloneContent(content: HomeContentData): HomeContentData {
  return JSON.parse(JSON.stringify(content)) as HomeContentData;
}

@Component({
  selector: 'ap-home-content',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  template: `
    <div class="page-fade home-admin">
      <header class="card home-admin__header">
        <div>
          <p>Storefront Home</p>
          <h1>Hero & Featured Collections</h1>
          <span>Update the discount hero and collection grid used on the customer home page.</span>
        </div>

        <div class="home-admin__actions">
          <button type="button" class="btn btn-outline" (click)="resetToDefaults()" [disabled]="saving()">Reset</button>
          <button type="button" class="btn btn-gold" (click)="save()" [disabled]="saving() || !isDirty()">
            {{ saving() ? 'Saving...' : 'Save changes' }}
          </button>
        </div>
      </header>

      <section class="editor-grid">
        <article class="card editor-card">
          <div class="editor-card__head">
            <div>
              <p>Hero / Discount</p>
              <h2>Split showcase section</h2>
            </div>
          </div>

          <div class="field-stack">
            <label>
              <span class="lbl">Showcase image</span>
              <div class="image-picker">
                <img [src]="content().hero.imageUrl" [alt]="content().hero.title" />
                <div>
                  <strong>{{ imageName(content().hero.imageUrl) }}</strong>
                  <p>{{ uploadProgress('hero') }}</p>
                  <div class="mini-btns">
                    <input #heroFile type="file" accept="image/*" (change)="uploadHeroImage($event)" hidden />
                    <button type="button" class="btn btn-outline btn-sm" (click)="heroFile.click()" [disabled]="isUploading('hero')">
                      @if (isUploading('hero')) { <ap-spinner [size]="11"/> } @else { <ap-icon name="upload" [size]="12"/> }
                      {{ isUploading('hero') ? 'Uploading…' : 'Upload' }}
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" (click)="openMediaPicker('hero')">
                      <ap-icon name="media" [size]="12"/> Media
                    </button>
                  </div>
                </div>
              </div>
            </label>
            <label>
              <span class="lbl">Header text</span>
              <input class="inp" [ngModel]="content().hero.title" (ngModelChange)="updateHero('title', $event)" />
            </label>
            <label>
              <span class="lbl">Body text</span>
              <textarea class="inp" rows="4" [ngModel]="content().hero.body" (ngModelChange)="updateHero('body', $event)"></textarea>
            </label>

            <div class="two-col">
              <label>
                <span class="lbl">Discount text</span>
                <input class="inp" [ngModel]="content().hero.discountText" (ngModelChange)="updateHero('discountText', $event)" />
              </label>
              <label>
                <span class="lbl">Button label</span>
                <input class="inp" [ngModel]="content().hero.ctaText" (ngModelChange)="updateHero('ctaText', $event)" />
              </label>
            </div>

            <label>
              <span class="lbl">Button destination link</span>
              <input class="inp" [ngModel]="content().hero.ctaLink" (ngModelChange)="updateHero('ctaLink', $event)" />
            </label>
          </div>
        </article>

        <article class="card preview-card">
          <div class="editor-card__head">
            <div>
              <p>Live Preview</p>
              <h2>Customer hero pattern</h2>
            </div>
          </div>
          <div class="preview-hero">
            <img [src]="content().hero.imageUrl" [alt]="content().hero.title" />
            <div>
              <small>Elite Collection</small>
              <h2>{{ content().hero.title }}</h2>
              <p>{{ content().hero.body }}</p>
              <em>Come and Enjoy Sale!</em>
              <strong>{{ content().hero.discountText }}</strong>
              <span>{{ content().hero.ctaText }}</span>
            </div>
          </div>
        </article>
      </section>

      <section class="card editor-card collections-editor">
        <div class="editor-card__head">
          <div>
            <p>Featured Collections Grid</p>
            <h2>Manage the three home tiles</h2>
          </div>
          <span class="hint">Images, titles, and collection links update the storefront grid.</span>
        </div>

        <div class="tile-editor-grid">
          @for (tile of content().collections; track tile.id; let tileIdx = $index) {
            <article class="tile-editor">
              <!-- Tile preview -->
              <div class="tile-thumb">
                <img [src]="tile.imageUrl" [alt]="tile.title" />
                <span>{{ tile.title }}</span>
                <span class="tile-num">{{ tileIdx + 1 }}</span>
              </div>

              <div class="field-stack compact">
                <!-- Collection link -->
                <label>
                  <span class="lbl">Linked Collection</span>
                  <select class="inp inp-sm" [ngModel]="tile.collectionId || ''" (ngModelChange)="selectCollection(tile.id, $event)">
                    <option value="">— None (custom) —</option>
                    @for (col of collections(); track col.id) {
                      <option [value]="col.id">{{ col.title }}</option>
                    }
                  </select>
                  @if (tile.collectionId && collectionById(tile.collectionId); as col) {
                    <span class="col-linked-hint mono small">→ /collections/{{ col.handle }}</span>
                  }
                </label>

                <label>
                  <span class="lbl">Title</span>
                  <input class="inp" [ngModel]="tile.title" (ngModelChange)="updateCollection(tile.id, 'title', $event)" />
                </label>

                <label>
                  <span class="lbl">Tile image</span>
                  <div class="mini-picker">
                    @if (tile.imageUrl) {
                      <img class="mini-thumb" [src]="tile.imageUrl" [alt]="tile.title" />
                    }
                    <div class="mini-info">
                      <strong>{{ imageName(tile.imageUrl) }}</strong>
                      <small>{{ uploadProgress(tile.id) }}</small>
                    </div>
                    <div class="mini-btns">
                      <input #tileFile type="file" accept="image/*" (change)="uploadCollectionImage(tile.id, $event)" hidden />
                      <button type="button" class="btn btn-outline btn-sm" (click)="tileFile.click()" [disabled]="isUploading(tile.id)">
                        @if (isUploading(tile.id)) { <ap-spinner [size]="11"/> } @else { <ap-icon name="upload" [size]="12"/> }
                        {{ isUploading(tile.id) ? 'Uploading…' : 'Upload' }}
                      </button>
                      <button type="button" class="btn btn-outline btn-sm" (click)="openMediaPicker(tile.id)">
                        <ap-icon name="media" [size]="12"/> Media
                      </button>
                    </div>
                  </div>
                </label>

                <label>
                  <span class="lbl">Collection link</span>
                  <input class="inp" [ngModel]="tile.link" (ngModelChange)="updateCollection(tile.id, 'link', $event)" />
                </label>
                <label>
                  <span class="lbl">Optional button text</span>
                  <input class="inp" [ngModel]="tile.ctaText || ''" (ngModelChange)="updateCollection(tile.id, 'ctaText', $event)" />
                </label>
              </div>
            </article>
          }
        </div>

        <div class="grid-preview-head">
          <p>Live Grid Preview</p>
          <span>Same three-tile composition used on the customer home page.</span>
        </div>

        <div class="preview-collection-grid">
          @for (tile of content().collections; track tile.id) {
            <div class="preview-collection-tile">
              <img [src]="tile.imageUrl" [alt]="tile.title" />
              <span class="preview-overlay"></span>
              <strong>{{ tile.title }}</strong>
              @if (tile.ctaText) {
                <em>{{ tile.ctaText }}</em>
              }
            </div>
          }
        </div>
      </section>

      <section class="card editor-card story-editor">
        <div class="editor-card__head story-editor__head">
          <div>
            <p>Story Page</p>
            <h2>Editorial story builder</h2>
          </div>
          <span class="hint">Edit the /story page hero, images, quote, atelier cards, and chapter order.</span>
        </div>

        <div class="story-admin-grid">
          <article class="story-admin-panel">
            <div class="story-preview-hero">
              <img [src]="content().story.hero.imageUrl" [alt]="content().story.hero.imageAlt" />
              <div>
                <small>{{ content().story.hero.kicker }}</small>
                <h3>{{ content().story.hero.title }}</h3>
                <em>{{ content().story.hero.accent }}</em>
              </div>
            </div>

            <div class="field-stack">
              <label>
                <span class="lbl">Hero photo</span>
                <div class="mini-picker">
                  <strong>{{ imageName(content().story.hero.imageUrl) }}</strong>
                  <small>{{ uploadProgress('story-hero') }}</small>
                  <div class="mini-btns">
                    <input #storyHeroFile type="file" accept="image/*" (change)="uploadStoryHeroImage($event)" hidden />
                    <button type="button" class="btn btn-outline btn-sm" (click)="storyHeroFile.click()" [disabled]="isUploading('story-hero')">
                      @if (isUploading('story-hero')) { <ap-spinner [size]="11"/> } @else { <ap-icon name="upload" [size]="12"/> }
                      {{ isUploading('story-hero') ? 'Uploading…' : 'Upload' }}
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" (click)="openMediaPicker('story-hero')">
                      <ap-icon name="media" [size]="12"/> Media
                    </button>
                  </div>
                </div>
              </label>

              <div class="two-col">
                <label>
                  <span class="lbl">Kicker</span>
                  <input class="inp" [ngModel]="content().story.hero.kicker" (ngModelChange)="updateStoryHero('kicker', $event)" />
                </label>
                <label>
                  <span class="lbl">Image alt text</span>
                  <input class="inp" [ngModel]="content().story.hero.imageAlt" (ngModelChange)="updateStoryHero('imageAlt', $event)" />
                </label>
              </div>

              <label>
                <span class="lbl">Main title</span>
                <input class="inp" [ngModel]="content().story.hero.title" (ngModelChange)="updateStoryHero('title', $event)" />
              </label>
              <label>
                <span class="lbl">Accent line</span>
                <input class="inp" [ngModel]="content().story.hero.accent" (ngModelChange)="updateStoryHero('accent', $event)" />
              </label>
              <label>
                <span class="lbl">Intro body</span>
                <textarea class="inp" rows="4" [ngModel]="content().story.hero.body" (ngModelChange)="updateStoryHero('body', $event)"></textarea>
              </label>
            </div>
          </article>

          <article class="story-admin-panel">
            <div class="field-stack">
              <div class="grid-preview-head story-admin-subhead">
                <p>Quote Band</p>
                <span>Large editorial quote between chapters and atelier.</span>
              </div>
              <label>
                <span class="lbl">Quote text</span>
                <input class="inp" [ngModel]="content().story.quote.text" (ngModelChange)="updateStoryQuote('text', $event)" />
              </label>
              <label>
                <span class="lbl">Accent sentence</span>
                <textarea class="inp" rows="3" [ngModel]="content().story.quote.accent" (ngModelChange)="updateStoryQuote('accent', $event)"></textarea>
              </label>
              <label>
                <span class="lbl">Author</span>
                <input class="inp" [ngModel]="content().story.quote.author" (ngModelChange)="updateStoryQuote('author', $event)" />
              </label>

              <div class="grid-preview-head story-admin-subhead">
                <p>Atelier Intro</p>
                <span>Copy shown above the craft role cards.</span>
              </div>
              <label>
                <span class="lbl">Kicker</span>
                <input class="inp" [ngModel]="content().story.atelier.kicker" (ngModelChange)="updateStoryAtelier('kicker', $event)" />
              </label>
              <label>
                <span class="lbl">Title</span>
                <input class="inp" [ngModel]="content().story.atelier.title" (ngModelChange)="updateStoryAtelier('title', $event)" />
              </label>
              <label>
                <span class="lbl">Body</span>
                <textarea class="inp" rows="3" [ngModel]="content().story.atelier.body" (ngModelChange)="updateStoryAtelier('body', $event)"></textarea>
              </label>
            </div>
          </article>
        </div>

        <div class="grid-preview-head story-admin-subhead">
          <p>Sortable Chapters</p>
          <span>Drag cards, or use the arrow buttons, to change the story order.</span>
        </div>

        <div class="story-chapter-editor">
          @for (chapter of content().story.chapters; track chapter.id; let i = $index) {
            <article
              class="story-chapter-card"
              draggable="true"
              [class.dragging]="storyDraggingId() === chapter.id"
              [class.drop-target]="storyDropTargetId() === chapter.id"
              (dragstart)="onStoryDragStart(chapter.id)"
              (dragover)="onStoryDragOver($event, chapter.id)"
              (drop)="onStoryDrop($event, chapter.id)"
              (dragend)="onStoryDragEnd()"
            >
              <div class="story-chapter-card__media">
                <img [src]="chapter.imageUrl" [alt]="chapter.imageAlt" />
                <span>{{ (i + 1).toString().padStart(2, '0') }}</span>
              </div>

              <div class="story-chapter-card__body">
                <div class="story-card-tools">
                  <button type="button" class="btn btn-outline btn-sm" (click)="moveStoryChapter(chapter.id, -1)" [disabled]="i === 0">Up</button>
                  <button type="button" class="btn btn-outline btn-sm" (click)="moveStoryChapter(chapter.id, 1)" [disabled]="i === content().story.chapters.length - 1">Down</button>
                </div>

                <div class="field-stack compact">
                  <label>
                    <span class="lbl">Chapter photo</span>
                    <div class="mini-picker">
                      <strong>{{ imageName(chapter.imageUrl) }}</strong>
                      <small>{{ uploadProgress('story-' + chapter.id) }}</small>
                      <div class="mini-btns">
                        <input #storyChapterFile type="file" accept="image/*" (change)="uploadStoryChapterImage(chapter.id, $event)" hidden />
                        <button type="button" class="btn btn-outline btn-sm" (click)="storyChapterFile.click()" [disabled]="isUploading('story-' + chapter.id)">
                          @if (isUploading('story-' + chapter.id)) { <ap-spinner [size]="11"/> } @else { <ap-icon name="upload" [size]="12"/> }
                          {{ isUploading('story-' + chapter.id) ? 'Uploading…' : 'Upload' }}
                        </button>
                        <button type="button" class="btn btn-outline btn-sm" (click)="openMediaPicker('story-' + chapter.id)">
                          <ap-icon name="media" [size]="12"/> Media
                        </button>
                      </div>
                    </div>
                  </label>
                  <label>
                    <span class="lbl">Eyebrow</span>
                    <input class="inp" [ngModel]="chapter.eyebrow" (ngModelChange)="updateStoryChapter(chapter.id, 'eyebrow', $event)" />
                  </label>
                  <label>
                    <span class="lbl">Title</span>
                    <input class="inp" [ngModel]="chapter.title" (ngModelChange)="updateStoryChapter(chapter.id, 'title', $event)" />
                  </label>
                  <label>
                    <span class="lbl">Body</span>
                    <textarea class="inp" rows="4" [ngModel]="chapter.body" (ngModelChange)="updateStoryChapter(chapter.id, 'body', $event)"></textarea>
                  </label>
                  <label>
                    <span class="lbl">Image alt text</span>
                    <input class="inp" [ngModel]="chapter.imageAlt" (ngModelChange)="updateStoryChapter(chapter.id, 'imageAlt', $event)" />
                  </label>
                </div>
              </div>
            </article>
          }
        </div>

        <div class="grid-preview-head story-admin-subhead">
          <p>Atelier Cards</p>
          <span>Short role cards shown at the bottom of the story page.</span>
        </div>

        <div class="atelier-editor-grid">
          @for (item of content().story.atelier.items; track item.id) {
            <article class="atelier-editor-card">
              <label>
                <span class="lbl">Role title</span>
                <input class="inp" [ngModel]="item.title" (ngModelChange)="updateStoryAtelierItem(item.id, 'title', $event)" />
              </label>
              <label>
                <span class="lbl">Meta line</span>
                <input class="inp" [ngModel]="item.meta" (ngModelChange)="updateStoryAtelierItem(item.id, 'meta', $event)" />
              </label>
            </article>
          }
        </div>
      </section>
    </div>

    <!-- ── Media Center Picker Modal ── -->
    @if (activeMediaPicker()) {
      <div class="overlay" style="z-index:800;" (click)="activeMediaPicker.set(null)"></div>
      <div class="media-picker-modal" style="z-index:810;">
        <div class="mpm-head">
          <div>
            <p class="mpm-eyebrow">Media Center</p>
            <div class="mpm-title">Select an image</div>
          </div>
          <button class="x-btn" type="button" (click)="activeMediaPicker.set(null)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="mpm-search">
          <ap-icon name="search" [size]="13"/>
          <input class="inp with-icon" placeholder="Search by filename…" [ngModel]="mediaSearch()" (ngModelChange)="mediaSearch.set($event)"/>
        </div>
        <div class="mpm-body">
          @if (mediaLoading()) {
            <div class="mpm-loading"><ap-spinner [size]="20"/> Loading media…</div>
          } @else if (filteredMediaFiles().length === 0) {
            <div class="mpm-empty">No images found in your media library.</div>
          } @else {
            <div class="mpm-grid">
              @for (file of filteredMediaFiles(); track file.id) {
                <button type="button" class="mpm-item" (click)="applyMedia(file)" [title]="file.name">
                  <img [src]="resolveUrl(file.preview || '')" [alt]="file.name" />
                  <span class="mpm-name">{{ file.name }}</span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    /* ── Tile editor enhancements ── */
    .tile-num {
      position: absolute;
      top: 10px;
      inset-inline-start: 12px;
      background: rgba(0,0,0,.55);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      border-radius: 6px;
      padding: 2px 7px;
    }

    .col-linked-hint {
      color: var(--green);
      display: block;
      margin-top: 2px;
    }

    .mini-thumb {
      width: 100%;
      height: 80px;
      object-fit: cover;
      border-radius: 6px;
      display: block;
    }

    .mini-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mini-btns {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* ── Media picker modal ── */
    .media-picker-modal {
      position: fixed;
      inset-inline-end: 0;
      top: 0;
      bottom: 0;
      width: min(560px, 100vw);
      background: var(--surface);
      border-inline-start: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      box-shadow: -8px 0 32px rgba(0,0,0,.18);
    }

    .mpm-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 20px 14px;
      border-bottom: 1px solid var(--border-2);
    }

    .mpm-eyebrow {
      margin: 0 0 4px;
      color: var(--gold);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .14em;
      text-transform: uppercase;
    }

    .mpm-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--ink);
    }

    .mpm-search {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-2);
      background: var(--bg);
    }

    .mpm-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .mpm-search .inp { border: none; background: transparent; flex: 1; padding: 0; }
    .mpm-search .inp:focus { outline: none; box-shadow: none; }

    .mpm-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .mpm-loading,
    .mpm-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
    }

    .mpm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
    }

    .mpm-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border: 2px solid transparent;
      border-radius: 10px;
      background: var(--bg);
      padding: 0;
      cursor: pointer;
      overflow: hidden;
      transition: border-color .13s, transform .13s;
    }

    .mpm-item:hover {
      border-color: var(--gold);
      transform: scale(1.02);
    }

    .mpm-item img {
      width: 100%;
      height: 120px;
      object-fit: cover;
      display: block;
    }

    .mpm-name {
      padding: 0 8px 8px;
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .home-admin {
      display: grid;
      gap: 18px;
      color: var(--ink);
    }

    .home-admin__header {
      display: grid;
      gap: 18px;
      padding: 22px;
    }

    .home-admin__header p,
    .editor-card__head p {
      margin: 0 0 8px;
      color: var(--gold);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .home-admin__header h1,
    .editor-card__head h2 {
      margin: 0;
      color: var(--green);
      font-family: var(--ff-disp);
      font-weight: 500;
      letter-spacing: 0;
    }

    .home-admin__header h1 {
      font-size: clamp(28px, 5vw, 44px);
      line-height: 1;
    }

    .home-admin__header span,
    .hint {
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.5;
    }

    .home-admin__actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .editor-grid {
      display: grid;
      gap: 18px;
    }

    .editor-card,
    .preview-card {
      padding: 18px;
    }

    .editor-card__head {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }

    .editor-card__head h2 {
      font-size: 22px;
    }

    .field-stack {
      display: grid;
      gap: 14px;
    }

    .field-stack.compact {
      gap: 10px;
    }

    .field-stack label {
      display: grid;
      gap: 7px;
    }

    .image-picker,
    .mini-picker {
      display: grid;
      gap: 12px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
    }

    .image-picker {
      grid-template-columns: 112px minmax(0, 1fr);
      align-items: center;
    }

    .image-picker img {
      width: 112px;
      height: 84px;
      border-radius: 8px;
      object-fit: cover;
      background: var(--bg-2);
    }

    .image-picker strong,
    .mini-picker strong {
      display: block;
      max-width: 100%;
      overflow: hidden;
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-picker p,
    .mini-picker small {
      display: block;
      margin: 4px 0 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .two-col {
      display: grid;
      gap: 12px;
    }

    .preview-hero {
      display: grid;
      gap: 16px;
      height: 100%;
      min-height: 360px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
    }

    .preview-hero img {
      width: 100%;
      min-height: 240px;
      border-radius: 8px;
      object-fit: cover;
      filter: grayscale(0.15) contrast(1.04);
    }

    .preview-hero small,
    .preview-hero em {
      display: block;
      color: #64748b;
      font-style: normal;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .preview-hero h2 {
      margin: 10px 0 0;
      color: #020617;
      font-size: clamp(28px, 5vw, 46px);
      font-weight: 950;
      line-height: 0.95;
      letter-spacing: 0;
    }

    .preview-hero p {
      margin: 12px 0;
      color: #64748b;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.5;
    }

    .preview-hero strong {
      display: block;
      margin-bottom: 14px;
      color: #020617;
      font-size: 56px;
      font-weight: 950;
      line-height: 0.85;
    }

    .preview-hero span {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 18px;
      border-radius: 999px;
      background: #020617;
      color: #fff;
      font-size: 11px;
      font-weight: 900;
    }

    .tile-editor-grid {
      display: grid;
      gap: 14px;
    }

    .tile-editor {
      display: grid;
      gap: 14px;
      padding: 12px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 8px;
      background: #f8fafc;
    }

    .tile-thumb {
      position: relative;
      min-height: 180px;
      overflow: hidden;
      border-radius: 8px;
      background: #020617;
      isolation: isolate;
    }

    .tile-thumb::after {
      position: absolute;
      inset: 0;
      z-index: -1;
      background: rgba(0, 0, 0, 0.34);
      content: "";
    }

    .tile-thumb img {
      position: absolute;
      inset: 0;
      z-index: -2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: grayscale(1) contrast(1.08);
    }

    .tile-thumb span {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 16px;
      color: #fff;
      font-size: 28px;
      font-weight: 950;
      text-align: center;
    }

    .grid-preview-head {
      display: flex;
      gap: 10px;
      justify-content: space-between;
      align-items: end;
      margin: 22px 0 14px;
      padding-top: 18px;
      border-top: 1px solid var(--border-2);
    }

    .grid-preview-head p {
      margin: 0;
      color: var(--gold);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .grid-preview-head span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }

    .preview-collection-grid {
      display: grid;
      gap: 12px;
    }

    .preview-collection-tile {
      position: relative;
      display: grid;
      min-height: 190px;
      place-items: center;
      overflow: hidden;
      border-radius: 8px;
      background: #050505;
      isolation: isolate;
    }

    .preview-collection-tile img {
      position: absolute;
      inset: 0;
      z-index: -2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: grayscale(1) contrast(1.08);
    }

    .preview-overlay {
      position: absolute;
      inset: 0;
      z-index: -1;
      background: rgba(0, 0, 0, 0.36);
    }

    .preview-collection-tile strong {
      color: #fff;
      font-size: clamp(24px, 5vw, 34px);
      font-weight: 900;
      text-align: center;
    }

    .preview-collection-tile em {
      position: absolute;
      bottom: 18px;
      min-width: 116px;
      padding: 9px 18px;
      border-radius: 999px;
      background: #fff;
      color: #050505;
      font-style: normal;
      font-size: 11px;
      font-weight: 900;
      text-align: center;
    }

    .story-editor {
      display: grid;
      gap: 18px;
    }

    .story-editor__head {
      align-items: end;
    }

    .story-admin-grid {
      display: grid;
      gap: 16px;
    }

    .story-admin-panel,
    .story-chapter-card,
    .atelier-editor-card {
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 8px;
      background: #f8fafc;
    }

    .story-admin-panel {
      display: grid;
      gap: 16px;
      padding: 12px;
    }

    .story-preview-hero {
      position: relative;
      min-height: 330px;
      overflow: hidden;
      border-radius: 8px;
      background: #111827;
      isolation: isolate;
    }

    .story-preview-hero::after {
      position: absolute;
      inset: 0;
      z-index: -1;
      background: linear-gradient(180deg, rgba(255,255,255,.72), rgba(255,255,255,.2) 42%, rgba(17,24,39,.72));
      content: "";
    }

    .story-preview-hero img {
      position: absolute;
      inset: 0;
      z-index: -2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: saturate(.9) contrast(1.04);
    }

    .story-preview-hero div {
      position: absolute;
      left: 18px;
      right: 18px;
      bottom: 18px;
    }

    .story-preview-hero small {
      color: #f7d99a;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    .story-preview-hero h3 {
      margin: 8px 0 2px;
      color: #fff;
      font-family: var(--ff-disp);
      font-size: clamp(28px, 5vw, 46px);
      font-weight: 650;
      line-height: .95;
    }

    .story-preview-hero em {
      color: #f7d99a;
      font-family: var(--ff-disp);
      font-size: clamp(20px, 4vw, 32px);
      font-style: italic;
      font-weight: 500;
    }

    .story-admin-subhead {
      margin-top: 2px;
    }

    .story-chapter-editor {
      display: grid;
      gap: 14px;
    }

    .story-chapter-card {
      display: grid;
      gap: 14px;
      padding: 12px;
      transition: border-color .16s ease, background .16s ease, opacity .16s ease, transform .16s ease;
    }

    .story-chapter-card.dragging {
      opacity: .52;
      transform: scale(.995);
    }

    .story-chapter-card.drop-target {
      border-color: var(--gold);
      background: var(--gold-3);
    }

    .story-chapter-card__media {
      position: relative;
      min-height: 230px;
      overflow: hidden;
      border-radius: 8px;
      background: #111827;
    }

    .story-chapter-card__media img {
      width: 100%;
      height: 100%;
      min-height: inherit;
      object-fit: cover;
    }

    .story-chapter-card__media span {
      position: absolute;
      right: 14px;
      bottom: 12px;
      color: rgba(255,255,255,.8);
      font-family: var(--ff-disp);
      font-size: 46px;
      font-weight: 700;
      line-height: .82;
    }

    .story-chapter-card__body {
      display: grid;
      gap: 12px;
    }

    .story-card-tools {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .atelier-editor-grid {
      display: grid;
      gap: 12px;
    }

    .atelier-editor-card {
      display: grid;
      gap: 10px;
      padding: 12px;
    }

    .atelier-editor-card label {
      display: grid;
      gap: 7px;
    }

    @media (min-width: 720px) {
      .home-admin__header {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        padding: 26px;
      }

      .two-col,
      .tile-editor-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .preview-collection-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .story-editor__head,
      .story-admin-grid,
      .story-chapter-card {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .atelier-editor-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1120px) {
      .editor-grid {
        grid-template-columns: minmax(0, 1fr) minmax(360px, 0.85fr);
      }

      .tile-editor-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .preview-collection-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .preview-collection-tile {
        min-height: 318px;
      }

      .atelier-editor-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `],
})
export class HomeContentComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly uploads = inject(MediaUploadService);
  private readonly toast = inject(ToastService);
  private readonly mediaApi = inject(AdminMediaService);
  private readonly collectionsApi = inject(AdminCollectionsService);

  readonly content = signal<HomeContentData>(cloneContent(DEFAULT_HOME_CONTENT));
  readonly savedSnapshot = signal(JSON.stringify(DEFAULT_HOME_CONTENT));
  readonly saving = signal(false);
  readonly uploadState = signal<Record<string, number | 'error'>>({});
  readonly storyDraggingId = signal<string | null>(null);
  readonly storyDropTargetId = signal<string | null>(null);
  readonly isDirty = computed(() => JSON.stringify(this.content()) !== this.savedSnapshot());

  // ── Collections ───────────────────────────────────────────────────────────
  readonly collections = signal<Collection[]>([]);

  collectionById(id: string): Collection | undefined {
    return this.collections().find(c => c.id === id);
  }

  selectCollection(tileId: string, colId: string): void {
    if (!colId) {
      this.content.update(cur => ({
        ...cur,
        collections: cur.collections.map(t =>
          t.id === tileId ? { ...t, collectionId: undefined } : t,
        ),
      }));
      return;
    }
    const col = this.collections().find(c => c.id === colId);
    if (!col) return;
    this.content.update(cur => ({
      ...cur,
      collections: cur.collections.map(t =>
        t.id === tileId
          ? {
              ...t,
              collectionId: colId,
              title: col.title,
              link: `/collections/${col.handle}`,
              ...(col.imageUrl ? { imageUrl: this.resolveMediaUrl(col.imageUrl) } : {}),
            }
          : t,
      ),
    }));
  }

  // ── Media center picker ───────────────────────────────────────────────────
  readonly activeMediaPicker = signal<string | null>(null);
  readonly mediaFiles = signal<MediaFile[]>([]);
  readonly mediaLoading = signal(false);
  readonly mediaSearch = signal('');

  readonly filteredMediaFiles = computed(() => {
    const s = this.mediaSearch().toLowerCase();
    return this.mediaFiles().filter(f =>
      f.kind === 'image' && (!s || f.name.toLowerCase().includes(s)),
    );
  });

  async openMediaPicker(key: string): Promise<void> {
    this.activeMediaPicker.set(key);
    this.mediaSearch.set('');
    if (this.mediaFiles().length === 0) {
      this.mediaLoading.set(true);
      try {
        const files = await this.mediaApi.list();
        this.mediaFiles.set(files);
      } catch {
        this.toast.error('Could not load media library', 'Check your connection and try again.');
      } finally {
        this.mediaLoading.set(false);
      }
    }
  }

  applyMedia(file: MediaFile): void {
    const key = this.activeMediaPicker();
    if (!key) return;
    const raw = (file as MediaFile & { storageUrl?: string }).storageUrl || file.preview || '';
    const url = this.resolveMediaUrl(raw);
    if (!url) {
      this.toast.error('No URL for this media file');
      return;
    }
    if (key === 'hero') {
      this.updateHero('imageUrl', url);
    } else if (key === 'story-hero') {
      this.updateStoryHero('imageUrl', url);
    } else if (key.startsWith('story-')) {
      this.updateStoryChapter(key.slice('story-'.length), 'imageUrl', url);
    } else {
      this.updateCollection(key, 'imageUrl', url);
    }
    this.activeMediaPicker.set(null);
  }

  /** Public wrapper so the template can call resolveMediaUrl. */
  resolveUrl(url: string): string {
    return this.resolveMediaUrl(url);
  }

  async ngOnInit(): Promise<void> {
    // Load collections for the tile selector (parallel with content)
    void this.collectionsApi.list().then(list => {
      this.collections.set(list.filter(c => !c.hidden));
    }).catch(() => { /* non-fatal */ });

    try {
      const data = await firstValueFrom(this.api.get<HomeContentData>('/admin/storefront-content'));
      const normalized = this.normalizeContentImages(data);
      this.content.set(normalized);
      this.savedSnapshot.set(JSON.stringify(normalized));
    } catch {
      this.toast.warning('Using default content', 'The API content could not be loaded.');
    }
  }

  updateHero<K extends keyof HomeDiscountHeroContent>(key: K, value: HomeDiscountHeroContent[K]): void {
    this.content.update((current) => ({
      ...current,
      hero: {
        ...current.hero,
        [key]: value,
      },
    }));
  }

  updateCollection<K extends keyof Omit<HomeCollectionTileContent, 'id'>>(
    id: string,
    key: K,
    value: HomeCollectionTileContent[K],
  ): void {
    this.content.update((current) => ({
      ...current,
      collections: current.collections.map((tile) => (
        tile.id === id
          ? { ...tile, [key]: typeof value === 'string' && value.trim() === '' && key === 'ctaText' ? undefined : value }
          : tile
      )),
    }));
  }

  uploadHeroImage(event: Event): void {
    this.uploadImage('hero', event, (url) => this.updateHero('imageUrl', url));
  }

  uploadCollectionImage(id: string, event: Event): void {
    this.uploadImage(id, event, (url) => this.updateCollection(id, 'imageUrl', url));
  }

  updateStoryHero<K extends keyof StoryHeroContent>(key: K, value: StoryHeroContent[K]): void {
    this.content.update((current) => ({
      ...current,
      story: {
        ...current.story,
        hero: {
          ...current.story.hero,
          [key]: value,
        },
      },
    }));
  }

  updateStoryChapter<K extends keyof Omit<StoryChapterContent, 'id'>>(
    id: string,
    key: K,
    value: StoryChapterContent[K],
  ): void {
    this.content.update((current) => ({
      ...current,
      story: {
        ...current.story,
        chapters: current.story.chapters.map((chapter) => (
          chapter.id === id ? { ...chapter, [key]: value } : chapter
        )),
      },
    }));
  }

  updateStoryQuote<K extends keyof StoryContentData['quote']>(key: K, value: StoryContentData['quote'][K]): void {
    this.content.update((current) => ({
      ...current,
      story: {
        ...current.story,
        quote: {
          ...current.story.quote,
          [key]: value,
        },
      },
    }));
  }

  updateStoryAtelier<K extends Exclude<keyof StoryContentData['atelier'], 'items'>>(
    key: K,
    value: StoryContentData['atelier'][K],
  ): void {
    this.content.update((current) => ({
      ...current,
      story: {
        ...current.story,
        atelier: {
          ...current.story.atelier,
          [key]: value,
        },
      },
    }));
  }

  updateStoryAtelierItem<K extends keyof Omit<StoryAtelierItemContent, 'id'>>(
    id: string,
    key: K,
    value: StoryAtelierItemContent[K],
  ): void {
    this.content.update((current) => ({
      ...current,
      story: {
        ...current.story,
        atelier: {
          ...current.story.atelier,
          items: current.story.atelier.items.map((item) => (
            item.id === id ? { ...item, [key]: value } : item
          )),
        },
      },
    }));
  }

  uploadStoryHeroImage(event: Event): void {
    this.uploadImage('story-hero', event, (url) => this.updateStoryHero('imageUrl', url));
  }

  uploadStoryChapterImage(id: string, event: Event): void {
    this.uploadImage(`story-${id}`, event, (url) => this.updateStoryChapter(id, 'imageUrl', url));
  }

  moveStoryChapter(id: string, direction: -1 | 1): void {
    this.content.update((current) => {
      const chapters = [...current.story.chapters];
      const index = chapters.findIndex((chapter) => chapter.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= chapters.length) return current;
      const [moved] = chapters.splice(index, 1);
      chapters.splice(nextIndex, 0, moved);
      return {
        ...current,
        story: {
          ...current.story,
          chapters,
        },
      };
    });
  }

  onStoryDragStart(id: string): void {
    this.storyDraggingId.set(id);
  }

  onStoryDragOver(event: DragEvent, id: string): void {
    event.preventDefault();
    this.storyDropTargetId.set(id);
  }

  onStoryDrop(event: DragEvent, id: string): void {
    event.preventDefault();
    const draggingId = this.storyDraggingId();
    if (!draggingId || draggingId === id) {
      this.onStoryDragEnd();
      return;
    }

    this.content.update((current) => {
      const chapters = [...current.story.chapters];
      const fromIndex = chapters.findIndex((chapter) => chapter.id === draggingId);
      const toIndex = chapters.findIndex((chapter) => chapter.id === id);
      if (fromIndex === -1 || toIndex === -1) return current;
      const [moved] = chapters.splice(fromIndex, 1);
      chapters.splice(toIndex, 0, moved);
      return {
        ...current,
        story: {
          ...current.story,
          chapters,
        },
      };
    });
    this.onStoryDragEnd();
  }

  onStoryDragEnd(): void {
    this.storyDraggingId.set(null);
    this.storyDropTargetId.set(null);
  }

  isUploading(key: string): boolean {
    const state = this.uploadState()[key];
    return typeof state === 'number' && state < 100;
  }

  uploadProgress(key: string): string {
    const state = this.uploadState()[key];
    if (state === 'error') return 'Upload failed. Try another image.';
    if (typeof state === 'number' && state < 100) return `${state}% uploaded`;
    return 'JPG, PNG, WebP, GIF, or AVIF';
  }

  imageName(value: string): string {
    const clean = (value || '').split('?')[0].split('/').filter(Boolean).pop();
    return clean || 'No photo selected';
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const data = await firstValueFrom(this.api.patch<HomeContentData>('/admin/storefront-content', this.content()));
      const normalized = this.normalizeContentImages(data);
      this.content.set(normalized);
      this.savedSnapshot.set(JSON.stringify(normalized));
      this.toast.success('Home content saved', 'The customer home page will use this layout content.');
    } catch {
      this.toast.error('Save failed', 'Please check the content fields and try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async resetToDefaults(): Promise<void> {
    this.saving.set(true);
    try {
      const data = await firstValueFrom(this.api.post<HomeContentData>('/admin/storefront-content/reset', {}));
      const normalized = this.normalizeContentImages(data);
      this.content.set(normalized);
      this.savedSnapshot.set(JSON.stringify(normalized));
      this.toast.info('Home content reset', 'The default hero and grid content has been restored.');
    } catch {
      this.toast.error('Reset failed', 'The default content could not be restored.');
    } finally {
      this.saving.set(false);
    }
  }

  private uploadImage(key: string, event: Event, applyUrl: (url: string) => void): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast.error('Please choose an image file', file.name);
      return;
    }

    const reason = this.uploads.validate(file);
    if (reason) {
      this.toast.error(reason, file.name);
      return;
    }

    this.uploadState.update((state) => ({ ...state, [key]: 1 }));

    this.uploads.uploadMedia([file]).subscribe({
      next: (event) => {
        if (event.stage === 'uploading') {
          this.uploadState.update((state) => ({ ...state, [key]: event.percent }));
        }

        if (event.stage === 'done') {
          const uploaded = Array.isArray(event.result) ? event.result[0] : event.result;
          const media = uploaded as (MediaFile & { storageUrl?: string; storage_url?: string }) | undefined;
          // Try every URL field the server might return
          const raw = media?.preview || media?.storageUrl || media?.storage_url || '';
          const url = this.resolveMediaUrl(raw);
          if (!url) {
            this.uploadState.update((state) => ({ ...state, [key]: 'error' }));
            this.toast.error('Upload finished without an image URL', file.name);
            return;
          }

          applyUrl(url);
          // Refresh media list so the new file appears in the picker
          void this.mediaApi.list().then(files => this.mediaFiles.set(files)).catch(() => {});
          this.uploadState.update((state) => ({ ...state, [key]: 100 }));
          this.toast.success('Photo uploaded', `${file.name} is now used in the home layout.`);
        }
      },
      error: () => {
        this.uploadState.update((state) => ({ ...state, [key]: 'error' }));
        this.toast.error('Upload failed', file.name);
      },
    });
  }

  private normalizeContentImages(data: HomeContentData): HomeContentData {
    const fallback = cloneContent(DEFAULT_HOME_CONTENT);
    const next = cloneContent({
      ...fallback,
      ...data,
      hero: { ...fallback.hero, ...(data.hero || {}) },
      collections: Array.isArray(data.collections) ? data.collections : fallback.collections,
      story: {
        ...fallback.story,
        ...(data.story || {}),
        hero: { ...fallback.story.hero, ...(data.story?.hero || {}) },
        chapters: Array.isArray(data.story?.chapters) ? data.story.chapters : fallback.story.chapters,
        quote: { ...fallback.story.quote, ...(data.story?.quote || {}) },
        atelier: {
          ...fallback.story.atelier,
          ...(data.story?.atelier || {}),
          items: Array.isArray(data.story?.atelier?.items) ? data.story.atelier.items : fallback.story.atelier.items,
        },
      },
    });
    next.hero.imageUrl = this.resolveMediaUrl(next.hero.imageUrl);
    next.collections = next.collections.slice(0, HOME_COLLECTION_LIMIT).map((tile) => ({
      ...tile,
      imageUrl: this.resolveMediaUrl(tile.imageUrl),
    }));
    next.story.hero.imageUrl = this.resolveMediaUrl(next.story.hero.imageUrl);
    next.story.chapters = next.story.chapters.map((chapter) => ({
      ...chapter,
      imageUrl: this.resolveMediaUrl(chapter.imageUrl),
    }));
    return next;
  }

  private resolveMediaUrl(url: string): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.api.url('/').replace(/\/api\/?$/, '')}${value}`;
  }
}
