import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent, IconName } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';

interface NavLink {
  path: string;
  label: string;
  sub: string;
  icon: IconName;
  exact?: boolean;
}

@Component({
  selector: 'ap-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent, AvatarComponent],
  template: `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark">ELITE</div>
        <div class="brand-sub">Admin Portal</div>
      </div>

      <div class="nav-section-label"><span class="label-text">Workspace</span></div>

      <div class="col gap-sm" style="position:relative;z-index:1;">
        @for (n of links; track n.path) {
          <a
            [routerLink]="n.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: !!n.exact }"
            class="nav-item"
          >
            <ap-icon [name]="n.icon" [size]="18"/>
            <div>
              <span>{{ n.label }}</span>
              <div class="label-sub">{{ n.sub }}</div>
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
      border-right: 1px solid rgba(0, 0, 0, 0.1);
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
      padding: 0 12px 28px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 18px;
      position: relative; z-index: 1;
    }
    .brand-mark {
      font-family: var(--ff-disp);
      font-size: 24px; font-weight: 500;
      color: var(--gold); letter-spacing: 0.18em;
    }
    .brand-sub {
      font-size: 9px; letter-spacing: 0.32em;
      color: rgba(255, 255, 255, 0.55);
      text-transform: uppercase; margin-top: 2px;
    }
    .nav-section-label {
      font-size: 9px; letter-spacing: 0.18em;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      padding: 0 12px 8px; margin-top: 6px;
      position: relative; z-index: 1;
    }
    .nav-item {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 13px; font-weight: 500;
      cursor: pointer; border: none; background: none;
      text-align: left; width: 100%;
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
    .nav-item.active::before {
      content: ''; position: absolute; left: -16px; top: 50%;
      transform: translateY(-50%);
      width: 3px; height: 24px; background: var(--gold);
      border-radius: 0 2px 2px 0;
    }
    .nav-item ap-icon { flex-shrink: 0; }
    .label-sub {
      font-size: 10px; color: rgba(255, 255, 255, 0.4);
      font-weight: 400;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-top: 1px;
    }
    .nav-item.active .label-sub { color: rgba(197, 165, 114, 0.6); }

    .sidebar-footer {
      margin-top: auto;
      padding: 16px 12px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      position: relative; z-index: 1;
    }
    .sidebar-user { display: flex; gap: 10px; align-items: center; }

    @media (max-width: 880px) {
      .sidebar { padding: 18px 8px; }
      :host ::ng-deep .nav-item span:not(.label-sub),
      .brand-sub, .nav-section-label, .sidebar-user > div:not(.avatar), .label-text {
        display: none;
      }
    }
  `],
})
export class SidebarComponent {
  readonly links: NavLink[] = [
    { path: '/dashboard', label: 'Dashboard', sub: 'Overview', icon: 'dash' },
    { path: '/catalog', label: 'Catalog', sub: 'Products', icon: 'catalog' },
    { path: '/media', label: 'Media', sub: 'Library & Linking', icon: 'media' },
    { path: '/storefront', label: 'Storefront', sub: 'Section Control', icon: 'store' },
    { path: '/orders', label: 'Orders', sub: 'Fulfillment', icon: 'orders' },
    { path: '/customers', label: 'Customers', sub: 'CRM', icon: 'users' },
    { path: '/analytics', label: 'Analytics', sub: 'Insights', icon: 'chart' },
    { path: '/sync', label: 'Sync Logs', sub: 'System Health', icon: 'sync' },
    { path: '/settings', label: 'Settings', sub: 'Access & Config', icon: 'settings' },
  ];
}
