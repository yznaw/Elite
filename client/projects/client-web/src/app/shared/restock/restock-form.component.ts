import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { OverlayComponent } from '../overlay/overlay.component';
import { RestockService } from './restock.service';
import { I18nService } from '../../services/i18n.service';
import { Product } from '../../models/product.model';

/**
 * "Tell me when it is back" as an overlay, so the collection card no longer has to send the
 * customer to the product page to type one email address. A bottom sheet on phones, a
 * centred dialog on wider screens, with the product's own thumbnail and name in the head so
 * it still reads as belonging to the card it came from.
 */
@Component({
  selector: 'cw-restock-form',
  imports: [CommonModule, OverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './restock-form.component.html',
  styleUrl: './restock-form.component.scss',
})
export class RestockFormComponent implements OnChanges {
  private readonly restock = inject(RestockService);
  private readonly i18n = inject(I18nService);
  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);
  readonly productName = this.i18n.productName;

  @Input() open = false;

  @Input({ required: true }) product!: Product;
  @Input() image = '';
  @Input() color: string | null = null;
  /** Only sizes that exist for this colour and have no stock. */
  @Input() soldOutSizes: number[] = [];
  @Input() initialSize: number | null = null;
  @Input() hasSizes = true;

  @Output() readonly succeeded = new EventEmitter<void>();
  /** The server says it is buyable again; the page decides how to recover. */
  @Output() readonly backInStock = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly size = signal<number | null>(null);
  readonly email = signal('');
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly error = signal('');

  readonly canSubmit = computed(() => !this.submitting() && this.email().trim().length > 0);

  /*
   * Seeding happens here rather than in an `open` setter: Angular assigns inputs in template
   * order, so a setter would read `initialSize` before the card had bound it and the size the
   * customer just picked would be dropped.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.size.set(this.initialSize);
      this.email.set(this.restock.lastEmail());
      this.error.set('');
      this.submitted.set(false);
    }
  }

  onEmailInput(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    if (this.error()) this.error.set('');
  }

  onSizeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.size.set(value === '' ? null : Number(value));
    if (this.error()) this.error.set('');
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;

    this.submitting.set(true);
    this.error.set('');
    const result = await this.restock.submit({
      productId: this.product.id,
      size: this.size(),
      hasSizes: this.hasSizes,
      soldOutSizes: this.soldOutSizes,
      color: this.color,
      email: this.email(),
    });
    this.submitting.set(false);

    if (result.kind === 'ok') {
      this.submitted.set(true);
      this.succeeded.emit();
    } else if (result.kind === 'in-stock') {
      this.backInStock.emit();
    } else {
      this.error.set(this.t(result.messageKey));
    }
  }
}
