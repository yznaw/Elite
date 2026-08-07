import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent, IconName } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { SidebarToggleService } from '../sidebar-toggle.service';

type Role = 'owner' | 'admin' | 'manager' | 'cashier' | 'viewer';

interface NavLink {
  path: string;
  labelKey: string;
  subKey: string;
  icon: IconName;
  exact?: boolean;
  /** Plain <a href target="_blank"> instead of an Angular routerLink — for links that leave the app's own routes, e.g. the static staff guide. */
  external?: boolean;
  /**
   * Roles allowed to see this link — must mirror the `roleGuard([...])` on
   * the matching route in app.routes.ts exactly (see
   * docs/32-permission-enforcement-ux-design.md §3.1). Omit for a link
   * whose route carries no roleGuard, meaning any authenticated role can
   * reach it.
   */
  roles?: Role[];
}

interface NavGroup {
  labelKey: string;
  links: NavLink[];
}

@Component({
    selector: 'ap-sidebar',
    imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent, AvatarComponent],
    template: `
    @if (toggle.open()) {
      <div class="sidebar-backdrop" (click)="toggle.close()" aria-hidden="true"></div>
    }

    <aside
      class="sidebar sidebar-host"
      [class.open]="toggle.open()"
      [class.collapsed]="toggle.collapsed()"
      (touchstart)="onTouchStart($event)"
      (touchend)="onTouchEnd($event)"
    >
      <!-- Brand + collapse button -->
      <div class="sidebar-brand">
        <img src="assets/brand/elite-logo-cream.png" alt="Elite Collection" class="brand-logo"/>
        <!-- Desktop collapse toggle -->
        <button
          class="collapse-btn"
          type="button"
          (click)="toggle.toggleCollapse()"
          [attr.title]="toggle.collapsed() ? t('sidebar.expand') : t('sidebar.collapse')"
          [attr.aria-label]="toggle.collapsed() ? t('sidebar.expand') : t('sidebar.collapse')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            @if (toggle.collapsed()) {
              <polyline points="9 18 15 12 9 6"/>
            } @else {
              <polyline points="15 18 9 12 15 6"/>
            }
          </svg>
        </button>
      </div>

      <!-- Scrollable nav container -->
      <div class="nav-scroll">
        @for (group of visibleGroups(); track group.labelKey) {
          <div class="nav-section-label"><span class="label-text">{{ t(group.labelKey) }}</span></div>
          @for (n of group.links; track n.path) {
            @if (n.external) {
              <a
                [href]="n.path"
                target="_blank"
                rel="noopener"
                class="nav-item"
                (click)="toggle.close()"
                [attr.title]="toggle.collapsed() ? t(n.labelKey) : null"
              >
                <ap-icon [name]="n.icon" [size]="18"/>
                <div class="nav-label">
                  <span>{{ t(n.labelKey) }}</span>
                  <div class="label-sub">{{ t(n.subKey) }}</div>
                </div>
              </a>
            } @else {
              <a
                [routerLink]="n.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: !!n.exact }"
                class="nav-item"
                (click)="toggle.close()"
                [attr.title]="toggle.collapsed() ? t(n.labelKey) : null"
              >
                <ap-icon [name]="n.icon" [size]="18"/>
                <div class="nav-label">
                  <span>{{ t(n.labelKey) }}</span>
                  <div class="label-sub">{{ t(n.subKey) }}</div>
                </div>
              </a>
            }
          }
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
          </div>
        }
      </div>
    </aside>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    :host { display: contents; }

    .sidebar {
      background: var(--green);
      color: #fff;
      display: flex;
      flex-direction: column;
      padding: 28px 16px 20px;
      border-inline-end: 1px solid rgba(0,0,0,0.1);
      position: relative;
      height: 100vh;
      overflow: hidden;
      transition: width 0.22s ease;
      width: 240px;
    }
    .sidebar::before {
      content: '';
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at top, rgba(197,165,114,0.06), transparent 60%);
      pointer-events: none;
    }

    /* ── Brand ─────────────────────────── */
    .sidebar-brand {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      padding-block: 0 28px;
      padding-inline: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 18px;
      position: relative; z-index: 1;
      flex-shrink: 0;
    }
    .brand-logo {
      height: 28px;
      width: auto;
      object-fit: contain;
      flex: 1;
      min-width: 0;
    }

    /* ── Collapse button (desktop only) ── */
    .collapse-btn {
      flex-shrink: 0;
      width: 24px; height: 24px;
      display: none;
      align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: rgba(255,255,255,0.5);
      cursor: pointer;
      transition: all 0.15s;
      margin-top: 2px;
    }
    .collapse-btn:hover {
      color: var(--gold);
      border-color: rgba(197,165,114,0.4);
    }
    @media (min-width: 1025px) {
      .collapse-btn { display: inline-flex; }
    }

    /* ── Section label ─────────────────── */
    .nav-section-label {
      font-size: 9px; letter-spacing: 0.18em;
      color: rgba(255,255,255,0.4);
      text-transform: uppercase;
      padding-inline: 12px;
      padding-block: 0 8px;
      margin-top: 6px;
      position: relative; z-index: 1;
      flex-shrink: 0;
    }
    /* Extra breathing room before every group after the first one, so a
       long grouped list still reads as distinct sections, not one run-on
       list with small labels sprinkled in. */
    .nav-section-label:not(:first-child) { margin-top: 18px; }
    html[dir='rtl'] .nav-section-label { letter-spacing: 0; }

    /* ── Scrollable nav ────────────────── */
    .nav-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative; z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-bottom: 8px;
    }
    .nav-scroll::-webkit-scrollbar { width: 3px; }
    .nav-scroll::-webkit-scrollbar-track { background: transparent; }
    .nav-scroll::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.12);
      border-radius: 99px;
    }
    .nav-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

    /* ── Nav items ─────────────────────── */
    .nav-item {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px;
      color: rgba(255,255,255,0.78);
      font-size: 13px; font-weight: 500;
      cursor: pointer; border: none; background: none;
      text-align: start; width: 100%;
      border-radius: 8px;
      transition: all 0.18s ease;
      position: relative; z-index: 1;
      text-decoration: none;
      flex-shrink: 0;
      overflow: hidden;
    }
    .nav-item:hover { background: rgba(255,255,255,0.04); color: #fff; }
    .nav-item.active {
      background: linear-gradient(90deg, var(--gold-3), transparent);
      color: var(--gold);
    }
    html[dir='rtl'] .nav-item.active {
      background: linear-gradient(-90deg, var(--gold-3), transparent);
    }
    .nav-item.active::before {
      content: ''; position: absolute;
      inset-inline-start: -16px; top: 50%;
      transform: translateY(-50%);
      width: 3px; height: 24px; background: var(--gold);
      border-start-end-radius: 2px;
      border-end-end-radius: 2px;
    }
    .nav-item ap-icon { flex-shrink: 0; }
    .nav-label { min-width: 0; }
    .label-sub {
      font-size: 10px; color: rgba(255,255,255,0.4);
      font-weight: 400;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-top: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    html[dir='rtl'] .label-sub { letter-spacing: 0; }
    .nav-item.active .label-sub { color: rgba(197,165,114,0.6); }

    /* ── Footer ────────────────────────── */
    .sidebar-footer {
      padding-block: 16px 0;
      padding-inline: 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
      position: relative; z-index: 1;
      flex-shrink: 0;
    }
    .sidebar-user { display: flex; gap: 10px; align-items: center; }
    .sidebar-user-meta { flex: 1; min-width: 0; }
    .sidebar-user-name {
      font-size: 12px; color: #fff;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sidebar-user-sub {
      font-size: 10px; color: rgba(255,255,255,0.55);
      display: flex; gap: 4px; align-items: center; min-width: 0;
    }
    .sidebar-user-role {
      color: var(--gold); font-weight: 500;
      letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0;
    }
    .sidebar-user-sep { opacity: 0.5; flex-shrink: 0; }
    .sidebar-user-email {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    /* ── Collapsed state (desktop) ─────── */
    @media (min-width: 1025px) {
      .sidebar.collapsed {
        width: 68px;
        padding-inline: 8px;
      }
      .sidebar.collapsed .nav-section-label,
      .sidebar.collapsed .nav-label,
      .sidebar.collapsed .sidebar-user-meta {
        display: none;
      }
      .sidebar.collapsed .sidebar-brand { padding-inline: 4px; justify-content: center; }
      .sidebar.collapsed .brand-logo { height: 20px; }
      .sidebar.collapsed .nav-item { justify-content: center; padding-inline: 0; }
      .sidebar.collapsed .sidebar-user { justify-content: center; }
      .sidebar.collapsed .sidebar-footer { padding-inline: 4px; }
    }

    /* ── Tablet drawer (769–1024px) ────── */
    @media (max-width: 1024px) {
      .sidebar {
        position: fixed;
        inset-block: 0;
        inset-inline-start: -280px;
        z-index: 200;
        width: 260px;
        /* spring-physics feel on open */
        transition: inset-inline-start 0.3s cubic-bezier(.34,1.15,.64,1),
                    box-shadow 0.3s ease;
        box-shadow: none;
      }
      .sidebar.open {
        inset-inline-start: 0;
        box-shadow: 6px 0 32px rgba(0,0,0,0.28);
      }
    }

    /* ── Phone (≤768px): bottom nav owns navigation.
          Sidebar and backdrop are unconditionally hidden so the
          hamburger drawer can never appear even if the signal fires. ── */
    @media (max-width: 768px) {
      .sidebar           { inset-inline-start: -280px !important; visibility: hidden; }
      .sidebar-backdrop  { display: none !important; }
    }

    /* ── Tablet/desktop backdrop ────────── */
    .sidebar-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.42);
      z-index: 199;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: fadeIn 0.2s ease;
    }
  `]
})
export class SidebarComponent {
  private readonly i18n  = inject(I18nService);
  private readonly auth  = inject(AuthService);
  readonly toggle = inject(SidebarToggleService);
  private readonly router = inject(Router);

