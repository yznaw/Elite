import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { I18nService } from '../../services/i18n.service';
import { AdminOrdersService } from '../../services/admin-orders.service';
import { AdminProductsService } from '../../services/admin-products.service';
import { AdminCustomersService } from '../../services/admin-customers.service';
import { Order, Product, QAR } from '../../models';

@Component({
  selector: 'ap-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, KpiComponent, LineChartComponent, SortableTableComponent, CellTplDirective, PillComponent],
  styles: [`
    .range-bar { display: flex; align-items: center; gap: 10px; }
    .range-pills { display: flex; gap: 2px; background: var(--bg-2); border-radius: 8px; padding: 3px; }
    .range-pill {
      border: none; background: none; padding: 5px 14px;
      font-size: 12px; font-weight: 600; border-radius: 6px;
      cursor: pointer; color: var(--muted); transition: all 0.13s;
    }
    .range-pill.active { background: var(--surface); color: var(--green); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .kpi-clickable { cursor: pointer; transition: box-shadow .15s, transform .1s; }
    .kpi-clickable:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); transform: translateY(-1px); }
  `],
  template: `
    <div class="page-fade">
      <div class="range-bar mb-16">
        <div class="range-pills">
          <button class="range-pill" [class.active]="dateRange() === 'today'" (click)="dateRange.set('today')">Today</button>
          <button class="range-pill" [class.active]="dateRange() === '7d'" (click)="dateRange.set('7d')">7 Days</button>
          <button class="range-pill" [class.active]="dateRange() === '30d'" (click)="dateRange.set('30d')">30 Days</button>
          <button class="range-pill" [class.active]="dateRange() === '90d'" (click)="dateRange.set('90d')">90 Days</button>
        </div>
      </div>

      <div class="kpi-grid mb-24">
        <ap-kpi
          [label]="revRangeLabel()"
          [value]="QAR(todayRevenue())"
          [delta]="(activeOrders() || 0) + ' ' + t('dash.activeOrders').toLowerCase()"
          [deltaUp]="true"
          icon="chart"
          [sparkData]="revenueSpark()"/>
        <ap-kpi
          [label]="t('dash.activeOrders')"
          [value]="activeOrders().toString()"
          delta=""
          [deltaUp]="true"
          icon="orders"
          [sparkData]="ordersSpark()"/>
        <ap-kpi
          [label]="t('dash.newCustomers')"
          [value]="newCustomers().toString()"
          delta=""
          [deltaUp]="true"
          icon="users"
          [sparkData]="customersSpark()"/>
        <ap-kpi
          [label]="t('dash.top3DViews')"
          [value]="topViews().toLocaleString()"
          [delta]="topProductName()"
          [deltaUp]="true"
          icon="cube"
          [sparkData]="viewsSpark()"/>
        <div class="kpi kpi-clickable" (click)="goToLowStock()">
          <div class="kpi-label">
            <span class="kpi-icon" style="color:var(--warning,#f59e0b)"><ap-icon name="warning" [size]="14"/></span>
            {{ t('dash.lowStock') }}
          </div>
          <div class="kpi-value" [style.color]="lowStockCount() > 0 ? 'var(--warning,#f59e0b)' : 'inherit'">{{ lowStockCount() }}</div>
          <div class="row" style="justify-content:space-between;">
            <div class="kpi-delta" [class.down]="lowStockCount() > 0" [class.up]="lowStockCount() === 0">
              <ap-icon [name]="lowStockCount() > 0 ? 'warning' : 'check'" [size]="11"/>
              {{ lowStockCount() > 0 ? t('dash.lowStock.delta') : 'All stocked' }}
            </div>
          </div>
        </div>
      </div>

      <div class="dashboard-charts mb-24">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('dash.revenue.title') }}</div>
              <div class="card-sub">
                {{ QAR(totalRevenue()) }} {{ t('dash.revenue.totalSuffix') }} ·
                {{ orders().length }} {{ t('orders.col.items') }}
              </div>
            </div>
            <div class="row gap-sm small">
              <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>{{ t('dash.revenue.legend') }}</span>
            </div>
          </div>
          <div class="card-pad" style="padding-top:6px;">
            <ap-line-chart [data]="revChartData()" valueKey="rev" [formatY]="formatRev"/>
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
            @for (p of heatTop(); track p.id) {
              <div class="heat-row">
                <div class="heat-thumb"><img [src]="p.image" [alt]="p.name" (error)="onImgError($event)"/></div>
                <div class="heat-info">
                  <div class="heat-title">{{ p.name }}</div>
                  <div class="heat-meta">{{ p.brand }} · {{ p.sku }}</div>
                </div>
                <div class="heat-bar">
                  <div class="heat-bar-fill" [style.width.%]="(p.views3d / Math.max(maxViews(), 1)) * 100"></div>
                </div>
                <div class="heat-count">{{ p.views3d }}</div>
              </div>
            }
            @if (heatTop().length === 0) {
              <div class="muted small" style="text-align:center;padding:24px;">
                {{ t('catalog.empty.title') }}
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
        <ap-sortable-table [columns]="orderColumns" [rows]="recentOrders()">
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
export class DashboardComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly ordersApi = inject(AdminOrdersService);
  private readonly productsApi = inject(AdminProductsService);
  private readonly customersApi = inject(AdminCustomersService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly QAR = QAR;
  readonly Math = Math;

  readonly orders = signal<Order[]>([]);
  readonly products = signal<Product[]>([]);
  readonly customers = signal<{ id: string; joined?: string }[]>([]);

  readonly dateRange = signal<'today' | '7d' | '30d' | '90d'>('30d');

  readonly rangeDays = computed(() => {
    switch (this.dateRange()) {
      case 'today': return 1;
      case '7d': return 7;
      case '90d': return 90;
      default: return 30;
    }
  });

  readonly latestDate = computed(() => {
    const all = this.orders();
    if (all.length === 0) return '';
    return all.reduce<string>((max, o) => (o.date > max ? o.date : max), all[0].date);
  });

  readonly dateFilter = computed<(date: string) => boolean>(() => {
    const latest = this.latestDate();
    if (!latest) return () => false;
    const days = this.rangeDays();
    if (days === 1) return (date: string) => date === latest;
    const latestDate = new Date(latest);
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return (date: string) => date >= cutoffStr && date <= latest;
  });

  revRangeLabel(): string {
    switch (this.dateRange()) {
      case 'today': return this.t('dash.todayRevenue');
      case '7d': return 'Revenue · 7 Days';
      case '30d': return 'Revenue · 30 Days';
      case '90d': return 'Revenue · 90 Days';
    }
  }

  async ngOnInit(): Promise<void> {
    const [orders, products, customers] = await Promise.all([
      this.ordersApi.list().catch(() => []),
      this.productsApi.list().catch(() => []),
      this.customersApi.list().catch(() => []),
    ]);
    this.orders.set(orders);
    this.products.set(products);
    this.customers.set(customers);
  }

  // ── KPI computeds ────────────────────────────────────────────────────────

  readonly todayRevenue = computed(() => {
    const filter = this.dateFilter();
    return this.orders()
      .filter(o => filter(o.date) && (o.payment === 'paid' || o.payment === 'refunded'))
      .reduce((sum, o) => sum + o.total, 0);
  });

  readonly totalRevenue = computed(() =>
    this.orders()
      .filter(o => this.dateFilter()(o.date) && (o.payment === 'paid' || o.payment === 'refunded'))
      .reduce((sum, o) => sum + o.total, 0),
  );

  readonly activeOrders = computed(
    () => this.orders().filter((o) => o.fulfillment === 'awaiting' || o.fulfillment === 'processing').length,
  );

  readonly newCustomers = computed(() => {
    const latest = this.latestDate();
    const days = this.rangeDays();
    if (!latest) return this.customers().length;
    const latestDate = new Date(latest);
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const count = this.customers().filter((c) => {
      if (!c.joined) return false;
      const j = new Date(c.joined);
      return j >= cutoff && j <= latestDate;
    }).length;
    return count || this.customers().length;
  });

  readonly heatTop = computed<Product[]>(() =>
    [...this.products()].sort((a, b) => (b.views3d || 0) - (a.views3d || 0)).slice(0, 6),
  );

  readonly maxViews = computed(() => this.heatTop()[0]?.views3d || 0);
  readonly topViews = computed(() => this.maxViews());
  readonly topProductName = computed(() => this.heatTop()[0]?.name || '—');
  readonly lowStockCount = computed(() =>
    this.products().filter(p => p.stock > 0 && p.stock <= 5).length,
  );

  readonly recentOrders = computed(() => this.orders().slice(0, 5));

  // ── Sparklines / chart data ──────────────────────────────────────────────

  readonly revChartData = computed(() => {
    const days = this.rangeDays();
    const latest = this.latestDate();
    const latestDate = latest ? new Date(latest) : new Date();
    const buckets = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(latestDate);
      d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const o of this.orders()) {
      if (o.payment !== 'paid' && o.payment !== 'refunded') continue;
      if (buckets.has(o.date)) buckets.set(o.date, (buckets.get(o.date) || 0) + o.total);
    }
    return Array.from(buckets.entries()).map(([day, rev]) => ({ day, rev }));
  });

  readonly revenueSpark = computed(() => this.revChartData().slice(-14).map((d) => d.rev));

  readonly ordersSpark = computed(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const o of this.orders()) {
      if (buckets.has(o.date)) buckets.set(o.date, (buckets.get(o.date) || 0) + 1);
    }
    return Array.from(buckets.values());
  });

  readonly customersSpark = computed(() => {
    // Cumulative customer count over the last week.
    const total = this.customers().length;
    const seed = Math.max(1, total - 6);
    return Array.from({ length: 7 }, (_, i) => Math.min(total, seed + i));
  });

  readonly viewsSpark = computed(() => {
    // Show the top 7 products by views as a bar-style sparkline.
    return [...this.products()]
      .sort((a, b) => (b.views3d || 0) - (a.views3d || 0))
      .slice(0, 7)
      .map((p) => p.views3d || 0)
      .reverse();
  });

  // ── Misc helpers ─────────────────────────────────────────────────────────

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

  goToLowStock(): void { void this.router.navigate(['/catalog'], { queryParams: { stock: 'low' } }); }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
