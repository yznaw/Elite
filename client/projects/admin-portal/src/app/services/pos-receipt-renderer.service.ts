import { Injectable } from '@angular/core';
import { PosBusinessProfile } from './pos.service';

export interface PosReceiptLine {
  name: string;
  variant?: string;
  sku?: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PosReceiptData {
  kind?: 'sale' | 'refund';
  receiptNumber: string;
  transactionId?: string;
  refundId?: string;
  createdAt: string;
  cashierName?: string;
  registerId?: string;
  registerName?: string;
  paymentMethod?: 'cash' | 'card';
  method?: 'cash' | 'card';
  terminalReference?: string;
  items?: PosReceiptLine[];
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  amountCents?: number;
  amountTenderedCents?: number;
  changeGivenCents?: number;
  reason?: string;
  lookupCode?: string;
}

/** Rendered receipt ready to hand to QZ Tray. */
export interface PosRenderedReceipt {
  /** PNG data URL, rasterized bilingual (Arabic + English) receipt body. */
  imageDataUrl: string;
  /** Raw ESC/POS command bytes for the QR code + cut, appended after the image. */
  footerCommands: string;
}

const QATAR_TIME_ZONE = 'Asia/Qatar';

/**
 * Renders receipts onto an HTML5 canvas instead of building a raw ESC/POS
 * text string. Arabic text needs correct letter shaping and right-to-left
 * layout, which ESC/POS text mode cannot do at all (it prints whatever code
 * page bytes you send, with no shaping) — the canvas approach lets the
 * browser's own text layout engine do that work, and the result is sent to
 * the printer as a raster image (see pos-hardware.service.ts, which prints
 * this through QZ Tray's `format: 'image'` + `language: 'escpos'` path).
 */
@Injectable({ providedIn: 'root' })
export class PosReceiptRenderer {
  /**
   * SRP-QE300 spec: 80mm media, 180dpi, but only 72mm is actually printable
   * (confirmed by a real test print — 576px, sized for 80mm at 203dpi, cut
   * off the right ~15% of every line). 72mm / 25.4mm-per-inch * 180dpi ≈ 510px.
   */
  private readonly widthPx = 510;
  private readonly marginPx = 24;
  private readonly lineHeightPx = 30;
  private readonly smallLineHeightPx = 24;

  render(receipt: PosReceiptData, profile: PosBusinessProfile | null): PosRenderedReceipt {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available for receipt rendering.');

    // First pass at a generous height to measure; canvas is re-sized to the
    // actual content height in the second pass so there's no blank tail.
    canvas.width = this.widthPx;
    canvas.height = 4000;
    let y = this.paint(ctx, receipt, profile);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = this.widthPx;
    finalCanvas.height = Math.ceil(y) + this.marginPx;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error('Canvas 2D context is not available for receipt rendering.');
    this.paint(finalCtx, receipt, profile);

    return {
      imageDataUrl: finalCanvas.toDataURL('image/png'),
      footerCommands: this.footerCommands(receipt),
    };
  }

  /** ESC/POS QR + cut, appended as raw commands after the rasterized image. */
  private footerCommands(receipt: PosReceiptData): string {
    const gs = '\x1d';
    const lookup = receipt.lookupCode || `#${receipt.receiptNumber}`;
    return this.qrCode(lookup) + gs + 'V' + '\x01';
  }

  private qrCode(data: string): string {
    const gs = '\x1d';
    const bytes = `${data}`;
    const storeLen = bytes.length + 3;
    const pL = String.fromCharCode(storeLen % 256);
    const pH = String.fromCharCode(Math.floor(storeLen / 256));
    return [
      gs + '(k' + '\x04\x00\x31\x41\x32\x00',
      gs + '(k' + '\x03\x00\x31\x43\x06',
      gs + '(k' + '\x03\x00\x31\x45\x31',
      gs + '(k' + pL + pH + '\x31\x50\x30' + bytes,
      gs + '(k' + '\x03\x00\x31\x51\x30',
    ].join('');
  }

