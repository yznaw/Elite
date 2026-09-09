import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { NavComponent } from './shared/nav/nav.component';
import { FooterComponent } from './shared/footer/footer.component';
import { CartDrawerComponent } from './shared/cart-drawer/cart-drawer.component';
import { LocaleService } from './services/locale.service';
import { HomeContentService } from './services/home-content.service';
import { AnalyticsService } from './services/analytics.service';

@Component({
    selector: 'cw-root',
    imports: [CommonModule, RouterOutlet, NavComponent, FooterComponent, CartDrawerComponent],
    templateUrl: './app.component.html',
    /**
     * The root shell is switched last on purpose. It hosts the nav, the footer,
     * the cart drawer and the router outlet, and an OnPush view that is not
     * dirty is not descended into: had this been flipped while its children
     * were still eager, they would have stopped updating even though nothing
     * about them changed. With every child on OnPush, each one marks itself
     * through the signals it reads and the traversal reaches it.
     *
     * Everything this template binds is reactive: `currentUrl` is a `toSignal`
     * over the router's NavigationEnd stream, `isExperience` and `hideFooter`
     * are computed from it, `bannerVisible` is a signal, and `isEmbedded` is a
     * constant fixed at construction.
     */
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly router    = inject(Router);
  private readonly locale    = inject(LocaleService);
  private readonly analytics = inject(AnalyticsService);
  readonly homeContent       = inject(HomeContentService);

  constructor() {
    // Track real visitors only — never the admin's preview iframe.
    if (!this.isEmbedded) this.analytics.init();
  }

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly isExperience = computed(() => this.currentUrl().startsWith('/experience'));
  readonly hideFooter   = computed(() => this.currentUrl().startsWith('/checkout') || this.isExperience());

  // True when loaded inside the admin's preview iframe (suppresses the banner)
  readonly isEmbedded = typeof window !== 'undefined' && window !== window.parent;

  // Banner state (for direct-tab preview access)
  readonly bannerVisible = signal(true);
  toggleBanner(): void { this.bannerVisible.update(v => !v); }

  exitPreview(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    url.searchParams.delete('embedded');
    window.location.href = url.toString();
  }
}
