import { Injectable } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class PosReceiptRenderer {
  private readonly width = 42;

  render(receipt: PosReceiptData): string {
    const esc = '\x1b';
    const gs = '\x1d';
    const amount = receipt.kind === 'refund' ? receipt.amountCents ?? 0 : receipt.totalCents ?? 0;
    const output = [
      esc + '@',
      esc + 'a' + '\x01',
      esc + '!' + '\x20',
      'ELITE\n',
      esc + '!' + '\x00',
      `${receipt.kind === 'refund' ? 'REFUND' : 'SALE'} RECEIPT\n`,
      `#${receipt.receiptNumber}\n`,
      `${this.formatDate(receipt.createdAt)}\n`,
      esc + 'a' + '\x00',
    ];

    if (receipt.cashierName) output.push(`Cashier: ${this.truncate(receipt.cashierName, this.width - 9)}\n`);
    if (receipt.registerName) output.push(`Register: ${this.truncate(receipt.registerName, this.width - 10)}\n`);
    if (receipt.registerId) output.push(`Reg ID: ${this.truncate(receipt.registerId, this.width - 8)}\n`);
    output.push(this.rule());

    for (const item of receipt.items ?? []) {
      output.push(this.truncate(item.name, this.width) + '\n');
      if (item.variant) output.push(this.truncate(item.variant, this.width) + '\n');
      if (item.sku) output.push(this.truncate(`SKU ${item.sku}`, this.width) + '\n');
      output.push(this.columns(`${item.quantity} x ${this.money(item.unitPriceCents)}`, this.money(item.lineTotalCents)) + '\n');
    }

    output.push(this.rule());
    if (receipt.kind !== 'refund') {
      output.push(this.columns('Subtotal', this.money(receipt.subtotalCents ?? 0)) + '\n');
      output.push(this.columns('Tax', this.money(receipt.taxCents ?? 0)) + '\n');
    }
    output.push(esc + '!' + '\x10');
    output.push(this.columns(receipt.kind === 'refund' ? 'REFUND' : 'TOTAL', this.money(amount)) + '\n');
    output.push(esc + '!' + '\x00');
    output.push(this.columns('Payment', String(receipt.paymentMethod || receipt.method || '').toUpperCase()) + '\n');
    if (receipt.kind !== 'refund' && (receipt.paymentMethod || receipt.method) === 'cash') {
      output.push(this.columns('Tendered', this.money(receipt.amountTenderedCents ?? 0)) + '\n');
      output.push(this.columns('Change', this.money(receipt.changeGivenCents ?? 0)) + '\n');
    }
    if (receipt.reason) output.push(`Reason: ${this.truncate(receipt.reason, this.width - 8)}\n`);
    output.push(this.rule());
    output.push(esc + 'a' + '\x01');
    const lookup = receipt.lookupCode || `#${receipt.receiptNumber}`;
    output.push(this.qrCode(lookup));
    output.push(this.truncate(lookup, this.width) + '\n');
    output.push('Thank you\n\n');
    output.push(gs + 'V' + '\x01');
    return output.join('');
  }

  /** Standard ESC/POS GS ( k QR code for refund lookup. */
  private qrCode(data: string): string {
    const gs = '\x1d';
    const bytes = `${data}`;
    const storeLen = bytes.length + 3;
    const pL = String.fromCharCode(storeLen % 256);
    const pH = String.fromCharCode(Math.floor(storeLen / 256));
    return [
      gs + '(k' + '\x04\x00\x31\x41\x32\x00', // select model 2
      gs + '(k' + '\x03\x00\x31\x43\x06', // module size 6
      gs + '(k' + '\x03\x00\x31\x45\x31', // error correction level M
      gs + '(k' + pL + pH + '\x31\x50\x30' + bytes, // store data
      gs + '(k' + '\x03\x00\x31\x51\x30', // print
    ].join('');
  }

  drawerCommand(pin: 'epson-pin-2' | 'epson-pin-5'): string {
    const pinByte = pin === 'epson-pin-2' ? '\x00' : '\x01';
    return '\x1b' + 'p' + pinByte + '\x32' + '\x32';
  }

  private columns(left: string, right: string): string {
    const safeLeft = this.truncate(left, Math.max(1, this.width - right.length - 1));
    return safeLeft + ' '.repeat(Math.max(1, this.width - safeLeft.length - right.length)) + right;
  }

  private rule(): string {
    return '-'.repeat(this.width) + '\n';
  }

  private truncate(value: string, width: number): string {
    const normalized = String(value || '').replace(/[^\x20-\x7E]/g, '?');
    return normalized.length <= width ? normalized : normalized.slice(0, Math.max(0, width - 1)) + '.';
  }

  private money(cents: number): string {
    return `QAR ${(Number(cents) / 100).toFixed(2)}`;
  }

  private formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  }
}
