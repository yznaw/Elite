import {
  AfterViewInit, Component, computed, inject, OnDestroy, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent, IconName } from '../icons/icon.component';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { NotificationService } from '../../services/notification.service';

interface PrimaryTab {
  path: string;
  labelKey: string;
  icon: IconName;
}

interface SecondaryItem {
  path: string;
  labelKey: string;
  subKey: string;
  icon: IconName;
}

@Component({
  selector: 'ap-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <!-- ── Bottom tab bar (phone only, CSS hides on ≥769px) ── -->
    <nav class="bottom-nav" [class.hidden]="navHidden()" aria-label="Main navigation">

      @for (tab of primaryTabs; track tab.path) {
        <a
          [routerLink]="tab.path"
          routerLinkActive="active"
          class="nav-tab"
          [attr.aria-label]="t(tab.labelKey)"
        >
          <ap-icon [name]="tab.icon" [size]="20"/>
          <span class="nav-tab-label">{{ t(tab.labelKey) }}</span>
        </a>
      }

      <!-- More tab -->
      <button
        class="nav-tab"
        [class.active]="moreOpen()"
        (click)="toggleMore()"
        [attr.aria-label]="t('nav.more')"
        [attr.aria-expanded]="moreOpen()"
        type="button"
      >
        <span class="more-icon-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
               width="20" height="20">
            <circle cx="5"  cy="12" r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
            <circle cx="19" cy="12" r="1.5"/>
          </svg>
          @if (unreadCount() > 0) {
            <span class="more-badge">{{ unreadCount() > 9 ? '9+' : unreadCount() }}</span>
          }
        </span>
        <span class="nav-tab-label">{{ t('nav.more') }}</span>
      </button>
    </nav>

    <!-- ── Backdrop ── -->
    @if (moreOpen()) {
      <div class="sheet-backdrop" (click)="closeMore()" aria-hidden="true"></div>
    }

    <!-- ── More slide-up sheet ── -->
    <div class="more-sheet" [class.open]="moreOpen()" role="dialog" [attr.aria-hidden]="!moreOpen()">
      <div class="sheet-handle" (click)="closeMore()"></div>

      <div class="sheet-items">
        @for (item of secondaryItems; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="active"
            class="sheet-item"
            (click)="closeMore()"
          >
            <span class="sheet-item-icon">
              <ap-icon [name]="item.icon" [size]="18"/>
            </span>
            <span class="sheet-item-body">
              <span class="sheet-item-label">{{ t(item.labelKey) }}</span>
              <span class="sheet-item-sub">{{ t(item.subKey) }}</span>
            </span>
          </a>
        }
      </div>

      <div class="sheet-footer">
        <button class="sheet-logout" type="button" (click)="logout()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {{ t('topbar.logout') }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    /* ── Only visible on phones ── */
    :host { display: contents; }

    .bottom-nav, .more-sheet, .sheet-backdrop { display: none; }

    @media (max-width: 768px) {
      /* ── Tab bar ── */
      .bottom-nav {
        display: flex;
        position: fixed;
        inset-inline: 0;
        bottom: 0;
        z-index: 150;
        height: calc(56px + env(safe-area-inset-bottom, 0px));
        padding-bottom: env(safe-area-inset-bottom, 0px);
        background: var(--surface);
        border-top: 1px solid var(--border);
        align-items: stretch;
        box-shadow: 0 -4px 16px rgba(2,70,56,.07);
        transition: transform 0.28s cubic-bezier(.4,0,.2,1);
      }
      .bottom-nav.hidden {
        transform: translateY(100%);
      }

      .nav-tab {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        color: var(--muted);
        text-decoration: none;
        background: none;
        border: none;
        cursor: pointer;
        font-family: inherit;
        padding: 0;
        position: relative;
        transition: color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .nav-tab:active { opacity: 0.7; }
      .nav-tab.active { color: var(--green); }

      /* Gold active indicator line at bottom */
      .nav-tab.active::after {
        content: '';
        position: absolute;
        bottom: 0;
        inset-inline: 20%;
        height: 2px;
        background: var(--gold);
        border-radius: 2px 2px 0 0;
      }

      .nav-tab-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
      }

      /* More tab badge */
      .more-icon-wrap { position: relative; }
      .more-badge {
        position: absolute;
        top: -4px;
        inset-inline-end: -6px;
        min-width: 16px;
        height: 16px;
        background: var(--danger);
        color: #fff;
        font-size: 9px;
        font-weight: 800;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
        line-height: 1;
        pointer-events: none;
      }

      /* ── Backdrop ── */
      .sheet-backdrop {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 160;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        animation: fadeIn 0.2s ease;
      }

      /* ── More sheet ── */
      .more-sheet {
        display: flex;
        flex-direction: column;
        position: fixed;
        inset-inline: 0;
        bottom: 0;
        z-index: 170;
        background: var(--surface);
        border-radius: 20px 20px 0 0;
        padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        box-shadow: 0 -8px 40px rgba(2,70,56,.15);
        transform: translateY(100%);
        transition: transform 0.32s cubic-bezier(.34,1.1,.64,1);
      }
      .more-sheet.open {
        transform: translateY(0);
      }

      .sheet-handle {
        width: 36px;
        height: 4px;
        background: var(--border);
        border-radius: 2px;
        margin: 12px auto 4px;
        cursor: pointer;
        flex-shrink: 0;
      }

      .sheet-items {
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 8px 0;
        flex: 1;
        min-height: 0;
      }

      .sheet-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 20px;
        text-decoration: none;
        color: var(--ink-2);
        transition: background 0.12s;
        -webkit-tap-highlight-color: transparent;
      }
      .sheet-item:active { background: var(--bg); }
      .sheet-item.active .sheet-item-label { color: var(--green); font-weight: 700; }
      .sheet-item.active .sheet-item-icon { color: var(--gold); }

      .sheet-item-icon {
        width: 36px;
        height: 36px;
        background: var(--bg);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--ink-2);
      }

      .sheet-item-body {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }
      .sheet-item-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
        line-height: 1.3;
      }
      .sheet-item-sub {
        font-size: 11px;
        color: var(--muted);
        letter-spacing: 0.02em;
      }

      .sheet-footer {
        padding: 12px 20px 4px;
        border-top: 1px solid var(--border);
        flex-shrink: 0;
      }
      .sheet-logout {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 12px 0;
        background: none;
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        color: var(--danger);
        -webkit-tap-highlight-color: transparent;
      }
    }
  `],
})
export class BottomNavComponent implements AfterViewInit, OnDestroy {
  private readonly i18n   = inject(I18nService);
  private readonly auth   = inject(AuthService);
  private readonly toast  = inject(ToastService);
  private readonly router = inject(Router);
  private readonly notif  = inject(NotificationService);

  readonly t          = (k: string): string => this.i18n.t(k);
  readonly unreadCount = this.notif.unreadCount;

  readonly moreOpen  = signal(false);
  readonly navHidden = signal(false);

  private lastScrollY   = 0;
  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;

  readonly primaryTabs: PrimaryTab[] = [
    { path: '/dashboard',  labelKey: 'nav.dashboard',  icon: 'dash'    },
    { path: '/catalog',    labelKey: 'nav.catalog',    icon: 'catalog' },
    { path: '/orders',     labelKey: 'nav.orders',     icon: 'orders'  },
    { path: '/customers',  labelKey: 'nav.customers',  icon: 'users'   },
  ];

  readonly secondaryItems: SecondaryItem[] = [
    { path: '/media',       labelKey: 'nav.media',       subKey: 'nav.media.sub',       icon: 'media'    },
    { path: '/storefront',  labelKey: 'nav.storefront',  subKey: 'nav.storefront.sub',  icon: 'store'    },
    { path: '/collections', labelKey: 'nav.collections', subKey: 'nav.collections.sub', icon: 'catalog'  },
    { path: '/analytics',   labelKey: 'nav.analytics',   subKey: 'nav.analytics.sub',   icon: 'chart'    },
    { path: '/reference',   labelKey: 'nav.reference',   subKey: 'nav.reference.sub',   icon: 'list'     },
    { path: '/settings',    labelKey: 'nav.settings',    subKey: 'nav.settings.sub',    icon: 'settings' },
  ];

  ngAfterViewInit(): void {
    this.scrollEl = document.querySelector('.scroll-area');
    if (!this.scrollEl) return;

    this.scrollHandler = () => {
      const current = this.scrollEl!.scrollTop;
      const delta   = current - this.lastScrollY;
      // Hide on scroll down (>10px), show on any scroll up
      if (delta > 10 && current > 80) {
        this.navHidden.set(true);
      } else if (delta < -4) {
        this.navHidden.set(false);
      }
      this.lastScrollY = current;
    };
    this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    // Close More sheet on navigation
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        this.moreOpen.set(false);
        this.navHidden.set(false);
      });
  }

  ngOnDestroy(): void {
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    }
  }

  toggleMore(): void { this.moreOpen.update((v) => !v); }
  closeMore(): void  { this.moreOpen.set(false); }

  async logout(): Promise<void> {
    this.closeMore();
    try {
      await this.auth.logout();
      this.toast.info(this.t('login.signedOut'));
    } finally {
      void this.router.navigate(['/login']);
    }
  }
}
