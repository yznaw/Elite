import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { ORDERS, PRODUCTS, REVENUE_30D } from '../../data/mock';
import { Order, Product, QAR } from '../../models';

@Component({
  selector: 'ap-dashboard',
  standalone: true,
  imports: [CommonModule, KpiComponent, LineChartComponent, SortableTableComponent, CellTplDirective, PillComponent],
  template: `
    <div class="page-fade">
      <div class="kpi-grid mb-24">
        <ap-kpi
          label="Today's Revenue"
          [value]="QAR(todayRev)"
          [delta]="absDelta.toFixed(1) + '%'"
          [deltaUp]="delta >= 0"
          icon="chart"
          [sparkData]="last14Rev"/>
        <ap-kpi label="Active Orders" value="34" delta="6 vs yesterday" [deltaUp]="true" icon="orders" [sparkData]="[18,22,28,21,24,30,34]"/>
        <ap-kpi label="New Customers" value="12" delta="2.4%" [deltaUp]="true" icon="users" [sparkData]="[5,8,6,9,10,11,12]"/>
        <ap-kpi label="Top 3D Views" value="1,532" delta="Nike Air Max 90" [deltaUp]="true" icon="cube" [sparkData]="[920,1080,1140,1280,1310,1420,1532]"/>
      </div>

      <div class="grid-2 mb-24" style="grid-template-columns: 1.6fr 1fr;">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Revenue · Last 30 days</div>
              <div class="card-sub">{{ totalRevText }} total · 30 days</div>
            </div>
            <div class="row gap-sm small">
              <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>Revenue</span>
            </div>
          </div>
          <div class="card-pad" style="padding-top:6px;">
            <ap-line-chart [data]="rev30" valueKey="rev" [formatY]="formatRev"/>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">3D Interaction Heatmap</div>
              <div class="card-sub">Most-viewed models · last 7 days</div>
            </div>
          </div>
          <div class="card-pad">
            @for (p of heatTop; track p.id) {
              <div class="heat-row">
                <div class="heat-thumb"><img [src]="p.image" [alt]="p.name" (error)="onImgError($event)"/></div>
                <div class="heat-info">
                  <div class="heat-title">{{ p.name }}</div>
                  <div class="heat-meta">{{ p.brand }} · {{ p.category }}</div>
                </div>
                <div class="heat-bar"><div class="heat-bar-fill" [style.width.%]="(p.views3d / maxViews) * 100"></div></div>
                <div class="heat-count">{{ p.views3d }}</div>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Recent Orders</div>
            <div class="card-sub">Latest 5 orders across all channels</div>
          </div>
          <button class="btn btn-outline btn-sm">View All</button>
        </div>
        <ap-sortable-table [columns]="orderColumns" [rows]="recentOrders">
          <ng-template apCellTpl="id" let-r><span class="strong">{{ r.id }}</span></ng-template>
          <ng-template apCellTpl="product" let-r>{{ productSummary(r) }}</ng-template>
          <ng-template apCellTpl="size" let-r>{{ sizeSummary(r) }}</ng-template>
          <ng-template apCellTpl="fulfillment" let-r>
            <ap-pill [kind]="fulfillment(r.fulfillment).kind">{{ fulfillment(r.fulfillment).label }}</ap-pill>
          </ng-template>
          <ng-template apCellTpl="total" let-r><span class="strong">{{ QAR(r.total) }}</span></ng-template>
        </ap-sortable-table>
      </div>
    </div>
  `,
})
export class DashboardComponent {
  readonly QAR = QAR;
  readonly rev30 = REVENUE_30D as unknown as Array<Record<string, unknown>>;
  readonly recentOrders = ORDERS.slice(0, 5);

  readonly todayRev = REVENUE_30D[REVENUE_30D.length - 1].rev;
  readonly yestRev = REVENUE_30D[REVENUE_30D.length - 2].rev;
  readonly delta = ((this.todayRev - this.yestRev) / this.yestRev) * 100;
  readonly absDelta = Math.abs(this.delta);
  readonly last14Rev = REVENUE_30D.slice(-14).map((d) => d.rev);
  readonly totalRevText = QAR(REVENUE_30D.reduce((s, d) => s + d.rev, 0));

  readonly heatTop: Product[] = [...PRODUCTS].sort((a, b) => b.views3d - a.views3d).slice(0, 6);
  readonly maxViews = this.heatTop[0]?.views3d || 1;

  readonly orderColumns: TableColumn<Order>[] = [
    { key: 'id', label: 'Order ID' },
    { key: 'customer', label: 'Customer' },
    { key: 'product', label: 'Product', noSort: true },
    { key: 'size', label: 'Size', noSort: true, align: 'center' },
    { key: 'fulfillment', label: 'Status' },
    { key: 'total', label: 'Amount', align: 'right' },
  ];

  formatRev = (v: number): string => 'QAR ' + (v / 1000).toFixed(0) + 'k';
  fulfillment = fulfillmentPillKind;

  productSummary(r: Order): string {
    const first = r.items[0]?.n ?? '';
    return r.items.length > 1 ? `${first} +${r.items.length - 1}` : first;
  }

  sizeSummary(r: Order): string {
    return r.items.length > 0 ? `EU ${r.items[0].s}` : '';
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
