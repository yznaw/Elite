import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ap-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.width]="w" [attr.height]="h" style="flex-shrink:0;">
      <polyline fill="none" [attr.stroke]="color()" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" [attr.points]="points()"/>
    </svg>
  `,
})
export class SparklineComponent {
  @Input({ required: true }) set data(d: number[]) { this._data.set(d); }
  @Input() up = true;
  @Input() w = 80;
  @Input() h = 28;

  private _data = signal<number[]>([]);

  readonly points = computed(() => {
    const data = this._data();
    if (data.length === 0) return '';
    const max = Math.max(...data), min = Math.min(...data);
    return data.map((v, i) =>
      `${(i / (data.length - 1)) * this.w},${this.h - ((v - min) / (max - min || 1)) * this.h}`,
    ).join(' ');
  });

  readonly color = computed(() => (this.up ? '#10b981' : '#ef4444'));
}
