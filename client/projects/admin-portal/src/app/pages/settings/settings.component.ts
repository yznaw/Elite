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
import { PosService, PosBusinessProfile } from '../../services/pos.service';
import { INTEGRATIONS } from '../../data/mock';
import { TeamMember, TeamMemberRole } from '../../models';
import { rolePillKind, PillInfo } from '../../shared/pill/status-pill';

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
              <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
            </div>
          } @else {
            <div class="grid-2">
              <div>
                <label class="lbl">{{ t('settings.storeName') }}</label>
                <input class="inp" [ngModel]="storeName()" (ngModelChange)="storeName.set($event)"
                       [placeholder]="t('settings.storeName.placeholder')" [class.inp-error]="storeNameError()"/>
                @if (storeNameError()) {
                  <div class="inp-msg-error">{{ t('settings.storeNameRequired') }}</div>
                }
              </div>
              <div>
                <label class="lbl">{{ t('settings.currency') }}</label>
                <select class="inp" [ngModel]="currency()" (ngModelChange)="currency.set($event)">
                  <option value="QAR">{{ t('settings.currency.qar') }}</option>
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

        <div class="card card-pad mt-24" style="max-width:680px;">
          <div class="card-header mb-16">
            <div>
              <div class="card-title">{{ t('settings.receiptProfile') }}</div>
              <div class="card-sub">{{ t('settings.receiptProfile.sub') }}</div>
            </div>
          </div>

          @if (loadingReceiptProfile()) {
            <div class="row gap-sm" style="padding:24px 0;justify-content:center;">
              <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
            </div>
          } @else if (!canEditReceiptProfile()) {
            <div class="muted small">{{ t('settings.receiptProfile.readOnly') }}</div>
            <div class="col gap-sm mt-16">
              <div><span class="muted small">{{ t('settings.receiptProfile.tradeNameEn') }}:</span> {{ receiptProfile().tradeNameEn || '—' }}</div>
              <div><span class="muted small">{{ t('settings.receiptProfile.tradeNameAr') }}:</span> {{ receiptProfile().tradeNameAr || '—' }}</div>
            </div>
          } @else {
            <div class="grid-2">
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.tradeNameEn') }}</label>
                <input class="inp" [ngModel]="receiptProfile().tradeNameEn" (ngModelChange)="setReceiptProfile('tradeNameEn', $event)"/>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.tradeNameAr') }}</label>
                <input class="inp" dir="rtl" [ngModel]="receiptProfile().tradeNameAr" (ngModelChange)="setReceiptProfile('tradeNameAr', $event)"/>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.addressEn') }}</label>
                <input class="inp" [ngModel]="receiptProfile().addressEn" (ngModelChange)="setReceiptProfile('addressEn', $event)"/>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.addressAr') }}</label>
                <input class="inp" dir="rtl" [ngModel]="receiptProfile().addressAr" (ngModelChange)="setReceiptProfile('addressAr', $event)"/>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.phone') }}</label>
                <input class="inp" type="tel" placeholder="+974 XXXX XXXX" [ngModel]="receiptProfile().phone" (ngModelChange)="setReceiptProfile('phone', $event)"/>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.crLicense') }}</label>
                <input class="inp" [ngModel]="receiptProfile().crLicenseNumber" (ngModelChange)="setReceiptProfile('crLicenseNumber', $event)"/>
              </div>
            </div>

            <div class="grid-2 mt-16">
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.returnPolicyEn') }}</label>
                <textarea class="inp" rows="2" [ngModel]="receiptProfile().returnPolicyEn" (ngModelChange)="setReceiptProfile('returnPolicyEn', $event)"></textarea>
              </div>
              <div>
                <label class="lbl">{{ t('settings.receiptProfile.returnPolicyAr') }}</label>
                <textarea class="inp" dir="rtl" rows="2" [ngModel]="receiptProfile().returnPolicyAr" (ngModelChange)="setReceiptProfile('returnPolicyAr', $event)"></textarea>
              </div>
            </div>

            <div class="muted small mt-16">{{ t('settings.receiptProfile.disclaimer') }}</div>

            <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
              <button class="btn btn-gold" [disabled]="savingReceiptProfile() || !receiptProfile().tradeNameEn.trim()" (click)="saveReceiptProfile()">
                @if (savingReceiptProfile()) { <ap-spinner [size]="12"/> {{ t('common.saving') }} }
                @else { {{ t('common.save') }} }
              </button>
            </div>
          }
        </div>

        @if (canSetOwnManagerPin()) {
          <div class="card card-pad mt-24" style="max-width:680px;">
            <div class="card-header mb-16">
              <div>
                <div class="card-title">{{ t('settings.managerPin.title') }}</div>
                <div class="card-sub">{{ t('settings.managerPin.sub') }}</div>
              </div>
            </div>

            <div class="grid-2">
              <div>
                <label class="lbl">{{ t('settings.managerPin.newPin') }}</label>
                <input class="inp" type="password" inputmode="numeric" maxlength="8"
                       [ngModel]="myManagerPin()" (ngModelChange)="myManagerPin.set($event)"
                       placeholder="4-8 digits"/>
              </div>
            </div>

            <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
              <button class="btn btn-gold" [disabled]="savingMyManagerPin() || !isValidPinFormat(myManagerPin())" (click)="saveMyManagerPin()">
                @if (savingMyManagerPin()) { <ap-spinner [size]="12"/> {{ t('common.saving') }} }
                @else { {{ t('settings.managerPin.save') }} }
              </button>
            </div>
            <div class="muted small mt-16">{{ t('settings.managerPin.hint') }}</div>
          </div>
        }

        @if (canManageRegisters()) {
          <div class="card card-pad mt-24" style="max-width:680px;">
            <div class="card-header mb-16">
              <div>
                <div class="card-title">{{ t('settings.registers.title') }}</div>
                <div class="card-sub">{{ t('settings.registers.sub') }}</div>
              </div>
            </div>

            <div class="grid-2">
              <div>
                <label class="lbl">{{ t('settings.registers.nameLabel') }}</label>
                <input class="inp" [ngModel]="newRegisterName()" (ngModelChange)="newRegisterName.set($event)"
                       [placeholder]="t('settings.registers.namePlaceholder')"/>
              </div>
            </div>

            <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
              <button class="btn btn-gold" [disabled]="generatingRegisterToken() || !newRegisterName().trim()" (click)="generateRegisterToken()">
                @if (generatingRegisterToken()) { <ap-spinner [size]="12"/> {{ t('settings.registers.generating') }} }
                @else { {{ t('settings.registers.generate') }} }
              </button>
            </div>

            @if (registerToken()) {
              <div class="invite-link-box">
                <ap-icon name="link" [size]="13"/>
                <input class="inv-link-input" [value]="registerToken()" readonly (click)="copyRegisterToken()"/>
                <button class="btn btn-outline btn-sm" (click)="copyRegisterToken()">{{ t('settings.registers.copyCode') }}</button>
              </div>
              <div class="muted small" style="margin-top:4px;">{{ t('settings.registers.expiry') }}</div>
            }
          </div>
        }
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
                <label class="lbl">{{ t('settings.role') }}</label>
                <select class="inp" [ngModel]="invite().role" (ngModelChange)="setInvite('role', $event)">
                  <option value="Admin">{{ t('settings.role.admin') }}</option>
                  <option value="Manager">{{ t('settings.role.manager') }}</option>
                  <option value="Cashier">{{ t('settings.role.cashier') }}</option>
                  <option value="Viewer">{{ t('settings.role.viewer') }}</option>
                </select>
                @if (invite().role === 'Cashier') {
                  <div class="muted small" style="margin-top:6px;">{{ t('settings.role.cashier.hint') }}</div>
                }
              </div>
            </div>
            <div class="row gap-sm" style="flex-wrap:wrap;">
              <button class="btn btn-gold" [disabled]="inviting() || !invite().email.includes('@')" (click)="sendInvite()">
                @if (inviting()) { <ap-spinner [size]="12"/> {{ t('settings.team.sending') }} }
                @else { <ap-icon name="mail" [size]="14"/> {{ t('settings.team.sendInvitation') }} }
              </button>
            </div>
            @if (inviteLink()) {
              <div class="invite-link-box">
                <ap-icon name="link" [size]="13"/>
                <span class="inv-email">{{ inviteLink()!.email }}</span>
                <span class="muted small">·</span>
                <input class="inv-link-input" [value]="inviteLink()!.link" readonly (click)="copyInviteLink()"/>
                <button class="btn btn-outline btn-sm" (click)="copyInviteLink()">{{ t('settings.team.copyLink') }}</button>
              </div>
              <div class="muted small" style="margin-top:4px;">{{ t('settings.team.linkExpiry') }}</div>
            }
          </div>

          @if (pendingInvitations().length > 0) {
            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">{{ t('settings.team.pendingTitle') }}</div>
                  <div class="card-sub">{{ pendingInvitations().length }} {{ t('settings.team.awaitingAcceptance') }}</div>
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
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger);" (click)="revokeInvite(inv.id)">{{ t('settings.team.revoke') }}</button>
                  </div>
                }
              </div>
            </div>
          }

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">{{ t('settings.team.membersTitle') }}</div>
                <div class="card-sub">{{ team().length }} {{ team().length === 1 ? t('settings.team.memberCount.one') : t('settings.team.memberCount.many') }}</div>
              </div>
            </div>

            @if (loadingTeam()) {
              <div class="row gap-sm" style="padding:24px;justify-content:center;">
                <ap-spinner/> <span class="muted small">{{ t('settings.team.loading') }}</span>
              </div>
            } @else {
              <ap-sortable-table [columns]="teamColumns" [rows]="team()">
                <ng-template apCellTpl="name" let-r>
                  <div class="row gap-sm">
                    <ap-avatar [initials]="r.initials"/>
                    <div>
                      <div class="strong">{{ r.name }}</div>
                      <div class="muted small">{{ t('settings.team.since') }} {{ r.joined | slice:0:10 }}</div>
                    </div>
                  </div>
                </ng-template>
                <ng-template apCellTpl="role" let-r>
                  <div class="row gap-sm" style="align-items:center;">
                    <ap-pill [kind]="rolePill(r.role).kind">{{ t(rolePill(r.role).labelKey) }}</ap-pill>
                    @if (r.role !== 'Owner') {
                      <select class="inp" style="width:110px;padding:4px 8px;font-size:11px;" [ngModel]="r.role" (ngModelChange)="updateRole(r.id, $event)">
                        <option value="Admin">{{ t('settings.role.admin') }}</option>
                        <option value="Manager">{{ t('settings.role.manager') }}</option>
                        <option value="Cashier">{{ t('settings.role.cashier') }}</option>
                        <option value="Viewer">{{ t('settings.role.viewer') }}</option>
                      </select>
                    }
                  </div>
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
    /* Mobile: tabs scroll horizontally so they never wrap or truncate */
    @media (max-width: 640px) {
      .tabs { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
      .tabs::-webkit-scrollbar { display: none; }
      .tab { flex-shrink: 0; white-space: nowrap; padding: 10px 14px; }
    }
  `],
})
export class SettingsComponent implements OnInit {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly settingsApi = inject(AdminSettingsService);
  private readonly auth = inject(AuthService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly posApi = inject(PosService);

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

  // ── POS receipt/legal profile ───────────────────────────────────────────────
  readonly loadingReceiptProfile = signal(true);
  readonly savingReceiptProfile = signal(false);
  readonly canEditReceiptProfile = computed(() => this.auth.hasRole('owner', 'admin'));
  readonly receiptProfile = signal({
    tradeNameAr: '', tradeNameEn: '', addressAr: '', addressEn: '', phone: '',
    crLicenseNumber: '', returnPolicyAr: '', returnPolicyEn: '',
    footerStampAr: '', footerStampEn: '',
  });

  // ── Manager PIN ──────────────────────────────────────────────────────────
  // Only owner/admin/manager roles are ever asked for a manager PIN (cashiers
  // can't approve anything), so only those roles need a way to set one.
  readonly canSetOwnManagerPin = computed(() => this.auth.hasRole('owner', 'admin', 'manager'));
  readonly myManagerPin = signal('');
  readonly savingMyManagerPin = signal(false);

  // ── POS registers ────────────────────────────────────────────────────────
  readonly canManageRegisters = computed(() => this.auth.hasRole('owner', 'admin'));
  readonly newRegisterName = signal('');
  readonly generatingRegisterToken = signal(false);
  readonly registerToken = signal<string | null>(null);

  // ── Team ──────────────────────────────────────────────────────────────────
  readonly loadingTeam = signal(true);
  readonly team = signal<TeamMember[]>([]);
  readonly invite = signal({ name: '', email: '', role: 'Manager' as Exclude<TeamMemberRole, 'Owner'> });
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
    { key: 'name',    label: 'Name',    labelKey: 'settings.col.name' },
    { key: 'email',   label: 'Email',   labelKey: 'settings.col.email' },
    { key: 'role',    label: 'Role',    labelKey: 'settings.col.role',  noSort: true },
    { key: 'actions', label: '',                                         noSort: true, align: 'right' },
  ];

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadStore(), this.loadTeam(), this.loadReceiptProfile()]);
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

  private async loadReceiptProfile(): Promise<void> {
    try {
      const profile = await this.posApi.businessProfile();
      if (profile) {
        this.receiptProfile.set({
          tradeNameAr: profile.tradeNameAr, tradeNameEn: profile.tradeNameEn,
          addressAr: profile.addressAr, addressEn: profile.addressEn, phone: profile.phone,
          crLicenseNumber: profile.crLicenseNumber || '',
          returnPolicyAr: profile.returnPolicyAr || '', returnPolicyEn: profile.returnPolicyEn || '',
          footerStampAr: profile.footerStampAr || '', footerStampEn: profile.footerStampEn || '',
        });
      }
    } catch {
      // keep defaults — the profile may simply not exist yet
    } finally {
      this.loadingReceiptProfile.set(false);
    }
  }

  setReceiptProfile<K extends keyof ReturnType<typeof this.receiptProfile>>(key: K, value: string): void {
    this.receiptProfile.update((p) => ({ ...p, [key]: value }));
  }

  async saveReceiptProfile(): Promise<void> {
    if (this.savingReceiptProfile() || !this.canEditReceiptProfile()) return;
    if (!this.receiptProfile().tradeNameEn.trim()) return;
    this.savingReceiptProfile.set(true);
    try {
      const saved = await this.posApi.updateBusinessProfile(this.receiptProfile() as Omit<PosBusinessProfile, 'updatedAt'>);
      this.receiptProfile.set({
        tradeNameAr: saved.tradeNameAr, tradeNameEn: saved.tradeNameEn,
        addressAr: saved.addressAr, addressEn: saved.addressEn, phone: saved.phone,
        crLicenseNumber: saved.crLicenseNumber || '',
        returnPolicyAr: saved.returnPolicyAr || '', returnPolicyEn: saved.returnPolicyEn || '',
        footerStampAr: saved.footerStampAr || '', footerStampEn: saved.footerStampEn || '',
      });
      this.toast.success(this.t('settings.toast.saved'), this.t('settings.receiptProfile.saved.sub'));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.savingReceiptProfile.set(false);
    }
  }

  /**
   * Splits token creation from consumption: the POS enrollment screen mints
   * and consumes a token in the same click (self-enroll), which only works
   * if you're physically at the register. This generates one from Settings
   * so it can be relayed to someone setting up a register elsewhere — the
   * server already treats it as single-use with a 15-minute TTL.
   */
  async generateRegisterToken(): Promise<void> {
    if (this.generatingRegisterToken() || !this.canManageRegisters()) return;
    const name = this.newRegisterName().trim();
    if (!name) return;
    this.generatingRegisterToken.set(true);
    try {
      const { token } = await this.posApi.createEnrollmentToken(name);
      this.registerToken.set(token);
      this.toast.success(this.t('settings.toast.tokenCreated'), this.t('settings.toast.tokenCreated.sub'));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.generatingRegisterToken.set(false);
    }
  }

  copyRegisterToken(): void {
    const token = this.registerToken();
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      this.toast.success(this.t('settings.toast.codeCopied'));
    }).catch(() => {});
  }

  isValidPinFormat(pin: string): boolean {
    return /^\d{4,8}$/.test(pin);
  }

  async saveMyManagerPin(): Promise<void> {
    if (this.savingMyManagerPin() || !this.isValidPinFormat(this.myManagerPin())) return;
    this.savingMyManagerPin.set(true);
    try {
      await this.posApi.setManagerPin(this.myManagerPin());
      this.myManagerPin.set('');
      this.toast.success(this.t('settings.toast.managerPinSaved'), this.t('settings.toast.managerPinSaved.sub'));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.savingMyManagerPin.set(false);
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
      this.toast.success(this.t('settings.toast.saved'), this.t('settings.toast.saved.sub'));
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
      this.toast.success(this.t('settings.toast.invitationCreated'), this.t('settings.toast.invitationCreated.sub'));
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
      this.toast.success(this.t('settings.toast.linkCopied'), this.t('settings.toast.linkCopied.sub'));
    }).catch(() => {});
  }

  async revokeInvite(id: string): Promise<void> {
    try {
      await this.settingsApi.revokeInvitation(id);
      this.pendingInvitations.update(list => list.filter(i => i.id !== id));
      this.toast.success(this.t('settings.toast.invitationRevoked'));
    } catch { /* Global interceptor */ }
  }

  rolePill(role: string): PillInfo {
    return rolePillKind(role);
  }

  async updateRole(id: string, role: Exclude<TeamMemberRole, 'Owner'>): Promise<void> {
    const member = this.team().find((m) => m.id === id);
    if (!member || member.role === role) return;
    const previous = member.role;
    this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role } : m)));
    try {
      await this.settingsApi.patchTeam(id, { role: role.toLowerCase() });
      this.toast.success(this.t('settings.toast.roleUpdated'), `${member.name} ${this.t('settings.toast.roleUpdated.sub')} ${role}`, {
        label: this.t('settings.toast.undo'),
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
      title: this.t('settings.confirm.removeMember.title').replace('{name}', member.name),
      message: `${member.email} ${this.t('settings.confirm.removeMember.message')}`,
      confirmLabel: this.t('settings.confirm.removeMember.confirmLabel'),
      cancelLabel: this.t('settings.confirm.removeMember.cancelLabel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.team.update((t) => t.filter((m) => m.id !== id));
    try {
      await this.settingsApi.patchTeam(id, { status: 'removed' });
      this.toast.success(this.t('settings.toast.memberRemoved'), `${member.name} ${this.t('settings.toast.memberRemoved.sub')}`, {
        label: this.t('settings.toast.undo'),
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
      this.toast.info(`${itg.name}`, this.t('settings.integrations.manageInfo'));
    } else {
      this.toast.info(`${this.t('settings.integrations.connecting')} ${itg.name}…`, this.t('settings.integrations.connectInfo'));
    }
  }
}

function capitalizeRole(role: string): TeamMemberRole {
  const r = String(role || 'viewer');
  return (r.charAt(0).toUpperCase() + r.slice(1).toLowerCase()) as TeamMemberRole;
}
