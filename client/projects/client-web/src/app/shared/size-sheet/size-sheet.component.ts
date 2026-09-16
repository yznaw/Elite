import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayComponent } from '../overlay/overlay.component';
import { I18nService } from '../../services/i18n.service';

export interface SizeOption {
  size: number;
  /** The variant exists for the selected colour. */
  available: boolean;
  /** The variant exists and has stock. */
  inStock: boolean;
}

/**
 * The "Select Size" sheet, shared by the product page and the collection card so the same
 * decision looks and behaves the same in both places.
 *
 * Sold-out sizes stay selectable on purpose: picking one is how a customer asks to be told
 * when it returns. Sizes that do not exist for the chosen colour are disabled instead.
 */
@Component({
  selector: 'cw-size-sheet',
  imports: [CommonModule, OverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './size-sheet.component.html',
  styleUrl: './size-sheet.component.scss',
})
export class SizeSheetComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (key: string): string => this.i18n.t(key);

  @Input() open = false;
  @Input() sizes: SizeOption[] = [];
  @Input() selected: number | null = null;
  /** Shown in the head when the customer tried to buy without picking a size. */
  @Input() error = '';

  @Output() readonly picked = new EventEmitter<number>();
  @Output() readonly closed = new EventEmitter<void>();
}
