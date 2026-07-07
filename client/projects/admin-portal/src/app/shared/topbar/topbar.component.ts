import { Component, computed, ElementRef, HostListener, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { IconComponent } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { NotificationDropdownComponent } from '../notification-dropdown/notification-dropdown.component';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { SidebarToggleService } from '../sidebar-toggle.service';

interface PageMeta {
  crumbKey: string;
  titleKey: string;
}

const META: Record<string, PageMeta> = {
  '/dashboard':  { crumbKey: 'page.dashboard.crumb',  titleKey: 'page.dashboard.title' },
  '/catalog':    { crumbKey: 'page.catalog.crumb',    titleKey: 'page.catalog.title' },
  '/media':      { crumbKey: 'page.media.crumb',      titleKey: 'page.media.title' },
  '/storefront': { crumbKey: 'page.storefront.crumb', titleKey: 'page.storefront.title' },
  '/orders':     { crumbKey: 'page.orders.crumb',     titleKey: 'page.orders.title' },
  '/customers':  { crumbKey: 'page.customers.crumb',  titleKey: 'page.customers.title' },
  '/analytics':  { crumbKey: 'page.analytics.crumb',  titleKey: 'page.analytics.title' },
  '/sync':       { crumbKey: 'page.sync.crumb',       titleKey: 'page.sync.title' },
  '/settings':   { crumbKey: 'page.settings.crumb',   titleKey: 'page.settings.title' },
};

@Component({
  selector: 'ap-topbar',
  standalone: true,
  imports: [CommonModule, IconComponent, AvatarComponent, LanguageSwitcherComponent, NotificationDropdownComponent],
  template: `
    <div class="topbar">
      <div class="row gap-sm" style="min-width:0;align-items:center;">
        <!-- Desktop/tablet: hamburger for sidebar drawer -->
        <button class="topbar-burger" (click)="toggle.toggle()" [attr.aria-label]="t('topbar.openMenu')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <!-- Phone only: back chevron for secondary pages (hidden on primary tab pages) -->
        @if (showBack()) {
          <button class="topbar-back" (click)="goBack()" [attr.aria-label]="t('common.goBack')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 width="18" height="18">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
        }
        <div style="min-width:0;">
          <div class="crumb">{{ t(meta().crumbKey) }}</div>
          <h1>{{ t(meta().titleKey) }}</h1>
        </div>
      </div>

      <div class="topbar-actions">
        <div class="topbar-search-desk inp-search" style="width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('topbar.search.placeholder')"
                 #deskSearchInput
                 (keydown.enter)="submitSearch(deskSearchInput.value); deskSearchInput.value = ''"/>
        </div>

        <button class="topbar-search-mobile icon-btn" [attr.aria-label]="t('common.search')" (click)="toggleSearch()">
          <ap-icon name="search" [size]="14"/>
        </button>

        <ap-language-switcher/>

        <ap-notification-dropdown/>

        <!-- Avatar + user dropdown -->
        <div class="user-menu-wrap">
          <button
            class="avatar-btn"
            type="button"
            (click)="toggleUserDrop()"
            [attr.aria-label]="user()?.name ?? 'Account'"
            [attr.aria-expanded]="userDropOpen()"
          >
            <ap-avatar [initials]="user()?.initials ?? '?'"/>
          </button>

          @if (userDropOpen()) {
            <div class="user-drop" role="dialog">
              <div class="user-drop-header">
                <ap-avatar [initials]="user()?.initials ?? '?'" size="lg"/>
                <div class="user-drop-info">
                  <div class="user-drop-name">{{ user()?.name }}</div>
                  <div class="user-drop-role">{{ t('settings.role.' + user()?.role) }}</div>
                  <div class="user-drop-email" [title]="user()?.email ?? ''">{{ user()?.email }}</div>
                </div>
              </div>
              <div class="user-drop-divider"></div>
              <button class="user-drop-logout" type="button" (click)="logout()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                     width="14" height="14">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                {{ t('topbar.logout') }}
              </button>
            </div>
          }
        </div>
      </div>
    </div>

    @if (searchOpen()) {
      <div class="topbar-search-pane">
        <!-- Back button: visible only on mobile overlay -->
        <button
          class="icon-btn search-close-btn"
          type="button"
          (click)="toggleSearch()"
          [attr.aria-label]="t('common.closeSearch')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               width="18" height="18">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <!-- Input wrapper keeps the search icon absolutely positioned -->
        <div class="inp-search search-input-wrap">
          <ap-icon name="search" [size]="14"/>
          <input
            class="inp with-icon"
            [placeholder]="t('topbar.search.placeholder')"
            (keydown.escape)="toggleSearch()"
            (keydown.enter)="submitSearch(mobileSearchInput.value); mobileSearchInput.value = ''; toggleSearch()"
            #mobileSearchInput
            autofocus
          />
        </div>
      </div>
    }
  `,
  styles: [`
    .topbar {
      height: 64px;
      padding: 0 32px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
      gap: 16px;
    }
    .topbar h1 {
      font-family: var(--ff-disp);
      font-size: 24px; font-weight: 500;
      color: var(--green); letter-spacing: 0.01em;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    html[dir='rtl'] .topbar h1 { letter-spacing: 0; }
    .topbar .crumb {
      font-size: 11px; color: var(--muted);
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    html[dir='rtl'] .topbar .crumb { letter-spacing: 0; }
    .topbar-actions { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }

    /* ── Search pane — desktop (below topbar, simple bar) ── */
    .topbar-search-pane {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      animation: fadeIn 0.18s ease;
    }
    .search-input-wrap { flex: 1; }
    .topbar-search-pane .inp { width: 100%; }
    .search-close-btn { display: none !important; }

    /* ── Search pane — mobile (full-screen overlay) ── */
    @media (max-width: 768px) {
      .topbar-search-pane {
        position: fixed;
        inset: 0;
        z-index: 300;
        padding: 20px 16px 16px;
        border-bottom: none;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: 0;
        animation: searchOverlayIn 0.22s cubic-bezier(.22,1,.36,1);
      }
      .search-close-btn {
        display: inline-flex !important;
        align-self: flex-start;
        margin-bottom: 16px;
        flex-shrink: 0;
      }
      .search-input-wrap { flex: none; width: 100%; }
      .topbar-search-pane .inp {
        height: 52px;
        font-size: 18px !important;
        padding-left: 44px;
      }
    }
    @keyframes searchOverlayIn {
      from { opacity: 0; transform: translateY(-10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Back button (phone only — shows on secondary pages) ── */
    .topbar-back {
      display: none;
    }
    @media (max-width: 768px) {
      .topbar-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: none;
        border: 1px solid var(--border);
        border-radius: 8px;
        color: var(--ink-2);
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .topbar-back:active { background: var(--bg); }
    }

    /* ── Avatar button ── */
    .user-menu-wrap { position: relative; }
    .avatar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 2px solid transparent;
      border-radius: 50%;
      padding: 2px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .avatar-btn:hover { border-color: var(--gold-4); }

    /* ── User dropdown ── */
    .user-drop {
      position: absolute;
      top: calc(100% + 8px);
      inset-inline-end: 0;
      width: 264px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: var(--shadow-lg);
      z-index: 400;
      overflow: hidden;
      animation: fadeIn 0.15s ease;
    }
    .user-drop-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
    }
    .user-drop-info { flex: 1; min-width: 0; }
    .user-drop-name {
      font-size: 13px;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .user-drop-role {
      font-size: 10px;
      font-weight: 700;
      color: var(--gold);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-top: 2px;
    }
    .user-drop-email {
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .user-drop-divider {
      height: 1px;
      background: var(--border);
      margin: 0 16px;
    }
    .user-drop-logout {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 12px 16px;
      background: none;
      border: none;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--danger);
      transition: background 0.12s;
      text-align: start;
    }
    .user-drop-logout:hover { background: var(--danger-bg); }
  `],
})
export class TopbarComponent {
  private readonly i18n     = inject(I18nService);
  private readonly auth     = inject(AuthService);
  private readonly toast    = inject(ToastService);
  private readonly elRef    = inject(ElementRef);
  private readonly location = inject(Location);
  readonly toggle = inject(SidebarToggleService);
  private readonly router = inject(Router);

  readonly searchOpen   = signal(false);
  readonly userDropOpen = signal(false);
  readonly isMobile     = signal(window.innerWidth <= 768);

  @HostListener('window:resize')
  onWinResize(): void { this.isMobile.set(window.innerWidth <= 768); }

  readonly t    = (k: string): string => this.i18n.t(k);
  readonly user = this.auth.user;

  // Primary tab pages — no back button needed (bottom nav handles them)
  private readonly PRIMARY_PATHS = new Set(['/dashboard', '/catalog', '/orders', '/customers']);

  readonly showBack = computed(() => {
    if (!this.isMobile()) return false;
    const path = '/' + (this.url().split('/')[1] || 'dashboard');
    return !this.PRIMARY_PATHS.has(path);
  });

  goBack(): void { this.location.back(); }

  toggleSearch(): void  { this.searchOpen.update((o) => !o); }
  toggleUserDrop(): void { this.userDropOpen.update((v) => !v); }

  submitSearch(query: string): void {
    const q = query.trim();
    if (!q) return;
    void this.router.navigate(['/catalog'], { queryParams: { q } });
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (this.userDropOpen() && !this.elRef.nativeElement.contains(e.target)) {
      this.userDropOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.userDropOpen.set(false); }

  async logout(): Promise<void> {
    this.userDropOpen.set(false);
    try {
      await this.auth.logout();
      this.toast.info(this.t('login.signedOut'));
    } finally {
      void this.router.navigate(['/login']);
    }
  }

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url || '/dashboard' },
  );

  readonly meta = computed<PageMeta>(() => {
    const u = this.url();
    const path = '/' + (u.split('/')[1] || 'dashboard');
    return META[path] ?? META['/dashboard'];
  });
}
