import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { fulfillmentPillKind, paymentPillKind } from '../../shared/pill/status-pill';
import { I18nService } from '../../services/i18n.service';
import { Order, QAR } from '../../models';

interface TimelineItem { label: string; ts: string; state: 'done' | 'future'; }

@Component({
  selector: 'ap-order-modal',
  standalone: true,
  imports: [CommonModule, IconComponent, PillComponent],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="card-title">{{ order.id }}</div>
          <div class="card-sub">{{ order.date }} · {{ order.customer }}</div>
        </div>
        <button class="x-btn" (click)="closed.emit()"><ap-icon name="x" [size]="14"/></button>
      </div>
      <div class="modal-body">
        <div class="row gap-lg mb-24" style="align-items:flex-start;">
          <div class="grow">
            <div class="lbl">Line Items</div>
            <div class="panel" style="margin-top:6px;">
              @for (it of order.items; track $index; let last = $last) {
                <div [style.padding]="'14px 18px'"
                     [style.border-bottom]="last ? 'none' : '1px solid var(--border-2)'"
                     style="display:flex;gap:12px;align-items:center;">
                  <div class="prod-img" style="width:48px;height:48px;border-radius:8px;flex-shrink:0;">
                    <div style="width:100%;height:100%;background:linear-gradient(135deg,#e8eaf2,#dde1ee);"></div>
                  </div>
                  <div class="grow">
                    <div class="strong">{{ it.n }}</div>
                    <div class="muted small">EU {{ it.s }} · Qty {{ it.q }}</div>
                  </div>
                  <div class="strong">{{ QAR(it.p * it.q) }}</div>
                </div>
              }
              <div style="padding:14px 18px;display:flex;justify-content:space-between;">
                <span class="strong">Total</span>
                <span class="strong" style="font-size:16px;color:var(--gold);font-family:var(--ff-disp);">{{ QAR(order.total) }}</span>
              </div>
            </div>
          </div>
          <div style="width:240px;flex-shrink:0;">
            <div class="lbl">Status</div>
            <div class="row gap-sm mb-16" style="flex-wrap:wrap;">
              <ap-pill [kind]="paymentKind.kind">{{ t(paymentKind.labelKey) }}</ap-pill>
              <ap-pill [kind]="fulfillmentKind.kind">{{ t(fulfillmentKind.labelKey) }}</ap-pill>
            </div>
            <div class="lbl">Customer</div>
            <div class="strong mb-8">{{ order.customer }}</div>
            <div class="muted small mb-16">Loyalty: <ap-pill kind="gold">VIP</ap-pill></div>
            <div class="lbl">Shipping Address</div>
            <div class="small" style="line-height:1.7;">{{ order.address }}</div>
          </div>
        </div>

        <div class="lbl">Timeline</div>
        <div class="panel" style="padding:14px 22px;margin-top:6px;">
          @for (t of timeline; track t.label) {
            <div class="tl-item">
              <div class="tl-dot" [class.done]="t.state === 'done'" [class.future]="t.state === 'future'"></div>
              <div class="tl-text">
                <div class="tl-title">{{ t.label }}</div>
                <div class="tl-meta">{{ t.ts }}</div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class OrderModalComponent {
  @Input({ required: true }) order!: Order;
  @Output() closed = new EventEmitter<void>();

  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly QAR = QAR;

  get paymentKind() { return paymentPillKind(this.order.payment); }
  get fulfillmentKind() { return fulfillmentPillKind(this.order.fulfillment); }

  get timeline(): TimelineItem[] {
    const o = this.order;
    return [
      { label: 'Order placed',      ts: o.date + ' 09:14', state: 'done' },
      { label: 'Payment confirmed', ts: o.date + ' 09:15', state: o.payment === 'paid' || o.payment === 'refunded' ? 'done' : 'future' },
      { label: 'Processing',        ts: o.date + ' 11:42', state: ['processing', 'shipped', 'delivered', 'returned'].includes(o.fulfillment) ? 'done' : 'future' },
      { label: 'Shipped',           ts: '2026-04-27 16:08', state: ['shipped', 'delivered', 'returned'].includes(o.fulfillment) ? 'done' : 'future' },
      { label: 'Delivered',         ts: o.fulfillment === 'delivered' ? '2026-04-29 10:22' : 'Pending', state: o.fulfillment === 'delivered' ? 'done' : 'future' },
    ];
  }
}
