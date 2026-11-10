import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
// import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { PieChartComponent } from '../../shared/charts/pie-chart.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { AdminAnalyticsService } from '../../services/admin-analytics.service';
import { formatQAR } from '../../models';
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

interface ShippingProduct {
  productId: string;
  name: string;
  sku: string;
  variantCount: number;
  variantsWithShipping: number;
  avgShipping: number | null;
  minShipping: number | null;
  maxShipping: number | null;
  avgCost: number | null;
  avgPrice: number | null;
}

interface ShippingReport {
  coverage: {
    totalVariants: number;
    withShipping: number;
    withoutShipping: number;
    coveragePct: number;
    avgShipping: number | null;
    totalShipping: number;
  };
  products: ShippingProduct[];
}

interface ProfitSummary {
  revenue: number;
  cogs: number;
  expenses: number;
  netProfit: number;
  netMarginPct: number;
  cogsCoverage: { lineItems: number; lineItemsWithoutCost: number };
  expensesByCategory: Array<{ category: string; total: number; pct: number; color: string }>;
}

@Component({
    selector: 'ap-analytics',
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

    /* Expenses & Net Profit */
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }
    .profit-row { display: flex; align-items: stretch; gap: 10px; flex-wrap: wrap; }
    .profit-step {
      flex: 1; min-width: 150px;
      background: var(--surface-2, #fafafa); border: 1px solid var(--border, #e4e4e7);
      border-radius: 10px; padding: 14px 16px;
    }
    .profit-step.net { background: transparent; border-width: 2px; }
    .profit-op {
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: var(--muted); flex: 0 0 auto; width: 18px;
    }
    .cost-kpi-sub.warn { color: #d97706; }

    /* Shipping cost report */
    .ship-toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .ship-toolbar .inp { flex: 1; min-width: 180px; max-width: 320px; }
    .ship-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
    .row-missing td { background: rgba(217,119,6,.05); }
    .tag-missing, .tag-partial {
      display: inline-block; margin-inline-start: 8px; padding: 1px 7px;
      border-radius: 99px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .04em; vertical-align: middle;
    }
    .tag-missing { background: rgba(220,38,38,.1); color: #dc2626; }
    .tag-partial { background: rgba(217,119,6,.12); color: #d97706; }
    @media (max-width: 760px) {
      .profit-row { flex-direction: column; }
      .profit-op { width: 100%; height: 18px; }
    }
  `],
    changeDetection: ChangeDetectionStrategy.Eager,
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

      <!-- ── Shipping Cost Report ──────────────────────────────────────── -->
      <div class="card mt-24">
        <div class="card-header">
          <div>
            <div class="card-title">{{ t('analytics.card.shipping') }}</div>
            <div class="card-sub">{{ t('analytics.card.shippingSub') }}</div>
          </div>
          <button class="btn btn-outline btn-sm" (click)="loadShipping()">{{ t('analytics.legend.refresh') }}</button>
        </div>
        <div class="card-pad">
          @if (shippingLoading()) {
            <div class="cost-loading">{{ t('common.loading') }}</div>
          } @else if (!shipping() || shipping()!.coverage.totalVariants === 0) {
            <ap-empty-state icon="cube" [title]="t('analytics.ship.empty')" [sub]="t('analytics.ship.emptySub')"/>
          } @else {
            <div class="cost-kpi-grid">
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.ship.avg') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(shipping()!.coverage.avgShipping) }}</div>
                <div class="cost-kpi-sub">{{ t('analytics.ship.perVariant') }}</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.ship.recorded') }}</div>
                <div class="cost-kpi-val mono">{{ shipping()!.coverage.withShipping }}</div>
                <div class="cost-kpi-sub">{{ t('analytics.ship.ofVariants') }} {{ shipping()!.coverage.totalVariants }}</div>
              </div>
              <div class="cost-kpi" [style.border-color]="shipping()!.coverage.withoutShipping > 0 ? 'rgba(217,119,6,.35)' : ''">
                <div class="cost-kpi-label">{{ t('analytics.ship.missing') }}</div>
                <div class="cost-kpi-val mono" [class.pct-amber]="shipping()!.coverage.withoutShipping > 0">
                  {{ shipping()!.coverage.withoutShipping }}
                </div>
                <div class="cost-kpi-sub">{{ t('analytics.ship.missingSub') }}</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">{{ t('analytics.ship.coverage') }}</div>
                <div class="cost-kpi-val" [class]="coverageClass()">{{ shipping()!.coverage.coveragePct | number:'1.1-1' }}%</div>
                <div class="cost-kpi-sub">{{ t('analytics.ship.coverageSub') }}</div>
              </div>
            </div>

            <div class="ship-toolbar">
              <input class="inp inp-sm" type="text" [value]="shipSearch()"
                     (input)="shipSearch.set($any($event.target).value)"
                     [placeholder]="t('analytics.ship.search')"/>
              <label class="ship-toggle">
                <input type="checkbox" [checked]="onlyMissing()"
                       (change)="onlyMissing.set($any($event.target).checked)"/>
                <span>{{ t('analytics.ship.onlyMissing') }}</span>
              </label>
              <span class="muted small">{{ shippingRows().length }} {{ t('analytics.ship.products') }}</span>
            </div>

            @if (shippingRows().length === 0) {
              <div class="cost-loading">{{ t('analytics.ship.noMatch') }}</div>
            } @else {
              <div class="table-wrap">
                <table class="margin-table">
                  <thead>
                    <tr>
                      <th>{{ t('analytics.col.product') }}</th>
                      <th style="text-align:right;">{{ t('analytics.col.variants') }}</th>
                      <th style="text-align:right;">{{ t('analytics.ship.col.withCost') }}</th>
                      <th style="text-align:right;">{{ t('analytics.ship.col.avg') }}</th>
                      <th style="text-align:right;">{{ t('analytics.ship.col.range') }}</th>
                      <th style="text-align:right;">{{ t('analytics.col.avgPrice') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of shippingRows(); track p.productId) {
                      <tr [class.row-missing]="p.variantsWithShipping === 0">
                        <td class="strong">
                          {{ p.name }}
                          @if (p.variantsWithShipping === 0) {
                            <span class="tag-missing">{{ t('analytics.ship.tagMissing') }}</span>
                          } @else if (p.variantsWithShipping < p.variantCount) {
                            <span class="tag-partial">{{ t('analytics.ship.tagPartial') }}</span>
                          }
                        </td>
                        <td style="text-align:right;" class="muted small">{{ p.variantCount }}</td>
                        <td style="text-align:right;" class="mono"
                            [class.pct-amber]="p.variantsWithShipping < p.variantCount">
                          {{ p.variantsWithShipping }}/{{ p.variantCount }}
                        </td>
                        <td style="text-align:right;" class="mono">{{ fmtQAR(p.avgShipping) }}</td>
                        <td style="text-align:right;" class="mono muted small">{{ shipRange(p) }}</td>
                        <td style="text-align:right;" class="mono">{{ fmtQAR(p.avgPrice) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </div>
      </div>

      <!-- ── Expenses & Net Profit ─────────────────────────────────────── -->
      <div class="card mt-24">
        <div class="card-header">
          <div>
            <div class="card-title">{{ t('analytics.card.netProfit') }}</div>
            <div class="card-sub">{{ t('analytics.card.netProfitSub') }} · {{ activeLabel() }}</div>
          </div>
        </div>
        <div class="card-pad">
          @if (profitLoading()) {
            <div class="cost-loading">{{ t('common.loading') }}</div>
          } @else if (!profit()) {
            <ap-empty-state icon="expenses" [title]="t('analytics.card.profitEmpty')"
              [sub]="t('analytics.card.profitEmptySub')"/>
          } @else {
            <div class="profit-row">
              <div class="profit-step">
                <div class="cost-kpi-label">{{ t('analytics.profit.revenue') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(profit()!.revenue) }}</div>
              </div>
              <div class="profit-op">−</div>
              <div class="profit-step">
                <div class="cost-kpi-label">{{ t('analytics.profit.cogs') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(profit()!.cogs) }}</div>
                @if (profit()!.cogsCoverage.lineItemsWithoutCost > 0) {
                  <div class="cost-kpi-sub warn">
                    {{ profit()!.cogsCoverage.lineItemsWithoutCost }} {{ t('analytics.profit.missingCost') }}
                  </div>
                }
              </div>
              <div class="profit-op">−</div>
              <div class="profit-step">
                <div class="cost-kpi-label">{{ t('analytics.profit.expenses') }}</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(profit()!.expenses) }}</div>
              </div>
              <div class="profit-op">=</div>
              <div class="profit-step net" [style.border-color]="netBorderColor()">
                <div class="cost-kpi-label">{{ t('analytics.profit.net') }}</div>
                <div class="cost-kpi-val mono" [class]="netClass()">{{ fmtQAR(profit()!.netProfit) }}</div>
                <div class="cost-kpi-sub">{{ profit()!.netMarginPct | number:'1.1-1' }}% {{ t('analytics.profit.netMargin') }}</div>
              </div>
            </div>

            @if (profit()!.expensesByCategory.length > 0) {
              <div class="section-title mt-24">{{ t('analytics.profit.byCategory') }}</div>
              <div class="split-inner">
                <ap-pie-chart [data]="expensePie()" [centerLabel]="t('analytics.profit.pieLabel')"/>
                <div>
                  @for (c of profit()!.expensesByCategory; track c.category) {
                    <div class="rank-row">
                      <span [style.background]="c.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                      <span class="grow strong">{{ t('expenses.category.' + c.category) }}</span>
                      <span class="muted">{{ c.pct }}%</span>
                      <span class="strong" style="width:90px;text-align:right;">{{ fmtQAR(c.total) }}</span>
                    </div>
                  }
                </div>
              </div>
            } @else {
              <div class="muted small mt-16">{{ t('analytics.profit.noExpenses') }}</div>
            }
          }
        </div>
      </div>

    </div>
  `
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
    // Profit is range-scoped too, so it has to follow the filter.
    this.loadProfitSummary();
  }

  readonly costSummary = signal<CostSummary | null>(null);
  readonly costLoading = signal(false);
  readonly profit = signal<ProfitSummary | null>(null);
  readonly profitLoading = signal(false);
  readonly shipping = signal<ShippingReport | null>(null);
  readonly shippingLoading = signal(false);
  readonly shipSearch = signal('');
  readonly onlyMissing = signal(false);
  // Headline revenue reads better whole; cost and expense figures need the
  // piastres. Both now come from the same formatter.
  readonly money = (v: number): string => formatQAR(v, 0);
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
    this.loadProfitSummary();
    this.loadShipping();
  }

  loadCostSummary(): void {
    this.costLoading.set(true);
    this.api.get<CostSummary>('/admin/analytics/cost-summary').subscribe({
      next: data => { this.costSummary.set(data); this.costLoading.set(false); },
      error: ()  => { this.costLoading.set(false); },
    });
  }

  loadProfitSummary(): void {
    this.profitLoading.set(true);
    this.api.get<ProfitSummary>(`/admin/analytics/profit-summary?range=${this.range()}`).subscribe({
      next: data => { this.profit.set(data); this.profitLoading.set(false); },
      error: ()  => { this.profitLoading.set(false); },
    });
  }

  // Catalogue-wide, so it does not depend on the range filter and is only
  // fetched once (plus on explicit refresh).
  loadShipping(): void {
    this.shippingLoading.set(true);
    this.api.get<ShippingReport>('/admin/analytics/shipping-costs').subscribe({
      next: data => { this.shipping.set(data); this.shippingLoading.set(false); },
      error: ()  => { this.shippingLoading.set(false); },
    });
  }

  /** Search by name or SKU, optionally narrowed to products missing data. */
  readonly shippingRows = computed<ShippingProduct[]>(() => {
    const rows = this.shipping()?.products ?? [];
    const q = this.shipSearch().toLowerCase().trim();
    const missingOnly = this.onlyMissing();
    return rows.filter(p => {
      if (missingOnly && p.variantsWithShipping === p.variantCount) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q);
    });
  });

  /** Collapses to a single figure when every variant ships for the same price. */
  shipRange(p: ShippingProduct): string {
    if (p.minShipping == null || p.maxShipping == null) return '—';
    if (p.minShipping === p.maxShipping) return this.fmtQAR(p.minShipping);
    return `${this.fmtQAR(p.minShipping)} - ${this.fmtQAR(p.maxShipping)}`;
  }

  coverageClass(): string {
    const pct = this.shipping()?.coverage.coveragePct ?? 0;
    if (pct >= 90) return 'pct-green';
    if (pct >= 50) return 'pct-amber';
    return 'pct-red';
  }

  /** Expense categories shaped for the shared pie chart. */
  readonly expensePie = computed(() =>
    (this.profit()?.expensesByCategory ?? []).map(c => ({
      source: this.t('expenses.category.' + c.category),
      count: c.total,
      pct: c.pct,
      color: c.color,
    })));

  netClass(): string {
    const net = this.profit()?.netProfit ?? 0;
    return net < 0 ? 'pct-red' : net > 0 ? 'pct-green' : '';
  }

  netBorderColor(): string {
    const net = this.profit()?.netProfit ?? 0;
    if (net < 0) return 'rgba(220,38,38,.4)';
    if (net > 0) return 'rgba(22,163,74,.4)';
    return 'var(--border, #e4e4e7)';
  }

  fmtNum = (v: number): string => v.toLocaleString();

  fmtQAR(v: number | null): string {
    return formatQAR(v, 2);
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
