import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { fulfillmentPillKind, paymentPillKind } from '../../shared/pill/status-pill';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { AdminOrdersService, OrderStatusPayload } from '../../services/admin-orders.service';
import { Order, OrderFulfillment, OrderTimelineEntry, QAR } from '../../models';

const TIMELINE_LABEL: Record<OrderTimelineEntry['kind'], string> = {
  placed:     'orderModal.tl.placed',
  paid:       'orderModal.tl.paid',
  processing: 'orderModal.tl.processing',
  shipped:    'orderModal.tl.shipped',
  delivered:  'orderModal.tl.delivered',
  cancelled:  'orderModal.tl.cancelled',
  refunded:   'orderModal.tl.refunded',
  returned:   'orderModal.tl.returned',
  note:       'orderModal.tl.note',
};

@Component({
  selector: 'ap-order-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="drawer drawer-wide order-drawer">
      <div class="drawer-head">
        <div style="min-width:0;flex:1;">
          @if (backLabel) {
            <button class="back-btn" (click)="back.emit()">
              <ap-icon name="arrow" [size]="12" style="transform:scaleX(-1);display:inline-flex;"/>
              {{ backLabel }}
            </button>
          }
          <div class="row gap-sm" style="flex-wrap:wrap;align-items:center;">
            <div class="card-title mono" style="color:var(--green);">{{ order().id }}</div>
            <ap-pill [kind]="paymentKind().kind">{{ t(paymentKind().labelKey) }}</ap-pill>
            <ap-pill [kind]="fulfillmentKind().kind">{{ t(fulfillmentKind().labelKey) }}</ap-pill>
          </div>
          <div class="card-sub">{{ order().date }} · {{ order().customer }}</div>
        </div>
        <div class="head-actions">
          <button class="head-icon-btn" (click)="printInvoice()" [title]="t('orderDrawer.printInvoice')">
            <ap-icon name="print" [size]="14"/>
          </button>
          <span class="head-divider" aria-hidden="true"></span>
          <button class="head-icon-btn" (click)="closed.emit()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
        </div>
      </div>

      <div class="drawer-body">
        <!-- Status workflow -->
        <div class="section-title">
          <ap-icon name="orders" [size]="14"/>
          <span>{{ t('orderDrawer.workflow.title') }}</span>
        </div>
        <div class="muted small mb-16">{{ t('orderDrawer.workflow.sub') }}</div>

        <div class="workflow-stepper mb-16">
          @for (step of stepperSteps; track step.key) {
            <div class="step" [class.done]="isReached(step.key)" [class.current]="order().fulfillment === step.key">
              <div class="step-dot"></div>
              <div class="step-label">{{ t(step.labelKey) }}</div>
            </div>
          }
        </div>

        @if (isStalePayment()) {
          <div class="stale-payment-callout mb-16">
            <ap-icon name="warning" [size]="14"/>
            <div>
              <strong>{{ t('orderDrawer.stalePayment.title') }}</strong>
              {{ t('orderDrawer.stalePayment.sub') }}
            </div>
          </div>
        }

        @if (order().nboxBookingFailed) {
          <div class="nbox-failure-callout mb-16">
            <ap-icon name="warning" [size]="14" style="flex-shrink:0;margin-top:1px;"/>
            <div style="flex:1;min-width:0;">
              <strong>Delivery booking failed</strong>
              @if (order().nboxBookingError) {
                <div class="small" style="margin-top:2px;opacity:0.8;">{{ order().nboxBookingError }}</div>
              }
            </div>
            <button class="btn btn-sm btn-outline" [disabled]="busy()" (click)="rebookDelivery()" style="flex-shrink:0;">
              @if (busy()) { <ap-spinner [size]="12"/> } Retry booking
            </button>
          </div>
        }

        <div class="row gap-sm mb-16" style="flex-wrap:wrap;">
          @if (canTransitionTo('processing')) {
            <button class="btn btn-outline btn-sm" [disabled]="busy()" (click)="transition('processing')">
              <ap-icon name="check" [size]="12"/> {{ t('orderDrawer.workflow.markProcessing') }}
            </button>
          }
          @if (canTransitionTo('shipped')) {
            <button class="btn btn-gold btn-sm" [disabled]="busy()" (click)="transition('shipped')">
              <ap-icon name="upload" [size]="12"/> {{ t('orderDrawer.workflow.markShipped') }}
            </button>
          }
          @if (canTransitionTo('delivered')) {
            <button class="btn btn-primary btn-sm" [disabled]="busy()" (click)="transition('delivered')">
              <ap-icon name="check" [size]="12"/> {{ t('orderDrawer.workflow.markDelivered') }}
            </button>
          }
          @if (order().payment === 'pending') {
            <button class="btn btn-outline btn-sm" [disabled]="busy()" (click)="confirmPayment()">
              <ap-icon name="check" [size]="12"/> {{ t('orderDrawer.workflow.markPaid') }}
            </button>
          }
          @if (canCancel()) {
            <button class="btn btn-danger btn-sm" [disabled]="busy()" (click)="cancelOrder()">
              <ap-icon name="x" [size]="12"/> {{ t('orderDrawer.workflow.cancel') }}
            </button>
          }
          @if (canRefund()) {
            <button class="btn btn-outline btn-sm" [disabled]="busy()" (click)="refundOrder()">
              <ap-icon name="arrow" [size]="12"/> {{ t('orderDrawer.workflow.refund') }}
            </button>
          }
        </div>

        <!-- Tracking -->
        <div class="tracking-block mb-24">
          <label class="lbl">{{ t('orderDrawer.tracking.label') }}</label>
          <div class="row gap-sm" style="flex-wrap:wrap;">
            <input class="inp mono" style="flex:1;min-width:220px;"
                   [placeholder]="t('orderDrawer.tracking.placeholder')"
                   [ngModel]="trackingDraft()" (ngModelChange)="trackingDraft.set($event)"/>
            <button class="btn btn-outline btn-sm" (click)="saveTracking()" [disabled]="trackingDraft() === (order().trackingNumber || '')">
              {{ t('orderDrawer.tracking.save') }}
            </button>
          </div>
          <div class="muted small mt-8">{{ t('orderDrawer.tracking.help') }}</div>
        </div>

        <!-- Line items + summary -->
        <div class="section-title">
          <ap-icon name="orders" [size]="14"/>
          <span>{{ t('orderModal.lineItems') }}</span>
        </div>

        <div class="panel mb-24">
          @for (it of order().items; track $index; let last = $last) {
            <div [style.padding]="'14px 18px'"
                 [style.border-bottom]="last ? 'none' : '1px solid var(--border-2)'"
                 style="display:flex;gap:12px;align-items:center;">
              <div class="prod-img" style="width:48px;height:48px;border-radius:8px;flex-shrink:0;overflow:hidden;">
                @if (it.img) {
                  <img [src]="it.img" [alt]="it.n" style="width:100%;height:100%;object-fit:cover;" loading="lazy"/>
                } @else {
                  <div style="width:100%;height:100%;background:linear-gradient(135deg,#e8eaf2,#dde1ee);"></div>
                }
              </div>
              <div class="grow">
                <div class="strong">{{ it.n }}</div>
                <div class="muted small">EU {{ it.s }} · {{ t('orderModal.qty') }} {{ it.q }}</div>
              </div>
              <div class="strong">{{ QAR(it.p * it.q) }}</div>
            </div>
          }
          <div style="padding:14px 18px;display:flex;justify-content:space-between;background:var(--bg);">
            <span class="strong">{{ t('orderModal.total') }}</span>
            <span class="strong" style="font-size:16px;color:var(--gold);font-family:var(--ff-disp);">{{ QAR(order().total) }}</span>
          </div>
        </div>

        <!-- Customer + address -->
        <div class="section-title">
          <ap-icon name="users" [size]="14"/>
          <span>{{ t('orderModal.customer') }}</span>
          @if ((order().customerEmail || order().customer) && !backLabel) {
            <button class="view-customer-btn" (click)="viewCustomerProfile()">
              <ap-icon name="users" [size]="11"/> {{ t('orderDrawer.viewProfile') }}
            </button>
          }
        </div>
        <div class="grid-2 mb-24">
          <div>
            <div class="strong mb-8">{{ order().customer }}</div>
            @if (order().customerEmail) {
              <div class="muted small" style="line-height:1.7;">{{ order().customerEmail }}</div>
            }
            @if (order().customerPhone) {
              <div class="muted small" style="line-height:1.7;">{{ order().customerPhone }}</div>
            }
            @if (order().paymentGateway) {
              <div class="muted small mt-8">
                {{ t('orderDrawer.paymentGateway') }}:
                <span class="mono">{{ order().paymentGateway?.provider }}</span>
                · {{ order().paymentGateway?.status }}
              </div>
            }
          </div>
          <div>
            <div class="lbl">{{ t('orderModal.shippingAddress') }}</div>
            <div class="small" style="line-height:1.7;">{{ order().address }}</div>
          </div>
        </div>

        <!-- Internal notes -->
        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('orderDrawer.notes.title') }}</span>
        </div>
        <div class="muted small mb-16">{{ t('orderDrawer.notes.sub') }}</div>

        <div class="notes-list mb-16">
          @if ((order().notes ?? []).length === 0) {
            <div class="muted small notes-empty">{{ t('orderDrawer.notes.empty') }}</div>
          } @else {
            @for (n of order().notes ?? []; track n.id) {
              <div class="note">
                <div class="avatar" style="width:30px;height:30px;font-size:11px;">{{ n.initials }}</div>
                <div class="note-body">
                  <div class="row gap-sm" style="align-items:baseline;">
                    <span class="strong small">{{ n.author }}</span>
                    <span class="muted small">{{ n.ts }}</span>
                  </div>
                  <div class="small" style="white-space:pre-wrap;">{{ n.body }}</div>
                </div>
              </div>
            }
          }
        </div>

        <div class="note-composer">
          <textarea class="inp" rows="2"
                    [placeholder]="t('orderDrawer.notes.placeholder')"
                    [ngModel]="noteDraft()" (ngModelChange)="noteDraft.set($event)"></textarea>
          <button class="btn btn-primary btn-sm" [disabled]="!noteDraft().trim()" (click)="addNote()">
            <ap-icon name="plus" [size]="12"/> {{ t('orderDrawer.notes.add') }}
          </button>
        </div>

        <!-- Timeline -->
        <div class="section-title">
          <ap-icon name="clock" [size]="14"/>
          <span>{{ t('orderModal.timeline') }}</span>
        </div>
        <div class="panel" style="padding:14px 22px;">
          @for (entry of timeline(); track entry.id) {
            <div class="tl-item">
              <div class="tl-dot done"></div>
              <div class="tl-text">
                <div class="tl-title">{{ t(timelineLabel(entry.kind)) }}</div>
                <div class="tl-meta">
                  {{ entry.ts }}
                  @if (entry.actor) { · <span class="muted">{{ entry.actor }}</span> }
                  @if (entry.detail) { · <span class="mono">{{ entry.detail }}</span> }
                </div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .drawer-wide { width: min(640px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

    /* Back breadcrumb button */
    .back-btn {
      display: inline-flex; align-items: center; gap: 5px;
      background: none; border: none; padding: 0 0 8px; cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600;
      color: var(--muted); transition: color 0.12s;
    }
    .back-btn:hover { color: var(--green); }

    .head-actions {
      display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
    }
    .head-divider { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
    .head-icon-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.12s;
    }
    .head-icon-btn:hover {
      background: var(--bg);
      border-color: var(--border);
      color: var(--green);
    }

    .section-title {
      display: flex; align-items: center; gap: 8px;
      padding: 16px 0 8px;
      margin-top: 4px;
      border-top: 1px solid var(--border-2);
      color: var(--green);
      font-family: var(--ff-disp);
      font-size: 16px;
      font-weight: 500;
    }
    .section-title:first-of-type { border-top: none; padding-top: 0; }
    .section-title ap-icon { color: var(--gold); flex-shrink: 0; }

    /* Workflow stepper */
    .workflow-stepper {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      position: relative;
    }
    .workflow-stepper .step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      position: relative;
      padding: 0 4px;
    }
    .workflow-stepper .step::before {
      content: '';
      position: absolute;
      top: 9px;
      inset-inline-start: -50%;
      width: 100%;
      height: 2px;
      background: var(--border-2);
      z-index: 0;
    }
    .workflow-stepper .step:first-child::before { display: none; }
    .workflow-stepper .step.done::before { background: var(--green); }
    .step-dot {
      position: relative;
      z-index: 1;
      width: 18px; height: 18px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid var(--border);
    }
    .step.done .step-dot { background: var(--green); border-color: var(--green); }
    .step.current .step-dot {
      background: #fff;
      border-color: var(--gold);
      box-shadow: 0 0 0 4px rgba(193, 154, 91, 0.18);
    }
    .step-label {
      font-size: 11px;
      color: var(--ink-2);
      text-align: center;
      line-height: 1.3;
    }
    .step.done .step-label { color: var(--ink); }
    .step.current .step-label { color: var(--gold); font-weight: 600; }

    /* Stale-payment callout */
    .stale-payment-callout {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      background: #fffbeb; border: 1px solid #fde68a;
      color: #92400e; font-size: 13px; line-height: 1.5;
    }
    .stale-payment-callout ap-icon { flex-shrink: 0; margin-top: 1px; color: #d97706; }

    /* NBOX delivery booking failure callout */
    .nbox-failure-callout {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      background: #fef2f2; border: 1px solid #fecaca;
      color: #991b1b; font-size: 13px; line-height: 1.5;
    }
    .nbox-failure-callout ap-icon { color: #dc2626; }

    /* View customer profile button */
    .view-customer-btn {
      margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg); color: var(--muted); font: inherit; font-size: 11px;
      font-weight: 600; cursor: pointer; transition: all 0.12s;
    }
    .view-customer-btn:hover { color: var(--green); border-color: var(--green-4); background: var(--surface); }

    .tracking-block {
      padding: 14px 16px;
      border: 1px solid var(--border-2);
      border-radius: 10px;
      background: var(--bg);
    }

    /* Notes */
    .notes-empty {
      padding: 14px 16px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      text-align: center;
      background: var(--bg);
    }
    .notes-list { display: flex; flex-direction: column; gap: 10px; }
    .note {
      display: flex;
      gap: 10px;
      padding: 12px 14px;
      background: var(--bg);
      border: 1px solid var(--border-2);
      border-radius: 10px;
    }
    .note-body { flex: 1; min-width: 0; }
    .note-composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
      margin-bottom: 24px;
    }
    .note-composer .btn { align-self: flex-end; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 560px) {
      .grid-2 { grid-template-columns: 1fr; }
      .workflow-stepper { grid-template-columns: repeat(2, 1fr); row-gap: 18px; }
      .workflow-stepper .step:nth-child(3)::before,
      .workflow-stepper .step:nth-child(odd)::before { display: none; }
    }
  `],
})
export class OrderDrawerComponent {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly ordersApi = inject(AdminOrdersService);
  private readonly router = inject(Router);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly QAR = QAR;

  /** Internal mutable order (so workflow / notes / tracking edits stay live). */
  private readonly _order = signal<Order>(this.emptyOrder());
  readonly order = this._order.asReadonly();

  @Input({ required: true }) set value(o: Order) {
    this._order.set(this.hydrate(o));
  }

  /** When set, shows a back-breadcrumb button in the header. */
  @Input() backLabel?: string;

  @Output() closed = new EventEmitter<void>();
  @Output() updated = new EventEmitter<Order>();
  /** Emitted when the user clicks the back breadcrumb. */
  @Output() back = new EventEmitter<void>();

  readonly busy = signal(false);

  /** True when payment is still pending and the order was placed >30 minutes ago. */
  readonly isStalePayment = computed(() => {
    const o = this._order();
    if (o.payment !== 'pending') return false;
    const placed = new Date(o.date).getTime();
    return Date.now() - placed > 30 * 60 * 1000;
  });

  viewCustomerProfile(): void {
    this.closed.emit();
    void this.router.navigate(['/customers'], {
      queryParams: { highlight: this._order().customerEmail || this._order().customer },
    });
  }
  readonly noteDraft = signal('');
  readonly trackingDraft = signal('');

  readonly stepperSteps: { key: OrderFulfillment; labelKey: string }[] = [
    { key: 'awaiting',   labelKey: 'pill.awaiting' },
    { key: 'processing', labelKey: 'pill.processing' },
    { key: 'shipped',    labelKey: 'pill.shipped' },
    { key: 'delivered',  labelKey: 'pill.delivered' },
  ];

  readonly paymentKind = computed(() => paymentPillKind(this._order().payment));
  readonly fulfillmentKind = computed(() => fulfillmentPillKind(this._order().fulfillment));
  readonly timeline = computed(() => [...(this._order().timeline ?? [])].reverse());

  private hydrate(o: Order): Order {
    const next: Order = { ...o };
    if (!next.timeline || next.timeline.length === 0) {
      next.timeline = this.seedTimeline(o);
    }
    if (!next.notes) next.notes = [];
    this.trackingDraft.set(next.trackingNumber ?? '');
    this.noteDraft.set('');
    return next;
  }

  private emptyOrder(): Order {
    return {
      id: '', date: '', customer: '', itemsCount: 0, total: 0,
      payment: 'pending', fulfillment: 'awaiting',
      items: [], address: '', timeline: [], notes: [],
    };
  }

  /** Build a plausible historical timeline from the order's current state. */
  private seedTimeline(o: Order): OrderTimelineEntry[] {
    const tl: OrderTimelineEntry[] = [
      { id: 'tl-placed', ts: `${o.date} 09:14`, kind: 'placed', actor: this.t('orderModal.tl.system') },
    ];
    if (o.payment === 'paid' || o.payment === 'refunded') {
      tl.push({ id: 'tl-paid', ts: `${o.date} 09:15`, kind: 'paid' });
    }
    const advanced: OrderFulfillment[] = ['processing', 'shipped', 'delivered', 'returned'];
    if (advanced.includes(o.fulfillment)) {
      tl.push({ id: 'tl-processing', ts: `${o.date} 11:42`, kind: 'processing' });
    }
    if (['shipped', 'delivered', 'returned'].includes(o.fulfillment)) {
      tl.push({ id: 'tl-shipped', ts: '2026-04-27 16:08', kind: 'shipped', detail: o.trackingNumber });
    }
    if (o.fulfillment === 'delivered') {
      tl.push({ id: 'tl-delivered', ts: '2026-04-29 10:22', kind: 'delivered' });
    }
    if (o.fulfillment === 'cancelled') {
      tl.push({ id: 'tl-cancelled', ts: `${o.date} 14:00`, kind: 'cancelled' });
    }
    if (o.payment === 'refunded') {
      tl.push({ id: 'tl-refunded', ts: `${o.date} 15:00`, kind: 'refunded' });
    }
    return tl;
  }

  // ────────────────────────────────────────────────────────────────────
  // Safe status update — re-fetches on error to resync local state
  // ────────────────────────────────────────────────────────────────────

  private async safeUpdateStatus(payload: OrderStatusPayload): Promise<Order | null> {
    const o = this._order();
    try {
      const updated = await this.ordersApi.updateStatus(o.id, payload);
      this._order.set(updated);
      this.updated.emit(updated);
      return updated;
    } catch (err) {
      // Re-fetch so the drawer shows the real server state, not stale optimistic state.
      try {
        const current = await this.ordersApi.get(o.id);
        this._order.set(current);
        this.updated.emit(current);
      } catch {
        // If re-fetch also fails, leave local state as-is; interceptor already toasted.
      }
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Workflow
  // ────────────────────────────────────────────────────────────────────

  isReached(step: OrderFulfillment): boolean {
    const order = this.stepOrder();
    const cur = order.indexOf(this._order().fulfillment);
    const idx = order.indexOf(step);
    return cur >= 0 && idx >= 0 && idx <= cur;
  }

  private stepOrder(): OrderFulfillment[] {
    return ['awaiting', 'processing', 'shipped', 'delivered'];
  }

  canTransitionTo(target: OrderFulfillment): boolean {
    const cur = this._order().fulfillment;
    if (cur === 'cancelled' || cur === 'returned') return false;
    const order = this.stepOrder();
    const ci = order.indexOf(cur);
    const ti = order.indexOf(target);
    return ti === ci + 1;
  }

  canCancel(): boolean {
    const f = this._order().fulfillment;
    return f === 'awaiting' || f === 'processing';
  }

  canRefund(): boolean {
    const o = this._order();
    return o.payment === 'paid' && o.fulfillment !== 'cancelled';
  }

  async transition(target: OrderFulfillment): Promise<void> {
    if (this.busy()) return;
    if (target === 'shipped' && !this.trackingDraft().trim()) {
      this.toast.error(this.t('orderDrawer.tracking.required'));
      return;
    }
    this.busy.set(true);
    try {
      const o = this._order();
      const updated = await this.safeUpdateStatus({
        fulfillment: target,
        trackingNumber: target === 'shipped' ? this.trackingDraft().trim() : undefined,
        timelineKind: target as OrderTimelineEntry['kind'],
        detail: target === 'shipped' ? this.trackingDraft().trim() : `Marked ${target}`,
      });
      if (updated) {
        const toastKey = `orderDrawer.toast.${target}.title`;
        this.toast.success(this.t(toastKey), `${o.id} · ${o.customer}`);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async confirmPayment(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const o = this._order();
      const updated = await this.safeUpdateStatus({
        payment: 'paid',
        timelineKind: 'paid',
        detail: 'Payment confirmed',
      });
      if (updated) this.toast.success(this.t('orderDrawer.toast.paid.title'), o.id);
    } finally {
      this.busy.set(false);
    }
  }

  async cancelOrder(): Promise<void> {
    if (this.busy()) return;
    const ok = await this.confirm.ask({
      title: this.t('orderDrawer.confirm.cancel.title'),
      message: this.t('orderDrawer.confirm.cancel.message'),
      confirmLabel: this.t('orderDrawer.confirm.cancel.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const o = this._order();
      const updated = await this.safeUpdateStatus({
        status: 'cancelled',
        fulfillment: 'cancelled',
        timelineKind: 'cancelled',
        detail: 'Order cancelled',
      });
      if (updated) this.toast.info(this.t('orderDrawer.toast.cancelled.title'), o.id);
    } finally {
      this.busy.set(false);
    }
  }

  async refundOrder(): Promise<void> {
    if (this.busy()) return;
    const ok = await this.confirm.ask({
      title: this.t('orderDrawer.confirm.refund.title'),
      message: this.t('orderDrawer.confirm.refund.message'),
      confirmLabel: this.t('orderDrawer.confirm.refund.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const o = this._order();
      const updated = await this.safeUpdateStatus({
        payment: 'refunded',
        status: 'refunded',
        timelineKind: 'refunded',
        detail: QAR(o.total),
      });
      if (updated) this.toast.success(this.t('orderDrawer.toast.refunded.title'), `${o.id} · ${QAR(o.total)}`);
    } finally {
      this.busy.set(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Tracking + notes
  // ────────────────────────────────────────────────────────────────────

  async saveTracking(): Promise<void> {
    if (this.busy()) return;
    const tn = this.trackingDraft().trim();
    const o = this._order();
    if (tn === (o.trackingNumber ?? '')) return;
    this.busy.set(true);
    try {
      const updated = await this.safeUpdateStatus({
        trackingNumber: tn,
        timelineKind: 'note',
        detail: `${this.t('orderModal.tl.tracking')}: ${tn}`,
      });
      if (updated) this.toast.success(this.t('orderDrawer.toast.tracking.title'), tn);
    } finally {
      this.busy.set(false);
    }
  }

  async addNote(): Promise<void> {
    if (this.busy()) return;
    const body = this.noteDraft().trim();
    if (!body) return;
    const o = this._order();
    this.busy.set(true);
    try {
      await this.ordersApi.addNote(o.id, body);
      const updated = await this.ordersApi.get(o.id);
      this._order.set(updated);
      this.updated.emit(updated);
      this.noteDraft.set('');
      this.toast.success(this.t('orderDrawer.toast.note.title'));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.busy.set(false);
    }
  }

  async rebookDelivery(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const o = this._order();
      const updated = await this.ordersApi.rebookDelivery(o.id);
      this._order.set(updated);
      this.updated.emit(updated);
      this.toast.success('Delivery booking submitted', o.id);
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.busy.set(false);
    }
  }

  timelineLabel(kind: OrderTimelineEntry['kind']): string {
    return TIMELINE_LABEL[kind];
  }

  printInvoice(): void {
    const o = this.order();
    const itemRows = o.items.map(it =>
      `<tr>
        <td>${it.n}</td>
        <td style="text-align:center">EU ${it.s}</td>
        <td style="text-align:center">${it.q}</td>
        <td style="text-align:right">${QAR(it.p * it.q)}</td>
      </tr>`,
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.t('orders.invoice.label')} ${o.id}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a1a;padding:40px;max-width:700px;margin:0 auto;}
    .hd{display:flex;justify-content:space-between;margin-bottom:32px;align-items:flex-start;}
    .brand{font-size:22px;font-weight:800;letter-spacing:.08em;}
    .inv-meta{font-size:13px;color:#666;margin-top:4px;}
    .section{margin-bottom:24px;}
    .label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:6px;}
    table{width:100%;border-collapse:collapse;font-size:13px;}
    th{text-align:left;padding:8px 10px;border-bottom:2px solid #1a1a1a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
    td{padding:10px;border-bottom:1px solid #e5e5e5;vertical-align:top;}
    .total-row td{border-top:2px solid #1a1a1a;border-bottom:none;font-weight:700;font-size:15px;}
    .print-btn{margin-top:24px;padding:8px 18px;background:#1a1a1a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;}
    @media print{.print-btn{display:none;}}
  </style>
</head>
<body>
  <div class="hd">
    <div>
      <div class="brand">ELITE COLLECTION</div>
      <div class="inv-meta">${this.t('orders.invoice.label')} ${o.id}</div>
    </div>
    <div style="text-align:right;font-size:13px;color:#666;">
      <div>${o.date}</div>
      <div style="margin-top:4px;">${o.customer}</div>
      ${o.customerEmail ? `<div style="margin-top:2px;">${o.customerEmail}</div>` : ''}
      ${o.customerPhone ? `<div style="margin-top:2px;">${o.customerPhone}</div>` : ''}
    </div>
  </div>
  <div class="section">
    <div class="label">${this.t('orders.invoice.shippingAddress')}</div>
    <div style="font-size:13px;line-height:1.8;">${(o.address || '-').replace(/\n/g, '<br>')}</div>
  </div>
  <div class="section">
    <table>
      <thead><tr>
        <th>${this.t('orders.invoice.colProduct')}</th>
        <th style="text-align:center">${this.t('orders.invoice.colSize')}</th>
        <th style="text-align:center">${this.t('orders.invoice.colQty')}</th>
        <th style="text-align:right">${this.t('orders.invoice.colAmount')}</th>
      </tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr class="total-row">
          <td colspan="3">${this.t('orders.invoice.total')}</td>
          <td style="text-align:right">${QAR(o.total)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <button class="print-btn" onclick="window.print()">${this.t('orders.invoice.print')}</button>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

}
