import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ap-line-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" width="100%" preserveAspectRatio="none" style="display:block;">
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#c5a572" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#c5a572" stop-opacity="0"/>
        </linearGradient>
      </defs>

      @for (t of yTicks(); track t.v; let i = $index) {
        <line [attr.x1]="padL" [attr.y1]="t.y" [attr.x2]="w - padR" [attr.y2]="t.y" stroke="#e2e6f0" stroke-width="1" [attr.stroke-dasharray]="i === 0 ? '' : '2 4'"/>
        <text [attr.x]="padL - 8" [attr.y]="t.y + 3" text-anchor="end" font-size="10" fill="#9ca0b3" style="font-family: var(--ff-ui);">{{ formatY(t.v) }}</text>
      }

      @for (xt of xTicks(); track xt.idx) {
        <text [attr.x]="xt.x" [attr.y]="h - 8" text-anchor="middle" font-size="10" fill="#9ca0b3" style="font-family: var(--ff-ui);">{{ xt.label }}</text>
      }

      <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gradId + ')'"/>
      <path [attr.d]="linePath()" fill="none" stroke="#0f2356" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      @if (secondKey) {
        <path [attr.d]="linePath2()" fill="none" stroke="#c5a572" stroke-width="1.6" stroke-dasharray="4 4" stroke-linecap="round"/>
      }
      @if (lastPoint(); as lp) {
        <circle [attr.cx]="lp.x" [attr.cy]="lp.y" r="4" fill="#c5a572" stroke="#fff" stroke-width="2"/>
      }
    </svg>
  `,
})
export class LineChartComponent {
  @Input({ required: true }) set data(d: Array<Record<string, unknown>>) { this._data.set(d); }
  @Input() valueKey: string = 'rev';
  @Input() secondKey?: string;
  @Input() height = 240;
  @Input() formatY: (v: number) => string = (v) => String(v);
  @Input() xLabel: (d: Record<string, unknown>) => string = (d) =>
    (d['day'] instanceof Date ? (d['day'] as Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

  readonly w = 720;
  readonly padL = 44;
  readonly padR = 16;
  readonly padT = 16;
  readonly padB = 30;
  readonly gradId = 'lc-grad-' + Math.random().toString(36).slice(2, 9);

  private _data = signal<Array<Record<string, unknown>>>([]);

  get h(): number { return this.height; }
  get innerW(): number { return this.w - this.padL - this.padR; }
  get innerH(): number { return this.h - this.padT - this.padB; }

  private series = computed(() => this._data().map((d) => Number(d[this.valueKey])));
  private max = computed(() => Math.max(...this.series(), 1) * 1.1);

  private x(i: number): number {
    const data = this._data();
    if (data.length <= 1) return this.padL;
    return this.padL + (i / (data.length - 1)) * this.innerW;
  }

  private y(v: number): number {
    return this.padT + this.innerH - ((v - 0) / (this.max() - 0 || 1)) * this.innerH;
  }

  readonly linePath = computed(() => {
    const data = this._data();
    return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${this.x(i)} ${this.y(Number(d[this.valueKey]))}`).join(' ');
  });

  readonly areaPath = computed(() => {
    const data = this._data();
    if (data.length === 0) return '';
    return this.linePath() + ` L ${this.x(data.length - 1)} ${this.padT + this.innerH} L ${this.x(0)} ${this.padT + this.innerH} Z`;
  });

  readonly linePath2 = computed(() => {
    if (!this.secondKey) return '';
    const data = this._data();
    const max2 = Math.max(...data.map((d) => Number(d[this.secondKey!])), 1) * 1.1;
    return data.map((d, i) => {
      const v = Number(d[this.secondKey!]);
      const yv = this.padT + this.innerH - ((v - 0) / (max2 - 0 || 1)) * this.innerH;
      return `${i === 0 ? 'M' : 'L'} ${this.x(i)} ${yv}`;
    }).join(' ');
  });

  readonly yTicks = computed(() => {
    const ticks = 4;
    const max = this.max();
    return Array.from({ length: ticks + 1 }).map((_, i) => {
      const v = max * (i / ticks);
      return { v, y: this.y(v) };
    });
  });

  readonly xTicks = computed(() => {
    const data = this._data();
    return data
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => i % 5 === 0 || i === data.length - 1)
      .map(({ d, i }) => ({ idx: i, x: this.x(i), label: this.xLabel(d) }));
  });

  readonly lastPoint = computed(() => {
    const data = this._data();
    if (data.length === 0) return null;
    const i = data.length - 1;
    return { x: this.x(i), y: this.y(Number(data[i][this.valueKey])) };
  });
}
