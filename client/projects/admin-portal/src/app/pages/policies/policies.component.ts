import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { PolicyDrawerComponent } from './policy-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { AdminPoliciesService } from '../../services/admin-policies.service';
import { Policy, PolicyType } from '../../models';

type PillKind = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'gold';

const TYPE_COLORS: Record<PolicyType, PillKind> = {
  privacy_policy:   'blue',
  terms_of_service: 'green',
  refund_policy:    'amber',
  shipping_policy:  'gold',
  cookie_policy:    'grey',
  contact_info:     'green',
  custom:           'grey',
};

const PRESET_TYPES: PolicyType[] = [
  'privacy_policy', 'terms_of_service', 'refund_policy',
  'shipping_policy', 'cookie_policy', 'contact_info',
];

@Component({
  selector: 'ap-policies',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, EmptyStateComponent, PolicyDrawerComponent],
  template: `
    <div class="page-fade">

      <!-- Page header -->
      <div class="page-header">
        <div>
          <div class="page-title">{{ t('policies.title') }}</div>
          <div class="page-sub muted small">{{ t('nav.policies.sub') }}</div>
        </div>
        <button class="btn btn-gold" type="button" (click)="openNew()">
          <ap-icon name="plus" [size]="14"/>
          <span class="btn-lbl">{{ t('policies.new') }}</span>
        </button>
      </div>

      <!-- Loading skeleton -->
      @if (loading()) {
        <div class="policies-grid">
          @for (n of [1,2,3]; track n) {
            <div class="policy-card skeleton-card">
              <div class="sk sk-title"></div>
              <div class="sk sk-pill"></div>
              <div class="sk sk-line"></div>
            </div>
          }
        </div>
      } @else if (policies().length === 0) {

        <!-- Empty state -->
        <div class="card">
          <ap-empty-state icon="docs" [title]="t('policies.empty.title')" [sub]="t('policies.empty.sub')">
            <div class="preset-btns">
              @for (tp of presetTypes; track tp) {
                <button class="btn btn-outline btn-sm" type="button" (click)="openPreset(tp)">
                  <ap-icon name="plus" [size]="11"/>
                  {{ t('policies.type.' + tp) }}
                </button>
              }
            </div>
          </ap-empty-state>
        </div>

      } @else {

        <!-- Toolbar -->
        <div class="card mb-20" style="padding:12px 16px;">
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="inp-search" style="flex:1;min-width:200px;position:relative;">
              <ap-icon name="search" [size]="14"/>
              <input class="inp with-icon" [placeholder]="t('policies.search')" [(ngModel)]="searchQuery"/>
            </div>
            <select class="inp" style="width:auto;" [(ngModel)]="statusFilter">
              <option value="all">{{ t('policies.status.all') }}</option>
              <option value="active">{{ t('policies.status.active') }}</option>
              <option value="draft">{{ t('policies.status.draft') }}</option>
            </select>
            <div class="muted small" style="white-space:nowrap;">{{ filtered().length }} {{ filtered().length === 1 ? t('policies.pageCount.one') : t('policies.pageCount.many') }}</div>
          </div>
        </div>

        <!-- Cards grid -->
        @if (filtered().length === 0) {
          <div class="card">
            <ap-empty-state icon="docs" [title]="t('policies.empty.title')" [sub]="t('policies.empty.sub')">
              <button class="btn btn-outline btn-sm" type="button" (click)="clearFilters()">
                {{ t('common.clearFilters') }}
              </button>
            </ap-empty-state>
          </div>
        } @else {
          <div class="policies-grid">
            @for (p of filtered(); track p.id) {
              <div class="policy-card" (click)="openPolicy(p)" [class.is-draft]="p.status === 'draft'">
                <div class="pc-header">
                  <div class="pc-icon">
                    <ap-icon name="docs" [size]="18"/>
                  </div>
                  <div class="pc-meta">
                    <ap-pill [kind]="typeColor(p.policyType)">{{ t('policies.type.' + p.policyType) }}</ap-pill>
                    <ap-pill [kind]="p.status === 'active' ? 'green' : 'grey'">{{ t('policies.status.' + p.status) }}</ap-pill>
                  </div>
                </div>
                <div class="pc-title">{{ p.title }}</div>
                <div class="pc-handle muted small">/policy/{{ p.handle }}</div>
                <div class="pc-footer">
                  <span class="muted small">{{ formatDate(p.updatedAt) }}</span>
                  <button class="pc-edit-btn icon-btn" type="button" (click)="openPolicy(p); $event.stopPropagation()" aria-label="Edit">
                    <ap-icon name="arrow" [size]="12"/>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <!-- Quick-add presets (when some policies exist but not all standard ones) -->
        @if (missingPresets().length > 0) {
          <div class="quick-add-bar">
            <span class="muted small">{{ t('policies.quickAdd') }}</span>
            @for (tp of missingPresets(); track tp) {
              <button class="btn btn-outline btn-xs" type="button" (click)="openPreset(tp)">
                <ap-icon name="plus" [size]="10"/>
                {{ t('policies.type.' + tp) }}
              </button>
            }
          </div>
        }
      }
    </div>

    <ap-policy-drawer
      [open]="drawerOpen()"
      [policy]="selectedPolicy()"
      (closeDrawer)="closeDrawer()"
      (saved)="onSaved($event)"
      (deleted)="onDeleted($event)"
    />
  `,
  styles: [`
    :host { display: block; }

    /* ── Page header ─────────────────────────── */
    .page-header {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 16px;
      margin-bottom: 24px;
    }
    .page-title { font-size: 22px; font-weight: 700; color: var(--ink); }
    .page-sub { margin-top: 2px; }

    /* ── Cards grid ──────────────────────────── */
    .policies-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
    }
    @media (max-width: 640px) {
      .policies-grid { grid-template-columns: 1fr; }
    }

    /* ── Policy card ─────────────────────────── */
    .policy-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 16px 14px;
      cursor: pointer;
      transition: border-color 0.18s, box-shadow 0.18s, transform 0.15s;
      display: flex; flex-direction: column; gap: 8px;
    }
    .policy-card:hover {
      border-color: var(--green);
      box-shadow: 0 4px 20px rgba(0,0,0,0.07);
      transform: translateY(-1px);
    }
    .policy-card.is-draft { opacity: 0.75; }

    .pc-header {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 10px;
    }
    .pc-icon {
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--ink-2);
      flex-shrink: 0;
    }
    .pc-meta { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .pc-title {
      font-size: 14px; font-weight: 600;
      color: var(--ink);
      line-height: 1.3;
    }
    .pc-handle { font-size: 11.5px; }
    .pc-footer {
      display: flex; align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .pc-edit-btn {
      opacity: 0; transition: opacity 0.15s;
    }
    .policy-card:hover .pc-edit-btn { opacity: 1; }

    /* ── Icon btn ────────────────────────────── */
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      background: transparent; border: 1px solid var(--border);
      border-radius: 6px; color: var(--ink-2);
      cursor: pointer; flex-shrink: 0;
      transition: all 0.15s;
    }
    .icon-btn:hover { background: var(--bg-2); color: var(--ink); }

    /* ── Skeleton ────────────────────────────── */
    .skeleton-card { pointer-events: none; }
    .sk {
      border-radius: 6px;
      background: linear-gradient(90deg, var(--bg-2) 25%, #e8e8e8 50%, var(--bg-2) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .sk-title { height: 16px; width: 70%; margin-bottom: 8px; }
    .sk-pill  { height: 20px; width: 90px; border-radius: 99px; }
    .sk-line  { height: 12px; width: 55%; margin-top: 8px; }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── Preset quick-add buttons ────────────── */
    .preset-btns {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 12px; justify-content: center;
    }
    .quick-add-bar {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 8px; margin-top: 16px;
      padding: 12px 16px;
      background: var(--bg);
      border: 1px dashed var(--border);
      border-radius: 10px;
    }

    /* ── Misc ────────────────────────────────── */
    .btn-xs {
      font-size: 11.5px; padding: 4px 10px;
    }
    @media (max-width: 480px) {
      .page-header { flex-direction: column; align-items: flex-start; }
    }
  `],
})
export class PoliciesComponent implements OnInit {
  private readonly i18n  = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly svc   = inject(AdminPoliciesService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly presetTypes = PRESET_TYPES;

  readonly loading       = signal(true);
  readonly policies      = signal<Policy[]>([]);
  readonly drawerOpen    = signal(false);
  readonly selectedPolicy = signal<Policy | null>(null);

  searchQuery  = '';
  statusFilter = 'all';

  readonly filtered = computed(() => {
    const q = this.searchQuery.toLowerCase().trim();
    return this.policies().filter(p => {
      const matchStatus = this.statusFilter === 'all' || p.status === this.statusFilter;
      const matchSearch = !q || p.title.toLowerCase().includes(q) || p.handle.includes(q);
      return matchStatus && matchSearch;
    });
  });

  readonly missingPresets = computed(() => {
    const existing = new Set(this.policies().map(p => p.policyType));
    return PRESET_TYPES.filter(tp => !existing.has(tp));
  });

  typeColor(tp: PolicyType): PillKind {
    return TYPE_COLORS[tp];
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.svc.list();
      this.policies.set(list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)));
    } catch {
      this.toast.error(this.t('policies.loadError'));
    } finally {
      this.loading.set(false);
    }
  }

  openNew(): void {
    this.selectedPolicy.set(null);
    this.drawerOpen.set(true);
  }

  openPreset(tp: PolicyType): void {
    this.selectedPolicy.set({
      id: '',
      handle: '',
      title: '',
      content: '',
      policyType: tp,
      status: 'active',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    });
    this.drawerOpen.set(true);
  }

  openPolicy(p: Policy): void {
    this.selectedPolicy.set(p);
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
    this.selectedPolicy.set(null);
  }

  onSaved(updated: Policy): void {
    const existing = this.policies().find(p => p.id === updated.id);
    if (existing) {
      this.policies.update(list => list.map(p => p.id === updated.id ? updated : p));
    } else {
      this.policies.update(list => [...list, updated].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)));
    }
    this.selectedPolicy.set(updated);
  }

  onDeleted(id: string): void {
    this.policies.update(list => list.filter(p => p.id !== id));
  }

  clearFilters(): void {
    this.searchQuery  = '';
    this.statusFilter = 'all';
  }
}
