import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { NavComponent } from './shared/nav/nav.component';
import { FooterComponent } from './shared/footer/footer.component';
import { CartDrawerComponent } from './shared/cart-drawer/cart-drawer.component';
import { LocaleService } from './services/locale.service';
import { HomeContentService } from './services/home-content.service';

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
  readonly homeContent       = inject(HomeContentService);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly hideFooter    = computed(() => this.currentUrl().startsWith('/checkout'));

  // Preview banner state
  readonly bannerVisible = signal(true);
  readonly viewport      = signal<'desktop' | 'mobile'>('desktop');
  readonly isPhonePreview = computed(() =>
    this.homeContent.isPreviewMode() && this.viewport() === 'mobile',
  );

  constructor() {
    // Keep <html> class in sync — used by global CSS for outer shell styling
    effect(() => {
      if (!this.homeContent.isPreviewMode()) {
        document.documentElement.classList.remove('preview-mobile');
        return;
      }
      if (this.viewport() === 'mobile') {
        document.documentElement.classList.add('preview-mobile');
      } else {
        document.documentElement.classList.remove('preview-mobile');
      }
    });
  }

  toggleBanner(): void { this.bannerVisible.update(v => !v); }

  setViewport(v: 'desktop' | 'mobile'): void { this.viewport.set(v); }

  exitPreview(): void {
    document.documentElement.classList.remove('preview-mobile');
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    window.location.href = url.toString();
  }
}
