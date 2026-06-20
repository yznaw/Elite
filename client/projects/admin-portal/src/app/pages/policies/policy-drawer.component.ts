import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { RichTextComponent } from '../../shared/rich-text/rich-text.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { AdminPoliciesService } from '../../services/admin-policies.service';
import { Policy, PolicyType } from '../../models';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const TYPE_META: Record<PolicyType, { label: string; handle: string; color: 'green' | 'blue' | 'amber' | 'red' | 'grey' | 'gold' }> = {
  privacy_policy:    { label: 'Privacy Policy',    handle: 'privacy-policy',    color: 'blue'  },
  terms_of_service:  { label: 'Terms of Service',  handle: 'terms-of-service',  color: 'green' },
  refund_policy:     { label: 'Refund Policy',      handle: 'refund-policy',     color: 'amber' },
  shipping_policy:   { label: 'Shipping Policy',    handle: 'shipping-policy',   color: 'gold'  },
  cookie_policy:     { label: 'Cookie Policy',      handle: 'cookie-policy',     color: 'grey'  },
  contact_info:      { label: 'Contact Info',       handle: 'contact',           color: 'green' },
  custom:            { label: 'Custom Page',        handle: '',                  color: 'grey'  },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface PolicyForm {
  title: string;
  handle: string;
  content: string;
  policyType: PolicyType;
  status: 'active' | 'draft';
}

const ALL_TYPES: PolicyType[] = [
  'privacy_policy', 'terms_of_service', 'refund_policy',
  'shipping_policy', 'cookie_policy', 'contact_info', 'custom',
];

@Component({
  selector: 'ap-policy-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent, SpinnerComponent, RichTextComponent, SaveBarComponent],
  template: `
    @if (open) {
      <div class="pol-backdrop" (click)="onBackdropClick($event)" aria-hidden="true"></div>
      <aside class="drawer" role="dialog" aria-modal="true" #drawerEl>

        <!-- Header — uses global .drawer-head -->
        <div class="drawer-head">
          <div class="row gap-sm" style="flex:1;min-width:0;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {{ isNew ? t('policies.new') : form().title || t('policies.new') }}
            </div>
            @if (!isNew) {
              <ap-pill [kind]="form().status === 'active' ? 'green' : 'grey'">
                {{ t('policies.status.' + form().status) }}
              </ap-pill>
            }
          </div>
          <button class="icon-btn" type="button" (click)="close()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
        </div>

        <!-- Save bar slots between head and body — uses global .save-bar-top -->
        <ap-save-bar
          [dirty]="isDirty()"
          [saving]="saveState() === 'saving'"
          [justSaved]="saveState() === 'saved'"
          [shake]="shake()"
          (saved)="save()"
          (discarded)="discard()"
        />

        <!-- Body — uses global .drawer-body -->
        <div class="drawer-body" style="padding:0;">

          <!-- 1. VISIBILITY -->
          <section class="drawer-section">
            <div class="ds-label">{{ t('policies.drawer.visibility') }}</div>
            <div class="visibility-toggle">
              <button
                type="button"
                class="vis-btn"
                [class.active]="form().status === 'active'"
                (click)="setStatus('active')"
              >
                <ap-icon name="eye" [size]="14"/>
                <div>
                  <div class="vis-btn-title">{{ t('policies.status.active') }}</div>
                  <div class="vis-btn-sub">{{ t('policies.drawer.active.desc') }}</div>
                </div>
              </button>
              <button
                type="button"
                class="vis-btn"
                [class.active]="form().status === 'draft'"
                (click)="setStatus('draft')"
              >
                <ap-icon name="eyeOff" [size]="14"/>
                <div>
                  <div class="vis-btn-title">{{ t('policies.status.draft') }}</div>
                  <div class="vis-btn-sub">{{ t('policies.drawer.draft.desc') }}</div>
                </div>
              </button>
            </div>
          </section>

          <!-- 2. PAGE DETAILS -->
          <section class="drawer-section">
            <div class="ds-label">{{ t('policies.drawer.details') }}</div>

            <!-- Policy Type -->
            <div class="field">
              <label class="field-label">{{ t('policies.drawer.type') }}</label>
              <div class="type-grid">
                @for (tp of allTypes; track tp) {
                  <button
                    type="button"
                    class="type-chip"
                    [class.selected]="form().policyType === tp"
                    (click)="selectType(tp)"
                  >
                    <ap-pill [kind]="typeMeta[tp].color">{{ t('policies.type.' + tp) }}</ap-pill>
                  </button>
                }
              </div>
              <div class="field-hint">{{ t('policies.drawer.type.hint') }}</div>
            </div>

            <!-- Title -->
            <div class="field">
              <label class="field-label" for="pol-title">{{ t('collections.title') }}</label>
              <input
                id="pol-title"
                class="inp"
                type="text"
                [ngModel]="form().title"
                (ngModelChange)="onTitleChange($event)"
                [placeholder]="t('policies.type.' + form().policyType)"
              />
            </div>

            <!-- Handle -->
            <div class="field">
              <label class="field-label" for="pol-handle">{{ t('policies.drawer.handle') }}</label>
              <div class="handle-row">
                <span class="handle-prefix">/policy/</span>
                <input
                  id="pol-handle"
                  class="inp handle-inp"
                  type="text"
                  [ngModel]="form().handle"
                  (ngModelChange)="onHandleChange($event)"
                  placeholder="privacy-policy"
                />
              </div>
              <div class="field-hint">{{ t('policies.drawer.handle.hint') }}</div>
              @if (duplicateError()) {
                <div class="field-error">{{ t('policies.duplicate.error') }}</div>
              }
            </div>
          </section>

          <!-- 3. APPEARS IN -->
          <section class="drawer-section">
            <div class="ds-label">{{ t('policies.drawer.appearsIn') }}</div>
            <div class="appears-list">
              <div class="appears-item" [class.appears-inactive]="form().status !== 'active'">
                <div class="appears-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>
                  </svg>
                </div>
                <div class="appears-body">
                  <div class="appears-title">{{ t('policies.drawer.footer.title') }}</div>
                  <div class="appears-desc">{{ t('policies.drawer.footer.desc') }}</div>
                </div>
                <div class="appears-status">
                  @if (form().status === 'active') {
                    <span class="status-dot active"></span><span class="status-txt">{{ t('policies.drawer.footer.showing') }}</span>
                  } @else {
                    <span class="status-dot draft"></span><span class="status-txt">{{ t('policies.drawer.footer.hidden') }}</span>
                  }
                </div>
              </div>

              <div class="appears-item" [class.appears-inactive]="form().status !== 'active'">
                <div class="appears-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div class="appears-body">
                  <div class="appears-title">{{ t('policies.drawer.page.title') }}</div>
                  <div class="appears-desc">
                    @if (form().handle) {
                      {{ t('policies.drawer.page.directLink') }} <span class="appears-url">/policy/{{ form().handle }}</span>
                    } @else {
                      {{ t('policies.drawer.page.setHandle') }}
                    }
                  </div>
                </div>
                <div class="appears-status">
                  @if (form().status === 'active' && form().handle) {
                    <span class="status-dot active"></span><span class="status-txt">{{ t('policies.drawer.page.live') }}</span>
                  } @else {
                    <span class="status-dot draft"></span><span class="status-txt">{{ t('policies.drawer.page.draft') }}</span>
                  }
                </div>
              </div>
            </div>
          </section>

          <!-- 4. CONTENT (was 3) -->
          <section class="drawer-section">
            <div class="ds-label">{{ t('policies.drawer.content') }}</div>

            <!-- Edit/Preview tabs -->
            <div class="content-tabs">
              <button
                type="button"
                class="content-tab"
                [class.active]="contentTab() === 'edit'"
                (click)="contentTab.set('edit')"
              >{{ t('policies.drawer.edit') }}</button>
              <button
                type="button"
                class="content-tab"
                [class.active]="contentTab() === 'preview'"
                (click)="contentTab.set('preview')"
              >{{ t('policies.drawer.preview') }}</button>
            </div>

            @if (contentTab() === 'edit') {
              <ap-rich-text
                [value]="form().content"
                (valueChange)="onContentChange($event)"
                [placeholder]="t('policies.drawer.content.hint')"
              />
            } @else {
              <div class="content-preview" [innerHTML]="previewHtml()"></div>
            }
          </section>

          <!-- 4. DANGER ZONE -->
          @if (!isNew) {
            <section class="drawer-section danger-zone">
              <div class="ds-label danger-label">{{ t('collections.section.danger') }}</div>
              <div class="danger-row">
                <div>
                  <div class="danger-title">{{ t('policies.section.danger.title') }}</div>
                  <div class="danger-desc">{{ t('policies.section.danger.desc') }}</div>
                </div>
                <button class="btn btn-danger btn-sm" type="button" (click)="deletePolicy()">
                  <ap-icon name="trash" [size]="13"/> {{ t('common.delete') }}
                </button>
              </div>
            </section>
          }

        </div><!-- /.drawer-body -->
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* ── Backdrop ────────────────────────────── */
    .pol-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.38);
      backdrop-filter: blur(2px);
      z-index: 209;
    }

    /* ── Icon btn (close) ────────────────────── */
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      background: transparent; border: 1px solid var(--border);
      border-radius: 8px; color: var(--ink-2);
      cursor: pointer; flex-shrink: 0;
      transition: all 0.15s;
    }
    .icon-btn:hover { background: var(--bg-2); color: var(--ink); border-color: var(--border-2); }

    /* ── Section ─────────────────────────────── */
    .drawer-section {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
    }
    .ds-label {
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--ink-3);
      margin-bottom: 14px;
    }

    /* ── Visibility toggle ───────────────────── */
    .visibility-toggle {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    @media (max-width: 480px) {
      .visibility-toggle { grid-template-columns: 1fr; }
    }
    .vis-btn {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px;
      background: var(--bg);
      border: 2px solid var(--border);
      border-radius: 10px;
      cursor: pointer; text-align: start;
      transition: all 0.15s;
    }
    .vis-btn:hover { border-color: var(--border-2); background: var(--bg-2); }
    .vis-btn.active {
      border-color: var(--green);
      background: rgba(var(--green-rgb, 26,77,46), 0.04);
    }
    .vis-btn ap-icon { flex-shrink: 0; margin-top: 2px; color: var(--ink-2); }
    .vis-btn.active ap-icon { color: var(--green); }
    .vis-btn-title { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.3; }
    .vis-btn-sub { font-size: 11.5px; color: var(--ink-3); margin-top: 3px; line-height: 1.4; }

    /* ── Fields ──────────────────────────────── */
    .field { margin-bottom: 16px; }
    .field:last-child { margin-bottom: 0; }
    .field-label {
      display: block; font-size: 12px; font-weight: 600;
      color: var(--ink-2); margin-bottom: 6px;
    }
    .field-hint { font-size: 11.5px; color: var(--muted); margin-top: 5px; line-height: 1.4; }
    .field-error { font-size: 11.5px; color: var(--danger); margin-top: 5px; }

    /* ── Type grid ───────────────────────────── */
    .type-grid {
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .type-chip {
      background: transparent; border: none; padding: 0;
      cursor: pointer; border-radius: 99px;
      outline-offset: 2px;
      transition: opacity 0.15s, transform 0.12s;
    }
    .type-chip:not(.selected) { opacity: 0.55; }
    .type-chip:hover { opacity: 0.85; transform: scale(1.03); }
    .type-chip.selected { opacity: 1; outline: 2px solid var(--green); }

    /* ── Handle row ──────────────────────────── */
    .handle-row {
      display: flex; align-items: center;
      border: 1px solid var(--border); border-radius: 8px;
      background: #fff;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .handle-row:focus-within {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(193,154,91,0.15);
    }
    .handle-prefix {
      padding: 0 10px;
      font-size: 12px; color: var(--muted);
      background: var(--bg); border-inline-end: 1px solid var(--border);
      white-space: nowrap; line-height: 36px;
      flex-shrink: 0;
    }
    .handle-inp {
      border: none !important; border-radius: 0 !important;
      box-shadow: none !important; flex: 1;
    }
    .handle-inp:focus { outline: none; }

    /* ── Appears in ──────────────────────────── */
    .appears-list { display: flex; flex-direction: column; gap: 8px; }
    .appears-item {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      transition: opacity 0.2s;
    }
    .appears-item.appears-inactive { opacity: 0.5; }
    .appears-icon {
      width: 32px; height: 32px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--ink-2);
    }
    .appears-body { flex: 1; min-width: 0; }
    .appears-title { font-size: 12.5px; font-weight: 600; color: var(--ink); }
    .appears-desc { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; line-height: 1.4; }
    .appears-url {
      font-family: var(--ff-mono, monospace);
      font-size: 10.5px;
      color: var(--green);
      word-break: break-all;
    }
    .appears-status {
      display: flex; align-items: center; gap: 5px;
      flex-shrink: 0;
      font-size: 11px; font-weight: 500;
    }
    .status-dot {
      width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    }
    .status-dot.active { background: #22c55e; }
    .status-dot.draft  { background: var(--border-2); }
    .status-txt { color: var(--ink-3); }

    /* ── Content tabs ────────────────────────── */
    .content-tabs {
      display: flex; gap: 4px;
      margin-bottom: 10px;
    }
    .content-tab {
      padding: 6px 14px;
      font-size: 12.5px; font-weight: 500;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ink-2);
      cursor: pointer;
      transition: all 0.15s;
    }
    .content-tab:hover { background: var(--bg-2); color: var(--ink); }
    .content-tab.active {
      background: var(--bg-2);
      border-color: var(--border);
      color: var(--ink);
    }

    /* ── Content preview ─────────────────────── */
    .content-preview {
      min-height: 160px;
      padding: 16px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px; line-height: 1.7;
      color: var(--ink);
    }
    .content-preview :global(h2),
    .content-preview :global(h3) { font-family: var(--ff-disp); margin: 12px 0 6px; color: var(--green); }
    .content-preview :global(p) { margin: 6px 0; }
    .content-preview :global(ul),
    .content-preview :global(ol) { padding-inline-start: 22px; margin: 6px 0; }
    .content-preview :global(a) { color: var(--green); text-decoration: underline; }

    /* ── Danger zone ─────────────────────────── */
    .danger-zone { border-bottom: none; }
    .danger-label { color: var(--danger); }
    .danger-row {
      display: flex; align-items: center;
      justify-content: space-between; gap: 16px;
    }
    @media (max-width: 480px) {
      .danger-row { flex-direction: column; align-items: flex-start; }
    }
    .danger-title { font-size: 13px; font-weight: 600; color: var(--ink); }
    .danger-desc { font-size: 12px; color: var(--ink-3); margin-top: 3px; }

    /* ── Mobile ──────────────────────────────── */
    @media (max-width: 640px) {
      .drawer-section { padding: 18px 16px; }
    }
  `],
})
export class PolicyDrawerComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  @Input() open = false;
  @Input() policy: Policy | null = null;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() saved       = new EventEmitter<Policy>();
  @Output() deleted     = new EventEmitter<string>();

  @ViewChild('drawerEl') drawerEl!: ElementRef<HTMLElement>;

  private readonly i18n    = inject(I18nService);
  private readonly toast   = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly svc     = inject(AdminPoliciesService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly allTypes = ALL_TYPES;
  readonly typeMeta = TYPE_META;

  readonly saveState    = signal<SaveState>('idle');
  readonly shake        = signal(false);
  readonly contentTab   = signal<'edit' | 'preview'>('edit');
  readonly duplicateError = signal(false);

  readonly form = signal<PolicyForm>({
    title: '',
    handle: '',
    content: '',
    policyType: 'privacy_policy',
    status: 'active',
  });

  private readonly original = signal<PolicyForm>({
    title: '',
    handle: '',
    content: '',
    policyType: 'privacy_policy',
    status: 'active',
  });

  readonly previewHtml = computed(() =>
    this.form().content || '<p style="color:var(--muted);font-style:italic">Nothing to preview yet.</p>',
  );

  readonly isDirty = computed(() => {
    const f = this.form();
    const o = this.original();
    return (
      f.title    !== o.title    ||
      f.handle   !== o.handle   ||
      f.content  !== o.content  ||
      f.policyType !== o.policyType ||
      f.status   !== o.status
    );
  });

  get isNew(): boolean { return !this.policy?.id; }

  private shakeTimer: ReturnType<typeof setTimeout> | null = null;
  private escListener = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  ngOnInit(): void {
    document.addEventListener('keydown', this.escListener);
  }

  ngAfterViewInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['policy'] || changes['open']) {
      if (this.open) {
        this.resetForm();
        this.contentTab.set('edit');
        this.duplicateError.set(false);
        this.saveState.set('idle');
      }
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.escListener);
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
  }

  private resetForm(): void {
    const p = this.policy;
    const f: PolicyForm = p ? {
      title:      p.title,
      handle:     p.handle,
      content:    p.content,
      policyType: p.policyType,
      status:     p.status,
    } : {
      title:      '',
      handle:     TYPE_META['privacy_policy'].handle,
      content:    '',
      policyType: 'privacy_policy',
      status:     'active',
    };
    this.form.set({ ...f });
    this.original.set({ ...f });
  }

  private patch(partial: Partial<PolicyForm>): void {
    this.form.update(f => ({ ...f, ...partial }));
    this.duplicateError.set(false);
    if (this.saveState() === 'saved') this.saveState.set('dirty');
  }

  setStatus(s: 'active' | 'draft'): void {
    this.patch({ status: s });
  }

  selectType(tp: PolicyType): void {
    const meta = TYPE_META[tp];
    const currentHandle = this.form().handle;
    const currentTitle  = this.form().title;
    const oldMeta = TYPE_META[this.form().policyType];

    const handle = (currentHandle === '' || currentHandle === oldMeta.handle)
      ? meta.handle
      : currentHandle;
    const title = (currentTitle === '' || currentTitle === this.t('policies.type.' + this.form().policyType))
      ? this.t('policies.type.' + tp)
      : currentTitle;

    this.patch({ policyType: tp, handle, title });
  }

  onTitleChange(v: string): void {
    const oldMeta = TYPE_META[this.form().policyType];
    const handle  = this.form().handle;
    const autoHandle = (handle === '' || handle === oldMeta.handle || handle === slugify(this.form().title));
    this.patch({ title: v, ...(autoHandle ? { handle: slugify(v) } : {}) });
  }

  onHandleChange(v: string): void {
    this.patch({ handle: slugify(v) });
  }

  onContentChange(v: string): void {
    this.patch({ content: v });
  }

  private triggerShake(): void {
    this.shake.set(true);
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.shakeTimer = setTimeout(() => this.shake.set(false), 500);
  }

  close(): void {
    if (this.isDirty()) { this.triggerShake(); return; }
    this.closeDrawer.emit();
  }

  discard(): void {
    this.resetForm();
    this.saveState.set('idle');
    this.duplicateError.set(false);
    this.closeDrawer.emit();
  }

  onBackdropClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('drawer-overlay')) this.close();
  }

  async save(): Promise<void> {
    const f = this.form();
    const handle = f.handle.trim()
      || TYPE_META[f.policyType].handle
      || slugify(f.title);
    if (!handle) {
      this.triggerShake();
      return;
    }

    this.saveState.set('saving');
    this.duplicateError.set(false);

    try {
      const payload = {
        title:      f.title || this.t('policies.type.' + f.policyType),
        handle,
        content:    f.content,
        policyType: f.policyType,
        status:     f.status,
      };

      const result = this.isNew
        ? await this.svc.create(payload)
        : await this.svc.update(this.policy!.id, payload);

      this.saveState.set('saved');
      this.original.set({ ...f });
      this.toast.success(this.t('policies.toast.saved'));
      this.saved.emit(result);
      setTimeout(() => {
        if (this.saveState() === 'saved') this.saveState.set('idle');
      }, 2000);
    } catch (err: unknown) {
      const msg = (err as { error?: { error?: string } })?.error?.error ?? '';
      if (msg.includes('duplicate') || msg.includes('23505') || msg.includes('already exists')) {
        this.duplicateError.set(true);
      }
      this.saveState.set('error');
      this.toast.error(this.t('policies.duplicate.error'));
    }
  }

  async deletePolicy(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title:        this.t('policies.deleteConfirm.title'),
      message:      `${this.t('policies.deleteConfirm.message')} "${this.form().title || this.form().handle}"?`,
      confirmLabel: this.t('policies.deleteConfirm.confirm'),
      variant:      'danger',
    });
    if (!confirmed) return;

    try {
      await this.svc.delete(this.policy!.id);
      this.toast.success(this.t('policies.toast.deleted'));
      this.original.set({ ...this.form() });
      this.deleted.emit(this.policy!.id);
      this.closeDrawer.emit();
    } catch {
      this.toast.error(this.t('policies.deleteError'));
    }
  }
}
