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

/** Z-report print data — a cash/sales summary, not a per-item receipt. */
export interface PosZReportPrintData {
  zReportId: string;
  registerName?: string;
  cashierName?: string;
  createdAt: string;
  openingFloatCents: number;
  grossSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  refundTotalCents: number;
  voidTotalCents: number;
  netSalesCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCashCents: number;
  physicalCashCents: number;
  varianceCents: number;
  transactionCount: number;
  refundCount: number;
  voidCount: number;
}

const QATAR_TIME_ZONE = 'Asia/Qatar';
const LOGO_URL = '/assets/brand/elite-logo-green.png';

/**
 * Renders receipts onto an HTML5 canvas instead of building a raw ESC/POS
 * text string. Arabic text needs correct letter shaping and right-to-left
 * layout, which ESC/POS text mode cannot do at all (it prints whatever code
 * page bytes you send, with no shaping) — the canvas approach lets the
 * browser's own text layout engine do that work, and the result is sent to
 * the printer as a raster image (see pos-hardware.service.ts, which prints
 * this through QZ Tray's `format: 'image'` + `language: 'escpos'` path).
 *
 * Design direction: quiet editorial confidence rather than a dense register
 * tape — the wordmark gets one deliberate moment at the top, hierarchy comes
 * from weight/size and whitespace rather than stacking horizontal rules, and
 * every line pulls its weight (no decorative "COPY" banners, no filler).
 */
@Injectable({ providedIn: 'root' })
export class PosReceiptRenderer {
  /**
   * SRP-QE300 spec: 80mm media, 180dpi, but only 72mm is actually printable
   * (confirmed by a real test print — 576px, sized for 80mm at 203dpi, cut
   * off the right ~15% of every line). 72mm / 25.4mm-per-inch * 180dpi ≈ 510px.
   */
  private readonly widthPx = 510;
  private readonly marginPx = 28;
  private readonly lineHeightPx = 30;
  private readonly smallLineHeightPx = 24;

  /** Brand serif for the wordmark-adjacent register (name, totals) — pairs
   *  with the logo's serif-flavored letterforms. Arial stays for dense
   *  tabular data (line items, SKUs) where a serif costs legibility at
   *  small sizes. Both ship with Windows, so no webfont-loading risk on a
   *  register that may print before a font is ready. */
  private readonly displayFont = 'Georgia';
  private readonly bodyFont = 'Arial';

  private logoImage: HTMLImageElement | null = null;
  private logoLoadFailed = false;

  private async loadLogo(): Promise<HTMLImageElement | null> {
    if (this.logoImage) return this.logoImage;
    if (this.logoLoadFailed) return null;
    try {
      const image = new Image();
      image.src = LOGO_URL;
      await image.decode();
      this.logoImage = image;
      return image;
    } catch {
      // Printing must not fail because the logo asset is missing/offline —
      // fall back to the plain trade-name text header.
      this.logoLoadFailed = true;
      return null;
    }
  }

  async render(receipt: PosReceiptData, profile: PosBusinessProfile | null): Promise<PosRenderedReceipt> {
    const logo = await this.loadLogo();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available for receipt rendering.');

    // First pass at a generous height to measure; canvas is re-sized to the
    // actual content height in the second pass so there's no blank tail.
    canvas.width = this.widthPx;
    canvas.height = 4000;
    let y = this.paint(ctx, receipt, profile, logo);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = this.widthPx;
    finalCanvas.height = Math.ceil(y) + this.marginPx;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error('Canvas 2D context is not available for receipt rendering.');
    this.paint(finalCtx, receipt, profile, logo);

    return {
      imageDataUrl: finalCanvas.toDataURL('image/png'),
      footerCommands: this.footerCommands(receipt),
    };
  }

