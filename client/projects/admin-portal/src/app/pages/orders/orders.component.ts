import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { OrderDrawerComponent } from './order-drawer.component';
import { fulfillmentPillKind, paymentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { AdminOrdersService, OrderListParams } from '../../services/admin-orders.service';
import { Order, QAR } from '../../models';

@Component({
  selector: 'ap-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SortableTableComponent, CellTplDirective, SpinnerComponent, EmptyStateComponent, PaginationComponent, OrderDrawerComponent],
  template: `
    <div class="page-fade">
      <!-- Row 1: search + export -->
      <div class="row gap-sm mb-10">
        <div class="inp-search" style="flex:1;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('orders.search.placeholder')" [ngModel]="search()" (ngModelChange)="onSearchChange($event)"/>
        </div>
        <button class="btn btn-outline" [disabled]="exporting()" (click)="exportCsv()" title="Export CSV">
          @if (exporting()) {
            <ap-spinner/> <span class="btn-lbl">{{ t('common.exporting') }}</span>
          } @else {
            <ap-icon name="download" [size]="14"/> <span class="btn-lbl orders-export-lbl">{{ t('common.exportCsv') }}</span>
          }
        </button>
      </div>
      <!-- Row 2: filters -->
      <div class="row gap-sm mb-16" style="flex-wrap:wrap;">
        <select class="inp orders-filter-sel" [ngModel]="paymentFilter()" (ngModelChange)="onPaymentFilterChange($event)">
          <option value="all">{{ t('orders.allPayment') }}</option>
          <option value="paid">{{ t('pill.paid') }}</option>
          <option value="pending">{{ t('pill.pending') }}</option>
          <option value="refunded">{{ t('pill.refunded') }}</option>
          <option value="failed">{{ t('pill.failed') }}</option>
        </select>
        <select class="inp orders-filter-sel" [ngModel]="fulfillmentFilter()" (ngModelChange)="onFulfillmentFilterChange($event)">
          <option value="all">{{ t('orders.allFulfillment') }}</option>
          <option value="awaiting">{{ t('pill.awaiting') }}</option>
          <option value="processing">{{ t('pill.processing') }}</option>
          <option value="shipped">{{ t('pill.shipped') }}</option>
          <option value="delivered">{{ t('pill.delivered') }}</option>
          <option value="returned">{{ t('pill.returned') }}</option>
        </select>
      </div>

      <!-- Date range filter -->
      <div class="row gap-sm mb-16" style="flex-wrap:wrap;align-items:center;">
        <div class="date-range-pills">
          <button class="dr-pill" [class.active]="dateRange() === 'all'"   (click)="setDateRange('all')">{{ t('orders.range.all') }}</button>
          <button class="dr-pill" [class.active]="dateRange() === 'today'" (click)="setDateRange('today')">{{ t('orders.range.today') }}</button>
          <button class="dr-pill" [class.active]="dateRange() === 'week'"  (click)="setDateRange('week')">{{ t('orders.range.week') }}</button>
          <button class="dr-pill" [class.active]="dateRange() === 'month'" (click)="setDateRange('month')">{{ t('orders.range.month') }}</button>
          <button class="dr-pill" [class.active]="dateRange() === 'custom'" (click)="setDateRange('custom')">{{ t('orders.range.custom') }}</button>
        </div>
        @if (dateRange() === 'custom') {
          <input class="inp" type="date" style="width:auto;" [ngModel]="dateFrom()" (ngModelChange)="onDateFromChange($event)"/>
          <span class="muted">-</span>
          <input class="inp" type="date" style="width:auto;" [ngModel]="dateTo()" (ngModelChange)="onDateToChange($event)"/>
        }
        @if (dateRange() !== 'all') {
          <span class="filter-chip">
            {{ dateRangeLabel() }}
            <button (click)="setDateRange('all')">×</button>
          </span>
        }
      </div>

      <!-- Error banner -->
      @if (loadError()) {
        <div class="load-error-banner">
          <ap-icon name="warning" [size]="16"/>
          <span>{{ loadError() }}</span>
          <button class="btn btn-outline btn-sm" (click)="refreshOrders()">{{ t('common.retry') }}</button>
        </div>
      }

      <!-- Desktop table -->
      @if (!isMobile()) {
        <div class="card">
          @if (loading()) {
            <div class="skeleton-table">
              @for (_ of skeletonRows; track $index) {
                <div class="sk-row">
                  <div class="sk-cell sk-w-sm"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-md"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-xs"></div>
                  <div class="sk-cell sk-w-xs"></div>
                </div>
              }
            </div>
          } @else if (_orders().length === 0) {
            <ap-empty-state icon="orders" [title]="t('orders.empty.title')" [sub]="t('orders.empty.sub')">
              <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
            </ap-empty-state>
          } @else {
            <ap-sortable-table [columns]="columns" [rows]="_orders()" [rowClick]="openOrder">
              <ng-template apCellTpl="id" let-r>
                <span class="strong mono" style="color:var(--green);">{{ r.id }}</span>
              </ng-template>
              <ng-template apCellTpl="itemsCount" let-r>
                <span class="muted">{{ r.itemsCount }}</span>
              </ng-template>
              <ng-template apCellTpl="total" let-r>
                <span class="strong mono">{{ QAR(r.total) }}</span>
              </ng-template>
              <ng-template apCellTpl="payment" let-r>
                <div class="row gap-sm" style="align-items:center;">
                  <ap-pill [kind]="paymentPill(r.payment).kind">{{ t(paymentPill(r.payment).labelKey) }}</ap-pill>
                  @if (isStalePayment(r)) {
                    <span class="stale-warn" title="Payment pending for over 30 minutes">
                      <ap-icon name="warning" [size]="12"/>
                    </span>
                  }
                </div>
              </ng-template>
              <ng-template apCellTpl="fulfillment" let-r>
                <ap-pill [kind]="fulfillmentPill(r.fulfillment).kind">{{ t(fulfillmentPill(r.fulfillment).labelKey) }}</ap-pill>
              </ng-template>
              <ng-template apCellTpl="actions" let-r>
                <div class="row gap-sm" style="justify-content:flex-end;">
                  <button class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); openOrder(r)">{{ t('common.view') }}</button>
                  @if (r.fulfillment === 'awaiting' || r.fulfillment === 'processing') {
                    <button class="btn btn-outline btn-sm" [disabled]="fulfillingId() === r.id"
                      (click)="$event.stopPropagation(); markFulfilled(r)">
                      @if (fulfillingId() === r.id) {
                        <ap-spinner [size]="12"/> {{ t('common.working') }}
                      } @else {
                        {{ t('orders.markFulfilled') }}
                      }
                    </button>
                  }
                </div>
              </ng-template>
            </ap-sortable-table>
          }
        </div>
      }

      <!-- Mobile card list -->
      @if (isMobile()) {
        @if (loading()) {
          <div class="order-cards">
            @for (_ of skeletonRows; track $index) {
              <div class="order-card sk-card">
                <div class="sk-line sk-w-sm mb-6"></div>
                <div class="sk-line sk-w-md mb-8"></div>
                <div class="sk-line sk-w-xs"></div>
              </div>
            }
          </div>
        } @else if (_orders().length === 0) {
          <div class="card">
            <ap-empty-state icon="orders" [title]="t('orders.empty.title')" [sub]="t('orders.empty.sub')">
              <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
            </ap-empty-state>
          </div>
        } @else {
          <div class="order-cards">
            @for (o of _orders(); track o.id) {
              <div class="order-card" [class]="'order-card--' + o.fulfillment" (click)="openOrder(o)">
                <div class="oc-row1">
                  <span class="oc-id">{{ o.id }}</span>
                  <span class="oc-date muted">{{ o.date }}</span>
                </div>
                <div class="oc-customer">{{ o.customer }}</div>
                <div class="oc-row3">
                  <span class="oc-items muted">{{ o.itemsCount }} {{ o.itemsCount !== 1 ? t('orders.items') : t('orders.item') }}</span>
                  <span class="oc-total">{{ QAR(o.total) }}</span>
                  <ap-pill [kind]="fulfillmentPill(o.fulfillment).kind">{{ t(fulfillmentPill(o.fulfillment).labelKey) }}</ap-pill>
                  <ap-pill [kind]="paymentPill(o.payment).kind">{{ t(paymentPill(o.payment).labelKey) }}</ap-pill>
                  @if (isStalePayment(o)) {
                    <span class="stale-warn" title="Payment pending for over 30 minutes"><ap-icon name="warning" [size]="12"/></span>
                  }
                </div>
                <div class="oc-cta">{{ t('orders.cta.view') }} →</div>
              </div>
            }
          </div>
        }
      }

      <ap-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="serverTotal()"
        [totalPages]="totalPages()"
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      />
    </div>

    @if (active(); as o) {
      <ap-order-drawer [value]="o" (closed)="active.set(null)" (updated)="onOrderUpdated($event)"/>
    }
  `,
  styles: [`
    .orders-filter-sel { width: auto; flex: 1; }
    .mb-10 { margin-bottom: 10px; }
    @media (max-width: 480px) { .orders-export-lbl { display: none; } }
    .date-range-pills { display: flex; gap: 2px; background: var(--bg-2); border-radius: 8px; padding: 3px; flex-shrink: 0; }
    .dr-pill { border: none; background: none; padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; color: var(--muted); transition: all 0.13s; }
    .dr-pill.active { background: var(--surface); color: var(--green); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .filter-chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(2,70,56,.09); color: var(--green); border-radius: 20px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .filter-chip button { background: none; border: none; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 0 0 2px; opacity: .6; }
    .filter-chip button:hover { opacity: 1; }

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
    .sk-cell { height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3,#e5e7eb) 50%, var(--bg-2) 75%); background-size: 800px 100%; animation: shimmer 1.4s infinite; }
    .sk-w-xs { width: 60px; } .sk-w-sm { width: 100px; } .sk-w-md { width: 140px; }
    .sk-cell:nth-child(1) { flex: 1.2; } .sk-cell:nth-child(2) { flex: 0.8; } .sk-cell:nth-child(3) { flex: 2; }
    .sk-cell:nth-child(4),
    .sk-cell:nth-child(5),
    .sk-cell:nth-child(6),
    .sk-cell:nth-child(7) { flex: 1; }
    .sk-card { pointer-events: none; min-height: 80px; }
    .sk-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3,#e5e7eb) 50%, var(--bg-2) 75%); background-size: 800px 100%; animation: shimmer 1.4s infinite; }
    .mb-6 { margin-bottom: 6px; } .mb-8 { margin-bottom: 8px; }

    /* ── Stale payment warning ── */
    .stale-warn { display: inline-flex; align-items: center; color: #d97706; }

    /* ── Mobile order cards ── */
    .order-cards { display: flex; flex-direction: column; gap: 10px; }
    .order-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      cursor: pointer;
      border-inline-start-width: 4px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .order-card:active { box-shadow: var(--shadow); }
    .order-card--awaiting, .order-card--processing { border-inline-start-color: var(--warning); }
    .order-card--shipped   { border-inline-start-color: var(--info); }
    .order-card--delivered { border-inline-start-color: var(--success); }
    .order-card--returned  { border-inline-start-color: var(--muted); }
    .oc-row1 { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .oc-id   { font-size: 13px; font-weight: 700; color: var(--green); font-family: var(--ff-mono); }
    .oc-date { font-size: 12px; }
    .oc-customer { font-size: 15px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
    .oc-row3 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .oc-items { font-size: 12px; }
    .oc-total { font-size: 14px; font-weight: 700; color: var(--gold); font-family: var(--ff-mono); margin-inline-end: auto; }
    .oc-cta { font-size: 12px; color: var(--muted); text-align: end; margin-top: 8px; }
  `],
})
export class OrdersComponent implements OnInit, OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly ordersApi = inject(AdminOrdersService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly isMobile = signal(window.innerWidth <= 768);
  @HostListener('window:resize')
  onResize(): void { this.isMobile.set(window.innerWidth <= 768); }

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  async ngOnInit(): Promise<void> {
    // 300ms debounce on search: reset page and re-fetch from server
    this.searchInput$.pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((v) => { this.search.set(v); this.page.set(0); void this.refreshOrders(); });

    await this.refreshOrders();
    this.refreshTimer = setInterval(() => void this.refreshOrders(true), 15000);

    // Deep-link from customer drawer: ?id=EC-26-1042 auto-opens that order.
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      const target = this._orders().find((o) => o.id === id);
      if (target) void this.openOrder(target);
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(value: string): void { this.searchInput$.next(value); }

  readonly skeletonRows = Array(8).fill(null);

  async refreshOrders(silent = false): Promise<void> {
    if (!silent) { this.loading.set(true); this.loadError.set(null); }
    try {
      const { from, to } = this.effectiveDateRange();
      const resp = await this.ordersApi.list({
        page:        this.page(),
        limit:       this.pageSize(),
        q:           this.search() || undefined,
        payment:     this.paymentFilter() !== 'all' ? this.paymentFilter() : undefined,
        fulfillment: this.fulfillmentFilter() !== 'all' ? this.fulfillmentFilter() : undefined,
        from:        from || undefined,
        to:          to || undefined,
      });
      this._ordersSignal.set(resp.orders);
      this._serverTotal.set(resp.total);
      const active = this.active();
      if (active) {
        const updated = resp.orders.find((o) => o.id === active.id);
        if (updated) {
          this.active.set({
            ...active,
            ...updated,
            items: active.items.length ? active.items : updated.items,
            timeline: active.timeline?.length ? active.timeline : updated.timeline,
            notes: active.notes?.length ? active.notes : updated.notes,
          });
        }
      }
    } catch {
      if (!silent) this.loadError.set('Could not load orders. Check your connection and try again.');
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  private effectiveDateRange(): { from: string; to: string } {
    const dr = this.dateRange();
    const today = new Date().toISOString().slice(0, 10);
    if (dr === 'today')  return { from: today, to: today };
    if (dr === 'week')   { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return { from: d.toISOString().slice(0, 10), to: today }; }
    if (dr === 'month')  return { from: today.slice(0, 8) + '01', to: today };
    if (dr === 'custom') return { from: this.dateFrom(), to: this.dateTo() || today };
    return { from: '', to: '' };
  }

  readonly QAR = QAR;
  readonly active = signal<Order | null>(null);
  readonly search = signal('');
  readonly loadError = signal<string | null>(null);
  readonly paymentFilter = signal('all');
  readonly fulfillmentFilter = signal('all');
  readonly dateRange = signal<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly fulfillingId = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly loading = signal(true);
  readonly page = signal(0);
  readonly pageSize = signal(50);

  private readonly _ordersSignal = signal<Order[]>([]);
  readonly _orders = this._ordersSignal.asReadonly();
  readonly serverTotal = signal(0);
  private readonly _serverTotal = this.serverTotal;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.serverTotal() / this.pageSize())));

  readonly paymentPill = paymentPillKind;
  readonly fulfillmentPill = fulfillmentPillKind;

  isStalePayment(o: Order): boolean {
    if (o.payment !== 'pending') return false;
    const placed = new Date(o.date).getTime();
    return Date.now() - placed > 30 * 60 * 1000;
  }

  readonly columns: TableColumn<Order>[] = [
    { key: 'id',          label: 'Order ID',    labelKey: 'orders.col.id' },
    { key: 'date',        label: 'Date',        labelKey: 'orders.col.date' },
    { key: 'customer',    label: 'Customer',    labelKey: 'orders.col.customer' },
    { key: 'itemsCount',  label: 'Items',       labelKey: 'orders.col.items', align: 'center' },
    { key: 'total',       label: 'Total',       labelKey: 'orders.col.total', align: 'right' },
    { key: 'payment',     label: 'Payment',     labelKey: 'orders.col.payment' },
    { key: 'fulfillment', label: 'Fulfillment', labelKey: 'orders.col.fulfillment' },
    { key: 'actions',     label: '',            noSort: true, align: 'right' },
  ];

  openOrder = (o: Order): void => {
    this.active.set(o);
    void this.ordersApi.get(o.id)
      .then((full) => {
        this._ordersSignal.update((all) => all.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
        this.active.set(full);
      })
      .catch(() => {});
  };

  onOrderUpdated(updated: Order): void {
    this._ordersSignal.update((all) => all.map((x) => (x.id === updated.id ? updated : x)));
    this.active.set(updated);
  }

  onPaymentFilterChange(val: string): void { this.paymentFilter.set(val); this.page.set(0); void this.refreshOrders(); }
  onFulfillmentFilterChange(val: string): void { this.fulfillmentFilter.set(val); this.page.set(0); void this.refreshOrders(); }
  onDateFromChange(val: string): void { this.dateFrom.set(val); this.page.set(0); void this.refreshOrders(); }
  onDateToChange(val: string): void { this.dateTo.set(val); this.page.set(0); void this.refreshOrders(); }
  onPageChange(p: number): void { this.page.set(p); void this.refreshOrders(); }

  setDateRange(range: 'all' | 'today' | 'week' | 'month' | 'custom'): void {
    this.dateRange.set(range);
    this.page.set(0);
    void this.refreshOrders();
  }

  dateRangeLabel(): string {
    switch (this.dateRange()) {
      case 'today': return this.t('orders.range.today');
      case 'week': return this.t('orders.range.week');
      case 'month': return this.t('orders.range.month');
      case 'custom': {
        const f = this.dateFrom(); const to = this.dateTo();
        if (f && to) return `${f} - ${to}`;
        if (f) return `${this.t('orders.range.from')} ${f}`;
        return this.t('orders.range.customRange');
      }
      default: return '';
    }
  }

  clearFilters(): void {
    this.search.set('');
    this.paymentFilter.set('all');
    this.fulfillmentFilter.set('all');
    this.dateRange.set('all');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.page.set(0);
    void this.refreshOrders();
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
    void this.refreshOrders();
  }

  async markFulfilled(o: Order): Promise<void> {
    if (this.fulfillingId() === o.id) return;
    this.fulfillingId.set(o.id);
    try {
      const updated = await this.ordersApi.updateStatus(o.id, {
        fulfillment: 'shipped',
        timelineKind: 'shipped',
        detail: 'Marked shipped from list view',
      });
      this._ordersSignal.update((all) => all.map((x) => (x.id === o.id ? { ...x, ...updated } : x)));
      this.toast.success(this.t('orders.toast.shipped'), `${o.id} · ${o.customer}`, {
        label: this.t('orders.toast.viewOrder'),
        run: () => this.openOrder({ ...o, ...updated }),
      });
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.fulfillingId.set(null);
    }
  }

  exportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const orders = this._orders();
      const headers = ['Order ID', 'Date', 'Customer', 'Items', 'Total (QAR)', 'Payment', 'Fulfillment'];
      const rows = orders.map((o) => [
        o.id, o.date, o.customer, o.itemsCount,
        o.total.toFixed(2), o.payment, o.fulfillment,
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.toast.success(this.t('orders.toast.exportDone'), `${orders.length} ${orders.length !== 1 ? this.t('orders.items') : this.t('orders.item')} · CSV`);
    } finally {
      this.exporting.set(false);
    }
  }
}
