import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { IconComponent } from '../icons/icon.component';

@Component({
    selector: 'ap-spinner',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `<span class="spinner"><ap-icon name="spinner" [size]="size"/></span>`
})
export class SpinnerComponent {
  @Input() size = 14;
}
