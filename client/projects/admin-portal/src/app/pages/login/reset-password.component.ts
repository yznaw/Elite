import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';

@Component({
  selector: 'ap-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpinnerComponent],
  template: `
    <div class="login-shell" [attr.dir]="locale.dir()">
      <div class="login-wrap">
        <img src="assets/brand/elite-logo-cream.png" alt="Elite Collection" class="login-logo"/>

        <div class="login-card">
        <h1 class="login-title">{{ t('reset.title') }}</h1>
        <p class="login-sub">{{ t('reset.sub') }}</p>

        @if (!token()) {
          <div class="login-error">{{ t('reset.invalidToken') }}</div>
        } @else {
          <form (submit)="$event.preventDefault(); submit()">
            <label class="lbl" for="pw">{{ t('reset.password') }}</label>
            <input
              id="pw"
              class="inp mb-16"
              type="password"
              autocomplete="new-password"
              required
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
              name="password"
              [disabled]="busy()"
            />

            <label class="lbl" for="pw2">{{ t('reset.confirm') }}</label>
            <input
              id="pw2"
              class="inp mb-16"
              type="password"
              autocomplete="new-password"
              required
              [ngModel]="confirm()"
              (ngModelChange)="confirm.set($event)"
              name="confirm"
              [disabled]="busy()"
            />

            @if (errorMessage()) {
              <div class="login-error">{{ errorMessage() }}</div>
            }

            <button class="btn btn-gold btn-block" type="submit" [disabled]="busy() || !canSubmit()">
              @if (busy()) {
                <ap-spinner [size]="12"/> {{ t('reset.submitting') }}
              } @else {
                {{ t('reset.submit') }}
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
    .login-title { font-family: var(--ff-disp); font-size: 22px; margin-bottom: 6px; color: var(--ink); }
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
export class ResetPasswordComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  readonly locale = inject(LocaleService);

  readonly t = (k: string) => this.i18n.t(k);

  readonly token = signal<string>('');
  readonly password = signal('');
  readonly confirm = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.token.set(this.route.snapshot.queryParamMap.get('token') || '');
  }

  canSubmit(): boolean {
    return this.password().length >= 8 && this.password() === this.confirm();
  }

  async submit(): Promise<void> {
    if (this.busy() || !this.token()) return;
    if (this.password().length < 8) {
      this.errorMessage.set(this.t('reset.tooShort'));
      return;
    }
    if (this.password() !== this.confirm()) {
      this.errorMessage.set(this.t('reset.mismatch'));
      return;
    }
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await this.auth.resetPassword(this.token(), this.password());
      this.toast.success(this.t('reset.success'));
      this.router.navigate(['/login']);
    } catch (err: unknown) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status === 400) this.errorMessage.set(this.t('reset.expired'));
      else this.errorMessage.set(this.t('login.unknownError'));
    } finally {
      this.busy.set(false);
    }
  }
}
