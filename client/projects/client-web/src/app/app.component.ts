import { Component, computed, inject, signal } from '@angular/core';
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
  standalone: true,
  imports: [CommonModule, RouterOutlet, NavComponent, FooterComponent, CartDrawerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
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

  readonly hideFooter = computed(() => this.currentUrl().startsWith('/checkout'));

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
