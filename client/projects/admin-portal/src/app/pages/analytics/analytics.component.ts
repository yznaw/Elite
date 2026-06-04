import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { LineChartComponent } from '../../shared/charts/line-chart.component';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { PieChartComponent } from '../../shared/charts/pie-chart.component';
import { FunnelComponent } from '../../shared/charts/funnel.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { FUNNEL, PRODUCTS, REVENUE_30D, TRAFFIC } from '../../data/mock';
import { QAR } from '../../models';

@Component({
  selector: 'ap-analytics',
  standalone: true,
  imports: [CommonModule, KpiComponent, LineChartComponent, BarChartComponent, PieChartComponent, FunnelComponent, EmptyStateComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="justify-content:space-between;flex-wrap:wrap;">
        <div class="row gap-sm">
          @for (r of ranges; track r.key) {
            <button class="btn" [class.btn-primary]="range() === r.key" [class.btn-outline]="range() !== r.key" (click)="range.set(r.key)">{{ r.label }}</button>
          }
        </div>
        <div class="row gap-sm">
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
          <div class="card-pad" style="display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;">
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

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Top 10 by 3D Interaction</div>
              <div class="card-sub">Total drag/zoom views · Last 30 days</div>
            </div>
          </div>
          <div class="card-pad">
            @if (topByViews.length > 0) {
              <ap-bar-chart [data]="topByViews"/>
            } @else {
              <ap-empty-state icon="cube" title="No 3D views yet" sub="Interactions appear once customers explore products."/>
            }
          </div>
        </div>

        <div class="card">
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
      </div>
    </div>
  `,
})
export class AnalyticsComponent {
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
  readonly topByViews = [...PRODUCTS].sort((a, b) => b.views3d - a.views3d).slice(0, 10).map((p) => ({ label: p.name, value: p.views3d }));

  readonly totalSessions = REVENUE_30D.reduce((s, d) => s + d.sessions, 0);
  readonly totalConversions = REVENUE_30D.reduce((s, d) => s + d.conversions, 0);
  readonly convRate = ((this.totalConversions / this.totalSessions) * 100).toFixed(2);
  readonly avgOrder = QAR(Math.round(REVENUE_30D.reduce((s, d) => s + d.rev, 0) / this.totalConversions));

  readonly totalSessionsLabel = this.totalSessions.toLocaleString();
  readonly totalConversionsLabel = this.totalConversions.toLocaleString();

  fmtNum = (v: number): string => v.toLocaleString();
}
