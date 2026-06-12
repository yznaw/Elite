import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { CollectionDrawerComponent } from './collection-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { AdminCollectionsService } from '../../services/admin-collections.service';
import { Collection } from '../../models';

interface HierarchyGroup {
  parent: Collection;
  children: Collection[];
}

@Component({
  selector: 'ap-collections',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, EmptyStateComponent, CollectionDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="card mb-24" style="padding:14px 18px;">
        <div class="row gap-sm" style="flex-wrap:wrap;">
          <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
            <ap-icon name="search" [size]="14"/>
            <input class="inp with-icon" [placeholder]="t('collections.search')" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
          </div>
          <select class="inp" style="width:auto;" [ngModel]="visibility()" (ngModelChange)="visibility.set($event)">
            <option value="All">{{ t('catalog.allCollections') }}</option>
            <option value="Visible">{{ t('collections.visible') }}</option>
            <option value="Hidden">{{ t('collections.hidden') }}</option>
          </select>
          <button class="btn btn-gold" (click)="openNew()" title="New Collection"><ap-icon name="plus" [size]="14"/> <span class="btn-lbl">{{ t('collections.new') }}</span></button>
        </div>
      </div>

      <div class="row mb-16" style="justify-content:space-between;align-items:center;">
        <div class="muted small">{{ filtered().length }} {{ t('collections.products') === 'Products' ? 'collections' : '' }}</div>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="collections" [title]="t('collections.empty.title')" [sub]="t('collections.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
          </ap-empty-state>
        </div>
      } @else if (isSearching()) {
        <!-- Flat search results -->
        <div class="grid-cards">
          @for (c of filtered(); track c.id) {
            <ng-container *ngTemplateOutlet="collectionCard; context: { $implicit: c }"/>
          }
        </div>
      } @else {
        <!-- Hierarchical view -->
        @for (group of hierarchyGroups(); track group.parent.id) {
          <div class="hierarchy-group mb-24">
            <ng-container *ngTemplateOutlet="collectionCard; context: { $implicit: group.parent }"/>

            @if (group.children.length > 0) {
              <div class="sub-col-list">
                <ap-icon name="hierarchy" [size]="12" style="color:var(--muted);flex-shrink:0;margin-top:2px;"/>
                <div class="sub-col-chips">
                  @for (child of group.children; track child.id) {
                    <button class="sub-col-chip" [class.hidden-chip]="child.hidden" (click)="openCollection(child)" [title]="child.title">
                      @if (child.imageUrl) {
                        <img [src]="child.imageUrl" [alt]="child.title" class="sub-chip-img" (error)="onImgError($event)"/>
                      } @else {
                        <span class="sub-chip-img sub-chip-placeholder"><ap-icon name="collections" [size]="10"/></span>
                      }
                      <span class="sub-chip-name">{{ child.title }}</span>
                      <span class="sub-chip-count muted">{{ child.productIds.length }}</span>
                    </button>
                  }
                  <button class="sub-col-chip sub-col-add" (click)="openNewSubCollection(group.parent)" title="Add sub-collection">
                    <ap-icon name="plus" [size]="11"/>
                    <span class="sub-chip-name">Add</span>
                  </button>
                </div>
              </div>
            } @else {
              <div class="sub-col-list">
                <ap-icon name="hierarchy" [size]="12" style="color:var(--muted);flex-shrink:0;margin-top:2px;"/>
                <button class="sub-col-chip sub-col-add" (click)="openNewSubCollection(group.parent)" title="Add sub-collection">
                  <ap-icon name="plus" [size]="11"/>
                  <span class="sub-chip-name">Add sub-collection</span>
                </button>
              </div>
            }
          </div>
        }

        <!-- Standalone (no parent, no children) -->
        @if (standaloneCollections().length > 0) {
          <div class="grid-cards">
            @for (c of standaloneCollections(); track c.id) {
              <ng-container *ngTemplateOutlet="collectionCard; context: { $implicit: c }"/>
            }
          </div>
        }
      }
    </div>

    <!-- Reusable card template -->
    <ng-template #collectionCard let-c>
      <div class="prod-card" (click)="openCollection(c)" [style.opacity]="c.hidden ? 0.65 : 1">
        <div class="prod-img">
          @if (c.imageUrl) {
            <img [src]="c.imageUrl" [alt]="c.title" (error)="onImgError($event)" [style.filter]="c.hidden ? 'grayscale(0.6)' : null"/>
          } @else {
            <div style="width:100%;height:100%;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--muted);">
              <ap-icon name="collections" [size]="24"/>
            </div>
          }
          @if (c.hidden) {
            <span class="prod-3d-badge" style="top:10px;inset-inline-end:10px;inset-inline-start:auto;background:rgba(239,68,68,0.92);">○ {{ t('collections.hidden') }}</span>
          }
          @if (c.parentId) {
            <span class="prod-3d-badge" style="top:10px;inset-inline-start:10px;inset-inline-end:auto;background:rgba(2,70,56,0.85);">
              <ap-icon name="hierarchy" [size]="9"/> {{ t('collections.sub') }}
            </span>
          }
              @if (c.system) {
                <span class="prod-3d-badge" style="top:10px;inset-inline-start:10px;background:rgba(2,70,56,0.92);">○ All Products</span>
              }
        </div>
        <div class="prod-body">
          <div class="prod-name">{{ c.title }}</div>
          <div class="prod-meta" style="margin-top:4px;">
            <span class="prod-stock">{{ c.productIds.length }} {{ t('collections.products') }}</span>
          </div>
        </div>
      </div>
    </ng-template>

    @if (activeId(); as id) {
      <ap-collection-drawer
        [collections]="_collections()"
        [currentId]="id"
        (closed)="activeId.set(null)"
        (currentIdChange)="activeId.set($event)"
        (deleted)="onDeleted($event)"
      />
    }
  `,
  styles: [`
    .hierarchy-group { display: flex; flex-direction: column; gap: 0; }
    .hierarchy-group .prod-card { margin-bottom: 0; }

    .sub-col-list {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 14px 14px;
      background: var(--bg); border: 1px solid var(--border);
      border-top: none; border-radius: 0 0 12px 12px;
      margin-bottom: 0;
    }
    .sub-col-chips {
      display: flex; flex-wrap: wrap; gap: 6px; flex: 1;
    }
    @media (max-width: 640px) {
      /* Chips scroll horizontally — prevents a wall of wrapped rows on phone */
      .sub-col-chips { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .sub-col-chips::-webkit-scrollbar { display: none; }
    }
    .sub-col-chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px 4px 5px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 20px; cursor: pointer; font-size: 12px;
      color: var(--ink-2); font-weight: 500; transition: all 0.14s;
      text-align: start;
    }
    .sub-col-chip:hover { border-color: var(--green); color: var(--green); background: rgba(2,70,56,0.04); }
    .sub-col-chip.hidden-chip { opacity: 0.6; }
    .sub-col-add { border-style: dashed; color: var(--muted); }
    .sub-col-add:hover { color: var(--gold); border-color: var(--gold); background: rgba(197,165,114,0.06); }
    .sub-chip-img {
      width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
    }
    .sub-chip-placeholder {
      background: var(--bg); display: flex; align-items: center; justify-content: center; color: var(--muted);
    }
    .sub-chip-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
    .sub-chip-count {
      font-size: 10px; font-weight: 600;
      background: var(--bg); padding: 0 5px; border-radius: 10px;
      margin-inline-start: 2px;
    }

    /* Card border-radius override when sub-list follows */
    .hierarchy-group .prod-card {
      border-radius: 12px 12px 0 0;
      border-bottom: none;
    }
  `],
})
export class CollectionsComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly _collections = signal<Collection[]>([]);
  readonly loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.collectionsApi.list();
      this._collections.set(list);
    } catch {
      this._collections.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  readonly search = signal('');
  readonly visibility = signal('All');
  readonly activeId = signal<string | null>(null);

  readonly isSearching = computed(() => !!this.search() || this.visibility() !== 'All');

  readonly filtered = computed(() => {
    const s = this.search().toLowerCase();
    const v = this.visibility();
    return this._collections().filter((c) => {
      if (v === 'Visible' && c.hidden) return false;
      if (v === 'Hidden' && !c.hidden) return false;
      if (s && !c.title.toLowerCase().includes(s)) return false;
      return true;
    });
  });

  /** Top-level collections (no parent) that have at least one sub-collection. */
  readonly hierarchyGroups = computed((): HierarchyGroup[] => {
    const all = this._collections();
    const topLevel = all.filter(c => !c.parentId && !c.id.startsWith('COL-NEW-'));
    const withChildren = topLevel.filter(p => all.some(c => c.parentId === p.id));
    return withChildren.map(parent => ({
      parent,
      children: all.filter(c => c.parentId === parent.id),
    }));
  });

  /** Top-level collections that have no sub-collections (shown as plain cards). */
  readonly standaloneCollections = computed(() => {
    const all = this._collections();
    return all.filter(c =>
      !c.parentId &&
      !c.id.startsWith('COL-NEW-') &&
      !all.some(child => child.parentId === c.id),
    );
  });

  openCollection(c: Collection): void { this.activeId.set(c.id); }

  openNew(): void {
    const newCol: Collection = {
      id: 'COL-NEW-' + Date.now(),
      handle: '',
      title: 'New Collection',
      description: '',
      imageUrl: null,
      productIds: [],
      hidden: false,
      parentId: null,
    };
    this._collections.update(cols => [newCol, ...cols]);
    this.activeId.set(newCol.id);
  }

  openNewSubCollection(parent: Collection): void {
    const newCol: Collection = {
      id: 'COL-NEW-' + Date.now(),
      handle: '',
      title: 'New Sub-Collection',
      description: '',
      imageUrl: null,
      productIds: [],
      hidden: false,
      parentId: parent.id,
    };
    this._collections.update(cols => [newCol, ...cols]);
    this.activeId.set(newCol.id);
  }

  clearFilters(): void {
    this.search.set('');
    this.visibility.set('All');
  }

  onDeleted(deleted: Collection): void {
    const before = this._collections();
    const beforeIndex = before.findIndex((c) => c.id === deleted.id);
    if (beforeIndex < 0) return;

    const visible = this.filtered();
    const visibleIndex = visible.findIndex((c) => c.id === deleted.id);

    if (!deleted.id.startsWith('COL-NEW-')) {
      this.collectionsApi.archive(deleted.id).catch(() => {});
    }
    this._collections.update((all) => all.filter((c) => c.id !== deleted.id));

    const nextVisible = this.filtered();
    if (nextVisible.length === 0) {
      this.activeId.set(null);
    } else {
      const nextIdx = Math.min(Math.max(visibleIndex, 0), nextVisible.length - 1);
      this.activeId.set(nextVisible[nextIdx].id);
    }

    this.toast.success(
      this.t('collections.toast.deleted.title'),
      `${deleted.title}`,
      {
        label: this.t('common.undo'),
        run: () => {
          this._collections.update((all) => {
            const restored = [...all];
            restored.splice(beforeIndex, 0, deleted);
            return restored;
          });
          this.activeId.set(deleted.id);
          this.toast.info(this.t('collections.toast.restored.title'), deleted.title);
        },
      },
    );
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
