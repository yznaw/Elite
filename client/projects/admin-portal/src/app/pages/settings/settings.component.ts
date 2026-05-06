import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { INTEGRATIONS, TEAM } from '../../data/mock';
import { TeamMember } from '../../models';

type Tab = 'general' | 'team' | 'integrations';

@Component({
  selector: 'ap-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, AvatarComponent, SpinnerComponent, SortableTableComponent, CellTplDirective],
  template: `
    <div class="page-fade">
      <div class="tabs">
        @for (t of tabs; track t.key) {
          <button class="tab" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
        }
      </div>

      @if (tab() === 'general') {
        <div class="card card-pad" style="max-width:680px;">
          <div class="card-title mb-16">Store Information</div>
          <div class="grid-2">
            <div>
              <label class="lbl">Store Name</label>
              <input class="inp" value="Elite Collection"/>
            </div>
            <div>
              <label class="lbl">Currency</label>
              <select class="inp">
                <option>QAR — Qatari Riyal</option>
                <option>SAR — Saudi Riyal</option>
                <option>AED — UAE Dirham</option>
                <option>USD — US Dollar</option>
              </select>
            </div>
            <div>
              <label class="lbl">Timezone</label>
              <select class="inp">
                <option>Asia/Qatar (GMT+3)</option>
                <option>Asia/Riyadh (GMT+3)</option>
                <option>Asia/Dubai (GMT+4)</option>
                <option>UTC</option>
              </select>
            </div>
            <div>
              <label class="lbl">Default Language</label>
              <select class="inp">
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
          </div>

          <div class="mt-24">
            <label class="lbl">Logo</label>
            <div style="padding:18px;border:1px dashed var(--border);border-radius:10px;background:var(--bg);display:flex;gap:14px;align-items:center;">
              <div class="avatar lg" style="border-radius:8px;background:var(--green);color:var(--gold);font-family:var(--ff-disp);font-size:18px;">EC</div>
              <div class="grow">
                <div class="strong">elite-logo.svg</div>
                <div class="muted small">SVG · 4 KB · uploaded 2024-06-01</div>
              </div>
              <button class="btn btn-outline btn-sm"><ap-icon name="upload" [size]="12"/> Replace</button>
            </div>
          </div>

          <div class="row gap-sm mt-24" style="justify-content:flex-end;">
            <button class="btn btn-ghost" [disabled]="savingGeneral()">Discard</button>
            <button class="btn btn-primary" [disabled]="savingGeneral()" (click)="saveGeneral()">
              @if (savingGeneral()) { <ap-spinner [size]="12"/> Saving… }
              @else { Save Changes }
            </button>
          </div>
        </div>
      }

      @if (tab() === 'team') {
        <div class="col gap-lg">
          <div class="card card-pad">
            <div class="card-title mb-16">Invite Team Member</div>
            <div class="grid-2 mb-16">
              <div>
                <label class="lbl">Full Name</label>
                <input class="inp" placeholder="Yusuf Hamad" [ngModel]="invite().name" (ngModelChange)="setInvite('name', $event)"/>
              </div>
              <div>
                <label class="lbl">Email</label>
                <input class="inp" placeholder="name@elitecollection.qa" [ngModel]="invite().email" (ngModelChange)="setInvite('email', $event)"/>
              </div>
            </div>
            <div class="row gap-sm">
              <select class="inp" style="width:auto;" [ngModel]="invite().role" (ngModelChange)="setInvite('role', $event)">
                <option>Admin</option>
                <option>Manager</option>
                <option>Viewer</option>
              </select>
              <button class="btn btn-gold" [disabled]="inviting() || !canInvite()" (click)="inviteMember()">
                @if (inviting()) { <ap-spinner [size]="12"/> Sending… }
                @else { Send Invitation }
              </button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Team Members</div>
                <div class="card-sub">{{ team().length }} members · 1 admin</div>
              </div>
            </div>
            <ap-sortable-table [columns]="teamColumns" [rows]="team()">
              <ng-template apCellTpl="name" let-r>
                <div class="row gap-sm">
                  <ap-avatar [initials]="r.initials"/>
                  <div>
                    <div class="strong">{{ r.name }}</div>
                    <div class="muted small">Since {{ r.joined }}</div>
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
                <button class="btn btn-danger btn-sm" (click)="removeMember(r.id)"><ap-icon name="trash" [size]="12"/> Remove</button>
              </ng-template>
            </ap-sortable-table>
          </div>
        </div>
      }

      @if (tab() === 'integrations') {
        <div class="grid-3">
          @for (itg of integrations; track itg.id) {
            <div class="card card-pad">
              <div class="row" style="justify-content:space-between;margin-bottom:8px;">
                <div class="strong" style="font-size:15px;color:var(--green);">{{ itg.name }}</div>
                <ap-pill [kind]="itg.connected ? 'green' : 'grey'">{{ itg.connected ? 'Connected' : 'Disconnected' }}</ap-pill>
              </div>
              <div class="muted small mb-16">{{ itg.desc }}</div>
              <div class="muted small mb-16 mono" style="padding:8px 10px;background:var(--bg);border-radius:6px;font-size:11px;">
                {{ itg.meta }}
              </div>
              @if (itg.id === 'cp') {
                <label class="lbl">CSV URL</label>
                <input class="inp mb-8" value="https://cp-pos.elitecollection.qa/api/inventory.csv"/>
                <label class="lbl">Schedule</label>
                <select class="inp mb-16">
                  <option>Every hour</option>
                  <option>Every 6 hours</option>
                  <option selected>Every 12 hours</option>
                  <option>Daily</option>
                </select>
                <button class="btn btn-primary" style="width:100%;" [disabled]="cpSaving()" (click)="saveCpConfig()">
                  @if (cpSaving()) { <ap-spinner [size]="12"/> Saving… }
                  @else { Save Configuration }
                </button>
              } @else {
                <button class="btn" [class.btn-outline]="itg.connected" [class.btn-gold]="!itg.connected"
                  style="width:100%;" (click)="toggleIntegration(itg.id)">
                  {{ itg.connected ? 'Manage' : 'Connect' }}
                </button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class SettingsComponent {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'team', label: 'Team Members' },
    { key: 'integrations', label: 'Integrations' },
  ];

  readonly tab = signal<Tab>('general');
  readonly team = signal<TeamMember[]>([...TEAM]);
  readonly invite = signal({ name: '', email: '', role: 'Manager' as 'Admin' | 'Manager' | 'Viewer' });
  readonly integrations = INTEGRATIONS;

  readonly savingGeneral = signal(false);
  readonly inviting = signal(false);
  readonly cpSaving = signal(false);

  readonly canInvite = computed(() => {
    const f = this.invite();
    return f.name.trim().length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  });

  readonly teamColumns: TableColumn<TeamMember>[] = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', noSort: true },
    { key: 'actions', label: '', noSort: true, align: 'right' },
  ];

  setInvite<K extends 'name' | 'email' | 'role'>(k: K, v: string): void {
    this.invite.update((f) => ({ ...f, [k]: v as never }));
  }

  inviteMember(): void {
    const f = this.invite();
    if (!this.canInvite() || this.inviting()) return;
    this.inviting.set(true);
    setTimeout(() => {
      this.team.update((t) => [
        ...t,
        {
          id: 'T-' + (t.length + 1),
          name: f.name,
          email: f.email,
          role: f.role,
          joined: '2026-04-29',
          initials: f.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase(),
        },
      ]);
      this.invite.set({ name: '', email: '', role: 'Manager' });
      this.inviting.set(false);
      this.toast.success('Invitation sent', `${f.email} · ${f.role} role`);
    }, 900);
  }

  updateRole(id: string, role: 'Admin' | 'Manager' | 'Viewer'): void {
    const member = this.team().find((m) => m.id === id);
    if (!member || member.role === role) return;
    const previous = member.role;
    this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role } : m)));
    this.toast.success(`Role updated`, `${member.name} is now ${role}`, {
      label: 'Undo',
      run: () => this.team.update((t) => t.map((m) => (m.id === id ? { ...m, role: previous } : m))),
    });
  }

  async removeMember(id: string): Promise<void> {
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
    this.toast.success('Team member removed', `${member.name} can no longer sign in`, {
      label: 'Undo',
      run: () => this.team.update((t) => [...t, member]),
    });
  }

  saveGeneral(): void {
    if (this.savingGeneral()) return;
    this.savingGeneral.set(true);
    setTimeout(() => {
      this.savingGeneral.set(false);
      this.toast.success('Store settings saved', 'Changes are live across the storefront');
    }, 900);
  }

  saveCpConfig(): void {
    if (this.cpSaving()) return;
    this.cpSaving.set(true);
    setTimeout(() => {
      this.cpSaving.set(false);
      this.toast.success('Configuration saved', 'Counterpoint POS · CSV schedule updated');
    }, 900);
  }

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
