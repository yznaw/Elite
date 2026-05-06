import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ap-mini-spark',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="viewBox" preserveAspectRatio="none" class="spark-mini">
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color" stop-opacity="0.3"/>
          <stop offset="100%" [attr.stop-color]="color" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polyline [attr.fill]="'url(#' + gradId + ')'" [attr.points]="filledPoints()"/>
      <polyline fill="none" [attr.stroke]="color" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" [attr.points]="points()"/>
      <circle [attr.cx]="w" [attr.cy]="lastY()" r="2.5" [attr.fill]="color"/>
    </svg>
  `,
})
export class MiniSparkComponent {
  @Input({ required: true }) set data(d: number[]) { this._data.set(d); }
  @Input() color: string = 'var(--gold)';

  readonly w = 100;
  readonly h = 32;
  readonly viewBox = `0 0 ${this.w} ${this.h}`;
  readonly gradId = 'mg-' + Math.random().toString(36).slice(2, 9);

  private _data = signal<number[]>([]);

  readonly points = computed(() => {
    const data = this._data();
    if (data.length === 0) return '';
    const max = Math.max(...data, 100);
    const min = Math.min(...data, 0);
    return data.map((v, i) =>
      `${(i / (data.length - 1)) * this.w},${this.h - ((v - min) / (max - min || 1)) * this.h * 0.85 - 2}`,
    ).join(' ');
  });

  readonly filledPoints = computed(() => `0,${this.h} ${this.points()} ${this.w},${this.h}`);

  readonly lastY = computed(() => {
    const data = this._data();
    if (data.length === 0) return this.h;
    const max = Math.max(...data, 100);
    const min = Math.min(...data, 0);
    return this.h - ((data[data.length - 1] - min) / (max - min || 1)) * this.h * 0.85 - 2;
  });
}
