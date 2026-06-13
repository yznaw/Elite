import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { PieChartComponent } from '../../shared/charts/pie-chart.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { AdminAnalyticsService } from '../../services/admin-analytics.service';
import { QAR } from '../../models';

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
  `],
  template: `
    <div class="page-fade">
      <div class="range-row mb-24">
        <div class="row gap-sm" style="flex-wrap:nowrap;">
          @for (r of ranges; track r.key) {
            <button class="btn" [class.btn-primary]="range() === r.key" [class.btn-outline]="range() !== r.key" (click)="select(r.key)">{{ r.label }}</button>
          }
        </div>
        @if (svc.loading()) {
          <span class="muted small" style="flex-shrink:0;">Loading…</span>
        }
      </div>

      <div class="section-label">Financial</div>
      <div class="kpi-grid mb-24">
        <ap-kpi label="Revenue" [value]="money(d().financial.revenue)" [delta]="d().financial.totalOrders + ' orders total'" [deltaUp]="true" icon="store"/>
        <ap-kpi label="Paid Orders" [value]="fmtNum(d().financial.orders)" delta="paid" [deltaUp]="true" icon="orders"/>
        <ap-kpi label="Avg Order Value" [value]="money(d().financial.aov)" delta="per order" [deltaUp]="true" icon="cube"/>
        <ap-kpi label="Conversion Rate" [value]="d().financial.conversionRate + '%'" delta="orders / sessions" [deltaUp]="true" icon="chart"/>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div><div class="card-title">Revenue</div><div class="card-sub">Daily · {{ activeLabel() }}</div></div>
        </div>
        <div class="card-pad">
          @if (revenueSeries().length > 0) {
            <ap-line-chart [data]="revenueSeries()" valueKey="revenue" [formatY]="money" [xLabel]="xLabel"/>
          } @else {
            <ap-empty-state icon="store" title="No revenue yet" sub="Paid orders in this range will chart here."/>
          }
        </div>
      </div>

      <div class="section-label">Behavior</div>
      <div class="kpi-grid mb-24">
        <ap-kpi label="Visitors" [value]="fmtNum(d().kpis.visitors)" delta="unique" [deltaUp]="true" icon="users"/>
        <ap-kpi label="Sessions" [value]="fmtNum(d().kpis.sessions)" [delta]="d().kpis.pagesPerSession + ' pages/session'" [deltaUp]="true" icon="team"/>
        <ap-kpi label="Page Views" [value]="fmtNum(d().kpis.pageviews)" delta="total" [deltaUp]="true" icon="eye"/>
        <ap-kpi label="Clicks" [value]="fmtNum(d().kpis.clicks)" delta="tracked" [deltaUp]="true" icon="cube"/>
      </div>

      <div class="card mb-24">
        <div class="card-header">
          <div>
            <div class="card-title">Sessions &amp; Clicks</div>
            <div class="card-sub">Daily · {{ activeLabel() }}</div>
          </div>
          <div class="row gap-sm small">
            <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--green);"></span>Sessions</span>
            <span class="row gap-sm"><span style="width:10px;height:2px;background:var(--gold);border-top:1px dashed var(--gold);"></span>Clicks</span>
          </div>
        </div>
        <div class="card-pad">
          @if (series().length > 0) {
            <ap-line-chart [data]="series()" valueKey="sessions" secondKey="clicks" [formatY]="fmtNum" [xLabel]="xLabel"/>
          } @else {
            <ap-empty-state icon="chart" title="No activity yet" sub="Sessions and clicks appear here once visitors browse the store."/>
          }
        </div>
      </div>

      <div class="grid-2 mb-24">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Traffic Sources</div>
              <div class="card-sub">By entry referrer · {{ activeLabel() }}</div>
            </div>
          </div>
          <div class="card-pad split-inner">
            @if (traffic().length > 0) {
              <ap-pie-chart [data]="traffic()"/>
              <div>
                @for (t of traffic(); track t.source) {
                  <div class="rank-row">
                    <span [style.background]="t.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                    <span class="grow strong">{{ t.source }}</span>
                    <span class="muted">{{ t.pct }}%</span>
                    <span class="strong" style="width:60px;text-align:right;">{{ t.count.toLocaleString() }}</span>
                  </div>
                }
              </div>
            } @else {
              <ap-empty-state icon="users" title="No traffic data yet" sub="Source breakdown appears once visits are tracked."/>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Event Breakdown</div>
              <div class="card-sub">By type · {{ activeLabel() }}</div>
            </div>
          </div>
          <div class="card-pad split-inner">
            @if (eventTypes().length > 0) {
              <ap-pie-chart [data]="eventTypes()"/>
              <div>
                @for (t of eventTypes(); track t.source) {
                  <div class="rank-row">
                    <span [style.background]="t.color" style="width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>
                    <span class="grow strong">{{ t.source }}</span>
                    <span class="muted">{{ t.pct }}%</span>
                    <span class="strong" style="width:60px;text-align:right;">{{ t.count.toLocaleString() }}</span>
                  </div>
                }
              </div>
            } @else {
              <ap-empty-state icon="chart" title="No events yet" sub="The breakdown appears once activity is recorded."/>
            }
          </div>
        </div>
      </div>

      <div class="grid-2 mb-24">
        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Top Pages</div><div class="card-sub">By page views</div></div>
          </div>
          <div class="card-pad">
            @if (d().topPages.length > 0) {
              <ap-bar-chart [data]="d().topPages"/>
            } @else {
              <ap-empty-state icon="chart" title="No page views yet"/>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div><div class="card-title">Most Clicked</div><div class="card-sub">Tracked elements</div></div>
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
              <ap-empty-state icon="cube" title="No clicks yet" sub="Add data-track to elements to capture clicks."/>
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div><div class="card-title">Most Engaged Products</div><div class="card-sub">By tracked interactions</div></div>
        </div>
        <div class="card-pad">
          @if (d().topProducts.length > 0) {
            <ap-bar-chart [data]="d().topProducts"/>
          } @else {
            <ap-empty-state icon="cube" title="No product activity yet" sub="Product clicks and views appear here."/>
          }
        </div>
      </div>
    </div>
  `,
})
export class AnalyticsComponent implements OnInit {
  readonly svc = inject(AdminAnalyticsService);

  readonly ranges = [
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
    { key: '1y', label: 'Last year' },
  ];
  readonly range = signal('30d');

  readonly d = this.svc.data;
  readonly series = computed(() => this.d().series as unknown as Array<Record<string, unknown>>);
  readonly revenueSeries = computed(() => this.d().revenueSeries as unknown as Array<Record<string, unknown>>);
  readonly eventTypes = computed(() => this.d().eventTypes);
  readonly traffic = computed(() => this.d().traffic);
  readonly activeLabel = computed(() => this.ranges.find((r) => r.key === this.range())?.label ?? '');

  ngOnInit(): void {
    void this.svc.load(this.range());
  }

  /** Switch range and reload. */
  select(key: string): void {
    if (key === this.range()) return;
    this.range.set(key);
    void this.svc.load(key);
  }

  fmtNum = (v: number): string => (v ?? 0).toLocaleString();
  money = (v: number): string => QAR(v ?? 0);

  xLabel = (row: Record<string, unknown>): string => {
    const raw = row['day'];
    const date = raw instanceof Date ? raw : new Date(String(raw));
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
}
