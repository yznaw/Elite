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

    const cards = labels.map((l) => this.labelCard(l)).join('');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Product Labels</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f2f2f2;padding:16px;}
  .toolbar{display:flex;justify-content:center;margin-bottom:16px;}
  .print-btn{padding:10px 22px;background:#1a1a1a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;}
  .sheet{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;}
  .label{
    width:50mm;min-height:30mm;background:#fff;border:1px solid #ccc;border-radius:4px;
    padding:4mm;display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;gap:2px;break-inside:avoid;page-break-inside:avoid;
  }
  .label-brand{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#666;}
  .label-name{font-size:11px;font-weight:700;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .label-variant{font-size:9.5px;color:#444;}
  .label-barcode svg{width:100%;height:auto;max-height:14mm;}
  .label-code{font-size:8.5px;font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:.03em;color:#333;}
  .label-price{font-size:11px;font-weight:700;margin-top:2px;}
  @media print{
    body{background:#fff;padding:0;}
    .toolbar{display:none;}
    .sheet{gap:2mm;}
    @page{margin:8mm;}
  }
</style>
</head>
<body>
  <div class="toolbar"><button class="print-btn" onclick="window.print()">Print ${labels.length} Label${labels.length > 1 ? 's' : ''}</button></div>
  <div class="sheet">${cards}</div>
</body>
</html>`;

    win.document.write(html);
    win.document.close();
  }

  private labelCard(l: VariantLabelData): string {
    return `
      <div class="label">
        <div class="label-brand">${escapeHtml(l.brand)}</div>
        <div class="label-name">${escapeHtml(l.productName)}</div>
        ${l.variantLabel ? `<div class="label-variant">${escapeHtml(l.variantLabel)}</div>` : ''}
        <div class="label-barcode">${this.renderBarcodeSvg(l.barcode)}</div>
        <div class="label-code">${escapeHtml(l.barcode)}</div>
        <div class="label-price">${escapeHtml(l.currency)} ${l.price.toFixed(2)}</div>
      </div>`;
  }
}
