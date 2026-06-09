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
  titleAr: string;
  subtitleEn: string;
  thumbnail: string;
  alt: string;
}

export interface HeroSliderItem {
  id: string;
  name: string;
  subtitle: string;
  imageUrl: string;
  alt: string;
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

export const DEFAULT_HOME_CONTENT: HomeContentData = {
  hero: {
    imageUrl: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1500&q=85&auto=format&fit=crop',
    title: "Find Your Perfect Look at Elite's New Collection",
    body: 'Step into a sharper wardrobe with curated footwear, outerwear, and everyday essentials selected for modern city style.',
    discountText: '50%',
    ctaText: 'Shop Now',
    ctaLink: '/collection',
  },
  collections: [
    { id: 'footwear', title: 'Footwear', imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&q=85&auto=format&fit=crop', link: '/collection?category=footwear' },
    { id: 'headwear', title: 'Headwear', imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&q=85&auto=format&fit=crop', link: '/collection?category=headwear', ctaText: 'Discover' },
    { id: 'jacket',   title: 'Jacket',   imageUrl: 'https://images.unsplash.com/photo-1520975682031-ae4edb553dcc?w=900&q=85&auto=format&fit=crop', link: '/collection?category=jacket' },
  ],
  heroSlider: {
    ctaEn: 'Shop the Collection',
    ctaAr: 'تسوّق المجموعة',
    items: [
      {
        id: 'brown-leather', name: 'Brown Leather Sandals',
        subtitle: 'صندل جلد طبيعي / Made in Italy',
        imageUrl: '/assets/hero-scroll/elite-hero-sandals-cutout.png',
        alt: 'Brown full-grain leather elite sandals',
        callouts: [
          { id: 'strap',     titleAr: 'جلد عجل طبيعي',   subtitleEn: 'Full-Grain Leather', thumbnail: '/assets/hero-scroll/elite-angle-single.png',  alt: 'Leather strap detail' },
          { id: 'buckle',    titleAr: 'إبزيم معدني فاخر', subtitleEn: 'Premium Buckle',     thumbnail: '/assets/hero-scroll/elite-front-pair.png',   alt: 'Premium buckle detail' },
          { id: 'sole',      titleAr: 'نعل مريح',          subtitleEn: 'Comfort Sole',       thumbnail: '/assets/hero-scroll/elite-side-single.jpeg', alt: 'Comfort sole profile' },
          { id: 'stitching', titleAr: 'خياطة يدوية',       subtitleEn: 'Hand Stitched',      thumbnail: '/assets/hero-scroll/elite-top-pair.png',     alt: 'Hand-stitched edge' },
        ],
      },
      {
        id: 'white-leather', name: 'White Leather Sandals',
        subtitle: 'جلد أبيض فاخر / Italian Craft',
        imageUrl: '/assets/hero-scroll/elite-hero-white-sandals.png',
        alt: 'White leather elite sandals with silver buckle',
        callouts: [
          { id: 'strap',     titleAr: 'جلد طبيعي أبيض',   subtitleEn: 'Full-Grain Leather', thumbnail: '/assets/hero-scroll/elite-white-detail-leather.png',   alt: 'White leather texture' },
          { id: 'buckle',    titleAr: 'إبزيم فضي فاخر',   subtitleEn: 'Silver Buckle',      thumbnail: '/assets/hero-scroll/elite-white-detail-buckle.png',    alt: 'Silver buckle detail' },
          { id: 'sole',      titleAr: 'نعل مريح',          subtitleEn: 'Comfort Sole',       thumbnail: '/assets/hero-scroll/elite-white-detail-brand.png',     alt: 'Branded footbed' },
          { id: 'stitching', titleAr: 'خياطة يدوية',       subtitleEn: 'Hand Stitched',      thumbnail: '/assets/hero-scroll/elite-white-detail-stitching.png', alt: 'White stitching' },
        ],
      },
    ],
  },
  promise: {
    cards: [
      { id: 'handStitched', icon: '◊', labelEn: 'Hand Stitched',     labelAr: 'خياطة يدوية',     subEn: 'Every stitch placed by a single artisan.',      subAr: 'كل غرزة تُوضع بيد حرفي واحد.' },
      { id: 'camelLeather', icon: '◆', labelEn: 'Camel Leather',     labelAr: 'جلد الإبل',       subEn: 'Full-grain hide selected for character.',        subAr: 'جلد طبيعي كامل الحبيبات.' },
      { id: 'craftingTime', icon: '◈', labelEn: '48h Crafting Time', labelAr: '٤٨ ساعة صناعة', subEn: '48 hours of single-artisan attention per pair.', subAr: '٤٨ ساعة من الاهتمام الحرفي لكل زوج.' },
    ],
  },
  stats: [
    { id: 'heritage', value: '60+',  labelEn: 'Years of Heritage', labelAr: 'سنة من الإرث' },
    { id: 'artisans', value: '12',   labelEn: 'Artisans',          labelAr: 'حرفياً' },
    { id: 'perPair',  value: '48hr', labelEn: 'Per Pair',          labelAr: 'لكل زوج' },
    { id: 'lifetime', value: '∞',    labelEn: 'Lifetime Promise',  labelAr: 'ضمان مدى الحياة' },
  ],
  contact: {
    kicker: 'A Private Atelier',
    headlineEn: 'Commission', headlineAccentEn: 'a pair.',
    headlineAr: 'اطلب',       headlineAccentAr: 'زوجاً خاصاً.',
    subhead: 'Every enquiry is treated as a personal commission. Our advisors respond within 24 hours.',
    email: 'hello@elitecollections.qa',
    phone: '+974 4XXX XXXX',
    whatsapp: '',
    promiseLine: 'Each conversation is held in confidence, with the same care we give the leather.',
    promiseSignature: 'Elite Atelier, Doha',
    infoBlocks: [
      { id: 'atelier',      icon: '◆', titleEn: 'The Atelier',     titleAr: 'الورشة',        lines: ['West Bay, Doha, Qatar', 'By appointment only', 'Sat – Thu, 10am – 8pm'] },
      { id: 'appointments', icon: '◇', titleEn: 'Appointments',    titleAr: 'المواعيد',      lines: ['Call or WhatsApp to book', '+974 4XXX XXXX', '24-hour advance notice'] },
      { id: 'client',       icon: '◈', titleEn: 'Client Services', titleAr: 'خدمة العملاء', lines: ['hello@elitecollections.qa', 'Mon – Fri, 9am – 5pm', 'Arabic & English'] },
    ],
    socialLinks: [
      { id: 'whatsapp',  platform: 'whatsapp'  as const, handle: '',                    enabled: false },
      { id: 'instagram', platform: 'instagram' as const, handle: 'elitecollections.qa', enabled: true  },
      { id: 'twitter',   platform: 'twitter'   as const, handle: 'eliteqa',             enabled: false },
      { id: 'facebook',  platform: 'facebook'  as const, handle: 'elitecollections',    enabled: false },
      { id: 'tiktok',    platform: 'tiktok'    as const, handle: 'eliteqa',             enabled: false },
      { id: 'snapchat',  platform: 'snapchat'  as const, handle: 'eliteqa',             enabled: false },
    ],
  },
  story: {
    heroFacts: [
      { id: 'year',    label: '1962' },
      { id: 'atelier', label: 'Doha atelier' },
      { id: 'finish',  label: 'Hand finished' },
    ],
    hero: {
      kicker: 'Est. 1962 · Doha',
      title: 'A House Built by Hand',
      accent: 'and carried by craft',
      body: 'Elite began as a small atelier serving men who wanted shoes with presence, patience, and a story in every stitch.',
      imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1600&q=85&auto=format&fit=crop',
      imageAlt: 'Handcrafted leather shoes arranged in warm atelier light',
    },
    intro: {
      kicker: 'Our philosophy',
      headline: 'Less decoration. More evidence.',
      body: 'Every mark on the page below can be shaped from the admin portal, but the story keeps one rhythm: material, hand, proportion, and the quiet confidence of a pair made to last.',
    },
    chapters: [
      { id: 'origin',    eyebrow: '1962 · The first bench',  title: 'A single workbench in old Doha',               body: 'Our first pairs were measured by hand, cut in quiet batches, and finished for customers who cared about the feel of leather as much as the look of it.', imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1000&q=85&auto=format&fit=crop', imageAlt: 'Leather artisan working on shoe details' },
      { id: 'materials', eyebrow: '1978 · Material codes',   title: 'Leather selected like a signature',           body: 'As the atelier grew, the ritual stayed strict: choose the hide for character, cut for longevity, and polish until the grain carries depth.',             imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=1000&q=85&auto=format&fit=crop', imageAlt: 'Polished formal leather shoes' },
      { id: 'shape',     eyebrow: '1995 · The modern last',  title: 'Classic proportions, sharper lines',          body: 'We refined the last for city movement: leaner profiles, softer break-in, and a silhouette that works from majlis to evening.',                          imageUrl: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=1000&q=85&auto=format&fit=crop', imageAlt: 'Craft tools and leather details' },
      { id: 'today',     eyebrow: 'Today · Made to endure', title: 'Every pair still passes through human hands', body: 'Digital tools help us serve faster, but the final judgment remains tactile: balance, edge, polish, and the quiet confidence of a pair ready to be worn.', imageUrl: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=1000&q=85&auto=format&fit=crop', imageAlt: 'Brown leather shoes on a minimal surface' },
    ],
    quote: {
      text: 'Luxury is not loud.',
      accent: 'It is the evidence of care, repeated until it feels effortless.',
      author: 'Elite Atelier',
    },
    atelier: {
      kicker: 'Inside the atelier',
      title: 'Many hands, one standard',
      body: 'Each role protects a different part of the promise, from the first leather inspection to the final edge finish.',
      items: [
        { id: 'leather', title: 'Leather selector', meta: '30 years of material instinct' },
        { id: 'pattern', title: 'Pattern cutter',   meta: '22 years shaping the silhouette' },
        { id: 'last',    title: 'Last maker',        meta: '18 years balancing comfort' },
        { id: 'welt',    title: 'Welt stitcher',     meta: '25 years securing the build' },
        { id: 'heel',    title: 'Heel builder',      meta: '15 years refining stance' },
        { id: 'finish',  title: 'Edge finisher',     meta: '28 years of final polish' },
      ],
    },
  },
};
