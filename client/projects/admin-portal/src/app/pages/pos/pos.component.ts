import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PosLocalStore, PosReceiptBlock } from '../../services/pos-local-store.service';
import {
  PosCatalogItem,
  PosCurrentRegister,
  PosSaleResult,
  PosService,
} from '../../services/pos.service';

type PosPhase = 'loading' | 'enrollment' | 'shift' | 'selling';
type PaymentMethod = 'cash' | 'card';
interface CartLine { item: PosCatalogItem; quantity: number }

@Component({
  selector: 'ap-pos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.scss',
})
export class PosComponent implements OnInit, OnDestroy {
  private readonly pos = inject(PosService);
  private readonly local = inject(PosLocalStore);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly phase = signal<PosPhase>('loading');
  readonly busy = signal(false);
  readonly online = signal(navigator.onLine);
  readonly error = signal('');
  readonly register = signal<PosCurrentRegister | null>(null);
  readonly shiftId = signal<string | null>(null);
  readonly products = signal<PosCatalogItem[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly paymentOpen = signal(false);
  readonly paymentMethod = signal<PaymentMethod>('cash');
  readonly lastSale = signal<PosSaleResult | null>(null);
  readonly receiptBlock = signal<PosReceiptBlock | null>(null);
  readonly totalCents = computed(() => this.cart().reduce(
    (total, line) => total + line.item.priceCents * line.quantity,
    0,
  ));
  readonly cartCount = computed(() => this.cart().reduce((total, line) => total + line.quantity, 0));
  readonly changeCents = computed(() => Math.max(0, this.tenderedCents() - this.totalCents()));

  enrollmentToken = '';
  terminalName = '';
  openingFloat = '0';
  searchQuery = '';
  barcode = '';
  tendered = '';

  private pendingIdempotencyKey: string | null = null;
  private searchSequence = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSource: EventSource | null = null;
  private readonly onOnline = () => this.online.set(true);
  private readonly onOffline = () => this.online.set(false);

  async ngOnInit(): Promise<void> {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    await this.initialize();
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.eventSource?.close();
  }

  async initialize(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      let current: PosCurrentRegister;
      try {
        current = await this.pos.currentRegister();
      } catch {
        const identity = await this.local.getRegister();
        if (!identity) {
          this.phase.set('enrollment');
          return;
        }
        await this.pos.checkIn(identity);
        current = await this.pos.currentRegister();
      }

      this.register.set(current);
      await this.ensureReceiptBlock();
      if (current.shift?.state === 'open') {
        this.shiftId.set(current.shift.id);
        await this.enterSelling();
      } else {
        this.phase.set('shift');
      }
    } catch (error) {
      this.error.set(this.errorMessage(error));
      this.phase.set('enrollment');
    } finally {
      this.busy.set(false);
    }
  }

