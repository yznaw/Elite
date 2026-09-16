import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { NavComponent } from './shared/nav/nav.component';
import { FooterComponent } from './shared/footer/footer.component';
import { CartDrawerComponent } from './shared/cart-drawer/cart-drawer.component';
import { LocaleService } from './services/locale.service';
import { HomeContentService } from './services/home-content.service';
import { AnalyticsService } from './services/analytics.service';

/** The page part of a URL: query string and fragment do not make it a different page. */
function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

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
    this.scrollToTopOnPageChange();
  }

  /**
   * Put a new page at the top, instantly.
   *
   * The router's own `scrollPositionRestoration` used the browser scroller, which obeys the
   * global `html { scroll-behavior: smooth }`, so picking "Collection" from the menu while
   * standing at a page's footer animated slowly upwards and read as "it did not take me to
   * the top". Only a real page change counts: the collection page keeps its filters in the
   * query string, and yanking a shopper to the top every time they tick a filter would be
   * its own bug. A fragment is left alone so anchor scrolling still works.
   */
  private scrollToTopOnPageChange(): void {
    if (typeof window === 'undefined') return;

    let previousPath = pathOf(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        const path = pathOf(url);
        const changedPage = path !== previousPath;
        previousPath = path;
        if (!changedPage || url.includes('#')) return;

        const root = document.documentElement;
        const previousBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
        root.style.scrollBehavior = previousBehavior;
      });
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
