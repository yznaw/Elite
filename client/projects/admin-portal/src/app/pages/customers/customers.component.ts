import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { CustomerDrawerComponent } from './customer-drawer.component';
import { OrderDrawerComponent } from '../orders/order-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { AdminCustomersService } from '../../services/admin-customers.service';
import { AdminOrdersService } from '../../services/admin-orders.service';
import { StorageService } from '../../services/storage.service';
import { Customer, Order, QAR } from '../../models';

type View = 'table' | 'cards';
const MOBILE_BP = 900;

@Component({
  selector: 'ap-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, AvatarComponent, EmptyStateComponent, SortableTableComponent, CellTplDirective, PaginationComponent, CustomerDrawerComponent, OrderDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('customers.search.placeholder')" [ngModel]="search()" (ngModelChange)="onSearchChange($event)"/>
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

        <button class="btn btn-outline" [disabled]="exporting()" (click)="exportCsv()" title="Export CSV">
          @if (exporting()) { <ap-icon name="spinner" [size]="14"/> } @else { <ap-icon name="download" [size]="14"/> }
          <span class="btn-lbl">{{ exporting() ? t('common.exporting') : t('common.exportCsv') }}</span>
        </button>
        @if (!isMobile()) {
          <button class="btn btn-gold" (click)="createCustomer()" title="Add Customer"><ap-icon name="plus" [size]="14"/> <span class="btn-lbl">{{ t('customers.add') }}</span></button>
        }
      </div>

      <!-- FAB: phone only -->
      @if (isMobile()) {
        <button class="customers-fab" (click)="createCustomer()" [attr.aria-label]="t('customers.add')">
          <ap-icon name="plus" [size]="22"/>
        </button>
      }

      <!-- Error banner -->
      @if (loadError()) {
        <div class="load-error-banner">
          <ap-icon name="warning" [size]="16"/>
          <span>{{ loadError() }}</span>
          <button class="btn btn-outline btn-sm" (click)="loadCustomers()">{{ t('common.retry') }}</button>
        </div>
      }

      <!-- Skeleton while loading -->
      @if (loading()) {
        @if (effectiveView() === 'table') {
          <div class="card">
            <div class="skeleton-table">
              @for (_ of skeletonRows; track $index) {
                <div class="sk-row">
                  <div class="sk-cell sk-w-md"></div>
                  <div class="sk-cell sk-w-md"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-sm"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-sm"></div>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="customer-cards">
            @for (_ of skeletonRows; track $index) {
              <div class="customer-card sk-card">
                <div class="sk-line sk-w-sm mb-8" style="height:16px;border-radius:8px;"></div>
                <div class="sk-line sk-w-md mb-6"></div>
                <div class="sk-line sk-w-xs"></div>
              </div>
            }
          </div>
        }
      } @else if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="users" [title]="t('customers.empty.title')" [sub]="t('customers.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
          </ap-empty-state>
        </div>
      } @else if (effectiveView() === 'table') {
        <div class="card">
          <ap-sortable-table [columns]="columns" [rows]="paged()" [rowClick]="openCustomer">
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
            <ng-template apCellTpl="sizePref" let-r>@if (r.sizePref) {<ap-pill kind="gold">EU {{ r.sizePref }}</ap-pill>} @else {<span class="muted small">-</span>}</ng-template>
            <ng-template apCellTpl="actions" let-r>
              <button class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); openCustomer(r)">{{ t('common.view') }}</button>
            </ng-template>
          </ap-sortable-table>
        </div>
      } @else {
        <!-- Cards view -->
        <div class="customer-cards">
          @for (c of paged(); track c.id) {
            <button class="customer-card" (click)="openCustomer(c)" type="button">
              <div class="customer-card-head">
                <ap-avatar [initials]="initials(c.name)" size="lg"/>
                <div class="customer-card-id" style="min-width:0;">
                  <div class="customer-card-name strong">{{ c.name }}</div>
                  <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ c.email }}</div>
                  <div class="muted small">{{ c.city }}</div>
                </div>
                @if (c.sizePref) { <ap-pill kind="gold">EU {{ c.sizePref }}</ap-pill> }
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

    <ap-pagination
      [page]="page()"
      [pageSize]="pageSize()"
      [total]="filtered().length"
      [totalPages]="totalPages()"
      (pageChange)="page.set($event)"
      (pageSizeChange)="onPageSizeChange($event)"
    />

    @if (active(); as c) {
      <ap-customer-drawer
        [customer]="c"
        [mode]="creatingId() === c.id ? 'create' : 'edit'"
        (closed)="onDrawerClosed()"
        (saved)="onCustomerSaved($event)"
        (deleted)="onCustomerDeleted($event)"
        (openOrder)="onOpenOrder($event)"
      />
    }

    @if (activeOrder(); as o) {
      <ap-order-drawer
        [value]="o"
        [backLabel]="orderContext()?.name ? t('common.backTo') + ' ' + orderContext()!.name : t('common.back')"
        (back)="closeOrderDrawer()"
        (closed)="closeOrderDrawer()"
        (updated)="onOrderUpdated($event)"
      />
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

    /* ── Error banner ── */
    .load-error-banner {
      display: flex; align-items: center; gap: 10px;
      background: rgba(220,38,38,.07); border: 1px solid rgba(220,38,38,.2);
      border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;
      color: var(--danger, #dc2626); font-size: 13px; font-weight: 500;
    }
    .load-error-banner span { flex: 1; }

    /* ── Skeleton loaders ── */
    @keyframes shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
    .sk-row { display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .sk-row:last-child { border-bottom: none; }
    .sk-cell { height: 14px; border-radius: 6px; flex: 1; background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3,#e5e7eb) 50%, var(--bg-2) 75%); background-size: 800px 100%; animation: shimmer 1.4s infinite; }
    .sk-w-xs { max-width: 60px; } .sk-w-sm { max-width: 100px; } .sk-w-md { max-width: 140px; }
    .sk-card { pointer-events: none; min-height: 90px; }
    .sk-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3,#e5e7eb) 50%, var(--bg-2) 75%); background-size: 800px 100%; animation: shimmer 1.4s infinite; }
    .mb-6 { margin-bottom: 6px; } .mb-8 { margin-bottom: 8px; }

    /* ── Add Customer FAB (phone only) ── */
    .customers-fab {
      position: fixed;
      bottom: calc(72px + env(safe-area-inset-bottom, 0px));
      inset-inline-end: 20px;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: var(--green);
      color: var(--gold);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,69,56,.35);
      cursor: pointer;
      z-index: 120;
      transition: transform 0.15s, box-shadow 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .customers-fab:active { transform: scale(.94); box-shadow: 0 2px 10px rgba(0,69,56,.25); }
  `],
})
export class CustomersComponent implements OnInit, OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly customersApi = inject(AdminCustomersService);
  private readonly ordersApi = inject(AdminOrdersService);
  private readonly storage = inject(StorageService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;
  readonly skeletonRows = Array(8).fill(null);
  /** Live, mutable customers list — hydrated from the API on init. */
  private readonly _customers = signal<Customer[]>([]);
  readonly customers = computed(() => this._customers());
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly active = signal<Customer | null>(null);
  /** ID of a customer that's currently being created (drawer in 'create' mode). */
  readonly creatingId = signal<string | null>(null);
  readonly search = signal('');
  readonly exporting = signal(false);

  /** Order drawer shown inline (instead of navigating to /orders). */
  readonly activeOrder = signal<Order | null>(null);
  /** The customer we came from when opening an order inline. */
  readonly orderContext = signal<Customer | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  async ngOnInit(): Promise<void> {
    this.searchInput$.pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((v) => { this.search.set(v); this.page.set(0); });
    await this.loadCustomers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadCustomers(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const list = await this.customersApi.list();
      this._customers.set(list);
    } catch {
      this.loadError.set(this.t('customers.loadError'));
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void { this.searchInput$.next(value); }

  readonly view = signal<View>(this.loadView());
  readonly isMobile = signal(this.computeIsMobile());
  readonly effectiveView = computed<View>(() => (this.isMobile() ? 'cards' : this.view()));
  readonly page = signal(0);
  readonly pageSize = signal(50);

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile.set(this.computeIsMobile());
  }

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this._customers().filter((c) => {
      if (q && !(c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  readonly paged = computed(() => {
    const all = this.filtered();
    const start = this.page() * this.pageSize();
    return all.slice(start, start + this.pageSize());
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
    this.page.set(0);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
  }

  /** "Add Customer" — synthesize a blank record and open the drawer in
      create mode. Discarding without saving auto-removes the stub. */
  createCustomer(): void {
    const id = 'C-NEW-' + Date.now().toString(36).slice(-5).toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const draft: Customer = {
      id,
      name: '', email: '', city: '',
      orders: 0, ltv: 0, sizePref: 42,
      lastOrder: today, joined: today,
      notes: '',
    };
    this._customers.update((all) => [draft, ...all]);
    this.creatingId.set(id);
    this.active.set(draft);
  }

  onDrawerClosed(): void {
    const id = this.creatingId();
    if (id) {
      const cust = this._customers().find((x) => x.id === id);
      if (cust && !cust.name) {
        this._customers.update((all) => all.filter((x) => x.id !== id));
      }
      this.creatingId.set(null);
    }
    this.active.set(null);
  }

  async onCustomerSaved(c: Customer): Promise<void> {
    const wasDraft = !!this.creatingId() && c.id === this.creatingId();
    const payload = {
      name: c.name,
      email: c.email,
      city: c.city,
      sizePref: c.sizePref,
      notes: c.notes,
    };

    try {
      const saved = wasDraft
        ? await this.customersApi.create(payload)
        : await this.customersApi.update(c.id, payload);

      // Adopt the server's id (especially for newly-created records) and
      // re-emit a fresh array so `filtered()` recomputes.
      this._customers.update((all) => all.map((x) => (x.id === c.id ? { ...x, ...saved } : x)));
      if (wasDraft) {
        this.creatingId.set(null);
        this.active.set({ ...c, ...saved });
      }
    } catch {
      // Toast already raised by the global error interceptor.
    }
  }

  async onCustomerDeleted(c: Customer): Promise<void> {
    try {
      await this.customersApi.remove(c.id);
    } catch {
      // Global error interceptor raises the toast.
    }
    this._customers.update((all) => all.filter((x) => x.id !== c.id));
    this.active.set(null);
    this.creatingId.set(null);
  }

  onOpenOrder(o: Order): void {
    this.orderContext.set(this.active());
    this.active.set(null);
    this.creatingId.set(null);
    this.activeOrder.set(o);
    // Load the full order (timeline, notes, items) in the background
    void this.ordersApi.get(o.id)
      .then((full) => this.activeOrder.set(full))
      .catch(() => {});
  }

  closeOrderDrawer(): void {
    const ctx = this.orderContext();
    this.activeOrder.set(null);
    this.orderContext.set(null);
    if (ctx) this.active.set(ctx);
  }

  onOrderUpdated(updated: Order): void {
    this.activeOrder.set(updated);
  }

  exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const list = this.filtered();
      const headers = ['Name', 'Email', 'City', 'Orders', 'LTV (QAR)', 'Size (EU)', 'Last Order', 'Joined'];
      const rows = list.map((c) => [
        c.name, c.email, c.city, c.orders,
        c.ltv.toFixed(2), c.sizePref || '', c.lastOrder, c.joined,
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      this.exporting.set(false);
    }
  }

  setView(v: View): void {
    this.view.set(v);
    this.storage.set('customers:view', v);
  }

  initials(name: string): string {
    return name.split(' ').map((s) => s[0]).slice(0, 2).join('');
  }

  private computeIsMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BP;
  }

  private loadView(): View {
    const raw = this.storage.get('customers:view');
    if (raw === 'cards' || raw === 'table') return raw;
    return 'table';
  }
}
