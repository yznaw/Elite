import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Reusable summary card for numeric report totals. */
@Component({
  selector: 'ap-report-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="kpi-card">
      <div class="kpi-label">{{ label }}</div>
      <div class="kpi-value">{{ value }}</div>
      @if (hint) { <div class="kpi-hint">{{ hint }}</div> }
    </div>
  `,
  styles: [`
    .kpi-card { background:#fff; border:1px solid var(--border,#e5e7eb); border-radius:10px; padding:14px 16px; }
    .kpi-label,.kpi-hint { color:var(--muted,#6b7280); font-size:12px; }
    .kpi-value { font-size:20px; font-weight:700; margin-top:4px; }
    .kpi-hint { margin-top:4px; }
  `],
})
export class ReportKpiCardComponent {
  @Input({ required: true }) label = '';
  @Input({ required: true }) value: string | number = '';
  @Input() hint = '';
}
