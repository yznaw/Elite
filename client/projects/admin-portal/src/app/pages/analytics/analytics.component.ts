import { Component, OnInit, computed, inject, signal } from '@angular/core';
// import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { PieChartComponent } from '../../shared/charts/pie-chart.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { AdminAnalyticsService } from '../../services/admin-analytics.service';
import { QAR } from '../../models';
import { ApiClient } from '../../services/api-client.service';
import { I18nService } from '../../services/i18n.service';

interface CostCatalog {
  variantsWithCost: number;
  avgCost: number | null;
  avgShipping: number | null;
  avgTotalCost: number | null;
  avgPrice: number | null;
  avgMarginPct: number | null;
}

interface CostProduct {
  productId: string;
  name: string;
  variantCount: number;
  avgPrice: number;
  avgCost: number;
  avgShipping: number;
  avgTotalCost: number;
  marginPct: number;
}

interface CostSummary {
  catalog: CostCatalog;
  products: CostProduct[];
}

@Component({
  selector: 'ap-analytics',
  standalone: true,
  imports: [CommonModule, KpiComponent, LineChartComponent, BarChartComponent, PieChartComponent, EmptyStateComponent],
  styles: [`
    /* Range filter row: horizontal scroll on phone instead of wrapping */
    .range-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 640px) {
      .range-row { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; gap: 6px; }
      .range-row::-webkit-scrollbar { display: none; }
      .range-row .btn { flex-shrink: 0; white-space: nowrap; }
    }
    /* Event breakdown: pie + legend side-by-side on desktop, stacked on phone */
    .split-inner { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; }
    @media (max-width: 600px) {
      .split-inner { grid-template-columns: 1fr; justify-items: center; }
      .split-inner > div { width: 100%; }
    }
    .rank-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-2); }
    .rank-row:last-child { border-bottom: 0; }
    .rank-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .section-label { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }

    /* Cost & Margin section */
    .cost-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    @media (max-width: 860px) { .cost-kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 480px) { .cost-kpi-grid { grid-template-columns: 1fr 1fr; } }

    .cost-kpi { background: var(--surface-2, #fafafa); border: 1px solid var(--border, #e4e4e7); border-radius: 10px; padding: 14px 16px; }
    .cost-kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 6px; }
    .cost-kpi-val { font-size: 22px; font-weight: 800; line-height: 1; }
    .cost-kpi-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

    /* Margin table */
    .margin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .margin-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; white-space: nowrap; }
    .margin-table td { padding: 9px 10px; border-bottom: 1px solid rgba(0,0,0,.04); vertical-align: middle; }
    .margin-table tbody tr:last-child td { border-bottom: none; }
    .margin-table tbody tr:hover td { background: var(--surface-2, #fafafa); }

    .margin-bar-wrap { display: flex; align-items: center; gap: 8px; }
    .margin-bar-bg { flex: 1; height: 6px; background: rgba(0,0,0,.07); border-radius: 99px; overflow: hidden; min-width: 60px; }
    .margin-bar-fill { height: 100%; border-radius: 99px; transition: width .3s ease; }
    .bar-green  { background: #16a34a; }
    .bar-amber  { background: #d97706; }
    .bar-red    { background: #dc2626; }
    .margin-pct-val { font-size: 12px; font-weight: 700; width: 38px; text-align: right; flex-shrink: 0; }
    .pct-green  { color: #16a34a; }
    .pct-amber  { color: #d97706; }
    .pct-red    { color: #dc2626; }

    .mono { font-variant-numeric: tabular-nums; }
    .section-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .section-sub   { font-size: 12px; color: var(--muted); margin-bottom: 16px; }
    .cost-loading  { display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--muted); font-size: 13px; }
    .table-wrap { overflow-x: auto; }
    .sort-btn { background: none; border: none; cursor: pointer; padding: 0 4px; opacity: .5; font-size: 10px; }
    .sort-btn.active { opacity: 1; color: var(--gold); }
  `],
  template: `
    <div class="page-fade">
      <div class="range-row mb-24">
        <div class="row gap-sm" style="flex-wrap:nowrap;">
          @for (r of ranges(); track r.key) {
            <button class="btn" [class.btn-primary]="range() === r.key" [class.btn-outline]="range() !== r.key" (click)="select(r.key)">{{ r.label }}</button>
          }
        </div>
        @if (svc.loading()) {
          <span class="muted small" style="flex-shrink:0;">{{ t('common.loading') }}</span>
        }
      </div>

      <div class="section-label">{{ t('analytics.section.financial') }}</div>
      <div class="kpi-grid mb-24">
        <ap-kpi [label]="t('analytics.kpi.revenue')" [value]="money(d().financial.revenue)" [delta]="d().financial.totalOrders + ' ' + t('analytics.kpi.ordersTotal')" [deltaUp]="true" icon="store"/>
        <ap-kpi [label]="t('analytics.kpi.paidOrders')" [value]="fmtNum(d().financial.orders)" [delta]="t('analytics.kpi.paid')" [deltaUp]="true" icon="orders"/>
        <ap-kpi [label]="t('analytics.kpi.avgOrderValue')" [value]="money(d().financial.aov)" [delta]="t('analytics.kpi.perOrder')" [deltaUp]="true" icon="cube"/>
        <ap-kpi [label]="t('analytics.kpi.conversionRate')" [value]="d().financial.conversionRate + '%'" [delta]="t('analytics.kpi.ordersSessions')" [deltaUp]="true" icon="chart"/>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div><div class="card-title">{{ t('analytics.card.revenue') }}</div><div class="card-sub">{{ t('analytics.card.daily') }} · {{ activeLabel() }}</div></div>
        </div>
        <div class="card-pad">
          @if (revenueSeries().length > 0) {
            <ap-line-chart [data]="revenueSeries()" valueKey="revenue" [formatY]="money" [xLabel]="xLabel"/>
          } @else {
            <ap-empty-state icon="store" [title]="t('analytics.card.revenueEmpty')" [sub]="t('analytics.card.revenueEmptySub')"/>
          }
        </div>
      </div>

      <div class="section-label">{{ t('analytics.section.behavior') }}</div>
      <div class="kpi-grid mb-24">
        <ap-kpi [label]="t('analytics.kpi.visitors')" [value]="fmtNum(d().kpis.visitors)" [delta]="t('analytics.kpi.unique')" [deltaUp]="true" icon="users"/>
        <ap-kpi [label]="t('analytics.kpi.sessions')" [value]="fmtNum(d().kpis.sessions)" [delta]="d().kpis.pagesPerSession + ' ' + t('analytics.kpi.pagesPerSession')" [deltaUp]="true" icon="team"/>
        <ap-kpi [label]="t('analytics.kpi.pageViews')" [value]="fmtNum(d().kpis.pageviews)" [delta]="t('analytics.kpi.total')" [deltaUp]="true" icon="eye"/>
        <ap-kpi [label]="t('analytics.kpi.clicks')" [value]="fmtNum(d().kpis.clicks)" [delta]="t('analytics.kpi.tracked')" [deltaUp]="true" icon="cube"/>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div>
            <div class="card-title">{{ t('analytics.card.sessionsClicks') }}</div>
            <div class="card-sub">{{ t('analytics.card.daily') }} · {{ activeLabel() }}</div>
          </div>
          <div class="row gap-sm small">
            <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>{{ t('analytics.legend.sessions') }}</span>
            <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--gold);border-top:1px dashed var(--gold);"></span>{{ t('analytics.legend.clicks') }}</span>
          </div>
        </div>
        <div class="card-pad">
          @if (series().length > 0) {
            <ap-line-chart [data]="series()" valueKey="sessions" secondKey="clicks" [formatY]="fmtNum" [xLabel]="xLabel"/>
          } @else {
            <ap-empty-state icon="chart" [title]="t('analytics.card.activityEmpty')" [sub]="t('analytics.card.activityEmptySub')"/>
          }
        </div>
      </div>

      <div class="grid-2 mb-24">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('analytics.card.trafficSources') }}</div>
              <div class="card-sub">{{ t('analytics.card.byReferrer') }} · {{ activeLabel() }}</div>
            </div>
          </div>
          <div class="card-pad split-inner">
            @if (traffic().length > 0) {
              <ap-pie-chart [data]="traffic()"/>
              <div>
                @for (tr of traffic(); track tr.source) {
                  <div class="rank-row">
                    <span [style.background]="tr.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                    <span class="grow strong">{{ tr.source }}</span>
                    <span class="muted">{{ tr.pct }}%</span>
                    <span class="strong" style="width:60px;text-align:right;">{{ tr.count.toLocaleString() }}</span>
                  </div>
                }
              </div>
            } @else {
              <ap-empty-state icon="users" [title]="t('analytics.card.trafficEmpty')" [sub]="t('analytics.card.trafficEmptySub')"/>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('analytics.card.eventBreakdown') }}</div>
              <div class="card-sub">{{ t('analytics.card.byType') }} · {{ activeLabel() }}</div>
            </div>
          </div>
          <div class="card-pad split-inner">
            @if (eventTypes().length > 0) {
              <ap-pie-chart [data]="eventTypes()"/>
              <div>
                @for (ev of eventTypes(); track ev.source) {
                  <div class="rank-row">
                    <span [style.background]="ev.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                    <span class="grow strong">{{ ev.source }}</span>
                    <span class="muted">{{ ev.pct }}%</span>
                    <span class="strong" style="width:60px;text-align:right;">{{ ev.count.toLocaleString() }}</span>
                  </div>
                }
              </div>
            } @else {
              <ap-empty-state icon="chart" [title]="t('analytics.card.eventsEmpty')" [sub]="t('analytics.card.eventsEmptySub')"/>
            }
          </div>
        </div>
      </div>

      <div class="grid-2 mb-24">
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">{{ t('analytics.card.topPages') }}</div><div class="card-sub">{{ t('analytics.card.byPageViews') }}</div></div>
          </div>
          <div class="card-pad">
            @if (d().topPages.length > 0) {
              <ap-bar-chart [data]="d().topPages"/>
            } @else {
              <ap-empty-state icon="chart" [title]="t('analytics.card.topPagesEmpty')"/>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div><div class="card-title">{{ t('analytics.card.mostClicked') }}</div><div class="card-sub">{{ t('analytics.card.trackedElements') }}</div></div>
          </div>
          <div class="card-pad">
            @if (d().topClicks.length > 0) {
              @for (c of d().topClicks; track c.label) {
                <div class="rank-row">
                  <span class="rank-label strong">{{ c.label }}</span>
                  <span class="strong">{{ c.value.toLocaleString() }}</span>
                </div>
              }
            } @else {
              <ap-empty-state icon="cube" [title]="t('analytics.card.clicksEmpty')" [sub]="t('analytics.card.clicksEmptySub')"/>
            }
          </div>
        </div>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div><div class="card-title">{{ t('analytics.card.topProducts') }}</div><div class="card-sub">{{ t('analytics.card.byInteractions') }}</div></div>
        </div>
        <div class="card-pad">
          @if (d().topProducts.length > 0) {
            <ap-bar-chart [data]="d().topProducts"/>
          } @else {
            <ap-empty-state icon="cube" [title]="t('analytics.card.productsEmpty')" [sub]="t('analytics.card.productsEmptySub')"/>
          }
        </div>
      </div>

      <!-- ── Cost & Margin ─────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">{{ t('analytics.card.costMargin') }}</div>
            <div class="card-sub">{{ t('analytics.card.costMarginSub') }}</div>
          </div>
          <button class="btn btn-outline btn-sm" (click)="loadCostSummary()">{{ t('analytics.legend.refresh') }}</button>
        </div>
        <div class="card-pad">
          @if (costLoading()) {
            <div class="cost-loading">{{ t('analytics.card.costLoading') }}</div>
          } @else if (!costSummary() || costSummary()!.catalog.variantsWithCost === 0) {
            <ap-empty-state icon="cube" [title]="t('analytics.card.costEmpty')"
              [sub]="t('analytics.card.costEmptySub')"/>
          } @else {
            <!-- KPI row -->
            <div class="cost-kpi-grid">
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.cost.avgProductCost') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgCost) }}</div>
                <div class="cost-kpi-sub">{{ t('analytics.cost.materialPerVariant') }}</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.cost.avgShippingCost') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgShipping) }}</div>
                <div class="cost-kpi-sub">{{ t('analytics.cost.shippingPerVariant') }}</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.cost.avgTotalCost') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgTotalCost) }}</div>
                <div class="cost-kpi-sub">{{ t('analytics.cost.costShippingCombined') }}</div>
              </div>
              <div class="cost-kpi" [style.border-color]="marginBorderColor(costSummary()!.catalog.avgMarginPct)">
                <div class="cost-kpi-label">{{ t('analytics.cost.avgGrossMargin') }}</div>
                <div class="cost-kpi-val" [class]="marginClass(costSummary()!.catalog.avgMarginPct)">
                  {{ costSummary()!.catalog.avgMarginPct | number:'1.1-1' }}%
                </div>
                <div class="cost-kpi-sub">{{ costSummary()!.catalog.variantsWithCost.toLocaleString() }} {{ t('analytics.cost.variantsWithCost') }}</div>
              </div>
            </div>

            <!-- Per-product margin table -->
            <div class="section-title">{{ t('analytics.marginByProduct') }}</div>
            <div class="section-sub">{{ t('analytics.marginSub') }}</div>
            <div class="table-wrap">
              <table class="margin-table">
                <thead>
                  <tr>
                    <th>{{ t('analytics.col.product') }}</th>
                    <th style="text-align:right;">{{ t('analytics.col.variants') }}</th>
                    <th style="text-align:right;">{{ t('analytics.col.avgPrice') }}</th>
                    <th style="text-align:right;">{{ t('analytics.col.avgCost') }}</th>
                    <th style="text-align:right;">{{ t('analytics.col.avgShipping') }}</th>
                    <th style="text-align:right;">{{ t('analytics.col.avgTotalCost') }}</th>
                    <th style="min-width:160px;">{{ t('analytics.col.margin') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of costSummary()!.products; track p.productId) {
                    <tr>
                      <td class="strong">{{ p.name }}</td>
                      <td style="text-align:right;" class="muted small">{{ p.variantCount }}</td>
                      <td style="text-align:right;" class="mono">{{ fmtQAR(p.avgPrice) }}</td>
                      <td style="text-align:right;" class="mono muted">{{ fmtQAR(p.avgCost) }}</td>
                      <td style="text-align:right;" class="mono muted">{{ fmtQAR(p.avgShipping) }}</td>
                      <td style="text-align:right;" class="mono">{{ fmtQAR(p.avgTotalCost) }}</td>
                      <td>
                        <div class="margin-bar-wrap">
                          <div class="margin-bar-bg">
                            <div class="margin-bar-fill" [class]="marginBarClass(p.marginPct)"
                                 [style.width.%]="clampPct(p.marginPct)"></div>
                          </div>
                          <span class="margin-pct-val mono" [class]="marginClass(p.marginPct)">
                            {{ p.marginPct | number:'1.1-1' }}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>

    </div>
  `,
})
export class AnalyticsComponent implements OnInit {
  readonly svc = inject(AdminAnalyticsService);
  private readonly api = inject(ApiClient);
  private readonly i18n = inject(I18nService);