  async enrollTerminal(): Promise<void> {
    if (!this.enrollmentToken.trim() && !this.terminalName.trim()) {
      this.error.set('Enter an enrollment token or a name for this terminal.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      let token = this.enrollmentToken.trim();
      if (!token) {
        const enrollment = await this.pos.createEnrollmentToken(this.terminalName.trim());
        token = enrollment.token;
      }
      const identity = await this.pos.enroll(token);
      await this.local.setRegister(identity);
      this.register.set(await this.pos.currentRegister());
      await this.ensureReceiptBlock();
      this.phase.set('shift');
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async openShift(): Promise<void> {
    const openingFloatCents = this.moneyInputToCents(this.openingFloat);
    if (openingFloatCents === null) {
      this.error.set('Opening cash must be a valid non-negative amount.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const shift = await this.pos.openShift(openingFloatCents);
      this.shiftId.set(shift.shiftId);
      await this.enterSelling();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  queueSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadProducts(this.searchQuery), 180);
  }

  async scanBarcode(): Promise<void> {
    const value = this.barcode.trim();
    if (!value) return;
    this.error.set('');
    try {
      this.addToCart(await this.pos.findBarcode(value));
      this.barcode = '';
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  addToCart(item: PosCatalogItem): void {
    if (item.stock <= 0) return;
    const existing = this.cart().find((line) => line.item.variantId === item.variantId);
    if (existing && existing.quantity >= item.stock) {
      this.error.set(`Only ${item.stock} units of ${item.name} are available.`);
      return;
    }
    this.cart.update((lines) => existing
      ? lines.map((line) => line.item.variantId === item.variantId ? { ...line, quantity: line.quantity + 1 } : line)
      : [...lines, { item, quantity: 1 }]);
    this.pendingIdempotencyKey = null;
  }

  changeQuantity(variantId: string, delta: number): void {
    this.cart.update((lines) => lines.flatMap((line) => {
      if (line.item.variantId !== variantId) return [line];
      const quantity = line.quantity + delta;
      if (quantity <= 0) return [];
      return [{ ...line, quantity: Math.min(quantity, line.item.stock) }];
    }));
    this.pendingIdempotencyKey = null;
  }

  removeLine(variantId: string): void {
    this.cart.update((lines) => lines.filter((line) => line.item.variantId !== variantId));
    this.pendingIdempotencyKey = null;
  }

  beginPayment(): void {
    if (!this.cart().length) return;
    this.paymentMethod.set('cash');
    this.tendered = (this.totalCents() / 100).toFixed(2);
    this.paymentOpen.set(true);
  }

  selectPayment(method: PaymentMethod): void {
    this.paymentMethod.set(method);
    if (method === 'cash') this.tendered = (this.totalCents() / 100).toFixed(2);
  }

  async completeSale(): Promise<void> {
    const shiftId = this.shiftId();
    if (!shiftId || !this.cart().length || this.busy()) return;
    if (!this.online()) {
      this.error.set('Offline checkout will be enabled with the sync phase. Reconnect to complete this sale safely.');
      return;
    }

    const method = this.paymentMethod();
    const tenderedCents = method === 'cash' ? this.moneyInputToCents(this.tendered) : 0;
    if (tenderedCents === null || tenderedCents < this.totalCents()) {
      this.error.set('Tendered cash is less than the total.');
      return;
    }

    this.busy.set(true);
    this.error.set('');
    try {
      await this.ensureReceiptBlock();
      const receiptBlock = this.receiptBlock();
      if (!receiptBlock || receiptBlock.next > receiptBlock.end) {
        throw new Error('No receipt numbers are available.');
      }
      const receiptNumber = receiptBlock.next;
      this.pendingIdempotencyKey ??= crypto.randomUUID();
      const totalCents = this.totalCents();
      const result = await this.pos.createSale({
        idempotencyKey: this.pendingIdempotencyKey,
        receiptNumber,
        shiftId,
        customerId: null,
        items: this.cart().map((line) => ({
          variantId: line.item.variantId,
          quantity: line.quantity,
          unitPriceCents: line.item.priceCents,
        })),
        payment: {
          method,
          cashAmountCents: method === 'cash' ? totalCents : 0,
          cardAmountCents: method === 'card' ? totalCents : 0,
          amountTenderedCents: tenderedCents,
          changeGivenCents: method === 'cash' ? tenderedCents - totalCents : 0,
        },
        clientCreatedAt: new Date().toISOString(),
      });
      await this.local.commitReceipt(receiptNumber);
      this.receiptBlock.set(await this.local.getReceiptBlock());
      this.applyStockUpdates(result.stockUpdates);
      this.cart.set([]);
      this.pendingIdempotencyKey = null;
      this.paymentOpen.set(false);
      this.lastSale.set(result);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  closeReceipt(): void {
    this.lastSale.set(null);
  }

  exitPos(): void {
    void this.router.navigate(['/dashboard']);
  }

  formatMoney(cents: number): string {
    return new Intl.NumberFormat('en-QA', { style: 'currency', currency: 'QAR' }).format(cents / 100);
  }

  productImage(item: PosCatalogItem): string {
    return this.pos.mediaUrl(item.imageUrl);
  }

  trackVariant(_index: number, value: PosCatalogItem | CartLine): string {
    return 'item' in value ? value.item.variantId : value.variantId;
  }

  private async enterSelling(): Promise<void> {
    this.phase.set('selling');
    await this.loadProducts();
    this.connectEvents();
  }

  private async loadProducts(query = ''): Promise<void> {
    const sequence = ++this.searchSequence;
    try {
      const products = await this.pos.searchProducts(query);
      if (sequence === this.searchSequence) this.products.set(products);
    } catch (error) {
      if (sequence === this.searchSequence) this.error.set(this.errorMessage(error));
    }
  }

  private async ensureReceiptBlock(): Promise<void> {
    const cached = await this.local.getReceiptBlock();
    if (cached && cached.next <= cached.end) {
      this.receiptBlock.set(cached);
      return;
    }
    const allocated = await this.pos.allocateReceiptBlock();
    await this.local.setReceiptBlock(allocated);
    this.receiptBlock.set(allocated);
  }

  private connectEvents(): void {
    this.eventSource?.close();
    this.eventSource = new EventSource(this.pos.eventUrl, { withCredentials: true });
    this.eventSource.addEventListener('stock.updated', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { variantId?: string; stock?: number };
        if (payload.variantId && Number.isSafeInteger(payload.stock)) {
          this.applyStockUpdates([{ variantId: payload.variantId, stock: Number(payload.stock) }]);
        }
      } catch {
        // A malformed event is ignored; the next catalog refresh remains authoritative.
      }
    });
  }

  private applyStockUpdates(updates: Array<{ variantId: string; stock: number }>): void {
    const byVariant = new Map(updates.map((update) => [update.variantId, update.stock]));
    this.products.update((products) => products.map((product) => byVariant.has(product.variantId)
      ? { ...product, stock: byVariant.get(product.variantId) ?? product.stock }
      : product));
    this.cart.update((lines) => lines.flatMap((line) => {
      const stock = byVariant.get(line.item.variantId);
      if (stock === undefined) return [line];
      if (stock <= 0) return [];
      return [{ ...line, item: { ...line.item, stock }, quantity: Math.min(line.quantity, stock) }];
    }));
  }

  private tenderedCents(): number {
    return this.moneyInputToCents(this.tendered) ?? 0;
  }

  private moneyInputToCents(value: string): number | null {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { message?: string; error?: { message?: string } };
      return candidate.error?.message || candidate.message || 'The POS request could not be completed.';
    }
    return 'The POS request could not be completed.';
  }
}
