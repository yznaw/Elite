import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { CustomerDrawerComponent } from './customer-drawer.component';
import { CUSTOMERS } from '../../data/mock';
import { Customer, QAR } from '../../models';

@Component({
  selector: 'ap-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, AvatarComponent, EmptyStateComponent, SortableTableComponent, CellTplDirective, CustomerDrawerComponent],
  template: `
    <div class="page-fade">
      <div class="row gap-sm mb-24" style="flex-wrap:wrap;">
        <div class="inp-search" style="flex:1;min-width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" placeholder="Search customers…" [ngModel]="search()" (ngModelChange)="search.set($event)"/>
        </div>
        <select class="inp" style="width:auto;" [ngModel]="tier()" (ngModelChange)="tier.set($event)">
          <option value="all">All Tiers</option><option value="vip">VIP (10+)</option><option value="repeat">Repeat (3-9)</option><option value="new">New (1-2)</option>
        </select>
        <button class="btn btn-outline">Export</button>
        <button class="btn btn-gold"><ap-icon name="plus" [size]="14"/> Add Customer</button>
      </div>

      <div class="card">
        @if (filtered().length === 0) {
          <ap-empty-state icon="users" title="No customers match"
            sub="Try a different tier or clear the search.">
            <button class="btn btn-outline btn-sm" (click)="clearFilters()">Clear filters</button>
          </ap-empty-state>
        } @else {
        <ap-sortable-table [columns]="columns" [rows]="filtered()" [rowClick]="openCustomer">
          <ng-template apCellTpl="name" let-r>
            <div class="row gap-sm">
              <ap-avatar [initials]="initials(r.name)"/>
              <div>
                <div class="strong">{{ r.name }}</div>
                <div class="muted small">{{ r.city }}</div>
              </div>
            </div>
          </ng-template>
          <ng-template apCellTpl="orders" let-r><span class="strong">{{ r.orders }}</span></ng-template>
          <ng-template apCellTpl="ltv" let-r><span class="strong">{{ QAR(r.ltv) }}</span></ng-template>
          <ng-template apCellTpl="sizePref" let-r><ap-pill kind="gold">EU {{ r.sizePref }}</ap-pill></ng-template>
          <ng-template apCellTpl="actions" let-r>
            <button class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); openCustomer(r)">View</button>
          </ng-template>
        </ap-sortable-table>
        }
      </div>
    </div>

    @if (active(); as c) {
      <ap-customer-drawer [customer]="c" (closed)="active.set(null)"/>
    }
  `,
})
export class CustomersComponent {
  readonly QAR = QAR;
  readonly customers = CUSTOMERS;
  readonly active = signal<Customer | null>(null);
  readonly search = signal('');
  readonly tier = signal('all');

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    const t = this.tier();
    return this.customers.filter((c) => {
      if (t === 'vip' && c.orders < 10) return false;
      if (t === 'repeat' && (c.orders < 3 || c.orders > 9)) return false;
      if (t === 'new' && c.orders > 2) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  readonly columns: TableColumn<Customer>[] = [
    { key: 'name', label: 'Customer' },
    { key: 'email', label: 'Email' },
    { key: 'orders', label: 'Orders', align: 'center' },
    { key: 'ltv', label: 'Lifetime Value', align: 'right' },
    { key: 'sizePref', label: 'Size', align: 'center' },
    { key: 'lastOrder', label: 'Last Order' },
    { key: 'actions', label: '', noSort: true, align: 'right' },
  ];

  openCustomer = (c: Customer): void => { this.active.set(c); };

  clearFilters(): void {
    this.search.set('');
    this.tier.set('all');
  }

  initials(name: string): string {
    return name.split(' ').map((s) => s[0]).slice(0, 2).join('');
  }
}