  readonly t = (k: string) => this.i18n.t(k);

  readonly ranges = computed(() => [
    { key: '7d',  label: this.t('analytics.range.7d') },
    { key: '30d', label: this.t('analytics.range.30d') },
    { key: '90d', label: this.t('analytics.range.90d') },
    { key: '1y',  label: this.t('analytics.range.1y') },
  ]);
  readonly range = signal('30d');

  readonly d = this.svc.data;
  readonly series = computed(() => this.d().series as unknown as Array<Record<string, unknown>>);
  readonly revenueSeries = computed(() => this.d().revenueSeries as unknown as Array<Record<string, unknown>>);
  readonly eventTypes = computed(() => this.d().eventTypes);
  readonly traffic = computed(() => this.d().traffic);
  readonly activeLabel = computed(() => this.ranges().find((r) => r.key === this.range())?.label ?? '');

  // ngOnInit(): void {
  //   void this.svc.load(this.range());
  // }

  /** Switch range and reload. */
  select(key: string): void {
    if (key === this.range()) return;
    this.range.set(key);
    void this.svc.load(key);
  }

  readonly costSummary = signal<CostSummary | null>(null);
  readonly costLoading = signal(false);
  readonly money = (v: number): string => QAR(v);
  readonly xLabel = (d: Record<string, unknown>): string => {
    const day = d['day'];
    if (typeof day !== 'string' || !day) return '';
    const parsed = new Date(day);
    return Number.isNaN(parsed.getTime())
      ? day
      : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  ngOnInit(): void {
    this.loadCostSummary();
  }

  loadCostSummary(): void {
    this.costLoading.set(true);
    this.api.get<CostSummary>('/admin/analytics/cost-summary').subscribe({
      next: data => { this.costSummary.set(data); this.costLoading.set(false); },
      error: ()  => { this.costLoading.set(false); },
    });
  }

  fmtNum = (v: number): string => v.toLocaleString();

  fmtQAR(v: number | null): string {
    if (v == null) return '—';
    return 'QAR ' + v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  marginClass(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 40) return 'pct-green';
    if (pct >= 20) return 'pct-amber';
    return 'pct-red';
  }

  marginBarClass(pct: number): string {
    if (pct >= 40) return 'bar-green';
    if (pct >= 20) return 'bar-amber';
    return 'bar-red';
  }

  marginBorderColor(pct: number | null): string {
    if (pct == null) return '';
    if (pct >= 40) return 'rgba(22,163,74,.3)';
    if (pct >= 20) return 'rgba(217,119,6,.3)';
    return 'rgba(220,38,38,.3)';
  }

  clampPct(pct: number): number {
    return Math.min(100, Math.max(0, pct));
  }
}
