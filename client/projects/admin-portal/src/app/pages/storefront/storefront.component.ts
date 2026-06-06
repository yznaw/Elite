import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { HOME_LAYOUT_BLOCKS, StorefrontService } from '../../services/storefront.service';
import { ToastService } from '../../services/toast.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { Collection, StorefrontBlock } from '../../models';
import { HomeContentComponent } from '../home-content/home-content.component';

@Component({
  selector: 'ap-storefront',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, HomeContentComponent],
  template: `
    <div class="page-fade">
      <ap-home-content/>

      <!-- Featured Collections configuration -->
      <section class="card mb-24 featured-col-card">
        <div class="card-header featured-col-head">
          <div>
            <p class="eyebrow">Collections</p>
            <div class="card-title">Featured Collections</div>
            <div class="card-sub">
              Choose which collections appear in the Featured Collections block on the home page.
            </div>
          </div>
          <button class="btn btn-outline" type="button" (click)="showCollectionPicker.set(!showCollectionPicker())">
            <ap-icon name="plus" [size]="14"/> Add from List
          </button>
        </div>

        <div class="card-pad">
          <!-- Current featured items -->
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
                      <span class="feat-chip-path muted">manual handle</span>
                    }
                  </div>
                  <button class="feat-chip-remove" type="button" (click)="removeFeatured(ref)" title="Remove">
                    <ap-icon name="x" [size]="10"/>
                  </button>
                </div>
              }
            </div>
          } @else {
            <div class="feat-empty mb-16">
              <ap-icon name="catalog" [size]="20"/>
              <span>No collections featured — add from the list or type a handle below.</span>
            </div>
          }

          <!-- Collection list picker (inline dropdown) -->
          @if (showCollectionPicker()) {
            <div class="col-picker mb-16">
              <div class="col-picker-search">
                <ap-icon name="search" [size]="13"/>
                <input class="inp with-icon" placeholder="Search collections…" [ngModel]="pickerSearch()" (ngModelChange)="pickerSearch.set($event)"/>
              </div>
              <div class="col-picker-list">
                @if (collectionsLoading()) {
                  <div class="col-picker-row muted"><ap-spinner [size]="12"/> Loading…</div>
                } @else {
                  @for (col of filteredPickerCollections(); track col.id) {
                    <div class="col-picker-row" [class.selected]="featuredRefs().includes(col.id)" (click)="toggleFeatured(col.id)">
                      @if (col.imageUrl) {
                        <img [src]="col.imageUrl" [alt]="col.title" class="col-picker-img"/>
                      } @else {
                        <div class="col-picker-img-empty"><ap-icon name="catalog" [size]="14"/></div>
                      }
                      <div class="col-picker-info">
                        <div class="col-picker-name">{{ col.title }}</div>
                        <div class="col-picker-path mono">/collection/{{ col.handle }}</div>
                      </div>
                      <div class="col-picker-check" [class.on]="featuredRefs().includes(col.id)"></div>
                    </div>
                  }
                  @if (filteredPickerCollections().length === 0) {
                    <div class="col-picker-row muted">No collections found.</div>
                  }
                }
              </div>
            </div>
          }

          <!-- Manual handle entry -->
          <div class="manual-entry">
            <span class="manual-prefix">/collection/</span>
            <input class="inp manual-inp" [(ngModel)]="manualHandle" placeholder="type-a-handle" (keydown.enter)="addManualHandle()"/>
            <button class="btn btn-outline btn-sm" type="button" (click)="addManualHandle()" [disabled]="!manualHandle.trim()">Add</button>
          </div>
          <div class="muted small mt-8">Use this to add a collection by its URL handle if it doesn't exist in the list yet.</div>
        </div>
      </section>

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

    /* ── Featured Collections card ─────────────────────────── */
    .featured-col-head {
      gap: 18px;
      align-items: start;
    }

    .featured-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .feat-chip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px 8px 14px;
      border: 1px solid var(--border-2);
      border-radius: 8px;
      background: var(--surface);
      min-width: 0;
    }

    .feat-chip-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .feat-chip-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .feat-chip-path {
      font-size: 11px;
      color: var(--green);
    }

    .feat-chip-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      transition: all 0.12s;
    }

    .feat-chip-remove:hover {
      background: var(--danger-bg, rgba(239,68,68,.1));
      border-color: var(--danger);
      color: var(--danger);
    }

    .feat-empty {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 20px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      background: var(--bg);
    }

    /* collection picker */
    .col-picker {
      border: 1px solid var(--border-2);
      border-radius: 10px;
      overflow: hidden;
      background: var(--surface);
    }

    .col-picker-search {
      position: relative;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-2);
      background: var(--bg);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .col-picker-search ap-icon { color: var(--muted); flex-shrink: 0; }
    .col-picker-search .inp { border: none; background: transparent; flex: 1; padding: 0; }
    .col-picker-search .inp:focus { outline: none; box-shadow: none; }

    .col-picker-list {
      max-height: 260px;
      overflow-y: auto;
    }

    .col-picker-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
      transition: background 0.12s;
      border-bottom: 1px solid var(--border-2);
    }

    .col-picker-row:last-child { border-bottom: none; }
    .col-picker-row:hover { background: var(--bg); }
    .col-picker-row.selected { background: var(--gold-3, rgba(196,158,88,.08)); }

    .col-picker-img {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .col-picker-img-empty {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      flex-shrink: 0;
    }

    .col-picker-info { flex: 1; min-width: 0; }
    .col-picker-name { font-size: 13px; font-weight: 700; color: var(--ink); }
    .col-picker-path { font-size: 11px; color: var(--green); }

    .col-picker-check {
      width: 18px;
      height: 18px;
      border: 2px solid var(--border);
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.12s;
    }

    .col-picker-check.on {
      background: var(--gold);
      border-color: var(--gold);
    }

    .col-picker-check.on::after {
      content: '';
      display: block;
      width: 5px;
      height: 9px;
      border: 2px solid #fff;
      border-top: none;
      border-left: none;
      transform: rotate(45deg) translate(2px, -1px);
    }

    /* manual entry */
    .manual-entry {
      display: flex;
      align-items: center;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }

    .manual-entry:focus-within { border-color: var(--green); }

    .manual-prefix {
      padding: 0 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--bg);
      border-right: 1px solid var(--border);
      height: 38px;
      display: flex;
      align-items: center;
    }

    .manual-inp {
      flex: 1;
      border: none !important;
      border-radius: 0 !important;
      background: transparent;
      font-family: var(--ff-mono, monospace);
      font-size: 13px;
    }

    .manual-entry button { margin: 0 6px; flex-shrink: 0; }

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
  private readonly collectionsApi = inject(AdminCollectionsService);
  readonly storefront = inject(StorefrontService);

  readonly t = (key: string): string => this.i18n.t(key);
  readonly blocks = signal<StorefrontBlock[]>(this.normalizeBlocks(this.storefront.draft()?.blocks));
  readonly draggingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly publishing = signal(false);
  readonly draftLoaded = signal(false);
  readonly visibleCount = computed(() => this.blocks().filter((block) => block.visible).length);
  private draftSaveTimer: number | undefined;

  // ── Collections feature ──────────────────────────────────────────────
  readonly allCollections = signal<Collection[]>([]);
  readonly collectionsLoading = signal(true);
  readonly showCollectionPicker = signal(false);
  readonly pickerSearch = signal('');
  manualHandle = '';

  readonly featuredRefs = computed(() => {
    const block = this.blocks().find(b => b.id === 'home-collections');
    return block?.collectionIds ?? [];
  });

  readonly filteredPickerCollections = computed(() => {
    const s = this.pickerSearch().toLowerCase();
    return this.allCollections().filter(c =>
      !s || c.title.toLowerCase().includes(s) || c.handle.toLowerCase().includes(s),
    );
  });

  collectionByRef(ref: string): Collection | undefined {
    return this.allCollections().find(c => c.id === ref || c.handle === ref);
  }

  toggleFeatured(id: string): void {
    const current = this.featuredRefs();
    const next = current.includes(id) ? current.filter(r => r !== id) : [...current, id];
    this.setFeaturedRefs(next);
  }

  removeFeatured(ref: string): void {
    this.setFeaturedRefs(this.featuredRefs().filter(r => r !== ref));
  }

  addManualHandle(): void {
    const raw = this.manualHandle.trim().replace(/^\/collections\//i, '').replace(/\//g, '');
    if (!raw) return;
    if (!this.featuredRefs().includes(raw)) {
      this.setFeaturedRefs([...this.featuredRefs(), raw]);
    }
    this.manualHandle = '';
  }

  private setFeaturedRefs(refs: string[]): void {
    this.blocks.update(blocks => blocks.map(b =>
      b.id === 'home-collections' ? { ...b, collectionIds: refs } : b,
    ));
  }

  constructor() {
    effect(() => {
      if (!this.draftLoaded()) return;
      this.storefront.saveDraft(this.blocks());
      this.scheduleDraftSave();
    });
  }

  async ngOnInit(): Promise<void> {
    void this.collectionsApi.list().then(list => {
      this.allCollections.set(list);
      this.collectionsLoading.set(false);
    }).catch(() => this.collectionsLoading.set(false));

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
        collectionIds: block.collectionIds || [],
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