  drawerCommand(pin: 'epson-pin-2' | 'epson-pin-5'): string {
    const pinByte = pin === 'epson-pin-2' ? '\x00' : '\x01';
    return '\x1b' + 'p' + pinByte + '\x32' + '\x32';
  }

  /** Paints the full receipt and returns the final Y cursor (content height). */
  private paint(ctx: CanvasRenderingContext2D, receipt: PosReceiptData, profile: PosBusinessProfile | null): number {
    const width = this.widthPx;
    const centerX = width / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, ctx.canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = this.marginPx;
    const amount = receipt.kind === 'refund' ? receipt.amountCents ?? 0 : receipt.totalCents ?? 0;

    // Header: bilingual trade name, address, phone.
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(profile?.tradeNameEn || 'Elite Collection', centerX, y);
    y += 42;
    if (profile?.tradeNameAr) {
      ctx.font = 'bold 30px Arial';
      ctx.fillText(this.shapeArabic(profile.tradeNameAr), centerX, y);
      y += 38;
    }
    y += 6;

    ctx.font = '20px Arial';
    if (profile?.addressEn) { ctx.fillText(profile.addressEn, centerX, y); y += this.smallLineHeightPx; }
    if (profile?.addressAr) { ctx.fillText(this.shapeArabic(profile.addressAr), centerX, y); y += this.smallLineHeightPx; }
    if (profile?.phone) { ctx.fillText(profile.phone, centerX, y); y += this.smallLineHeightPx; }
    y += 10;

    y = this.rule(ctx, y);

    ctx.font = 'bold 26px Arial';
    ctx.fillText(receipt.kind === 'refund' ? 'REFUND RECEIPT' : 'SALE RECEIPT', centerX, y);
    y += this.lineHeightPx;
    ctx.font = '22px Arial';
    ctx.fillText(`#${receipt.receiptNumber}`, centerX, y);
    y += this.lineHeightPx;
    ctx.fillText(this.formatQatarDateTime(receipt.createdAt), centerX, y);
    y += this.lineHeightPx + 6;

    ctx.textAlign = 'left';
    ctx.font = '20px Arial';
    if (receipt.cashierName) { ctx.fillText(`Cashier: ${receipt.cashierName}`, this.marginPx, y); y += this.smallLineHeightPx; }
    if (receipt.registerName) { ctx.fillText(`Register: ${receipt.registerName}`, this.marginPx, y); y += this.smallLineHeightPx; }
    y += 6;
    y = this.rule(ctx, y);

    ctx.font = '22px Arial';
    for (const item of receipt.items ?? []) {
      ctx.fillText(item.name, this.marginPx, y);
      y += this.smallLineHeightPx;
      if (item.variant) { ctx.fillText(item.variant, this.marginPx, y); y += this.smallLineHeightPx; }
      if (item.sku) {
        ctx.font = '18px Arial';
        ctx.fillText(`SKU ${item.sku}`, this.marginPx, y);
        y += this.smallLineHeightPx;
        ctx.font = '22px Arial';
      }
      y = this.columns(ctx, `${item.quantity} x ${this.money(item.unitPriceCents)}`, this.money(item.lineTotalCents), y);
    }
    y += 4;
    y = this.rule(ctx, y);

    if (receipt.kind !== 'refund') {
      y = this.columns(ctx, 'Subtotal', this.money(receipt.subtotalCents ?? 0), y);
      y = this.columns(ctx, 'Tax', this.money(receipt.taxCents ?? 0), y);
    }
    ctx.font = 'bold 26px Arial';
    y = this.columns(ctx, receipt.kind === 'refund' ? 'REFUND' : 'TOTAL', this.money(amount), y);
    ctx.font = '22px Arial';
    y = this.columns(ctx, 'Payment', String(receipt.paymentMethod || receipt.method || '').toUpperCase(), y);
    if (receipt.terminalReference) {
      y = this.columns(ctx, 'Terminal ref', receipt.terminalReference, y);
    }
    if (receipt.kind !== 'refund' && (receipt.paymentMethod || receipt.method) === 'cash') {
      y = this.columns(ctx, 'Tendered', this.money(receipt.amountTenderedCents ?? 0), y);
      y = this.columns(ctx, 'Change', this.money(receipt.changeGivenCents ?? 0), y);
    }
    if (receipt.reason) {
      ctx.font = '18px Arial';
      y = this.wrapText(ctx, `Reason: ${receipt.reason}`, this.marginPx, y, width - this.marginPx * 2);
      ctx.font = '22px Arial';
    }
    y += 4;
    y = this.rule(ctx, y);

    // Return policy, bilingual, if configured.
    if (profile?.returnPolicyEn || profile?.returnPolicyAr) {
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      if (profile.returnPolicyEn) y = this.wrapText(ctx, profile.returnPolicyEn, this.marginPx, y, width - this.marginPx * 2, true);
      if (profile.returnPolicyAr) y = this.wrapText(ctx, this.shapeArabic(profile.returnPolicyAr), this.marginPx, y, width - this.marginPx * 2, true);
      y += 6;
    }

    if (profile?.crLicenseNumber) {
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`CR/License: ${profile.crLicenseNumber}`, centerX, y);
      y += this.smallLineHeightPx;
    }

