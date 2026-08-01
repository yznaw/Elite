import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
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
  PosCashMovement,
  PosCashMovementKind,
  PosCatalogItem,
  PosCurrentRegister,
  PosCustomer,
  PosParkedCart,
  PosSaleResult,
  PosService,
  PosShiftSummary,
  PosSyncConflict,
  PosTransactionItem,
  PosZReport,
} from '../../services/pos.service';
import { PosHardwareService, condenseHardwareError } from '../../services/pos-hardware.service';
import { AdminRefService, RefColor } from '../../services/admin-ref.service';
import { ToastService } from '../../services/toast.service';
import { ClientLoggerService } from '../../services/client-logger.service';
import { PaginationComponent } from '../../shared/pagination/pagination.component';
import { checkForPosUpdate, posBuildVersions, setPosServiceWorkerUpdateSafe } from '../../services/pos-service-worker.service';
import { PosReceiptData } from '../../services/pos-receipt-renderer.service';

type PosPhase = 'loading' | 'enrollment' | 'resume-failed' | 'shift' | 'shift-recovery' | 'selling';
type PaymentMethod = 'cash' | 'card';
interface CartLine { item: PosCatalogItem; quantity: number }
interface ProductGroup {
  id: string;
  title: string;
  stock: number;
  imageUrl: string;
  priceMinCents: number;
  priceMaxCents: number;
  items: PosCatalogItem[];
}
interface VariantColorGroup {
  key: string;
  label: string;
  stock: number;
  items: PosCatalogItem[];
}
type PosDialog = 'none' | 'park' | 'parked' | 'operations' | 'hardware' | 'shift' | 'cash-movement' | 'z-history';

const OFFLINE_CATALOG_WARN_AFTER_MS = 8 * 60 * 60 * 1000;
const OFFLINE_CATALOG_BLOCK_AFTER_MS = 12 * 60 * 60 * 1000;

@Component({
    selector: 'ap-pos',
    imports: [CommonModule, FormsModule, PaginationComponent],
    templateUrl: './pos.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './pos.component.scss'
})
export class PosComponent implements OnInit, OnDestroy {
  private readonly pos = inject(PosService);
  private readonly local = inject(PosLocalStore);
  private readonly router = inject(Router);
  readonly hardware = inject(PosHardwareService);
  readonly auth = inject(AuthService);
  private readonly refApi = inject(AdminRefService);
  private readonly toast = inject(ToastService);
  private readonly clientLogger = inject(ClientLoggerService);

