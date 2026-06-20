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
      <div class="login-wrap">
        <img src="assets/brand/elite-logo-cream.png" alt="Elite Collection" class="login-logo"/>

        <div class="login-card">
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
    </div>
  `,
  styles: [`
    :host { display: block; }

    .login-shell {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: calc(env(safe-area-inset-top, 0px) + 32px)
               calc(env(safe-area-inset-right, 0px) + 24px)
               calc(env(safe-area-inset-bottom, 0px) + 32px)
               calc(env(safe-area-inset-left, 0px) + 24px);
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
      font-family: var(--ff-disp);
      font-size: 22px;
      margin-bottom: 6px;
      color: var(--ink);
    }
    .login-sub {
      color: var(--ink-2);
      font-size: 13px;
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .login-form { display: flex; flex-direction: column; }
    .login-error {
      background: rgba(239,68,68,0.08);
      color: var(--danger);
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      margin-bottom: 14px;
    }
    .btn-block { width: 100%; justify-content: center; }
    .login-foot {
      margin-top: 18px;
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