  /**
   * Z-report: a cash/sales summary for a closed shift, not a per-item
   * receipt — no line items, no customer-facing QR lookup. Reuses the same
   * canvas two-pass sizing and column/rule helpers as `render()`.
   */
  async renderZReport(report: PosZReportPrintData, profile: PosBusinessProfile | null): Promise<PosRenderedReceipt> {
    const logo = await this.loadLogo();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available for receipt rendering.');

    canvas.width = this.widthPx;
    canvas.height = 4000;
    let y = this.paintZReport(ctx, report, profile, logo);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = this.widthPx;
    finalCanvas.height = Math.ceil(y) + this.marginPx;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error('Canvas 2D context is not available for receipt rendering.');
    this.paintZReport(finalCtx, report, profile, logo);

    return {
      imageDataUrl: finalCanvas.toDataURL('image/png'),
      footerCommands: '\x1d' + 'V' + '\x01', // plain cut, no QR — a Z-report has nothing to look up
    };
  }

  private paintZReport(
    ctx: CanvasRenderingContext2D,
    report: PosZReportPrintData,
    profile: PosBusinessProfile | null,
    logo: HTMLImageElement | null,
  ): number {
    const width = this.widthPx;
    const centerX = width / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, ctx.canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = this.marginPx + 8;
    if (logo) {
      const logoWidth = Math.min(230, width * 0.46);
      const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth);
      this.drawThresholdedImage(ctx, logo, centerX - logoWidth / 2, y, logoWidth, logoHeight);
      y += logoHeight + 16;
    } else {
      ctx.font = `italic 34px ${this.displayFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(profile?.tradeNameEn || 'Elite Collection', centerX, y);
      y += 44;
    }
    y += 10;

    ctx.font = `600 16px ${this.bodyFont}`;
    ctx.textAlign = 'center';
    this.fillTextTracked(ctx, 'Z REPORT', centerX, y, 3);
    y += 26;
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#555';
    ctx.fillText(this.formatQatarDateTime(report.createdAt), centerX, y);
    ctx.fillStyle = '#000';
    y += 22;
    if (report.registerName || report.cashierName) {
      ctx.font = `13px ${this.bodyFont}`;
      ctx.fillStyle = '#555';
      ctx.fillText([report.cashierName, report.registerName].filter(Boolean).join('  ·  '), centerX, y);
      ctx.fillStyle = '#000';
      y += 22;
    }
    y += 8;
    y = this.rule(ctx, y);
    y += 16;

    ctx.font = `14px ${this.bodyFont}`;
    y = this.columns(ctx, 'Opening float', this.money(report.openingFloatCents), y);
    y = this.columns(ctx, 'Gross sales', this.money(report.grossSalesCents), y);
    y = this.columns(ctx, 'Cash sales', this.money(report.cashSalesCents), y);
    y = this.columns(ctx, 'Card sales', this.money(report.cardSalesCents), y);
    y = this.columns(ctx, 'Refunds', this.money(-report.refundTotalCents), y);
    y = this.columns(ctx, 'Voids', this.money(-report.voidTotalCents), y);
    y += 4;
    y = this.rule(ctx, y);
    y += 14;
    ctx.font = `600 18px ${this.displayFont}`;
    y = this.columns(ctx, 'Net sales', this.money(report.netSalesCents), y);
    y += 8;
    ctx.font = `14px ${this.bodyFont}`;
    y = this.columns(ctx, 'Cash paid in', this.money(report.cashInCents), y);
    y = this.columns(ctx, 'Cash paid out', this.money(-report.cashOutCents), y);
    y += 4;
    y = this.rule(ctx, y);
    y += 14;
    y = this.columns(ctx, 'Expected cash', this.money(report.expectedCashCents), y);
    y = this.columns(ctx, 'Physical cash', this.money(report.physicalCashCents), y);
    ctx.font = `600 16px ${this.bodyFont}`;
    if (report.varianceCents !== 0) ctx.fillStyle = report.varianceCents < 0 ? '#9e3e24' : '#1c6b3f';
    y = this.columns(ctx, 'Variance', this.money(report.varianceCents), y);
    ctx.fillStyle = '#000';
    y += 10;
    y = this.rule(ctx, y);
    y += 16;

    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#555';
    y = this.columns(ctx, 'Transactions', String(report.transactionCount), y);
    y = this.columns(ctx, 'Refunds', String(report.refundCount), y);
    y = this.columns(ctx, 'Voids', String(report.voidCount), y);
    ctx.fillStyle = '#000';
    y += 20;

    return y;
  }

  /**
   * ESC/POS QR + cut, appended as raw commands after the rasterized image.
   * A feed of blank lines is inserted between the QR print command and the
   * cut command — the QR renders printer-side (module size 4 ≈ 0.56mm/module
   * at 180dpi), and a real test print showed the auto-cutter slicing through
   * it because no gap was reserved after it. `\x1b d n` feeds n lines before
   * the cut fires, guaranteeing clear paper below the QR regardless of how
   * tall it renders for a given payload length.
   */
  private footerCommands(receipt: PosReceiptData): string {
    const gs = '\x1d';
    const esc = '\x1b';
    const lookup = receipt.lookupCode || `#${receipt.receiptNumber}`;
    const feedLines = '\x06'; // 6 lines ≈ well clear of the largest QR this payload will ever produce
    return this.qrCode(lookup) + esc + 'd' + feedLines + gs + 'V' + '\x01';
  }

