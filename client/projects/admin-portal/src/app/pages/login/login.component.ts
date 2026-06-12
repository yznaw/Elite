import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { AuthService } from '../../services/auth.service';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';

@Component({
  selector: 'ap-login',
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

        <h1 class="login-title">{{ t('login.title') }}</h1>
        <p class="login-sub">{{ t('login.sub') }}</p>

        <form class="login-form" (submit)="$event.preventDefault(); submit()">
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

          <label class="lbl" for="password">{{ t('login.password') }}</label>
          <input
            id="password"
            class="inp mb-16"
            type="password"
            autocomplete="current-password"
            required
            [placeholder]="t('login.password.placeholder')"
            [ngModel]="password()"
            (ngModelChange)="password.set($event)"
            name="password"
            [disabled]="busy()"
          />

          @if (errorMessage()) {
            <div class="login-error">{{ errorMessage() }}</div>
          }

          <button
            class="btn btn-gold btn-block"
            type="submit"
            [disabled]="busy() || !email() || !password()"
          >
            @if (busy()) {
              <ap-spinner [size]="12"/> {{ t('login.submitting') }}
            } @else {
              {{ t('login.submit') }}
            }
          </button>

          <div class="login-foot">
            <a routerLink="/forgot-password" class="login-link">{{ t('login.forgot') }}</a>
          </div>
        </form>
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
      /* Safe-area insets for iPhone notch / Dynamic Island */
      padding: calc(env(safe-area-inset-top, 0px) + 24px)
               calc(env(safe-area-inset-right, 0px) + 24px)
               calc(env(safe-area-inset-bottom, 0px) + 24px)
               calc(env(safe-area-inset-left, 0px) + 24px);
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
    .login-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .brand-mark {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--green), var(--green-3));
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: var(--ff-disp);
      font-weight: 600;
      font-size: 16px;
    }
    .brand-name {
      font-family: var(--ff-disp);
      font-size: 18px;
      color: var(--green);
      letter-spacing: 0.04em;
    }
    .brand-tagline { color: var(--muted); font-size: 12px; }
    .login-title {
      font-family: var(--ff-disp);
      font-size: 22px;
      margin-bottom: 6px;
      color: var(--ink);
    }
    .login-sub {
      color: var(--ink-2);
      font-size: 13px;
      margin-bottom: 24px;
    }
    .login-form { display: flex; flex-direction: column; }
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
    .login-foot {
      margin-top: 16px;
      text-align: center;
      font-size: 12px;
    }
    .login-link {
      color: var(--green);
      text-decoration: none;
      font-weight: 500;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s;
    }
    .login-link:hover { border-bottom-color: var(--gold); }
  `],
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  readonly locale = inject(LocaleService);

  readonly t = (k: string) => this.i18n.t(k);
  readonly email = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal<string>('');

  ngOnInit(): void {
    // If a valid session already exists, bounce to the return URL or dashboard.
    void this.auth.me().then((user) => {
      if (user) this.redirectAfterLogin();
    });
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.email().trim(), this.password());
      this.redirectAfterLogin();
    } catch (err: unknown) {
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status === 401) this.errorMessage.set(this.t('login.invalid'));
      else if (status === 403) this.errorMessage.set(this.t('login.disabled'));
      else this.errorMessage.set(this.t('login.unknownError'));
    } finally {
      this.busy.set(false);
    }
  }

  private redirectAfterLogin(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/dashboard';
    this.router.navigateByUrl(returnUrl);
  }
}
