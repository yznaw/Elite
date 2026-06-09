import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { HomeCollectionTileContent } from '../../models/home-content.model';

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router       = inject(Router);
  private readonly i18n         = inject(I18nService);
  readonly locale               = inject(LocaleService);
  private readonly homeContent  = inject(HomeContentService);

  private metaTimer: number | undefined;
  private heroSwipeStart: { x: number; y: number; pointerId: number } | null = null;

  readonly metaVisible         = signal(false);
  readonly activeHeroItemIndex = signal(0);
  readonly contentData         = this.homeContent.contentData;
  readonly layoutSections      = this.homeContent.layoutSections;

  // ── Hero slider — read from API, fallback to model defaults ─────────────
  readonly heroItems    = computed(() => this.contentData().heroSlider.items);
  readonly heroCtaLabel = computed(() =>
    this.locale.locale() === 'ar'
      ? (this.contentData().heroSlider.ctaAr  || 'تسوّق المجموعة')
      : (this.contentData().heroSlider.ctaEn  || 'Shop the Collection')
  );
  readonly activeHeroItem    = computed(() => this.heroItems()[this.activeHeroItemIndex()] ?? this.heroItems()[0]);
  // Each slide has its own callouts array
  readonly activeHeroCallouts = computed(() => this.activeHeroItem()?.callouts ?? []);

  // ── Promise cards & stats — read from API ───────────────────────────────
  readonly promiseCards = computed(() => this.contentData().promise.cards);
  readonly statItems    = computed(() => this.contentData().stats);

  readonly t = (key: string): string => this.i18n.t(key);

  private readonly _calloutDelays: Record<string, string> = {
    strap: '0.34s', buckle: '0.48s', sole: '0.76s', stitching: '0.62s',
  };

  calloutDelay(id: string): string {
    return this._calloutDelays[id] ?? '0.5s';
  }

  ngOnInit(): void {
    void this.homeContent.refresh(true);
    this.preloadHeroAssets();
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  selectAdjacentHeroItem(direction: -1 | 1): void {
    this.activeHeroItemIndex.update((i) => (i + direction + this.heroItems().length) % this.heroItems().length);
  }

  onHeroPointerDown(event: PointerEvent): void {
    if (this.isHeroControl(event.target)) return;
    this.heroSwipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  onHeroPointerUp(event: PointerEvent): void {
    const start = this.heroSwipeStart;
    this.heroSwipeStart = null;
    if (!start || start.pointerId !== event.pointerId || this.isHeroControl(event.target)) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    this.selectAdjacentHeroItem(dx < 0 ? 1 : -1);
  }

  onHeroPointerCancel(event: PointerEvent): void {
    if (this.heroSwipeStart?.pointerId === event.pointerId) this.heroSwipeStart = null;
  }

  goToContentLink(link: string): void {
    const target = link?.trim() || '/collection';
    if (/^https?:\/\//i.test(target)) { window.location.href = target; return; }
    void this.router.navigateByUrl(target);
    window.scrollTo(0, 0);
  }

  goToCollectionTile(tile: HomeCollectionTileContent): void {
    this.goToContentLink(this.collectionTileRoute(tile));
  }

  private collectionTileRoute(tile: HomeCollectionTileContent): string {
    const link = tile.link?.trim();
    if (link && /^https?:\/\//i.test(link)) return link;
    const fallbackHandle = this.collectionHandle(tile.id || tile.title);
    if (!link) return `/collection/${fallbackHandle}`;
    try {
      const url = new URL(link, window.location.origin);
      const detailMatch = url.pathname.match(/^\/collection\/([^/?#]+)/);
      if (detailMatch?.[1]) return `/collection/${detailMatch[1]}`;
      if (url.pathname === '/collection') {
        const key = url.searchParams.get('collection') || url.searchParams.get('category') || tile.title || fallbackHandle;
        return `/collection/${this.collectionHandle(key)}`;
      }
    } catch { /* ignore */ }
    return link;
  }

  private collectionHandle(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
  }

  private isHeroControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button') !== null;
  }

  toWebp(url: string): string {
    return url.replace(/\.(png|jpe?g)$/i, '.webp');
  }

  private preloadHeroAssets(): void {
    const firstUrl = this.heroItems()[0]?.imageUrl;
    if (!firstUrl) return;
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'image'; link.type = 'image/webp';
    link.href = this.toWebp(firstUrl);
    document.head.appendChild(link);
  }
}
