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
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { HomeCollectionTileContent, HeroColorContent } from '../../models/home-content.model';
import { colorKey } from '../../utils/color-slug';
import { resolveClientMediaUrl } from '../../utils/media-url';

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

/** Mirrors the 1500ms hint keyframes and their two iterations in the SCSS. */
const HERO_PEEK_DURATION_MS = 1500;
const HERO_PEEK_ITERATIONS = 2;
/** Matches the release transition on `.is-peek-releasing`. */
const HERO_PEEK_RELEASE_MS = 180;
/** Teach the swipe once per visit rather than on every return to the home page. */
const HERO_HINT_SESSION_KEY = 'elite:hero-swipe-hint-shown';

@Component({
    selector: 'cw-home',
    imports: [CommonModule],
    templateUrl: './home.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router       = inject(Router);
  private readonly http         = inject(HttpClient);
  private readonly i18n         = inject(I18nService);
  readonly locale               = inject(LocaleService);
  readonly homeContent          = inject(HomeContentService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly apiBase      = this.resolveApiBase();

  private metaTimer: number | undefined;
  private heroSwipeHintTimer: number | undefined;
  private heroSwipeHintDismissTimer: number | undefined;
  private heroSwipeHintPreparing = false;
  private heroSwipeHintShown = false;
  private heroPeekReleaseTimer: number | undefined;
  private heroPeekReleaseFrame: number | undefined;
  /** Set once the visitor swipes or uses the pagination: the hint has no job then. */
  private heroInteracted = false;
  private componentDestroyed = false;
  private heroMobileMedia: MediaQueryList | undefined;
  private heroColorSwapTimer: number | undefined;
  private heroColorRequestId = 0;
  private heroSlideRequestId = 0;
  private readonly heroImageLoads = new Map<string, Promise<void>>();
  private heroSwipeStart: { x: number; y: number; pointerId: number } | null = null;
  private heroGeometryObserver: ResizeObserver | undefined;
  private heroGeometryFrame: number | undefined;
  private heroCalloutChanges: Subscription | undefined;
  private readonly onHeroMobileViewportChange = (event: MediaQueryListEvent): void => {
    if (event.matches && this.pageReady()) {
      this.scheduleHeroSwipeHint();
    } else if (!event.matches) {
      this.dismissHeroSwipeHint();
    }
  };

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
  readonly nextHeroItem      = computed(() => {
    const items = this.heroItems();
    if (items.length < 2) return items[0];
    return items[(this.activeHeroItemIndex() + 1) % items.length];
  });
  // Each slide has its own callouts array
  readonly activeHeroCallouts = computed(() => this.activeHeroItem()?.callouts ?? []);

  // Short selling copy shown under the mobile slider. Falls back to the slide's
  // callout titles so a slide saved before this field existed still reads well.
  readonly activeHeroDescription = computed(() => {
    const item = this.activeHeroItem();
    if (!item) return '';
    const direct = (this.isArabic() ? item.descriptionAr : item.descriptionEn)?.trim();
    if (direct) return direct;
    const titles = (item.callouts ?? [])
      .map((c) => this.calloutTitle(c).trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!titles.length) return '';
    return `${titles.join(this.isArabic() ? '، ' : ', ')}.`;
  });

  readonly heroSwipeHintVisible = signal(false);
  readonly heroPeekActive = signal(false);
  /** Eases the peek layers home after an interrupt instead of snapping them. */
  readonly heroPeekReleasing = signal(false);

  // ── Hero colour swatches ────────────────────────────────────────────────
  /** Colour the visitor tapped on the active slide, or '' for the slide default. */
  readonly activeHeroColorKey = signal('');
  readonly outgoingHeroImage = signal('');
  readonly heroColorLoadingKey = signal('');

  /**
   * Featured swatches for the active slide. A colour with no hex and no swatch
   * image in ref_colors is dropped rather than rendered as a blank circle; the
   * admin editor warns about this so it is visible before publish.
   */
  readonly activeHeroSwatches = computed(() => {
    const item = this.activeHeroItem();
    if (!item?.productId) return [];
    const hexByName = this.referenceData.colorHexByName();
    const imageByName = this.referenceData.colorSwatchImageByName();

    return (item.colors ?? []).reduce<
      Array<HeroColorContent & { key: string; hex: string; image: string }>
    >((acc, color) => {
      const key = colorKey(color.label);
      const image = imageByName[key] || '';
      const hex = hexByName[key] || '';
      // A colour with no hex and no swatch image cannot be drawn as a dot, so it
      // is skipped. The admin editor warns about this before publish.
      if (!hex && !image) return acc;
      acc.push({ ...color, key, hex, image });
      return acc;
    }, []);
  });

  /**
   * Colour the slide opens on. The server derives the slide image from this, so
   * the matching swatch reads as selected before the visitor taps anything.
   */
  readonly activeHeroDefaultColorKey = computed(() => {
    const item = this.activeHeroItem();
    if (!item) return '';
    const swatches = this.activeHeroSwatches();
    const match = swatches.find((swatch) => swatch.slug === item.defaultColorSlug);
    return (match ?? swatches[0])?.key ?? '';
  });

  /** Colour currently shown, whether tapped by the visitor or the slide default. */
  readonly activeHeroSelectedColorKey = computed(
    () => this.activeHeroColorKey() || this.activeHeroDefaultColorKey(),
  );

  /**
   * Hero image for the active slide, swapped when a colour swatch is tapped.
   * The photo comes from the slide's own colour entry, not the product gallery:
   * hero art is styled for this stage, product photos are for the detail page.
   */
  readonly activeHeroImage = computed(() => {
    const item = this.activeHeroItem();
    if (!item) return '';
    const selected = this.activeHeroColorKey();
    if (!selected) return item.imageUrl;
    const match = this.activeHeroSwatches().find((swatch) => swatch.key === selected);
    // Colours without their own hero shot keep the slide's default image.
    return match?.imageUrl || item.imageUrl;
  });

  /**
   * The trailing control is always rendered when a product is linked: it is the
   * only route from the hero into the product page now that swatches preview in
   * place instead of navigating.
   */
  readonly showHeroProductLink = computed(() => !!this.activeHeroItem()?.productId);

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
    this.heroMobileMedia = window.matchMedia('(max-width: 760px)');
    this.heroMobileMedia.addEventListener('change', this.onHeroMobileViewportChange);
    void this.referenceData.ensureColors();
    void Promise.all([
      this.loadCollectionTiles(),
      this.homeContent.refresh(true),
    ]).then(() => {
      this.preloadHeroAssets();
      this.preloadHeroColorImages();
      this.scheduleHeroSwipeHint();
    });
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngAfterViewInit(): void {
    this.heroCalloutChanges = this.heroCalloutElements.changes.subscribe(() => this.observeHeroGeometry());
    this.observeHeroGeometry();
  }

  ngOnDestroy(): void {
    this.componentDestroyed = true;
    this.heroMobileMedia?.removeEventListener('change', this.onHeroMobileViewportChange);
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.heroSwipeHintTimer) clearTimeout(this.heroSwipeHintTimer);
    if (this.heroSwipeHintDismissTimer) clearTimeout(this.heroSwipeHintDismissTimer);
    if (this.heroPeekReleaseTimer) clearTimeout(this.heroPeekReleaseTimer);
    if (this.heroPeekReleaseFrame) cancelAnimationFrame(this.heroPeekReleaseFrame);
    if (this.heroColorSwapTimer) clearTimeout(this.heroColorSwapTimer);
    if (this.heroGeometryFrame) cancelAnimationFrame(this.heroGeometryFrame);
    this.heroGeometryObserver?.disconnect();
    this.heroCalloutChanges?.unsubscribe();
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  /**
   * Preview a colourway in place. Navigation is deliberately not triggered here:
   * only the trailing control opens the product page. Re-tapping the current
   * colour is a no-op, since every slide always shows some colour.
   */
  selectHeroColor(key: string): void {
    if (key === this.activeHeroSelectedColorKey()) {
      // A second tap on the current colour cancels any pending slow request.
      if (this.heroColorLoadingKey()) {
        this.heroColorRequestId += 1;
        this.heroColorLoadingKey.set('');
      }
      return;
    }

    const swatch = this.activeHeroSwatches().find((color) => color.key === key);
    const nextUrl = swatch?.imageUrl || this.activeHeroItem()?.imageUrl || '';
    const currentUrl = this.activeHeroImage();
    if (!nextUrl || nextUrl === currentUrl) {
      this.activeHeroColorKey.set(key);
      return;
    }

    const requestId = ++this.heroColorRequestId;
    this.heroColorLoadingKey.set(key);

    void this.ensureHeroImageReady(nextUrl).then(() => {
      if (requestId !== this.heroColorRequestId) return;

      this.outgoingHeroImage.set(currentUrl);
      this.activeHeroColorKey.set(key);
      this.heroColorLoadingKey.set('');

      if (this.heroColorSwapTimer) clearTimeout(this.heroColorSwapTimer);
      this.heroColorSwapTimer = window.setTimeout(() => {
        this.heroColorSwapTimer = undefined;
        this.outgoingHeroImage.set('');
      }, 280);
    });
  }

  /** Open the slide's product with no colour preselected, showing the full picker. */
  goToHeroProduct(): void {
    const productId = this.activeHeroItem()?.productId;
    if (!productId) return;
    void this.router.navigate(['/product', productId]);
    window.scrollTo(0, 0);
  }

  selectAdjacentHeroItem(direction: -1 | 1): void {
    this.heroInteracted = true;
    this.dismissHeroSwipeHint();
    const total = this.heroItems().length;
    if (total < 2) return;
    const targetIndex = (this.activeHeroItemIndex() + direction + total) % total;
    this.prepareHeroItem(targetIndex);
  }

  /** Jump straight to a slide from the mobile pagination control. */
  selectHeroItem(index: number): void {
    this.heroInteracted = true;
    this.dismissHeroSwipeHint();
    const total = this.heroItems().length;
    if (index < 0 || index >= total || index === this.activeHeroItemIndex()) return;
    this.prepareHeroItem(index);
  }

  onHeroPointerDown(event: PointerEvent): void {
    if (this.isHeroControl(event.target) || this.heroItems().length < 2) return;
    this.heroInteracted = true;
    this.stopHeroPeek();
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
    if (this.heroSwipeStart?.pointerId !== event.pointerId) return;
    this.heroSwipeStart = null;
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * A once-per-page teaching moment for touch layouts. It starts only after the
   * loading shell has gone, so a slower phone cannot miss the entire preview.
   * It never changes the selected slide.
   */
  private scheduleHeroSwipeHint(): void {
    if (
      this.heroSwipeHintTimer ||
      this.heroSwipeHintPreparing ||
      this.heroSwipeHintShown ||
      this.heroSwipeHintVisible() ||
      // Someone who has already swiped does not need to be taught the gesture.
      this.heroInteracted ||
      this.heroHintSeenThisSession() ||
      this.heroItems().length < 2 ||
      !window.matchMedia('(max-width: 760px)').matches
    ) {
      return;
    }

    this.heroSwipeHintPreparing = true;
    const nextImageUrl = this.nextHeroItem()?.imageUrl || '';
    void this.ensureHeroImageReady(nextImageUrl).then(() => {
      this.heroSwipeHintPreparing = false;
      if (
        this.componentDestroyed ||
        this.heroInteracted ||
        this.heroItems().length < 2 ||
        !window.matchMedia('(max-width: 760px)').matches
      ) {
        return;
      }

      // Let the finished hero settle before demonstrating its gesture.
      this.heroSwipeHintTimer = window.setTimeout(() => {
        this.heroSwipeHintTimer = undefined;
        // The visitor may have swiped during this 1400ms wait.
        if (this.componentDestroyed || this.heroInteracted) return;

        this.heroSwipeHintShown = true;
        this.markHeroHintSeen();
        this.heroSwipeHintVisible.set(true);

        const reducedMotion = this.prefersReducedMotion();
        if (!reducedMotion) {
          this.heroPeekActive.set(true);
        }

        // A buffer past the final keyframe: dismissing exactly on the animation
        // duration could pull the class on its last frame and snap the layers.
        this.heroSwipeHintDismissTimer = window.setTimeout(() => {
          this.heroSwipeHintDismissTimer = undefined;
          this.dismissHeroSwipeHint();
        }, reducedMotion
          ? 5000
          : (HERO_PEEK_DURATION_MS * HERO_PEEK_ITERATIONS) + 200);
      }, 1400);
    });
  }

  private dismissHeroSwipeHint(): void {
    if (this.heroSwipeHintTimer) {
      clearTimeout(this.heroSwipeHintTimer);
      this.heroSwipeHintTimer = undefined;
    }
    if (this.heroSwipeHintDismissTimer) {
      clearTimeout(this.heroSwipeHintDismissTimer);
      this.heroSwipeHintDismissTimer = undefined;
    }
    this.stopHeroPeek();
    this.heroSwipeHintVisible.set(false);
  }

  /**
   * Dropping the animation class alone would leave the layers wherever the
   * current frame put them and snap them to rest, which reads as a glitch when
   * the visitor swipes mid-demo. `.is-peek-releasing` transitions them home
   * instead, and is cleared once that transition has run.
   */
  private stopHeroPeek(): void {
    const wasPeeking = this.heroPeekActive();
    if (!wasPeeking) {
      this.heroPeekActive.set(false);
      return;
    }

    // Dropping the animation class alone snaps the layers to their resting
    // transform, because a CSS transition cannot interpolate away from a
    // keyframed value that has just been removed. So the live transform is
    // pinned inline first and only released once the class change has actually
    // reached the DOM.
    //
    // The pin needs `!important`: the keyframes are still running at this point
    // and a running animation outranks a plain inline style, so without it the
    // pinned value is ignored and the snap happens anyway.
    const layers = this.heroPeekLayers();
    for (const layer of layers) {
      const { transform, opacity } = getComputedStyle(layer);
      layer.style.setProperty('transform', transform, 'important');
      layer.style.setProperty('opacity', opacity, 'important');
    }

    this.heroPeekActive.set(false);
    this.heroPeekReleasing.set(true);

    if (this.heroPeekReleaseTimer) clearTimeout(this.heroPeekReleaseTimer);
    if (this.heroPeekReleaseFrame) cancelAnimationFrame(this.heroPeekReleaseFrame);
    // Two frames: the first lets Angular flush the class change and the browser
    // commit the pinned value as the starting style, the second releases it so
    // the `.is-peek-releasing` transition has something to interpolate from.
    this.heroPeekReleaseFrame = requestAnimationFrame(() => {
      this.heroPeekReleaseFrame = requestAnimationFrame(() => {
        this.heroPeekReleaseFrame = undefined;
        for (const layer of layers) {
          layer.style.removeProperty('transform');
          layer.style.removeProperty('opacity');
        }
        // Started here, not above: the transition only begins on this frame, so
        // timing it from the tap would drop the class before it finished.
        this.heroPeekReleaseTimer = window.setTimeout(() => {
          this.heroPeekReleaseTimer = undefined;
          this.heroPeekReleasing.set(false);
        }, HERO_PEEK_RELEASE_MS);
      });
    });
  }

  /** The two layers the gesture demo moves: the active product and the edge sliver. */
  private heroPeekLayers(): HTMLElement[] {
    const stage = this.heroStageElement?.nativeElement;
    if (!stage) return [];
    return [
      stage.querySelector<HTMLElement>('.hero-product__image.is-active'),
      stage.querySelector<HTMLElement>('.hero-next-peek'),
    ].filter((el): el is HTMLElement => el !== null);
  }

  /** sessionStorage is unavailable in private-mode Safari, so it never throws here. */
  private heroHintSeenThisSession(): boolean {
    try {
      return sessionStorage.getItem(HERO_HINT_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markHeroHintSeen(): void {
    try {
      sessionStorage.setItem(HERO_HINT_SESSION_KEY, '1');
    } catch {
      /* Storage blocked: the in-memory guard still prevents a repeat this view. */
    }
  }

  /**
   * Keep the current slide visible until the destination image is decoded.
   * Once ready, the existing picture layers perform a short opacity crossfade.
   */
  private prepareHeroItem(index: number): void {
    const item = this.heroItems()[index];
    if (!item) return;
    const requestId = ++this.heroSlideRequestId;

    void this.ensureHeroImageReady(item.imageUrl).then(() => {
      if (requestId !== this.heroSlideRequestId) return;
      this.cancelHeroColorSwap();
      this.activeHeroColorKey.set('');
      this.activeHeroItemIndex.set(index);
      this.preloadHeroItemImages(index);
      this.preloadAdjacentHeroImages(index);
    });
  }

  private cancelHeroColorSwap(): void {
    this.heroColorRequestId += 1;
    this.heroColorLoadingKey.set('');
    this.outgoingHeroImage.set('');
    if (this.heroColorSwapTimer) {
      clearTimeout(this.heroColorSwapTimer);
      this.heroColorSwapTimer = undefined;
    }
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

  /**
   * Warm the active colour shots plus the neighbouring slide artwork. This is
   * enough for immediate interaction without downloading every colour for all
   * five (or more) hero products on first load.
   */
  private preloadHeroColorImages(): void {
    const index = this.activeHeroItemIndex();
    this.preloadHeroItemImages(index);
    this.preloadAdjacentHeroImages(index);
  }

  private preloadHeroItemImages(index: number): void {
    const item = this.heroItems()[index];
    if (!item) return;
    const urls = new Set([
      item.imageUrl,
      ...(item.colors ?? []).map((color) => color.imageUrl),
    ]);
    for (const url of urls) {
      if (url) void this.ensureHeroImageReady(url);
    }
  }

  private preloadAdjacentHeroImages(index: number): void {
    const items = this.heroItems();
    if (items.length < 2) return;
    const adjacent = new Set([
      (index + 1) % items.length,
      (index - 1 + items.length) % items.length,
    ]);
    for (const adjacentIndex of adjacent) {
      const url = items[adjacentIndex]?.imageUrl;
      if (url) void this.ensureHeroImageReady(url);
    }
  }

  /**
   * Load the same responsive candidate that <picture> will render, then decode
   * it before changing signals. The old image therefore never disappears while
   * a `-grid.webp` or `-pdp.webp` request is still in flight.
   */
  private ensureHeroImageReady(url: string): Promise<void> {
    if (!url) return Promise.resolve();
    const layout = window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
    const cacheKey = `${layout}:${url}`;
    const existing = this.heroImageLoads.get(cacheKey);
    if (existing) return existing;

    const load = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      const srcset = this.heroSrcset(url);
      if (srcset) {
        image.sizes = this.heroSizes;
        image.srcset = srcset;
      }

      const finish = (): void => {
        if (typeof image.decode !== 'function') {
          resolve();
          return;
        }
        void image.decode().catch(() => undefined).then(() => resolve());
      };

      image.onload = finish;
      image.onerror = () => resolve();
      // Match the <source> fallback rather than warming an unused original.
      image.src = srcset ? url : this.toWebp(url);
    });

    this.heroImageLoads.set(cacheKey, load);
    return load;
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

  /**
   * Responsive srcset for an uploaded hero image.
   *
   * Uploads are stored alongside resized variants (`-card` 640, `-grid` 900,
   * `-pdp` 1400, `-zoom` 1800) next to the full-size original. The hero renders
   * up to 940px wide, so a phone needs roughly the grid variant and a retina
   * desktop the zoom variant. Without this the browser downloads the 3480px
   * original on every device.
   *
   * Returns '' for static assets and any URL that carries no variant siblings,
   * in which case the template falls back to a plain `src`.
   */
  heroSrcset(url: string): string {
    const webp = this.toWebp(url);
    // Only uploads carry variants; bundled /assets art does not.
    if (!/\/uploads\//.test(webp) || !/\.webp$/i.test(webp)) return '';

    // Strip any variant suffix so a stored `-card` URL still yields the full set.
    const base = webp.replace(/-(thumb|card|grid|pdp|zoom)\.webp$/i, '.webp');
    const stem = base.replace(/\.webp$/i, '');
    return [
      `${stem}-card.webp 640w`,
      `${stem}-grid.webp 900w`,
      `${stem}-pdp.webp 1400w`,
      `${stem}-zoom.webp 1800w`,
    ].join(', ');
  }

  /**
   * Widths the hero image actually renders at, mirroring `--mobile-product-size`
   * and `.hero-product` in the SCSS. Keep the two in step or the browser picks a
   * variant that is too small and the image renders soft.
   *
   * Deliberately free of viewport-height units: `sizes` is evaluated once at
   * parse time, so an svh term here would bake in whatever height the viewport
   * happened to have then.
   */
  readonly heroSizes = '(max-width: 760px) min(124vw, 620px), min(1120px, 82vw)';

  private preloadHeroAssets(): void {
    const firstUrl = this.heroItems()[0]?.imageUrl;
    if (!firstUrl) return;
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'image'; link.type = 'image/webp';
    link.href = this.toWebp(firstUrl);
    // Mirror the <source> so the preload and the render pick the same variant;
    // otherwise the browser fetches one image twice.
    const srcset = this.heroSrcset(firstUrl);
    if (srcset) {
      link.setAttribute('imagesrcset', srcset);
      link.setAttribute('imagesizes', this.heroSizes);
    }
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
    return resolveClientMediaUrl(url, this.apiBase);
  }
}
