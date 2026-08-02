import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { ProductsService } from '../../services/products.service';
import { HomeCollectionTileContent, HeroColorContent } from '../../models/home-content.model';
import { colorKey } from '../../utils/color-slug';
import { mediaVariantKey, resolveClientMediaUrl } from '../../utils/media-url';

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

/** Swatches drawn in the hero before the rest collapse into a `+N` chip. */
const HERO_MAX_SWATCHES = 4;

/** Keep in sync with the stacked-layout media query in home.component.scss. */
const HERO_STACKED_MAX_PX = 1023;
const HERO_STACKED_QUERY = `(max-width: ${HERO_STACKED_MAX_PX}px)`;
const HERO_COARSE_POINTER_QUERY = '(any-pointer: coarse)';
/** Mirrors the 1500ms hint keyframes and their single iteration in the SCSS. */
const HERO_PEEK_DURATION_MS = 1500;
const HERO_PEEK_ITERATIONS = 1;
/** Matches the release transition on `.is-peek-releasing`. */
const HERO_PEEK_RELEASE_MS = 180;
/**
 * Adjacent-slide keyframe duration, mirrored from home.component.scss.
 *
 * Two values, because one duration cannot serve both pointer classes. The
 * 420ms spatial cue reads well on a desktop where the arrows are clicked
 * occasionally, and badly on a phone where the same gesture is repeated: a
 * visitor swiping through five products spent over two seconds watching
 * transitions. Coarse pointers get a short crossfade instead, and reduced
 * motion gets a shorter one still.
 */
const HERO_SLIDE_TRANSITION_MS = 420;
const HERO_SLIDE_TRANSITION_COARSE_MS = 180;
const HERO_COLOR_TRANSITION_MS = 280;
const HERO_COLOR_TRANSITION_COARSE_MS = 180;
/**
 * Reduced motion is its own transition, not the absence of one. Long enough to
 * read as a change of state, short enough that nothing appears to travel.
 */
const HERO_REDUCED_TRANSITION_MS = 160;
/**
 * Removal is deliberately a little later than the fade it follows. Pulling the
 * layer on the exact duration can land on the animation's last frame and snap
 * the remaining opacity to zero, which is visible as a flick on a slow phone.
 */
const HERO_TRANSITION_CLEANUP_BUFFER_MS = 40;

/**
 * How long a decode may delay a committed swap.
 *
 * Short on purpose. Past this the image is already downloaded, so the only
 * thing still owed is a decode the compositor can do during the fade.
 */
const HERO_DECODE_DEADLINE_MS = 120;
/** Absolute ceiling on a fetch before the hero gives up and keeps what it has. */
const HERO_LOAD_DEADLINE_MS = 6000;

/** Travel before a gesture is committed to an axis. Below this it is a tap. */
const HERO_SWIPE_AXIS_LOCK_PX = 10;
/** Deliberate drag distance that completes a swipe on its own. */
const HERO_SWIPE_DISTANCE_PX = 44;
/** A flick completes below that distance if it is fast enough. */
const HERO_SWIPE_VELOCITY_PX_PER_MS = 0.5;
const HERO_SWIPE_FLICK_MIN_PX = 18;
/** Teach the swipe once per visit rather than on every return to the home page. */
const HERO_HINT_SESSION_KEY = 'elite:hero-swipe-hint-shown';

