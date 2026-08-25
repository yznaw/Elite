export interface HomeDiscountHeroContent {
  imageUrl: string;
  title: string;
  body: string;
  discountText: string;
  ctaText: string;
  ctaLink: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  ctaTextEn: string;
  ctaTextAr: string;
}

export interface HomeCollectionTileContent {
  id: string;
  title: string;
  imageUrl: string;
  link: string;
  ctaText?: string;
  titleEn: string;
  titleAr: string;
  ctaTextEn: string;
  ctaTextAr: string;
}

export interface StoryHeroContent {
  kicker: string;
  title: string;
  accent: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  imageAltEn: string;
  imageAltAr: string;
  kickerEn: string;
  kickerAr: string;
  titleEn: string;
  titleAr: string;
  accentEn: string;
  accentAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface StoryIntroContent {
  kicker: string;
  headline: string;
  body: string;
  kickerEn: string;
  kickerAr: string;
  headlineEn: string;
  headlineAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface StoryChapterContent {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  imageAltEn: string;
  imageAltAr: string;
  eyebrowEn: string;
  eyebrowAr: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface StoryAtelierItemContent {
  id: string;
  title: string;
  meta: string;
  titleEn: string;
  titleAr: string;
  metaEn: string;
  metaAr: string;
}

export interface StoryHeroFact {
  id: string;
  label: string;
  labelEn: string;
  labelAr: string;
}

export interface StoryContentData {
  hero: StoryHeroContent;
  heroFacts: StoryHeroFact[];
  intro: StoryIntroContent;
  chapters: StoryChapterContent[];
  quote: {
    text: string;
    accent: string;
    author: string;
    textEn: string;
    textAr: string;
    accentEn: string;
    accentAr: string;
    authorEn: string;
    authorAr: string;
  };
  atelier: {
    kicker: string;
    title: string;
    body: string;
    kickerEn: string;
    kickerAr: string;
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
    items: StoryAtelierItemContent[];
  };
}

/**
 * One featured colorway on a hero slide. `hex` is deliberately absent: colour
 * values are resolved from `ref_colors` at render time so a colour edited in
 * Reference Data updates every swatch across the app.
 */
export interface HeroColorContent {
  /** Colour name as stored on the product variant, e.g. "Copper Brown". */
  label: string;
  /** URL-safe form of `label`, matched against the product page `?color=` param. */
  slug: string;
  /**
   * Hero shot for this colourway, chosen in the storefront editor. Deliberately
   * separate from the product's own gallery images: hero art is a cutout styled
   * for the hero stage, while gallery photos serve the product detail page.
   * Empty means this colour keeps the slide's default image.
   */
  imageUrl: string;
}

export interface HeroSliderItem {
  id: string;
  name: string;
  subtitle: string;
  nameEn: string;
  nameAr: string;
  subtitleEn: string;
  subtitleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  /**
   * Image the slide opens on. Derived from the default colourway rather than
   * edited directly, so the hero always opens on a real colour a visitor can
   * then switch away from and back to.
   */
  imageUrl: string;
  alt: string;
  /** Product this slide links to. Empty means the swatch row is not rendered. */
  productId: string;
  /** Featured colourways, max 4. */
  colors: HeroColorContent[];
  /** Slug of the colourway the slide opens on. Falls back to the first colour. */
  defaultColorSlug: string;
}

export interface HeroSliderContent {
  ctaEn: string;
  ctaAr: string;
  items: HeroSliderItem[];
}

export interface PromiseCard {
  id: string;
  icon: string;
  labelEn: string;
  labelAr: string;
  subEn: string;
  subAr: string;
}

export interface PromiseContent {
  cards: PromiseCard[];
}

export interface StatItem {
  id: string;
  value: string;
  labelEn: string;
  labelAr: string;
}

export interface ContactInfoBlock {
  id: string;
  icon: string;
  titleEn: string;
  titleAr: string;
  lines: string[];
}

export type SocialPlatform = 'whatsapp' | 'instagram' | 'twitter' | 'facebook' | 'tiktok' | 'snapchat' | 'youtube' | 'linkedin';

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  handle: string;
  enabled: boolean;
}

export interface ContactContent {
  kicker: string;
  headlineEn: string;
  headlineAccentEn: string;
  headlineAr: string;
  headlineAccentAr: string;
  subhead: string;
  email: string;
  phone: string;
  whatsapp: string;
  promiseLine: string;
  promiseSignature: string;
  infoBlocks: ContactInfoBlock[];
  socialLinks: SocialLink[];
}

/** One generated size of an uploaded image, as the server actually wrote it. */
export interface MediaVariant {
  url: string;
  width: number;
}

export interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
  story: StoryContentData;
  heroSlider: HeroSliderContent;
  promise: PromiseContent;
  stats: StatItem[];
  contact: ContactContent;
  /**
   * Responsive candidates for hero imagery, keyed by upload filename.
   *
   * A read-time projection rather than stored content: the server joins the
   * media table on each hero image and reports the sizes that exist. The hero
   * used to derive these by pasting suffixes onto the filename and asserting a
   * width for each, which is wrong whenever the upload was too small for a
   * given size to be generated.
   *
   * Keyed by basename so a lookup survives the `/api` prefix that
   * `resolveClientMediaUrl` adds and any absolute host in older content. An
   * absent key means no `srcset`, which is correct-but-heavy rather than broken.
   */
  mediaVariants: Record<string, MediaVariant[]>;
}

export function createEmptyHomeContent(): HomeContentData {
  return {
    hero: {
      imageUrl: '',
      title: '',
      body: '',
      discountText: '',
      ctaText: '',
      ctaLink: '',
      titleEn: '', titleAr: '', bodyEn: '', bodyAr: '', ctaTextEn: '', ctaTextAr: '',
    },
    collections: [],
    heroSlider: {
      ctaEn: '',
      ctaAr: '',
      items: [],
    },
    promise: {
      cards: [],
    },
    stats: [],
    contact: {
      kicker: '',
      headlineEn: '',
      headlineAccentEn: '',
      headlineAr: '',
      headlineAccentAr: '',
      subhead: '',
      email: '',
      phone: '',
      whatsapp: '',
      promiseLine: '',
      promiseSignature: '',
      infoBlocks: [],
      socialLinks: [],
    },
    story: {
      heroFacts: [],
      hero: {
        kicker: '',
        title: '',
        accent: '',
        body: '',
        imageUrl: '',
        imageAlt: '',
        imageAltEn: '',
        imageAltAr: '',
        kickerEn: '', kickerAr: '', titleEn: '', titleAr: '', accentEn: '', accentAr: '', bodyEn: '', bodyAr: '',
      },
      intro: {
        kicker: '',
        headline: '',
        body: '',
        kickerEn: '', kickerAr: '', headlineEn: '', headlineAr: '', bodyEn: '', bodyAr: '',
      },
      chapters: [],
      quote: {
        text: '',
        accent: '',
        author: '',
        textEn: '', textAr: '', accentEn: '', accentAr: '', authorEn: '', authorAr: '',
      },
      atelier: {
        kicker: '',
        title: '',
        body: '',
        kickerEn: '', kickerAr: '', titleEn: '', titleAr: '', bodyEn: '', bodyAr: '',
        items: [],
      },
    },
    mediaVariants: {},
  };
}

export const EMPTY_HOME_CONTENT = createEmptyHomeContent();
