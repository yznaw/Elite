const { Router } = require('express');
const { asyncHandler, ok, validationError } = require('./lib');

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
    {
      id: 'bags',
      title: 'Bags',
      imageUrl: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=bags',
    },
    {
      id: 'accessories',
      title: 'Accessories',
      imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=accessories',
    },
    {
      id: 'bottoms',
      title: 'Bottoms',
      imageUrl: 'https://images.unsplash.com/photo-1516826957135-700dedea698c?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=bottoms',
    },
  ],
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
  return DEFAULT_HOME_CONTENT.collections.map((fallback) => {
    const item = incoming.find((candidate) => candidate && candidate.id === fallback.id) || {};

    return {
      id: fallback.id,
      title: asText(item.title, fallback.title),
      imageUrl: asText(item.imageUrl, fallback.imageUrl),
      link: asText(item.link, fallback.link),
      ...(asText(item.ctaText, fallback.ctaText || '') ? { ctaText: asText(item.ctaText, fallback.ctaText || '') } : {}),
    };
  });
}

function normalizeContent(input = {}) {
  return {
    hero: normalizeHero(input.hero),
    collections: normalizeCollections(input.collections),
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
