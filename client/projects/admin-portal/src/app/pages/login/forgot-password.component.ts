import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { AuthService } from '../../services/auth.service';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';

@Component({
  selector: 'ap-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpinnerComponent],
  template: `
    <div class="login-shell" [attr.dir]="locale.dir()">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark">EC</div>
          <div>
            <div class="brand-name">{{ t('brand.name') }}</div>
            <div class="brand-tagline">{{ t('brand.tagline') }}</div>
          </div>
        </div>

        @if (sent()) {
          <h1 class="login-title">{{ t('forgot.sentTitle') }}</h1>
          <p class="login-sub">{{ t('forgot.sentBody') }}</p>
          <p class="login-dev-note">{{ t('forgot.devNote') }}</p>
        } @else {
          <h1 class="login-title">{{ t('forgot.title') }}</h1>
          <p class="login-sub">{{ t('forgot.sub') }}</p>

          <form (submit)="$event.preventDefault(); submit()">
            <label class="lbl" for="email">{{ t('login.email') }}</label>
            <input
              id="email"
              class="inp mb-16"
              type="email"
              autocomplete="email"
              required
              [placeholder]="t('login.email.placeholder')"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              name="email"
              [disabled]="busy()"
            />
            <button class="btn btn-gold btn-block" type="submit" [disabled]="busy() || !email()">
              @if (busy()) {
                <ap-spinner [size]="12"/> {{ t('forgot.submitting') }}
              } @else {
                {{ t('forgot.submit') }}
              }
            </button>
          </form>
        }

        <div class="login-foot">
          <a routerLink="/login" class="login-link">{{ t('login.backToLogin') }}</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .login-shell {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at 30% 20%, rgba(2, 70, 56, 0.08), transparent 55%),
        radial-gradient(circle at 80% 80%, rgba(193, 154, 91, 0.12), transparent 55%),
        var(--bg);
    }
    .login-card {
      width: min(420px, 100%);
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(15, 35, 86, 0.12);
      padding: 32px;
      border: 1px solid var(--border);
    }
    .login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .brand-mark {
      width: 42px; height: 42px; border-radius: 10px;
      background: linear-gradient(135deg, var(--green), var(--green-3));
      color: #fff; display: inline-flex; align-items: center; justify-content: center;
      font-family: var(--ff-disp); font-weight: 600; font-size: 16px;
    }
    .brand-name {
      font-family: var(--ff-disp); font-size: 18px;
      color: var(--green); letter-spacing: 0.04em;
    }
    .brand-tagline { color: var(--muted); font-size: 12px; }
    .login-title {
      font-family: var(--ff-disp); font-size: 22px;
      margin-bottom: 6px; color: var(--ink);
    }
    .login-sub { color: var(--ink-2); font-size: 13px; margin-bottom: 24px; }
    .login-dev-note {
      background: var(--bg);
      border: 1px solid var(--border-2);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 16px;
    }
    .btn-block { width: 100%; justify-content: center; }
    .login-foot { margin-top: 16px; text-align: center; font-size: 12px; }
    .login-link {
      color: var(--green); text-decoration: none;
      font-weight: 500;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s;
    }
    .login-link:hover { border-bottom-color: var(--gold); }
  `],
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  readonly locale = inject(LocaleService);

  readonly t = (k: string) => this.i18n.t(k);
  readonly email = signal('');
  readonly busy = signal(false);
  readonly sent = signal(false);

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.forgotPassword(this.email().trim());
      this.sent.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
