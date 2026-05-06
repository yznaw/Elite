import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { OrderModalComponent } from './order-modal.component';
import { fulfillmentPillKind, paymentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { ORDERS } from '../../data/mock';
import { Order, QAR } from '../../models';

@Component({
  selector: 'ap-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SortableTableComponent, CellTplDirective, SpinnerComponent, EmptyStateComponent, OrderModalComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" placeholder="Search by order ID or customer…" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
        </div>
        <select class="inp" style="width:auto;" [ngModel]="paymentFilter()" (ngModelChange)="paymentFilter.set($event)">
          <option value="all">All Payment</option><option value="paid">Paid</option><option value="pending">Pending</option>
          <option value="refunded">Refunded</option><option value="failed">Failed</option>
        </select>
        <select class="inp" style="width:auto;" [ngModel]="fulfillmentFilter()" (ngModelChange)="fulfillmentFilter.set($event)">
          <option value="all">All Fulfillment</option><option value="awaiting">Awaiting</option><option value="processing">Processing</option>
          <option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="returned">Returned</option>
        </select>
        <button class="btn btn-outline" [disabled]="exporting()" (click)="exportCsv()">
          @if (exporting()) {
            <ap-spinner/> Exporting…
          } @else {
            Export CSV
          }
        </button>
      </div>

      <div class="card">
        @if (filtered().length === 0) {
          <ap-empty-state icon="orders" title="No orders match these filters"
            sub="Try clearing the search or filters above to see all orders.">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">Clear filters</button>
          </ap-empty-state>
        } @else {
          <ap-sortable-table [columns]="columns" [rows]="filtered()" [rowClick]="openOrder">
            <ng-template apCellTpl="id" let-r>
              <span class="strong" style="color:var(--green);">{{ r.id }}</span>
            </ng-template>
            <ng-template apCellTpl="itemsCount" let-r>
              <span class="muted">{{ r.itemsCount }}</span>
            </ng-template>
            <ng-template apCellTpl="total" let-r>
              <span class="strong">{{ QAR(r.total) }}</span>
            </ng-template>
            <ng-template apCellTpl="payment" let-r>
              <ap-pill [kind]="paymentPill(r.payment).kind">{{ paymentPill(r.payment).label }}</ap-pill>
            </ng-template>
            <ng-template apCellTpl="fulfillment" let-r>
              <ap-pill [kind]="fulfillmentPill(r.fulfillment).kind">{{ fulfillmentPill(r.fulfillment).label }}</ap-pill>
            </ng-template>
            <ng-template apCellTpl="actions" let-r>
              <div class="row gap-sm" style="justify-content:flex-end;">
                <button class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); openOrder(r)">View</button>
                @if (r.fulfillment === 'awaiting' || r.fulfillment === 'processing') {
                  <button class="btn btn-outline btn-sm" [disabled]="fulfillingId() === r.id"
                    (click)="$event.stopPropagation(); markFulfilled(r)">
                    @if (fulfillingId() === r.id) {
                      <ap-spinner [size]="12"/> Working…
                    } @else {
                      Mark Fulfilled
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
      <ap-order-modal [order]="o" (closed)="active.set(null)"/>
    }
  `,
})
export class OrdersComponent {
  private readonly toast = inject(ToastService);

  readonly QAR = QAR;
  readonly active = signal<Order | null>(null);
  readonly search = signal('');
  readonly paymentFilter = signal('all');
  readonly fulfillmentFilter = signal('all');
  readonly fulfillingId = signal<string | null>(null);
  readonly exporting = signal(false);

  private readonly _orders = signal<Order[]>([...ORDERS]);

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
    { key: 'id', label: 'Order ID' },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'itemsCount', label: 'Items', align: 'center' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'payment', label: 'Payment' },
    { key: 'fulfillment', label: 'Fulfillment' },
    { key: 'actions', label: '', noSort: true, align: 'right' },
  ];

  openOrder = (o: Order): void => { this.active.set(o); };

  clearFilters(): void {
    this.search.set('');
    this.paymentFilter.set('all');
    this.fulfillmentFilter.set('all');
  }

  markFulfilled(o: Order): void {
    if (this.fulfillingId() === o.id) return;
    this.fulfillingId.set(o.id);
    setTimeout(() => {
      this._orders.update((all) => all.map((x) => (x.id === o.id ? { ...x, fulfillment: 'shipped' as const } : x)));
      this.fulfillingId.set(null);
      this.toast.success('Order marked as shipped', `${o.id} · ${o.customer}`, {
        label: 'View',
        run: () => this.openOrder({ ...o, fulfillment: 'shipped' }),
      });
    }, 900);
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
