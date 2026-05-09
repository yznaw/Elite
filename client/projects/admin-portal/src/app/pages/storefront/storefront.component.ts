import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { StorefrontService } from '../../services/storefront.service';
import { SectionDrawerComponent } from './section-drawer.component';
import { PALETTE, STOREFRONT_DEFAULT } from '../../data/mock';
import { StorefrontBlock } from '../../models';

@Component({
  selector: 'ap-storefront',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, SectionDrawerComponent],
  template: `
    <div class="page-fade">
      <!-- Top toolbar (mobile) — Add Section button + Preview / Publish -->
      <div class="storefront-toolbar mb-16">
        <div class="row gap-sm" style="align-items:center;flex-wrap:wrap;">
          <button class="btn btn-outline" (click)="togglePalette()" [attr.aria-expanded]="paletteOpen()">
            <ap-icon name="plus" [size]="14"/>
            {{ paletteOpen() ? t('storefront.palette.hide') : t('storefront.palette.show') }}
            <span class="muted small" style="margin-inline-start:4px;">({{ palette.length }})</span>
          </button>
          <span class="muted small grow">{{ visibleCount() }} / {{ blocks().length }} {{ t('storefront.visibleCount') }}</span>
          <button class="btn btn-outline" (click)="preview()"><ap-icon name="eye" [size]="14"/> {{ t('storefront.preview') }}</button>
          <button class="btn btn-gold" [disabled]="publishing() || !storefront.hasUnpublishedChanges()" (click)="publish()">
            @if (publishing()) {
              <ap-spinner [size]="12"/> {{ t('storefront.publishing') }}
            } @else {
              {{ storefront.hasUnpublishedChanges() ? t('storefront.publish') : t('storefront.published') }}
            }
          </button>
        </div>
      </div>

      <div class="storefront-grid">
        <!-- Available Blocks panel (collapsible) -->
        <div class="card storefront-palette" [class.collapsed]="!paletteOpen()" [attr.aria-hidden]="!paletteOpen()">
          <button class="palette-head" (click)="togglePalette()" type="button" [attr.aria-expanded]="paletteOpen()">
            <div style="text-align:start;">
              <div class="card-title">{{ t('storefront.palette.title') }}</div>
              <div class="card-sub">{{ t('storefront.palette.sub') }}</div>
            </div>
            <span class="palette-chevron" [class.open]="paletteOpen()" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
          </button>

          @if (paletteOpen()) {
            <div class="card-pad col palette-list">
              @for (p of palette; track p.type) {
                <div class="palette-blk" draggable="true"
                     (dragstart)="onPaletteDragStart($event, p.type)"
                     (click)="addBlockOfType(p.type)"
                     role="button"
                     [attr.aria-label]="t('storefront.palette.add') + ' ' + p.type">
                  <span style="color:var(--gold);"><ap-icon name="drag" [size]="14"/></span>
                  <div class="grow">
                    <div class="strong" style="font-size:12px;">{{ p.type }}</div>
                    <div class="muted small">{{ p.desc }}</div>
                  </div>
                  <ap-icon name="plus" [size]="12"/>
                </div>
              }
            </div>
          }
        </div>

        <!-- Live page order -->
        <div class="card">
          <div class="card-header">
            <div style="min-width:0;">
              <div class="row gap-sm" style="align-items:center;flex-wrap:wrap;">
                <div class="card-title">{{ t('storefront.live.title') }}</div>
                @if (storefront.hasUnpublishedChanges()) {
                  <span class="save-badge dirty">{{ t('storefront.unpublished') }}</span>
                }
              </div>
              <div class="card-sub">{{ visibleCount() }} {{ t('storefront.live.visible') }} · {{ blocks().length }} {{ t('storefront.live.total') }}</div>
            </div>
            <div class="row gap-sm storefront-toolbar-desk" style="flex-shrink:0;">
              <button class="btn btn-outline" (click)="preview()"><ap-icon name="eye" [size]="14"/> {{ t('storefront.preview') }}</button>
              <button class="btn btn-gold" [disabled]="publishing() || !storefront.hasUnpublishedChanges()" (click)="publish()">
                @if (publishing()) {
                  <ap-spinner [size]="12"/> {{ t('storefront.publishing') }}
                } @else {
                  {{ storefront.hasUnpublishedChanges() ? t('storefront.publish') : t('storefront.published') }}
                }
              </button>
            </div>
          </div>
          <div class="card-pad col">
            @if (blocks().length === 0) {
              <div class="muted small center" style="padding:32px 16px;">
                {{ t('storefront.live.empty') }}
              </div>
            }

            @for (b of blocks(); track b.id) {
              <div class="blk"
                   draggable="true"
                   [class.dragging]="draggingId() === b.id"
                   [class.drop-target]="dropTargetId() === b.id"
                   [class.is-hidden]="!b.visible"
                   (dragstart)="onDragStart(b.id)"
                   (dragover)="onDragOver($event, b.id)"
                   (drop)="onDrop($event, b.id)"
                   (dragend)="onDragEnd()">
                <span class="blk-handle"><ap-icon name="drag" [size]="14"/></span>
                <button type="button" class="blk-info-btn" (click)="openSection(b)" [attr.aria-label]="t('storefront.editSection') + ' ' + b.type">
                  <div class="blk-info">
                    <div class="blk-title">
                      {{ b.type }}
                      <span class="muted small" style="margin-inline-start:6px;font-weight:400;">· {{ b.title }}</span>
                    </div>
                    <div class="blk-meta">{{ b.config }}</div>
                  </div>
                </button>
                <div class="blk-controls">
                  <button class="toggle" [class.on]="b.visible" (click)="toggleVisible(b.id)" [attr.aria-label]="t('storefront.section.toggleVisibility')"></button>
                  <button class="icon-btn" (click)="openSection(b)" [attr.title]="t('common.edit')"><ap-icon name="edit" [size]="14"/></button>
                  <button class="icon-btn" (click)="remove(b.id)" [attr.title]="t('common.remove')" style="color:var(--danger);">
                    <ap-icon name="trash" [size]="14"/>
                  </button>
                </div>
              </div>
            }

            <div class="palette-blk drop-zone-end"
                 [class.drop-target]="dropTargetId() === '__end__'"
                 (dragover)="onDragOver($event, '__end__')"
                 (drop)="onDrop($event, '__end__')">
              <span class="muted"><ap-icon name="plus" [size]="14"/></span>
              <span class="muted small">{{ t('storefront.dropEnd') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    @if (active(); as b) {
      <ap-section-drawer
        [block]="b"
        (closed)="active.set(null)"
        (saved)="onSaved($event)"
        (deletedBlock)="onDeleted($event)"
      />
    }
  `,
  styles: [`
    .storefront-toolbar { display: none; }
    @media (max-width: 900px) {
      .storefront-toolbar { display: block; }
      .storefront-toolbar-desk { display: none !important; }
    }

    /* Storefront grid: 2-up on desktop, stacked on tablet/phone */
    .storefront-grid {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 20px;
      align-items: flex-start;
    }
    @media (max-width: 900px) {
      .storefront-grid { grid-template-columns: 1fr; gap: 14px; }
    }

    /* Palette: collapsed state hides body, header acts as toggle */
    .palette-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 18px 22px;
      border: none;
      background: var(--surface);
      cursor: pointer;
      font: inherit;
      color: inherit;
      border-bottom: 1px solid var(--border-2);
      transition: background 0.12s;
    }
    .palette-head:hover { background: var(--bg); }
    .storefront-palette.collapsed .palette-head { border-bottom: none; }

    .palette-chevron {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--muted);
      transition: transform 0.2s;
    }
    .palette-chevron.open { transform: rotate(180deg); }

    /* On mobile, the palette is always shown via toggle button at the top.
       The card heading toggle is hidden so we don't have two toggles. */
    @media (max-width: 900px) {
      .palette-head { display: none; }
      .storefront-palette {
        order: -1; /* show above the live list when expanded */
      }
      .storefront-palette.collapsed { display: none; }
    }
    /* On desktop, the heading toggle is visible (palette can still collapse for focus mode) */
    @media (min-width: 901px) {
      .storefront-palette.collapsed .card-pad,
      .storefront-palette.collapsed .palette-list { display: none; }
    }

    .palette-list { padding-top: 14px; }

    /* Palette block — clickable to add at the bottom on mobile */
    .palette-blk { transition: all 0.12s; }
    .palette-blk:active { transform: scale(0.98); }

    .drop-zone-end {
      transition: all 0.15s;
    }
    .drop-zone-end.drop-target {
      border-color: var(--gold) !important;
      background: var(--gold-3) !important;
    }

    /* Live block: clickable info area + visual hidden state */
    .blk-info-btn {
      flex: 1;
      min-width: 0;
      background: none;
      border: none;
      padding: 0;
      text-align: start;
      cursor: pointer;
      font: inherit;
      color: inherit;
    }
    .blk-info-btn:hover .blk-title { color: var(--green); }
    .blk-info-btn:hover .blk-title > span { color: var(--ink-2); }
    .blk.is-hidden { opacity: 0.55; }
    .blk.is-hidden .blk-title::before {
      content: '○ ';
      color: var(--danger);
      font-weight: 700;
    }
  `],
})
export class StorefrontComponent {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  readonly storefront = inject(StorefrontService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly palette = PALETTE;

  /** Blocks come from the persisted draft if it exists, otherwise the default seed. */
  readonly blocks = signal<StorefrontBlock[]>(this.storefront.draft()?.blocks ?? STOREFRONT_DEFAULT.map((b) => ({ ...b })));
  readonly draggingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly publishing = signal(false);

  /** Block currently being edited in the side drawer. */
  readonly active = signal<StorefrontBlock | null>(null);

  /** Palette open/closed. On mobile defaults to closed (saves space). */
  readonly paletteOpen = signal<boolean>(this.computeIsMobile() ? false : true);

  constructor() {
    /** Persist any change to the blocks list as a draft. The customer-web's
        preview mode reads this same key. */
    effect(() => {
      const list = this.blocks();
      this.storefront.saveDraft(list);
    });

    /** If the draft was empty when the editor mounted but now there's a
        published version, prefer it (handy when reopening on another tab). */
    if (!this.storefront.draft() && this.storefront.published()) {
      const pub = this.storefront.published()!;
      this.blocks.set(pub.blocks);
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    // Keep desktop default open when resizing back up; don't force-close on resize down.
  }

  private computeIsMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 900;
  }

  visibleCount = computed(() => this.blocks().filter((b) => b.visible).length);

  togglePalette(): void {
    this.paletteOpen.update((v) => !v);
  }

  // ── Section drawer ──────────────────────────────────────────────────

  openSection(b: StorefrontBlock): void {
    this.active.set({ ...b });
  }

  onSaved(updated: StorefrontBlock): void {
    this.blocks.update((bs) => bs.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
    this.active.set(null);
  }

  onDeleted(block: StorefrontBlock): void {
    const before = this.blocks();
    const beforeIndex = before.findIndex((b) => b.id === block.id);
    this.blocks.update((bs) => bs.filter((b) => b.id !== block.id));
    this.active.set(null);
    this.toast.success(
      this.t('storefront.toast.removed.title'),
      `${block.type} · ${block.title}`,
      {
        label: this.t('common.undo'),
        run: () => {
          this.blocks.update((bs) => {
            const restored = [...bs];
            restored.splice(beforeIndex, 0, block);
            return restored;
          });
        },
      },
    );
  }

  // ── Visibility toggle (inline) ──────────────────────────────────────

  toggleVisible(id: string): void {
    let nextVisible = false;
    let block: StorefrontBlock | undefined;
    this.blocks.update((bs) =>
      bs.map((b) => {
        if (b.id !== id) return b;
        nextVisible = !b.visible;
        block = { ...b, visible: nextVisible };
        return block;
      }),
    );
    if (block) {
      this.toast.info(
        nextVisible ? this.t('storefront.toast.shown.title') : this.t('storefront.toast.hidden.title'),
        `${block.type} · ${block.title}`,
      );
    }
  }

  // ── Remove (with confirm) ───────────────────────────────────────────

  async remove(id: string): Promise<void> {
    const block = this.blocks().find((b) => b.id === id);
    if (!block) return;
    const ok = await this.confirm.ask({
      title: this.t('storefront.deleteConfirm.title'),
      message: this.t('storefront.deleteConfirm.message') + ` "${block.type} · ${block.title}".`,
      confirmLabel: this.t('storefront.delete.button'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.onDeleted(block);
  }

  // ── Add a block (mobile-friendly: tap to append, drag to insert) ────

  addBlockOfType(type: string): void {
    const newBlk = this.makeBlockOfType(type);
    this.blocks.update((bs) => [...bs, newBlk]);
    this.toast.success(
      this.t('storefront.toast.added.title'),
      `${type}`,
      { label: this.t('common.configure'), run: () => this.openSection(newBlk) },
    );
    // Auto-collapse on mobile after adding
    if (this.computeIsMobile()) this.paletteOpen.set(false);
  }

  private makeBlockOfType(type: string): StorefrontBlock {
    return {
      id: 'b' + Date.now(),
      type,
      title: type,
      visible: true,
      config: this.t('storefront.newBlock.config'),
    };
  }

  /**
   * Open the live customer-web in a new tab with `?preview=storefront&token=…`.
   * The customer-web reads the draft from localStorage (or, in production,
   * fetches /api/storefront/draft using the token).
   *
   * Pop-up blockers can refuse `window.open()` outside a user gesture, so
   * we fall through to a clipboard copy if it fails.
   */
  preview(): void {
    // Save the latest draft synchronously so the preview tab sees the freshest copy.
    this.storefront.saveDraft(this.blocks());

    const url = this.storefront.buildPreviewLink();
    const tab = window.open(url, '_blank', 'noopener,noreferrer');

    if (tab) {
      this.toast.info(
        this.t('storefront.preview.toast'),
        `${this.visibleCount()} ${this.t('storefront.live.visible')}`,
      );
    } else {
      // Pop-up blocked → put the link on the clipboard
      try { navigator.clipboard?.writeText(url); } catch {}
      this.toast.warning(
        this.t('storefront.preview.blocked.title'),
        this.t('storefront.preview.blocked.sub'),
        { label: this.t('common.tryAgain'), run: () => this.preview() },
      );
    }
  }

  async publish(): Promise<void> {
    if (this.publishing() || !this.storefront.hasUnpublishedChanges()) return;

    const visible = this.visibleCount();
    const ok = await this.confirm.ask({
      title: this.t('storefront.publishConfirm.title'),
      message:
        `${this.t('storefront.publishConfirm.message')} ${visible} ${this.t('storefront.publishConfirm.sectionsVisible')}.`,
      confirmLabel: this.t('storefront.publish'),
      cancelLabel: this.t('common.cancel'),
      variant: 'info',
    });
    if (!ok) return;

    this.publishing.set(true);

    // Snapshot the current blocks for undo
    const previousPublished = this.storefront.published();

    // In production: replace with a POST to /api/storefront/publish.
    // The setTimeout simulates the round-trip.
    setTimeout(() => {
      this.storefront.publish();
      this.publishing.set(false);
      this.toast.success(
        this.t('storefront.publish.toast.title'),
        this.t('storefront.publish.toast.sub'),
        previousPublished ? {
          label: this.t('common.undo'),
          run: () => {
            this.storefront.revertPublished(previousPublished);
            this.toast.info(this.t('storefront.unpublish.toast.title'), '');
          },
        } : undefined,
      );
    }, 700);
  }

  // ── Drag and drop reorder ───────────────────────────────────────────

  onDragStart(id: string): void { this.draggingId.set(id); }

  onDragOver(e: DragEvent, id: string): void {
    e.preventDefault();
    this.dropTargetId.set(id);
  }

  onPaletteDragStart(e: DragEvent, type: string): void {
    e.dataTransfer?.setData('text/palette', type);
  }

  onDrop(e: DragEvent, id: string): void {
    e.preventDefault();
    const draggingId = this.draggingId();
    if (!draggingId) {
      const type = e.dataTransfer?.getData('text/palette');
      if (type) {
        const newBlk = this.makeBlockOfType(type);
        this.blocks.update((bs) => {
          const idx = bs.findIndex((b) => b.id === id);
          const next = [...bs];
          next.splice(idx === -1 ? bs.length : idx, 0, newBlk);
          return next;
        });
        this.toast.success(
          this.t('storefront.toast.added.title'),
          `${type}`,
          { label: this.t('common.configure'), run: () => this.openSection(newBlk) },
        );
      }
    } else if (draggingId !== id) {
      this.blocks.update((bs) => {
        const fromIdx = bs.findIndex((b) => b.id === draggingId);
        const toIdx = bs.findIndex((b) => b.id === id);
        if (fromIdx === -1 || toIdx === -1) return bs;
        const next = [...bs];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    }
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }
}
