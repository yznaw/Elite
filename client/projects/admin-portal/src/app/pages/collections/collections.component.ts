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

      <div class="row mb-16" style="justify-content:space-between;">
        <div class="muted small">{{ filtered().length }}</div>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="catalog" [title]="t('collections.empty.title')" [sub]="t('collections.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
          </ap-empty-state>
        </div>
      } @else {
      <div class="grid-cards">
        @for (c of filtered(); track c.id) {
          <div class="prod-card" (click)="openCollection(c)" [style.opacity]="c.hidden ? 0.65 : 1">
            <div class="prod-img">
              @if (c.imageUrl) {
                <img [src]="c.imageUrl" [alt]="c.title" (error)="onImgError($event)" [style.filter]="c.hidden ? 'grayscale(0.6)' : null"/>
              } @else {
                <div style="width:100%;height:100%;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--muted);">
                  <ap-icon name="catalog" [size]="24"/>
                </div>
              }
              @if (c.hidden) {
                <span class="prod-3d-badge" style="top:10px;inset-inline-end:10px;inset-inline-start:auto;background:rgba(239,68,68,0.92);">○ {{ t('collections.hidden') }}</span>
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
        }
      </div>
      }
    </div>

    @if (activeId(); as id) {
      <ap-collection-drawer
        [collections]="filtered()"
        [currentId]="id"
        (closed)="activeId.set(null)"
        (currentIdChange)="activeId.set($event)"
        (deleted)="onDeleted($event)"
      />
    }
  `,
})
export class CollectionsComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly collectionsApi = inject(AdminCollectionsService);
  readonly t = (k: string): string => this.i18n.t(k);

  /** Live, mutable collection list — hydrated from the API on init. */
  private readonly _collections = signal<Collection[]>([]);
  readonly collections = computed(() => this._collections());
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

  openCollection(c: Collection): void { this.activeId.set(c.id); }

  openNew(): void {
    const newCol: Collection = {
      id: 'COL-NEW-' + Date.now(),
      handle: '',
      title: 'New Collection',
      description: '',
      imageUrl: null,
      productIds: [],
      hidden: false
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

    // Newly created drafts that haven't been saved get prefixed IDs.
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
