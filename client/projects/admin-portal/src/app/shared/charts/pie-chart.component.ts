import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface PieSlice { source: string; pct: number; count: number; color: string; }

@Component({
  selector: 'ap-pie-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="'0 0 ' + size + ' ' + size" [attr.width]="size" [attr.height]="size">
      @for (s of slices(); track s.color) {
        <path [attr.d]="s.d" [attr.fill]="s.color" stroke="#fff" stroke-width="2"/>
      }
      <circle [attr.cx]="cx" [attr.cy]="cy" [attr.r]="rInner" fill="#fff"/>
      <text [attr.x]="cx" [attr.y]="cy - 4" text-anchor="middle" font-size="11" fill="#6b7088" style="font-family: var(--ff-ui);" letter-spacing="1.2">SOURCES</text>
      <text [attr.x]="cx" [attr.y]="cy + 16" text-anchor="middle" font-size="22" fill="#0f2356" style="font-family: var(--ff-disp);" font-weight="500">{{ total() }}</text>
    </svg>
  `,
})
export class PieChartComponent {
  @Input({ required: true }) set data(d: PieSlice[]) { this._data.set(d); }
  @Input() size = 220;

  private _data = signal<PieSlice[]>([]);

  get cx(): number { return this.size / 2; }
  get cy(): number { return this.size / 2; }
  get r(): number { return this.size / 2 - 16; }
  get rInner(): number { return this.r * 0.55; }

  readonly slices = computed(() => {
    const data = this._data();
    const total = data.reduce((s, d) => s + d.pct, 0) || 1;
    let acc = 0;
    return data.map((d) => {
      const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += d.pct;
      const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const large = d.pct / total > 0.5 ? 1 : 0;
      const x1 = this.cx + Math.cos(start) * this.r;
      const y1 = this.cy + Math.sin(start) * this.r;
      const x2 = this.cx + Math.cos(end) * this.r;
      const y2 = this.cy + Math.sin(end) * this.r;
      return {
        d: `M ${this.cx} ${this.cy} L ${x1} ${y1} A ${this.r} ${this.r} 0 ${large} 1 ${x2} ${y2} Z`,
        color: d.color,
      };
    });
  });

  readonly total = computed(() =>
    this._data().reduce((s, d) => s + d.count, 0).toLocaleString(),
  );
}
