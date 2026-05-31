import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { I18nService } from '../../services/i18n.service';
import { HomeContentService } from '../../services/home-content.service';
import { HomeCollectionTileContent } from '../../models/home-content.model';

interface MetaCard {
  id: number;
  labelKey: string;
  subKey: string;
  icon: string;
}

interface PromiseStat {
  value: string;
  labelKey: string;
}

interface HeroPhoto {
  id: string;
  index: string;
  eyebrowKey: string;
  titleKey: string;
  subtitleKey: string;
  imageUrl: string;
  altKey: string;
}

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly i18n = inject(I18nService);
  private readonly homeContent = inject(HomeContentService);

  private metaTimer: number | undefined;
  private lenis?: Lenis;
  private lenisTicker?: (time: number) => void;
  private heroContext?: gsap.Context;
  private heroScrollDistance = 0;

  @ViewChild('heroSection') private heroSection?: ElementRef<HTMLElement>;
  @ViewChild('heroShell') private heroShell?: ElementRef<HTMLElement>;

  readonly metaVisible = signal(false);
  readonly activePhotoIndex = signal(0);
  readonly contentData = this.homeContent.contentData;
  readonly layoutSections = this.homeContent.layoutSections;

  readonly heroPhotos: HeroPhoto[] = [
    {
      id: 'topPair',
      index: '01',
      eyebrowKey: 'home.hero.photo.topPair.eyebrow',
      titleKey: 'home.hero.photo.topPair.title',
      subtitleKey: 'home.hero.photo.topPair.subtitle',
      imageUrl: '/assets/hero-scroll/elite-top-pair.jpeg',
      altKey: 'home.hero.photo.topPair.alt',
    },
    {
      id: 'angleSingle',
      index: '02',
      eyebrowKey: 'home.hero.photo.angleSingle.eyebrow',
      titleKey: 'home.hero.photo.angleSingle.title',
      subtitleKey: 'home.hero.photo.angleSingle.subtitle',
      imageUrl: '/assets/hero-scroll/elite-angle-single.jpeg',
      altKey: 'home.hero.photo.angleSingle.alt',
    },
    {
      id: 'sideSingle',
      index: '03',
      eyebrowKey: 'home.hero.photo.sideSingle.eyebrow',
      titleKey: 'home.hero.photo.sideSingle.title',
      subtitleKey: 'home.hero.photo.sideSingle.subtitle',
      imageUrl: '/assets/hero-scroll/elite-side-single.jpeg',
      altKey: 'home.hero.photo.sideSingle.alt',
    },
    {
      id: 'frontPair',
      index: '04',
      eyebrowKey: 'home.hero.photo.frontPair.eyebrow',
      titleKey: 'home.hero.photo.frontPair.title',
      subtitleKey: 'home.hero.photo.frontPair.subtitle',
      imageUrl: '/assets/hero-scroll/elite-front-pair.jpeg',
      altKey: 'home.hero.photo.frontPair.alt',
    },
    {
      id: 'anglePair',
      index: '05',
      eyebrowKey: 'home.hero.photo.anglePair.eyebrow',
      titleKey: 'home.hero.photo.anglePair.title',
      subtitleKey: 'home.hero.photo.anglePair.subtitle',
      imageUrl: '/assets/hero-scroll/elite-angle-pair.jpeg',
      altKey: 'home.hero.photo.anglePair.alt',
    },
  ];

  readonly metaCards: MetaCard[] = [
    { id: 1, labelKey: 'home.meta.handStitched', subKey: 'home.meta.handStitched.sub', icon: '◊' },
    { id: 2, labelKey: 'home.meta.camelLeather', subKey: 'home.meta.camelLeather.sub', icon: '◆' },
    { id: 3, labelKey: 'home.meta.craftingTime', subKey: 'home.meta.craftingTime.sub', icon: '◈' },
  ];

  readonly stats: PromiseStat[] = [
    { value: '60+', labelKey: 'home.stats.heritage' },
    { value: '12',  labelKey: 'home.stats.artisans' },
    { value: '48hr', labelKey: 'home.stats.perPair' },
    { value: '∞',   labelKey: 'home.stats.lifetime' },
  ];

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);

  ngOnInit(): void {
    void this.homeContent.refresh(true);
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initScrollExperience());
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.destroyScrollExperience();
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  goToContentLink(link: string): void {
    const target = link?.trim() || '/collection';
    if (/^https?:\/\//i.test(target)) {
      window.location.href = target;
      return;
    }

    void this.router.navigateByUrl(target);
    window.scrollTo(0, 0);
  }

  goToCollectionTile(tile: HomeCollectionTileContent): void {
    this.goToContentLink(this.collectionTileRoute(tile));
  }

  selectHeroPhoto(index: number): void {
    const section = this.heroSection?.nativeElement;
    if (!section) return;

    const clampedIndex = Math.max(0, Math.min(index, this.heroPhotos.length - 1));
    const scrollDistance = Math.max(this.heroScrollDistance || section.offsetHeight - window.innerHeight, 1);
    const lastIndex = this.heroPhotos.length - 1;
    const rawProgress = this.heroPhotos.length <= 1 ? 0 : clampedIndex / lastIndex;
    const progress = clampedIndex === lastIndex ? 0.92 : rawProgress;
    const target = section.offsetTop + scrollDistance * progress;

    this.lenis?.scrollTo(target, {
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  }

  selectAdjacentHeroPhoto(direction: -1 | 1): void {
    const nextIndex = (this.activePhotoIndex() + direction + this.heroPhotos.length) % this.heroPhotos.length;
    this.selectHeroPhoto(nextIndex);
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
        const collectionKey = url.searchParams.get('collection');
        if (collectionKey) return `/collection/${this.collectionHandle(collectionKey)}`;

        const key = tile.title || tile.id || url.searchParams.get('category') || fallbackHandle;
        return `/collection/${this.collectionHandle(key)}`;
      }
    } catch {
      return `/collection/${fallbackHandle}`;
    }

    return link;
  }

  private collectionHandle(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'collection';
  }

  private initScrollExperience(): void {
    const section = this.heroSection?.nativeElement;
    const shell = this.heroShell?.nativeElement;
    if (!section || !shell) return;

    gsap.registerPlugin(ScrollTrigger);
    this.initLenis();

    this.heroContext = gsap.context(() => {
      const photos = gsap.utils.toArray<HTMLElement>('.hero-photo');
      const captions = gsap.utils.toArray<HTMLElement>('.hero-caption');
      const progressItems = gsap.utils.toArray<HTMLElement>('.photo-progress__item');
      const sectionDuration = Math.max(this.heroPhotos.length * 760, 3000);
      const segment = 1.2;
      this.heroScrollDistance = sectionDuration;

      gsap.set(photos, {
        autoAlpha: 0,
        scale: 0.86,
        y: 90,
        rotate: 4,
        filter: 'blur(12px)',
        clipPath: 'inset(10% 10% 10% 10% round 30px)',
      });
      gsap.set(photos[0], {
        autoAlpha: 1,
        scale: 1,
        y: 0,
        rotate: 0,
        filter: 'blur(0px)',
        clipPath: 'inset(0% 0% 0% 0% round 0px)',
      });
      gsap.set(captions, { autoAlpha: 0, y: 18 });
      gsap.set(captions[0], { autoAlpha: 1, y: 0 });

      const timeline = gsap.timeline({
        defaults: { ease: 'power3.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: `+=${sectionDuration}`,
          scrub: 0.85,
          pin: shell,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => this.updateActivePhoto(self.progress, progressItems),
        },
      });

      photos.forEach((photo, index) => {
        const at = index * segment;
        const drift = index % 2 === 0 ? -4 : 4;

        if (index > 0) {
          const previousPhoto = photos[index - 1];
          const previousCaption = captions[index - 1];

          timeline.to(previousPhoto, {
            autoAlpha: 0,
            scale: 1.08,
            y: -74,
            rotate: -drift,
            filter: 'blur(12px)',
            clipPath: 'inset(8% 8% 8% 8% round 24px)',
            duration: 0.78,
          }, at);
          timeline.to(previousCaption, { autoAlpha: 0, y: -18, duration: 0.45 }, at);
          timeline.fromTo(photo, {
            autoAlpha: 0,
            scale: 0.86,
            y: 92,
            rotate: drift,
            filter: 'blur(14px)',
            clipPath: 'inset(14% 12% 14% 12% round 32px)',
          }, {
            autoAlpha: 1,
            scale: 1,
            y: 0,
            rotate: 0,
            filter: 'blur(0px)',
            clipPath: 'inset(0% 0% 0% 0% round 0px)',
            duration: 0.9,
          }, at + 0.04);
        }

        timeline.to(photo, {
          scale: 1.035,
          xPercent: index % 2 === 0 ? 1.2 : -1.2,
          y: -10,
          duration: 0.62,
          ease: 'none',
        }, at + 0.62);
        timeline.to(captions[index], { autoAlpha: 1, y: 0, duration: 0.45 }, at + 0.12);
      });

      ScrollTrigger.refresh();
    }, section);
  }

  private initLenis(): void {
    if (this.lenis) return;

    this.lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.92,
      touchMultiplier: 1.08,
      smoothWheel: true,
    });

    this.lenis.on('scroll', ScrollTrigger.update);
    this.lenisTicker = (time: number): void => {
      this.lenis?.raf(time * 1000);
    };

    gsap.ticker.add(this.lenisTicker);
    gsap.ticker.lagSmoothing(0);
  }

  private updateActivePhoto(progress: number, progressItems: HTMLElement[]): void {
    const nextIndex = Math.min(this.heroPhotos.length - 1, Math.round(progress * (this.heroPhotos.length - 1)));
    if (nextIndex !== this.activePhotoIndex()) {
      this.ngZone.run(() => this.activePhotoIndex.set(nextIndex));
    }

    progressItems.forEach((item, index) => {
      item.classList.toggle('is-active', index === nextIndex);
      item.classList.toggle('is-seen', index < nextIndex);
    });
  }

  private destroyScrollExperience(): void {
    this.heroContext?.revert();
    this.heroContext = undefined;

    if (this.lenisTicker) {
      gsap.ticker.remove(this.lenisTicker);
      this.lenisTicker = undefined;
    }

    this.lenis?.destroy();
    this.lenis = undefined;
  }
}
