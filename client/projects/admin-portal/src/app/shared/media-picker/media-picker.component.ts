import { Component, EventEmitter, Input, Output, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AdminMediaService } from '../../services/admin-media.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { ApiClient } from '../../services/api-client.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { MediaFile } from '../../models';

/**
 * Pick one image from the media library, or upload a new one.
 *
 * Extracted from the storefront content editor, which had the only full
 * version of this panel; the product drawer has a second, multi-select copy
 * that is left alone for now. New screens should use this one rather than
 * adding a third.
 *
 * `picked` emits the image's **relative** path (`/uploads/...`), never
 * `ApiClient.mediaUrl()`'s absolute form: on a development machine that is
 * `http://localhost:3000/...`, and screens save what they are given straight
 * into content that production then serves. Resolve for display at render
 * time instead.
 */
@Component({
  selector: 'ap-media-picker',
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="overlay media-picker-overlay" (click)="close.emit()"></div>
      <div class="drawer media-picker-drawer" role="dialog" aria-modal="true">

        <div class="mpp-head">
          <div style="min-width:0;">
            <p class="mpp-eyebrow">{{ t('storefront.editor.mediaPicker.eyebrow') }}</p>
            <div class="card-title" style="margin:0;">{{ t('storefront.editor.mediaPicker.title') }}</div>
            @if (!loading()) {
              <div class="muted small mt-4">
                {{ filtered().length }}
                {{ filtered().length === 1 ? t('storefront.editor.mediaPicker.imageCount.one') : t('storefront.editor.mediaPicker.imageCount.many') }}
              </div>
            }
          </div>
          <button class="x-btn" style="flex-shrink:0;" type="button" (click)="close.emit()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
        </div>

        <div class="mpp-toolbar">
          <div class="mpp-search">
            <ap-icon name="search" [size]="13"/>
            <input class="inp" [placeholder]="t('storefront.editor.mediaPicker.searchPlaceholder')"
                   [ngModel]="search()" (ngModelChange)="search.set($event)"/>
          </div>
          <label class="btn btn-gold btn-sm mpp-upload-btn" style="cursor:pointer;flex-shrink:0;">
            @if (uploading()) { <ap-spinner [size]="10"/> {{ t('storefront.editor.mediaPicker.uploading') }} }
            @else { <ap-icon name="upload" [size]="12"/> {{ t('storefront.editor.mediaPicker.upload') }} }
            <input type="file" accept="image/*" hidden [disabled]="uploading()" (change)="uploadAndPick($event)"/>
          </label>
        </div>

        <div class="mpp-body">
          @if (loading()) {
            <div class="mpp-state">
              <ap-spinner/> <span>{{ t('storefront.editor.mediaPicker.loading') }}</span>
            </div>
          } @else if (filtered().length === 0) {
            <div class="mpp-state mpp-empty">
              <ap-icon name="media" [size]="36"/>
              <p class="strong">{{ t('storefront.editor.mediaPicker.noImages') }}</p>
              <p class="muted small">
                {{ search() ? t('storefront.editor.mediaPicker.trySearch') : t('storefront.editor.mediaPicker.uploadToStart') }}
              </p>
            </div>
          } @else {
            <div class="media-picker-grid">
              @for (m of filtered(); track m.id) {
                <button class="mp-item" type="button" (click)="pick(m)">
                  <div class="mp-item__img-wrap">
                    <img [src]="display(m.preview)" [alt]="m.name" (error)="onImgError($event)"/>
                    <div class="mp-item__overlay"><ap-icon name="check" [size]="20"/></div>
                  </div>
                  <div class="mp-item__name">{{ shortName(m.name) }}</div>
                </button>
              }
            </div>
          }
        </div>

      </div>
    }
  `,
  styles: [`
    /* Above whatever opened it. The global scale is: overlay 200, drawer 210,
       and a drawer's own nested modal 220/230 (see the collection drawer's
       product picker). At the global 200 this panel opened *behind* the
       drawer that summoned it -- the dimming showed, the panel did not. 300
       is taken globally, so this sits just under it. */
    .media-picker-overlay { z-index: 240; }

    .media-picker-drawer {
      position: fixed; inset-block: 0; inset-inline-end: 0;
      width: 380px; z-index: 250;
      display: flex; flex-direction: column;
      background: var(--surface);
      box-shadow: -10px 0 40px rgba(0,0,0,.18);
    }

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

    .mpp-toolbar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: var(--bg);
      border-bottom: 1px solid var(--border-2);
      flex-shrink: 0;
    }
    .mpp-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .mpp-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .mpp-search .inp { border: none; background: transparent; padding: 0; flex: 1; }
    .mpp-search .inp:focus { outline: none; box-shadow: none; }
    .mpp-upload-btn { white-space: nowrap; }

    .mpp-body { flex: 1; overflow-y: auto; padding: 14px; }

    .mpp-state {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 10px; padding: 56px 24px;
      color: var(--muted); font-size: 13px;
    }
    .mpp-empty p { margin: 0; }

    .media-picker-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

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
    .mp-item__img-wrap { position: relative; aspect-ratio: 1; overflow: hidden; background: var(--bg-2); }
    .mp-item__img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
    .mp-item:hover .mp-item__img-wrap img { transform: scale(1.04); }

    .mp-item__overlay {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(197,165,114,0.82);
      color: #fff;
      opacity: 0; transition: opacity 0.15s;
    }
    .mp-item:hover .mp-item__overlay { opacity: 1; }

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
export class MediaPickerComponent {
  private readonly mediaApi = inject(AdminMediaService);
  private readonly uploads = inject(MediaUploadService);
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  /** Opening loads the library; it is refetched each time, since another tab may have uploaded. */
  @Input() set open(value: boolean) {
    this._open = value;
    if (value) void this.load();
  }
  get open(): boolean { return this._open; }
  private _open = false;

