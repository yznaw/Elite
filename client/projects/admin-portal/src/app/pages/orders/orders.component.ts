import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
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
import { AdminOrdersService } from '../../services/admin-orders.service';
import { Order, QAR } from '../../models';

@Component({
  selector: 'ap-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SortableTableComponent, CellTplDirective, SpinnerComponent, EmptyStateComponent, PaginationComponent, OrderDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-16" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('orders.search.placeholder')" [ngModel]="search()" (ngModelChange)="search.set($event); page.set(0)"/>
        </div>
        <select class="inp" style="width:auto;" [ngModel]="paymentFilter()" (ngModelChange)="paymentFilter.set($event); page.set(0)">
          <option value="all">{{ t('orders.allPayment') }}</option>
          <option value="paid">{{ t('pill.paid') }}</option>
          <option value="pending">{{ t('pill.pending') }}</option>
          <option value="refunded">{{ t('pill.refunded') }}</option>
          <option value="failed">{{ t('pill.failed') }}</option>
        </select>
        <select class="inp" style="width:auto;" [ngModel]="fulfillmentFilter()" (ngModelChange)="fulfillmentFilter.set($event); page.set(0)">
          <option value="all">{{ t('orders.allFulfillment') }}</option>
          <option value="awaiting">{{ t('pill.awaiting') }}</option>
          <option value="processing">{{ t('pill.processing') }}</option>
          <option value="shipped">{{ t('pill.shipped') }}</option>
          <option value="delivered">{{ t('pill.delivered') }}</option>
          <option value="returned">{{ t('pill.returned') }}</option>
        </select>
        <button class="btn btn-outline" [disabled]="exporting()" (click)="exportCsv()">
          @if (exporting()) {
            <ap-spinner/> {{ t('common.exporting') }}
          } @else {
            {{ t('common.exportCsv') }}
          }
        </button>
      </div>

      <!-- Date range filter -->
      <div class="row gap-sm mb-16" style="flex-wrap:wrap;align-items:center;">
        <div class="date-range-pills">
          <button class="dr-pill" [class.active]="dateRange() === 'all'"   (click)="setDateRange('all')">All time</button>
          <button class="dr-pill" [class.active]="dateRange() === 'today'" (click)="setDateRange('today')">Today</button>
          <button class="dr-pill" [class.active]="dateRange() === 'week'"  (click)="setDateRange('week')">This Week</button>
          <button class="dr-pill" [class.active]="dateRange() === 'month'" (click)="setDateRange('month')">This Month</button>
          <button class="dr-pill" [class.active]="dateRange() === 'custom'" (click)="setDateRange('custom')">Custom</button>
        </div>
        @if (dateRange() === 'custom') {
          <input class="inp" type="date" style="width:auto;" [ngModel]="dateFrom()" (ngModelChange)="dateFrom.set($event); page.set(0)"/>
          <span class="muted">–</span>
          <input class="inp" type="date" style="width:auto;" [ngModel]="dateTo()" (ngModelChange)="dateTo.set($event); page.set(0)"/>
        }
        @if (dateRange() !== 'all') {
          <span class="filter-chip">
            {{ dateRangeLabel() }}
            <button (click)="setDateRange('all')">×</button>
          </span>
        }
      </div>

      <div class="card">
        @if (filtered().length === 0) {
          <ap-empty-state icon="orders" [title]="t('orders.empty.title')" [sub]="t('orders.empty.sub')">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">{{ t('common.clearFilters') }}</button>
          </ap-empty-state>
        } @else {
          <ap-sortable-table [columns]="columns" [rows]="paged()" [rowClick]="openOrder">
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
              <ap-pill [kind]="paymentPill(r.payment).kind">{{ t(paymentPill(r.payment).labelKey) }}</ap-pill>
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

      <ap-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="filtered().length"
        [totalPages]="totalPages()"
        (pageChange)="page.set($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      />
    </div>

    @if (active(); as o) {
      <ap-order-drawer [value]="o" (closed)="active.set(null)" (updated)="onOrderUpdated($event)"/>
    }
  `,
  styles: [`
    .date-range-pills { display: flex; gap: 2px; background: var(--bg-2); border-radius: 8px; padding: 3px; flex-shrink: 0; }
    .dr-pill { border: none; background: none; padding: 5px 12px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; color: var(--muted); transition: all 0.13s; }
    .dr-pill.active { background: var(--surface); color: var(--green); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .filter-chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(2,70,56,.09); color: var(--green); border-radius: 20px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .filter-chip button { background: none; border: none; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 0 0 2px; opacity: .6; }
    .filter-chip button:hover { opacity: 1; }
  `],
})
export class OrdersComponent implements OnInit, OnDestroy {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly ordersApi = inject(AdminOrdersService);

  readonly t = (k: string): string => this.i18n.t(k);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
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
  }

  private async refreshOrders(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const list = await this.ordersApi.list();
      this._orders.set(list);
      const active = this.active();
      if (active) {
        const updated = list.find((o) => o.id === active.id);
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
      if (!silent) this._orders.set([]);
    } finally {
      if (!silent) this.loading.set(false);
    }
  }

  readonly QAR = QAR;
  readonly active = signal<Order | null>(null);
  readonly search = signal('');
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

  private readonly _orders = signal<Order[]>([]);

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    const p = this.paymentFilter();
    const f = this.fulfillmentFilter();
    const dr = this.dateRange();
    const today = new Date().toISOString().slice(0, 10);

    let fromDate = '';
    let toDate = today;
    if (dr === 'today') {
      fromDate = toDate = today;
    } else if (dr === 'week') {
      const d = new Date(); d.setDate(d.getDate() - d.getDay());
      fromDate = d.toISOString().slice(0, 10);
    } else if (dr === 'month') {
      fromDate = today.slice(0, 8) + '01';
    } else if (dr === 'custom') {
      fromDate = this.dateFrom();
      toDate = this.dateTo() || today;
    }

    return this._orders().filter((o) => {
      if (p !== 'all' && o.payment !== p) return false;
      if (f !== 'all' && o.fulfillment !== f) return false;
      if (q && !(o.id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q))) return false;
      if (fromDate && o.date < fromDate) return false;
      if (dr !== 'all' && dr !== 'custom' && o.date > toDate) return false;
      if (dr === 'custom' && toDate && o.date > toDate) return false;
      return true;
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));

  readonly paged = computed(() => {
    const all = this.filtered();
    const start = this.page() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  readonly paymentPill = paymentPillKind;
  readonly fulfillmentPill = fulfillmentPillKind;

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
        this._orders.update((all) => all.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
        this.active.set(full);
      })
      .catch(() => {});
  };

  onOrderUpdated(updated: Order): void {
    this._orders.update((all) => all.map((x) => (x.id === updated.id ? updated : x)));
    this.active.set(updated);
  }

  setDateRange(range: 'all' | 'today' | 'week' | 'month' | 'custom'): void {
    this.dateRange.set(range);
    this.page.set(0);
  }

  dateRangeLabel(): string {
    switch (this.dateRange()) {
      case 'today': return 'Today';
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'custom': {
        const f = this.dateFrom(); const t = this.dateTo();
        if (f && t) return `${f} – ${t}`;
        if (f) return `From ${f}`;
        return 'Custom range';
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
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(0);
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
      this._orders.update((all) => all.map((x) => (x.id === o.id ? { ...x, ...updated } : x)));
      this.toast.success('Order marked as shipped', `${o.id} · ${o.customer}`, {
        label: 'View',
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
      const orders = this.filtered();
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
      this.toast.success('Export downloaded', `${orders.length} order${orders.length !== 1 ? 's' : ''} · CSV`);
    } finally {
      this.exporting.set(false);
    }
  }
}
