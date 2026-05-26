import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { ApiClient } from '../../services/api-client.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'ap-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpinnerComponent],
  template: `
    <div class="login-shell">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark">EC</div>
          <div>
            <div class="brand-name">Elite Collection</div>
            <div class="brand-tagline">Admin Portal</div>
          </div>
        </div>

        <h1 class="login-title">Set your password</h1>

        @if (loading()) {
          <div class="row gap-sm" style="justify-content:center;padding:24px 0;">
            <ap-spinner/> <span class="muted">Validating invitation…</span>
          </div>
        } @else if (invalid()) {
          <div class="login-error">{{ errorMessage() }}</div>
          <div class="login-foot"><a routerLink="/login" class="login-link">Back to login</a></div>
        } @else if (done()) {
          <div class="success-box">
            <div class="success-icon">✓</div>
            <div class="strong">Account created!</div>
            <p class="muted small">You can now sign in with your email and new password.</p>
          </div>
          <a routerLink="/login" class="btn btn-gold btn-block" style="margin-top:16px;">Sign in now</a>
        } @else {
          <p class="login-sub">Creating an account for <strong>{{ email() }}</strong> with role <strong>{{ role() }}</strong>.</p>

          <form (submit)="$event.preventDefault(); submit()">
            <label class="lbl" for="name">Your name</label>
            <input id="name" class="inp mb-16" type="text" autocomplete="name" [ngModel]="name()" (ngModelChange)="name.set($event)" [disabled]="busy()" placeholder="Yusuf Al-Hamad"/>

            <label class="lbl" for="pw">Password</label>
            <input id="pw" class="inp mb-16" type="password" autocomplete="new-password" [ngModel]="password()" (ngModelChange)="password.set($event)" [disabled]="busy()"/>

            <label class="lbl" for="pw2">Confirm password</label>
            <input id="pw2" class="inp mb-16" type="password" autocomplete="new-password" [ngModel]="confirm()" (ngModelChange)="confirm.set($event)" [disabled]="busy()"/>

            @if (errorMessage()) {
              <div class="login-error">{{ errorMessage() }}</div>
            }

            <button class="btn btn-gold btn-block" type="submit" [disabled]="busy() || !canSubmit()">
              @if (busy()) {
                <ap-spinner [size]="12"/> Creating account…
              } @else {
                Create account & sign in
              }
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .login-shell {
      min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px;
      background: radial-gradient(circle at 30% 20%, rgba(2,70,56,.08), transparent 55%),
                  radial-gradient(circle at 80% 80%, rgba(193,154,91,.12), transparent 55%), var(--bg);
    }
    .login-card { width: min(420px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 24px 60px rgba(15,35,86,.12); padding: 32px; border: 1px solid var(--border); }
    .login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .brand-mark { width: 42px; height: 42px; border-radius: 10px; background: linear-gradient(135deg, var(--green), var(--green-3)); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--ff-disp); font-weight: 600; font-size: 16px; }
    .brand-name { font-family: var(--ff-disp); font-size: 18px; color: var(--green); letter-spacing: 0.04em; }
    .brand-tagline { color: var(--muted); font-size: 12px; }
    .login-title { font-family: var(--ff-disp); font-size: 22px; margin-bottom: 6px; color: var(--ink); }
    .login-sub { color: var(--ink-2); font-size: 13px; margin-bottom: 24px; }
    .login-error { background: rgba(239,68,68,.08); color: var(--danger); border: 1px solid rgba(239,68,68,.25); border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 14px; }
    .btn-block { width: 100%; justify-content: center; }
    .login-foot { margin-top: 16px; text-align: center; font-size: 12px; }
    .login-link { color: var(--green); text-decoration: none; font-weight: 500; border-bottom: 1px solid transparent; }
    .login-link:hover { border-bottom-color: var(--gold); }
    .success-box { text-align: center; padding: 24px 0; }
    .success-icon { font-size: 40px; color: var(--success, #10b981); margin-bottom: 8px; }
  `],
})
export class AcceptInviteComponent implements OnInit {
  private readonly api    = inject(ApiClient);
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading  = signal(true);
  readonly invalid  = signal(false);
  readonly done     = signal(false);
  readonly busy     = signal(false);
  readonly email    = signal('');
  readonly role     = signal('');
  readonly name     = signal('');
  readonly password = signal('');
  readonly confirm  = signal('');
  readonly errorMessage = signal('');

  private token = '';

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.invalid.set(true);
      this.errorMessage.set('Invalid invitation link.');
      this.loading.set(false);
      return;
    }
    try {
      const result = await firstValueFrom(
        this.api.get<{ email: string; role: string }>(`/invitations/validate?token=${encodeURIComponent(this.token)}`),
      );
      this.email.set(result.email);
      this.role.set(result.role);
    } catch {
      this.invalid.set(true);
      this.errorMessage.set('This invitation link is invalid or has expired.');
    } finally {
      this.loading.set(false);
    }
  }

  canSubmit(): boolean {
    return this.password().length >= 8 && this.password() === this.confirm();
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.password().length < 8) {
      this.errorMessage.set('Password must be at least 8 characters.');
      return;
    }
    if (this.password() !== this.confirm()) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }
    this.errorMessage.set('');
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.post<unknown>('/invitations/accept', {
          token: this.token,
          password: this.password(),
          name: this.name().trim() || undefined,
        }),
      );
      this.done.set(true);
    } catch {
      this.errorMessage.set('Failed to create account. The link may have expired.');
    } finally {
      this.busy.set(false);
    }
  }
}
