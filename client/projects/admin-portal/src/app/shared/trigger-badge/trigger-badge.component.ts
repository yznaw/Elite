import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Trigger } from '../../models';
import { IconComponent } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';

@Component({
  selector: 'ap-trigger-badge',
  standalone: true,
  imports: [CommonModule, IconComponent, AvatarComponent],
  template: `
    @if (trigger.type === 'auto') {
      <span class="trigger auto" title="Automatic scheduled run">
        <ap-icon name="clock" [size]="11"/>
        Schedule
      </span>
    } @else {
      <span class="trigger" [attr.title]="'Triggered by ' + (trigger.user || '')">
        <ap-avatar [initials]="trigger.initials || ''" [customSize]="22" [fontSize]="9"/>
        <span>{{ firstName }}</span>
      </span>
    }
  `,
})
export class TriggerBadgeComponent {
  @Input({ required: true }) trigger!: Trigger;

  get firstName(): string {
    return (this.trigger.user || '').split(' ')[0];
  }
}
