import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { PieChartComponent } from '../../shared/charts/pie-chart.component';
import { FunnelComponent } from '../../shared/charts/funnel.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { FUNNEL, REVENUE_30D, TRAFFIC } from '../../data/mock';
import { QAR } from '../../models';
import { ApiClient } from '../../services/api-client.service';

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
  imports: [CommonModule, KpiComponent, LineChartComponent, BarChartComponent, PieChartComponent, FunnelComponent, EmptyStateComponent],
  styles: [`
    /* Range filter row: horizontal scroll on phone instead of wrapping */
    .range-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 640px) {
      .range-row { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; gap: 6px; }
      .range-row::-webkit-scrollbar { display: none; }
      .range-row .btn { flex-shrink: 0; white-space: nowrap; }
    }
    /* Traffic sources: side-by-side on desktop, stacked on phone */
    .traffic-inner { display: grid; grid-template-columns: auto 1fr; gap: 24px; align-items: center; }
    @media (max-width: 600px) {
      .traffic-inner { grid-template-columns: 1fr; justify-items: center; }
      .traffic-inner > div { width: 100%; }
    }

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
          @for (r of ranges; track r.key) {
            <button class="btn" [class.btn-primary]="range() === r.key" [class.btn-outline]="range() !== r.key" (click)="range.set(r.key)">{{ r.label }}</button>
          }
        </div>
        <div class="row gap-sm" style="flex-shrink:0;">
          <button class="btn btn-outline">Compare</button>
          <button class="btn btn-outline">Export PDF</button>
        </div>
      </div>

      <div class="kpi-grid mb-24">
        <ap-kpi label="Sessions" [value]="totalSessionsLabel" delta="12.4%" [deltaUp]="true" icon="users"/>
        <ap-kpi label="Conversions" [value]="totalConversionsLabel" delta="8.1%" [deltaUp]="true" icon="orders"/>
        <ap-kpi label="Conv. Rate" [value]="convRate + '%'" delta="0.3 pp" [deltaUp]="true" icon="chart"/>
        <ap-kpi label="Avg Order" [value]="avgOrder" delta="2.6%" [deltaUp]="true" icon="cube"/>
      </div>

      <div class="grid-2 mb-24">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Sessions vs Conversions</div>
              <div class="card-sub">Daily · Last 30 days</div>
            </div>
            <div class="row gap-sm small">
              <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>Sessions</span>
              <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--gold);border-top:1px dashed var(--gold);"></span>Conversions</span>
            </div>
          </div>
          <div class="card-pad">
            @if (rev30.length > 0) {
              <ap-line-chart [data]="rev30" valueKey="sessions" secondKey="conversions" [formatY]="fmtNum"/>
            } @else {
              <ap-empty-state icon="chart" title="No session data yet" sub="Check back once analytics are recording."/>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Traffic Sources</div>
              <div class="card-sub">Last 30 days</div>
            </div>
          </div>
          <div class="card-pad traffic-inner">
            @if (traffic.length > 0) {
              <ap-pie-chart [data]="traffic"/>
              <div>
                @for (t of traffic; track t.source) {
                  <div class="row gap-sm" style="padding:8px 0;border-bottom:1px solid var(--border-2);">
                    <span [style.background]="t.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                    <span class="grow strong">{{ t.source }}</span>
                    <span class="muted">{{ t.pct }}%</span>
                    <span class="strong" style="width:60px;text-align:right;">{{ t.count.toLocaleString() }}</span>
                  </div>
                }
              </div>
            } @else {
              <ap-empty-state icon="chart" title="No traffic data yet" sub="Source breakdown appears once visits are tracked."/>
            }
          </div>
        </div>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div>
            <div class="card-title">Conversion Funnel</div>
            <div class="card-sub">From visit to purchase</div>
          </div>
        </div>
        <div class="card-pad">
          <ap-funnel [data]="funnel"/>
        </div>
      </div>

      <!-- ── Cost & Margin ─────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Cost & Margin</div>
            <div class="card-sub">Based on imported Cost-QAR + Shipping cost per variant</div>
          </div>
          <button class="btn btn-outline btn-sm" (click)="loadCostSummary()">Refresh</button>
        </div>
        <div class="card-pad">
          @if (costLoading()) {
            <div class="cost-loading">Loading cost data…</div>
          } @else if (!costSummary() || costSummary()!.catalog.variantsWithCost === 0) {
            <ap-empty-state icon="cube" title="No cost data yet"
              sub="Import products with Cost-QAR and Shipping cost columns to see margin analytics."/>
          } @else {
            <!-- KPI row -->
            <div class="cost-kpi-grid">
              <div class="cost-kpi">
                <div class="cost-kpi-label">Avg Product Cost</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgCost) }}</div>
                <div class="cost-kpi-sub">material cost per variant</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">Avg Shipping Cost</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgShipping) }}</div>
                <div class="cost-kpi-sub">shipping per variant</div>
              </div>
              <div class="cost-kpi">
                <div class="cost-kpi-label">Avg Total Cost</div>
                <div class="cost-kpi-val mono">{{ fmtQAR(costSummary()!.catalog.avgTotalCost) }}</div>
                <div class="cost-kpi-sub">cost + shipping combined</div>
              </div>
              <div class="cost-kpi" [style.border-color]="marginBorderColor(costSummary()!.catalog.avgMarginPct)">
                <div class="cost-kpi-label">Avg Gross Margin</div>
                <div class="cost-kpi-val" [class]="marginClass(costSummary()!.catalog.avgMarginPct)">
                  {{ costSummary()!.catalog.avgMarginPct | number:'1.1-1' }}%
                </div>
                <div class="cost-kpi-sub">{{ costSummary()!.catalog.variantsWithCost.toLocaleString() }} variants with cost data</div>
              </div>
            </div>

            <!-- Per-product margin table -->
            <div class="section-title">Margin by Product</div>
            <div class="section-sub">
              Sorted by margin · lowest first — fix low-margin products first
            </div>
            <div class="table-wrap">
              <table class="margin-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style="text-align:right;">Variants</th>
                    <th style="text-align:right;">Avg Price</th>
                    <th style="text-align:right;">Avg Cost</th>
                    <th style="text-align:right;">Avg Shipping</th>
                    <th style="text-align:right;">Avg Total Cost</th>
                    <th style="min-width:160px;">Margin</th>
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
  private readonly api = inject(ApiClient);

  readonly ranges = [
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
    { key: '1y', label: 'Last year' },
  ];
  readonly range = signal('30d');

  readonly rev30 = REVENUE_30D as unknown as Array<Record<string, unknown>>;
  readonly traffic = TRAFFIC;
  readonly funnel = FUNNEL;

  readonly totalSessions = REVENUE_30D.reduce((s, d) => s + d.sessions, 0);
  readonly totalConversions = REVENUE_30D.reduce((s, d) => s + d.conversions, 0);
  readonly convRate = ((this.totalConversions / this.totalSessions) * 100).toFixed(2);
  readonly avgOrder = QAR(Math.round(REVENUE_30D.reduce((s, d) => s + d.rev, 0) / this.totalConversions));

  readonly totalSessionsLabel = this.totalSessions.toLocaleString();
  readonly totalConversionsLabel = this.totalConversions.toLocaleString();

  readonly costSummary = signal<CostSummary | null>(null);
  readonly costLoading = signal(false);

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
