import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent, IconName } from '../icons/icon.component';

@Component({
  selector: 'ap-empty-state',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="empty-state">
      <div class="empty-state-icon"><ap-icon [name]="icon" [size]="24"/></div>
      <div class="empty-state-title">{{ title }}</div>
      @if (sub) { <div class="empty-state-sub">{{ sub }}</div> }
      <ng-content/>
    </div>
  `,
})
export class EmptyStateComponent {
  @Input() icon: IconName = 'search';
  @Input({ required: true }) title!: string;
  @Input() sub?: string;
}
