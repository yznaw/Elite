import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent, IconName } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { I18nService } from '../../services/i18n.service';
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
        <div class="sidebar-user">
          <ap-avatar initials="YH"/>
          <div style="min-width:0;">
            <div class="strong" style="font-size:12px;color:#fff;">Yusuf Hamad</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.5);">Admin · yusuf&#64;elite…</div>
          </div>
        </div>
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
    .sidebar-user { display: flex; gap: 10px; align-items: center; }

    /* Compact-rail behavior at desktop tablet (icon-only) */
    @media (min-width: 1025px) and (max-width: 1180px) {
      .sidebar { padding: 22px 8px 14px; }
      .sidebar-brand { padding: 0 8px 22px; }
      .nav-item span:not(.label-sub),
      .label-sub,
      .brand-sub,
      .nav-section-label,
      .sidebar-user > div:not(.avatar) {
        display: none;
      }
      .nav-item { justify-content: center; }
    }
  `],
})
export class SidebarComponent {
  private readonly i18n = inject(I18nService);
  readonly toggle = inject(SidebarToggleService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly links: NavLink[] = [
    { path: '/dashboard',  labelKey: 'nav.dashboard',  subKey: 'nav.dashboard.sub',  icon: 'dash' },
    { path: '/catalog',    labelKey: 'nav.catalog',    subKey: 'nav.catalog.sub',    icon: 'catalog' },
    { path: '/media',      labelKey: 'nav.media',      subKey: 'nav.media.sub',      icon: 'media' },
    { path: '/storefront', labelKey: 'nav.storefront', subKey: 'nav.storefront.sub', icon: 'store' },
    { path: '/orders',     labelKey: 'nav.orders',     subKey: 'nav.orders.sub',     icon: 'orders' },
    { path: '/customers',  labelKey: 'nav.customers',  subKey: 'nav.customers.sub',  icon: 'users' },
    { path: '/analytics',  labelKey: 'nav.analytics',  subKey: 'nav.analytics.sub',  icon: 'chart' },
    { path: '/sync',       labelKey: 'nav.sync',       subKey: 'nav.sync.sub',       icon: 'sync' },
    { path: '/settings',   labelKey: 'nav.settings',   subKey: 'nav.settings.sub',   icon: 'settings' },
  ];

  constructor(router: Router) {
    // Close the mobile drawer on every successful navigation
    router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.toggle.close());
  }
}
