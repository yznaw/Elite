import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { AdminSettingsService, Invitation } from '../../services/admin-settings.service';
import { AuthService } from '../../services/auth.service';
import { StoreConfigService } from '../../services/store-config.service';
import { INTEGRATIONS } from '../../data/mock';
import { TeamMember } from '../../models';

type Tab = 'general' | 'team' | 'integrations';

@Component({
  selector: 'ap-settings',
  standalone: true,
  imports: [CommonModule, DatePipe, TitleCasePipe, FormsModule, IconComponent, PillComponent, AvatarComponent, SpinnerComponent, SortableTableComponent, CellTplDirective, SaveBarComponent],
  template: `
    <div class="page-fade">
      @if (tab() === 'general') {
        <ap-save-bar
          [dirty]="isDirty()"
          [saving]="savingGeneral()"
          (saved)="saveGeneral()"
          (discarded)="discardGeneral()"/>
      }
      <div class="tabs">
        @for (tt of tabs; track tt.key) {
          <button class="tab" [class.active]="tab() === tt.key" (click)="tab.set(tt.key)">{{ t(tt.labelKey) }}</button>
        }
      </div>

      @if (tab() === 'general') {
        <div class="card card-pad" style="max-width:680px;">
          <div class="card-title mb-16">{{ t('settings.storeInfo') }}</div>

          @if (loadingStore()) {
            <div class="row gap-sm" style="padding:24px 0;justify-content:center;">
              <ap-spinner/> <span class="muted small">Loading…</span>
            </div>
          } @else {
            <div class="grid-2">
              <div>
                <label class="lbl">{{ t('settings.storeName') }}</label>
                <input class="inp" [ngModel]="storeName()" (ngModelChange)="storeName.set($event)"
                       placeholder="Store name" [class.inp-error]="storeNameError()"/>
                @if (storeNameError()) {
                  <div class="inp-msg-error">Store name is required</div>
                }
              </div>
              <div>
                <label class="lbl">{{ t('settings.currency') }}</label>
                <select class="inp" [ngModel]="currency()" (ngModelChange)="currency.set($event)">
                  <option value="QAR">QAR — Qatari Riyal</option>
                </select>
              </div>
              <div>
                <label class="lbl">{{ t('settings.timezone') }}</label>
                <select class="inp" [ngModel]="timezone()" (ngModelChange)="timezone.set($event)">
                  <option value="Asia/Qatar">Asia/Qatar (GMT+3)</option>
                  <option value="Asia/Riyadh">Asia/Riyadh (GMT+3)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div>
                <label class="lbl">{{ t('settings.language') }}</label>
                <select class="inp" [ngModel]="language()" (ngModelChange)="language.set($event)">
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <div>
                <label class="lbl">{{ t('settings.lowStockThreshold') }}</label>
                <input class="inp" type="number" min="1" max="999"
                       [ngModel]="lowStockThreshold()" (ngModelChange)="lowStockThreshold.set(+$event)"/>
                <div class="muted small" style="margin-top:4px;">{{ t('settings.lowStockThreshold.help') }}</div>
              </div>
            </div>

            <div class="mt-24">
              <label class="lbl">{{ t('settings.logo') }}</label>
              <div style="padding:18px;border:1px dashed var(--border);border-radius:10px;background:var(--bg);display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
                <div class="avatar lg" style="border-radius:8px;background:var(--green);color:var(--gold);font-family:var(--ff-disp);font-size:18px;">EC</div>
                <div class="grow" style="min-width:0;">
                  <div class="strong mono">elite-logo.svg</div>
                  <div class="muted small">SVG · 4 KB</div>
                </div>
                <button class="btn btn-outline btn-sm"><ap-icon name="upload" [size]="12"/> {{ t('common.edit') }}</button>
              </div>
            </div>

          }
        </div>
      }

      @if (tab() === 'team') {
        <div class="col gap-lg">
          <div class="card card-pad">
            <div class="card-title mb-16">{{ t('settings.invite') }}</div>
            <div class="grid-2 mb-16">
              <div>
                <label class="lbl">{{ t('settings.email') }}</label>
                <input class="inp" type="email" placeholder="name@elitecollection.qa" [ngModel]="invite().email" (ngModelChange)="setInvite('email', $event)"/>
              </div>
              <div>
                <label class="lbl">Role</label>
                <select class="inp" [ngModel]="invite().role" (ngModelChange)="setInvite('role', $event)">
                  <option>Admin</option>
                  <option>Manager</option>
                  <option>Viewer</option>
                </select>
              </div>
            </div>
            <div class="row gap-sm" style="flex-wrap:wrap;">
              <button class="btn btn-gold" [disabled]="inviting() || !invite().email.includes('@')" (click)="sendInvite()">
                @if (inviting()) { <ap-spinner [size]="12"/> Sending… }
                @else { <ap-icon name="mail" [size]="14"/> Send Invitation }
              </button>
            </div>
            @if (inviteLink()) {
              <div class="invite-link-box">
                <ap-icon name="link" [size]="13"/>
                <span class="inv-email">{{ inviteLink()!.email }}</span>
                <span class="muted small">·</span>
                <input class="inv-link-input" [value]="inviteLink()!.link" readonly (click)="copyInviteLink()"/>
                <button class="btn btn-outline btn-sm" (click)="copyInviteLink()">Copy link</button>
              </div>
              <div class="muted small" style="margin-top:4px;">Link expires in 48h. Share this with {{ inviteLink()!.email }} to set their password.</div>
            }
          </div>

          @if (pendingInvitations().length > 0) {
            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Pending Invitations</div>
                  <div class="card-sub">{{ pendingInvitations().length }} awaiting acceptance</div>
                </div>
              </div>
              <div style="padding:0 0 8px;">
                @for (inv of pendingInvitations(); track inv.id) {
                  <div class="inv-row">
                    <ap-icon name="mail" [size]="13" style="opacity:.4"/>
                    <div class="inv-info">
                      <div class="strong">{{ inv.email }}</div>
                      <div class="muted small">{{ inv.role | titlecase }} · invited {{ inv.created_at | date:'MMM d' }}</div>
                    </div>
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger);" (click)="revokeInvite(inv.id)">Revoke</button>
                  </div>
                }
              </div>
            </div>
          }

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Team Members</div>
                <div class="card-sub">{{ team().length }} member{{ team().length !== 1 ? 's' : '' }}</div>
              </div>
            </div>

            @if (loadingTeam()) {
              <div class="row gap-sm" style="padding:24px;justify-content:center;">
                <ap-spinner/> <span class="muted small">Loading team…</span>
              </div>
            } @else {
              <ap-sortable-table [columns]="teamColumns" [rows]="team()">
                <ng-template apCellTpl="name" let-r>
                  <div class="row gap-sm">
                    <ap-avatar [initials]="r.initials"/>
                    <div>
                      <div class="strong">{{ r.name }}</div>
                      <div class="muted small">Since {{ r.joined | slice:0:10 }}</div>
                    </div>
                  </div>
                </ng-template>
                <ng-template apCellTpl="role" let-r>
                  <select class="inp" style="width:120px;padding:6px 10px;font-size:12px;" [ngModel]="r.role" (ngModelChange)="updateRole(r.id, $event)">
                    <option>Admin</option>
                    <option>Manager</option>
                    <option>Viewer</option>
                  </select>
                </ng-template>
                <ng-template apCellTpl="actions" let-r>
                  <button class="btn btn-danger btn-sm" (click)="removeMember(r.id)"><ap-icon name="trash" [size]="12"/> {{ t('common.remove') }}</button>
                </ng-template>
              </ap-sortable-table>
            }
          </div>
        </div>
      }

      @if (tab() === 'integrations') {
        <div class="grid-3">
          @for (itg of integrations; track itg.id) {
            <div class="card card-pad">
              <div class="row" style="justify-content:space-between;margin-bottom:8px;">
                <div class="strong" style="font-size:15px;color:var(--green);">{{ itg.name }}</div>
                <ap-pill [kind]="itg.connected ? 'green' : 'grey'">{{ itg.connected ? t('common.connected') : t('common.disconnected') }}</ap-pill>
              </div>
              <div class="muted small mb-16">{{ itg.desc }}</div>
              <div class="muted small mb-16 mono" style="padding:8px 10px;background:var(--bg);border-radius:6px;font-size:11px;">
                {{ itg.meta }}
              </div>
              <button class="btn" [class.btn-outline]="itg.connected" [class.btn-gold]="!itg.connected"
                style="width:100%;" (click)="toggleIntegration(itg.id)">
                {{ itg.connected ? t('common.manage') : t('common.connect') }}
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .inp-error { border-color: var(--danger) !important; }
    .inp-msg-error { font-size: 11px; color: var(--danger); margin-top: 4px; }
    .btn-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
    .btn-danger:hover { background: #b91c1c; border-color: #b91c1c; }
    .invite-link-box { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-top: 12px; background: rgba(2,70,56,.06); border: 1px solid rgba(2,70,56,.15); border-radius: 8px; flex-wrap: wrap; }
    .inv-email { font-weight: 700; font-size: 13px; color: var(--green); }
    .inv-link-input { flex: 1; min-width: 180px; border: none; background: transparent; font-size: 12px; font-family: monospace; color: var(--ink-2); cursor: pointer; outline: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .inv-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border,#e4e4e7); }
    .inv-info { flex: 1; }
  `],
})
export class SettingsComponent implements OnInit {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly settingsApi = inject(AdminSettingsService);
  private readonly auth = inject(AuthService);
  private readonly storeConfig = inject(StoreConfigService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly tabs: { key: Tab; labelKey: string }[] = [
    { key: 'general',      labelKey: 'settings.tab.general' },
    { key: 'team',         labelKey: 'settings.tab.team' },
    { key: 'integrations', labelKey: 'settings.tab.integrations' },
  ];

  readonly tab = signal<Tab>('general');

  // ── Store settings ────────────────────────────────────────────────────────
  readonly loadingStore = signal(true);
  readonly savingGeneral = signal(false);
  readonly storeNameError = signal(false);

  readonly storeName = signal('Elite Collection');
  readonly currency  = signal('QAR');
  readonly timezone  = signal('Asia/Qatar');
  readonly language  = signal('en');
  readonly lowStockThreshold = signal(this.storeConfig.lowStockThreshold());

  // Snapshot for discard
  private _storeSnapshot = { storeName: 'Elite Collection', currency: 'QAR', timezone: 'Asia/Qatar', language: 'en', lowStockThreshold: 8 };

  readonly isDirty = computed(() =>
    this.storeName() !== this._storeSnapshot.storeName ||
    this.currency()  !== this._storeSnapshot.currency  ||
    this.timezone()  !== this._storeSnapshot.timezone  ||
    this.language()  !== this._storeSnapshot.language  ||
    this.lowStockThreshold() !== this._storeSnapshot.lowStockThreshold
  );

  // ── Team ──────────────────────────────────────────────────────────────────
  readonly loadingTeam = signal(true);
  readonly team = signal<TeamMember[]>([]);
  readonly invite = signal({ name: '', email: '', role: 'Manager' as 'Admin' | 'Manager' | 'Viewer' });
  readonly inviting = signal(false);
  readonly pendingInvitations = signal<Invitation[]>([]);
  readonly inviteLink = signal<{ email: string; link: string } | null>(null);

  // ── Integrations ─────────────────────────────────────────────────────────
  readonly integrations = INTEGRATIONS;

  readonly canInvite = computed(() => {
    const f = this.invite();
    return f.name.trim().length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  });

  readonly teamColumns: TableColumn<TeamMember>[] = [
    { key: 'name',    label: 'Name' },
    { key: 'email',   label: 'Email' },
    { key: 'role',    label: 'Role',    noSort: true },
    { key: 'actions', label: '',        noSort: true, align: 'right' },
  ];

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadStore(), this.loadTeam()]);
  }

  private async loadStore(): Promise<void> {
    try {
      const s = await this.settingsApi.getStore();
      const name = s.store_name || s.name || 'Elite Collection';
      const cur = s.currency || 'QAR';
      const tz  = s.timezone || 'Asia/Qatar';
      this.storeName.set(name);
      this.currency.set(cur);
      this.timezone.set(tz);
      this._storeSnapshot = { storeName: name, currency: cur, timezone: tz, language: 'en', lowStockThreshold: this.storeConfig.lowStockThreshold() };
    } catch {
      // keep defaults
    } finally {
      this.loadingStore.set(false);
    }
  }

  private async loadTeam(): Promise<void> {
    try {
      const [list, invites] = await Promise.all([
        this.settingsApi.getTeam(),
        this.settingsApi.getInvitations().catch(() => [] as Invitation[]),
      ]);
      this.team.set(
        list
          .filter((m: TeamMember & { status?: string }) => m.status !== 'removed')
          .map((m) => ({
            ...m,
            role: capitalizeRole(m.role),
            joined: String((m as any).joined || ''),
          })),
      );
      this.pendingInvitations.set(invites);
    } catch {
      this.team.set([]);
    } finally {
      this.loadingTeam.set(false);
    }
  }

  // ── Store settings ────────────────────────────────────────────────────────

  discardGeneral(): void {
    this.storeName.set(this._storeSnapshot.storeName);
    this.currency.set(this._storeSnapshot.currency);
    this.timezone.set(this._storeSnapshot.timezone);
    this.language.set(this._storeSnapshot.language);
    this.lowStockThreshold.set(this._storeSnapshot.lowStockThreshold);
    this.storeNameError.set(false);
  }

  async saveGeneral(): Promise<void> {
    if (this.savingGeneral()) return;
    if (!this.storeName().trim()) {
      this.storeNameError.set(true);
      return;
    }
    this.storeNameError.set(false);
    this.savingGeneral.set(true);
    try {
      await this.settingsApi.patchStore({
        name: this.storeName().trim(),
        storeName: this.storeName().trim(),
        currency: this.currency(),
        timezone: this.timezone(),
        language: this.language(),
      });
      this.storeConfig.setLowStockThreshold(this.lowStockThreshold());
      this._storeSnapshot = {
        storeName: this.storeName(),
        currency: this.currency(),
        timezone: this.timezone(),
        language: this.language(),
        lowStockThreshold: this.lowStockThreshold(),
      };
      this.toast.success('Store settings saved', 'Changes are live across the storefront');
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.savingGeneral.set(false);
    }
  }

  // ── Team ──────────────────────────────────────────────────────────────────

  setInvite<K extends 'name' | 'email' | 'role'>(k: K, v: string): void {
    this.invite.update((f) => ({ ...f, [k]: v as never }));
  }

  async inviteMember(): Promise<void> {
    return this.sendInvite();
  }

  async sendInvite(): Promise<void> {
    const f = this.invite();
    if (!f.email.includes('@') || this.inviting()) return;
    this.inviting.set(true);
    this.inviteLink.set(null);
    try {
      const result = await this.settingsApi.sendInvitation({ email: f.email.trim(), role: f.role });
      this.invite.update(v => ({ ...v, email: '' }));
      this.inviteLink.set({ email: result.email, link: result.inviteLink });
      const invites = await this.settingsApi.getInvitations().catch(() => this.pendingInvitations());
      this.pendingInvitations.set(invites);
      this.toast.success('Invitation created', `Link expires in 48h · ${result.email}`);
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.inviting.set(false);
    }
  }

  copyInviteLink(): void {
    const link = this.inviteLink()?.link;
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      this.toast.success('Link copied', 'Share this with the invitee to set their password.');
    }).catch(() => {});
  }

  async revokeInvite(id: string): Promise<void> {
    try {
      await this.settingsApi.revokeInvitation(id);
      this.pendingInvitations.update(list => list.filter(i => i.id !== id));
      this.toast.success('Invitation revoked');
    } catch { /* Global interceptor */ }
  }

  async updateRole(id: string, role: 'Admin' | 'Manager' | 'Viewer'): Promise<void> {
    const member = this.team().find((m) => m.id === id);
    if (!member || member.role === role) return;
    const previous = member.role;
    this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role } : m)));
    try {
      await this.settingsApi.patchTeam(id, { role: role.toLowerCase() });
      this.toast.success('Role updated', `${member.name} is now ${role}`, {
        label: 'Undo',
        run: () => {
          this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role: previous } : m)));
          void this.settingsApi.patchTeam(id, { role: previous.toLowerCase() });
        },
      });
    } catch {
      this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role: previous } : m)));
    }
  }

  async removeMember(id: string): Promise<void> {
    if (id === this.auth.user()?.id) {
      this.toast.error(this.t('settings.team.cannotRemoveSelf'));
      return;
    }
    const member = this.team().find((m) => m.id === id);
    if (!member) return;
    const ok = await this.confirm.ask({
      title: `Remove ${member.name}?`,
      message: `${member.email} will lose access to the admin portal immediately. They will need a new invitation to return.`,
      confirmLabel: 'Remove access',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    this.team.update((t) => t.filter((m) => m.id !== id));
    try {
      await this.settingsApi.patchTeam(id, { status: 'removed' });
      this.toast.success('Team member removed', `${member.name} can no longer sign in`, {
        label: 'Undo',
        run: () => {
          this.team.update((t) => [...t, member]);
          void this.settingsApi.patchTeam(id, { status: 'active' });
        },
      });
    } catch {
      this.team.update((t) => [...t, member]);
    }
  }

  // ── Integrations ─────────────────────────────────────────────────────────

  toggleIntegration(id: string): void {
    const itg = this.integrations.find((i) => i.id === id);
    if (!itg) return;
    if (itg.connected) {
      this.toast.info(`${itg.name}`, 'Manage screen would open here.');
    } else {
      this.toast.info(`Connecting to ${itg.name}…`, 'You will be redirected to authorize.');
    }
  }
}

function capitalizeRole(role: string): 'Admin' | 'Manager' | 'Viewer' {
  const r = String(role || 'viewer');
  return (r.charAt(0).toUpperCase() + r.slice(1).toLowerCase()) as 'Admin' | 'Manager' | 'Viewer';
}
