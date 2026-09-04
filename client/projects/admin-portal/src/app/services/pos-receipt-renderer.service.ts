import { Injectable } from '@angular/core';
import { PosBusinessProfile } from './pos.service';

export interface PosReceiptLine {
  name: string;
  /** Snapshotted Arabic product name, printed above the English one. */
  nameAr?: string | null;
  variant?: string;
  sku?: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface PosReceiptData {
  kind?: 'sale' | 'refund' | 'void';
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
  registerName?: string | null;
  cashierName?: string | null;
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

  /**
   * There is no grey on this receipt, and there cannot be one.
   *
   * The canvas goes to QZ with `quantization: 'luma'`, a hard threshold rather
   * than a dither: each pixel is either a black dot or bare paper. Grey does
   * not become lighter ink, it becomes *eroded* ink. A glyph stem at 11-13px
   * is about one pixel wide and mostly antialiased, so tinting it grey pushes
   * those blended edge pixels over the threshold and they drop out. The stem
   * survives in pieces, or not at all.
   *
   * That was visible on the real print in two stages. `#999` (luma 153) sits
   * above the threshold outright, so the QR caption, the per-item SKU and the
   * CR number printed as nothing at all, silently, with no error. Moving them
   * to `#666` made them appear but shredded: "SCAN TO LOOK UP THIS SALE" came
   * out as "SCAN TO _OGK UP TH S SALE" because every thin stem lost pixels.
   *
   * So de-emphasis on paper is done with size and weight, never with tone.
   * This constant stays as a single named seam for that rule: it is black, and
   * the reason it exists at all is so the next person reads this comment
   * before reaching for a grey.
   */
  private readonly inkMuted = '#000';

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
      // The cutter sits downstream from the thermal head. Cutting immediately
      // after the raster can physically slice through its final rows even
      // though every pixel reached the printer. Feed roughly 25mm first (six
      // default lines at 180dpi), then partial-cut. This is deliberately scoped
      // to Z reports; customer receipt QR/cut handling remains unchanged.
      footerCommands: '\x1b' + 'a' + '\x00' + '\x1b' + 'd' + '\x06' + '\x1d' + 'V' + '\x01',
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
    ctx.fillStyle = this.inkMuted;
    ctx.fillText(this.formatQatarDateTime(report.createdAt), centerX, y);
    ctx.fillStyle = '#000';
    y += 22;
    if (report.registerName || report.cashierName) {
      ctx.font = `13px ${this.bodyFont}`;
      ctx.fillStyle = this.inkMuted;
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
    ctx.fillStyle = this.inkMuted;
    y = this.columns(ctx, 'Transactions', String(report.transactionCount), y);
    y = this.columns(ctx, 'Refunds', String(report.refundCount), y);
    y = this.columns(ctx, 'Voids', String(report.voidCount), y);
    ctx.fillStyle = '#000';
    y += 6;
    y = this.rule(ctx, y);
    y += 14;

    // A positive end marker makes a complete report obvious at a glance. If
    // the printer/driver ever truncates a job, staff can immediately tell that
    // the paper is incomplete instead of treating a partial financial report
    // as valid. The immutable report id ties the paper back to history.
    ctx.font = `600 12px ${this.bodyFont}`;
    ctx.textAlign = 'center';
    this.fillTextTracked(ctx, 'END OF Z REPORT', centerX, y, 1.2);
    y += 20;
    ctx.font = `12px ${this.bodyFont}`;
    ctx.fillText(`ID ${report.zReportId}`, centerX, y);
    y += 20;

    return y;
  }

  /**
   * ESC/POS QR + cut, appended as raw commands after the rasterized image.
   *
   * Centring is not optional here, and its absence is why the QR printed hard
   * against the left edge of every receipt while the rest of the page was
   * centred. The body is a canvas raster, so its centring is baked into the
   * pixels; the QR is not in that image at all, it is drawn by the printer
   * from these commands, using the printer's own justification state. That
   * state defaults to left. `ESC a 1` sets centre for the QR and `ESC a 0`
   * puts it back so nothing after this inherits it.
   *
   * A feed of blank lines is inserted between the QR print command and the
   * cut command, because a real test print showed the auto-cutter slicing
   * through the QR when no gap was reserved after it. `ESC d n` feeds n lines
   * before the cut fires, guaranteeing clear paper below the QR regardless of
   * how tall it renders for a given payload length.
   */
  private footerCommands(receipt: PosReceiptData): string {
    const gs = '\x1d';
    const esc = '\x1b';
    const centre = esc + 'a' + '\x01';
    const alignLeft = esc + 'a' + '\x00';
    const lookup = receipt.lookupCode || `#${receipt.receiptNumber}`;
    const feedLines = '\x06'; // 6 lines ≈ well clear of the largest QR this payload will ever produce
    return centre + this.qrCode(lookup) + alignLeft + esc + 'd' + feedLines + gs + 'V' + '\x01';
  }

  private qrCode(data: string): string {
    const gs = '\x1d';
    const bytes = `${data}`;
    const storeLen = bytes.length + 3;
    const pL = String.fromCharCode(storeLen % 256);
    const pH = String.fromCharCode(Math.floor(storeLen / 256));
    return [
      gs + '(k' + '\x04\x00\x31\x41\x32\x00', // select model 2
      // Module size 8, not 4.
      //
      // At 180dpi a module is 8/180in ≈ 1.13mm, so the short lookup payload
      // used here (a version 1-2 symbol, 21-25 modules a side) prints about
      // 24-28mm square. That clears the ~20mm floor most phone cameras want
      // at arm's length and still leaves half the 72mm printable width free.
      // Size 4 was chosen to keep the code visually quiet, but a QR nobody
      // can scan is not restraint, it is decoration.
      gs + '(k' + '\x03\x00\x31\x43\x08',
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
    const correctionKind = receipt.kind === 'refund' || receipt.kind === 'void';

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
    // The brand name always prints under the logo, even on an unconfigured
    // profile. Previously it was skipped when `tradeNameEn` was empty, so a
    // receipt showed the logo and then jumped straight to the sale — which is
    // what the last real test print looked like. The receipt has to name the
    // shop (owner requirement, 2026-08-01: logo, brand name, branch, phone).
    // Only when the wordmark actually rendered. This line is a subtitle *to*
    // the logo, spelling out in plain letterforms what the mark says in
    // stylised ones. On the fallback path the mark is already plain text, so
    // printing this too gave "Elite Collection" in Georgia italic with
    // "ELITE COLLECTION" in tracked caps directly beneath it: the same shop
    // named twice, which reads as a rendering fault rather than a header.
    if (logo) {
      ctx.font = `600 15px ${this.bodyFont}`;
      ctx.save();
      ctx.textAlign = 'center';
      this.fillTextTracked(ctx, (profile?.tradeNameEn || 'ELITE COLLECTION').toUpperCase(), centerX, y, 2.5);
      ctx.restore();
      y += 22;
    }
    // The receipt is English-only for the header/items (owner decision,
    // 2026-08-01) — the profile's Arabic trade name, address, and footer
    // stamp are stored but never printed. The return/exchange policy is the
    // one exception (owner decision, 2026-08-17): it prints in both
    // languages, Arabic above English, same convention as the item lines.
    y += 10;

    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = this.inkMuted;
    // A real shop address does not fit on one line. The Pearl branch alone is
    // "Parcel 14, 25 La Croisette Ground Floor / Shop 317, Marina Way 23 /
    // The Pearl - Qatar" — printed with a single `fillText` it ran off both
    // edges of a 72mm tape. Author-entered newlines are honoured as written,
    // because a postal address has meaningful line breaks, and any line still
    // too long for the paper is wrapped rather than clipped.
    if (profile?.addressEn) {
      for (const line of profile.addressEn.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        y = this.wrapText(ctx, text, this.marginPx, y, width - this.marginPx * 2, true);
      }
      y += 2;
    }
    if (profile?.phone) { ctx.fillText(profile.phone, centerX, y); y += 19; }
    ctx.fillStyle = '#000';
    y += 20;

    // A single hairline under the header block — the one structural divider
    // that earns its place, separating "who we are" from "what happened."
    y = this.rule(ctx, y);
    y += 14;

    ctx.font = `600 16px ${this.bodyFont}`;
    ctx.textAlign = 'center';
    const receiptTitle = receipt.kind === 'refund' ? 'REFUND' : receipt.kind === 'void' ? 'VOID' : 'RECEIPT';
    this.fillTextTracked(ctx, receiptTitle, centerX, y, 3);
    y += 24;
    ctx.font = `22px ${this.displayFont}`;
    ctx.fillText(`No. ${receipt.receiptNumber}`, centerX, y);
    y += 26;
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = this.inkMuted;
    ctx.fillText(this.formatQatarDateTime(receipt.createdAt), centerX, y);
    ctx.fillStyle = '#000';
    y += 30;

    ctx.textAlign = 'left';
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = this.inkMuted;
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
    const items = receipt.items ?? [];
    items.forEach((item, index) => {
      // Each item is one block, and the spacing has to say so. The lines
      // within a block are set tight and the gap between blocks is wide;
      // previously both were the same, so on a two-line bilingual name the
      // Arabic and English halves of one product read as two separate
      // purchases sitting at opposite margins.
      if (index > 0) y += 14;

      // Item lines are the one bilingual part of an otherwise English receipt
      // (owner decision, 2026-08-01): the Arabic name sits above the English
      // one so a customer reading either language recognises what they bought.
      // It is right-aligned because Arabic reads right-to-left — left-aligning
      // it would put the end of the phrase where the eye starts.
      //
      // `shapeArabic` is required here: the receipt is rasterised, but the
      // canvas still needs the letters joined and reordered before drawing.
      if (item.nameAr) {
        ctx.font = `500 16px ${this.bodyFont}`;
        ctx.textAlign = 'right';
        ctx.fillText(this.shapeArabic(item.nameAr), this.widthPx - this.marginPx, y);
        ctx.textAlign = 'left';
        y += 22;
      }
      ctx.font = `500 15px ${this.bodyFont}`;
      ctx.fillText(item.name, this.marginPx, y);
      y += 21;
      if (item.variant) {
        // Labelled, because a bare "15" under a shoe name is not information.
        // It could be a size, a quantity or a style code, and the customer has
        // no way to tell which.
        ctx.font = `13px ${this.bodyFont}`;
        ctx.fillStyle = this.inkMuted;
        ctx.fillText(this.labelVariant(item.variant), this.marginPx, y);
        ctx.fillStyle = '#000';
        y += 20;
      }
      // The SKU is deliberately not printed (owner decision, 2026-08-02).
      // It is an internal catalogue reference: the receipt number and the QR
      // already cover returns and lookup, so on a customer's copy it is noise.
      // `PosReceiptLine.sku` stays on the interface because the refund and
      // exchange screens still read it.
      // 500 weight, not regular. At 15px regular the decimal point is barely
      // more than one antialiased pixel, and luma thresholding rounds it away:
      // the printed line read "QAR 1220 00" while the 20px bold total on the
      // same receipt kept its point. Punctuation carries meaning in a price,
      // so it needs enough stroke to survive the threshold.
      ctx.font = `500 15px ${this.bodyFont}`;
      y = this.columns(ctx, `${item.quantity} × ${this.money(item.unitPriceCents)}`, this.money(item.lineTotalCents), y);
    });
    y += 12;
    y = this.rule(ctx, y);
    y += 16;

    ctx.font = `14px ${this.bodyFont}`;
    // Qatar has no sales tax, so the receipt carries no tax line at all (owner
    // decision, 2026-08-01) — printing "Tax QAR 0.00" on a customer's invoice
    // invites the question of which tax, and the honest answer is none.
    //
    // Subtotal prints only when it actually differs from the total. Today it
    // never does; once discounts exist (docs/25 Phase 6) the line reappears by
    // itself and means something.
    if (!correctionKind) {
      const subtotal = receipt.subtotalCents ?? 0;
      if (subtotal !== amount) {
        y = this.columns(ctx, 'Subtotal', this.money(subtotal), y);
        y += 8;
      }
    }
    ctx.font = `600 20px ${this.displayFont}`;
    const totalLabel = receipt.kind === 'refund' ? 'Refund total' : receipt.kind === 'void' ? 'Void total' : 'Total';
    y = this.columns(ctx, totalLabel, this.money(amount), y);
    y += 12;
    ctx.font = `13px ${this.bodyFont}`;
    ctx.fillStyle = this.inkMuted;
    y = this.columns(ctx, 'Payment', String(receipt.paymentMethod || receipt.method || '').toUpperCase(), y);
    if (receipt.terminalReference) {
      y = this.columns(ctx, 'Terminal ref', receipt.terminalReference, y);
    }
    if (!correctionKind && (receipt.paymentMethod || receipt.method) === 'cash') {
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

    // Return/exchange policy — Arabic above English, same order and reasoning
    // as the item lines: whichever language the customer reads, it's the
    // first thing under the rule, not buried below the other one.
    //
    // Printed as separate points (Refunds / Exchanges / Condition, each its
    // own line in the stored text) rather than one run-on paragraph — same
    // "author's line breaks are meaningful" handling as the address block
    // above. Without this, wrapText (which only breaks on spaces) would
    // glue "...original receipt.\n\nExchanges: Within 14 days..." into one
    // continuous ribbon with no visual separation between points.
    if (profile?.returnPolicyAr) {
      ctx.font = `500 12px ${this.bodyFont}`;
      ctx.fillStyle = this.inkMuted;
      ctx.textAlign = 'center';
      for (const line of profile.returnPolicyAr.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        y = this.wrapText(ctx, text, this.marginPx, y, width - this.marginPx * 2, true, true);
      }
      ctx.fillStyle = '#000';
      y += 6;
    }
    if (profile?.returnPolicyEn) {
      ctx.font = `12px ${this.bodyFont}`;
      ctx.fillStyle = this.inkMuted;
      ctx.textAlign = 'center';
      for (const line of profile.returnPolicyEn.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        y = this.wrapText(ctx, text, this.marginPx, y, width - this.marginPx * 2, true);
      }
      ctx.fillStyle = '#000';
      y += 10;
    }

    if (profile?.crLicenseNumber) {
      // 12px, not 11: this is the commercial registration, the one line on the
      // receipt that exists for a legal reason rather than a design one.
      ctx.font = `12px ${this.bodyFont}`;
      ctx.fillStyle = this.inkMuted;
      ctx.textAlign = 'center';
      ctx.fillText(`CR ${profile.crLicenseNumber}`, centerX, y);
      ctx.fillStyle = '#000';
      y += 18;
    }

    if (profile?.footerStampEn) {
      ctx.font = `italic 12px ${this.displayFont}`;
      ctx.fillStyle = this.inkMuted;
      ctx.textAlign = 'center';
      ctx.fillText(profile.footerStampEn, centerX, y);
      y += 18;
      ctx.fillStyle = '#000';
    }

    y += 14;
    ctx.font = `italic 16px ${this.displayFont}`;
    ctx.textAlign = 'center';
    ctx.fillText(receipt.kind === 'void' ? 'Transaction cancelled' : 'Thank you', centerX, y);
    y += 30;

    // Caption for the QR the printer draws immediately after this image.
    //
    // 12px at 600 weight, which is heavier than it looks like it needs to be.
    // This is the smallest line on the receipt, so it is the one most exposed
    // to stroke erosion under thresholding — see `inkMuted`. Letter tracking
    // makes it worse, not better, because it thins nothing but spaces the
    // damage out, so it is kept modest.
    y += 10;
    ctx.font = `600 12px ${this.bodyFont}`;
    ctx.fillStyle = this.inkMuted;
    this.fillTextTracked(ctx, 'SCAN TO LOOK UP THIS SALE', centerX, y, 1);
    ctx.fillStyle = '#000';

    // No space is reserved for the QR itself, deliberately.
    //
    // The QR is not part of this raster. It is printed after it, by the
    // commands from `footerCommands()`, and the printer advances the paper on
    // its own as it draws. Reserving its footprint here therefore did not
    // position anything; it just emitted a blank band roughly a third of the
    // receipt tall, followed by the QR, followed by the feed lines before the
    // cut. All that is needed is a small gap so the caption is not touching
    // the code beneath it.
    y += 14;

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

  /**
   * `rtl` shapes each wrapped LINE individually (not the whole paragraph
   * once before wrapping) — `shapeArabic`'s RLE/PDF embedding marks only
   * balance correctly within a single `fillText` call. Wrapping the full
   * string first and then splitting it on spaces would hand `fillText` an
   * unclosed RLE on the first line and an orphaned PDF on the last, which
   * is exactly the kind of thing that renders fine on screen and wrong on
   * a thermal printer. `measureText` is run on the unshaped word/line: the
   * marks are zero-width formatting characters, so this doesn't skew the
   * wrap width.
   */
  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, center = false, rtl = false): number {
    const words = text.split(' ');
    let line = '';
    let cursorY = y;
    const draw = (value: string): void => {
      ctx.fillText(rtl ? this.shapeArabic(value) : value, center ? this.widthPx / 2 : x, cursorY);
    };
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && line) {
        draw(line);
        line = word;
        cursorY += 18;
      } else {
        line = attempt;
      }
    }
    if (line) {
      draw(line);
      cursorY += 18;
    }
    return cursorY;
  }

  /**
   * A bare size reads as a mystery number on paper. If the variant is nothing
   * but digits it is a shoe size, so say so; anything else already describes
   * itself ("Beige / 42", "Black") and is printed as stored.
   */
  private labelVariant(variant: string): string {
    const value = variant.trim();
    return /^\d+([.,]\d+)?$/.test(value) ? `Size ${value}` : value;
  }

  private money(cents: number): string {
    // Grouped thousands. A four-figure sale is the normal case here, and
    // "QAR 1220.00" makes the customer count digits to read their own total.
    const amount = Number(cents) / 100;
    return `QAR ${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
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
