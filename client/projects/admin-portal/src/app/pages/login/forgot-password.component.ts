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
      <div class="login-wrap">
        <img src="assets/brand/elite-logo-cream.png" alt="Elite Collection" class="login-logo"/>

        <div class="login-card">
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
            @if (errorMessage()) {
              <div class="login-error">{{ errorMessage() }}</div>
            }
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
    </div>
  `,
  styles: [`
    :host { display: block; }
    .login-shell {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
      background: var(--green);
      position: relative;
      overflow: hidden;
    }
    .login-shell::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 90% 55% at 50% -5%, rgba(255,255,255,0.07), transparent),
        radial-gradient(ellipse 55% 40% at 90% 105%, rgba(193,154,91,0.14), transparent);
      pointer-events: none;
    }
    .login-wrap {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: min(400px, 100%);
    }
    .login-logo {
      height: 30px;
      width: auto;
      display: block;
      margin-bottom: 24px;
      opacity: 0.95;
    }
    .login-card {
      width: 100%;
      background: #fff;
      border-radius: 20px;
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.06),
        0 8px 24px rgba(0,0,0,0.18),
        0 32px 72px rgba(0,0,0,0.28);
      padding: 36px 32px 32px;
    }
    .login-title {
      font-family: var(--ff-disp); font-size: 22px;
      margin-bottom: 6px; color: var(--ink);
    }
    .login-sub { color: var(--ink-2); font-size: 13px; margin-bottom: 28px; line-height: 1.5; }
    .login-error {
      background: rgba(239, 68, 68, 0.08);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      margin-bottom: 14px;
    }
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
  readonly errorMessage = signal('');

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    try {
      await this.auth.forgotPassword(this.email().trim());
      this.sent.set(true);
    } catch {
      this.errorMessage.set(this.t('login.unknownError'));
    } finally {
      this.busy.set(false);
    }
  }
}
