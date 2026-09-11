import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import qz from 'qz-tray';
import { PosReceiptRenderer } from '../../projects/admin-portal/src/app/services/pos-receipt-renderer.service';
import { PosHardwareService } from '../../projects/admin-portal/src/app/services/pos-hardware.service';
import { PosService } from '../../projects/admin-portal/src/app/services/pos.service';
import { PosLocalStore } from '../../projects/admin-portal/src/app/services/pos-local-store.service';
import { ClientLoggerService } from '../../projects/admin-portal/src/app/services/client-logger.service';
import { PosComponent } from '../../projects/admin-portal/src/app/pages/pos/pos.component';

const receipt = {
  kind: 'sale', receiptNumber: '1001', createdAt: '2026-09-09T10:00:00Z',
  paymentMethod: 'cash', subtotalCents: 2500, totalCents: 2500,
  amountCents: 2500, amountTenderedCents: 3000, changeGivenCents: 500,
  lookupCode: 'elite-pos:transaction-1001',
  items: [{
    name: 'Leather shoes', nameAr: 'حذاء جلد', variant: 'Beige / 42',
    color: 'Beige', colorAr: 'بيج', size: '42', quantity: 1,
    unitPriceCents: 2500, lineTotalCents: 2500,
  }],
};
const report = {
  zReportId: 'report-1001', createdAt: receipt.createdAt, openingFloatCents: 5000,
  grossSalesCents: 10000, cashSalesCents: 7500, cardSalesCents: 2500,
  refundTotalCents: 2500, voidTotalCents: 2500, netSalesCents: 5000,
  cashInCents: 0, cashOutCents: 0, expectedCashCents: 7500,
  physicalCashCents: 7500, varianceCents: 0, transactionCount: 4, refundCount: 1, voidCount: 1,
};

function createHardware() {
  const jobs: any[] = [];
  const renderer = new PosReceiptRenderer();
  // Exercise the supported text-header fallback without fetching a brand asset.
  Object.assign(renderer, { logoLoadFailed: true });
  const pos = { businessProfile: async () => null };
  const injector = Injector.create({ providers: [
    { provide: PosService, useValue: pos },
    { provide: PosLocalStore, useValue: {} },
    { provide: PosReceiptRenderer, useValue: renderer },
    { provide: ClientLoggerService, useValue: { log: () => {} } },
  ] });
  const hardware = runInInjectionContext(injector, () => new PosHardwareService());
  Object.assign(hardware, { settings: { printerName: 'BIXOLON test', drawerPulse: 'epson-pin-2' } });
  qz.websocket.isActive = () => true;
  qz.print = async (config: unknown, data: unknown) => { jobs.push({ config, data }); };
  return { hardware, renderer, pos, jobs, qz };
}

/** Run the real transaction methods with API/hardware boundaries controlled. */
function createComponent(kind: 'sale' | 'refund' | 'void' = 'sale') {
  const printCalls: any[] = [];
  const events: any[] = [];
  const counts = { sales: 0, refunds: 0, voids: 0 };
  const savedReceipt = { ...receipt, kind };
  const transaction = {
    transactionId: 'transaction-1001', paymentMethod: 'cash',
    items: [{ id: 'item-1' }], receipt: { receiptData: receipt },
  };
  const block = { start: 1001, next: 1001, end: 1100 };
  const component = Object.assign(Object.create(PosComponent.prototype), {
    busy: signal(false), online: signal(true), shiftId: () => 'shift-1',
    cart: signal([{ item: { variantId: 'variant-1', priceCents: 2500 }, quantity: 1 }]),
    paymentMethod: () => 'cash', tendered: '30.00', terminalReference: '',
    totalCents: () => 2500, canSellFromOfflineCatalog: () => true,
    ensureReceiptBlock: async () => {}, receiptBlock: signal(block),
    pendingIdempotencyKey: null, selectedCustomer: signal(null),
    selectedLineId: signal(null), paymentOpen: signal(true), lastSale: signal(null),
    localReceiptData: () => savedReceipt, applyStockUpdates: () => {},
    operationTransaction: signal(transaction), managerPinConfigured: () => false,
    managerPin: '', correctionReason: 'Customer return', refundTerminalReference: '',
    refundQuantities: { 'item-1': 1 }, refundRestock: {},
    local: { commitReceipt: async () => {}, getReceiptBlock: async () => block },
    pos: {
      createSale: async () => {
        counts.sales++;
        return { transactionId: transaction.transactionId, status: 'completed', receipt: { receiptData: savedReceipt }, stockUpdates: [] };
      },
      verifyManagerPin: async () => ({ overrideId: 'override-1', token: 'test-token' }),
      refund: async () => {
        counts.refunds++;
        return { method: 'cash', receipt: { receiptData: savedReceipt }, stockUpdates: [] };
      },
      voidTransaction: async () => {
        counts.voids++;
        return { voidedAt: receipt.createdAt, amountCents: 2500, reason: 'Customer return', stockRestored: [] };
      },
      findTransaction: async () => transaction,
    },
    hardware: {
      printReceipt: async (data: unknown, openDrawer: boolean) => {
        printCalls.push({ data, openDrawer, busy: component.busy() });
      },
      printerName: () => 'BIXOLON test',
    },
    toast: {
      success: (title: string) => events.push({ kind: 'success', title }),
      warning: (title: string, sub: string) => events.push({ kind: 'warning', title, sub }),
      error: (title: string, sub: string) => events.push({ kind: 'error', title, sub }),
      push: (event: unknown) => events.push(event),
    },
    clientLogger: { logError: (_source: string, _error: unknown, detail: unknown) => events.push({ kind: 'log', detail }) },
  });
  return { component, printCalls, events, counts };
}

Object.assign(window, { posPrinting: { createHardware, createComponent, receipt, report } });
