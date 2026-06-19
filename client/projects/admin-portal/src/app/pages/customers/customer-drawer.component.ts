import {
  Component, EventEmitter, Input, OnDestroy, OnInit, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { ConfirmService } from '../../services/confirm.service';
import { AdminCustomersService } from '../../services/admin-customers.service';
import { Customer, Order, QAR } from '../../models';

interface FormShape {
  name: string;
  email: string;
  phone: string;
  city: string;
  sizePref: number;
  notes: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

@Component({
  selector: 'ap-customer-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, AvatarComponent, PillComponent, SpinnerComponent, SaveBarComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide customer-drawer" [class.is-dirty]="dirty()">

      <!-- Head -->
      <div class="drawer-head">
        <div class="row gap-sm" style="min-width:0;flex:1;">
          <ap-avatar [initials]="initials()" size="lg"/>
          <div style="min-width:0;flex:1;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {{ form().name || t('customers.add') }}
            </div>
            <div class="card-sub">
              <span>{{ form().email || '—' }}</span>
              @if (mode === 'edit') {
                <span class="muted"> · <span class="mono">{{ customer.id }}</span></span>
              }
            </div>
          </div>
        </div>
        <button class="head-icon-btn" (click)="handleClose()" [attr.aria-label]="t('common.close')">
          <ap-icon name="x" [size]="14"/>
        </button>
      </div>

      <!-- Unsaved-changes bar -->
      <ap-save-bar
        [dirty]="dirty()"
        [saving]="saveState() === 'saving'"
        [justSaved]="saveState() === 'saved'"
        [shake]="shakeSaveBar()"
        [label]="t('customerDrawer.unsaved')"
        (saved)="save()"
        (discarded)="discard()"/>

      <div class="drawer-body">

        <!-- KPI tiles (edit mode only) -->
        @if (mode === 'edit') {
          <div class="grid-3 mb-24">
            <div class="card-pad kpi-tile">
              <div class="muted small">{{ t('customerDrawer.totalOrders') }}</div>
              <div class="kpi-value" style="font-size:24px;margin-top:4px;">{{ customer.orders }}</div>
            </div>
            <div class="card-pad kpi-tile">
              <div class="muted small">{{ t('customerDrawer.ltv') }}</div>
              <div class="kpi-value" style="font-size:24px;margin-top:4px;color:var(--gold);">{{ QAR(customer.ltv) }}</div>
            </div>
            <div class="card-pad kpi-tile">
              <div class="muted small">{{ t('customerDrawer.memberSince') }}</div>
              <div class="kpi-value" style="font-size:18px;margin-top:4px;">{{ customer.joined }}</div>
            </div>
          </div>
        }

        <!-- Identity section -->
        <div class="section-title">
          <ap-icon name="users" [size]="14"/>
          <span>{{ t('customerDrawer.section.identity') }}</span>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('customerDrawer.field.name') }}</label>
          <input class="inp mb-16"
                 [placeholder]="t('customerDrawer.placeholder.name')"
                 [ngModel]="form().name" (ngModelChange)="set('name', $event)"/>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">{{ t('customerDrawer.field.email') }}</label>
              <input class="inp" type="email"
                     [placeholder]="t('customerDrawer.placeholder.email')"
                     [ngModel]="form().email" (ngModelChange)="set('email', $event)"/>
            </div>
            <div>
              <label class="lbl">Phone</label>
              <input class="inp" type="tel"
                     placeholder="+966 5x xxx xxxx"
                     [ngModel]="form().phone" (ngModelChange)="set('phone', $event)"/>
            </div>
          </div>

          <div class="grid-2 mb-16">
            <div>
              <label class="lbl">{{ t('customerDrawer.field.city') }}</label>
              <input class="inp"
                     [placeholder]="t('customerDrawer.placeholder.city')"
                     [ngModel]="form().city" (ngModelChange)="set('city', $event)"/>
            </div>
            <div>
              <label class="lbl">{{ t('customerDrawer.field.sizePref') }}</label>
              <input class="inp mono" type="number" min="30" max="50"
                     [ngModel]="form().sizePref" (ngModelChange)="setNum('sizePref', $event)"/>
            </div>
          </div>
        </div>

        <!-- Order history (edit mode only) -->
        @if (mode === 'edit') {
          <div class="section-title">
            <ap-icon name="orders" [size]="14"/>
            <span>{{ t('customerDrawer.section.history') }}</span>
            @if (ordersRefreshedAt()) {
              <span class="refresh-ts muted small">Updated {{ ordersRefreshedAt() }}</span>
            }
          </div>

          <div class="mb-24">
            @if (ordersLoading()) {
              <div class="panel">
                @for (i of [1,2,3]; track i) {
                  <div class="sk-order-row">
                    <div class="sk sk-id"></div>
                    <div class="sk sk-pill"></div>
                    <div class="sk sk-amount"></div>
                  </div>
                }
              </div>
            } @else if (ordersError()) {
              <div class="error-callout">
                <ap-icon name="x" [size]="13"/>
                <span>{{ ordersError() }}</span>
                <button class="btn btn-ghost btn-sm" (click)="loadOrders()">Retry</button>
              </div>
            } @else if (orders().length === 0) {
              <div class="muted small notes-empty">{{ t('customerDrawer.noOrders') }}</div>
            } @else {
              <div class="panel">
                @for (o of orders(); track o.id; let last = $last) {
                  <button class="order-row" [class.is-last]="last"
                          [class.order-row--pending]="o.payment === 'pending'"
                          (click)="openOrder.emit(o)"
                          [attr.aria-label]="t('customerDrawer.openOrder') + ' ' + o.id">
                    <div class="order-row-id">
                      <div class="row gap-sm" style="align-items:center;">
                        <div class="strong mono" style="color:var(--green);">{{ o.id }}</div>
                        @if (o.payment === 'pending') {
                          <span class="pending-badge">Pending Payment</span>
                        }
                      </div>
                      <div class="muted small">{{ o.date }} · {{ itemsCountLabel(o.itemsCount) }}</div>
                    </div>
                    <div class="row gap-sm">
                      <ap-pill [kind]="fulfillment(o.fulfillment).kind">{{ t(fulfillment(o.fulfillment).labelKey) }}</ap-pill>
                      <span class="strong mono">{{ QAR(o.total) }}</span>
                      <span class="order-row-arrow"><ap-icon name="arrow" [size]="14"/></span>
                    </div>
                  </button>
                }
              </div>
            }
          </div>

          <!-- Size intelligence -->
          <div class="section-title">
            <ap-icon name="check" [size]="14"/>
            <span>{{ t('customerDrawer.section.size') }}</span>
          </div>
          <div class="mb-24">
            <div class="panel card-pad">
              @for (s of sizeStats(); track s.size) {
                <div class="row gap-sm mb-8">
                  <div style="width:60px;" class="strong">EU {{ s.size }}</div>
                  <div class="grow" style="height:8px;background:var(--bg-2);border-radius:4px;overflow:hidden;">
                    <div [style.width.%]="(s.count / maxSize()) * 100"
                         style="height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-2));border-radius:4px;">
                    </div>
                  </div>
                  <div class="muted small" style="width:32px;text-align:right;">{{ s.count }}×</div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Notes -->
        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('customerDrawer.section.notes') }}</span>
        </div>
        <div class="mb-24">
          <textarea class="inp" rows="4"
                    [placeholder]="t('customerDrawer.field.notes.placeholder')"
                    [ngModel]="form().notes" (ngModelChange)="set('notes', $event)"></textarea>
        </div>

        <!-- Danger zone (edit mode only) -->
        @if (mode === 'edit') {
          <div class="danger-zone">
            <div class="danger-zone-title">{{ t('customerDrawer.section.danger.title') }}</div>
            <button class="btn btn-danger btn-sm" (click)="onDelete()" [disabled]="deleting()">
              @if (deleting()) { <ap-spinner [size]="12"/> }
              {{ t('customerDrawer.deleteConfirm.confirm') }}
            </button>
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    .drawer-wide { width: min(640px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

    .head-icon-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid transparent; border-radius: 8px;
      color: var(--ink-2); cursor: pointer; transition: all 0.12s;
    }
    .head-icon-btn:hover { background: var(--bg); border-color: var(--border); color: var(--green); }

    .customer-drawer.is-dirty .drawer-head { box-shadow: inset 4px 0 0 var(--gold); }
    html[dir='rtl'] .customer-drawer.is-dirty .drawer-head { box-shadow: inset -4px 0 0 var(--gold); }

    .section-title {
      display: flex; align-items: center; gap: 8px;
      padding: 16px 0 12px; margin-top: 4px;
      border-top: 1px solid var(--border-2);
      color: var(--green); font-family: var(--ff-disp); font-size: 16px; font-weight: 500;
    }
    .section-title:first-of-type { border-top: none; padding-top: 0; }
    .section-title ap-icon { color: var(--gold); flex-shrink: 0; }
    .refresh-ts { margin-left: auto; font-family: var(--ff-mono); font-size: 11px; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 560px) {
      .grid-2 { grid-template-columns: 1fr; }
      .grid-3 { grid-template-columns: 1fr; }
    }

    .kpi-tile { background: var(--bg); border-radius: 10px; }

    /* Order rows */
    .order-row {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      width: 100%; padding: 12px 16px;
      background: transparent; border: none; border-bottom: 1px solid var(--border-2);
      cursor: pointer; text-align: start; font: inherit; color: inherit;
      transition: background 0.12s;
    }
    .order-row.is-last { border-bottom: none; }
    .order-row:hover { background: var(--bg); }
    .order-row--pending { border-inline-start: 3px solid var(--warning); }
    .order-row-id { min-width: 0; flex: 1; }
    .order-row-arrow { color: var(--muted); transition: transform 0.15s, color 0.15s; }
    .order-row:hover .order-row-arrow { color: var(--gold); transform: translateX(2px); }
    html[dir='rtl'] .order-row:hover .order-row-arrow { transform: translateX(-2px) scaleX(-1); }
    html[dir='rtl'] .order-row-arrow { transform: scaleX(-1); }

    /* Pending payment badge */
    .pending-badge {
      font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 5px;
      background: var(--warning-bg, #fffbeb); color: var(--warning, #d97706);
      border: 1px solid var(--warning-border, #fde68a);
    }

    /* Error callout */
    .error-callout {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-radius: 10px;
      background: var(--danger-bg, #fef2f2); border: 1px solid var(--danger-border, #fecaca);
      color: var(--danger, #dc2626); font-size: 13px;
    }
    .error-callout .btn { margin-left: auto; }

    /* Skeleton loaders */
    @keyframes shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
    .sk {
      border-radius: 5px; height: 12px;
      background: linear-gradient(90deg, var(--border) 25%, var(--bg-2) 50%, var(--border) 75%);
      background-size: 800px 100%;
      animation: shimmer 1.4s infinite;
    }
    .sk-order-row {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; border-bottom: 1px solid var(--border-2);
    }
    .sk-order-row:last-child { border-bottom: none; }
    .sk-id   { width: 100px; }
    .sk-pill { width: 70px; margin-left: auto; }
    .sk-amount { width: 60px; }

    /* Notes empty state */
    .notes-empty {
      padding: 14px 16px;
      border: 1px dashed var(--border); border-radius: 10px;
      text-align: center; background: var(--bg);
    }

    /* Danger zone */
    .danger-zone {
      margin-top: 16px; padding: 16px;
      background: rgba(239,68,68,.04); border: 1px solid rgba(239,68,68,.2);
      border-radius: 10px; display: flex; align-items: center;
      justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }
    .danger-zone-title { font-family: var(--ff-disp); font-size: 14px; color: var(--danger, #ef4444); font-weight: 600; }

    /* Mobile: pin save bar outside scroll area */
    @media (max-width: 720px) {
      .drawer-body { padding-bottom: 84px; }
    }
  `],
})
export class CustomerDrawerComponent implements OnInit, OnDestroy {
  @Input({ required: true }) customer!: Customer;
  @Input() mode: 'edit' | 'create' = 'edit';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Customer>();
  @Output() deleted = new EventEmitter<Customer>();
  @Output() openOrder = new EventEmitter<Order>();

  private readonly toast    = inject(ToastService);
  private readonly i18n     = inject(I18nService);
  private readonly confirm  = inject(ConfirmService);
  private readonly customersApi = inject(AdminCustomersService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly QAR = QAR;
  readonly fulfillment = fulfillmentPillKind;

  // ── Form state ──
  private readonly initial = signal<FormShape>(this.makeEmptyForm());
  readonly form       = signal<FormShape>(this.makeEmptyForm());
  readonly saveState  = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);
  readonly deleting   = signal(false);

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial()));

  // ── Order history state ──
  readonly orders           = signal<Order[]>([]);
  readonly ordersLoading    = signal(false);
  readonly ordersError      = signal<string | null>(null);
  readonly ordersRefreshedAt = signal<string>('');
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Size stats (derived from LIVE orders, not mock) ──
  readonly sizeStats = computed(() => {
    const sizeMap: Record<number, number> = {};
    this.orders().forEach((o) =>
      o.items.forEach((it) => { sizeMap[it.s] = (sizeMap[it.s] || 0) + it.q; }),
    );
    const sizes = Object.keys(sizeMap).map((s) => ({ size: Number(s), count: sizeMap[Number(s)] }));
    if (sizes.length === 0 && this.form().sizePref) {
      sizes.push({ size: this.form().sizePref, count: 1 });
    }
    return sizes.sort((a, b) => b.count - a.count);
  });

  maxSize = (): number => Math.max(...this.sizeStats().map((s) => s.count), 1);

  ngOnInit(): void {
    this.initial.set(this.makeFormFromCustomer(this.customer));
    this.form.set({ ...this.initial() });

    if (this.mode === 'edit') {
      void this.loadOrders();
      // Silently refresh orders every 30s so a new storefront order appears without re-opening
      this.refreshTimer = setInterval(() => void this.loadOrders(true), 30_000);
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async loadOrders(silent = false): Promise<void> {
    if (!silent) this.ordersLoading.set(true);
    this.ordersError.set(null);
    try {
      const list = await this.customersApi.getOrders(this.customer.id);
      this.orders.set(list);
      const now = new Date();
      this.ordersRefreshedAt.set(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`);
    } catch {
      if (!silent) this.ordersError.set('Could not load order history.');
    } finally {
      if (!silent) this.ordersLoading.set(false);
    }
  }

  // ── Form helpers ──
  set<K extends keyof FormShape>(k: K, v: FormShape[K]): void {
    this.form.update((f) => ({ ...f, [k]: v }));
    if (this.dirty() && this.saveState() === 'idle') this.saveState.set('dirty');
  }

  setNum(k: 'sizePref', v: string | number): void {
    this.set(k, typeof v === 'number' ? v : (parseInt(v, 10) || 0));
  }

  private makeEmptyForm(): FormShape {
    return { name: '', email: '', phone: '', city: '', sizePref: 42, notes: '' };
  }

  private makeFormFromCustomer(c: Customer): FormShape {
    return {
      name: c.name,
      email: c.email,
      phone: (c as any).phone || '',
      city: c.city,
      sizePref: c.sizePref,
      notes: c.notes,
    };
  }

  // ── Save — truly async, waits for API ──
  async save(): Promise<void> {
    if (!this.dirty() || this.saveState() === 'saving') return;
    const f = this.form();
    if (!f.name.trim() || !f.email.trim()) {
      this.toast.error(this.t('customerDrawer.field.name') + ' and email are required.');
      this.triggerShake();
      return;
    }
    this.saveState.set('saving');
    try {
      const payload = {
        name: f.name.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        city: f.city,
        sizePref: f.sizePref,
        notes: f.notes,
      };
      const apiResponse = this.mode === 'create'
        ? await this.customersApi.create(payload)
        : await this.customersApi.update(this.customer.id, payload);

      // Adopt server response (new id for creates, fresh timestamps, etc.)
      Object.assign(this.customer, apiResponse);
      this.initial.set({ ...f });
      this.saveState.set('saved');

      const titleKey = this.mode === 'create'
        ? 'customerDrawer.toast.created.title'
        : 'customerDrawer.toast.saved.title';
      this.toast.success(this.t(titleKey), f.name);
      this.saved.emit({ ...this.customer });
      setTimeout(() => this.saveState.set('idle'), 1500);
    } catch {
      // Revert to dirty so admin can retry. Global interceptor shows the error toast.
      this.saveState.set('dirty');
    }
  }

  discard(): void {
    if (!this.dirty()) return;
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
  }

  handleClose(): void {
    if (this.dirty()) { this.triggerShake(); return; }
    this.closed.emit();
  }

  triggerShake(): void {
    this.shakeSaveBar.set(false);
    setTimeout(() => this.shakeSaveBar.set(true), 10);
  }

  initials(): string {
    const name = this.form().name || this.customer?.name || '?';
    return name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  }

  itemsCountLabel(n: number): string {
    const tpl = n === 1
      ? this.t('customerDrawer.itemsCount.one')
      : this.t('customerDrawer.itemsCount.many');
    return tpl.replace('{n}', String(n));
  }

  async onDelete(): Promise<void> {
    if (this.deleting()) return;
    const ok = await this.confirm.ask({
      title: this.t('customerDrawer.deleteConfirm.title'),
      message: `${this.t('customerDrawer.deleteConfirm.message')} "${this.customer.name}". Their order history will be preserved.`,
      confirmLabel: this.t('customerDrawer.deleteConfirm.confirm'),
      cancelLabel: this.t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      this.toast.success(this.t('customerDrawer.toast.deleted'), this.customer.name);
      this.deleted.emit(this.customer);
    } finally {
      this.deleting.set(false);
    }
  }
}
