import { Component, Input } from '@angular/core';

@Component({
  selector: 'ap-avatar',
  standalone: true,
  template: `<div class="avatar" [class.lg]="size === 'lg'" [class.muted]="muted" [style.width.px]="customSize" [style.height.px]="customSize" [style.font-size.px]="fontSize">{{ initials }}</div>`,
})
export class AvatarComponent {
  @Input({ required: true }) initials!: string;
  @Input() size: 'sm' | 'lg' = 'sm';
  @Input() muted = false;
  @Input() customSize?: number;
  @Input() fontSize?: number;
}
