import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
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
})
export class OrdersComponent implements OnInit {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly ordersApi = inject(AdminOrdersService);

  readonly t = (k: string): string => this.i18n.t(k);

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.ordersApi.list();
      this._orders.set(list);
    } catch {
      this._orders.set([]);
    } finally {
      this.loading.set(false);
    }

    // Deep-link from customer drawer: ?id=EC-26-1042 auto-opens that order.
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      const target = this._orders().find((o) => o.id === id);
      if (target) this.active.set(target);
    }
  }

  readonly QAR = QAR;
  readonly active = signal<Order | null>(null);
  readonly search = signal('');
  readonly paymentFilter = signal('all');
  readonly fulfillmentFilter = signal('all');
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
    return this._orders().filter((o) => {
      if (p !== 'all' && o.payment !== p) return false;
      if (f !== 'all' && o.fulfillment !== f) return false;
      if (q && !(o.id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q))) return false;
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

  openOrder = (o: Order): void => { this.active.set(o); };

  onOrderUpdated(updated: Order): void {
    this._orders.update((all) => all.map((x) => (x.id === updated.id ? updated : x)));
    this.active.set(updated);
  }

  clearFilters(): void {
    this.search.set('');
    this.paymentFilter.set('all');
    this.fulfillmentFilter.set('all');
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
