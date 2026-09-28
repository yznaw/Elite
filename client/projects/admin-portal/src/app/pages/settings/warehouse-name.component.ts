import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../services/api-client.service';
import { InventoryService } from '../../services/inventory.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';

/**
 * The warehouse's display name (inventory, stocktakes, transfers). Stores
 * take their names from their branch above; the warehouse has no branch.
 */
@Component({
  selector: 'ap-warehouse-name',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (warehouseId()) {
      <div class="wh">
        <label class="lbl" for="wh-name">{{ t('settings.warehouse.name') }}</label>
        <div class="wh-row">
          <input id="wh-name" class="inp" maxlength="60" [ngModel]="name()" (ngModelChange)="name.set($event)"
                 (keydown.enter)="save()"/>
          <button type="button" class="btn btn-outline" (click)="save()" [disabled]="!dirty() || saving()">
            {{ saving() ? t('common.saving') : t('common.save') }}
          </button>
        </div>
        <div class="muted small">{{ t('settings.warehouse.help') }}</div>
      </div>
    }
  `,
  styles: [`
    .wh { display: grid; gap: 6px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-2); }
    .wh-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; max-width: 420px; }
    .wh-row .btn { white-space: nowrap; }
  `],
})
export class WarehouseNameComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly inventory = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly warehouseId = signal('');
  readonly name = signal('');
  private readonly savedName = signal('');
  readonly saving = signal(false);
  readonly dirty = computed(() => this.name().trim() !== '' && this.name().trim() !== this.savedName());

  ngOnInit(): void {
    this.inventory.perLocationStatus().then((status) => {
      const warehouse = (status?.locations ?? []).find((l) => l.type === 'warehouse');
      if (!warehouse) return;
      this.warehouseId.set(warehouse.id);
      this.name.set(warehouse.name);
      this.savedName.set(warehouse.name);
    }).catch(() => undefined);
  }

  async save(): Promise<void> {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.patch<{ name: string }>(`/admin/inventory/locations/${this.warehouseId()}`, { name: this.name().trim() }));
      this.name.set(saved.name);
      this.savedName.set(saved.name);
      this.toast.success(this.t('settings.warehouse.saved'));
    } catch (err) {
      this.toast.errorFrom(err, this.t('settings.warehouse.saveError'));
    } finally {
      this.saving.set(false);
    }
  }
}
