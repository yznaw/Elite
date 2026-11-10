import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface LocationOption {
  id: string;
  label: string;
  kind?: 'store' | 'warehouse' | 'website';
  disabled?: boolean;
}

/** Small shared selector used by both sales reports and physical stocktakes. */
@Component({
  selector: 'ap-location-selector',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="location-field">
      @if (label) { <span class="lbl">{{ label }}</span> }
      <select class="inp" [ngModel]="value" (ngModelChange)="valueChange.emit($event)">
        @if (allLabel) { <option value="">{{ allLabel }}</option> }
        @for (option of options; track option.id) {
          <option [value]="option.id" [disabled]="option.disabled">
            {{ option.label }}
          </option>
        }
      </select>
    </label>
  `,
  styles: [`
    .location-field { display: grid; gap: 6px; min-width: 180px; }
  `],
})
export class LocationSelectorComponent {
  @Input() label = '';
  @Input() allLabel = '';
  @Input() value = '';
  @Input() options: LocationOption[] = [];
  @Output() readonly valueChange = new EventEmitter<string>();
}
