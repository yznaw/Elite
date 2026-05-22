import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent, IconName } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { SidebarToggleService } from '../sidebar-toggle.service';

interface NavLink {
  path: string;
  labelKey: string;
  subKey: string;
  icon: IconName;
  exact?: boolean;
}

@Component({
  selector: 'ap-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent, AvatarComponent],
  template: `
    @if (toggle.open()) {
      <div class="sidebar-backdrop" (click)="toggle.close()" aria-hidden="true"></div>
    }

    <aside class="sidebar sidebar-host" [class.open]="toggle.open()">
      <div class="sidebar-brand">
        <div class="brand-mark">{{ t('brand.name') }}</div>
        <div class="brand-sub">{{ t('brand.tagline') }}</div>
      </div>

      <div class="nav-section-label"><span class="label-text">{{ t('nav.section.workspace') }}</span></div>

      <div class="col gap-sm" style="position:relative;z-index:1;">
        @for (n of links; track n.path) {
          <a
            [routerLink]="n.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: !!n.exact }"
            class="nav-item"
            (click)="toggle.close()"
          >
            <ap-icon [name]="n.icon" [size]="18"/>
            <div>
              <span>{{ t(n.labelKey) }}</span>
              <div class="label-sub">{{ t(n.subKey) }}</div>
            </div>
          </a>
        }
      </div>

      <div class="sidebar-footer">
        @if (user(); as u) {
          <div class="sidebar-user">
            <ap-avatar [initials]="u.initials"/>
            <div class="sidebar-user-meta">
              <div class="strong sidebar-user-name">{{ u.name }}</div>
              <div class="sidebar-user-sub">
                <span class="sidebar-user-role">{{ t('settings.role.' + u.role) }}</span>
                <span class="sidebar-user-sep">·</span>
                <span class="sidebar-user-email" [attr.title]="u.email">{{ u.email }}</span>
              </div>
            </div>
            <button
              class="sidebar-logout"
              type="button"
              (click)="logout()"
              [attr.aria-label]="t('topbar.logout')"
              [attr.title]="t('topbar.logout')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        }
      </div>
    </aside>
  `,
  styles: [`
    .sidebar {
      background: var(--green);
      color: #fff;
      display: flex; flex-direction: column;
      padding: 28px 16px 20px;
      border-inline-end: 1px solid rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
      height: 100vh;
    }
    .sidebar::before {
      content: '';
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at top, rgba(197, 165, 114, 0.06), transparent 60%);
      pointer-events: none;
    }
    .sidebar-brand {
      padding-block: 0 28px;
      padding-inline: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 18px;
      position: relative; z-index: 1;
    }
    .brand-mark {
      font-family: var(--ff-disp);
      font-size: 24px; font-weight: 500;
      color: var(--gold); letter-spacing: 0.18em;
    }
    html[dir='rtl'] .brand-mark { letter-spacing: 0.05em; }
    .brand-sub {
      font-size: 9px; letter-spacing: 0.32em;
      color: rgba(255, 255, 255, 0.55);
      text-transform: uppercase; margin-top: 2px;
    }
    html[dir='rtl'] .brand-sub { letter-spacing: 0; }
    .nav-section-label {
      font-size: 9px; letter-spacing: 0.18em;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      padding-inline: 12px;
      padding-block: 0 8px;
      margin-top: 6px;
      position: relative; z-index: 1;
    }
    .nav-item {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 13px; font-weight: 500;
      cursor: pointer; border: none; background: none;
      text-align: start; width: 100%;
      border-radius: 8px;
      transition: all 0.18s ease;
      position: relative; z-index: 1;
      text-decoration: none;
    }
    .nav-item:hover { background: rgba(255, 255, 255, 0.04); color: #fff; }
    .nav-item.active {
      background: linear-gradient(90deg, var(--gold-3), transparent);
      color: var(--gold);
    }
    html[dir='rtl'] .nav-item.active {
      background: linear-gradient(-90deg, var(--gold-3), transparent);
    }
    .nav-item.active::before {
      content: ''; position: absolute;
      inset-inline-start: -16px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px; height: 24px; background: var(--gold);
      border-start-end-radius: 2px;
      border-end-end-radius: 2px;
    }
    .nav-item ap-icon { flex-shrink: 0; }
    .label-sub {
      font-size: 10px; color: rgba(255, 255, 255, 0.4);
      font-weight: 400;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-top: 1px;
    }
    html[dir='rtl'] .label-sub { letter-spacing: 0; }
    .nav-item.active .label-sub { color: rgba(197, 165, 114, 0.6); }

    .sidebar-footer {
      margin-top: auto;
      padding-block: 16px 0;
      padding-inline: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      position: relative; z-index: 1;
    }
    .sidebar-user {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .sidebar-user-meta {
      flex: 1;
      min-width: 0;
    }
    .sidebar-user-name {
      font-size: 12px;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-user-sub {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.55);
      display: flex;
      gap: 4px;
      align-items: center;
      min-width: 0;
    }
    .sidebar-user-role {
      color: var(--gold);
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .sidebar-user-sep { opacity: 0.5; flex-shrink: 0; }
    .sidebar-user-email {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .sidebar-logout {
      width: 30px; height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .sidebar-logout:hover {
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.5);
      background: rgba(239, 68, 68, 0.08);
    }

    /* Compact-rail behavior at desktop tablet (icon-only) */
    @media (min-width: 1025px) and (max-width: 1180px) {
      .sidebar { padding: 22px 8px 14px; }
      .sidebar-brand { padding: 0 8px 22px; }
      .nav-item span:not(.label-sub),
      .label-sub,
      .brand-sub,
      .nav-section-label,
      .sidebar-user-meta {
        display: none;
      }
      .nav-item { justify-content: center; }
      .sidebar-user { justify-content: center; }
    }
  `],
})
export class SidebarComponent {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly toggle = inject(SidebarToggleService);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly user = this.auth.user;

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      this.toast.info(this.t('login.signedOut'));
    } finally {
      this.router.navigate(['/login']);
    }
  }

  readonly links: NavLink[] = [
    { path: '/dashboard',  labelKey: 'nav.dashboard',  subKey: 'nav.dashboard.sub',  icon: 'dash' },
    { path: '/catalog',    labelKey: 'nav.catalog',    subKey: 'nav.catalog.sub',    icon: 'catalog' },
    { path: '/collections',labelKey: 'nav.collections',subKey: 'nav.collections.sub',icon: 'catalog' },
    { path: '/media',      labelKey: 'nav.media',      subKey: 'nav.media.sub',      icon: 'media' },
    { path: '/storefront', labelKey: 'nav.storefront', subKey: 'nav.storefront.sub', icon: 'store' },
    { path: '/orders',     labelKey: 'nav.orders',     subKey: 'nav.orders.sub',     icon: 'orders' },
    { path: '/customers',  labelKey: 'nav.customers',  subKey: 'nav.customers.sub',  icon: 'users' },
    { path: '/analytics',  labelKey: 'nav.analytics',  subKey: 'nav.analytics.sub',  icon: 'chart' },
{ path: '/reference',  labelKey: 'nav.reference',  subKey: 'nav.reference.sub',  icon: 'list' },
    { path: '/settings',   labelKey: 'nav.settings',   subKey: 'nav.settings.sub',   icon: 'settings' },
  ];

  private readonly router = inject(Router);

  constructor() {
    // Close the mobile drawer on every successful navigation
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.toggle.close());
  }
}
