import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { HomeCollectionTileContent } from '../../models/home-content.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface StorefrontCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  imageUrl: string | null;
  productIds: string[];
}

const FEATURED_COLLECTION_HANDLES = ['men', 'sunglasses', 'kids'];

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router       = inject(Router);
  private readonly http         = inject(HttpClient);
  private readonly i18n         = inject(I18nService);
  readonly locale               = inject(LocaleService);
  readonly homeContent          = inject(HomeContentService);
  private readonly apiBase      = this.resolveApiBase();

  private metaTimer: number | undefined;
  private heroSwipeStart: { x: number; y: number; pointerId: number } | null = null;
  private heroGeometryObserver: ResizeObserver | undefined;
  private heroGeometryFrame: number | undefined;
  private heroCalloutChanges: Subscription | undefined;

  @ViewChild('heroStage') private heroStageElement?: ElementRef<HTMLElement>;
  @ViewChild('heroProduct') private heroProductElement?: ElementRef<HTMLElement>;
  @ViewChildren('heroCallout') private heroCalloutElements!: QueryList<ElementRef<HTMLElement>>;

  readonly metaVisible         = signal(false);
  readonly activeHeroItemIndex = signal(0);
  readonly contentData         = this.homeContent.contentData;
  readonly layoutSections      = this.homeContent.layoutSections;
  readonly collectionTiles     = signal<HomeCollectionTileContent[]>([]);
  readonly collectionsLoaded   = signal(false);
  readonly pageReady           = computed(() => !this.homeContent.loading() && this.collectionsLoaded());

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

  readonly isArabic = computed(() => this.locale.locale() === 'ar');
  private readonly mobileFeatureIcons: Record<string, string> = {
    strap: 'assets/home-feature-icons/leather.svg',
    buckle: 'assets/home-feature-icons/buckle.svg',
    sole: 'assets/home-feature-icons/sole.svg',
    stitching: 'assets/home-feature-icons/stitching.svg',
  };
  private readonly heroCalloutTargets: Record<string, { x: number; y: number; side: 'left' | 'right' }> = {
    strap: { x: 0.28, y: 0.50, side: 'left' },
    buckle: { x: 0.49, y: 0.63, side: 'right' },
    stitching: { x: 0.27, y: 0.82, side: 'left' },
    sole: { x: 0.84, y: 0.66, side: 'right' },
  };

  calloutDelay(id: string): string {
    return this._calloutDelays[id] ?? '0.5s';
  }

  calloutTitle(callout: { titleEn?: string; titleAr?: string; subtitleEn?: string }): string {
    return this.isArabic()
      ? (callout.titleAr || callout.subtitleEn || '')
      : (callout.titleEn || callout.subtitleEn || callout.titleAr || '');
  }

  mobileFeatureIcon(calloutId: string): string {
    return this.mobileFeatureIcons[calloutId] || this.mobileFeatureIcons['strap'];
  }

  heroSubtitle(item: { subtitle?: string }): string {
    const value = (item.subtitle || '').trim();
    if (!value) return '';
    const parts = value.split('/').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return value;
    return this.isArabic() ? parts[0] : parts[1];
  }

  ngOnInit(): void {
    void this.loadCollectionTiles();
    void this.homeContent.refresh(true).then(() => this.preloadHeroAssets());
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngAfterViewInit(): void {
    this.heroCalloutChanges = this.heroCalloutElements.changes.subscribe(() => this.observeHeroGeometry());
    this.observeHeroGeometry();
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.heroGeometryFrame) cancelAnimationFrame(this.heroGeometryFrame);
    this.heroGeometryObserver?.disconnect();
    this.heroCalloutChanges?.unsubscribe();
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

  private async loadCollectionTiles(): Promise<void> {
    this.collectionsLoaded.set(false);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<StorefrontCollection[]>>(`${this.apiBase}/collections?limit=12`),
      );
      const rows = Array.isArray(res.data) ? res.data : [];
      const filtered = rows.filter((row) => row.handle !== 'all-products');
      const ordered: StorefrontCollection[] = [];

      for (const handle of FEATURED_COLLECTION_HANDLES) {
        const match = filtered.find((row) => row.handle === handle);
        if (match && !ordered.some((row) => row.id === match.id)) ordered.push(match);
      }

      for (const row of filtered) {
        if (ordered.length >= 3) break;
        if (ordered.some((item) => item.id === row.id)) continue;
        ordered.push(row);
      }

      this.collectionTiles.set(ordered.slice(0, 3).map((row) => ({
        id: row.id,
        title: row.title,
        imageUrl: this.resolveMediaUrl(row.imageUrl),
        link: `/collection/${row.handle}`,
      })));
    } catch {
      this.collectionTiles.set([]);
    } finally {
      this.collectionsLoaded.set(true);
    }
  }

  private isHeroControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button') !== null;
  }

  private observeHeroGeometry(): void {
    this.heroGeometryObserver?.disconnect();
    this.heroGeometryObserver = new ResizeObserver(() => this.scheduleHeroLineUpdate());

    const stage = this.heroStageElement?.nativeElement;
    const product = this.heroProductElement?.nativeElement;
    if (stage) this.heroGeometryObserver.observe(stage);
    if (product) this.heroGeometryObserver.observe(product);
    this.heroCalloutElements?.forEach(({ nativeElement }) => this.heroGeometryObserver?.observe(nativeElement));
    this.scheduleHeroLineUpdate();
  }

  private scheduleHeroLineUpdate(): void {
    if (this.heroGeometryFrame) cancelAnimationFrame(this.heroGeometryFrame);
    this.heroGeometryFrame = requestAnimationFrame(() => {
      this.heroGeometryFrame = undefined;
      this.updateHeroLines();
    });
  }

  private updateHeroLines(): void {
    const product = this.heroProductElement?.nativeElement;
    if (!product || window.matchMedia('(max-width: 760px)').matches) return;

    this.heroCalloutElements.forEach(({ nativeElement: callout }) => {
      const id = callout.dataset['calloutId'] || '';
      const target = this.heroCalloutTargets[id];
      const pill = callout.querySelector<HTMLElement>('.callout-pill');
      if (!target || !pill) return;

      const startX = callout.offsetLeft + pill.offsetLeft
        + (target.side === 'left' ? pill.offsetWidth - 9 : 9);
      const startY = callout.offsetTop + pill.offsetTop + (pill.offsetHeight / 2);
      const targetX = product.offsetLeft + (product.offsetWidth * target.x);
      const targetY = product.offsetTop + (product.offsetHeight * target.y);
      const deltaX = targetX - startX;
      const deltaY = targetY - startY;
      const angle = target.side === 'left'
        ? Math.atan2(deltaY, deltaX)
        : Math.atan2(-deltaY, -deltaX);

      callout.style.setProperty('--callout-line-width', `${Math.hypot(deltaX, deltaY)}px`);
      callout.style.setProperty('--callout-line-top', '50%');
      callout.style.setProperty('--callout-line-rotate', `${angle * 180 / Math.PI}deg`);
    });
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

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  private resolveMediaUrl(url: string | null): string {
    const value = (url || '').trim();
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/uploads/')) return value;

    return `${this.apiBase}${value}`;
  }
}
