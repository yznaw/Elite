import { Injectable } from '@angular/core';
import JsBarcode from 'jsbarcode';

export interface VariantLabelData {
  brand: string;
  productName: string;
  variantLabel: string;
  sku: string;
  barcode: string;
  price: number;
  currency: string;
}

/**
 * The price as it is written in Arabic: Arabic-Indic digits, the Arabic
 * decimal separator, and ر.ق after the number.
 *
 * `Intl` already knows all of this — `ar-QA` with `latn` numbering would give
 * Western digits, so the `-u-nu-arab` extension asks for the Arabic-Indic set
 * explicitly rather than transliterating digits by hand.
 */
export function arabicPrice(amount: number): string {
  try {
    return new Intl.NumberFormat('ar-QA-u-nu-arab', {
      style: 'currency',
      currency: 'QAR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Old engines without the Arabic numbering extension still get a readable
    // label rather than an empty line.
    return `${amount.toFixed(2)} ر.ق`;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders Code128 product-variant labels (name, variant, price, scannable
 * barcode) to a print-ready popup window — same window.open + window.print
 * pattern already used for order invoices. No CDN dependency: JsBarcode is
 * bundled, and the barcode is drawn to an in-memory SVG node before the
 * popup document is written, so this works fully offline.
 */
@Injectable({ providedIn: 'root' })
export class LabelPrinterService {
  private renderBarcodeSvg(value: string): string {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value || ' ', {
      format: 'CODE128',
      width: 2,
      height: 44,
      margin: 0,
      displayValue: false,
    });
    return new XMLSerializer().serializeToString(svg);
  }

  printLabels(labels: VariantLabelData[]): void {
    if (labels.length === 0) return;
    // No 'noopener'/'noreferrer' here: per spec, window.open() returns null
    // whenever either is passed (even though the window still opens), which
    // silently breaks writing the label content into it. This popup only
    // ever renders content this service writes itself — no external
    // navigation happens — so the tabnabbing risk those flags guard against
    // doesn't apply here. Matches the existing invoice-print pattern in
    // order-drawer.component.ts.
    const win = window.open('', '_blank');
    if (!win) return;

    const cards = labels.map((l, i) => this.labelCard(l, i === labels.length - 1)).join('');
    const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8">
<title>Product Labels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f2f2f2;padding:16px;display:flex;flex-direction:column;align-items:center;}
  .toolbar{margin-bottom:16px;}
  .print-btn{padding:10px 22px;background:#1a1a1a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;}
  /* 80mm-wide continuous roll: labels stack one after another down the
     strip, not side-by-side — this is receipt paper, not die-cut label
     stock. A dashed line marks where to cut by hand between labels, since
     browser printing has no way to send a partial-cut command mid-job. */
  .sheet{width:76mm;background:#fff;}
  .label{
    width:100%; padding:3mm 2mm; display:flex; flex-direction:column;
    align-items:center; justify-content:center; text-align:center; gap:2px;
    break-inside:avoid; page-break-inside:avoid;
  }
  .cut-line{border-top:1px dashed #999; margin:0 2mm;}
  /* Thermal print heads reproduce solid black reliably but under-ink light
     grays and thin strokes, so anything meant to stay legible on the roll
     (brand, SKU code) is pure black and bold rather than a "subtle" gray —
     #666/#333 at normal weight came out faded to the point of being
     unreadable on an actual print. */
  .label-brand{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#000;}
  .label-name{font-size:11px;font-weight:700;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .label-variant{font-size:9.5px;font-weight:600;color:#000;}
  .label-barcode svg{width:100%;height:auto;max-height:14mm;}
  .label-code{font-size:10px;font-weight:700;font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:.03em;color:#000;}
  /* Both prices on one line: QAR on the left, the Arabic reading of the same
     number on the right. Full label width so they sit at the two edges.
     Sized up from the rest of the label since the price is the one line a
     cashier actually reads off the label at a glance. */
  .label-price-row{display:flex;align-items:baseline;justify-content:space-between;width:100%;gap:6px;margin-top:3px;padding:0 1mm;}
  .label-price{font-size:15px;font-weight:700;color:#000;}
  /* Its own direction, and a font stack that actually has Arabic glyphs —
     Helvetica alone renders these as boxes on a Windows till. */
  .label-price-ar{direction:rtl;font-family:'Segoe UI','Tahoma','Arial Unicode MS',sans-serif;font-size:15px;font-weight:700;color:#000;}
  .feed-tail{height:12mm;}
  @media print{
    /* Fixed 80mm width. "auto" height alone isn't reliable across printer
       drivers: it once fed through a driver-reported page several metres
       long (a blank strip), and on other drivers it under-measures
       instead, silently pushing the last row (the price line) past the
       computed page boundary so it never physically prints. This is the
       fallback; printLabels() below measures the real rendered content
       and appends a <style> overriding it with a concrete mm value. */
    @page{size:80mm auto; margin:0;}
    body{background:#fff;padding:0;}
    .toolbar{display:none;}
  }
</style>
</head>
<body>
  <div class="toolbar"><button class="print-btn" onclick="window.print()">Print ${labels.length} Label${labels.length > 1 ? 's' : ''}</button></div>
  <div class="sheet">${cards}<div class="feed-tail"></div></div>
</body>
</html>`;

    win.document.write(html);
    win.document.close();

    // Override the "auto" fallback with the sheet's real rendered height,
    // converted from px to mm (96 CSS px per inch, 25.4mm per inch). A few
    // mm of buffer absorbs sub-pixel rounding differences between the
    // on-screen layout pass and the print rasterizer, so the price row
    // (always the last thing in a label) doesn't land just past the edge.
    const sheet = win.document.querySelector('.sheet') as HTMLElement | null;
    if (sheet) {
      const heightMm = (sheet.getBoundingClientRect().height / 96) * 25.4 + 4;
      const pageStyle = win.document.createElement('style');
      pageStyle.textContent = `@media print{@page{size:80mm ${heightMm.toFixed(1)}mm; margin:0;}}`;
      win.document.head.appendChild(pageStyle);
    }
  }

  private labelCard(l: VariantLabelData, isLast: boolean): string {
    return `
      <div class="label">
        <div class="label-brand">${escapeHtml(l.brand)}</div>
        <div class="label-name">${escapeHtml(l.productName)}</div>
        ${l.variantLabel ? `<div class="label-variant">${escapeHtml(l.variantLabel)}</div>` : ''}
        <div class="label-barcode">${this.renderBarcodeSvg(l.barcode)}</div>
        <div class="label-code">${escapeHtml(l.barcode)}</div>
        <div class="label-price-row">
          <span class="label-price">${escapeHtml(l.currency)} ${l.price.toFixed(2)}</span>
          <span class="label-price-ar">${escapeHtml(arabicPrice(l.price))}</span>
        </div>
      </div>${isLast ? '' : '<div class="cut-line"></div>'}`;
  }
}
