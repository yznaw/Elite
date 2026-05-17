import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MediaFile } from '../../models';
import { ApiClient } from '../../services/api-client.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { ToastService } from '../../services/toast.service';

type HomeCollectionTileId =
  | 'footwear'
  | 'headwear'
  | 'jacket'
  | 'bags'
  | 'accessories'
  | 'bottoms';

interface HomeDiscountHeroContent {
  imageUrl: string;
  title: string;
  body: string;
  discountText: string;
  ctaText: string;
  ctaLink: string;
}

interface HomeCollectionTileContent {
  id: HomeCollectionTileId;
  title: string;
  imageUrl: string;
  link: string;
  ctaText?: string;
}

interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
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
    {
      id: 'bags',
      title: 'Bags',
      imageUrl: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=bags',
    },
    {
      id: 'accessories',
      title: 'Accessories',
      imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=accessories',
    },
    {
      id: 'bottoms',
      title: 'Bottoms',
      imageUrl: 'https://images.unsplash.com/photo-1516826957135-700dedea698c?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=bottoms',
    },
  ],
};

function cloneContent(content: HomeContentData): HomeContentData {
  return JSON.parse(JSON.stringify(content)) as HomeContentData;
}

@Component({
  selector: 'ap-home-content',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
                  <input #heroFile type="file" accept="image/*" (change)="uploadHeroImage($event)" hidden />
                  <button type="button" class="btn btn-outline btn-sm" (click)="heroFile.click()" [disabled]="isUploading('hero')">
                    {{ isUploading('hero') ? 'Uploading...' : 'Upload photo' }}
                  </button>
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
            <h2>Manage each asymmetrical tile</h2>
          </div>
          <span class="hint">Images, titles, and collection links update the storefront grid.</span>
        </div>

        <div class="tile-editor-grid">
          @for (tile of content().collections; track tile.id) {
            <article class="tile-editor">
              <div class="tile-thumb">
                <img [src]="tile.imageUrl" [alt]="tile.title" />
                <span>{{ tile.title }}</span>
              </div>

              <div class="field-stack compact">
                <label>
                  <span class="lbl">Title</span>
                  <input class="inp" [ngModel]="tile.title" (ngModelChange)="updateCollection(tile.id, 'title', $event)" />
                </label>
                <label>
                  <span class="lbl">Tile image</span>
                  <div class="mini-picker">
                    <strong>{{ imageName(tile.imageUrl) }}</strong>
                    <small>{{ uploadProgress(tile.id) }}</small>
                    <input #tileFile type="file" accept="image/*" (change)="uploadCollectionImage(tile.id, $event)" hidden />
                    <button type="button" class="btn btn-outline btn-sm" (click)="tileFile.click()" [disabled]="isUploading(tile.id)">
                      {{ isUploading(tile.id) ? 'Uploading...' : 'Upload photo' }}
                    </button>
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
          <span>Same asymmetrical composition used on the customer home page.</span>
        </div>

        <div class="preview-collection-grid">
          @for (tile of content().collections; track tile.id) {
            <div [class]="'preview-collection-tile preview-tile-' + tile.id">
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
    </div>
  `,
  styles: [`
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
        grid-template-rows: repeat(4, 106px);
      }

      .preview-collection-tile {
        min-height: 0;
      }

      .preview-tile-footwear { grid-column: 1; grid-row: 1 / 3; }
      .preview-tile-headwear { grid-column: 1; grid-row: 3 / 5; }
      .preview-tile-jacket { grid-column: 2; grid-row: 1 / 4; }
      .preview-tile-bags { grid-column: 2; grid-row: 4 / 5; }
      .preview-tile-accessories { grid-column: 3; grid-row: 1 / 2; }
      .preview-tile-bottoms { grid-column: 3; grid-row: 2 / 5; }
    }
  `],
})
export class HomeContentComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly uploads = inject(MediaUploadService);
  private readonly toast = inject(ToastService);

  readonly content = signal<HomeContentData>(cloneContent(DEFAULT_HOME_CONTENT));
  readonly savedSnapshot = signal(JSON.stringify(DEFAULT_HOME_CONTENT));
  readonly saving = signal(false);
  readonly uploadState = signal<Record<string, number | 'error'>>({});
  readonly isDirty = computed(() => JSON.stringify(this.content()) !== this.savedSnapshot());

  async ngOnInit(): Promise<void> {
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
    id: HomeCollectionTileId,
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

  uploadCollectionImage(id: HomeCollectionTileId, event: Event): void {
    this.uploadImage(id, event, (url) => this.updateCollection(id, 'imageUrl', url));
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
          const media = uploaded as (MediaFile & { storageUrl?: string }) | undefined;
          const url = this.resolveMediaUrl(media?.preview || media?.storageUrl || '');
          if (!url) {
            this.uploadState.update((state) => ({ ...state, [key]: 'error' }));
            this.toast.error('Upload finished without an image URL', file.name);
            return;
          }

          applyUrl(url);
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
    const next = cloneContent(data);
    next.hero.imageUrl = this.resolveMediaUrl(next.hero.imageUrl);
    next.collections = next.collections.map((tile) => ({
      ...tile,
      imageUrl: this.resolveMediaUrl(tile.imageUrl),
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
