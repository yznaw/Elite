import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FunnelStep } from '../../models';

@Component({
  selector: 'ap-funnel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div>
      @for (row of computed(); track row.label) {
        <div class="funnel-row">
          <div class="funnel-label">{{ row.label }}</div>
          <div class="funnel-bar-track">
            <div class="funnel-bar-fill" [style.width.%]="row.pct">{{ row.value.toLocaleString() }}</div>
          </div>
          <div class="funnel-conv">{{ row.conv }}%</div>
        </div>
      }
    </div>
  `,
})
export class FunnelComponent {
  @Input({ required: true }) set data(d: FunnelStep[]) { this._data.set(d); }

  private _data = signal<FunnelStep[]>([]);

  readonly computed = computed(() => {
    const data = this._data();
    if (data.length === 0) return [];
    const max = data[0].value;
    return data.map((row, i) => {
      const conv = i === 0 ? 100 : (row.value / data[i - 1].value) * 100;
      return {
        label: row.label,
        value: row.value,
        pct: (row.value / max) * 100,
        conv: conv.toFixed(1),
      };
    });
  });
}
