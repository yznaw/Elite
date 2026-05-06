import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { IconComponent } from '../icons/icon.component';
import { AvatarComponent } from '../avatar/avatar.component';

interface PageMeta {
  crumb: string;
  title: string;
}

const META: Record<string, PageMeta> = {
  '/dashboard': { crumb: 'Dashboard · Overview', title: 'Dashboard' },
  '/catalog': { crumb: 'Catalog · Products', title: 'Product Catalog' },
  '/media': { crumb: 'Media · Library & Linking', title: 'Media Library' },
  '/storefront': { crumb: 'Storefront · Section Control', title: 'Storefront Control' },
  '/orders': { crumb: 'Orders · Fulfillment', title: 'Orders & Fulfillment' },
  '/customers': { crumb: 'Customers · CRM', title: 'Customer CRM' },
  '/analytics': { crumb: 'Analytics · Insights', title: 'Analytics & Insights' },
  '/sync': { crumb: 'Sync Logs · System Health', title: 'Sync Logs' },
  '/settings': { crumb: 'Settings · Access & Config', title: 'Workspace Settings' },
};

@Component({
  selector: 'ap-topbar',
  standalone: true,
  imports: [CommonModule, IconComponent, AvatarComponent],
  template: `
    <div class="topbar">
      <div>
        <div class="crumb">{{ meta().crumb }}</div>
        <h1>{{ meta().title }}</h1>
      </div>
      <div class="topbar-actions">
        <div class="inp-search" style="width:240px;position:relative;">
          <ap-icon name="search" [size]="14"/>
          <input class="inp with-icon" placeholder="Quick search…"/>
        </div>
        <button class="icon-btn" title="Notifications" style="position:relative;">
          <ap-icon name="bell" [size]="16"/>
          <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--gold);border:2px solid #fff;"></span>
        </button>
        <ap-avatar initials="YH"/>
      </div>
    </div>
  `,
  styles: [`
    .topbar {
      height: 64px;
      padding: 0 32px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .topbar h1 {
      font-family: var(--ff-disp);
      font-size: 24px; font-weight: 500;
      color: var(--green); letter-spacing: 0.01em;
      margin: 0;
    }
    .topbar .crumb {
      font-size: 11px; color: var(--muted);
      letter-spacing: 0.1em; text-transform: uppercase;
      margin-bottom: 2px;
    }
    .topbar-actions { display: flex; gap: 10px; align-items: center; }
  `],
})
export class TopbarComponent {
  private readonly router = inject(Router);
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
