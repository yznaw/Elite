import { Component, Input } from '@angular/core';

export type PillKind = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'gold';

@Component({
  selector: 'ap-pill',
  standalone: true,
  template: `<span class="pill {{ kind }}"><ng-content/></span>`,
})
export class PillComponent {
  @Input({ required: true }) kind!: PillKind;
}