  private qrCode(data: string): string {
    const gs = '\x1d';
    const bytes = `${data}`;
    const storeLen = bytes.length + 3;
    const pL = String.fromCharCode(storeLen % 256);
    const pH = String.fromCharCode(Math.floor(storeLen / 256));
    return [
      gs + '(k' + '\x04\x00\x31\x41\x32\x00', // select model 2
      gs + '(k' + '\x03\x00\x31\x43\x04', // module size 4 (small, deliberate — not a dominant block)
      gs + '(k' + '\x03\x00\x31\x45\x31', // error correction level M
      gs + '(k' + pL + pH + '\x31\x50\x30' + bytes, // store data
      gs + '(k' + '\x03\x00\x31\x51\x30', // print
    ].join('');
  }

  drawerCommand(pin: 'epson-pin-2' | 'epson-pin-5'): string {
    const pinByte = pin === 'epson-pin-2' ? '\x00' : '\x01';
    return '\x1b' + 'p' + pinByte + '\x32' + '\x32';
  }

  /** Paints the full receipt and returns the final Y cursor (content height). */
  private paint(
    ctx: CanvasRenderingContext2D,
    receipt: PosReceiptData,
    profile: PosBusinessProfile | null,
    logo: HTMLImageElement | null,
  ): number {
    const width = this.widthPx;
    const centerX = width / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, ctx.canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = this.marginPx + 8;
    const amount = receipt.kind === 'refund' ? receipt.amountCents ?? 0 : receipt.totalCents ?? 0;

    // Wordmark: the real brand logo, thresholded to pure black so it stays
    // crisp on a thermal head instead of dithering into grey mush. Falls
    // back to the plain trade name if the asset couldn't load.
    if (logo) {
      const logoWidth = Math.min(230, width * 0.46);
      const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth);
      this.drawThresholdedImage(ctx, logo, centerX - logoWidth / 2, y, logoWidth, logoHeight);
      y += logoHeight + 16;
    } else {
      ctx.font = `italic 34px ${this.displayFont}`;
      ctx.textAlign = 'center';
      ctx.fillText(profile?.tradeNameEn || 'Elite Collection', centerX, y);
      y += 44;
    }

    ctx.textAlign = 'center';
    if (profile?.tradeNameEn) {
      ctx.font = `600 15px ${this.bodyFont}`;
      ctx.save();
      ctx.textAlign = 'center';
      this.fillTextTracked(ctx, profile.tradeNameEn.toUpperCase(), centerX, y, 2.5);
      ctx.restore();
      y += 22;
    }
    if (profile?.tradeNameAr) {
      ctx.font = `20px ${this.displayFont}`;
      ctx.fillText(this.shapeArabic(profile.tradeNameAr), centerX, y);
      y += 28;
    }
    y += 10;

    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#333';
    if (profile?.addressEn) { ctx.fillText(profile.addressEn, centerX, y); y += 19; }
    if (profile?.addressAr) { ctx.fillText(this.shapeArabic(profile.addressAr), centerX, y); y += 19; }
    if (profile?.phone) { ctx.fillText(profile.phone, centerX, y); y += 19; }
    ctx.fillStyle = '#000';
    y += 20;

