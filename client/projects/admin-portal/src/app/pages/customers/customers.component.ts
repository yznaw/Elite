import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { CustomerDrawerComponent } from './customer-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { CUSTOMERS } from '../../data/mock';
import { Customer, QAR } from '../../models';

type View = 'table' | 'cards';
const VIEW_KEY = 'elite-admin:customers:view';
const MOBILE_BP = 900;

@Component({
  selector: 'ap-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, AvatarComponent, EmptyStateComponent, SortableTableComponent, CellTplDirective, CustomerDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('customers.search.placeholder')" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
        </div>

        <!-- View toggle (desktop only — mobile is always cards) -->
        @if (!isMobile()) {
          <div class="view-toggle" role="tablist" [attr.aria-label]="t('customers.view.label')">
            <button
              class="view-toggle-btn"
              [class.active]="view() === 'table'"
              (click)="setView('table')"
              role="tab"
              [attr.aria-selected]="view() === 'table'"
              [attr.aria-label]="t('customers.view.table')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
              <span>{{ t('customers.view.table') }}</span>
            </button>
            <button
              class="view-toggle-btn"
              [class.active]="view() === 'cards'"
              (click)="setView('cards')"
              role="tab"
              [attr.aria-selected]="view() === 'cards'"
              [attr.aria-label]="t('customers.view.cards')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span>{{ t('customers.view.cards') }}</span>
            </button>
          </div>
        }

        <button class="btn btn-outline">{{ t('common.export') }}</button>
        <button class="btn btn-gold"><ap-icon name="plus" [size]="14"/> {{ t('customers.add') }}</button>
      </div>

      @if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="users" [title]="t('customers.empty.title')" [sub]="t('customers.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
          </ap-empty-state>
        </div>
      } @else if (effectiveView() === 'table') {
        <div class="card">
          <ap-sortable-table [columns]="columns" [rows]="filtered()" [rowClick]="openCustomer">
            <ng-template apCellTpl="name" let-r>
              <div class="row gap-sm">
                <ap-avatar [initials]="initials(r.name)"/>
                <div>
                  <div class="strong">{{ r.name }}</div>
                  <div class="muted small">{{ r.city }}</div>
                </div>
              </div>
            </ng-template>
            <ng-template apCellTpl="orders" let-r><span class="strong">{{ r.orders }}</span></ng-template>
            <ng-template apCellTpl="ltv" let-r><span class="strong mono">{{ QAR(r.ltv) }}</span></ng-template>
            <ng-template apCellTpl="sizePref" let-r><ap-pill kind="gold">EU {{ r.sizePref }}</ap-pill></ng-template>
            <ng-template apCellTpl="actions" let-r>
              <button class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); openCustomer(r)">{{ t('common.view') }}</button>
            </ng-template>
          </ap-sortable-table>
        </div>
      } @else {
        <!-- Cards view -->
        <div class="customer-cards">
          @for (c of filtered(); track c.id) {
            <button class="customer-card" (click)="openCustomer(c)" type="button">
              <div class="customer-card-head">
                <ap-avatar [initials]="initials(c.name)" size="lg"/>
                <div class="customer-card-id" style="min-width:0;">
                  <div class="customer-card-name strong">{{ c.name }}</div>
                  <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ c.email }}</div>
                  <div class="muted small">{{ c.city }}</div>
                </div>
                <ap-pill kind="gold">EU {{ c.sizePref }}</ap-pill>
              </div>

              <div class="customer-card-stats">
                <div class="customer-card-stat">
                  <div class="lbl">{{ t('customers.col.orders') }}</div>
                  <div class="v strong">{{ c.orders }}</div>
                </div>
                <div class="customer-card-stat">
                  <div class="lbl">{{ t('customers.col.ltv') }}</div>
                  <div class="v strong mono" style="color:var(--gold);">{{ QAR(c.ltv) }}</div>
                </div>
                <div class="customer-card-stat">
                  <div class="lbl">{{ t('customers.col.lastOrder') }}</div>
                  <div class="v mono" style="font-size:11px;">{{ c.lastOrder }}</div>
                </div>
              </div>

              <div class="customer-card-foot">
                <span class="muted small">{{ t('common.view') }} →</span>
              </div>
            </button>
          }
        </div>
      }
    </div>

    @if (active(); as c) {
      <ap-customer-drawer [customer]="c" (closed)="active.set(null)"/>
    }
  `,
  styles: [`
    .view-toggle {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .view-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      background: transparent;
      border: none;
      border-radius: 7px;
      color: var(--muted);
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      cursor: pointer;
      transition: all 0.15s;
    }
    .view-toggle-btn:hover { color: var(--ink); }
    .view-toggle-btn.active {
      background: var(--surface);
      color: var(--green);
      box-shadow: var(--shadow-sm);
    }
    .view-toggle-btn svg { color: currentColor; flex-shrink: 0; }

    .customer-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
    }
    .customer-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow-sm);
      padding: 18px;
      cursor: pointer;
      transition: all 0.18s ease;
      text-align: start;
      font: inherit;
      color: inherit;
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
    }
    .customer-card:hover {
      transform: translateY(-2px);
      border-color: var(--gold-4);
      box-shadow: var(--shadow);
    }
    .customer-card-head {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .customer-card-id { flex: 1; min-width: 0; }
    .customer-card-name {
      font-family: var(--ff-disp);
      font-size: 17px;
      color: var(--green);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .customer-card-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--border-2);
      border-radius: 8px;
      overflow: hidden;
    }
    .customer-card-stat {
      background: var(--bg);
      padding: 10px 12px;
    }
    .customer-card-stat .lbl { margin-bottom: 4px; }
    .customer-card-stat .v { font-size: 14px; }
    .customer-card-foot {
      display: flex;
      justify-content: flex-end;
      padding-top: 4px;
      border-top: 1px solid var(--border-2);
      font-size: 11px;
      color: var(--gold);
    }

    @media (max-width: 720px) {
      .customer-cards { grid-template-columns: 1fr; gap: 12px; }
      .customer-card { padding: 14px; }
      .customer-card-stat { padding: 8px 10px; }
      .customer-card-stat .v { font-size: 13px; }
    }

    /* RTL: arrow flip */
    html[dir='rtl'] .customer-card-foot { transform: scaleX(1); }
    html[dir='rtl'] .customer-card-foot .muted::after { content: ''; }
  `],
})
export class CustomersComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;
  readonly customers = CUSTOMERS;
  readonly active = signal<Customer | null>(null);
  readonly search = signal('');

  readonly view = signal<View>(this.loadView());
  readonly isMobile = signal(this.computeIsMobile());
  readonly effectiveView = computed<View>(() => (this.isMobile() ? 'cards' : this.view()));

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(this.computeIsMobile());
  }

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this.customers.filter((c) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  readonly columns: TableColumn<Customer>[] = [
    { key: 'name',      label: 'Customer',       labelKey: 'orders.col.customer' },
    { key: 'email',     label: 'Email',          labelKey: 'settings.email' },
    { key: 'orders',    label: 'Orders',         labelKey: 'customers.col.orders', align: 'center' },
    { key: 'ltv',       label: 'Lifetime Value', labelKey: 'customers.col.ltv', align: 'right' },
    { key: 'sizePref',  label: 'Size',           labelKey: 'customers.col.size', align: 'center' },
    { key: 'lastOrder', label: 'Last Order',     labelKey: 'customers.col.lastOrder' },
    { key: 'actions',   label: '', noSort: true, align: 'right' },
  ];

  openCustomer = (c: Customer): void => { this.active.set(c); };

  clearFilters(): void {
    this.search.set('');
  }

  setView(v: View): void {
    this.view.set(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  }

  initials(name: string): string {
    return name.split(' ').map((s) => s[0]).slice(0, 2).join('');
  }

  private computeIsMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BP;
  }

  private loadView(): View {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw === 'cards' || raw === 'table') return raw;
    } catch {}
    return 'table';
  }
}
