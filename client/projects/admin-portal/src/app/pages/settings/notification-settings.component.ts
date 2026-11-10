import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { AdminSettingsService } from '../../services/admin-settings.service';
import { NotificationService } from '../../services/notification.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';

// Mirrors the server's check in server/lib/staff-notify.js.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Settings → Notifications. Who receives the new-order email (saved on the
 * server, owner/admin only), plus this browser's own alert preferences (sound
 * and desktop notifications), which are per device by nature.
 */
@Component({
  selector: 'ap-notification-settings',
  imports: [FormsModule, IconComponent, SaveBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ap-save-bar
      [dirty]="dirty()"
      [saving]="saving()"
      (saved)="save()"
      (discarded)="discard()"/>

    <div class="card card-pad ns-card">
      <div class="card-title">{{ t('settings.notif.orderEmails') }}</div>
      <p class="muted small ns-intro">{{ t('settings.notif.orderEmails.help') }}</p>

      @if (loading()) {
        <div class="ns-skel" aria-hidden="true"><div></div><div></div></div>
      } @else if (loadError()) {
        <div class="ns-notice ns-notice-error" role="alert">
          <span>{{ t('settings.notif.loadError') }}</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="load()">{{ t('common.retry') }}</button>
        </div>
      } @else {
        @if (!smtpConfigured()) {
          <div class="ns-notice" role="status">
            <ap-icon name="warning" [size]="14"/>
            <span>{{ t('settings.notif.smtpMissing') }}</span>
          </div>
        }

        <label class="lbl" for="ns-email">{{ t('settings.notif.addRecipient') }}</label>
        <div class="ns-add">
          <input id="ns-email" class="inp" type="email" inputmode="email" autocomplete="off" dir="ltr"
                 [class.inp-error]="inputError()"
                 [ngModel]="draft()" (ngModelChange)="draft.set($event); inputError.set('')"
                 (keydown.enter)="$event.preventDefault(); add()"
                 (keydown)="onKey($event)"
                 [attr.aria-describedby]="inputError() ? 'ns-email-error' : 'ns-email-help'"
                 placeholder="orders@example.com"/>
          <button type="button" class="btn btn-outline" (click)="add()" [disabled]="atLimit()">
            <ap-icon name="plus" [size]="13"/> {{ t('settings.notif.add') }}
          </button>
        </div>
        @if (inputError()) {
          <div id="ns-email-error" class="inp-msg-error">{{ inputError() }}</div>
        } @else {
          <div id="ns-email-help" class="muted small ns-help">
            {{ t('settings.notif.count').replace('{n}', '' + emails().length).replace('{max}', '' + maxRecipients()) }}
          </div>
        }

        @if (emails().length) {
          <ul class="ns-chips" [attr.aria-label]="t('settings.notif.orderEmails')">
            @for (email of emails(); track email) {
              <li class="ns-chip">
                <span dir="ltr">{{ email }}</span>
                <button type="button" class="ns-chip-x" (click)="remove(email)"
                        [attr.aria-label]="t('settings.notif.remove').replace('{email}', email)">
                  <ap-icon name="x" [size]="10"/>
                </button>
              </li>
            }
          </ul>
        } @else {
          <div class="ns-empty">
            <ap-icon name="mail" [size]="18"/>
            <span>{{ t('settings.notif.empty') }}</span>
          </div>
        }

        <label class="lbl ns-reminder-lbl" for="ns-reminder">{{ t('settings.notif.reminder') }}</label>
        <div class="ns-reminder">
          <input id="ns-reminder" class="inp" type="number" min="15" max="1440" step="15" inputmode="numeric"
                 [ngModel]="reminder()" (ngModelChange)="reminder.set(+$event)"
                 [class.inp-error]="reminderInvalid()" aria-describedby="ns-reminder-help"/>
          <span class="muted small">{{ t('settings.notif.minutes') }}</span>
        </div>
        <div id="ns-reminder-help" [class]="reminderInvalid() ? 'inp-msg-error' : 'muted small'">{{ t('settings.notif.reminder.help') }}</div>

        <div class="ns-actions">
          <button type="button" class="btn btn-outline" (click)="sendTest()" [disabled]="testing() || !emails().length">
            <ap-icon name="mail" [size]="13"/>
            {{ testing() ? t('settings.notif.testSending') : t('settings.notif.test') }}
          </button>
          <span class="muted small">{{ t('settings.notif.test.help') }}</span>
        </div>
      }
    </div>

    <div class="card card-pad ns-card">
      <div class="card-title">{{ t('settings.notif.thisDevice') }}</div>
      <p class="muted small ns-intro">{{ t('settings.notif.thisDevice.help') }}</p>

      <div class="ns-pref">
        <div>
          <div class="ns-pref-title">{{ t('notif.sound') }}</div>
          <div class="muted small">{{ t('settings.notif.sound.help') }}</div>
        </div>
        <input type="checkbox" class="ns-switch" [checked]="notifs.soundEnabled()"
               (change)="notifs.setSound($any($event.target).checked)" [attr.aria-label]="t('notif.sound')"/>
      </div>

      <div class="ns-pref">
        <div>
          <div class="ns-pref-title">{{ t('notif.desktop') }}</div>
          <div class="muted small">
            @switch (notifs.desktopState()) {
              @case ('granted') { {{ t('settings.notif.desktop.onHelp') }} }
              @case ('denied') { {{ t('notif.desktop.blockedHelp') }} }
              @case ('unsupported') { {{ t('notif.desktop.unsupported') }} }
              @default { {{ t('settings.notif.desktop.offHelp') }} }
            }
          </div>
        </div>
        @switch (notifs.desktopState()) {
          @case ('granted') { <span class="ns-state on">{{ t('notif.desktop.on') }}</span> }
          @case ('denied') { <span class="ns-state">{{ t('notif.desktop.blocked') }}</span> }
          @case ('unsupported') { <span class="ns-state">-</span> }
          @default {
            <button type="button" class="btn btn-primary btn-sm" (click)="notifs.enableDesktopAlerts()">{{ t('notif.desktop.enable') }}</button>
          }
        }
      </div>
      <div class="muted small ns-footnote">{{ t('notif.openTabHint') }}</div>
    </div>
  `,
  styles: [`
    :host { display: grid; gap: 16px; max-width: 680px; }
    .ns-card { display: grid; gap: 8px; }
    .ns-intro { margin: -2px 0 8px; max-width: 60ch; line-height: 1.55; }
    .ns-add { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .ns-add .btn { white-space: nowrap; }
    .ns-help { margin-top: 2px; }
    .ns-chips { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .ns-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 6px 6px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg);
      font-size: 12px;
      color: var(--ink);
      max-width: 100%;
    }
    :host-context([dir='rtl']) .ns-chip { padding: 6px 12px 6px 6px; }
    .ns-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ns-chip-x {
      display: inline-grid; place-items: center;
      width: 22px; height: 22px;
      border: 0; border-radius: 50%;
      background: transparent; color: var(--muted); cursor: pointer;
    }
    .ns-chip-x:hover { background: var(--border-2); color: var(--danger); }
    .ns-chip-x:focus-visible { outline: 2px solid var(--gold); }
    .ns-empty {
      display: flex; align-items: center; gap: 10px;
      margin-top: 8px; padding: 14px 16px;
      border: 1px dashed var(--border);
      border-radius: 10px;
      color: var(--muted); font-size: 13px;
    }
    .ns-reminder-lbl { margin-top: 12px; }
    .ns-reminder { display: flex; align-items: center; gap: 8px; }
    .ns-reminder .inp { width: 110px; }
    .ns-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; }
    .ns-notice {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 12px; margin-bottom: 8px;
      border-radius: 10px;
      background: rgba(217, 119, 6, 0.08);
      border: 1px solid rgba(217, 119, 6, 0.25);
      color: var(--ink); font-size: 12px; line-height: 1.5;
    }
    .ns-notice-error { align-items: center; justify-content: space-between; background: rgba(220, 38, 38, 0.06); border-color: rgba(220, 38, 38, 0.2); }
    .ns-pref {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 12px 0;
      border-top: 1px solid var(--border-2);
    }
    .ns-pref-title { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
    .ns-switch { width: 18px; height: 18px; accent-color: var(--green); cursor: pointer; flex-shrink: 0; }
    .ns-state { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
    .ns-state.on { color: var(--success, var(--green)); }
    .ns-footnote { padding-top: 10px; border-top: 1px solid var(--border-2); }
    .ns-skel { display: grid; gap: 10px; padding: 8px 0; }
    .ns-skel div { height: 36px; border-radius: 8px; background: var(--border-2); }
    .ns-skel div:last-child { width: 55%; height: 14px; }
    @media (max-width: 480px) {
      .ns-add { grid-template-columns: 1fr; }
    }
  `],
})
export class NotificationSettingsComponent implements OnInit {
  private readonly api = inject(AdminSettingsService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  readonly notifs = inject(NotificationService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly smtpConfigured = signal(true);
  readonly maxRecipients = signal(10);

  readonly emails = signal<string[]>([]);
  private readonly saved = signal<string[]>([]);
  readonly draft = signal('');
  readonly inputError = signal('');

  readonly reminder = signal(120);
  private readonly savedReminder = signal(120);
  readonly reminderInvalid = computed(() => !Number.isInteger(this.reminder()) || this.reminder() < 15 || this.reminder() > 1440);
  readonly dirty = computed(() => this.emails().join('\n') !== this.saved().join('\n') || this.draft().trim() !== ''
    || this.reminder() !== this.savedReminder());
  readonly atLimit = computed(() => this.emails().length >= this.maxRecipients());

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const res = await this.api.getNotificationSettings();
      this.emails.set(res.orderEmails);
      this.saved.set(res.orderEmails);
      this.smtpConfigured.set(res.smtpConfigured);
      this.maxRecipients.set(res.maxRecipients);
      this.reminder.set(res.reminderAfterMinutes ?? 120);
      this.savedReminder.set(res.reminderAfterMinutes ?? 120);
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Commas and spaces also add, so a pasted list splits into chips. */
  onKey(event: KeyboardEvent): void {
    if (event.key === ',' || event.key === ' ') {
      event.preventDefault();
      this.add();
    }
  }

  /** Adds the draft (one or several addresses). Returns false if anything was invalid. */
  add(): boolean {
    const parts = this.draft().split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return true;
    const invalid = parts.filter((p) => !EMAIL_RE.test(p));
    if (invalid.length) {
      this.inputError.set(this.t('settings.notif.invalid').replace('{email}', invalid[0]));
      return false;
    }
    const next = [...this.emails()];
    for (const email of parts) if (!next.includes(email)) next.push(email);
    if (next.length > this.maxRecipients()) {
      this.inputError.set(this.t('settings.notif.limit').replace('{max}', String(this.maxRecipients())));
      return false;
    }
    this.emails.set(next);
    this.draft.set('');
    this.inputError.set('');
    return true;
  }

  remove(email: string): void {
    this.emails.update((list) => list.filter((e) => e !== email));
    this.inputError.set('');
  }

  discard(): void {
    this.reminder.set(this.savedReminder());
    this.emails.set(this.saved());
    this.draft.set('');
    this.inputError.set('');
  }

  async save(): Promise<void> {
    // A typed but un-added address is almost always meant to be saved.
    if (!this.add()) return;
    if (this.reminderInvalid()) return;
    this.saving.set(true);
    try {
      const res = await this.api.saveNotificationSettings(this.emails(), this.reminder());
      this.emails.set(res.orderEmails);
      this.saved.set(res.orderEmails);
      this.reminder.set(res.reminderAfterMinutes ?? this.reminder());
      this.savedReminder.set(res.reminderAfterMinutes ?? this.reminder());
      this.smtpConfigured.set(res.smtpConfigured);
      this.toast.success(this.t('settings.notif.saved'));
    } catch (err) {
      this.toast.errorFrom(err, this.t('settings.notif.saveError'));
    } finally {
      this.saving.set(false);
    }
  }

  async sendTest(): Promise<void> {
    if (!this.add()) return;
    this.testing.set(true);
    try {
      const res = await this.api.sendNotificationTestEmail(this.emails());
      this.toast.success(this.t('settings.notif.testSent'), res.sentTo.join(', '));
    } catch (err) {
      this.toast.errorFrom(err, this.t('settings.notif.testError'));
    } finally {
      this.testing.set(false);
    }
  }
}