    // A single hairline under the header block — the one structural divider
    // that earns its place, separating "who we are" from "what happened."
    y = this.rule(ctx, y);
    y += 14;

    ctx.font = `600 16px ${this.bodyFont}`;
    ctx.textAlign = 'center';
    this.fillTextTracked(ctx, (receipt.kind === 'refund' ? 'REFUND' : 'RECEIPT').toUpperCase(), centerX, y, 3);
    y += 24;
    ctx.font = `22px ${this.displayFont}`;
    ctx.fillText(`No. ${receipt.receiptNumber}`, centerX, y);
    y += 26;
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#555';
    ctx.fillText(this.formatQatarDateTime(receipt.createdAt), centerX, y);
    ctx.fillStyle = '#000';
    y += 30;

    ctx.textAlign = 'left';
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#555';
    const meta: string[] = [];
    if (receipt.cashierName) meta.push(receipt.cashierName);
    if (receipt.registerName) meta.push(receipt.registerName);
    if (meta.length) { ctx.textAlign = 'center'; ctx.fillText(meta.join('  ·  '), centerX, y); y += 22; }
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    y += 8;
    y = this.rule(ctx, y);
    y += 16;

    ctx.font = `15px ${this.bodyFont}`;
    for (const item of receipt.items ?? []) {
      ctx.font = `500 15px ${this.bodyFont}`;
      ctx.fillText(item.name, this.marginPx, y);
      y += this.smallLineHeightPx;
      if (item.variant) {
        ctx.font = `13px ${this.bodyFont}`;
        ctx.fillStyle = '#666';
        ctx.fillText(item.variant, this.marginPx, y);
        ctx.fillStyle = '#000';
        y += 20;
      }
      if (item.sku) {
        ctx.font = `12px ${this.bodyFont}`;
        ctx.fillStyle = '#999';
        ctx.fillText(item.sku, this.marginPx, y);
        ctx.fillStyle = '#000';
        y += 18;
      }
      ctx.font = `15px ${this.bodyFont}`;
      y = this.columns(ctx, `${item.quantity} × ${this.money(item.unitPriceCents)}`, this.money(item.lineTotalCents), y);
      y += 6;
    }
    y += 4;
    y = this.rule(ctx, y);
    y += 16;

    ctx.font = `14px ${this.bodyFont}`;
    if (receipt.kind !== 'refund') {
      y = this.columns(ctx, 'Subtotal', this.money(receipt.subtotalCents ?? 0), y);
      y = this.columns(ctx, 'Tax', this.money(receipt.taxCents ?? 0), y);
      y += 8;
    }
    ctx.font = `600 20px ${this.displayFont}`;
    y = this.columns(ctx, receipt.kind === 'refund' ? 'Refund total' : 'Total', this.money(amount), y);
    y += 12;
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = '#555';
    y = this.columns(ctx, 'Payment', String(receipt.paymentMethod || receipt.method || '').toUpperCase(), y);
    if (receipt.terminalReference) {
      y = this.columns(ctx, 'Terminal ref', receipt.terminalReference, y);
    }
    if (receipt.kind !== 'refund' && (receipt.paymentMethod || receipt.method) === 'cash') {
      y = this.columns(ctx, 'Tendered', this.money(receipt.amountTenderedCents ?? 0), y);
      y = this.columns(ctx, 'Change', this.money(receipt.changeGivenCents ?? 0), y);
    }
    ctx.fillStyle = '#000';
    if (receipt.reason) {
      ctx.font = `13px ${this.bodyFont}`;
      y += 4;
      y = this.wrapText(ctx, `Reason: ${receipt.reason}`, this.marginPx, y, width - this.marginPx * 2);
    }
    y += 10;
    y = this.rule(ctx, y);
    y += 18;

