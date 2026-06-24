import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import {
  PosHardwareSettings,
  PosLocalStore,
  PosQueuedSale,
  PosReceiptBlock,
} from '../../services/pos-local-store.service';
import {
  PosCatalogItem,
  PosCurrentRegister,
  PosParkedCart,
  PosSaleResult,
  PosService,
  PosShiftSummary,
  PosSyncConflict,
  PosTransactionItem,
} from '../../services/pos.service';
import { PosHardwareService } from '../../services/pos-hardware.service';

type PosPhase = 'loading' | 'enrollment' | 'shift' | 'selling';
type PaymentMethod = 'cash' | 'card';
interface CartLine { item: PosCatalogItem; quantity: number }
type PosDialog = 'none' | 'park' | 'parked' | 'operations' | 'hardware' | 'shift';

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
  readonly hardware = inject(PosHardwareService);
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
  readonly pendingSales = signal(0);
  readonly rejectedSales = signal(0);
  readonly queuedSales = signal<PosQueuedSale[]>([]);
  readonly syncing = signal(false);
  readonly catalogCachedAt = signal<string | null>(null);
  readonly dialog = signal<PosDialog>('none');
  readonly parkedCarts = signal<PosParkedCart[]>([]);
  readonly operationTransaction = signal<PosSaleResult | null>(null);
  readonly shiftSummary = signal<PosShiftSummary | null>(null);
  readonly syncConflicts = signal<PosSyncConflict[]>([]);
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
  parkLabel = '';
  transactionLookup = '';
  correctionReason = '';
  managerPin = '';
  physicalCash = '';
  refundQuantities: Record<string, number> = {};
  refundRestock: Record<string, boolean> = {};
  hardwarePrinter = '';
  hardwareSignerUrl = 'http://127.0.0.1:8182';
  hardwareDrawerPulse: PosHardwareSettings['drawerPulse'] = 'epson-pin-2';
  conflictResolution = '';

  private pendingIdempotencyKey: string | null = null;
  private searchSequence = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSource: EventSource | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncAttempt = 0;
  private readonly onOnline = () => {
    this.online.set(true);
    void this.syncPendingSales();
  };
  private readonly onOffline = () => this.online.set(false);

  async ngOnInit(): Promise<void> {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/pos-sw.js', { scope: '/' }).catch(() => undefined);
    }
    await this.initialize();
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
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
        if (!this.online()) {
          const storedShift = await this.local.getShift();
          const cachedCatalog = await this.local.getCatalog();
          if (!storedShift || !cachedCatalog) throw new Error('This register has no offline shift or catalog cache. Connect once before working offline.');
          this.register.set({ registerId: identity.registerId, displayName: identity.displayName, status: 'offline', shift: {
            id: storedShift.shiftId,
            state: 'open',
            openingFloatCents: storedShift.openingFloatCents,
            openedAt: storedShift.openedAt,
          } });
          this.shiftId.set(storedShift.shiftId);
          this.products.set(cachedCatalog.products);
          this.catalogCachedAt.set(cachedCatalog.cachedAt);
          this.receiptBlock.set(await this.local.getReceiptBlock());
          this.phase.set('selling');
          await this.refreshQueueState();
          await this.hardware.initialize();
          return;
        }
        await this.pos.checkIn(identity);
        current = await this.pos.currentRegister();
      }

      this.register.set(current);
      await this.ensureReceiptBlock();
      if (current.shift?.state === 'open') {
        this.shiftId.set(current.shift.id);
        await this.local.setShift({
          shiftId: current.shift.id,
          registerId: current.registerId,
          openingFloatCents: current.shift.openingFloatCents,
          openedAt: current.shift.openedAt,
        });
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
      await this.local.setShift(shift);
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
      const product = this.online()
        ? await this.pos.findBarcode(value)
        : this.products().find((item) => item.barcode === value);
      if (!product) throw new Error(`No cached product uses barcode ${value}.`);
      this.addToCart(product);
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
      const clientCreatedAt = new Date().toISOString();
      const payload = {
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
        clientCreatedAt,
      };
      const receiptData = this.localReceiptData(payload, receiptNumber);
      let result: PosSaleResult;
      if (this.online()) {
        try {
          result = await this.pos.createSale(payload);
          await this.local.commitReceipt(receiptNumber);
        } catch (error) {
          if (!this.isNetworkError(error)) throw error;
          this.online.set(false);
          result = await this.queueOfflineSale(payload, receiptData);
        }
      } else {
        result = await this.queueOfflineSale(payload, receiptData);
      }
      this.receiptBlock.set(await this.local.getReceiptBlock());
      this.applyStockUpdates(result.stockUpdates);
      this.cart.set([]);
      this.pendingIdempotencyKey = null;
      this.paymentOpen.set(false);
      this.lastSale.set(result);
      try {
        await this.hardware.printReceipt(result.receipt.receiptData, method === 'cash');
      } catch (printError) {
        this.error.set(`Sale saved. Receipt was not printed: ${this.errorMessage(printError)}`);
      }
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  closeReceipt(): void {
    this.lastSale.set(null);
  }

  async reprintLastSale(): Promise<void> {
    const sale = this.lastSale();
    if (!sale) return;
    try {
      await this.hardware.printReceipt(sale.receipt.receiptData, false);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  async syncPendingSales(): Promise<void> {
    if (!this.online() || this.syncing()) return;
    const shiftId = this.shiftId();
    if (!shiftId) return;
    const queued = await this.local.listQueuedSales(shiftId);
    const pending = queued.filter((sale) => sale.status === 'pending');
    await this.refreshQueueState();
    if (!pending.length) {
      await this.reportSyncState();
      return;
    }
    this.syncing.set(true);
    try {
      const response = await this.pos.syncSales(pending.map((sale) => ({
        idempotencyKey: sale.idempotencyKey,
        receiptNumber: sale.receiptNumber,
        clientCreatedAt: sale.clientCreatedAt,
        payload: sale.payload,
      })));
      for (const accepted of [...response.accepted, ...response.acceptedWithConflicts]) {
        await this.local.deleteQueuedSale(accepted.idempotencyKey);
      }
      for (const rejected of response.rejected) {
        await this.local.markQueuedSaleRejected(rejected.idempotencyKey, rejected.message);
      }
      this.syncAttempt = 0;
      await this.refreshQueueState();
      await this.reportSyncState();
      await this.loadProducts(this.searchQuery);
      if (response.acceptedWithConflicts.length) {
        this.error.set(`${response.acceptedWithConflicts.length} offline sale conflict(s) need manager reconciliation.`);
      }
    } catch (error) {
      this.scheduleSyncRetry();
      this.error.set(`Offline sync paused: ${this.errorMessage(error)}`);
    } finally {
      this.syncing.set(false);
    }
  }

  async retryRejectedSale(sale: PosQueuedSale): Promise<void> {
    await this.local.retryQueuedSale(sale.idempotencyKey);
    await this.refreshQueueState();
    await this.syncPendingSales();
  }

  async parkCurrentCart(): Promise<void> {
    if (!this.cart().length) return;
    this.busy.set(true);
    try {
      if (this.online()) await this.pos.parkCart(this.parkLabel.trim(), { items: this.cart() });
      else await this.local.parkCart(this.parkLabel.trim(), { items: this.cart() });
      this.cart.set([]);
      this.parkLabel = '';
      this.dialog.set('none');
      await this.loadParkedCarts();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async loadParkedCarts(): Promise<void> {
    try {
      const localCarts = await this.local.listParkedCarts();
      if (!this.online()) {
        this.parkedCarts.set(localCarts);
        return;
      }
      for (const parked of localCarts) {
        await this.pos.parkCart(parked.label, parked.payload);
        await this.local.deleteParkedCart(parked.parkedCartId);
      }
      this.parkedCarts.set(await this.pos.listParkedCarts());
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  async restoreParkedCart(parked: PosParkedCart): Promise<void> {
    if (this.cart().length && !window.confirm('Replace the current cart with this parked sale?')) return;
    this.cart.set(parked.payload.items);
    if (parked.local) await this.local.deleteParkedCart(parked.parkedCartId);
    else await this.pos.deleteParkedCart(parked.parkedCartId);
    await this.loadParkedCarts();
    this.dialog.set('none');
  }

  async lookupTransaction(): Promise<void> {
    if (!this.transactionLookup.trim() || !this.online()) return;
    this.busy.set(true);
    try {
      const transaction = await this.pos.findTransaction(this.transactionLookup.trim());
      this.operationTransaction.set(transaction);
      this.refundQuantities = Object.fromEntries((transaction.items || []).map((item) => [item.id, 0]));
      this.refundRestock = Object.fromEntries((transaction.items || []).map((item) => [item.id, true]));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async voidCurrentTransaction(): Promise<void> {
    const transaction = this.operationTransaction();
    if (!transaction || !this.managerPin || !this.correctionReason.trim()) return;
    this.busy.set(true);
    try {
      const override = await this.pos.verifyManagerPin(this.managerPin, 'void');
      const result = await this.pos.voidTransaction(transaction.transactionId, {
        idempotencyKey: crypto.randomUUID(),
        voidReason: this.correctionReason.trim(),
        managerOverrideId: override.overrideId,
        managerOverrideToken: override.token,
      });
      this.applyStockUpdates(result.stockRestored);
      this.operationTransaction.set(await this.pos.findTransaction(transaction.transactionId));
      this.managerPin = '';
      this.correctionReason = '';
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async refundCurrentTransaction(): Promise<void> {
    const transaction = this.operationTransaction();
    const shiftId = this.shiftId();
    const lines = (transaction?.items || [])
      .map((item) => ({
        transactionItemId: item.id,
        quantity: Number(this.refundQuantities[item.id] || 0),
        restock: this.refundRestock[item.id] !== false,
      }))
      .filter((line) => line.quantity > 0);
    if (!transaction || !shiftId || !lines.length || !this.managerPin || !this.correctionReason.trim()) return;
    this.busy.set(true);
    try {
      await this.ensureReceiptBlock();
      const receiptNumber = this.receiptBlock()?.next;
      if (!receiptNumber) throw new Error('No refund receipt number is available.');
      const override = await this.pos.verifyManagerPin(this.managerPin, 'refund');
      const result = await this.pos.refund({
        idempotencyKey: crypto.randomUUID(),
        receiptNumber,
        shiftId,
        originalTransactionId: transaction.transactionId,
        lines,
        refundMethod: transaction.paymentMethod,
        reason: this.correctionReason.trim(),
        managerOverrideId: override.overrideId,
        managerOverrideToken: override.token,
      });
      await this.local.commitReceipt(receiptNumber);
      this.receiptBlock.set(await this.local.getReceiptBlock());
      this.applyStockUpdates(result.stockUpdates || []);
      await this.hardware.printReceipt(result.receipt.receiptData, result.method === 'cash').catch(() => undefined);
      this.operationTransaction.set(await this.pos.findTransaction(transaction.transactionId));
      this.managerPin = '';
      this.correctionReason = '';
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async openHardwareDialog(): Promise<void> {
    const settings = await this.local.getHardwareSettings();
    this.hardwarePrinter = settings?.printerName || '';
    this.hardwareSignerUrl = settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
    this.hardwareDrawerPulse = settings?.drawerPulse || 'epson-pin-2';
    this.dialog.set('hardware');
  }

  async saveHardware(): Promise<void> {
    this.busy.set(true);
    try {
      await this.hardware.configure({
        printerName: this.hardwarePrinter.trim(),
        deviceSignerUrl: this.hardwareSignerUrl.trim(),
        drawerPulse: this.hardwareDrawerPulse,
      });
      this.dialog.set('none');
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async openShiftDialog(): Promise<void> {
    if (!this.online()) return;
    this.dialog.set('shift');
    try {
      const [summary, conflicts] = await Promise.all([this.pos.shiftSummary(), this.pos.listConflicts()]);
      this.shiftSummary.set(summary);
      this.syncConflicts.set(conflicts);
      this.physicalCash = (summary.expectedCashCents / 100).toFixed(2);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  async closeCurrentShift(): Promise<void> {
    const summary = this.shiftSummary();
    const physicalCashCents = this.moneyInputToCents(this.physicalCash);
    if (!summary || physicalCashCents === null || !this.managerPin) return;
    await this.refreshQueueState();
    if (this.pendingSales() || this.rejectedSales()) {
      this.error.set('Resolve all pending and rejected offline sales before closing the shift.');
      return;
    }
    this.busy.set(true);
    try {
      await this.reportSyncState();
      const override = await this.pos.verifyManagerPin(this.managerPin, 'z-report');
      await this.pos.closeShift({
        shiftId: summary.shiftId,
        physicalCashCents,
        idempotencyKey: crypto.randomUUID(),
        managerOverrideId: override.overrideId,
        managerOverrideToken: override.token,
      });
      this.dialog.set('none');
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async resolveSyncConflict(conflict: PosSyncConflict): Promise<void> {
    if (!this.managerPin || !this.conflictResolution.trim()) return;
    this.busy.set(true);
    try {
      const override = await this.pos.verifyManagerPin(this.managerPin, 'sync-conflict-override');
      await this.pos.resolveConflict(conflict.conflictId, this.conflictResolution.trim(), override);
      this.syncConflicts.set(await this.pos.listConflicts());
      this.managerPin = '';
      this.conflictResolution = '';
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
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
    if (this.online()) this.connectEvents();
    await Promise.all([this.refreshQueueState(), this.loadParkedCarts(), this.hardware.initialize()]);
    await this.syncPendingSales();
  }

  private async loadProducts(query = ''): Promise<void> {
    const sequence = ++this.searchSequence;
    if (!this.online()) {
      const cached = await this.local.getCatalog();
      if (!cached) return;
      const normalized = query.trim().toLowerCase();
      this.products.set(normalized
        ? cached.products.filter((item) => [item.name, item.sku, item.barcode, item.variant].some((value) => value.toLowerCase().includes(normalized)))
        : cached.products);
      this.catalogCachedAt.set(cached.cachedAt);
      return;
    }
    try {
      const products = await this.pos.searchProducts(query);
      if (sequence === this.searchSequence) {
        this.products.set(products);
        if (!query) {
          const cachedAt = new Date().toISOString();
          this.catalogCachedAt.set(cachedAt);
          await this.local.setCatalog({ products, cachedAt });
        }
      }
    } catch (error) {
      const cached = await this.local.getCatalog();
      if (sequence === this.searchSequence && cached) {
        this.products.set(cached.products);
        this.catalogCachedAt.set(cached.cachedAt);
      } else if (sequence === this.searchSequence) {
        this.error.set(this.errorMessage(error));
      }
    }
  }

  private async ensureReceiptBlock(): Promise<void> {
    const cached = await this.local.getReceiptBlock();
    if (cached && cached.next <= cached.end) {
      this.receiptBlock.set(cached);
      return;
    }
    if (!this.online()) throw new Error('Offline checkout is blocked because this register has no reserved receipt numbers.');
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
    // The server emits this when our reconnect position predates the retained
    // replay buffer; the only safe recovery is a full REST catalog refresh.
    this.eventSource.addEventListener('catalog.refresh-required', () => {
      void this.loadProducts();
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
    void this.persistCachedStock(byVariant);
  }

  private async persistCachedStock(updates: Map<string, number>): Promise<void> {
    const cached = await this.local.getCatalog();
    if (!cached) return;
    await this.local.setCatalog({
      ...cached,
      products: cached.products.map((product) => updates.has(product.variantId)
        ? { ...product, stock: updates.get(product.variantId) ?? product.stock }
        : product),
    });
  }

  private localReceiptData(payload: {
    idempotencyKey: string;
    receiptNumber: number;
    clientCreatedAt: string;
    payment: { method: PaymentMethod; amountTenderedCents: number; changeGivenCents: number };
  }, receiptNumber: number): unknown {
    const register = this.register();
    return {
      kind: 'sale',
      receiptNumber: String(receiptNumber).padStart(8, '0'),
      transactionId: payload.idempotencyKey,
      createdAt: payload.clientCreatedAt,
      cashierName: this.auth.user()?.name || '',
      registerId: register?.registerId || '',
      registerName: register?.displayName || '',
      paymentMethod: payload.payment.method,
      items: this.cart().map((line) => ({
        name: line.item.name,
        variant: line.item.variant,
        sku: line.item.sku,
        quantity: line.quantity,
        unitPriceCents: line.item.priceCents,
        lineTotalCents: line.item.priceCents * line.quantity,
      })),
      subtotalCents: this.totalCents(),
      taxCents: 0,
      totalCents: this.totalCents(),
      amountTenderedCents: payload.payment.amountTenderedCents,
      changeGivenCents: payload.payment.changeGivenCents,
      lookupCode: `elite-pos:${payload.idempotencyKey}`,
    };
  }

  private async queueOfflineSale(
    payload: Parameters<PosService['createSale']>[0],
    receiptData: unknown,
  ): Promise<PosSaleResult> {
    const queued: PosQueuedSale = {
      idempotencyKey: payload.idempotencyKey,
      receiptNumber: payload.receiptNumber,
      clientCreatedAt: payload.clientCreatedAt,
      shiftId: payload.shiftId,
      payload,
      receiptData,
      status: 'pending',
      attempts: 0,
      lastError: '',
      queuedAt: new Date().toISOString(),
    };
    await this.local.queueOfflineSale(queued);
    const stockUpdates = this.cart().map((line) => ({
      variantId: line.item.variantId,
      stock: Math.max(0, line.item.stock - line.quantity),
    }));
    await this.refreshQueueState();
    return {
      transactionId: payload.idempotencyKey,
      orderId: '',
      orderNumber: 'PENDING SYNC',
      receiptNumber: String(payload.receiptNumber).padStart(8, '0'),
      status: 'pending-sync',
      paymentMethod: payload.payment.method,
      subtotalCents: this.totalCents(),
      taxCents: 0,
      totalCents: this.totalCents(),
      amountTenderedCents: payload.payment.amountTenderedCents,
      changeGivenCents: payload.payment.changeGivenCents,
      stockUpdates,
      receipt: { qrCodeValue: `elite-pos:${payload.idempotencyKey}`, receiptData },
    };
  }

  private async refreshQueueState(): Promise<void> {
    const queued = await this.local.listQueuedSales(this.shiftId() || undefined);
    this.queuedSales.set(queued);
    this.pendingSales.set(queued.filter((sale) => sale.status === 'pending').length);
    this.rejectedSales.set(queued.filter((sale) => sale.status === 'rejected').length);
  }

  private async reportSyncState(): Promise<void> {
    const shiftId = this.shiftId();
    if (!shiftId || !this.online()) return;
    await this.pos.reportSyncState(shiftId, this.pendingSales(), this.rejectedSales());
  }

  private scheduleSyncRetry(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const delay = Math.min(60000, 1000 * 2 ** this.syncAttempt);
    this.syncAttempt += 1;
    this.syncTimer = setTimeout(() => void this.syncPendingSales(), delay);
  }

  private isNetworkError(error: unknown): boolean {
    if (!navigator.onLine) return true;
    if (typeof error !== 'object' || error === null) return false;
    return Number((error as { status?: number }).status) === 0;
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
