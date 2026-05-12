import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { IconComponent } from '../icons/icon.component';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { NotificationDropdownComponent } from '../notification-dropdown/notification-dropdown.component';
import { I18nService } from '../../services/i18n.service';
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
  imports: [CommonModule, IconComponent, LanguageSwitcherComponent, NotificationDropdownComponent],
  template: `
    <div class="topbar">
      <div class="row gap-sm" style="min-width:0;align-items:center;">
        <button class="topbar-burger" (click)="toggle.toggle()" [attr.aria-label]="t('topbar.openMenu')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div style="min-width:0;">
          <div class="crumb">{{ t(meta().crumbKey) }}</div>
          <h1>{{ t(meta().titleKey) }}</h1>
        </div>
      </div>

      <div class="topbar-actions">
        <div class="topbar-search-desk inp-search" style="width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" [placeholder]="t('topbar.search.placeholder')"/>
        </div>

        <button class="topbar-search-mobile icon-btn" [attr.aria-label]="t('common.search')" (click)="toggleSearch()">
          <ap-icon name="search" [size]="14"/>
        </button>

        <ap-language-switcher/>

        <ap-notification-dropdown/>
      </div>
    </div>

    @if (searchOpen()) {
      <div class="topbar-search-pane inp-search">
        <ap-icon name="search" [size]="14"/>
        <input class="inp with-icon" [placeholder]="t('topbar.search.placeholder')" autofocus/>
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
    .topbar-search-pane {
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      animation: fadeIn 0.18s ease;
    }
    .topbar-search-pane .inp { width: 100%; }
  `],
})
export class TopbarComponent {
  private readonly i18n = inject(I18nService);
  readonly toggle = inject(SidebarToggleService);
  private readonly router = inject(Router);

  readonly searchOpen = signal(false);

  readonly t = (k: string): string => this.i18n.t(k);

  toggleSearch(): void {
    this.searchOpen.update((o) => !o);
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
