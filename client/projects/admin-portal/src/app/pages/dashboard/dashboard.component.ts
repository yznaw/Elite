import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { I18nService } from '../../services/i18n.service';
import { ORDERS, PRODUCTS, REVENUE_30D } from '../../data/mock';
import { Order, Product, QAR } from '../../models';

@Component({
  selector: 'ap-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, KpiComponent, LineChartComponent, SortableTableComponent, CellTplDirective, PillComponent],
  template: `
    <div class="page-fade">
      <div class="kpi-grid mb-24">
        <ap-kpi
          [label]="t('dash.todayRevenue')"
          [value]="QAR(todayRev)"
          [delta]="absDelta.toFixed(1) + '%'"
          [deltaUp]="delta >= 0"
          icon="chart"
          [sparkData]="last14Rev"/>
        <ap-kpi [label]="t('dash.activeOrders')" value="34" [delta]="t('dash.activeOrders.delta')" [deltaUp]="true" icon="orders" [sparkData]="[18,22,28,21,24,30,34]"/>
        <ap-kpi [label]="t('dash.newCustomers')" value="12" delta="2.4%" [deltaUp]="true" icon="users" [sparkData]="[5,8,6,9,10,11,12]"/>
        <ap-kpi [label]="t('dash.top3DViews')" value="1,532" delta="Nike Air Max 90" [deltaUp]="true" icon="cube" [sparkData]="[920,1080,1140,1280,1310,1420,1532]"/>
      </div>

      <div class="dashboard-charts mb-24">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('dash.revenue.title') }}</div>
              <div class="card-sub">{{ totalRevText }} {{ t('dash.revenue.totalSuffix') }} · 30 {{ t('dash.revenue.daysSuffix') }}</div>
            </div>
            <div class="row gap-sm small">
              <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>{{ t('dash.revenue.legend') }}</span>
            </div>
          </div>
          <div class="card-pad" style="padding-top:6px;">
            <ap-line-chart [data]="rev30" valueKey="rev" [formatY]="formatRev"/>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('dash.heatmap.title') }}</div>
              <div class="card-sub">{{ t('dash.heatmap.sub') }}</div>
            </div>
          </div>
          <div class="card-pad">
            @for (p of heatTop; track p.id) {
              <div class="heat-row">
                <div class="heat-thumb"><img [src]="p.image" [alt]="p.name" (error)="onImgError($event)"/></div>
                <div class="heat-info">
                  <div class="heat-title">{{ p.name }}</div>
                  <div class="heat-meta">{{ p.brand }} · {{ p.sku }}</div>
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
            <div class="card-title">{{ t('dash.recent.title') }}</div>
            <div class="card-sub">{{ t('dash.recent.sub') }}</div>
          </div>
          <button class="btn btn-outline btn-sm" routerLink="/orders">{{ t('common.viewAll') }}</button>
        </div>
        <ap-sortable-table [columns]="orderColumns" [rows]="recentOrders">
          <ng-template apCellTpl="id" let-r><span class="strong">{{ r.id }}</span></ng-template>
          <ng-template apCellTpl="product" let-r>{{ productSummary(r) }}</ng-template>
          <ng-template apCellTpl="size" let-r>{{ sizeSummary(r) }}</ng-template>
          <ng-template apCellTpl="fulfillment" let-r>
            <ap-pill [kind]="fulfillment(r.fulfillment).kind">{{ t(fulfillment(r.fulfillment).labelKey) }}</ap-pill>
          </ng-template>
          <ng-template apCellTpl="total" let-r><span class="strong">{{ QAR(r.total) }}</span></ng-template>
        </ap-sortable-table>
      </div>
    </div>
  `,
})
export class DashboardComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

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
    { key: 'id',          label: 'Order ID', labelKey: 'orders.col.id' },
    { key: 'customer',    label: 'Customer', labelKey: 'orders.col.customer' },
    { key: 'product',     label: 'Product',  labelKey: 'dash.product', noSort: true },
    { key: 'size',        label: 'Size',     labelKey: 'dash.size', noSort: true, align: 'center' },
    { key: 'fulfillment', label: 'Status',   labelKey: 'dash.status' },
    { key: 'total',       label: 'Amount',   labelKey: 'dash.amount', align: 'right' },
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
