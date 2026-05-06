import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { fulfillmentPillKind } from '../../shared/pill/status-pill';
import { ToastService } from '../../services/toast.service';
import { ORDERS } from '../../data/mock';
import { Customer, QAR } from '../../models';

@Component({
  selector: 'ap-customer-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, AvatarComponent, PillComponent, SpinnerComponent],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="drawer">
      <div class="drawer-head">
        <div class="row gap-sm">
          <ap-avatar [initials]="initials" size="lg"/>
          <div>
            <div class="card-title">{{ customer.name }}</div>
            <div class="card-sub">{{ customer.email }}</div>
          </div>
        </div>
        <button class="x-btn" (click)="closed.emit()"><ap-icon name="x" [size]="14"/></button>
      </div>
      <div class="drawer-body">
        <div class="grid-3 mb-24">
          <div class="card-pad" style="background:var(--bg);border-radius:10px;">
            <div class="muted small">Total Orders</div>
            <div class="kpi-value" style="font-size:24px;margin-top:4px;">{{ customer.orders }}</div>
          </div>
          <div class="card-pad" style="background:var(--bg);border-radius:10px;">
            <div class="muted small">Lifetime Value</div>
            <div class="kpi-value" style="font-size:24px;margin-top:4px;color:var(--gold);">{{ QAR(customer.ltv) }}</div>
          </div>
          <div class="card-pad" style="background:var(--bg);border-radius:10px;">
            <div class="muted small">Member Since</div>
            <div class="kpi-value" style="font-size:18px;margin-top:4px;">{{ customer.joined }}</div>
          </div>
        </div>

        <div class="mb-24">
          <div class="lbl">Order History</div>
          @if (customerOrders.length === 0) {
            <div class="muted small">No orders for this customer yet.</div>
          } @else {
            <div class="panel">
              @for (o of customerOrders; track o.id; let last = $last) {
                <div [style.padding]="'12px 16px'"
                     [style.border-bottom]="last ? 'none' : '1px solid var(--border-2)'"
                     style="display:flex;justify-content:space-between;align-items:center;">
                  <div>
                    <div class="strong">{{ o.id }}</div>
                    <div class="muted small">{{ o.date }} · {{ o.itemsCount }} items</div>
                  </div>
                  <div class="row gap-sm">
                    <ap-pill [kind]="fulfillment(o.fulfillment).kind">{{ fulfillment(o.fulfillment).label }}</ap-pill>
                    <span class="strong">{{ QAR(o.total) }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="mb-24">
          <div class="lbl">Size Preference</div>
          <div class="panel card-pad">
            @for (s of sizeStats(); track s.size) {
              <div class="row gap-sm mb-8">
                <div style="width:50px;" class="strong">EU {{ s.size }}</div>
                <div class="grow" style="height:8px;background:var(--bg-2);border-radius:4px;overflow:hidden;">
                  <div [style.width.%]="(s.count / maxSize()) * 100" style="height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-2));"></div>
                </div>
                <div class="muted small" style="width:32px;text-align:right;">{{ s.count }}×</div>
              </div>
            }
          </div>
        </div>

        <div>
          <div class="lbl">Internal Notes</div>
          <textarea class="inp" rows="4" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea>
        </div>
      </div>
      <div class="drawer-foot" style="justify-content:space-between;">
        <span class="muted small">
          @if (saving()) { Saving notes… }
          @else if (dirty()) { Unsaved changes }
          @else { All changes saved }
        </span>
        <div class="row gap-sm">
          <button class="btn btn-ghost" (click)="closed.emit()" [disabled]="saving()">Close</button>
          <button class="btn btn-primary" [disabled]="!dirty() || saving()" (click)="saveNotes()">
            @if (saving()) { <ap-spinner [size]="12"/> Saving… }
            @else { Save Notes }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CustomerDrawerComponent {
  @Input({ required: true }) customer!: Customer;
  @Output() closed = new EventEmitter<void>();

  private readonly toast = inject(ToastService);

  readonly QAR = QAR;
  readonly fulfillment = fulfillmentPillKind;

  readonly notes = signal('');
  private initialNotes = '';
  readonly saving = signal(false);

  readonly dirty = computed(() => this.notes() !== this.initialNotes);

  ngOnInit(): void {
    this.initialNotes = this.customer.notes;
    this.notes.set(this.customer.notes);
  }

  saveNotes(): void {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    setTimeout(() => {
      this.initialNotes = this.notes();
      this.saving.set(false);
      this.toast.success('Notes saved', `${this.customer.name} · advisor visible`);
    }, 900);
  }

  get initials(): string {
    return this.customer.name.split(' ').map((s) => s[0]).slice(0, 2).join('');
  }

  get customerOrders() {
    return ORDERS.filter((o) => o.customer === this.customer.name);
  }

  readonly sizeStats = computed(() => {
    const sizeMap: Record<number, number> = {};
    this.customerOrders.forEach((o) => o.items.forEach((it) => { sizeMap[it.s] = (sizeMap[it.s] || 0) + it.q; }));
    const sizes = Object.keys(sizeMap).map((s) => ({ size: Number(s), count: sizeMap[Number(s)] }));
    if (sizes.length === 0) sizes.push({ size: this.customer.sizePref, count: 1 });
    return sizes.sort((a, b) => b.count - a.count);
  });

  maxSize = (): number => Math.max(...this.sizeStats().map((s) => s.count), 1);
}
