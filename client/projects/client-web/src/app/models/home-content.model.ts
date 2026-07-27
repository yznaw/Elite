export interface HomeDiscountHeroContent {
  imageUrl: string;
  title: string;
  body: string;
  discountText: string;
  ctaText: string;
  ctaLink: string;
}

export interface HomeCollectionTileContent {
  id: string;
  title: string;
  imageUrl: string;
  link: string;
  ctaText?: string;
}

export interface StoryHeroContent {
  kicker: string;
  title: string;
  accent: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

export interface StoryIntroContent {
  kicker: string;
  headline: string;
  body: string;
}

export interface StoryChapterContent {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

export interface StoryAtelierItemContent {
  id: string;
  title: string;
  meta: string;
}

export interface StoryHeroFact {
  id: string;
  label: string;
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
  };
  atelier: {
    kicker: string;
    title: string;
    body: string;
    items: StoryAtelierItemContent[];
  };
}

export interface HeroCalloutContent {
  id: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  thumbnail: string;
  alt: string;
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
  callouts: HeroCalloutContent[];
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

export interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
  story: StoryContentData;
  heroSlider: HeroSliderContent;
  promise: PromiseContent;
  stats: StatItem[];
  contact: ContactContent;
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
      },
      intro: {
        kicker: '',
        headline: '',
        body: '',
      },
      chapters: [],
      quote: {
        text: '',
        accent: '',
        author: '',
      },
      atelier: {
        kicker: '',
        title: '',
        body: '',
        items: [],
      },
    },
  };
}

export const EMPTY_HOME_CONTENT = createEmptyHomeContent();