  /** The chosen image's relative path (`/uploads/...`). */
  @Output() readonly picked = new EventEmitter<string>();
  @Output() readonly close = new EventEmitter<void>();

  readonly search = signal('');
  readonly loading = signal(false);
  readonly uploading = signal(false);
  private readonly files = signal<MediaFile[]>([]);

  readonly filtered = computed(() => {
    const term = this.search().toLowerCase();
    return this.files().filter((m) => m.kind === 'image' && (!term || m.name.toLowerCase().includes(term)));
  });

  /** Thumbnails need an absolute URL to render inside the admin; stored values do not. */
  display(path: string | undefined): string {
    return this.api.mediaUrl(path || '');
  }

  shortName(name: string): string {
    const base = name.replace(/\.[^.]+$/, '');
    return base.length > 20 ? base.slice(0, 18) + '…' : base;
  }

  onImgError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  pick(file: MediaFile): void {
    const path = file.storageUrl || file.preview || '';
    if (!path) return;
    this.picked.emit(path);
    this.close.emit();
  }

  async uploadAndPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const reason = this.uploads.validate(file);
    if (reason) {
      this.toast.error(this.t('storefront.editor.toast.uploadFailed'), reason);
      return;
    }

    this.uploading.set(true);
    this.uploads.uploadMedia([file]).subscribe({
      next: (progress) => {
        if (progress.stage !== 'done') return;
        this.uploading.set(false);
        const result = progress.result as MediaFile[] | MediaFile | null | undefined;
        const item = Array.isArray(result) ? result[0] : result;
        if (item) {
          this.files.update((list) => [item, ...list]);
          this.pick(item);
        } else {
          this.toast.error(
            this.t('storefront.editor.toast.uploadError'),
            this.t('storefront.editor.toast.uploadError.sub'),
          );
        }
      },
      error: () => {
        this.uploading.set(false);
        this.toast.error(
          this.t('storefront.editor.toast.uploadFailed'),
          this.t('storefront.editor.toast.uploadFailed.sub'),
        );
      },
    });
  }

  private async load(): Promise<void> {
    this.search.set('');
    this.loading.set(true);
    try {
      this.files.set(await this.mediaApi.list());
    } catch {
      this.toast.error(this.t('storefront.editor.mediaPicker.noImages'));
    } finally {
      this.loading.set(false);
    }
  }
}