@Component({
    selector: 'cw-home',
    imports: [CommonModule],
    templateUrl: './home.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router       = inject(Router);
  private readonly http         = inject(HttpClient);
  private readonly i18n         = inject(I18nService);
  readonly locale               = inject(LocaleService);
  readonly homeContent          = inject(HomeContentService);
  private readonly referenceData = inject(ReferenceDataService);
  private readonly productsService = inject(ProductsService);
  private readonly apiBase      = this.resolveApiBase();

  private metaTimer: number | undefined;
  private heroSwipeHintTimer: number | undefined;
  private heroSwipeHintDismissTimer: number | undefined;
  private heroSwipeHintPreparing = false;
  private heroSwipeHintShown = false;
  private heroPeekReleaseTimer: number | undefined;
  private heroPeekReleaseFrame: number | undefined;
  private heroSlideTransitionTimer: number | undefined;
  private heroStageObserver: IntersectionObserver | undefined;
  private heroStageObserverFrame: number | undefined;
  private heroStageVisible = false;
  /** Set once the visitor swipes or uses the pagination: the hint has no job then. */
  private heroInteracted = false;
  private componentDestroyed = false;
  private heroStackedMedia: MediaQueryList | undefined;
  private heroColorSwapTimer: number | undefined;
  private heroColorRequestId = 0;
  private heroSlideRequestId = 0;
  private readonly heroImageLoads = new Map<string, Promise<void>>();
  /** Strong references to in-flight preloads, so none is collected mid-fetch. */
  private readonly heroImageElements = new Set<HTMLImageElement>();
  private heroSwipeStart: {
    x: number;
    y: number;
    pointerId: number;
    time: number;
    axis: 'undecided' | 'horizontal' | 'vertical';
  } | null = null;
  private heroCapturedPointer: { element: Element; pointerId: number } | null = null;
  private heroReducedMotionMedia: MediaQueryList | undefined;
  private readonly onHeroMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.heroReducedMotion.set(event.matches);
    // Switching the OS setting mid-transition would otherwise leave the layer
    // that the outgoing path owns behind, because the two paths clean up on
    // different signals. Settle to the committed state and start clean.
    this.settleHeroTransitions();
  };
  private readonly onHeroStackedViewportChange = (event: MediaQueryListEvent): void => {
    if (event.matches && this.pageReady()) {
      this.scheduleHeroSwipeHint();
    } else if (!event.matches) {
      this.dismissHeroSwipeHint();
    }
  };

  @ViewChild('heroStage') private heroStageElement?: ElementRef<HTMLElement>;

  readonly metaVisible         = signal(false);
  /** The slide on screen. Moves only once its image has decoded. */
  readonly activeHeroItemIndex = signal(0);
  /**
   * The slide the visitor has asked for. Moves on the tap.
   *
   * Splitting intent from the committed index is what makes a burst of taps
   * deterministic: each tap steps this, the decode races settle in whatever
   * order they finish, and only the newest request is allowed to commit. The
   * pagination reads from this so the control acknowledges the tap immediately
   * rather than appearing dead until the image lands.
   */
  readonly heroPendingItemIndex = signal(0);
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

  /**
   * Short selling copy under the product. Empty renders nothing rather than a
   * blank line: the admin seeds this from the product's short description when a
   * slide is linked, so an empty value means the editor cleared it on purpose.
   */
  readonly activeHeroDescription = computed(() => {
    const item = this.activeHeroItem();
    if (!item) return '';
    return (this.isArabic() ? item.descriptionAr : item.descriptionEn)?.trim() ?? '';
  });

  /**
   * Live motion preference.
   *
   * A signal rather than a `matchMedia()` call at each use site: iOS lets the
   * visitor toggle Reduce Motion from Control Center without reloading, and a
   * transition started under one mode has to be cleaned up under the same one.
   * Reading the query fresh mid-transition could pick opposite branches for the
   * start and the cleanup of the same swap, which is how a colour layer got
   * stranded on screen.
   */
  readonly heroReducedMotion = signal(false);

  readonly heroSwipeHintVisible = signal(false);
  readonly heroPeekActive = signal(false);
  /** Eases the peek layers home after an interrupt instead of snapping them. */
  readonly heroPeekReleasing = signal(false);
  /** Adjacent navigation only: pagination and colour changes stay a plain fade. */
  readonly heroSlideDirection = signal<-1 | 0 | 1>(0);
  readonly outgoingHeroItemId = signal('');

  // ── Hero colour swatches ────────────────────────────────────────────────
  /** Colour the visitor tapped on the active slide, or '' for the slide default. */
  readonly activeHeroColorKey = signal('');
  readonly outgoingHeroImage = signal('');
  readonly heroColorLoadingKey = signal('');

  /**
   * Featured swatches for the active slide.
   *
   * A colour missing from `ref_colors` has neither a hex nor a swatch image and
   * so cannot be drawn as a coloured disc. It used to be dropped here. That was
   * worse than it sounds: on a slide where *every* featured colour was unmapped
   * the template's `@if` saw an empty array and removed the whole block, heading
   * and all, so an entire row of the composition disappeared and the rows below
   * it shifted up. One unmapped colour silently restructured the hero.
   *
   * It is now kept and flagged, and the template draws a neutral placeholder.
   * The customer still learns the colourway exists, the layout keeps its shape,
   * and the admin blocks publish on it rather than the storefront hiding it.
   */
  readonly activeHeroSwatches = computed(() => {
    const item = this.activeHeroItem();
    if (!item?.productId) return [];
    const hexByName = this.referenceData.colorHexByName();
    const imageByName = this.referenceData.colorSwatchImageByName();

    return (item.colors ?? []).map((color) => {
      const key = colorKey(color.label);
      const image = imageByName[key] || '';
      const hex = hexByName[key] || '';
      return { ...color, key, hex, image, unmapped: !hex && !image };
    });
  });

  /**
   * The swatches actually drawn. Capped so the row never wraps: four 44px targets
   * plus their gaps measure 212px against 337px of content width at 390px wide,
   * which leaves room for the overflow chip beside them.
   */
  readonly visibleHeroSwatches = computed(() =>
    this.activeHeroSwatches().slice(0, HERO_MAX_SWATCHES)
  );

  /**
   * Every colourway the product actually sells, which is the number the chip has
   * to count against.
   *
   * It cannot come from `item.colors`: that array is the admin's *featured*
   * selection and the editor hard-caps it at four, so subtracting the cap from
   * it always yields zero and the chip could never appear. The real total lives
   * on the product record, read through `ProductsService` so a colour added in
   * the admin is reflected on the next refresh without a template change.
   */
  readonly activeHeroProductColorCount = computed(() => {
    const productId = this.activeHeroItem()?.productId;
    if (!productId) return 0;
    const product = this.productsService.products().find((p) => p.id === productId);
    if (!product) return 0;
    // Deduplicated on the same key the swatches use, so a casing or spacing
    // difference between the product record and the featured list cannot
    // inflate the remainder.
    const unique = new Set(
      (product.colors ?? []).map((label) => colorKey(String(label))).filter(Boolean)
    );
    return unique.size;
  });

  /**
   * Colourways the visitor cannot see in the hero. Drives the `+N` chip, which
   * is rendered only when this is above zero: a permanently visible control that
   * sometimes means "nothing more" is the ambiguity the bare `+` had.
   */
  readonly hiddenHeroSwatchCount = computed(() =>
    Math.max(0, this.activeHeroProductColorCount() - this.visibleHeroSwatches().length)
  );

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
  readonly activeHeroSelectedColorLabel = computed(() => {
    const selected = this.activeHeroSelectedColorKey();
    return this.activeHeroSwatches().find((swatch) => swatch.key === selected)?.label ?? '';
  });
  readonly heroPositionLabel = computed(() => {
    const total = this.heroItems().length;
    const width = Math.max(2, String(total).length);
    return `${String(this.activeHeroItemIndex() + 1).padStart(width, '0')} / ${String(total).padStart(width, '0')}`;
  });

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

  readonly t = (
    key: string,
    params?: Record<string, string | number>,
  ): string => this.i18n.t(key, params);

  readonly isArabic = computed(() => this.locale.locale() === 'ar');

  ngOnInit(): void {
    this.heroStackedMedia = window.matchMedia(HERO_STACKED_QUERY);
    this.heroStackedMedia.addEventListener('change', this.onHeroStackedViewportChange);
    this.heroReducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.heroReducedMotion.set(this.heroReducedMotionMedia.matches);
    this.heroReducedMotionMedia.addEventListener('change', this.onHeroMotionPreferenceChange);
    void this.referenceData.ensureColors();
    // Feeds the `+N` colour chip. The service caches for 60s and revalidates on
    // return, so an admin adding a colourway shows up without a hard reload.
    void this.productsService.ensureLoaded();
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

  ngOnDestroy(): void {
    this.componentDestroyed = true;
    this.heroStageObserver?.disconnect();
    if (this.heroStageObserverFrame) cancelAnimationFrame(this.heroStageObserverFrame);
    this.heroStackedMedia?.removeEventListener('change', this.onHeroStackedViewportChange);
    this.heroReducedMotionMedia?.removeEventListener('change', this.onHeroMotionPreferenceChange);
    // A capture held past teardown keeps the browser routing events at a
    // detached element.
    this.endHeroSwipe();
    if (this.metaTimer) clearTimeout(this.metaTimer);
    if (this.heroSwipeHintTimer) clearTimeout(this.heroSwipeHintTimer);
    if (this.heroSwipeHintDismissTimer) clearTimeout(this.heroSwipeHintDismissTimer);
    if (this.heroPeekReleaseTimer) clearTimeout(this.heroPeekReleaseTimer);
    if (this.heroPeekReleaseFrame) cancelAnimationFrame(this.heroPeekReleaseFrame);
    if (this.heroColorSwapTimer) clearTimeout(this.heroColorSwapTimer);
    if (this.heroSlideTransitionTimer) clearTimeout(this.heroSlideTransitionTimer);
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

      // The removal timer has to agree with whichever fade the CSS is actually
      // running, or the outgoing colourway is either cut off mid-fade or left
      // sitting fully opaque over the new one. Both durations therefore come
      // from the same resolver the stylesheet mirrors.
      if (this.heroColorSwapTimer) clearTimeout(this.heroColorSwapTimer);
      this.heroColorSwapTimer = window.setTimeout(() => {
        this.heroColorSwapTimer = undefined;
        this.outgoingHeroImage.set('');
      }, this.heroColorTransitionMs() + HERO_TRANSITION_CLEANUP_BUFFER_MS);
    });
  }

  /** Open the active product and carry the colour currently previewed in the hero. */
  goToHeroProduct(): void {
    const productId = this.activeHeroItem()?.productId;
    if (!productId) return;
    const selectedKey = this.activeHeroSelectedColorKey();
    const selected = this.activeHeroSwatches().find((color) => color.key === selectedKey);
    void this.router.navigate(['/product', productId], {
      queryParams: selected?.slug ? { color: selected.slug } : undefined,
    });
    window.scrollTo(0, 0);
  }

  selectAdjacentHeroItem(direction: -1 | 1, event?: MouseEvent): void {
    this.heroInteracted = true;
    this.dismissHeroSwipeHint();
    const total = this.heroItems().length;
    if (total < 2) return;
    // Step from the pending intent, not from the committed slide. The committed
    // index only moves once the destination image has decoded, so on a slow
    // connection every tap in a burst used to compute the same neighbour and
    // five taps advanced one slide. Intent advances on the tap; the commit
    // follows whenever the pixels are ready.
    // Clamped because the slider content can be refreshed from the admin while
    // a request is pending, which can leave the intent pointing past the end.
    const base = Math.min(this.heroPendingItemIndex(), total - 1);
    const targetIndex = (base + direction + total) % total;
    // A keyboard-generated click has detail 0. Keep repeated keyboard actions
    // immediate; pointer clicks and real swipes receive the spatial cue.
    this.prepareHeroItem(targetIndex, !event || event.detail !== 0 ? direction : 0);
  }

  /** Jump straight to a slide from the mobile pagination control. */
  selectHeroItem(index: number): void {
    this.heroInteracted = true;
    this.dismissHeroSwipeHint();
    const total = this.heroItems().length;
    // Compared against intent so that tapping the segment for a slide already
    // being loaded is a no-op rather than a second request for it.
    if (index < 0 || index >= total || index === this.heroPendingItemIndex()) return;
    this.prepareHeroItem(index);
  }

  /**
   * Claim a gesture, or decline it.
   *
   * Only the primary pointer can start a swipe. A second finger landing on the
   * stage used to overwrite the start point, so a pinch resolved as a long
   * horizontal drag and changed the slide underneath the zoom. Extra pointers
   * are now ignored outright and the first one keeps ownership until it ends.
   */
  onHeroPointerDown(event: PointerEvent): void {
    if (!event.isPrimary) return;
    if (this.isHeroControl(event.target) || this.heroItems().length < 2) return;
    // A gesture already in flight owns the stage. Do not restart from here.
    if (this.heroSwipeStart) return;
    this.heroInteracted = true;
    this.stopHeroPeek();
    this.heroSwipeStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      time: event.timeStamp,
      axis: 'undecided',
    };
  }

  /**
   * Lock the gesture to an axis, once, as soon as it has travelled far enough
   * to be readable.
   *
   * The axis matters because the two outcomes are mutually exclusive: a
   * horizontal gesture becomes a slide change and takes pointer capture so a
   * finger that wanders off the stage still completes it, while a vertical one
   * is the page scroll and must be released back to the browser immediately.
   * Deciding this at pointerup instead, as the previous implementation did,
   * meant a diagonal drag scrolled the page *and* changed the slide.
   */
  onHeroPointerMove(event: PointerEvent): void {
    const start = this.heroSwipeStart;
    if (!start || start.pointerId !== event.pointerId) return;
    if (start.axis !== 'undecided') return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < HERO_SWIPE_AXIS_LOCK_PX && Math.abs(dy) < HERO_SWIPE_AXIS_LOCK_PX) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      start.axis = 'horizontal';
      // Capture only now that the gesture is definitely ours. Capturing on
      // pointerdown would swallow taps meant for the page.
      try {
        (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
        this.heroCapturedPointer = {
          element: event.currentTarget as Element,
          pointerId: event.pointerId,
        };
      } catch {
        /* Capture is an optimisation: the gesture still completes without it. */
      }
    } else {
      // Vertical wins: this is a scroll, not a swipe. Stop tracking so the rest
      // of the drag cannot accumulate enough horizontal travel to fire a slide.
      start.axis = 'vertical';
      this.endHeroSwipe();
    }
  }

  onHeroPointerUp(event: PointerEvent): void {
    const start = this.heroSwipeStart;
    if (!start || start.pointerId !== event.pointerId) {
      this.endHeroSwipe();
      return;
    }
    this.endHeroSwipe();
    if (start.axis === 'vertical' || this.isHeroControl(event.target)) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < Math.abs(dy) * 1.4) return;

    // Distance is the deliberate drag. Velocity is the flick: a short, fast
    // gesture that never reaches 44px still reads as intentional, and only
    // accepting distance made the hero feel unresponsive to a quick swipe.
    const elapsed = Math.max(1, event.timeStamp - start.time);
    const velocity = Math.abs(dx) / elapsed;
    const travelled = Math.abs(dx) >= HERO_SWIPE_DISTANCE_PX;
    const flicked = velocity >= HERO_SWIPE_VELOCITY_PX_PER_MS
      && Math.abs(dx) >= HERO_SWIPE_FLICK_MIN_PX;
    if (!travelled && !flicked) return;

    this.selectAdjacentHeroItem(dx < 0 ? 1 : -1);
  }

  onHeroPointerCancel(event: PointerEvent): void {
    if (this.heroSwipeStart?.pointerId !== event.pointerId) return;
    this.endHeroSwipe();
  }

  /**
   * The browser can take a capture away without a pointerup ever arriving, for
   * instance when a system gesture or a scroll wins. Without this the tracker
   * kept a stale start point and the next unrelated tap resolved as a swipe.
   */
  onHeroPointerCaptureLost(event: PointerEvent): void {
    if (this.heroSwipeStart?.pointerId !== event.pointerId) return;
    this.endHeroSwipe();
  }

  /** Single exit for every way a gesture can finish, including teardown. */
  private endHeroSwipe(): void {
    const captured = this.heroCapturedPointer;
    this.heroCapturedPointer = null;
    this.heroSwipeStart = null;
    if (!captured) return;
    try {
      if (captured.element.hasPointerCapture?.(captured.pointerId)) {
        captured.element.releasePointerCapture(captured.pointerId);
      }
    } catch {
      /* Already released, or the element is gone with the component. */
    }
  }

  /**
   * A once-per-page teaching moment for touch layouts. It starts only after the
   * loading shell has gone, so a slower phone cannot miss the entire preview.
   * It never changes the selected slide.
   */
  private scheduleHeroSwipeHint(): void {
    this.ensureHeroStageObserver();
    if (
      this.heroSwipeHintTimer ||
      this.heroSwipeHintPreparing ||
      this.heroSwipeHintShown ||
      this.heroSwipeHintVisible() ||
      // Someone who has already swiped does not need to be taught the gesture.
      this.heroInteracted ||
      this.heroHintSeenThisSession() ||
      this.heroItems().length < 2 ||
      !this.heroStageVisible ||
      !this.heroSwipeHintEligible()
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
        !this.heroStageVisible ||
        !this.heroSwipeHintEligible()
      ) {
        return;
      }

      // Let the finished hero settle before demonstrating its gesture.
      this.heroSwipeHintTimer = window.setTimeout(() => {
        this.heroSwipeHintTimer = undefined;
        // The visitor may have swiped during this 1400ms wait.
        if (this.componentDestroyed || this.heroInteracted || !this.heroStageVisible) return;

        this.heroSwipeHintShown = true;
        this.markHeroHintSeen();
        this.heroSwipeHintVisible.set(true);

        const reducedMotion = this.heroReducedMotion();
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

  private heroSwipeHintEligible(): boolean {
    return window.matchMedia(HERO_STACKED_QUERY).matches
      && window.matchMedia(HERO_COARSE_POINTER_QUERY).matches;
  }

  /**
   * Do not spend the once-per-session gesture lesson off-screen. The observer
   * cancels the pending timer while the stage is out of view and schedules a
   * fresh attempt when the visitor returns.
   */
  private ensureHeroStageObserver(): void {
    if (this.heroStageObserver) return;
    const stage = this.heroStageElement?.nativeElement;
    if (!stage) {
      if (!this.heroStageObserverFrame && !this.componentDestroyed) {
        this.heroStageObserverFrame = requestAnimationFrame(() => {
          this.heroStageObserverFrame = undefined;
          this.ensureHeroStageObserver();
        });
      }
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      this.heroStageVisible = true;
      return;
    }

    this.heroStageObserver = new IntersectionObserver(([entry]) => {
      const visible = !!entry?.isIntersecting && entry.intersectionRatio >= 0.45;
      this.heroStageVisible = visible;
      if (visible) {
        this.scheduleHeroSwipeHint();
      } else {
        this.dismissHeroSwipeHint();
      }
    }, { threshold: [0, 0.45] });
    this.heroStageObserver.observe(stage);
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
  private prepareHeroItem(index: number, direction: -1 | 0 | 1 = 0): void {
    const item = this.heroItems()[index];
    if (!item) return;
    // Intent is published before the await so the next tap in a burst steps
    // from here, and so the pagination reflects where the hero is heading.
    this.heroPendingItemIndex.set(index);
    const requestId = ++this.heroSlideRequestId;

    void this.ensureHeroImageReady(item.imageUrl).then(() => {
      // Only the newest request may commit. An earlier, slower image arriving
      // late must not overwrite a destination the visitor has since changed.
      if (requestId !== this.heroSlideRequestId) return;
      this.cancelHeroColorSwap();
      this.beginHeroSlideTransition(direction);
      this.activeHeroColorKey.set('');
      this.activeHeroItemIndex.set(index);
      this.preloadHeroItemImages(index);
      this.preloadAdjacentHeroImages(index);
    });
  }

  /**
   * Spatial cue duration for the current input and motion mode.
   *
   * Returning zero means "no spatial transition": the layers cross-fade through
   * their base CSS instead. That is the coarse-pointer and reduced-motion path.
   */
  private heroSlideTransitionMs(): number {
    if (this.heroReducedMotion()) return 0;
    return window.matchMedia(HERO_COARSE_POINTER_QUERY).matches
      ? HERO_SLIDE_TRANSITION_COARSE_MS
      : HERO_SLIDE_TRANSITION_MS;
  }

  private heroColorTransitionMs(): number {
    if (this.heroReducedMotion()) return HERO_REDUCED_TRANSITION_MS;
    return window.matchMedia(HERO_COARSE_POINTER_QUERY).matches
      ? HERO_COLOR_TRANSITION_COARSE_MS
      : HERO_COLOR_TRANSITION_MS;
  }

  private beginHeroSlideTransition(direction: -1 | 0 | 1): void {
    if (this.heroSlideTransitionTimer) {
      clearTimeout(this.heroSlideTransitionTimer);
      this.heroSlideTransitionTimer = undefined;
    }

    // The 16px directional travel is the one part of the hero that is pure
    // decoration, so it is the first thing dropped when the visitor has asked
    // for less motion or is navigating repeatedly by thumb.
    const duration = this.heroSlideTransitionMs();
    const effective = duration > 0 ? direction : 0;

    this.heroSlideDirection.set(effective);
    this.outgoingHeroItemId.set(effective ? (this.activeHeroItem()?.id ?? '') : '');
    if (!effective) return;

    this.heroSlideTransitionTimer = window.setTimeout(() => {
      this.heroSlideTransitionTimer = undefined;
      this.heroSlideDirection.set(0);
      this.outgoingHeroItemId.set('');
    }, duration);
  }

  /**
   * Force every hero transition to its committed end state.
   *
   * Used when the ground shifts under an in-flight transition, currently only a
   * motion-preference change. Cleanup is deliberately not conditional on which
   * path started the transition: the point is to reach one active layer no
   * matter which branch is half-done.
   */
  private settleHeroTransitions(): void {
    if (this.heroSlideTransitionTimer) {
      clearTimeout(this.heroSlideTransitionTimer);
      this.heroSlideTransitionTimer = undefined;
    }
    this.heroSlideDirection.set(0);
    this.outgoingHeroItemId.set('');
    this.cancelHeroColorSwap();
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
    const layout = window.matchMedia(HERO_STACKED_QUERY).matches ? 'stacked' : 'wide';
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

      // Nothing else holds this element: the only references left after the
      // executor returns are the event handlers. Keeping it in the map means a
      // pending fetch cannot be collected out from under its own `load`.
      this.heroImageElements.add(image);

      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.heroImageElements.delete(image);
        resolve();
      };

      /**
       * Decode is an optimisation, never a gate.
       *
       * `decode()` on a detached image can stay pending indefinitely in Chrome
       * even after `load` has fired, and the hero used to await it directly.
       * The consequence was not a slow transition, it was no transition at all:
       * `prepareHeroItem` never reached its commit, so arrows, pagination and
       * swipe all silently stopped changing the slide while the page looked
       * perfectly healthy. Racing the deadline means the worst case is one
       * frame of decode jank instead of a dead control.
       */
      const finish = (): void => {
        if (typeof image.decode !== 'function') {
          settle();
          return;
        }
        const deadline = window.setTimeout(settle, HERO_DECODE_DEADLINE_MS);
        void image.decode().catch(() => undefined).then(() => {
          clearTimeout(deadline);
          settle();
        });
      };

      image.onload = finish;
      image.onerror = settle;
      // A fetch that never completes must not strand the hero either. On expiry
      // the caller commits to the old image, which is still on screen.
      window.setTimeout(settle, HERO_LOAD_DEADLINE_MS);
      // Match the <source> fallback rather than warming an unused original.
      image.src = srcset ? url : this.toWebp(url);
    });

    this.heroImageLoads.set(cacheKey, load);
    return load;
  }

  private isHeroControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button') !== null;
  }

  toWebp(url: string): string {
    return url.replace(/\.(png|jpe?g)$/i, '.webp');
  }

  /**
   * Responsive srcset for an uploaded hero image.
   *
   * Read from the variant map the server publishes with the content, not
   * derived from the filename. The previous version pasted `-card`, `-grid`,
   * `-pdp` and `-zoom` onto the stem and declared a fixed width for each. That
   * is a guess about two separate things, and both can be wrong:
   * `createImageVariants` skips any size wider than roughly the source, so a
   * hero uploaded at 1200px has no `-zoom` sibling, yet the browser was still
   * told an 1800w candidate existed and would pick it on a retina screen.
   *
   * Returns '' for bundled art and for any upload the map does not know about,
   * in which case the template falls back to a plain `src`. Heavier than a
   * correct srcset, but never a request for a file that was never written.
   */
  heroSrcset(url: string): string {
    // Variant suffixes are stripped first: content can legitimately store a
    // `-card` URL, and the map is keyed on the original upload.
    const key = mediaVariantKey(url).replace(/-(thumb|card|grid|pdp|zoom)\.webp$/i, '.webp');
    if (!key) return '';

    const variants = this.contentData().mediaVariants?.[key];
    if (!variants?.length) return '';

    return variants.map((variant) => `${variant.url} ${variant.width}w`).join(', ');
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
  readonly heroSizes =
    `(max-width: ${HERO_STACKED_MAX_PX}px) min(132vw, 620px), min(1240px, 76vw)`;
  readonly heroPeekSizes = `(max-width: ${HERO_STACKED_MAX_PX}px) min(38vw, 152px)`;

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
