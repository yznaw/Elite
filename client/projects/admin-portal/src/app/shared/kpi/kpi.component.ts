import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent, IconName } from '../icons/icon.component';
import { SparklineComponent } from '../sparkline/sparkline.component';

@Component({
  selector: 'ap-kpi',
  standalone: true,
  imports: [CommonModule, IconComponent, SparklineComponent],
  template: `
    <div class="kpi">
      <div class="kpi-label">
        <span class="kpi-icon"><ap-icon [name]="icon" [size]="14"/></span>
        {{ label }}
      </div>
      <div class="kpi-value">{{ value }}</div>
      <div class="row" style="justify-content:space-between;">
        <div class="kpi-delta" [class.up]="deltaUp" [class.down]="!deltaUp">
          <ap-icon [name]="deltaUp ? 'arrowUp' : 'arrowDn'" [size]="11"/>
          {{ delta }}
        </div>
        @if (sparkData?.length) {
          <ap-sparkline [data]="sparkData!" [up]="deltaUp"/>
        }
      </div>
    </div>
  `,
})
export class KpiComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string;
  @Input({ required: true }) delta!: string;
  @Input() deltaUp = true;
  @Input({ required: true }) icon!: IconName;
  @Input() sparkData?: number[];
}
