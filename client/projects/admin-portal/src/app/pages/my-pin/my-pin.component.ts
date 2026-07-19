import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { inject } from '@angular/core';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { PosService } from '../../services/pos.service';

/**
 * A Manager-role account has no reason to reach the rest of Settings
 * (store config, team management, receipt/legal profile are all
 * owner/admin-only) but still needs a way to set the PIN that approver-
 * separation requires them to have — see docs/17-pos-remote-verification,
 * 2026-07-20 retest, which found Managers silently redirected away from
 * /settings with no other path to a working PIN. This is that path.
 */
@Component({
  selector: 'ap-my-pin',
  standalone: true,
  imports: [CommonModule, FormsModule, SpinnerComponent],
  template: `
    <div class="page-fade">
      <div class="card card-pad" style="max-width:520px;">
        <div class="card-title mb-16">{{ t('settings.managerPin.title') }}</div>
        <div class="card-sub mb-16">{{ t('settings.managerPin.sub') }}</div>

        <label class="lbl">{{ t('settings.managerPin.newPin') }}</label>
        <input class="inp" type="password" inputmode="numeric" maxlength="8"
               [ngModel]="pin()" (ngModelChange)="pin.set($event)"
               placeholder="4-8 digits"/>

        <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
          <button class="btn btn-gold" [disabled]="saving() || !isValidPinFormat(pin())" (click)="save()">
            @if (saving()) { <ap-spinner [size]="12"/> {{ t('common.saving') }} }
            @else { {{ t('settings.managerPin.save') }} }
          </button>
        </div>
        <div class="muted small mt-16">{{ t('settings.managerPin.hint') }}</div>
      </div>
    </div>
  `,
})
export class MyPinComponent {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly posApi = inject(PosService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly pin = signal('');
  readonly saving = signal(false);

  isValidPinFormat(pin: string): boolean {
    return /^\d{4,8}$/.test(pin);
  }

  async save(): Promise<void> {
    if (this.saving() || !this.isValidPinFormat(this.pin())) return;
    this.saving.set(true);
    try {
      await this.posApi.setManagerPin(this.pin());
      this.pin.set('');
      this.toast.success(this.t('settings.toast.managerPinSaved'), this.t('settings.toast.managerPinSaved.sub'));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.saving.set(false);
    }
  }
}
