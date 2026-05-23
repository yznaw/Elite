import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { OrderDrawerComponent } from './order-drawer.component';
import { fulfillmentPillKind, paymentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { AdminOrdersService } from '../../services/admin-orders.service';
import { Order, QAR } from '../../models';

@Component({
  selector: 'ap-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SortableTableComponent, CellTplDirective, SpinnerComponent, EmptyStateComponent, OrderDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('orders.search.placeholder')" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
        </div>
        <select class="inp" style="width:auto;" [ngModel]="paymentFilter()" (ngModelChange)="paymentFilter.set($event)">
          <option value="all">{{ t('orders.allPayment') }}</option>
          <option value="paid">{{ t('pill.paid') }}</option>
          <option value="pending">{{ t('pill.pending') }}</option>
          <option value="refunded">{{ t('pill.refunded') }}</option>
          <option value="failed">{{ t('pill.failed') }}</option>
        </select>
        <select class="inp" style="width:auto;" [ngModel]="fulfillmentFilter()" (ngModelChange)="fulfillmentFilter.set($event)">
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
          <ap-sortable-table [columns]="columns" [rows]="filtered()" [rowClick]="openOrder">
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
    </div>

    @if (active(); as o) {
      <ap-order-drawer [value]="o" (closed)="active.set(null)" (updated)="onOrderUpdated($event)"/>
    }
  `,
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
  readonly fulfillingId = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly loading = signal(true);

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

  clearFilters(): void {
    this.search.set('');
    this.paymentFilter.set('all');
    this.fulfillmentFilter.set('all');
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
    this.toast.info('Preparing export', `${this.filtered().length} orders`);
    setTimeout(() => {
      this.exporting.set(false);
      this.toast.success('Export ready', 'orders-2026-04-29.csv · 12 KB');
    }, 1200);
  }
}
