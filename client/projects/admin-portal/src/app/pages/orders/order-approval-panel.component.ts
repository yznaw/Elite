import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { AdminOrdersService, AllocationOption, OrderAllocation } from '../../services/admin-orders.service';
import { ConfirmService } from '../../services/confirm.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { Order } from '../../models';

/**
 * Stock per location: a paid website order waits here until staff choose
 * the ONE location it ships from. Each location card says whether it has
 * every item; if not, what is missing and where that item is, with a link to
 * move it. Approving deducts that location, books the courier and emails the
 * customer (who never sees which location).
 */
@Component({
  selector: 'ap-order-approval-panel',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (order.needsApproval) {
      <section class="ap-approval" aria-labelledby="ap-approval-title">
        <div class="ap-approval-head">
          <ap-icon name="warning" [size]="14"/>
          <div>
            <div id="ap-approval-title" class="ap-approval-title">{{ t('orders.approval.title') }}</div>
            <div class="muted small">{{ t('orders.approval.sub') }}</div>
          </div>
        </div>

        @if (loading()) {
          <div class="ap-skel" aria-hidden="true"><div></div><div></div></div>
        } @else if (allocation(); as a) {
          <div class="ap-options" role="radiogroup" [attr.aria-label]="t('orders.approval.pick')">
            @for (loc of a.locations; track loc.id) {
              <button type="button" class="ap-option" role="radio"
                      [attr.aria-checked]="selected() === loc.id"
                      [class.selected]="selected() === loc.id"
                      [class.short]="!loc.allAvailable"
                      [disabled]="!loc.allAvailable"
                      (click)="selected.set(loc.id)">
                <div class="ap-option-top">
                  <span class="ap-radio" aria-hidden="true"></span>
                  <strong>{{ loc.name }}</strong>
                  @if (loc.allAvailable) {
                    <span class="ap-ok"><ap-icon name="check" [size]="11"/> {{ t('orders.approval.allHere').replace('{n}', '' + unitCount(a)) }}</span>
                  } @else {
                    <span class="ap-missing-count">{{ t('orders.approval.missingCount').replace('{n}', '' + loc.missing.length) }}</span>
                  }
                </div>
                @if (!loc.allAvailable) {
                  <ul class="ap-missing">
                    @for (m of loc.missing; track m.variantId) {
                      <li>
                        {{ m.productName }} · {{ label(m) }}: {{ t('orders.approval.hasOf').replace('{have}', '' + m.available).replace('{need}', '' + m.quantity) }}
                        @if (m.elsewhere.length) {
                          <span class="muted">({{ elsewhere(m) }})</span>
                        }
                      </li>
                    }
                  </ul>
                }
              </button>
            }
          </div>
          @if (!anyComplete(a)) {
            <div class="ap-hint">
              {{ t('orders.approval.noneComplete') }}
              <a routerLink="/inventory" [queryParams]="{ tab: 'transfer' }">{{ t('orders.approval.moveStock') }}</a>
            </div>
          }
          <div class="ap-actions">
            <button type="button" class="btn btn-primary" (click)="approve(a)" [disabled]="!selected() || busy()">
              {{ busy() ? t('common.saving') : t('orders.approval.approve') }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="load()" [disabled]="loading()">{{ t('orders.approval.refresh') }}</button>
          </div>
        }
      </section>
    } @else if (order.pickupLocation) {
      <div class="ap-approved"><ap-icon name="check" [size]="12"/> {{ t('orders.approval.approvedFrom').replace('{name}', order.pickupLocation) }}</div>
    }
  `,
  styles: [`
    .ap-approval { border: 1px solid var(--gold-4); background: var(--gold-3); border-radius: 12px; padding: 14px; margin-bottom: 16px; display: grid; gap: 12px; }
    .ap-approval-head { display: flex; gap: 10px; align-items: flex-start; color: var(--ink); }
    .ap-approval-title { font-weight: 700; font-size: 14px; }
    .ap-options { display: grid; gap: 8px; }
    .ap-option {
      display: grid; gap: 6px; text-align: start; width: 100%;
      padding: 12px; border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); font: inherit; cursor: pointer;
    }
    .ap-option:hover:not(:disabled) { border-color: var(--gold); }
    .ap-option.selected { border-color: var(--green); box-shadow: 0 0 0 1px var(--green); }
    .ap-option:disabled { cursor: default; background: var(--bg); }
    .ap-option:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .ap-option-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ap-radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--muted-2); flex-shrink: 0; }
    .ap-option.selected .ap-radio { border-color: var(--green); background: radial-gradient(var(--green) 45%, transparent 50%); }
    .ap-option.short .ap-radio { opacity: .35; }
    .ap-ok { margin-inline-start: auto; display: inline-flex; align-items: center; gap: 4px; color: var(--success); font-size: 12px; font-weight: 600; }
    .ap-missing-count { margin-inline-start: auto; color: #b45309; font-size: 12px; font-weight: 600; }
    .ap-missing { margin: 0; padding-inline-start: 26px; font-size: 12px; color: var(--ink-2); display: grid; gap: 2px; }
    .ap-hint { font-size: 12px; color: var(--ink-2); }
    .ap-hint a { color: var(--green); font-weight: 600; }
    .ap-actions { display: flex; align-items: center; gap: 8px; }
    .ap-actions .btn { white-space: nowrap; }
    .ap-approved { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; padding: 6px 12px; border-radius: 999px; background: var(--success-bg); color: var(--success); font-size: 12px; font-weight: 600; }
    .ap-skel { display: grid; gap: 8px; }
    .ap-skel div { height: 48px; border-radius: 10px; background: var(--surface); opacity: .7; }
  `],
})
export class OrderApprovalPanelComponent implements OnChanges {
  private readonly api = inject(AdminOrdersService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) order!: Order;
  @Output() readonly approved = new EventEmitter<Order>();

  readonly t = (k: string): string => this.i18n.t(k);
  readonly allocation = signal<OrderAllocation | null>(null);
  readonly selected = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  private loadedFor = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['order'] && this.order?.needsApproval && this.loadedFor !== this.order.id) void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const allocation = await this.api.allocation(this.order.id);
      this.loadedFor = this.order.id;
      this.allocation.set(allocation);
      // Pre-select the only location that can ship everything, if exactly one can.
      const complete = allocation.locations.filter((l) => l.allAvailable);
      if (!complete.some((l) => l.id === this.selected())) this.selected.set(complete.length === 1 ? complete[0].id : null);
    } catch (err) {
      this.toast.errorFrom(err, this.t('orders.approval.loadError'));
    } finally {
      this.loading.set(false);
    }
  }

  unitCount(a: OrderAllocation): number { return a.lines.reduce((sum, l) => sum + l.quantity, 0); }
  anyComplete(a: OrderAllocation): boolean { return a.locations.some((l) => l.allAvailable); }
  label(m: { color: string | null; size: string | null }): string { return [m.color, m.size].filter(Boolean).join(' · '); }
  elsewhere(m: AllocationOption['missing'][number]): string { return m.elsewhere.map((e) => `${e.name}: ${e.quantity}`).join(', '); }

  async approve(a: OrderAllocation): Promise<void> {
    const location = a.locations.find((l) => l.id === this.selected());
    if (!location) return;
    const ok = await this.confirm.ask({
      title: this.t('orders.approval.confirmTitle'),
      message: this.t('orders.approval.confirmBody').replace('{name}', location.name),
      confirmLabel: this.t('orders.approval.approve'),
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const updated = await this.api.approve(this.order.id, location.id);
      this.toast.success(this.t('orders.approval.done'), location.name);
      this.approved.emit(updated);
    } catch (err) {
      this.toast.errorFrom(err, this.t('orders.approval.failed'));
      // Stock may have moved since the panel loaded; show the current picture.
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
