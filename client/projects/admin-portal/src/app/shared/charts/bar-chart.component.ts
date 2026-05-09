import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Bar { label: string; value: number; }

@Component({
  selector: 'ap-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" width="100%" preserveAspectRatio="none" style="display:block;">
      @for (b of bars(); track b.label) {
        <text [attr.x]="padL - 12" [attr.y]="b.y + b.h/2 + 4" text-anchor="end" font-size="11" fill="#3d4159" style="font-family: var(--ff-ui);" font-weight="500">{{ b.label }}</text>
        <rect [attr.x]="padL" [attr.y]="b.y" [attr.width]="innerW" [attr.height]="b.h" fill="rgba(15,35,86,0.04)" rx="3"/>
        <rect [attr.x]="padL" [attr.y]="b.y" [attr.width]="b.bw" [attr.height]="b.h" fill="#c5a572" rx="3"/>
        <text [attr.x]="padL + b.bw + 8" [attr.y]="b.y + b.h/2 + 4" font-size="11" fill="#0f2356" style="font-family: var(--ff-ui);" font-weight="600">{{ b.value.toLocaleString() }}</text>
      }
    </svg>
  `,
})
export class BarChartComponent {
  @Input({ required: true }) set data(d: Bar[]) { this._data.set(d); }
  @Input() height = 260;

  readonly w = 720;
  readonly padL = 160;
  readonly padR = 32;
  readonly padT = 12;
  readonly padB = 12;

  private _data = signal<Bar[]>([]);

  get h(): number { return this.height; }
  get innerW(): number { return this.w - this.padL - this.padR; }
  get innerH(): number { return this.h - this.padT - this.padB; }

  readonly bars = computed(() => {
    const data = this._data();
    if (data.length === 0) return [];
    const max = Math.max(...data.map((d) => d.value), 1) * 1.05;
    const slot = this.innerH / data.length;
    const barH = slot - 8;
    return data.map((d, i) => ({
      label: d.label,
      value: d.value,
      y: this.padT + i * slot,
      h: barH,
      bw: (d.value / max) * this.innerW,
    }));
  });
}
