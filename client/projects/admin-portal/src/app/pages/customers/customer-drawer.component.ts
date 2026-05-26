import {
  Component, EventEmitter, Input, OnInit, Output,
  computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { ORDERS } from '../../data/mock';
import { Customer, Order, QAR } from '../../models';

interface FormShape {
  name: string;
  email: string;
  city: string;
  sizePref: number;
  notes: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

@Component({
  selector: 'ap-customer-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, AvatarComponent, PillComponent, SpinnerComponent],
  template: `
    <div class="overlay" (click)="handleClose()"></div>
    <div class="drawer drawer-wide customer-drawer" [class.is-dirty]="dirty()">
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

      <div class="save-bar-top" [class.dirty]="dirty()" [class.shake]="shakeSaveBar()">
        <div class="row gap-sm" style="min-width:0;flex:1;">
          <span class="save-badge" style="background:transparent;border-color:transparent;color:#fff;">
            {{ t('customerDrawer.unsaved') }}
          </span>
        </div>
        <div class="row gap-sm" style="flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" (click)="discard()" [disabled]="saveState() === 'saving'">
            {{ t('common.discard') }}
          </button>
          <button class="btn btn-primary btn-sm" (click)="save()" [disabled]="saveState() === 'saving'">
            @if (saveState() === 'saving') {
              <ap-spinner/> {{ t('common.saving') }}
            } @else {
              {{ t('common.saveChanges') }}
            }
          </button>
        </div>
      </div>

      <div class="drawer-body">
        @if (mode === 'edit') {
          <div class="grid-3 mb-24">
            <div class="card-pad" style="background:var(--bg);border-radius:10px;">
              <div class="muted small">{{ t('customerDrawer.totalOrders') }}</div>
              <div class="kpi-value" style="font-size:24px;margin-top:4px;">{{ customer.orders }}</div>
            </div>
            <div class="card-pad" style="background:var(--bg);border-radius:10px;">
              <div class="muted small">{{ t('customerDrawer.ltv') }}</div>
              <div class="kpi-value" style="font-size:24px;margin-top:4px;color:var(--gold);">{{ QAR(customer.ltv) }}</div>
            </div>
            <div class="card-pad" style="background:var(--bg);border-radius:10px;">
              <div class="muted small">{{ t('customerDrawer.memberSince') }}</div>
              <div class="kpi-value" style="font-size:18px;margin-top:4px;">{{ customer.joined }}</div>
            </div>
          </div>
        }

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
              <label class="lbl">{{ t('customerDrawer.field.city') }}</label>
              <input class="inp"
                     [placeholder]="t('customerDrawer.placeholder.city')"
                     [ngModel]="form().city" (ngModelChange)="set('city', $event)"/>
            </div>
          </div>

          <label class="lbl">{{ t('customerDrawer.field.sizePref') }}</label>
          <input class="inp mono" type="number" min="30" max="50" style="max-width:120px;"
                 [ngModel]="form().sizePref" (ngModelChange)="setNum('sizePref', $event)"/>
        </div>

        @if (mode === 'edit') {
          <div class="section-title">
            <ap-icon name="orders" [size]="14"/>
            <span>{{ t('customerDrawer.section.history') }}</span>
          </div>

          <div class="mb-24">
            @if (customerOrders().length === 0) {
              <div class="muted small notes-empty">{{ t('customerDrawer.noOrders') }}</div>
            } @else {
              <div class="panel">
                @for (o of customerOrders(); track o.id; let last = $last) {
                  <button class="order-row"
                          [class.is-last]="last"
                          (click)="openOrder.emit(o)"
                          [attr.aria-label]="t('customerDrawer.openOrder') + ' ' + o.id">
                    <div class="order-row-id">
                      <div class="strong mono" style="color:var(--green);">{{ o.id }}</div>
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
                    <div [style.width.%]="(s.count / maxSize()) * 100" style="height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-2));"></div>
                  </div>
                  <div class="muted small" style="width:32px;text-align:right;">{{ s.count }}×</div>
                </div>
              }
            </div>
          </div>
        }

        <div class="section-title">
          <ap-icon name="edit" [size]="14"/>
          <span>{{ t('customerDrawer.section.notes') }}</span>
        </div>
        <div class="mb-24">
          <textarea class="inp" rows="4"
                    [placeholder]="t('customerDrawer.field.notes.placeholder')"
                    [ngModel]="form().notes" (ngModelChange)="set('notes', $event)"></textarea>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .drawer-wide { width: min(640px, 100vw); }
    @media (max-width: 720px) { .drawer-wide { width: 100vw; } }

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

    .customer-drawer.is-dirty .drawer-head { box-shadow: inset 4px 0 0 var(--gold); }
    html[dir='rtl'] .customer-drawer.is-dirty .drawer-head { box-shadow: inset -4px 0 0 var(--gold); }

    .section-title {
      display: flex; align-items: center; gap: 8px;
      padding: 16px 0 12px;
      margin-top: 4px;
      border-top: 1px solid var(--border-2);
      color: var(--green);
      font-family: var(--ff-disp);
      font-size: 16px;
      font-weight: 500;
    }
    .section-title:first-of-type { border-top: none; padding-top: 0; }
    .section-title ap-icon { color: var(--gold); flex-shrink: 0; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 560px) {
      .grid-2 { grid-template-columns: 1fr; }
      .grid-3 { grid-template-columns: 1fr; }
    }

    .order-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 16px;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border-2);
      cursor: pointer;
      text-align: start;
      font: inherit;
      color: inherit;
      transition: background 0.12s;
    }
    .order-row.is-last { border-bottom: none; }
    .order-row:hover { background: var(--bg); }
    .order-row-id { min-width: 0; }
    .order-row-arrow {
      color: var(--muted);
      transition: transform 0.15s, color 0.15s;
    }
    .order-row:hover .order-row-arrow {
      color: var(--gold);
      transform: translateX(2px);
    }
    html[dir='rtl'] .order-row:hover .order-row-arrow { transform: translateX(-2px) scaleX(-1); }
    html[dir='rtl'] .order-row-arrow { transform: scaleX(-1); }

    .notes-empty {
      padding: 14px 16px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      text-align: center;
      background: var(--bg);
    }
  `],
})
export class CustomerDrawerComponent implements OnInit {
  @Input({ required: true }) customer!: Customer;
  @Input() mode: 'edit' | 'create' = 'edit';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Customer>();
  @Output() openOrder = new EventEmitter<Order>();

  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly QAR = QAR;
  readonly fulfillment = fulfillmentPillKind;

  private readonly initial = signal<FormShape>(this.makeEmptyForm());
  readonly form = signal<FormShape>(this.makeEmptyForm());
  readonly saveState = signal<SaveState>('idle');
  readonly shakeSaveBar = signal(false);

  readonly dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.initial()));

  ngOnInit(): void {
    this.initial.set(this.makeFormFromCustomer(this.customer));
    this.form.set({ ...this.initial() });
  }

  set<K extends keyof FormShape>(k: K, v: FormShape[K]): void {
    this.form.update((f) => ({ ...f, [k]: v }));
    if (this.dirty() && this.saveState() === 'idle') this.saveState.set('dirty');
  }

  setNum(k: 'sizePref', v: string | number): void {
    const n = typeof v === 'number' ? v : parseInt(v, 10) || 0;
    this.set(k, n);
  }

  private makeEmptyForm(): FormShape {
    return { name: '', email: '', city: '', sizePref: 42, notes: '' };
  }

  private makeFormFromCustomer(c: Customer): FormShape {
    return {
      name: c.name,
      email: c.email,
      city: c.city,
      sizePref: c.sizePref,
      notes: c.notes,
    };
  }

  save(): void {
    if (!this.dirty() || this.saveState() === 'saving') return;
    this.saveState.set('saving');
    setTimeout(() => {
      const f = this.form();
      this.customer.name = f.name;
      this.customer.email = f.email;
      this.customer.city = f.city;
      this.customer.sizePref = f.sizePref;
      this.customer.notes = f.notes;
      this.initial.set({ ...f });
      this.saveState.set('saved');
      const titleKey = this.mode === 'create'
        ? 'customerDrawer.toast.created.title'
        : 'customerDrawer.toast.saved.title';
      this.toast.success(this.t(titleKey), this.customer.name);
      this.saved.emit(this.customer);
      setTimeout(() => this.saveState.set('idle'), 1500);
    }, 700);
  }

  discard(): void {
    if (!this.dirty()) return;
    this.form.set({ ...this.initial() });
    this.saveState.set('idle');
  }

  handleClose(): void {
    if (this.dirty()) {
      this.triggerShake();
      return;
    }
    this.closed.emit();
  }

  triggerShake(): void {
    this.shakeSaveBar.set(false);
    setTimeout(() => this.shakeSaveBar.set(true), 10);
  }

  initials(): string {
    const name = this.form().name || this.customer.name || '?';
    return name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  }

  itemsCountLabel(n: number): string {
    const tpl = n === 1 ? this.t('customerDrawer.itemsCount.one') : this.t('customerDrawer.itemsCount.many');
    return tpl.replace('{n}', String(n));
  }

  readonly customerOrders = computed<Order[]>(() => {
    // Re-evaluates if name changes — keeps the list in sync after edits.
    const name = this.form().name;
    return ORDERS.filter((o) => o.customer === name);
  });

  readonly sizeStats = computed(() => {
    const sizeMap: Record<number, number> = {};
    this.customerOrders().forEach((o) => o.items.forEach((it) => { sizeMap[it.s] = (sizeMap[it.s] || 0) + it.q; }));
    const sizes = Object.keys(sizeMap).map((s) => ({ size: Number(s), count: sizeMap[Number(s)] }));
    if (sizes.length === 0) sizes.push({ size: this.form().sizePref, count: 1 });
    return sizes.sort((a, b) => b.count - a.count);
  });

  maxSize = (): number => Math.max(...this.sizeStats().map((s) => s.count), 1);
}