  // ── Customer linking at checkout (docs/25 Phase 5) ────────────────────
  // Until now every POS sale sent `customerId: null`, so a till sale never
  // reached the customer's history, LTV, or receipt-by-email — the backend
  // has accepted a customer id since the first release; only this was missing.
  readonly selectedCustomer = signal<PosCustomer | null>(null);
  readonly customerResults = signal<PosCustomer[]>([]);
  readonly customerSearching = signal(false);
  readonly customerCreateOpen = signal(false);
  readonly customerSaving = signal(false);
  customerQuery = '';
  newCustomerName = '';
  newCustomerPhone = '';
  newCustomerEmail = '';
  private customerSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly phase = signal<PosPhase>('loading');
  readonly resumeError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly online = signal(navigator.onLine);
  readonly enrollMode = signal<'token' | 'create'>('token');
  readonly justEnrolled = signal(false);
  readonly register = signal<PosCurrentRegister | null>(null);
  readonly shiftId = signal<string | null>(null);
  readonly shiftRecovery = signal<{
    reason: 'previous-day' | 'different-cashier' | 'closing';
    cashierName: string | null;
    openedAt: string;
  } | null>(null);
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
  readonly lastSyncAt = signal<string | null>(null);
  readonly serverReachable = signal(true);
  readonly persistentStorage = signal<boolean | null>(null);
  readonly catalogCachedAt = signal<string | null>(null);
  private readonly freshnessClock = signal(Date.now());
  readonly offlineCatalogAgeMs = computed(() => {
    const cachedAt = this.catalogCachedAt();
    if (!cachedAt) return Number.POSITIVE_INFINITY;
    const cachedAtMs = Date.parse(cachedAt);
    return Number.isFinite(cachedAtMs)
      ? Math.max(0, this.freshnessClock() - cachedAtMs)
      : Number.POSITIVE_INFINITY;
  });
  readonly offlineCatalogWarning = computed(() => (
    !this.online()
    && this.offlineCatalogAgeMs() >= OFFLINE_CATALOG_WARN_AFTER_MS
    && this.offlineCatalogAgeMs() < OFFLINE_CATALOG_BLOCK_AFTER_MS
  ));
  readonly offlineCatalogBlocked = computed(() => (
    !this.online() && this.offlineCatalogAgeMs() >= OFFLINE_CATALOG_BLOCK_AFTER_MS
  ));
  readonly selectedProductId = signal<string | null>(null);
  readonly selectedVariantColorKey = signal<string | null>(null);
  readonly selectedVariantId = signal<string | null>(null);
  readonly selectedVariantQuantity = signal(1);
  readonly dialog = signal<PosDialog>('none');
  readonly parkedCarts = signal<PosParkedCart[]>([]);
  readonly operationTransaction = signal<PosSaleResult | null>(null);
  readonly shiftSummary = signal<PosShiftSummary | null>(null);
  readonly syncConflicts = signal<PosSyncConflict[]>([]);
  readonly cashMovements = signal<PosCashMovement[]>([]);
  readonly zReportHistory = signal<PosZReport[]>([]);
  readonly loadingZHistory = signal(false);
  readonly posBuildRunning = signal<string | null>(null);
  readonly posBuildDeployed = signal<string | null>(null);
  readonly checkingPosUpdate = signal(false);
  readonly posUpdateAvailable = computed(() => {
    const running = this.posBuildRunning();
    const deployed = this.posBuildDeployed();
    return Boolean(running && deployed && running !== deployed);
  });
  readonly refColors = signal<RefColor[]>([]);
  private readonly posUpdateSafetyReady = signal(false);
  private readonly posUpdateSafetyEffect = effect(() => {
    setPosServiceWorkerUpdateSafe(
      this.posUpdateSafetyReady()
      && this.cart().length === 0
      && this.pendingSales() === 0
      && this.rejectedSales() === 0
      && !this.paymentOpen()
      && !this.busy()
      && !this.syncing(),
    );
  });
  readonly totalCents = computed(() => this.cart().reduce(
    (total, line) => total + line.item.priceCents * line.quantity,
    0,
  ));
  readonly cartCount = computed(() => this.cart().reduce((total, line) => total + line.quantity, 0));
  readonly oldestPendingAgeMs = computed(() => {
    const pending = this.queuedSales().filter((sale) => sale.status === 'pending');
    if (!pending.length) return 0;
    const oldest = pending.reduce((min, sale) => Math.min(min, new Date(sale.queuedAt).getTime()), Date.now());
    return Date.now() - oldest;
  });
  readonly changeCents = computed(() => Math.max(0, this.tenderedCents() - this.totalCents()));
  readonly productGroups = computed<ProductGroup[]>(() => {
    const groups = new Map<string, ProductGroup>();
    for (const product of this.products()) {
      const id = product.productId || product.name;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          title: product.name,
          stock: 0,
          imageUrl: product.imageUrl,
          priceMinCents: product.priceCents,
          priceMaxCents: product.priceCents,
          items: [],
        };
        groups.set(id, group);
      }
      group.stock += product.stock;
      if (!group.imageUrl && product.imageUrl) group.imageUrl = product.imageUrl;
      group.priceMinCents = Math.min(group.priceMinCents, product.priceCents);
      group.priceMaxCents = Math.max(group.priceMaxCents, product.priceCents);
      group.items.push(product);
    }
    return Array.from(groups.values());
  });
  readonly selectedProductGroup = computed(() => {
    const selectedId = this.selectedProductId();
    return selectedId ? this.productGroups().find((group) => group.id === selectedId) || null : null;
  });
  readonly selectedVariantColorGroups = computed(() => {
    const group = this.selectedProductGroup();
    return group ? this.buildVariantColorGroups(group.items) : [];
  });
  readonly visibleVariantColorGroups = computed(() => {
    const query = this.variantColorQuery.trim().toLowerCase();
    return this.selectedVariantColorGroups().filter((group) => {
      return !query || group.label.toLowerCase().includes(query);
    });
  });
  readonly selectedVariantColorGroup = computed(() => {
    const selectedKey = this.selectedVariantColorKey();
    const colorGroups = this.selectedVariantColorGroups();
    return colorGroups.find((group) => group.key === selectedKey) || colorGroups[0] || null;
  });
  // Some catalog items (bags/accessories) only vary by color, not size — a
  // handful of legacy rows even have an empty `size` field, which without
  // this check would render the color name a second time as a fake "size"
  // option. If the color group is just that one no-size row, skip the size
  // step entirely (it's already auto-selected) instead of showing it.
  readonly selectedColorHasNoSizes = computed(() => {
    const group = this.selectedVariantColorGroup();
    return !!group && group.items.length === 1 && !group.items[0].size;
  });
  readonly selectedVariant = computed(() => {
    const variantId = this.selectedVariantId();
    const colorGroup = this.selectedVariantColorGroup();
    if (!variantId || !colorGroup) return null;
    return colorGroup.items.find((item) => item.variantId === variantId) || null;
  });
  readonly selectedVariantMaxQuantity = computed(() => {
    const variant = this.selectedVariant();
    if (!variant) return 0;
    const inCart = this.cart().find((line) => line.item.variantId === variant.variantId)?.quantity || 0;
    return Math.max(0, variant.stock - inCart);
  });
  readonly selectedVariantTotalCents = computed(() => {
    const variant = this.selectedVariant();
    return variant ? variant.priceCents * this.selectedVariantQuantity() : 0;
  });

  enrollmentToken = '';
  terminalName = '';
  openingFloat = '0';
  searchQuery = '';
  variantColorQuery = '';
  barcode = '';
  tendered = '';
  terminalReference = '';
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
  readonly discoveredPrinters = signal<string[]>([]);
  readonly discoveringPrinters = signal(false);
  conflictResolution = '';
  cashMovementKind: PosCashMovementKind = 'paid_out';
  cashMovementAmount = '';
  cashMovementReason = '';
  cashMovementManagerPin = '';

  readonly productPage = signal(0);
  readonly productTotal = signal(0);
  readonly productTotalPages = computed(() => Math.max(1, Math.ceil(this.productTotal() / 40)));
  readonly filterSize = signal<string | null>(null);
  readonly filterColor = signal<string | null>(null);
  readonly availableSizes = signal<string[]>([]);
  readonly availableColors = signal<string[]>([]);

  private pendingIdempotencyKey: string | null = null;
  private searchSequence = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSource: EventSource | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncAttempt = 0;
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private storageEstimateTimer: ReturnType<typeof setInterval> | null = null;
  private freshnessClockTimer: ReturnType<typeof setInterval> | null = null;
  private posBuildCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = () => {
    this.online.set(true);
    void this.syncPendingSales();
  };
  private readonly onOffline = () => {
    this.online.set(false);
    this.startHealthCheckPolling();
  };
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.syncPendingSales();
  };
  private readonly onFocus = () => void this.syncPendingSales();

  async ngOnInit(): Promise<void> {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('focus', this.onFocus);
    // Service worker is registered once at app bootstrap (main.ts), not here.
    await this.initialize();
    // Do not allow a waiting build to activate from the signals' initial zero
    // values. Read IndexedDB first; a queue found here must keep the old worker
    // alive until every sale is accepted or explicitly resolved.
    await this.refreshQueueState();
    this.posUpdateSafetyReady.set(true);
    await this.checkPersistentStorage();
    this.storageEstimateTimer = setInterval(() => void this.updateStorageEstimate(), 5 * 60 * 1000);
    this.freshnessClockTimer = setInterval(() => this.freshnessClock.set(Date.now()), 60 * 1000);
    void this.updateStorageEstimate();
    // A till stays open for days. Poll for a newer build so the Update button
    // carries a dot on its own, instead of the cashier having to guess that
    // one exists. Reading versions never reloads anything by itself.
    void this.loadPosBuildVersions();
    this.posBuildCheckTimer = setInterval(() => void this.loadPosBuildVersions(), 15 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.posUpdateSafetyReady.set(false);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('focus', this.onFocus);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
    if (this.customerSearchTimer) clearTimeout(this.customerSearchTimer);
    if (this.storageEstimateTimer) clearInterval(this.storageEstimateTimer);
    if (this.freshnessClockTimer) clearInterval(this.freshnessClockTimer);
    if (this.posBuildCheckTimer) clearInterval(this.posBuildCheckTimer);
    this.eventSource?.close();
  }

  /**
   * Runs whenever the browser's own online() signal is false, or a sale/sync
   * just failed — independent of the browser's online/offline events, which
   * only reflect the network interface, not real API reachability. Jittered
   * 15-30s so many idle registers don't all hit the API in lockstep.
   */
  private startHealthCheckPolling(): void {
    if (this.healthCheckTimer) return;
    const poll = async () => {
      this.healthCheckTimer = null;
      try {
        await this.pos.healthCheck();
        this.serverReachable.set(true);
        this.online.set(true);
        await this.syncPendingSales();
        // Only keep polling if something is still pending/rejected after
        // that sync attempt — otherwise there's nothing left to recover.
        if (this.pendingSales() > 0 || this.rejectedSales() > 0 || !this.online()) {
          this.healthCheckTimer = setTimeout(() => void poll(), 15000 + Math.random() * 15000);
        }
      } catch {
        this.serverReachable.set(false);
        this.healthCheckTimer = setTimeout(() => void poll(), 15000 + Math.random() * 15000);
      }
    };
    void poll();
  }

  private async checkPersistentStorage(): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.persist) {
      this.persistentStorage.set(null);
      return;
    }
    try {
      const persisted = await navigator.storage.persisted();
      const granted = persisted || await navigator.storage.persist();
      this.persistentStorage.set(granted);
      await this.local.setPersistentStorageStatus({ persisted: granted, checkedAt: new Date().toISOString() });
    } catch {
      this.persistentStorage.set(null);
    }
  }

  private async updateStorageEstimate(): Promise<void> {
    if (!('storage' in navigator) || !navigator.storage.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      await this.local.setStorageEstimate({
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      // Best-effort — a failed estimate is not worth surfacing to the cashier.
    }
  }

  async initialize(): Promise<void> {
    this.busy.set(true);
    try {
      let current: PosCurrentRegister;
      try {
        current = await this.pos.currentRegister();
      } catch (currentError) {
        const identity = await this.local.getRegister();
        if (!identity) {
          this.phase.set('enrollment');
          return;
        }
        // navigator.onLine only says that Windows has a network interface. A
        // shop can still have Wi-Fi while DNS, the VPN, or the API is down.
        // Treat an actual status-0 API failure as offline instead of wrongly
        // sending a previously enrolled register back to one-time setup.
        if (!this.online() || this.isNetworkError(currentError)) {
          await this.resumeOffline(identity);
          return;
        }
        try {
          await this.pos.checkIn(identity);
        } catch (checkInError) {
          if (this.isNetworkError(checkInError)) {
            await this.resumeOffline(identity);
            return;
          }
          throw checkInError;
        }
        current = await this.pos.currentRegister();
      }

      this.register.set(current);
      await this.hardware.initialize();
      await this.ensureReceiptBlock();
      if (current.shift) {
        this.shiftId.set(current.shift.id);
        await this.local.setShift({
          shiftId: current.shift.id,
          registerId: current.registerId,
          cashierId: current.shift.cashierId,
          openingFloatCents: current.shift.openingFloatCents,
          openedAt: current.shift.openedAt,
        });
        const recovery = this.shiftRecoveryFor(current.shift);
        if (recovery) {
          this.shiftRecovery.set(recovery);
          this.phase.set('shift-recovery');
          return;
        }
        await this.enterSelling();
      } else {
        this.phase.set('shift');
      }
    } catch (error) {
      // Enrollment is a one-time, owner-only ceremony: it needs a fresh token
      // from Settings and a person who can generate one. Sending a register
      // there is only correct when its identity is genuinely gone or the
      // server has rejected it. Anything else — a slow catalog load, a
      // hiccup fetching the receipt block, a stumble in hardware setup —
      // used to land here too, so a cashier who logged out by accident was
      // met with "paste a one-time token" on a counter that was fine.
      const identity = await this.local.getRegister().catch(() => null);
      if (identity && !this.isRegisterRejected(error)) {
        this.resumeError.set(this.errorMessage(error));
        this.phase.set('resume-failed');
        return;
      }
      this.toast.warning('Could not resume this register', this.errorMessage(error));
      this.phase.set('enrollment');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * True only when the server has actively disowned this register, which is
   * the one case where re-enrolling is the real fix. A revoked or deleted
   * register, or a credential that no longer matches.
   */
  private isRegisterRejected(error: unknown): boolean {
    const code = (error as { error?: { code?: string } })?.error?.code;
    return code === 'REGISTER_CREDENTIAL_INVALID'
      || code === 'REGISTER_NOT_FOUND'
      || code === 'REGISTER_DISABLED';
  }

  /** Retry after a failed resume, without touching the stored identity. */
  async retryResume(): Promise<void> {
    this.resumeError.set(null);
    this.phase.set('loading');
    await this.initialize();
  }

  private async resumeOffline(identity: { registerId: string; displayName: string }): Promise<void> {
    const storedShift = await this.local.getShift();
    const cachedCatalog = await this.local.getCatalog();
    if (!storedShift || !cachedCatalog) {
      throw new Error('This register has no offline shift or catalog cache. Connect once before working offline.');
    }
    this.online.set(false);
    this.serverReachable.set(false);
    const shift = {
      id: storedShift.shiftId,
      state: 'open' as const,
      cashierId: storedShift.cashierId || this.auth.user()?.id || '',
      cashierName: null,
      openingFloatCents: storedShift.openingFloatCents,
      openedAt: storedShift.openedAt,
    };
    this.register.set({ registerId: identity.registerId, displayName: identity.displayName, status: 'offline', shift });
    this.shiftId.set(storedShift.shiftId);
    this.products.set(cachedCatalog.products);
    this.catalogCachedAt.set(cachedCatalog.cachedAt);
    this.receiptBlock.set(await this.local.getReceiptBlock());
    await this.refreshQueueState();
    await this.hardware.initialize();
    const recovery = this.shiftRecoveryFor(shift);
    if (recovery) {
      this.shiftRecovery.set(recovery);
      this.phase.set('shift-recovery');
      return;
    }
    this.phase.set('selling');
  }

  private shiftRecoveryFor(shift: NonNullable<PosCurrentRegister['shift']>): {
    reason: 'previous-day' | 'different-cashier' | 'closing';
    cashierName: string | null;
    openedAt: string;
  } | null {
    if (shift.state === 'closing') return { reason: 'closing', cashierName: shift.cashierName, openedAt: shift.openedAt };
    if (this.qatarDate(shift.openedAt) !== this.qatarDate(new Date().toISOString())) {
      return { reason: 'previous-day', cashierName: shift.cashierName, openedAt: shift.openedAt };
    }
    const userId = this.auth.user()?.id;
    if (userId && shift.cashierId && shift.cashierId !== userId) {
      return { reason: 'different-cashier', cashierName: shift.cashierName, openedAt: shift.openedAt };
    }
    return null;
  }

  private qatarDate(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
  }

  setEnrollMode(mode: 'token' | 'create'): void {
    this.enrollMode.set(mode);
    this.enrollmentToken = '';
    this.terminalName = '';
  }

  async enrollTerminal(): Promise<void> {
    if (!this.enrollmentToken.trim() && !this.terminalName.trim()) {
      this.toast.warning('Enter an enrollment token or a name for this terminal.');
      return;
    }
    this.busy.set(true);
    try {
      let token = this.enrollmentToken.trim();
      if (!token) {
        const enrollment = await this.pos.createEnrollmentToken(this.terminalName.trim());
        token = enrollment.token;
      }
      const identity = await this.pos.enroll(token);
      await this.local.setRegister(identity);
      this.register.set(await this.pos.currentRegister());
      await this.hardware.initialize();
      await this.ensureReceiptBlock();
      this.toast.success('Register connected', identity.displayName);
      this.justEnrolled.set(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
      this.phase.set('shift');
    } catch (error) {
      this.toast.warning(...this.enrollmentErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private enrollmentErrorMessage(error: unknown): [string, string] {
    if (this.isNetworkError(error)) {
      return ["You're offline", 'Connect to the internet to enroll this register for the first time.'];
    }
    const code = this.errorCode(error);
    const status = typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;
    if (status === 429) {
      return ['Too many attempts', 'Wait a few minutes before trying again.'];
    }
    switch (code) {
      case 'ENROLLMENT_TOKEN_EXPIRED':
        return ['Token expired', 'Tokens are valid for 15 minutes. Ask your manager for a new one.'];
      case 'ENROLLMENT_TOKEN_USED':
        return ['Token already used', 'This token already connected a register. Ask your manager for a new one.'];
      case 'ENROLLMENT_TOKEN_INVALID':
        return ['Invalid token', 'Check for typos, or ask your manager to generate a new one.'];
      default:
        return ["Couldn't connect this register", this.errorMessage(error)];
    }
  }

  async openShift(): Promise<void> {
    const openingFloatCents = this.moneyInputToCents(this.openingFloat);
    if (openingFloatCents === null) {
      this.toast.warning('Opening cash must be a valid non-negative amount.');
      return;
    }
    if (!this.hardware.ready()) {
      // Two different situations wear the same "not ready" badge, and telling
      // them apart matters at 9am: a printer that cannot be reached stops
      // receipts now, while a stopped signer only costs offline printing,
      // which is invisible until the internet drops.
      const printerReady = this.hardware.connected() && this.hardware.printerAvailable();
      this.toast.warning(
        'Hardware is not fully ready',
        printerReady
          ? 'Receipts will print normally. The local signer is not running, so printing will stop working if this register loses internet.'
          : 'The shift can open, but receipts may not print until the automatic reconnect succeeds.',
      );
    }
    // persist() resolving false often means private/incognito mode, where an
    // offline sale queued in IndexedDB can be silently wiped when the
    // session ends. persist()/quota heuristics are known to be unreliable
    // across browsers though, so this warns rather than hard-blocking — a
    // false positive here would be worse than the risk it's guarding against
    // on a live register mid-shift.
    if (this.persistentStorage() === false) {
      this.toast.warning(
        'This browser could not guarantee persistent storage',
        'Offline sales may be lost if this is a private/incognito window. Avoid using one on this register.',
      );
    }
    this.busy.set(true);
    try {
      const shift = await this.pos.openShift(openingFloatCents);
      this.shiftId.set(shift.shiftId);
      await this.local.setShift(shift);
      this.toast.success('Shift opened', `Opening float ${this.formatMoney(openingFloatCents)}`);
      await this.enterSelling();
    } catch (error) {
      this.toast.error("Couldn't open shift", this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  queueSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadProducts(this.searchQuery, 0), 180);
  }

  async scanBarcode(): Promise<void> {
    const value = this.barcode.trim();
    if (!value) return;
    try {
      const product = this.online()
        ? await this.pos.findBarcode(value)
        : this.products().find((item) => item.barcode === value);
      if (!product) throw new Error(`No cached product uses barcode ${value}.`);
      this.addToCart(product);
      this.barcode = '';
    } catch (error) {
      this.toast.warning('Barcode not found', this.errorMessage(error));
    }
  }

  addToCart(item: PosCatalogItem): void {
    if (item.stock <= 0) return;
    const existing = this.cart().find((line) => line.item.variantId === item.variantId);
    if (existing && existing.quantity >= item.stock) {
      this.toast.warning(`Only ${item.stock} units of ${item.name} are available.`);
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
    if (!this.canSellFromOfflineCatalog()) return;
    this.paymentMethod.set('cash');
    this.tendered = (this.totalCents() / 100).toFixed(2);
    this.terminalReference = '';
    this.customerQuery = '';
    this.customerResults.set([]);
    this.customerCreateOpen.set(false);
    this.paymentOpen.set(true);
  }

  // ── Customer at checkout ────────────────────────────────────────────────
  // Walk-in stays the default and costs zero taps: a queue at the till must
  // never wait on data entry. Linking is opt-in, one search away.

  queueCustomerSearch(): void {
    if (this.customerSearchTimer) clearTimeout(this.customerSearchTimer);
    const query = this.customerQuery.trim();
    if (query.length < 3) {
      this.customerResults.set([]);
      return;
    }
    this.customerSearchTimer = setTimeout(() => void this.searchCustomers(query), 250);
  }

  private async searchCustomers(query: string): Promise<void> {
    if (!this.online()) return;
    this.customerSearching.set(true);
    try {
      this.customerResults.set(await this.pos.searchCustomers(query));
    } catch {
      // The interceptor already reported it; an empty result is the right
      // fallback at a till — never block a sale on a lookup.
      this.customerResults.set([]);
    } finally {
      this.customerSearching.set(false);
    }
  }

  linkCustomer(customer: PosCustomer): void {
    this.selectedCustomer.set(customer);
    this.customerResults.set([]);
    this.customerQuery = '';
    this.customerCreateOpen.set(false);
  }

  clearCustomer(): void {
    this.selectedCustomer.set(null);
    this.customerResults.set([]);
    this.customerQuery = '';
  }

  openCustomerCreate(): void {
    // Prefill from whatever the cashier already typed: digits look like a
    // phone, anything else like a name.
    const typed = this.customerQuery.trim();
    const isPhone = /^[0-9+\-\s()]+$/.test(typed);
    this.newCustomerName = isPhone ? '' : typed;
    this.newCustomerPhone = isPhone ? typed : '';
    this.newCustomerEmail = '';
    this.customerCreateOpen.set(true);
  }

  async createCustomer(): Promise<void> {
    const fullName = this.newCustomerName.trim();
    if (!fullName || this.customerSaving()) return;
    if (!this.newCustomerPhone.trim() && !this.newCustomerEmail.trim()) {
      this.toast.warning('Enter a phone number or an email address.');
      return;
    }
    this.customerSaving.set(true);
    try {
      const customer = await this.pos.createCustomer({
        fullName,
        phone: this.newCustomerPhone.trim() || undefined,
        email: this.newCustomerEmail.trim() || undefined,
      });
      this.linkCustomer(customer);
      // Worth saying out loud: the cashier typed a phone that turned out to
      // belong to an existing website customer, and this sale now joins that
      // person's history rather than starting a second one.
      if (customer.linkedExisting) {
        this.toast.success('Linked to an existing customer', `${customer.name} is already in the customer list.`);
      } else {
        this.toast.success('Customer created', customer.name);
      }
    } catch (error) {
      this.toast.error("Couldn't save customer", this.errorMessage(error));
    } finally {
      this.customerSaving.set(false);
    }
  }

  selectPayment(method: PaymentMethod): void {
    this.paymentMethod.set(method);
    if (method === 'cash') this.tendered = (this.totalCents() / 100).toFixed(2);
    else this.terminalReference = '';
  }

  async completeSale(): Promise<void> {
    const shiftId = this.shiftId();
    if (!shiftId || !this.cart().length || this.busy()) return;
    if (!this.canSellFromOfflineCatalog()) return;

    const method = this.paymentMethod();
    const tenderedCents = method === 'cash' ? this.moneyInputToCents(this.tendered) : 0;
    if (method === 'cash' && (tenderedCents === null || tenderedCents < this.totalCents())) {
      this.toast.warning('Tendered cash is less than the total.');
      return;
    }
    const terminalReference = this.terminalReference.trim();
    if (method === 'card' && !terminalReference) {
      this.toast.warning('Enter the terminal reference or approval code before completing a card sale.');
      return;
    }
    const amountTenderedCents = tenderedCents ?? 0;

    let completedSale: { receiptData: unknown; openDrawer: boolean; queuedIdempotencyKey: string | null } | null = null;
    this.busy.set(true);
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
        customerId: this.selectedCustomer()?.customerId ?? null,
        items: this.cart().map((line) => ({
          variantId: line.item.variantId,
          quantity: line.quantity,
          unitPriceCents: line.item.priceCents,
        })),
        payment: {
          method,
          cashAmountCents: method === 'cash' ? totalCents : 0,
          cardAmountCents: method === 'card' ? totalCents : 0,
          amountTenderedCents,
          changeGivenCents: method === 'cash' ? amountTenderedCents - totalCents : 0,
          terminalReference: method === 'card' ? terminalReference : undefined,
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
          // Start recovering immediately rather than waiting for a browser
          // `online` event that may never fire (the network interface can
          // stay "up" while the API itself is unreachable).
          this.startHealthCheckPolling();
          if (!this.canSellFromOfflineCatalog()) return;
          result = await this.queueOfflineSale(payload, receiptData);
        }
      } else {
        result = await this.queueOfflineSale(payload, receiptData);
      }
      this.receiptBlock.set(await this.local.getReceiptBlock());
      this.applyStockUpdates(result.stockUpdates);
      this.cart.set([]);
      this.selectedCustomer.set(null);
      this.pendingIdempotencyKey = null;
      this.paymentOpen.set(false);
      this.lastSale.set(result);
      // The sale is fully committed at this point. Printing is best-effort and
      // must not hold the `busy` flag — otherwise a slow/failed print would
      // keep "Take payment" disabled for the next customer. Print after the
      // finally releases busy; QZ calls are themselves timeout-guarded.
      completedSale = {
        receiptData: result.receipt.receiptData,
        openDrawer: method === 'cash',
        queuedIdempotencyKey: result.status === 'pending-sync' ? result.transactionId : null,
      };
    } catch (error) {
      this.toast.error("Couldn't complete sale", this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }

    if (completedSale) {
      try {
        await this.hardware.printReceipt(completedSale.receiptData, completedSale.openDrawer);
        if (completedSale.queuedIdempotencyKey) {
          await this.local.appendJournal({ idempotencyKey: completedSale.queuedIdempotencyKey, event: 'printed', at: new Date().toISOString() });
        }
      } catch (printError) {
        this.toast.warning('Sale saved, receipt not printed', this.errorMessage(printError));
        // PRINT_FAILED is the code the server counts per register: five in one
        // shift raises an email, since a jammed printer at the counter is
        // invisible to anyone outside the shop (docs/24, Phase E).
        this.clientLogger.logError('pos-client', printError, {
          code: 'PRINT_FAILED',
          severity: 'warn',
          context: { printerName: this.hardware.printerName(), openDrawer: completedSale.openDrawer },
        });
      }
    }
  }

  private canSellFromOfflineCatalog(): boolean {
    this.freshnessClock.set(Date.now());
    if (!this.offlineCatalogBlocked()) return true;
    this.toast.warning(
      'Offline sales are blocked',
      'The cached catalog is 12 hours old or unavailable. Reconnect this register to refresh prices and stock before taking payment.',
    );
    return false;
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
      this.toast.warning("Couldn't reprint receipt", this.errorMessage(error));
    }
  }

  /**
   * Reprints whatever transaction is currently looked up in the void/refund
   * panel — the only reprint path before this covered just the sale that was
   * just rung up (`reprintLastSale`, backed by an in-memory signal that's
   * gone after the modal closes or the tab reloads). This one works for any
   * past transaction, since `findTransaction` always returns a full
   * `receipt.receiptData` reconstructed from the database.
   */
  async reprintLookedUpTransaction(): Promise<void> {
    const transaction = this.operationTransaction();
    if (!transaction) return;
    try {
      await this.hardware.printReceipt(transaction.receipt.receiptData, false);
      this.toast.success('Receipt reprinted');
    } catch (error) {
      this.toast.warning("Couldn't reprint receipt", this.errorMessage(error));
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
      for (const sale of pending) {
        await this.local.appendJournal({ idempotencyKey: sale.idempotencyKey, event: 'sync_attempted', at: new Date().toISOString() });
      }
      const response = await this.pos.syncSales(pending.map((sale) => ({
        idempotencyKey: sale.idempotencyKey,
        receiptNumber: sale.receiptNumber,
        clientCreatedAt: sale.clientCreatedAt,
        payload: sale.payload,
      })));
      for (const accepted of [...response.accepted, ...response.acceptedWithConflicts]) {
        // Kept (not deleted) for the local audit window — see
        // markQueuedSaleSynced's doc comment and AUDIT_WINDOW_MS.
        await this.local.markQueuedSaleSynced(accepted.idempotencyKey);
        await this.local.appendJournal({ idempotencyKey: accepted.idempotencyKey, event: 'accepted', at: new Date().toISOString() });
      }
      for (const rejected of response.rejected) {
        await this.local.markQueuedSaleRejected(rejected.idempotencyKey, rejected.message);
        await this.local.appendJournal({
          idempotencyKey: rejected.idempotencyKey, event: 'rejected', at: new Date().toISOString(),
          detail: { reason: rejected.reason, code: rejected.code },
        });
      }
      this.syncAttempt = 0;
      this.lastSyncAt.set(new Date().toISOString());
      await this.refreshQueueState();
      await this.reportSyncState();
      await this.loadProducts(this.searchQuery);
      await this.local.cleanupSyncedSales();
      if (response.acceptedWithConflicts.length) {
        this.toast.warning(
          `${response.acceptedWithConflicts.length} offline sale conflict(s) need manager reconciliation.`,
        );
      }
    } catch (error) {
      this.scheduleSyncRetry();
      this.startHealthCheckPolling();
      this.toast.warning('Offline sync paused', this.errorMessage(error));
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
      this.toast.success('Sale parked');
      await this.loadParkedCarts();
    } catch (error) {
      this.toast.error("Couldn't park sale", this.errorMessage(error));
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
      this.toast.warning("Couldn't refresh parked sales", this.errorMessage(error));
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
      this.toast.warning('Transaction not found', this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async voidCurrentTransaction(): Promise<void> {
    const transaction = this.operationTransaction();
    if (!transaction || !this.managerPin || !this.correctionReason.trim()) return;
    const originalReceipt = transaction.receipt?.receiptData as PosReceiptData | undefined;
    if (!originalReceipt?.receiptNumber) {
      this.toast.error("Couldn't void sale", 'The original receipt data is unavailable. Look up the sale again before retrying.');
      return;
    }
    let completedVoid: { receiptData: PosReceiptData; openDrawer: boolean } | null = null;
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
      this.toast.success('Sale voided');
      completedVoid = {
        receiptData: {
          ...originalReceipt,
          kind: 'void',
          transactionId: transaction.transactionId,
          createdAt: result.voidedAt,
          paymentMethod: transaction.paymentMethod,
          totalCents: result.amountCents,
          reason: result.reason,
          lookupCode: `elite-pos:${transaction.transactionId}`,
        },
        openDrawer: transaction.paymentMethod === 'cash',
      };
    } catch (error) {
      this.toast.error("Couldn't void sale", this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }

    if (completedVoid) {
      try {
        await this.hardware.printReceipt(completedVoid.receiptData, completedVoid.openDrawer);
      } catch (printError) {
        this.toast.warning('Sale voided, receipt not printed', this.errorMessage(printError));
        this.clientLogger.logError('pos-client', printError, {
          code: 'PRINT_FAILED',
          severity: 'warn',
          context: { receiptKind: 'void', printerName: this.hardware.printerName(), openDrawer: completedVoid.openDrawer },
        });
      }
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
      this.toast.success('Refund completed');
    } catch (error) {
      this.toast.error("Couldn't complete refund", this.errorMessage(error));
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
    void this.loadPosBuildVersions();
    // Re-typing the exact QZ printer name from memory is the main friction
    // point after site data gets cleared (browser "clear cookies" wipes the
    // IndexedDB-stored setting too, not just cookies). Auto-scan whenever
    // nothing is configured yet so re-setup is a click, not a memory test.
    if (!this.hardwarePrinter) await this.discoverPrinters();
  }

  private async loadPosBuildVersions(): Promise<void> {
    const { running, deployed } = await posBuildVersions();
    this.posBuildRunning.set(running);
    this.posBuildDeployed.set(deployed);
  }

  /**
   * A till left open all day only looks for a new build on navigation, so it
   * can run several deploys behind with nothing on screen saying so. This is
   * the manual check, and it reloads onto the new build when there is one.
   */
  async checkPosUpdate(): Promise<void> {
    this.checkingPosUpdate.set(true);
    try {
      const result = await checkForPosUpdate();
      await this.loadPosBuildVersions();
      if (result === 'updating') {
        this.toast.success('Updating', 'A newer version was found. The register will reload.');
      } else if (result === 'current') {
        this.toast.success('Up to date', 'This register is already running the newest version.');
      } else if (result === 'busy') {
        this.toast.warning(
          'Update is ready but held back',
          'Finish the sale and clear any queued offline sales first, then check again.',
        );
      }
    } catch (error) {
      this.toast.error("Couldn't check for updates", this.errorMessage(error));
    } finally {
      this.checkingPosUpdate.set(false);
    }
  }

  async discoverPrinters(): Promise<void> {
    this.discoveringPrinters.set(true);
    try {
      const found = await this.hardware.printers();
      this.discoveredPrinters.set(found);
      if (found.length === 1 && !this.hardwarePrinter) this.hardwarePrinter = found[0];
    } catch (error) {
      this.toast.warning("Couldn't scan for printers", this.errorMessage(error));
    } finally {
      this.discoveringPrinters.set(false);
    }
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
      this.toast.success('Hardware settings saved');
    } catch (error) {
      this.toast.error("Couldn't save hardware settings", this.errorMessage(error));
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
      this.toast.warning("Couldn't load shift report", this.errorMessage(error));
    }
  }

  /**
   * The shift's own operator closes it without a manager PIN when the shop
   * allows self-close (docs/12, "Manager PIN"). The server decides; this only
   * decides whether the PIN field is shown and required.
   */
  shiftSelfCloseAllowed(): boolean {
    return this.shiftSummary()?.selfCloseAllowed === true;
  }

  async closeCurrentShift(): Promise<void> {
    const summary = this.shiftSummary();
    const physicalCashCents = this.moneyInputToCents(this.physicalCash);
    if (!summary || physicalCashCents === null) return;
    const selfClose = this.shiftSelfCloseAllowed();
    if (!selfClose && !this.managerPin) return;
    await this.refreshQueueState();
    if (this.pendingSales() || this.rejectedSales()) {
      this.toast.warning('Resolve all pending and rejected offline sales before closing the shift.');
      return;
    }
    this.busy.set(true);
    try {
      await this.reportSyncState();
      const override = selfClose ? null : await this.pos.verifyManagerPin(this.managerPin, 'z-report');
      await this.pos.closeShift({
        shiftId: summary.shiftId,
        physicalCashCents,
        idempotencyKey: crypto.randomUUID(),
        ...(override ? { managerOverrideId: override.overrideId, managerOverrideToken: override.token } : {}),
      });
      this.dialog.set('none');
      this.toast.success('Shift closed', 'Z report generated.');
      await this.local.clearShift();
      this.shiftId.set(null);
      if (this.phase() === 'shift-recovery') {
        this.shiftRecovery.set(null);
        this.register.update((register) => register ? { ...register, shift: null } : register);
        this.phase.set('shift');
        return;
      }
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      this.toast.error("Couldn't close shift", this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** paid_out, safe_drop, and no_sale_drawer_open remove cash or open the
   *  drawer without a sale — same accountability bar as void/refund, so they
   *  need a manager PIN. paid_in and float_adjust (topping the till up) don't. */
  cashMovementNeedsOverride(kind: PosCashMovementKind = this.cashMovementKind): boolean {
    return kind === 'paid_out' || kind === 'safe_drop' || kind === 'no_sale_drawer_open';
  }

  private static readonly CASH_MOVEMENT_LABELS: Record<PosCashMovementKind, string> = {
    paid_in: 'Paid In',
    paid_out: 'Paid Out',
    safe_drop: 'Safe Drop',
    float_adjust: 'Float Adjust',
    no_sale_drawer_open: 'No-Sale Drawer Open',
  };

  cashMovementKindLabel(kind: PosCashMovementKind): string {
    return PosComponent.CASH_MOVEMENT_LABELS[kind] || kind;
  }

  async openCashMovementDialog(): Promise<void> {
    const summary = this.shiftSummary();
    if (!summary) return;
    this.cashMovementKind = 'paid_out';
    this.cashMovementAmount = '';
    this.cashMovementReason = '';
    this.cashMovementManagerPin = '';
    this.dialog.set('cash-movement');
    try {
      this.cashMovements.set(await this.pos.listCashMovements(summary.shiftId));
    } catch (error) {
      this.toast.warning("Couldn't load cash movements", this.errorMessage(error));
    }
  }

  async recordCashMovement(): Promise<void> {
    const summary = this.shiftSummary();
    if (!summary || !this.cashMovementReason.trim()) return;
    const needsOverride = this.cashMovementNeedsOverride();
    if (needsOverride && !this.cashMovementManagerPin) return;
    const amountCents = this.cashMovementKind === 'no_sale_drawer_open'
      ? 0
      : this.moneyInputToCents(this.cashMovementAmount);
    if (amountCents === null || (this.cashMovementKind !== 'no_sale_drawer_open' && amountCents <= 0)) return;

    this.busy.set(true);
    try {
      let override: { overrideId: string; token: string } | null = null;
      if (needsOverride) {
        override = await this.pos.verifyManagerPin(this.cashMovementManagerPin, 'drawer-open');
      }
      await this.pos.recordCashMovement({
        shiftId: summary.shiftId,
        kind: this.cashMovementKind,
        amountCents,
        reason: this.cashMovementReason.trim(),
        idempotencyKey: crypto.randomUUID(),
        ...(override ? { managerOverrideId: override.overrideId, managerOverrideToken: override.token } : {}),
      });
      if (this.cashMovementKind === 'no_sale_drawer_open' && this.hardware.configured()) {
        await this.hardware.openDrawer().catch(() => undefined);
      }
      this.cashMovements.set(await this.pos.listCashMovements(summary.shiftId));
      this.shiftSummary.set(await this.pos.shiftSummary());
      this.cashMovementAmount = '';
      this.cashMovementReason = '';
      this.cashMovementManagerPin = '';
      this.toast.success('Cash movement recorded');
    } catch (error) {
      this.toast.error("Couldn't record cash movement", this.errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  async openZHistoryDialog(): Promise<void> {
    this.dialog.set('z-history');
    this.loadingZHistory.set(true);
    try {
      this.zReportHistory.set(await this.pos.listZReports());
    } catch (error) {
      this.toast.warning("Couldn't load Z-report history", this.errorMessage(error));
    } finally {
      this.loadingZHistory.set(false);
    }
  }

  async reprintZReport(report: PosZReport): Promise<void> {
    try {
      await this.hardware.printZReport(report);
      this.toast.success('Z-report reprinted');
    } catch (error) {
      this.toast.warning("Couldn't print Z-report", this.errorMessage(error));
    }
  }

  exportZHistoryCsv(): void {
    const rows = this.zReportHistory();
    if (!rows.length) return;
    const header = [
      'Z Report ID', 'Created At', 'Opening Float', 'Gross Sales', 'Cash Sales', 'Card Sales',
      'Refunds', 'Voids', 'Net Sales', 'Cash In', 'Cash Out', 'Expected Cash', 'Physical Cash',
      'Variance', 'Transactions', 'Refund Count', 'Void Count',
    ];
    const csvRows = rows.map((r) => [
      r.zReportId, this.formatDateTime(r.createdAt),
      this.formatMoney(r.openingFloatCents), this.formatMoney(r.grossSalesCents),
      this.formatMoney(r.cashSalesCents), this.formatMoney(r.cardSalesCents),
      this.formatMoney(r.refundTotalCents), this.formatMoney(r.voidTotalCents),
      this.formatMoney(r.netSalesCents), this.formatMoney(r.cashInCents), this.formatMoney(r.cashOutCents),
      this.formatMoney(r.expectedCashCents), this.formatMoney(r.physicalCashCents), this.formatMoney(r.varianceCents),
      String(r.transactionCount), String(r.refundCount), String(r.voidCount),
    ]);
    const csv = [header, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // BOM-prefixed for Excel compatibility with non-ASCII (Arabic) content.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `z-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
      this.toast.success('Conflict resolved');
    } catch (error) {
      this.toast.error("Couldn't resolve conflict", this.errorMessage(error));
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

  /** CSV cells write the raw ISO timestamp otherwise (e.g.
   *  "2026-07-19T21:51:35.973Z") — normalizes to a readable local format. */
  formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const datePart = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  }

  formatAge(ms: number): string {
    if (ms <= 0) return '';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  formatSyncTime(iso: string | null): string {
    if (!iso) return 'never';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60000) return 'just now';
    return `${this.formatAge(diffMs)} ago`;
  }

  productImage(item: PosCatalogItem): string {
    return this.pos.mediaUrl(item.imageUrl);
  }

  productGroupImage(group: ProductGroup): string {
    return group.imageUrl ? this.pos.mediaUrl(group.imageUrl) : '';
  }

  groupPriceLabel(group: ProductGroup): string {
    if (group.priceMinCents === group.priceMaxCents) return this.formatMoney(group.priceMinCents);
    return `${this.formatMoney(group.priceMinCents)} - ${this.formatMoney(group.priceMaxCents)}`;
  }

  sizeLabel(item: PosCatalogItem): string {
    return item.size || item.variant || item.sku;
  }

  colorCssFor(name: string): string {
    const normalized = this.normalizeColorName(name);
    const refColor = this.refColors().find((color) => this.normalizeColorName(color.name_en) === normalized);
    if (refColor?.hex) return refColor.hex;
    const fallback = this.fallbackVariantColors[normalized]
      || Object.entries(this.fallbackVariantColors).find(([key]) => normalized.includes(key))?.[1];
    if (fallback) return fallback;
    return this.colorFromName(normalized || 'default');
  }

  colorSwatchImageFor(name: string): string | null {
    const normalized = this.normalizeColorName(name);
    return this.refColors().find((color) => this.normalizeColorName(color.name_en) === normalized)?.swatch_image_url ?? null;
  }

  chooseVariantColor(colorKey: string): void {
    this.selectedVariantColorKey.set(colorKey);
    const colorGroup = this.selectedVariantColorGroups().find((group) => group.key === colorKey);
    this.selectedVariantId.set(this.firstAvailableVariant(colorGroup)?.variantId || null);
    this.resetSelectedVariantQuantity();
  }

  chooseVariantSize(item: PosCatalogItem): void {
    if (item.stock <= 0) return;
    this.selectedVariantId.set(item.variantId);
    this.resetSelectedVariantQuantity();
  }

  addSelectedVariant(): void {
    const variant = this.selectedVariant();
    const quantity = Math.min(this.selectedVariantQuantity(), this.selectedVariantMaxQuantity());
    if (!variant || quantity <= 0) return;
    const existing = this.cart().find((line) => line.item.variantId === variant.variantId);
    this.cart.update((lines) => existing
      ? lines.map((line) => line.item.variantId === variant.variantId ? { ...line, quantity: line.quantity + quantity } : line)
      : [...lines, { item: variant, quantity }]);
    this.pendingIdempotencyKey = null;
    this.closeVariantPicker();
  }

  changeSelectedVariantQuantity(delta: number): void {
    const max = this.selectedVariantMaxQuantity();
    this.selectedVariantQuantity.update((quantity) => Math.min(max, Math.max(1, quantity + delta)));
  }

  stockGaugePercent(item: PosCatalogItem, items: PosCatalogItem[]): number {
    if (item.stock <= 0) return 0;
    const max = Math.max(1, ...items.map((variant) => variant.stock));
    return Math.max(8, Math.round((item.stock / max) * 100));
  }

  stockGaugeLabel(item: PosCatalogItem): string {
    if (item.stock <= 0) return 'Sold out';
    if (item.stock <= 3) return 'Low';
    return 'In stock';
  }

  openVariantPicker(group: ProductGroup): void {
    if (!group.items.length) return;
    this.selectedProductId.set(group.id);
    const colorGroups = this.buildVariantColorGroups(group.items);
    const initialColor = colorGroups.find((color) => color.stock > 0) || colorGroups[0] || null;
    this.selectedVariantColorKey.set(initialColor?.key || null);
    this.selectedVariantId.set(this.firstAvailableVariant(initialColor)?.variantId || null);
    this.resetSelectedVariantQuantity();
  }

  closeVariantPicker(): void {
    this.selectedProductId.set(null);
    this.selectedVariantColorKey.set(null);
    this.selectedVariantId.set(null);
    this.selectedVariantQuantity.set(1);
    this.variantColorQuery = '';
  }

  chooseVariant(item: PosCatalogItem): void {
    const existing = this.cart().find((line) => line.item.variantId === item.variantId);
    this.addToCart(item);
    if (!existing || existing.quantity < item.stock) this.closeVariantPicker();
  }

  trackVariant(_index: number, value: PosCatalogItem | CartLine): string {
    return 'item' in value ? value.item.variantId : value.variantId;
  }

  private buildVariantColorGroups(items: PosCatalogItem[]): VariantColorGroup[] {
    const groups = new Map<string, VariantColorGroup>();
    for (const item of items) {
      const label = item.color || 'Default';
      const key = label.trim().toLowerCase() || 'default';
      let group = groups.get(key);
      if (!group) {
        group = { key, label, stock: 0, items: [] };
        groups.set(key, group);
      }
      group.stock += item.stock;
      group.items.push(item);
    }
    return Array.from(groups.values());
  }

  private firstAvailableVariant(group: VariantColorGroup | null | undefined): PosCatalogItem | null {
    if (!group) return null;
    return group.items.find((item) => item.stock > 0) || group.items[0] || null;
  }

  private resetSelectedVariantQuantity(): void {
    this.selectedVariantQuantity.set(this.selectedVariantMaxQuantity() > 0 ? 1 : 0);
  }

  private async enterSelling(): Promise<void> {
    this.phase.set('selling');
    await this.loadProducts();
    if (this.online()) this.connectEvents();
    await Promise.all([this.refreshQueueState(), this.loadParkedCarts(), this.loadReferenceColors(), this.loadProductFilters()]);
    await this.syncPendingSales();
  }

  private async loadProductFilters(): Promise<void> {
    if (!this.online()) return;
    try {
      const filters = await this.pos.listProductFilters();
      this.availableSizes.set(filters.sizes);
      this.availableColors.set(filters.colors);
    } catch {
      this.availableSizes.set([]);
      this.availableColors.set([]);
    }
  }

  private async loadReferenceColors(): Promise<void> {
    if (!this.online()) return;
    try {
      this.refColors.set(await this.refApi.getColors());
    } catch {
      this.refColors.set([]);
    }
  }

  private normalizeColorName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private colorFromName(name: string): string {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return `hsl(${hash} 42% 58%)`;
  }

  private readonly fallbackVariantColors: Record<string, string> = {
    beige: '#d8c1a0',
    black: '#171717',
    blue: '#2f67b2',
    brown: '#7b4a2d',
    burgundy: '#7f1d3a',
    camel: '#bf8f5c',
    cream: '#f3ead7',
    default: '#c9a84c',
    gold: '#c9a84c',
    gray: '#9ca3af',
    green: '#2f7d57',
    grey: '#9ca3af',
    ivory: '#f7f0dc',
    lavender: '#b6a1dc',
    maroon: '#7f1d1d',
    mint: '#9bd8c1',
    navy: '#1f3763',
    nude: '#e2bda6',
    olive: '#73733f',
    orange: '#d97706',
    pink: '#e89ab5',
    purple: '#7c4ab0',
    red: '#c83f3f',
    rose: '#d96d88',
    silver: '#c7cbd1',
    tan: '#c9a77d',
    teal: '#25817e',
    turquoise: '#29a9a6',
    white: '#ffffff',
    yellow: '#e4bd35',
  };

  private async loadProducts(query = '', page = this.productPage()): Promise<void> {
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
      const result = await this.pos.searchProducts(query, {
        page,
        size: this.filterSize(),
        color: this.filterColor(),
      });
      if (sequence === this.searchSequence) {
        this.products.set(result.products);
        this.productPage.set(result.page);
        this.productTotal.set(result.total);
        if (!query && page === 0 && !this.filterSize() && !this.filterColor()) {
          const cachedAt = new Date().toISOString();
          this.catalogCachedAt.set(cachedAt);
          await this.local.setCatalog({ products: result.products, cachedAt });
        }
      }
    } catch (error) {
      const cached = await this.local.getCatalog();
      if (sequence === this.searchSequence && cached) {
        this.products.set(cached.products);
        this.catalogCachedAt.set(cached.cachedAt);
      } else if (sequence === this.searchSequence) {
        this.toast.warning("Couldn't load products", this.errorMessage(error));
      }
    }
  }

  onProductPageChange(page: number): void {
    void this.loadProducts(this.searchQuery, page);
  }

  setSizeFilter(size: string): void {
    this.filterSize.set(size || null);
    void this.loadProducts(this.searchQuery, 0);
  }

  setColorFilter(color: string): void {
    this.filterColor.set(color || null);
    void this.loadProducts(this.searchQuery, 0);
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
    payment: { method: PaymentMethod; amountTenderedCents: number; changeGivenCents: number; terminalReference?: string };
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
      terminalReference: payload.payment.terminalReference,
      items: this.cart().map((line) => ({
        name: line.item.name,
        nameAr: line.item.nameAr || null,
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
    await this.local.appendJournal({ idempotencyKey: queued.idempotencyKey, event: 'created', at: new Date().toISOString() });
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
    // Every shipped log entry carries which register, which shift, and how many
    // sales were still unsynced at the moment it happened — the three facts
    // that turn a stack trace into an explanation.
    this.clientLogger.setContext({
      registerId: this.register()?.registerId ?? null,
      shiftId: this.shiftId(),
      pendingSales: this.pendingSales(),
    });
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

  /**
   * Message shown to the cashier, with the server's correlation id appended as
   * a short reference code.
   *
   * The reference is the point: a cashier reads six characters over the phone
   * and support resolves it straight to the request, the register, the shift
   * and the stack trace (`grep '"requestId":"…"'`, or the Diagnostics page).
   * Before this, "it says something went wrong" was the entire bug report.
   */
  private errorMessage(error: unknown): string {
    let message = 'The POS request could not be completed.';
    let reference: string | null = null;

    if (typeof error === 'object' && error !== null) {
      const candidate = error as { message?: string; error?: { message?: string; requestId?: string } };
      message = candidate.error?.message || candidate.message || message;
      reference = candidate.error?.requestId ?? null;
    }
    // A QZ print failure buries its cause behind the whole base64 payload, so
    // an untouched message fills the toast with image data and shows the
    // cashier nothing.
    message = condenseHardwareError(message);

    if (!reference) return message;
    // Plain string, not an i18n key: this component is deliberately
    // English-only (it has no I18nService injected anywhere), and "Ref" reads
    // the same to an Arabic-speaking cashier reading a code aloud.
    return `${message} (Ref ${reference.slice(-6)})`;
  }

  private errorCode(error: unknown): string | null {
    if (typeof error !== 'object' || error === null) return null;
    const candidate = error as { error?: { code?: string } };
    return candidate.error?.code || null;
  }
}
