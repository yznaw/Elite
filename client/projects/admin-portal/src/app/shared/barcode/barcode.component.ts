import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  ViewChild,
} from '@angular/core';
import JsBarcode from 'jsbarcode';

/**
 * A scannable Code128 barcode, drawn on the page.
 *
 * Barcodes previously existed only inside the print popup, so the only way to
 * check that a variant's code was right — or that it was there at all — was to
 * print a label and look at the paper. This renders the same code the label
 * printer renders (`LabelPrinterService` uses identical JsBarcode options), so
 * what is on screen is what comes out of the printer.
 *
 * JsBarcode is bundled, not loaded from a CDN, so this works on a till with no
 * internet. An invalid or empty value leaves the element blank rather than
 * throwing, which matters while someone is mid-typing in the barcode field.
 */
@Component({
  selector: 'ap-barcode',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<svg #svg class="barcode-svg" role="img" [attr.aria-label]="value || 'No barcode'"></svg>`,
  styles: [`
    :host { display: block; line-height: 0; }
    .barcode-svg { width: 100%; height: auto; }
  `],
})
export class BarcodeComponent implements OnChanges {
  @Input({ required: true }) value = '';
  /** Bar height in px. The default matches the printed label. */
  @Input() height = 44;
  @Input() width = 2;
  /** Print the digits under the bars. Off by default — callers usually show
      the code themselves, in their own type. */
  @Input() displayValue = false;

  @ViewChild('svg', { static: true }) svgRef!: ElementRef<SVGElement>;

  ngOnChanges(): void {
    const svg = this.svgRef?.nativeElement;
    if (!svg) return;
    const value = (this.value || '').trim();
    if (!value) {
      svg.innerHTML = '';
      return;
    }
    try {
      JsBarcode(svg, value, {
        format: 'CODE128',
        width: this.width,
        height: this.height,
        margin: 0,
        displayValue: this.displayValue,
        fontSize: 12,
      });
    } catch {
      // Code128 encodes any ASCII, so this is nearly unreachable — but a half
      // typed value should never blow up the drawer around it.
      svg.innerHTML = '';
    }
  }
}