  readonly t    = (k: string): string => this.i18n.t(k);
  readonly user = this.auth.user;

  private swipeStartX = 0;

  onTouchStart(e: TouchEvent): void {
    this.swipeStartX = e.touches[0].clientX;
  }

  onTouchEnd(e: TouchEvent): void {
    const deltaX = e.changedTouches[0].clientX - this.swipeStartX;
    // Swipe right (LTR) or left (RTL) to close — 80px threshold
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (deltaX * dir > 80) {
      this.toggle.close();
    }
  }

  // Grouped by what the section is actually for, not left as one flat run-on
  // list — the nav grew to 15+ items across all the POS/reporting phases,
  // past the point a single "Workspace" label stays scannable.
  private readonly groups: NavGroup[] = [
    {
      labelKey: 'nav.section.overview',
      links: [
        { path: '/dashboard', labelKey: 'nav.dashboard', subKey: 'nav.dashboard.sub', icon: 'dash' },
      ],
    },
    {
      labelKey: 'nav.section.storefront',
      links: [
        { path: '/catalog',     labelKey: 'nav.catalog',     subKey: 'nav.catalog.sub',     icon: 'catalog' },
        { path: '/collections', labelKey: 'nav.collections', subKey: 'nav.collections.sub', icon: 'collections' },
        { path: '/media',       labelKey: 'nav.media',       subKey: 'nav.media.sub',       icon: 'media' },
        { path: '/storefront',  labelKey: 'nav.storefront',  subKey: 'nav.storefront.sub',  icon: 'store' },
      ],
    },
    {
      labelKey: 'nav.section.sales',
      links: [
        // 'barcode' distinguishes POS from Storefront's 'store' icon — both
        // used to share 'store', with nothing to tell them apart at a glance.
        // Excludes viewer, matching roleGuard(['owner','admin','manager','cashier']) on /pos.
        { path: '/pos',            labelKey: 'nav.pos',            subKey: 'nav.pos.sub',            icon: 'barcode', roles: ['owner', 'admin', 'manager', 'cashier'] },
        { path: '/orders',         labelKey: 'nav.orders',         subKey: 'nav.orders.sub',         icon: 'orders' },
        { path: '/customers',      labelKey: 'nav.customers',      subKey: 'nav.customers.sub',      icon: 'users' },
        // 'scale' (a balance) for reconciling two totals against each other —
        // previously reused 'chart', identical to Analytics' icon.
        // No cashier access, matching roleGuard(['owner','admin','manager']) on /reconciliation.
        { path: '/reconciliation', labelKey: 'nav.reconciliation', subKey: 'nav.reconciliation.sub', icon: 'scale', roles: ['owner', 'admin', 'manager'] },
        // 'csv' for exportable ledger reports — previously reused 'docs',
        // identical to Policies' icon. Same access scope as reconciliation.
        { path: '/reports',        labelKey: 'nav.reports',        subKey: 'nav.reports.sub',        icon: 'csv', roles: ['owner', 'admin', 'manager'] },
      ],
    },
    {
      labelKey: 'nav.section.engagement',
      links: [
        { path: '/feedback',  labelKey: 'nav.feedback',  subKey: 'nav.feedback.sub',  icon: 'star' },
        { path: '/policies',  labelKey: 'nav.policies',  subKey: 'nav.policies.sub',  icon: 'docs' },
        { path: '/analytics', labelKey: 'nav.analytics', subKey: 'nav.analytics.sub', icon: 'chart' },
      ],
    },
    {
      labelKey: 'nav.section.system',
      links: [
        // Matches roleGuard(['owner','admin']) on /reference and /settings.
        { path: '/reference', labelKey: 'nav.reference', subKey: 'nav.reference.sub', icon: 'reference', roles: ['owner', 'admin'] },
        { path: '/settings',  labelKey: 'nav.settings',  subKey: 'nav.settings.sub',  icon: 'settings', roles: ['owner', 'admin'] },
        { path: 'assets/docs/staff-guide.html', labelKey: 'nav.documentation', subKey: 'nav.documentation.sub', icon: 'externalLink', external: true },
      ],
    },
  ];

