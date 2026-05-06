import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { MediaCardComponent } from './media-card.component';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { AutoLinkModalComponent, LinkPair } from './auto-link-modal.component';
import { ToastService } from '../../services/toast.service';
import { MEDIA_INIT } from '../../data/mock';
import { fmtBytes, MediaFile } from '../../models';

type FilterKey = 'all' | 'image' | 'glb' | 'unlinked';

@Component({
  selector: 'ap-media',
  standalone: true,
  imports: [CommonModule, IconComponent, EmptyStateComponent, MediaCardComponent, MediaDetailDrawerComponent, AutoLinkModalComponent],
  template: `
    <div class="page-fade">
      <div class="grid-4 mb-24">
        <div class="stat-card">
          <div class="lbl">Total Files</div>
          <div class="v">{{ counts().all }}</div>
          <div class="muted small mt-8">{{ counts().image }} images · {{ counts().glb }} 3D models</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Linked</div>
          <div class="v" style="color:var(--success);">{{ counts().all - counts().unlinked }}</div>
          <div class="muted small mt-8">{{ linkedPercent() }}% of library</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Unlinked</div>
          <div class="v" style="color:var(--warning);">{{ counts().unlinked }}</div>
          <div class="muted small mt-8">Needs assignment</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Storage Used</div>
          <div class="v">{{ totalSize() }}</div>
          <div class="muted small mt-8">of 50 GB plan</div>
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
              Drop files to upload
            </div>
            <div class="muted small mb-16">
              Images (JPG, PNG, WebP) and 3D models (.glb, .gltf) up to 50 MB each.<br/>
              Files matching your SKU pattern will be auto-linked on upload.
            </div>
            <div class="row gap-sm" style="justify-content:center;">
              <button class="btn btn-primary"><ap-icon name="upload" [size]="14"/> Browse Files</button>
              <button class="btn btn-gold" [disabled]="counts().unlinked === 0" (click)="autoLinking.set(true)">
                <ap-icon name="wand" [size]="14"/>
                Auto-Link by SKU
                @if (counts().unlinked > 0) {
                  <span style="padding:2px 8px;background:rgba(15,35,86,0.15);border-radius:999px;font-size:10px;">{{ counts().unlinked }}</span>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="row gap-sm mb-16" style="justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div class="row gap-sm" style="flex-wrap:wrap;">
          <button class="chip" [class.active]="filter() === 'all'" (click)="filter.set('all')">
            All <span class="chip-count">{{ counts().all }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'image'" (click)="filter.set('image')">
            Images <span class="chip-count">{{ counts().image }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'glb'" (click)="filter.set('glb')">
            3D Models <span class="chip-count">{{ counts().glb }}</span>
          </button>
          <button class="chip" [class.active]="filter() === 'unlinked'" (click)="filter.set('unlinked')"
                  [style.background]="filter() === 'unlinked' ? 'var(--warning)' : ''" [style.border-color]="filter() === 'unlinked' ? 'var(--warning)' : ''">
            Unlinked <span class="chip-count">{{ counts().unlinked }}</span>
          </button>
        </div>
        <div class="muted small">Click any file to view details, link, or replace</div>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="media" title="No files in this view"
            sub="Try a different filter, or drop new files in the upload area above. Files matching your SKU pattern auto-link on upload.">
            <button class="btn btn-outline btn-sm" (click)="filter.set('all')">Clear filter</button>
          </ap-empty-state>
        </div>
      } @else {
        <div class="media-grid">
          @for (m of filtered(); track m.id) {
            <ap-media-card [media]="m" [selected]="active()?.id === m.id" (clicked)="active.set(m)"/>
          }
        </div>
      }
    </div>

    @if (active(); as m) {
      <ap-media-detail-drawer [media]="m"
        (closed)="active.set(null)"
        (update)="onUpdate($event)"
        (delete)="onDelete($event)"/>
    }

    @if (autoLinking()) {
      <ap-auto-link-modal [media]="media()"
        (closed)="autoLinking.set(false)"
        (apply)="applyAutoLink($event)"/>
    }
  `,
})
export class MediaComponent {
  private readonly toast = inject(ToastService);

  readonly media = signal<MediaFile[]>(MEDIA_INIT);
  readonly filter = signal<FilterKey>('all');
  readonly active = signal<MediaFile | null>(null);
  readonly autoLinking = signal(false);
  readonly dragOver = signal(false);

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

  onUpdate(next: MediaFile): void {
    const prev = this.media().find((m) => m.id === next.id) ?? null;
    this.media.update((all) => all.map((m) => (m.id === next.id ? next : m)));
    this.active.set(next);
    this.toast.success(
      next.linkedTo ? 'File linked' : 'File unlinked',
      next.name,
      prev ? { label: 'Undo', run: () => this.revertMedia(prev) } : undefined,
    );
  }

  onDelete(id: string): void {
    const removed = this.media().find((m) => m.id === id);
    this.media.update((all) => all.filter((m) => m.id !== id));
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
    this.autoLinking.set(false);
    this.toast.success(
      `Linked ${pairs.length} ${pairs.length === 1 ? 'file' : 'files'}`,
      'Matched by SKU prefix',
      { label: 'Undo all', run: () => this.media.set(before) },
    );
  }

  private revertMedia(prev: MediaFile): void {
    this.media.update((all) => all.map((m) => (m.id === prev.id ? prev : m)));
    this.toast.info('Change reverted', prev.name);
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    const count = e.dataTransfer?.files.length ?? 0;
    if (count === 0) {
      this.toast.warning('No files dropped', 'Try dragging a JPG, PNG, or .glb file.');
      return;
    }
    this.toast.info('Upload simulated', `${count} file${count === 1 ? '' : 's'} queued (prototype)`);
  }
}
