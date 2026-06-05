import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { MediaCardComponent } from './media-card.component';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { AutoLinkModalComponent, LinkPair } from './auto-link-modal.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { AdminMediaService } from '../../services/admin-media.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { MediaUploadService } from '../../services/media-upload.service';
import { fmtBytes, MediaFile, Product } from '../../models';

type FilterKey = 'all' | 'image' | 'glb' | 'unlinked';

interface PendingUpload {
  id: string;
  name: string;
  thumb: string;
  percent: number;
  error?: string;
}

@Component({
  selector: 'ap-media',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, EmptyStateComponent, PaginationComponent, MediaCardComponent, MediaDetailDrawerComponent, AutoLinkModalComponent],
  template: `
    <div class="page-fade">
      <div class="grid-4 mb-24">
        <div class="stat-card">
          <div class="lbl">{{ t('media.totalFiles') }}</div>
          <div class="v">{{ counts().all }}</div>
          <div class="muted small mt-8">{{ counts().image }} {{ t('media.filter.images') }} · {{ counts().glb }} {{ t('media.filter.3d') }}</div>
        </div>
        <div class="stat-card">
          <div class="lbl">{{ t('media.linkedCount') }}</div>
          <div class="v" style="color:var(--success);">{{ counts().all - counts().unlinked }}</div>
          <div class="muted small mt-8">{{ linkedPercent() }}%</div>
        </div>
        <div class="stat-card">
          <div class="lbl">{{ t('media.unlinkedCount') }}</div>
          <div class="v" style="color:var(--warning);">{{ counts().unlinked }}</div>
        </div>
        <div class="stat-card">
          <div class="lbl">{{ t('media.storage') }}</div>
          <div class="v mono">{{ totalSize() }}</div>
          <div class="muted small mt-8">/ 50 GB</div>
        </div>
      </div>

      <div class="card mb-24">
        <div class="card-pad">
          <div class="drop-zone" [class.drag-over]="dragOver()"
               (dragover)="onDragOver($event)"
               (dragleave)="dragOver.set(false)"
               (drop)="onDrop($event)">
            <div class="drop-zone-icon"><ap-icon name="upload" [size]="18"/></div>
            <div class="strong" style="font-family:var(--ff-disp);font-size:20px;color:var(--green);margin-bottom:4px;">
              {{ t('media.dropFiles') }}
            </div>
            <div class="muted small mb-16">
              {{ t('media.dropFiles.sub') }}<br/>
              {{ t('media.dropFiles.autoLink') }}
            </div>
            <div class="row gap-sm" style="justify-content:center;flex-wrap:wrap;">
              <label class="btn btn-primary" style="cursor:pointer;">
                <ap-icon name="upload" [size]="14"/> {{ t('media.browse') }}
                <input type="file" multiple accept="image/*,.glb,.gltf" hidden (change)="onPick($event)"/>
              </label>
              <button class="btn btn-outline" (click)="openGDrive()">
                <ap-icon name="link" [size]="14"/> Google Drive
              </button>
              <button class="btn btn-gold" [disabled]="counts().unlinked === 0" (click)="autoLinking.set(true)">
                <ap-icon name="wand" [size]="14"/>
                {{ t('media.autoLink') }}
                @if (counts().unlinked > 0) {
                  <span style="padding:2px 8px;background:rgba(2,70,56,0.15);border-radius:999px;font-size:10px;">{{ counts().unlinked }}</span>
                }
              </button>
            </div>
          </div>

          @if (pending().length > 0) {
            <div class="upload-list">
              @for (u of pending(); track u.id) {
                <div class="upload-row" [class.is-error]="!!u.error">
                  <div class="upload-thumb">
                    @if (u.thumb) { <img [src]="u.thumb" [alt]="u.name"/> }
                    @else { <ap-icon name="cube" [size]="18"/> }
                  </div>
                  <div class="upload-meta">
                    <div class="upload-name">{{ u.name }}</div>
                    @if (u.error) {
                      <div class="upload-error">{{ u.error }}</div>
                    } @else {
                      <div class="upload-progress">
                        <div class="upload-progress-fill" [style.width.%]="u.percent"></div>
                      </div>
                    }
                  </div>
                  <div class="upload-pct">{{ u.error ? '!' : (u.percent + '%') }}</div>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <div class="row gap-sm mb-16" style="justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div class="row gap-sm" style="flex-wrap:wrap;">
          <button class="chip" [class.active]="filter() === 'all'" (click)="filter.set('all'); page.set(0)">
            {{ t('media.filter.all') }} <span class="chip-count">{{ counts().all }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'image'" (click)="filter.set('image'); page.set(0)">
            {{ t('media.filter.images') }} <span class="chip-count">{{ counts().image }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'glb'" (click)="filter.set('glb'); page.set(0)">
            {{ t('media.filter.3d') }} <span class="chip-count">{{ counts().glb }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'unlinked'" (click)="filter.set('unlinked'); page.set(0)"
                  [style.background]="filter() === 'unlinked' ? 'var(--warning)' : ''" [style.border-color]="filter() === 'unlinked' ? 'var(--warning)' : ''">
            {{ t('media.filter.unlinked') }} <span class="chip-count">{{ counts().unlinked }}</span>
          </button>
        </div>

        @if (counts().unlinked > 0) {
          <button class="btn btn-danger-outline btn-sm" [disabled]="cleaningUp()" (click)="cleanupOrphaned()">
            @if (cleaningUp()) {
              <span class="pg-spinner"></span> Cleaning up…
            } @else {
              🗑 Clean up {{ counts().unlinked }} unlinked {{ counts().unlinked === 1 ? 'file' : 'files' }} ({{ orphanedSize() }})
            }
          </button>
        }
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="media" [title]="t('media.empty.title')" [sub]="t('media.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="filter.set('all')">{{ t('common.clearFilter') }}</button>
          </ap-empty-state>
        </div>
      } @else {
        <div class="media-grid">
          @for (m of pagedMedia(); track m.id) {
            <ap-media-card [media]="m" [products]="products()" [selected]="active()?.id === m.id" (clicked)="active.set(m)"/>
          }
        </div>

        <ap-pagination
          [page]="page()"
          [pageSize]="pageSize()"
          [total]="filtered().length"
          [totalPages]="totalPages()"
          (pageChange)="page.set($event)"
          (pageSizeChange)="onPageSizeChange($event)"
        />
      }
    </div>

    @if (active(); as m) {
      <ap-media-detail-drawer [media]="m"
        [products]="products()"
        (closed)="active.set(null)"
        (update)="onUpdate($event)"
        (delete)="onDelete($event)"/>
    }

    @if (autoLinking()) {
      <ap-auto-link-modal [media]="media()"
        [products]="products()"
        (closed)="autoLinking.set(false)"
        (apply)="applyAutoLink($event)"/>
    }

    <!-- ── Google Drive import modal ── -->
    @if (gdriveOpen()) {
      <div class="overlay" (click)="gdriveOpen.set(false)"></div>
      <div class="modal gdrive-modal">
        <div class="modal-head">
          <div>
            <p class="gdrive-eyebrow">Import from Google Drive</p>
            <div class="card-title">Paste a Google Drive link</div>
          </div>
          <button class="x-btn" (click)="gdriveOpen.set(false)"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="modal-body">
          <div class="gdrive-info">
            <ap-icon name="info" [size]="14"/>
            <span>Works with publicly shared files and folders. For folders, set <code>GOOGLE_DRIVE_API_KEY</code> in your server <code>.env</code>.</span>
          </div>
          <label class="lbl mb-8">Google Drive URL or File ID</label>
          <input class="inp mb-6" placeholder="https://drive.google.com/drive/folders/…"
                 [ngModel]="gdriveUrl()" (ngModelChange)="gdriveUrl.set($event)"
                 (keydown.enter)="importGDrive()" [disabled]="gdriveLoading()"/>
          <div class="muted small mb-16">Paste a folder link, file link, or just the file ID.</div>

          @if (gdriveError()) {
            <div class="gdrive-error">{{ gdriveError() }}</div>
          }
        </div>
        <div class="drawer-foot">
          <button class="btn btn-outline" (click)="gdriveOpen.set(false)" [disabled]="gdriveLoading()">Cancel</button>
          <button class="btn btn-gold" (click)="importGDrive()" [disabled]="gdriveLoading() || !gdriveUrl().trim()">
            @if (gdriveLoading()) { <ap-spinner [size]="13"/> Importing… } @else { Import Images }
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .upload-list {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px dashed var(--border-2);
      padding-top: 14px;
    }
    .upload-row {
      display: grid;
      grid-template-columns: 40px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 8px 12px;
      background: var(--bg);
      border: 1px solid var(--border-2);
      border-radius: 10px;
    }
    .upload-row.is-error { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.05); }
    .upload-thumb {
      width: 40px; height: 40px; border-radius: 6px;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-2, var(--bg));
      color: var(--muted);
    }
    .upload-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .upload-meta { min-width: 0; }
    .upload-name {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .upload-progress {
      width: 100%; height: 4px;
      background: var(--bg-2, rgba(0,0,0,0.06));
      border-radius: 999px;
      overflow: hidden;
    }
    .upload-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--green), var(--gold));
      transition: width 0.18s ease;
    }
    .upload-pct {
      font-family: var(--ff-disp);
      font-size: 11px;
      color: var(--ink-2);
      letter-spacing: 0.04em;
      min-width: 36px;
      text-align: end;
    }
    .upload-row.is-error .upload-pct { color: var(--danger); font-weight: 700; }
    .upload-error { font-size: 11px; color: var(--danger); }

    .btn-danger-outline {
      border-color: rgba(239,68,68,0.5);
      color: #dc2626;
      background: rgba(239,68,68,0.05);
    }
    .btn-danger-outline:hover:not(:disabled) {
      background: rgba(239,68,68,0.1);
      border-color: #dc2626;
    }
    .pg-spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border: 2px solid rgba(220,38,38,0.3);
      border-top-color: #dc2626;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .gdrive-modal {
      width: min(520px, 96vw);
    }
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
    .gdrive-info code {
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0 4px;
      font-size: 11px;
      color: var(--ink);
    }
    .gdrive-error {
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(239,68,68,.07);
      border: 1px solid rgba(239,68,68,.3);
      color: #dc2626;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    @media (max-width: 560px) {
      .drop-zone { padding: 18px 14px; }
      .upload-row { grid-template-columns: 32px 1fr auto; padding: 8px; }
      .upload-thumb { width: 32px; height: 32px; }
    }
  `],
})
export class MediaComponent implements OnInit {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly mediaApi = inject(AdminMediaService);
  private readonly productsApi = inject(AdminProductsService);
  private readonly uploads = inject(MediaUploadService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly media = signal<MediaFile[]>([]);
  readonly products = signal<Product[]>([]);
  readonly filter = signal<FilterKey>('all');
  readonly active = signal<MediaFile | null>(null);
  readonly autoLinking = signal(false);
  readonly dragOver = signal(false);
  readonly pending = signal<PendingUpload[]>([]);
  readonly cleaningUp = signal(false);
  readonly page = signal(0);
  readonly pageSize = signal(48);

  // ── Google Drive import ──────────────────────────────────────────────────
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
      this.media.update(all => [...imported, ...all]);
      this.gdriveOpen.set(false);
      const linked = imported.filter(f => f.linkedTo).length;
      const sub = linked > 0
        ? `${linked} auto-linked by SKU match.`
        : 'Saved to your media library.';
      this.toast.success(
        `${imported.length} image${imported.length === 1 ? '' : 's'} imported`,
        sub,
      );
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Import failed. Check the URL and try again.';
      this.gdriveError.set(msg);
    } finally {
      this.gdriveLoading.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [media, products] = await Promise.all([
        this.mediaApi.list(),
        this.productsApi.list().catch(() => [] as Product[]),
      ]);
      this.media.set(media);
      this.products.set(products);
    } catch {
      this.media.set([]);
    }
  }

  readonly counts = computed(() => {
    const m = this.media();
    return {
      all: m.length,
      image: m.filter((x) => x.kind === 'image').length,
      glb: m.filter((x) => x.kind === 'glb').length,
      unlinked: m.filter((x) => !x.linkedTo).length,
    };
  });

  readonly linkedPercent = computed(() => {
    const c = this.counts();
    return c.all === 0 ? 0 : Math.round(((c.all - c.unlinked) / c.all) * 100);
  });

  readonly totalSize = computed(() => fmtBytes(this.media().reduce((s, m) => s + m.size, 0)));

  readonly filtered = computed(() => {
    const f = this.filter();
    const m = this.media();
    if (f === 'all') return m;
    if (f === 'image') return m.filter((x) => x.kind === 'image');
    if (f === 'glb') return m.filter((x) => x.kind === 'glb');
    return m.filter((x) => !x.linkedTo);
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  readonly pagedMedia = computed(() => {
    const all = this.filtered();
    const start = this.page() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  readonly orphanedSize = computed(() =>
    fmtBytes(this.media().filter((m) => !m.linkedTo).reduce((s, m) => s + m.size, 0)),
  );

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
  }

  async cleanupOrphaned(): Promise<void> {
    const count = this.counts().unlinked;
    if (count === 0 || this.cleaningUp()) return;
    const ok = await this.confirm.ask({
      title: `Delete ${count} unlinked ${count === 1 ? 'file' : 'files'}?`,
      message: `This will permanently delete ${count} media ${count === 1 ? 'file' : 'files'} (${this.orphanedSize()}) that are not linked to any product. This cannot be undone.`,
      confirmLabel: 'Delete unlinked files',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    this.cleaningUp.set(true);
    try {
      const { deleted } = await this.mediaApi.deleteOrphaned();
      this.media.update((all) => all.filter((m) => m.linkedTo));
      this.page.set(0);
      this.toast.success(
        `${deleted} ${deleted === 1 ? 'file' : 'files'} deleted`,
        'Orphaned media cleaned up',
      );
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.cleaningUp.set(false);
    }
  }

  // ── Drag & drop / file picker ─────────────────────────────────────────────

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) {
      this.toast.warning('No files dropped', 'Try dragging a JPG, PNG, or .glb file.');
      return;
    }
    void this.upload(files);
  }

  onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length > 0) void this.upload(files);
  }

  /** Real upload with per-file progress rows. The API call sends the whole
      batch so the browser reports a single progress series — we mirror it
      across every row in the batch. */
  private async upload(files: File[]): Promise<void> {
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
      this.pending.update((rows) => [...rows, { id, name: file.name, thumb, percent: 0 }]);
    }
    if (accepted.length === 0) return;

    try {
      await new Promise<void>((resolve, reject) => {
        const ids = accepted.map((a) => a.id);
        this.uploads.uploadMedia(accepted.map((a) => a.file)).subscribe({
          next: (ev) => {
            if (ev.stage === 'uploading') {
              this.pending.update((rows) =>
                rows.map((r) => (ids.includes(r.id) ? { ...r, percent: ev.percent } : r)),
              );
            }
            if (ev.stage === 'done') {
              this.toast.success(
                `${accepted.length} ${accepted.length === 1 ? 'file' : 'files'} uploaded`,
                'Media library refreshed.',
              );
              resolve();
            }
          },
          error: (err) => reject(err),
        });
      });
      // Re-fetch so the new rows appear with their server-assigned ids,
      // upload timestamps, and uploader info.
      await this.refresh();
    } catch {
      this.pending.update((rows) =>
        rows.map((r) =>
          accepted.some((a) => a.id === r.id) ? { ...r, error: this.t('error.unknown.title') } : r,
        ),
      );
    } finally {
      window.setTimeout(() => {
        this.pending.update((rows) => rows.filter((r) => !accepted.some((a) => a.id === r.id)));
      }, 700);
    }
  }

  // ── Existing flows (unchanged) ────────────────────────────────────────────

  onUpdate(next: MediaFile): void {
    const prev = this.media().find((m) => m.id === next.id) ?? null;
    this.media.update((all) => all.map((m) => (m.id === next.id ? next : m)));
    this.active.set(next);
    void this.mediaApi.link(next.id, next.linkedTo, 'gallery').catch(() => undefined);
    this.toast.success(
      next.linkedTo ? 'File linked' : 'File unlinked',
      next.name,
      prev ? { label: 'Undo', run: () => this.revertMedia(prev) } : undefined,
    );
  }

  async onDelete(id: string): Promise<void> {
    const removed = this.media().find((m) => m.id === id);
    this.media.update((all) => all.filter((m) => m.id !== id));
    try {
      await this.mediaApi.remove(id);
    } catch {
      // The error interceptor already toasted; restore optimistic delete.
      if (removed) this.media.update((all) => [removed, ...all]);
      return;
    }
    this.toast.success('File deleted', '1 file removed from library', removed ? {
      label: 'Undo',
      run: () => this.media.update((all) => [...all, removed]),
    } : undefined);
  }

  applyAutoLink(pairs: LinkPair[]): void {
    const before = this.media();
    this.media.update((all) =>
      all.map((m) => {
        const pair = pairs.find((p) => p.mediaId === m.id);
        return pair ? { ...m, linkedTo: pair.productId } : m;
      }),
    );
    // Persist each link change in the background.
    for (const pair of pairs) {
      void this.mediaApi.link(pair.mediaId, pair.productId, 'gallery').catch(() => undefined);
    }
    this.autoLinking.set(false);
    this.toast.success(
      `Linked ${pairs.length} ${pairs.length === 1 ? 'file' : 'files'}`,
      'Matched by SKU prefix',
      { label: 'Undo all', run: () => this.media.set(before) },
    );
  }

  private revertMedia(prev: MediaFile): void {
    this.media.update((all) => all.map((m) => (m.id === prev.id ? prev : m)));
    void this.mediaApi.link(prev.id, prev.linkedTo, 'gallery').catch(() => undefined);
    this.toast.info('Change reverted', prev.name);
  }
}

/** File → data URL (used for the per-row thumbnail before the server
    returns the canonical URL). Resolves to '' for non-image files. */
function readPreview(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.resolve('');
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
