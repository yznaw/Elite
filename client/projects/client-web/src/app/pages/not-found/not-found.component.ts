import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { SeoService } from '../../services/seo.service';

/**
 * The catch-all route.
 *
 * This replaced `{ path: '**', redirectTo: '' }`, which was actively harmful:
 * a redirect tells a crawler the URL resolved, so every typo, dead campaign
 * link and stale external link was reported as a second copy of the homepage.
 * Showing a real dead-end page with `noindex` is what stops that.
 *
 * The HTTP status is still 200 because this is a client-side route and the
 * browser has already been served index.html by then. `noindex` is what
 * search engines actually act on; returning a true 404 status needs the
 * server to know the route table, which lands with SSR.
 */
@Component({
  selector: 'cw-not-found',
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="nf-page">
      <div class="nf-inner">
        <p class="nf-code">404</p>
        <h1 class="nf-title">{{ t('notFound.title') }}</h1>
        <p class="nf-body">{{ t('notFound.body') }}</p>

        <div class="nf-actions">
          <a routerLink="/collection" class="nf-btn nf-btn-primary">
            {{ t('notFound.cta.collection') }}
          </a>
          <a routerLink="/" class="nf-btn nf-btn-ghost">
            {{ t('notFound.cta.home') }}
          </a>
        </div>

        <nav class="nf-links" [attr.aria-label]="t('notFound.linksLabel')">
          <a routerLink="/story">{{ t('nav.story') }}</a>
          <a routerLink="/contact">{{ t('nav.contact') }}</a>
        </nav>
      </div>
    </section>
  `,
  styles: [`
    .nf-page {
      min-height: 62vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 96px 24px 120px;
      background: var(--bg);
    }
    .nf-inner { max-width: 520px; text-align: center; }

    .nf-code {
      margin: 0 0 18px;
      font-size: 13px;
      letter-spacing: 0.28em;
      color: var(--gold);
      font-weight: 600;
    }
    .nf-title {
      margin: 0 0 14px;
      font-size: clamp(28px, 5vw, 40px);
      line-height: 1.18;
      font-weight: 400;
      color: var(--cream);
    }
    .nf-body {
      margin: 0 0 34px;
      font-size: 15px;
      line-height: 1.7;
      color: var(--muted);
    }

    .nf-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 40px;
    }
    .nf-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 26px;
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      text-decoration: none;
      border: 1px solid var(--gold);
      transition: background 0.2s ease, color 0.2s ease, transform 0.12s ease;
    }
    .nf-btn-primary { background: var(--gold); color: #fff; }
    .nf-btn-primary:hover { background: var(--gold-dim); border-color: var(--gold-dim); }
    .nf-btn-ghost { background: transparent; color: var(--cream); border-color: var(--border); }
    .nf-btn-ghost:hover { border-color: var(--gold); color: var(--gold); }
    .nf-btn:active { transform: translateY(1px); }

    .nf-links {
      display: flex;
      gap: 24px;
      justify-content: center;
      padding-top: 26px;
      border-top: 1px solid var(--border2);
    }
    .nf-links a {
      font-size: 13px;
      color: var(--muted);
      text-decoration: none;
    }
    .nf-links a:hover { color: var(--gold); }

    @media (prefers-reduced-motion: reduce) {
      .nf-btn { transition: none; }
    }
    @media (max-width: 640px) {
      .nf-page { padding: 64px 20px 88px; }
      .nf-actions { flex-direction: column; }
      .nf-btn { width: 100%; }
    }
  `],
})
export class NotFoundComponent {
  private readonly i18n = inject(I18nService);
  private readonly seo = inject(SeoService);
  readonly locale = inject(LocaleService);

  readonly t = (key: string): string => this.i18n.t(key);

  // Field initializer, so the effect is owned by this component's injector and
  // is torn down on navigation, and re-runs when the locale flips.
  private readonly seoTags = this.seo.watch(() => ({
    title: this.i18n.t('notFound.title'),
    description: this.i18n.t('notFound.body'),
    noIndex: true,
    // No canonical override: the canonical stays on the requested dead URL,
    // which is correct. Pointing it at the homepage would recreate exactly the
    // duplicate-of-homepage signal the old redirect produced.
    jsonLd: null,
  }));
}
