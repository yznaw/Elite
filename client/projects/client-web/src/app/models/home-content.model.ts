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

export interface StoryContentData {
  hero: StoryHeroContent;
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

export interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
  story: StoryContentData;
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
    {
      id: 'footwear',
      title: 'Footwear',
      imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=footwear',
    },
    {
      id: 'headwear',
      title: 'Headwear',
      imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=headwear',
      ctaText: 'Discover',
    },
    {
      id: 'jacket',
      title: 'Jacket',
      imageUrl: 'https://images.unsplash.com/photo-1520975682031-ae4edb553dcc?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=jacket',
    },
  ],
  story: {
    hero: {
      kicker: 'Est. 1962 · Doha',
      title: 'A House Built by Hand',
      accent: 'and carried by craft',
      body: 'Elite began as a small atelier serving men who wanted shoes with presence, patience, and a story in every stitch.',
      imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1600&q=85&auto=format&fit=crop',
      imageAlt: 'Handcrafted leather shoes arranged in warm atelier light',
    },
    chapters: [
      {
        id: 'origin',
        eyebrow: '1962 · The first bench',
        title: 'A single workbench in old Doha',
        body: 'Our first pairs were measured by hand, cut in quiet batches, and finished for customers who cared about the feel of leather as much as the look of it.',
        imageUrl: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Leather artisan working on shoe details',
      },
      {
        id: 'materials',
        eyebrow: '1978 · Material codes',
        title: 'Leather selected like a signature',
        body: 'As the atelier grew, the ritual stayed strict: choose the hide for character, cut for longevity, and polish until the grain carries depth.',
        imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Polished formal leather shoes',
      },
      {
        id: 'shape',
        eyebrow: '1995 · The modern last',
        title: 'Classic proportions, sharper lines',
        body: 'We refined the last for city movement: leaner profiles, softer break-in, and a silhouette that works from majlis to evening.',
        imageUrl: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Craft tools and leather details',
      },
      {
        id: 'today',
        eyebrow: 'Today · Made to endure',
        title: 'Every pair still passes through human hands',
        body: 'Digital tools help us serve faster, but the final judgment remains tactile: balance, edge, polish, and the quiet confidence of a pair ready to be worn.',
        imageUrl: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=1000&q=85&auto=format&fit=crop',
        imageAlt: 'Brown leather shoes on a minimal surface',
      },
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
        { id: 'pattern', title: 'Pattern cutter', meta: '22 years shaping the silhouette' },
        { id: 'last', title: 'Last maker', meta: '18 years balancing comfort' },
        { id: 'welt', title: 'Welt stitcher', meta: '25 years securing the build' },
        { id: 'heel', title: 'Heel builder', meta: '15 years refining stance' },
        { id: 'finish', title: 'Edge finisher', meta: '28 years of final polish' },
      ],
    },
  },
};