  // Manager-role accounts can't reach /settings (owner/admin-only — store
  // config and team management live there) but still need a way to set
  // their own manager PIN. Owner/admin already reach that same PIN card
  // inside Settings, so this link only needs to appear for managers —
  // showing it to everyone would just be a confusing near-duplicate of
  // the Settings link for the roles that don't need it. 'lock' distinguishes
  // it from Settings' own icon since they're different destinations.
  private readonly myPinLink: NavLink = { path: '/my-pin', labelKey: 'nav.myPin', subKey: 'nav.myPin.sub', icon: 'lock' };

  // Owner/admin only, matching the route guard on /diagnostics. Appended
  // conditionally rather than added to `groups` because every non-manager role
  // sees all groups — a viewer would otherwise get a visible link that only
  // bounces them back to the dashboard.
  private readonly stocktakeLink: NavLink = { path: '/stocktake', labelKey: 'nav.stocktake', subKey: 'nav.stocktake.sub', icon: 'list' };

  private readonly diagnosticsLink: NavLink = { path: '/diagnostics', labelKey: 'nav.diagnostics', subKey: 'nav.diagnostics.sub', icon: 'warning' };

  readonly visibleGroups = computed<NavGroup[]>(() => {
    const role = this.user()?.role as Role | undefined;
    const extras: NavLink[] = [];
    if (role === 'manager') extras.push(this.myPinLink);
    if (role === 'owner' || role === 'admin') extras.push(this.diagnosticsLink, this.stocktakeLink);
    return this.groups
      .map((group) => ({
        ...group,
        links: [
          ...group.links.filter((link) => !link.roles || !role || link.roles.includes(role)),
          ...(group.labelKey === 'nav.section.system' ? extras : []),
        ],
      }))
      .filter((group) => group.links.length > 0);
  });

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.toggle.close());
  }
}