    if (profile?.footerStampEn || profile?.footerStampAr) {
      ctx.font = 'italic 16px Arial';
      ctx.textAlign = 'center';
      if (profile.footerStampEn) { ctx.fillText(profile.footerStampEn, centerX, y); y += this.smallLineHeightPx; }
      if (profile.footerStampAr) { ctx.fillText(this.shapeArabic(profile.footerStampAr), centerX, y); y += this.smallLineHeightPx; }
    }

    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    y += 6;
    ctx.fillText('Thank you', centerX, y);
    y += this.lineHeightPx;

    return y;
  }

  /**
   * Canvas's 2D text API does not run the Unicode bidi algorithm on its own
   * for a string drawn via fillText — but it DOES shape and reorder Arabic
   * correctly as long as the string's *character order* is already logical
   * (which it is, since these come from the DB as authored Arabic text) and
   * `direction` is set to rtl so combining/joining forms render properly.
   * Toggling ctx.direction per-call would work too; using the Unicode RTL
   * embedding marks is simpler and doesn't require touching canvas state.
   */
  private shapeArabic(value: string): string {
    return '‫' + value + '‬'; // RLE ... PDF (right-to-left embedding)
  }

  private rule(ctx: CanvasRenderingContext2D, y: number): number {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.marginPx, y);
    ctx.lineTo(this.widthPx - this.marginPx, y);
    ctx.stroke();
    return y + 14;
  }

  private columns(ctx: CanvasRenderingContext2D, left: string, right: string, y: number): number {
    ctx.textAlign = 'left';
    ctx.fillText(left, this.marginPx, y);
    ctx.textAlign = 'right';
    ctx.fillText(right, this.widthPx - this.marginPx, y);
    ctx.textAlign = 'left';
    return y + this.lineHeightPx;
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, center = false): number {
    const words = text.split(' ');
    let line = '';
    let cursorY = y;
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && line) {
        ctx.fillText(line, center ? this.widthPx / 2 : x, cursorY);
        line = word;
        cursorY += this.smallLineHeightPx;
      } else {
        line = attempt;
      }
    }
    if (line) {
      ctx.fillText(line, center ? this.widthPx / 2 : x, cursorY);
      cursorY += this.smallLineHeightPx;
    }
    return cursorY;
  }

  private money(cents: number): string {
    return `QAR ${(Number(cents) / 100).toFixed(2)}`;
  }

  private formatQatarDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: QATAR_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
}
