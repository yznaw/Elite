import { Component, ElementRef, HostListener, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent, IconName } from '../icons/icon.component';
import { NotificationService, NotifKind } from '../../services/notification.service';
import { I18nService } from '../../services/i18n.service';

const KIND_ICON: Record<NotifKind, IconName> = {
  order: 'orders',
  stock: 'catalog',
  sync: 'sync',
  system: 'settings',
  customer: 'users',
};

const KIND_COLOR: Record<NotifKind, string> = {
  order: 'var(--green)',
  stock: 'var(--warning)',
  sync: 'var(--success)',
  system: 'var(--muted)',
  customer: 'var(--gold)',
};

@Component({
    selector: 'ap-notification-dropdown',
    imports: [CommonModule, IconComponent],
    template: `
    <div class="notif-wrap">
      <!-- Bell trigger -->
      <button class="icon-btn notif-bell" (click)="toggle()" [attr.title]="t('topbar.notifications')"
              [attr.aria-label]="t('topbar.notifications')" [attr.aria-expanded]="open()">
        <ap-icon name="bell" [size]="16"/>
        @if (notifs.unreadCount() > 0) {
          <span class="notif-badge">{{ notifs.unreadCount() > 9 ? '9+' : notifs.unreadCount() }}</span>
        }
      </button>

      <!-- Dropdown -->
      @if (open()) {
        <div class="notif-dropdown" role="dialog" [attr.aria-label]="t('notif.title')">
          <div class="notif-head">
            <span class="notif-head-title">{{ t('notif.title') }}</span>
          </div>

          <div class="notif-list">
            @if (!notifs.loaded()) {
              @for (i of [1, 2, 3]; track i) {
                <div class="notif-item notif-skel" aria-hidden="true">
                  <div class="notif-icon skel-block"></div>
                  <div class="notif-content"><div class="skel-line w60"></div><div class="skel-line w40"></div></div>
                </div>
              }
            } @else if (notifs.items().length === 0) {
              <div class="notif-empty">
                <ap-icon name="bell" [size]="20"/>
                <div>{{ t('notif.emptyOrders') }}</div>
              </div>
            }
            @for (n of notifs.items(); track n.id) {
              <button type="button" class="notif-item" [class.unread]="unreadAtOpen().has(n.id)" (click)="onItemClick(n.route)">
                <div class="notif-icon" [style.background]="kindColor(n.kind)">
                  <ap-icon [name]="kindIcon(n.kind)" [size]="12"/>
                </div>
                <div class="notif-content">
                  <div class="notif-item-title">{{ n.title }}</div>
                  <div class="notif-item-body">{{ n.body }}</div>
                  <div class="notif-item-time">{{ notifs.timeAgo(n.ts) }}</div>
                </div>
              </button>
            }
          </div>

          <!-- Alert preferences for this browser -->
          <div class="notif-foot">
            <label class="notif-pref">
              <span>{{ t('notif.sound') }}</span>
              <input type="checkbox" class="notif-switch" [checked]="notifs.soundEnabled()"
                     (change)="notifs.setSound($any($event.target).checked)"/>
            </label>
            <div class="notif-pref">
              <span>{{ t('notif.desktop') }}</span>
              @switch (notifs.desktopState()) {
                @case ('granted') { <span class="notif-state on">{{ t('notif.desktop.on') }}</span> }
                @case ('denied') { <span class="notif-state off" [attr.title]="t('notif.desktop.blockedHelp')">{{ t('notif.desktop.blocked') }}</span> }
                @case ('unsupported') { <span class="notif-state off">{{ t('notif.desktop.unsupported') }}</span> }
                @default { <button type="button" class="notif-enable" (click)="notifs.enableDesktopAlerts()">{{ t('notif.desktop.enable') }}</button> }
              }
            </div>
            @if (notifs.desktopState() === 'denied') {
              <div class="notif-hint">{{ t('notif.desktop.blockedHelp') }}</div>
            }
            <div class="notif-hint">{{ t('notif.openTabHint') }}</div>
          </div>
        </div>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    .notif-wrap { position: relative; }

    .notif-bell { position: relative; }
    .notif-badge {
      position: absolute;
      top: 4px; inset-inline-end: 2px;
      min-width: 16px; height: 16px;
      padding: 0 4px;
      background: var(--danger, #ef4444);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      border-radius: 99px;
      border: 2px solid var(--surface);
      pointer-events: none;
    }

    .notif-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      inset-inline-end: 0;
      width: 380px;
      max-height: 560px;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      z-index: 1000;
      overflow: hidden;
      animation: notifSlide 0.18s ease;
    }
    @keyframes notifSlide {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .notif-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-2);
    }
    .notif-head-title {
      font-weight: 600;
      font-size: 14px;
      font-family: var(--ff-disp);
      color: var(--green);
    }
    .notif-mark-all {
      background: none; border: none; cursor: pointer;
      font: inherit; font-size: 11px; font-weight: 600;
      color: var(--gold);
      padding: 4px 10px;
      border-radius: 6px;
      transition: background 0.12s;
    }
    .notif-mark-all:hover { background: var(--bg); }

    .notif-list {
      overflow-y: auto;
      max-height: 360px;
    }

    .notif-item {
      width: 100%;
      background: none;
      border: 0;
      border-bottom: 1px solid var(--border-2);
      font: inherit;
      text-align: start;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 18px;
      cursor: pointer;
      transition: background 0.12s;
      position: relative;
    }
    .notif-item:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
    .notif-item:last-child { border-bottom: none; }
    .notif-item:hover { background: var(--bg); }
    .notif-item.unread { background: rgba(2, 70, 56, 0.03); }
    .notif-item.unread::before {
      content: '';
      position: absolute;
      top: 50%; inset-inline-start: 6px;
      transform: translateY(-50%);
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--gold);
    }

    .notif-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .notif-content { flex: 1; min-width: 0; }
    .notif-item-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--ink);
      margin-bottom: 2px;
    }
    .notif-item-body {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .notif-item-time {
      font-size: 10px;
      color: var(--muted);
      margin-top: 4px;
      opacity: 0.7;
    }


    .notif-empty {
      padding: 36px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }

    .notif-skel { cursor: default; }
    .skel-block { background: var(--border-2) !important; }
    .skel-line { height: 10px; border-radius: 4px; background: var(--border-2); margin: 4px 0 8px; }
    .skel-line.w60 { width: 60%; }
    .skel-line.w40 { width: 40%; }

    .notif-foot {
      border-top: 1px solid var(--border-2);
      padding: 10px 18px 12px;
      display: grid;
      gap: 8px;
      background: var(--bg);
    }
    .notif-pref {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
      color: var(--ink);
      min-height: 28px;
    }
    .notif-switch { width: 16px; height: 16px; accent-color: var(--green); cursor: pointer; }
    .notif-enable {
      background: var(--green);
      color: #fff;
      border: 0;
      border-radius: 6px;
      padding: 6px 12px;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .notif-enable:active { transform: translateY(1px); }
    .notif-state { font-size: 11px; font-weight: 600; }
    .notif-state.on { color: var(--success, var(--green)); }
    .notif-state.off { color: var(--muted); }
    .notif-hint { font-size: 11px; line-height: 1.5; color: var(--muted); }

    @media (max-width: 480px) {
      .notif-dropdown {
        width: calc(100vw - 32px);
        inset-inline-end: -60px;
      }
    }
  `]
})
export class NotificationDropdownComponent {
  readonly notifs = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly elRef = inject(ElementRef);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly open = signal(false);
  /** What was unread when the panel opened; stays highlighted until it closes. */
  readonly unreadAtOpen = signal<ReadonlySet<number>>(new Set());

  kindIcon = (k: NotifKind): IconName => KIND_ICON[k];
  kindColor = (k: NotifKind): string => KIND_COLOR[k];

  toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.unreadAtOpen.set(new Set(this.notifs.items().filter((n) => !n.read).map((n) => n.id)));
    this.open.set(true);
    void this.notifs.markAllRead();
  }

  onItemClick(route?: string): void {
    this.open.set(false);
    if (route) void this.router.navigateByUrl(route);
  }

  /** Close on outside click */
  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (this.open() && !this.elRef.nativeElement.contains(e.target)) {
      this.open.set(false);
    }
  }

  /** Close on Escape */
  @HostListener('document:keydown.escape')
  onEsc(): void { this.open.set(false); }
}