    // Return policy, bilingual, if configured.
    if (profile?.returnPolicyEn || profile?.returnPolicyAr) {
      ctx.font = `12px ${this.bodyFont}`;
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      if (profile.returnPolicyEn) y = this.wrapText(ctx, profile.returnPolicyEn, this.marginPx, y, width - this.marginPx * 2, true);
      if (profile.returnPolicyAr) y = this.wrapText(ctx, this.shapeArabic(profile.returnPolicyAr), this.marginPx, y, width - this.marginPx * 2, true);
      ctx.fillStyle = '#000';
      y += 10;
    }

    if (profile?.crLicenseNumber) {
      ctx.font = `11px ${this.bodyFont}`;
      ctx.fillStyle = '#999';
      ctx.textAlign = 'center';
      ctx.fillText(`CR ${profile.crLicenseNumber}`, centerX, y);
      ctx.fillStyle = '#000';
      y += 18;
    }

    if (profile?.footerStampEn || profile?.footerStampAr) {
      ctx.font = `italic 12px ${this.displayFont}`;
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      if (profile.footerStampEn) { ctx.fillText(profile.footerStampEn, centerX, y); y += 18; }
      if (profile.footerStampAr) { ctx.fillText(this.shapeArabic(profile.footerStampAr), centerX, y); y += 18; }
      ctx.fillStyle = '#000';
    }

    y += 14;
    ctx.font = `italic 16px ${this.displayFont}`;
    ctx.textAlign = 'center';
    ctx.fillText('Thank you', centerX, y);
    y += 30;

    // QR lookup code: small, captioned, deliberately unobtrusive — a
    // convenience for refund/exchange lookup, not a focal element.
    y += 10;
    ctx.font = `10px ${this.bodyFont}`;
    ctx.fillStyle = '#999';
    ctx.fillText('SCAN TO LOOK UP THIS SALE', centerX, y);
    ctx.fillStyle = '#000';
    // Reserve space for the physically-printed QR code below the image.
    // Module size 4 at 180dpi ≈ 0.56mm/module; a short lookup code fits a
    // version 1-2 QR (21-25 modules/side) ≈ 100-140px tall. The feed lines
    // in footerCommands() add further clearance before the cut, but the
    // image itself should already leave the QR's expected footprint clear.
    y += 140;

    return y;
  }

  /**
   * Draws the logo image thresholded to pure black-or-transparent so it
   * survives an 1-bit thermal print head cleanly instead of dithering into
   * grey noise. Any pixel with meaningful opacity becomes solid black;
   * everything else stays white.
   */
  private drawThresholdedImage(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(width));
    off.height = Math.max(1, Math.round(height));
    const offCtx = off.getContext('2d');
    if (!offCtx) {
      ctx.drawImage(image, x, y, width, height);
      return;
    }
    offCtx.drawImage(image, 0, 0, off.width, off.height);
    const imageData = offCtx.getImageData(0, 0, off.width, off.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      const solid = alpha > 96;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = solid ? 255 : 0;
    }
    offCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(off, x, y, width, height);
  }

  /** Letter-spaced small-caps label — canvas has no letter-spacing API, so
   *  this draws char-by-char with manual advance. Used sparingly for the
   *  one or two eyebrow-style labels that earn the emphasis. */
  private fillTextTracked(ctx: CanvasRenderingContext2D, text: string, centerX: number, y: number, trackingPx: number): void {
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const totalWidth = widths.reduce((sum, w) => sum + w, 0) + trackingPx * (text.length - 1);
    let cursor = centerX - totalWidth / 2;
    const originalAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    [...text].forEach((ch, i) => {
      ctx.fillText(ch, cursor, y);
      cursor += widths[i] + trackingPx;
    });
    ctx.textAlign = originalAlign;
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
    return y;
  }

  private columns(ctx: CanvasRenderingContext2D, left: string, right: string, y: number): number {
    const originalAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    ctx.fillText(left, this.marginPx, y);
    ctx.textAlign = 'right';
    ctx.fillText(right, this.widthPx - this.marginPx, y);
    ctx.textAlign = originalAlign;
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
        cursorY += 18;
      } else {
        line = attempt;
      }
    }
    if (line) {
      ctx.fillText(line, center ? this.widthPx / 2 : x, cursorY);
      cursorY += 18;
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
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date).replace(',', ' ·');
  }
}
