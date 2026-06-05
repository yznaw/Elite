const { Router } = require('express');
const { asyncHandler, ok, validationError } = require('./lib');

const HOME_COLLECTION_LIMIT = 3;

const DEFAULT_HOME_CONTENT = {
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

let homeContent = clone(DEFAULT_HOME_CONTENT);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeHero(hero = {}) {
  return {
    imageUrl: asText(hero.imageUrl, DEFAULT_HOME_CONTENT.hero.imageUrl),
    title: asText(hero.title, DEFAULT_HOME_CONTENT.hero.title),
    body: asText(hero.body, DEFAULT_HOME_CONTENT.hero.body),
    discountText: asText(hero.discountText, DEFAULT_HOME_CONTENT.hero.discountText),
    ctaText: asText(hero.ctaText, DEFAULT_HOME_CONTENT.hero.ctaText),
    ctaLink: asText(hero.ctaLink, DEFAULT_HOME_CONTENT.hero.ctaLink),
  };
}

function normalizeCollections(collections = []) {
  const incoming = Array.isArray(collections) ? collections : [];
  return DEFAULT_HOME_CONTENT.collections.slice(0, HOME_COLLECTION_LIMIT).map((fallback) => {
    const item = incoming.find((candidate) => candidate && candidate.id === fallback.id) || {};
    const collectionId = asText(item.collectionId, '');
    return {
      id: fallback.id,
      ...(collectionId ? { collectionId } : {}),
      title: asText(item.title, fallback.title),
      imageUrl: asText(item.imageUrl, fallback.imageUrl),
      link: asText(item.link, fallback.link),
      ...(asText(item.ctaText, fallback.ctaText || '') ? { ctaText: asText(item.ctaText, fallback.ctaText || '') } : {}),
    };
  });
}

function normalizeStoryHero(hero = {}) {
  const fallback = DEFAULT_HOME_CONTENT.story.hero;
  return {
    kicker: asText(hero.kicker, fallback.kicker),
    title: asText(hero.title, fallback.title),
    accent: asText(hero.accent, fallback.accent),
    body: asText(hero.body, fallback.body),
    imageUrl: asText(hero.imageUrl, fallback.imageUrl),
    imageAlt: asText(hero.imageAlt, fallback.imageAlt),
  };
}

function normalizeStoryChapters(chapters = []) {
  const incoming = Array.isArray(chapters) ? chapters : [];
  const defaults = DEFAULT_HOME_CONTENT.story.chapters;
  const fallbackById = new Map(defaults.map((chapter) => [chapter.id, chapter]));
  const ordered = incoming
    .filter((chapter) => chapter && fallbackById.has(chapter.id))
    .map((chapter) => {
      const fallback = fallbackById.get(chapter.id);
      return {
        id: fallback.id,
        eyebrow: asText(chapter.eyebrow, fallback.eyebrow),
        title: asText(chapter.title, fallback.title),
        body: asText(chapter.body, fallback.body),
        imageUrl: asText(chapter.imageUrl, fallback.imageUrl),
        imageAlt: asText(chapter.imageAlt, fallback.imageAlt),
      };
    });
  const missing = defaults.filter((fallback) => !ordered.some((chapter) => chapter.id === fallback.id));
  return [...ordered, ...missing.map(clone)];
}

function normalizeAtelierItems(items = []) {
  const incoming = Array.isArray(items) ? items : [];
  const defaults = DEFAULT_HOME_CONTENT.story.atelier.items;
  return defaults.map((fallback) => {
    const item = incoming.find((candidate) => candidate && candidate.id === fallback.id) || {};
    return {
      id: fallback.id,
      title: asText(item.title, fallback.title),
      meta: asText(item.meta, fallback.meta),
    };
  });
}

function normalizeStory(story = {}) {
  const fallback = DEFAULT_HOME_CONTENT.story;
  return {
    hero: normalizeStoryHero(story.hero),
    chapters: normalizeStoryChapters(story.chapters),
    quote: {
      text: asText(story.quote?.text, fallback.quote.text),
      accent: asText(story.quote?.accent, fallback.quote.accent),
      author: asText(story.quote?.author, fallback.quote.author),
    },
    atelier: {
      kicker: asText(story.atelier?.kicker, fallback.atelier.kicker),
      title: asText(story.atelier?.title, fallback.atelier.title),
      body: asText(story.atelier?.body, fallback.atelier.body),
      items: normalizeAtelierItems(story.atelier?.items),
    },
  };
}

function normalizeContent(input = {}) {
  return {
    hero: normalizeHero(input.hero),
    collections: normalizeCollections(input.collections),
    story: normalizeStory(input.story),
  };
}

function validateContent(content) {
  const errors = {};
  if (!content.hero.imageUrl) errors.heroImageUrl = 'Hero image URL is required.';
  if (!content.hero.title) errors.heroTitle = 'Hero title is required.';
  if (!content.hero.ctaLink) errors.heroCtaLink = 'Hero button link is required.';

  content.collections.forEach((item) => {
    if (!item.title) errors[`${item.id}.title`] = `${item.id} title is required.`;
    if (!item.imageUrl) errors[`${item.id}.imageUrl`] = `${item.id} image URL is required.`;
    if (!item.link) errors[`${item.id}.link`] = `${item.id} collection link is required.`;
  });
  if (!content.story.hero.title) errors.storyHeroTitle = 'Story hero title is required.';
  if (!content.story.hero.imageUrl) errors.storyHeroImageUrl = 'Story hero image is required.';
  content.story.chapters.forEach((chapter) => {
    if (!chapter.title) errors[`story.${chapter.id}.title`] = `${chapter.id} story title is required.`;
    if (!chapter.imageUrl) errors[`story.${chapter.id}.imageUrl`] = `${chapter.id} story image is required.`;
  });

  return errors;
}

function registerGet(router) {
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      ok(res, clone(homeContent));
    }),
  );
}

function registerPatch(router) {
  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      const next = normalizeContent(req.body);
      const errors = validateContent(next);
      if (Object.keys(errors).length) return validationError(res, errors);

      homeContent = next;
      return ok(res, clone(homeContent), 'Home content updated.');
    }),
  );

  router.post(
    '/reset',
    asyncHandler(async (_req, res) => {
      homeContent = clone(DEFAULT_HOME_CONTENT);
      ok(res, clone(homeContent), 'Home content reset.');
    }),
  );
}

const publicRouter = Router();
registerGet(publicRouter);

const adminRouter = Router();
registerGet(adminRouter);
registerPatch(adminRouter);

module.exports = {
  adminRouter,
  publicRouter,
  DEFAULT_HOME_CONTENT,
};
