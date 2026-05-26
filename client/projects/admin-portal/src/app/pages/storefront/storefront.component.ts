import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { HOME_LAYOUT_BLOCKS, StorefrontService } from '../../services/storefront.service';
import { ToastService } from '../../services/toast.service';
import { StorefrontBlock } from '../../models';
import { HomeContentComponent } from '../home-content/home-content.component';

@Component({
  selector: 'ap-storefront',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent, HomeContentComponent],
  template: `
    <div class="page-fade">
      <ap-home-content/>

      <section class="layout-controller card">
        <div class="card-header layout-controller__head">
          <div>
            <p class="eyebrow">Existing Layout</p>
            <div class="card-title">Home Section Control</div>
            <div class="card-sub">
              Reorder or hide the real sections rendered on the customer home page.
            </div>
          </div>

          <div class="row gap-sm layout-actions">
            <button class="btn btn-outline" type="button" (click)="resetLayout()">
              <ap-icon name="sync" [size]="14"/> Reset order
            </button>
            <button class="btn btn-outline" type="button" (click)="viewStorefront()">
              <ap-icon name="eye" [size]="14"/> {{ t('storefront.preview') }}
            </button>
            <button
              class="btn btn-gold"
              type="button"
              [disabled]="publishing()"
              (click)="publish()"
            >
              @if (publishing()) {
                <ap-spinner [size]="12"/> {{ t('storefront.publishing') }}
              } @else {
                {{ t('storefront.publish') }}
              }
            </button>
          </div>
        </div>

        <div class="card-pad">
          <div class="layout-summary">
            <span>{{ visibleCount() }} visible</span>
            <span>{{ blocks().length }} total</span>
            @if (storefront.hasUnpublishedChanges()) {
              <span class="save-badge dirty">{{ t('storefront.unpublished') }}</span>
            }
          </div>

          <div class="layout-list">
            @for (block of blocks(); track block.id) {
              <article
                class="layout-block"
                draggable="true"
                [class.dragging]="draggingId() === block.id"
                [class.drop-target]="dropTargetId() === block.id"
                [class.is-hidden]="!block.visible"
                (dragstart)="onDragStart(block.id)"
                (dragover)="onDragOver($event, block.id)"
                (drop)="onDrop($event, block.id)"
                (dragend)="onDragEnd()"
              >
                <span class="layout-handle" aria-hidden="true">
                  <ap-icon name="drag" [size]="14"/>
                </span>

                <div class="layout-copy">
                  <div class="layout-title">{{ block.title }}</div>
                  <div class="layout-meta">{{ block.config }}</div>
                </div>

                <button
                  class="toggle"
                  type="button"
                  [class.on]="block.visible"
                  (click)="toggleVisible(block.id)"
                  [attr.aria-label]="t('storefront.section.toggleVisibility')"
                ></button>
              </article>
            }

            <div
              class="layout-drop-end"
              [class.drop-target]="dropTargetId() === '__end__'"
              (dragover)="onDragOver($event, '__end__')"
              (drop)="onDrop($event, '__end__')"
            >
              <ap-icon name="drag" [size]="14"/>
              <span>Drop here to place at the end</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    :host ::ng-deep ap-home-content .home-admin {
      margin-bottom: 24px;
    }

    .layout-controller {
      overflow: hidden;
    }

    .layout-controller__head {
      gap: 18px;
      align-items: start;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--gold);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .layout-actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .layout-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .layout-summary span:not(.save-badge) {
      padding: 6px 10px;
      border: 1px solid var(--border-2);
      border-radius: 999px;
      background: var(--bg);
    }

    .layout-list {
      display: grid;
      gap: 10px;
    }

    .layout-block,
    .layout-drop-end {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 74px;
      padding: 14px;
      border: 1px solid var(--border-2);
      border-radius: 8px;
      background: var(--surface);
      transition: border-color 0.16s ease, background 0.16s ease, opacity 0.16s ease, transform 0.16s ease;
    }

    .layout-block.dragging {
      opacity: 0.48;
      transform: scale(0.995);
    }

    .layout-block.drop-target,
    .layout-drop-end.drop-target {
      border-color: var(--gold);
      background: var(--gold-3);
    }

    .layout-block.is-hidden {
      opacity: 0.56;
    }

    .layout-handle {
      display: inline-flex;
      color: var(--muted);
      cursor: grab;
    }

    .layout-copy {
      flex: 1;
      min-width: 0;
    }

    .layout-title {
      color: var(--ink);
      font-size: 13px;
      font-weight: 900;
    }

    .layout-meta {
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }

    .layout-drop-end {
      justify-content: center;
      min-height: 52px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      border-style: dashed;
    }

    @media (min-width: 760px) {
      .layout-controller__head {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }
    }
  `],
})
export class StorefrontComponent implements OnInit, OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  readonly storefront = inject(StorefrontService);

  readonly t = (key: string): string => this.i18n.t(key);
  readonly blocks = signal<StorefrontBlock[]>(this.normalizeBlocks(this.storefront.draft()?.blocks));
  readonly draggingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly publishing = signal(false);
  readonly draftLoaded = signal(false);
  readonly visibleCount = computed(() => this.blocks().filter((block) => block.visible).length);
  private draftSaveTimer: number | undefined;

  constructor() {
    effect(() => {
      if (!this.draftLoaded()) return;
      this.storefront.saveDraft(this.blocks());
      this.scheduleDraftSave();
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const draft = await this.storefront.loadDraft();
      this.blocks.set(this.normalizeBlocks(draft?.blocks));
      this.draftLoaded.set(true);
    } catch {
      this.draftLoaded.set(true);
      this.toast.warning('Using default layout', 'The saved storefront layout could not be loaded.');
    }
  }

  ngOnDestroy(): void {
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
  }

  toggleVisible(id: string): void {
    this.blocks.update((blocks) => blocks.map((block) => (
      block.id === id ? { ...block, visible: !block.visible } : block
    )));
  }

  resetLayout(): void {
    this.blocks.set(HOME_LAYOUT_BLOCKS.map((block) => ({ ...block })));
  }

  viewStorefront(): void {
    window.open(this.storefront.storefrontUrl(), '_blank', 'noopener,noreferrer');
  }

  async publish(): Promise<void> {
    if (this.publishing()) return;

    const ok = await this.confirm.ask({
      title: this.t('storefront.publishConfirm.title'),
      message: `Publish ${this.visibleCount()} visible home sections to the customer storefront?`,
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
      this.toast.error('Publish failed', 'The home layout could not be saved.');
    } finally {
      this.publishing.set(false);
    }
  }

  onDragStart(id: string): void {
    this.draggingId.set(id);
  }

  onDragOver(event: DragEvent, id: string): void {
    event.preventDefault();
    this.dropTargetId.set(id);
  }

  onDrop(event: DragEvent, id: string): void {
    event.preventDefault();
    const draggingId = this.draggingId();
    if (!draggingId || draggingId === id) {
      this.onDragEnd();
      return;
    }

    this.blocks.update((blocks) => {
      const fromIndex = blocks.findIndex((block) => block.id === draggingId);
      if (fromIndex === -1) return blocks;

      const next = [...blocks];
      const [moved] = next.splice(fromIndex, 1);
      const toIndex = id === '__end__' ? next.length : next.findIndex((block) => block.id === id);
      next.splice(toIndex === -1 ? next.length : toIndex, 0, moved);
      return next;
    });
    this.onDragEnd();
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }

  private normalizeBlocks(blocks: StorefrontBlock[] | undefined | null): StorefrontBlock[] {
    const incoming = Array.isArray(blocks) ? blocks : [];
    const defaults = HOME_LAYOUT_BLOCKS;
    const allowed = new Set(defaults.map((block) => block.id));
    const ordered = incoming
      .filter((block) => allowed.has(block.id))
      .map((block) => ({
        ...defaults.find((fallback) => fallback.id === block.id)!,
        visible: block.visible !== false,
      }));
    const missing = defaults
      .filter((fallback) => !ordered.some((block) => block.id === fallback.id))
      .map((block) => ({ ...block }));

    return [...ordered, ...missing];
  }

  private scheduleDraftSave(): void {
    if (this.draftSaveTimer) window.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = window.setTimeout(() => {
      void this.storefront.saveDraftRemote(this.normalizeBlocks(this.blocks())).catch(() => undefined);
    }, 600);
  }
}
