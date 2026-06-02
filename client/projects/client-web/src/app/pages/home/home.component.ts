import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
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

interface HeroCallout {
  id: string;
  className: string;
  delay: string;
  titleAr: string;
  subtitleEn: string;
  thumbnail: string;
  alt: string;
}

interface HeroItem {
  id: string;
  name: string;
  subtitle: string;
  imageUrl: string;
  alt: string;
}

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);
  private readonly homeContent = inject(HomeContentService);

  private metaTimer: number | undefined;

  readonly metaVisible = signal(false);
  readonly activeHeroItemIndex = signal(0);
  readonly contentData = this.homeContent.contentData;
  readonly layoutSections = this.homeContent.layoutSections;

  readonly heroItems: HeroItem[] = [
    {
      id: 'italian-leather',
      name: 'Italian Leather Sandals',
      subtitle: 'صندل جلد طبيعي / Made in Italy',
      imageUrl: '/assets/hero-scroll/elite-angle-pair-cutout.png',
      alt: 'Brown full-grain leather elite sandals made in Italy',
    },
    {
      id: 'signature-comfort',
      name: 'Signature Comfort Sandals',
      subtitle: 'راحة يومية / Italian Craft',
      imageUrl: '/assets/hero-scroll/elite-angle-pair-cutout.png',
      alt: 'Brown elite comfort leather sandals made in Italy',
    },
    {
      id: 'handmade-profile',
      name: 'Handmade Leather Profile',
      subtitle: 'خياطة يدوية / Full-Grain Leather',
      imageUrl: '/assets/hero-scroll/elite-angle-pair-cutout.png',
      alt: 'Handmade brown full-grain leather elite sandals',
    },
  ];

  readonly activeHeroItem = computed(() => this.heroItems[this.activeHeroItemIndex()]);
  readonly heroCtaLabel = computed(() => this.locale.locale() === 'ar' ? 'تسوّق المجموعة' : 'Shop the Collection');

  readonly heroCallouts: HeroCallout[] = [
    {
      id: 'strap',
      className: 'hero-callout--strap',
      delay: '0.34s',
      titleAr: 'جلد عجل طبيعي',
      subtitleEn: 'Full-Grain Leather',
      thumbnail: '/assets/hero-scroll/elite-angle-single.png',
      alt: 'Close crop of the brown full-grain leather strap',
    },
    {
      id: 'buckle',
      className: 'hero-callout--buckle',
      delay: '0.48s',
      titleAr: 'إبزيم معدني فاخر',
      subtitleEn: 'Premium Buckle',
      thumbnail: '/assets/hero-scroll/elite-front-pair.png',
      alt: 'Close crop of the premium buckle detail',
    },
    {
      id: 'sole',
      className: 'hero-callout--sole',
      delay: '0.76s',
      titleAr: 'نعل مريح',
      subtitleEn: 'Comfort Sole',
      thumbnail: '/assets/hero-scroll/elite-side-single.jpeg',
      alt: 'Close crop of the comfort sole profile',
    },
    {
      id: 'stitching',
      className: 'hero-callout--stitching',
      delay: '0.62s',
      titleAr: 'خياطة يدوية',
      subtitleEn: 'Hand Stitched',
      thumbnail: '/assets/hero-scroll/elite-top-pair.png',
      alt: 'Close crop of the hand-stitched leather edge',
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

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  selectAdjacentHeroItem(direction: -1 | 1): void {
    this.activeHeroItemIndex.update((index) => (index + direction + this.heroItems.length) % this.heroItems.length);
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
}
