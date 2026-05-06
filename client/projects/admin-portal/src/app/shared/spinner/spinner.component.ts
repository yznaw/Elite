import { Component, Input } from '@angular/core';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'ap-spinner',
  standalone: true,
  imports: [IconComponent],
  template: `<span class="spinner"><ap-icon name="spinner" [size]="size"/></span>`,
})
export class SpinnerComponent {
  @Input() size = 14;
}
