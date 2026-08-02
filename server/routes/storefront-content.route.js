const { Router } = require('express');
const { asyncHandler, ok, validationError } = require('./lib');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');

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
    intro: {
      kicker: 'Our philosophy',
      headline: 'Less decoration. More evidence.',
      body: 'Every mark on the page below can be shaped from the admin portal, but the story keeps one rhythm: material, hand, proportion, and the quiet confidence of a pair made to last.',
    },
    heroFacts: [
      { id: 'year',    label: '1962' },
      { id: 'atelier', label: 'Doha atelier' },
      { id: 'finish',  label: 'Hand finished' },
    ],
  },
  heroSlider: {
    ctaEn: 'Shop the Collection',
    ctaAr: 'تسوّق المجموعة',
    items: [
      {
        id: 'brown-leather',
        name: 'Brown Leather Sandals',
        subtitle: 'صندل جلد طبيعي / Made in Italy',
        descriptionEn: 'Full-grain leather, hand stitched in Italy over a comfort sole.',
        descriptionAr: 'جلد طبيعي كامل الحبيبات، مخيط يدوياً في إيطاليا على نعل مريح.',
        imageUrl: '/assets/hero-scroll/elite-hero-sandals-cutout.png',
        alt: 'Brown full-grain leather elite sandals made in Italy',
        // Set from the admin editor: links the swatch row to a real product.
        productId: '',
        colors: [],
        defaultColorSlug: '',
      },
      {
        id: 'white-leather',
        name: 'White Leather Sandals',
        subtitle: 'جلد أبيض فاخر / Italian Craft',
        descriptionEn: 'White full-grain leather with a silver buckle, finished by hand.',
        descriptionAr: 'جلد أبيض طبيعي مع إبزيم فضي، بلمسة نهائية يدوية.',
        imageUrl: '/assets/hero-scroll/elite-hero-white-sandals.png',
        alt: 'White leather elite sandals with silver buckle made in Italy',
        productId: '',
        colors: [],
        defaultColorSlug: '',
      },
    ],
  },
  promise: {
    cards: [
      { id: 'handStitched', icon: '◊', labelEn: 'Hand Stitched',     labelAr: 'خياطة يدوية',      subEn: 'Every stitch placed by a single artisan.',      subAr: 'كل غرزة تُوضع بيد حرفي واحد.' },
      { id: 'camelLeather', icon: '◆', labelEn: 'Camel Leather',     labelAr: 'جلد الإبل',        subEn: 'Full-grain hide selected for character.',        subAr: 'جلد طبيعي كامل الحبيبات.' },
      { id: 'craftingTime', icon: '◈', labelEn: '48h Crafting Time', labelAr: '٤٨ ساعة صناعة',  subEn: '48 hours of single-artisan attention per pair.', subAr: '٤٨ ساعة من الاهتمام الحرفي لكل زوج.' },
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
    headlineEn: 'Commission',
    headlineAccentEn: 'a pair.',
    headlineAr: 'اطلب',
    headlineAccentAr: 'زوجاً خاصاً.',
    subhead: 'Every enquiry is treated as a personal commission. Our advisors respond within 24 hours.',
    email: 'hello@elitecollections.qa',
    phone: '+974 4XXX XXXX',
    whatsapp: '',
    promiseLine: 'Each conversation is held in confidence, with the same care we give the leather.',
    promiseSignature: 'Elite Atelier, Doha',
    infoBlocks: [
      { id: 'atelier',      icon: '◆', titleEn: 'The Atelier',      titleAr: 'الورشة',         lines: ['West Bay, Doha, Qatar', 'By appointment only', 'Sat – Thu, 10am – 8pm'] },
      { id: 'appointments', icon: '◇', titleEn: 'Appointments',     titleAr: 'المواعيد',       lines: ['Call or WhatsApp to book', '+974 4XXX XXXX', '24-hour advance notice'] },
      { id: 'client',       icon: '◈', titleEn: 'Client Services',  titleAr: 'خدمة العملاء',  lines: ['hello@elitecollections.qa', 'Mon – Fri, 9am – 5pm', 'Arabic & English'] },
    ],
    socialLinks: [
      { id: 'whatsapp',  platform: 'whatsapp',  handle: '',                    enabled: false },
      { id: 'instagram', platform: 'instagram', handle: 'elitecollections.qa', enabled: true  },
      { id: 'twitter',   platform: 'twitter',   handle: 'eliteqa',             enabled: false },
      { id: 'facebook',  platform: 'facebook',  handle: 'elitecollections',    enabled: false },
      { id: 'tiktok',    platform: 'tiktok',    handle: 'eliteqa',             enabled: false },
      { id: 'snapchat',  platform: 'snapchat',  handle: 'eliteqa',             enabled: false },
    ],
  },
};

let schemaReady = false;
let draftSchemaReady = false;

async function ensureColumn(client) {
  if (schemaReady) return;
  await client.query(`
    ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS home_content jsonb
  `);
  schemaReady = true;
}

async function ensureDraftColumn(client) {
  if (draftSchemaReady) return;
  await client.query(`
    ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS home_content_draft jsonb
  `);
  draftSchemaReady = true;
}

// ── Secure preview token store (in-memory, 15-min TTL) ──────────────────────
const { randomBytes } = require('crypto');
const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const _previewTokens = new Map(); // token -> expiresAt (ms)

function createPreviewToken() {
  // Sweep expired tokens before creating a new one
  const now = Date.now();
  for (const [t, exp] of _previewTokens) {
    if (exp < now) _previewTokens.delete(t);
  }
  const token = randomBytes(32).toString('hex');
  _previewTokens.set(token, now + PREVIEW_TOKEN_TTL_MS);
  return token;
}

function validatePreviewToken(token) {
  if (!token || typeof token !== 'string') return false;
  const exp = _previewTokens.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { _previewTokens.delete(token); return false; }
  return true;
}

async function loadContent(client, tenantId) {
  await ensureColumn(client);
  const result = await client.query(
    'SELECT home_content FROM store_settings WHERE tenant_id = $1',
    [tenantId],
  );
  const raw = result.rows[0]?.home_content;
  const content = raw ? normalizeContent(raw) : createEmptyHomeContent();

  // Resolve linked collection tiles with live data so catalog updates are always reflected
  const collectionIds = content.collections
    .map((t) => t.collectionId)
    .filter(Boolean);

  if (collectionIds.length > 0) {
    const colResult = await client.query(
      `SELECT id, title, handle, seo->>'imageUrl' AS image_url
       FROM collections
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, collectionIds],
    );
    const colMap = {};
    colResult.rows.forEach((row) => { colMap[row.id] = row; });

    content.collections = content.collections.map((tile) => {
      if (!tile.collectionId) return tile;
      const col = colMap[tile.collectionId];
      if (!col) return tile;
      return {
        ...tile,
        title:    col.title    || tile.title,
        imageUrl: col.image_url || tile.imageUrl,
        link:     `/collection/${col.handle}`,
      };
    });
  }

  content.mediaVariants = await loadHeroMediaVariants(client, tenantId, content);

  return content;
}

/**
 * Real responsive variants for every image the hero can render.
 *
 * The storefront used to build its `srcset` by pasting `-card`, `-grid`, `-pdp`
 * and `-zoom` onto the filename and declaring fixed widths for each. Both
 * halves of that guess can be wrong. `createImageVariants` skips any size wider
 * than roughly the source, so a 1200px hero upload has no `-zoom` sibling at
 * all and the browser could pick a candidate that 404s. When a variant is
 * missing the whole `srcset` is also a lie about width, which is the more
 * common outcome: the browser trusts the declared `1800w`, picks it on a retina
 * screen, and gets nothing.
 *
 * Returning what was actually generated makes the client's job a lookup rather
 * than a guess. Anything absent from this map simply gets no `srcset` and falls
 * back to a plain `src`, which is slower but always correct.
 *
 * Keyed by `media_assets.storage_url`, which is exactly the value the hero
 * stores in its slide and colour entries.
 */
async function loadHeroMediaVariants(client, tenantId, content) {
  const urls = new Set();
  for (const item of content.heroSlider?.items ?? []) {
    if (item.imageUrl) urls.add(item.imageUrl);
    for (const colour of item.colors ?? []) {
      if (colour.imageUrl) urls.add(colour.imageUrl);
    }
  }

  // Bundled art under /assets carries no variants and is not a media asset.
  const uploads = [...urls].filter((url) => url.includes('/uploads/'));
  if (uploads.length === 0) return {};

  // Matched on the basename so a row still resolves when the stored value
  // carries an `/api` prefix or an absolute host from an older admin build.
  const basenames = uploads.map((url) => url.split('/').pop());

  const { rows } = await client.query(
    `SELECT storage_url, metadata->'imageVariants' AS variants
       FROM media_assets
      WHERE tenant_id = $1
        AND metadata ? 'imageVariants'
        AND split_part(storage_url, '/', -1) = ANY($2::text[])`,
    [tenantId, basenames],
  );

  const map = {};
  for (const row of rows) {
    const entries = Object.values(row.variants || {})
      .filter((variant) => variant && variant.url && variant.width > 0)
      // Ascending width, because that is the order `srcset` is read in and it
      // keeps the payload stable between requests.
      .sort((a, b) => a.width - b.width)
      .map((variant) => ({ url: variant.url, width: variant.width }));
    if (entries.length > 0) map[row.storage_url] = entries;
  }
  return map;
}

async function saveContent(client, tenantId, content) {
  await ensureColumn(client);
  await client.query(
    'UPDATE store_settings SET home_content = $1 WHERE tenant_id = $2',
    [JSON.stringify(content), tenantId],
  );
}

async function loadDraft(client, tenantId) {
  await ensureDraftColumn(client);
  const result = await client.query(
    'SELECT home_content_draft FROM store_settings WHERE tenant_id = $1',
    [tenantId],
  );
  const raw = result.rows[0]?.home_content_draft;
  if (!raw) return null;
  const draft = normalizeContent(raw);
  // The preview is meant to be the storefront, so it resolves variants the same
  // way. Without this a draft renders every hero image at full size and the
  // admin reviews a page that is heavier than the one visitors will get.
  draft.mediaVariants = await loadHeroMediaVariants(client, tenantId, draft);
  return draft;
}

async function saveDraft(client, tenantId, content) {
  await ensureDraftColumn(client);
  await client.query(
    'UPDATE store_settings SET home_content_draft = $1 WHERE tenant_id = $2',
    [JSON.stringify(content), tenantId],
  );
}

async function promoteDraftToLive(client, tenantId) {
  await ensureDraftColumn(client);
  await ensureColumn(client);
  const result = await client.query(
    'SELECT home_content_draft FROM store_settings WHERE tenant_id = $1',
    [tenantId],
  );
  const raw = result.rows[0]?.home_content_draft;
  if (!raw) throw new Error('No draft to publish.');
  const content = normalizeContent(raw);
  await client.query(
    `UPDATE store_settings
     SET home_content = $1, home_content_draft = NULL
     WHERE tenant_id = $2`,
    [JSON.stringify(content), tenantId],
  );
  return content;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyHomeContent() {
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
    story: {
      hero: {
        kicker: '',
        title: '',
        accent: '',
        body: '',
        imageUrl: '',
        imageAlt: '',
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
      intro: {
        kicker: '',
        headline: '',
        body: '',
      },
      heroFacts: [],
    },
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
  };
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
  const incoming = Array.isArray(collections) && collections.length > 0 ? collections : [];
  const defaults = DEFAULT_HOME_CONTENT.collections.slice(0, HOME_COLLECTION_LIMIT);

  return defaults.map((fallback, idx) => {
    // Match by id first, then fall back to same index position
    const item = incoming.find((c) => c && c.id === fallback.id)
      || incoming[idx]
      || {};
    const collectionId = asText(item.collectionId, '');
    return {
      id: fallback.id,
      ...(collectionId ? { collectionId } : {}),
      title:    asText(item.title,    fallback.title),
      imageUrl: asText(item.imageUrl, fallback.imageUrl),
      link:     asText(item.link,     fallback.link),
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

function normalizeHeroFacts(facts = []) {
  const incoming = Array.isArray(facts) && facts.length > 0
    ? facts
    : DEFAULT_HOME_CONTENT.story.heroFacts;
  return incoming.filter((f) => f && f.id).map((f) => ({
    id:    f.id,
    label: asText(f.label, ''),
  }));
}

function normalizeStory(story = {}) {
  const fallback = DEFAULT_HOME_CONTENT.story;
  // Chapters: allow any number (user can add/remove)
  const chaptersIn = Array.isArray(story.chapters) && story.chapters.length > 0
    ? story.chapters
    : null;
  const chapters = chaptersIn
    ? chaptersIn.filter((c) => c && c.id).map((c) => {
        const fb = fallback.chapters.find((f) => f.id === c.id) || {};
        return {
          id:       c.id,
          eyebrow:  asText(c.eyebrow,  fb.eyebrow  || ''),
          title:    asText(c.title,    fb.title     || ''),
          body:     asText(c.body,     fb.body      || ''),
          imageUrl: asText(c.imageUrl, fb.imageUrl  || ''),
          imageAlt: asText(c.imageAlt, fb.imageAlt  || ''),
        };
      })
    : normalizeStoryChapters(story.chapters);

  // Atelier items: allow any number
  const atelierItemsIn = Array.isArray(story.atelier?.items) && story.atelier.items.length > 0
    ? story.atelier.items
    : null;
  const atelierItems = atelierItemsIn
    ? atelierItemsIn.filter((it) => it && it.id).map((it) => {
        const fb = fallback.atelier.items.find((f) => f.id === it.id) || {};
        return {
          id:    it.id,
          title: asText(it.title, fb.title || ''),
          meta:  asText(it.meta,  fb.meta  || ''),
        };
      })
    : normalizeAtelierItems(story.atelier?.items);

  return {
    hero:       normalizeStoryHero(story.hero),
    heroFacts:  normalizeHeroFacts(story.heroFacts),
    intro: {
      kicker:   asText(story.intro?.kicker,   fallback.intro.kicker),
      headline: asText(story.intro?.headline, fallback.intro.headline),
      body:     asText(story.intro?.body,     fallback.intro.body),
    },
    chapters,
    quote: {
      text:   asText(story.quote?.text,   fallback.quote.text),
      accent: asText(story.quote?.accent, fallback.quote.accent),
      author: asText(story.quote?.author, fallback.quote.author),
    },
    atelier: {
      kicker: asText(story.atelier?.kicker, fallback.atelier.kicker),
      title:  asText(story.atelier?.title,  fallback.atelier.title),
      body:   asText(story.atelier?.body,   fallback.atelier.body),
      items:  atelierItems,
    },
  };
}

const HERO_MAX_COLORS = 4;

/** Mirrors colorSlug() in client-web utils/color-slug.ts. */
function colorSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Featured colourways for one slide. Colours carry no hex: the storefront
 * resolves that from ref_colors at render time. `imageUrl` is the hero shot for
 * that colourway and is owned by the slide, separate from the product gallery
 * images used on the product detail page. Entries without a usable label are
 * dropped, duplicates collapse, and the list is capped at HERO_MAX_COLORS.
 */
function normalizeHeroColors(colors) {
  if (!Array.isArray(colors)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of colors) {
    const label = asText(typeof entry === 'string' ? entry : entry?.label, '');
    if (!label) continue;
    const slug = colorSlug(label);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      label,
      slug,
      imageUrl: asText(typeof entry === 'string' ? '' : entry?.imageUrl, ''),
    });
    if (out.length >= HERO_MAX_COLORS) break;
  }
  return out;
}

/**
 * Work out which colourway a slide opens on and what image that means.
 *
 * The slide image is no longer edited directly: it is the default colour's hero
 * shot, so the hero always opens on a real colourway. `storedImage` keeps slides
 * saved before this change (and slides with no colours yet) rendering.
 */
function resolveHeroSlideImage(colors, requestedSlug, storedImage) {
  if (!colors.length) {
    return { imageUrl: storedImage, colors, defaultColorSlug: '' };
  }

  const match = colors.find((c) => c.slug === requestedSlug);
  const chosen = match || colors[0];
  return {
    imageUrl: chosen.imageUrl || storedImage,
    colors,
    defaultColorSlug: chosen.slug,
  };
}

function normalizeHeroSlider(heroSlider = {}) {
  const fb = DEFAULT_HOME_CONTENT.heroSlider;
  const inItems = Array.isArray(heroSlider.items) && heroSlider.items.length > 0
    ? heroSlider.items
    : fb.items;

  const items = inItems
    .filter((item) => item && item.id)
    .map((item) => {
      const fallback = fb.items.find((f) => f.id === item.id) || {};
      return {
        id:       item.id,
        name:     asText(item.name,     fallback.name     || ''),
        subtitle: asText(item.subtitle, fallback.subtitle || ''),
        descriptionEn: asText(item.descriptionEn, fallback.descriptionEn || ''),
        descriptionAr: asText(item.descriptionAr, fallback.descriptionAr || ''),
        ...resolveHeroSlideImage(
          normalizeHeroColors(item.colors ?? fallback.colors),
          asText(item.defaultColorSlug, fallback.defaultColorSlug || ''),
          asText(item.imageUrl, fallback.imageUrl || ''),
        ),
        alt:      asText(item.alt,      fallback.alt      || ''),
        productId: asText(item.productId, fallback.productId || ''),
      };
    });

  return {
    ctaEn: asText(heroSlider.ctaEn, fb.ctaEn),
    ctaAr: asText(heroSlider.ctaAr, fb.ctaAr),
    items,
  };
}

function normalizePromise(promise = {}) {
  const fb = DEFAULT_HOME_CONTENT.promise;
  const inCards = Array.isArray(promise.cards) ? promise.cards : [];
  const cards = fb.cards.map((fallback) => {
    const c = inCards.find((x) => x && x.id === fallback.id) || {};
    return {
      id:      fallback.id,
      icon:    asText(c.icon,    fallback.icon),
      labelEn: asText(c.labelEn, fallback.labelEn),
      labelAr: asText(c.labelAr, fallback.labelAr),
      subEn:   asText(c.subEn,   fallback.subEn),
      subAr:   asText(c.subAr,   fallback.subAr),
    };
  });
  return { cards };
}

function normalizeStats(stats = []) {
  const fb = DEFAULT_HOME_CONTENT.stats;
  const incoming = Array.isArray(stats) ? stats : [];
  return fb.map((fallback) => {
    const s = incoming.find((x) => x && x.id === fallback.id) || {};
    return {
      id:      fallback.id,
      value:   asText(s.value,   fallback.value),
      labelEn: asText(s.labelEn, fallback.labelEn),
      labelAr: asText(s.labelAr, fallback.labelAr),
    };
  });
}

function normalizeContact(contact = {}) {
  const fb = DEFAULT_HOME_CONTENT.contact;

  // Info blocks: allow any number (add/remove)
  const inBlocksRaw = Array.isArray(contact.infoBlocks) && contact.infoBlocks.length > 0
    ? contact.infoBlocks
    : fb.infoBlocks;
  const infoBlocks = inBlocksRaw.filter((b) => b && b.id).map((b) => {
    const fallback = fb.infoBlocks.find((f) => f.id === b.id) || {};
    const inLines = Array.isArray(b.lines) ? b.lines : (fallback.lines || []);
    return {
      id:      b.id,
      icon:    asText(b.icon,    fallback.icon    || '◆'),
      titleEn: asText(b.titleEn, fallback.titleEn || ''),
      titleAr: asText(b.titleAr, fallback.titleAr || ''),
      lines:   inLines.map((l) => asText(l, '')).filter(Boolean),
    };
  });

  // Social links: preserve all, allow any platform
  const VALID_PLATFORMS = ['whatsapp','instagram','twitter','facebook','tiktok','snapchat','youtube','linkedin'];
  const inSocial = Array.isArray(contact.socialLinks) && contact.socialLinks.length > 0
    ? contact.socialLinks
    : fb.socialLinks;
  const socialLinks = inSocial
    .filter((s) => s && s.id && VALID_PLATFORMS.includes(s.platform))
    .map((s) => ({
      id:       s.id,
      platform: s.platform,
      handle:   asText(s.handle, ''),
      enabled:  Boolean(s.enabled),
    }));

  return {
    kicker:           asText(contact.kicker,           fb.kicker),
    headlineEn:       asText(contact.headlineEn,       fb.headlineEn),
    headlineAccentEn: asText(contact.headlineAccentEn, fb.headlineAccentEn),
    headlineAr:       asText(contact.headlineAr,       fb.headlineAr),
    headlineAccentAr: asText(contact.headlineAccentAr, fb.headlineAccentAr),
    subhead:          asText(contact.subhead,          fb.subhead),
    email:            asText(contact.email,            fb.email),
    phone:            asText(contact.phone,            fb.phone),
    whatsapp:         asText(contact.whatsapp,         fb.whatsapp),
    promiseLine:      asText(contact.promiseLine,      fb.promiseLine),
    promiseSignature: asText(contact.promiseSignature, fb.promiseSignature),
    infoBlocks,
    socialLinks,
  };
}

function normalizeContent(input = {}) {
  return {
    hero:        normalizeHero(input.hero),
    collections: normalizeCollections(input.collections),
    story:       normalizeStory(input.story),
    heroSlider:  normalizeHeroSlider(input.heroSlider),
    promise:     normalizePromise(input.promise),
    stats:       normalizeStats(input.stats),
    contact:     normalizeContact(input.contact),
  };
}

function validateContent(_content) {
  // No blocking validation — content is normalized before this point.
  // Allow partial saves so admins can save drafts with incomplete images.
  return {};
}

function registerGet(router) {
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        const content = await loadContent(client, tenant.id);
        res.set('Cache-Control', 'no-store');
        ok(res, content);
      } finally {
        client.release();
      }
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

      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        await saveContent(client, tenant.id, next);
        return ok(res, clone(next), 'Home content updated.');
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    '/reset',
    asyncHandler(async (_req, res) => {
      const defaults = clone(DEFAULT_HOME_CONTENT);
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        await saveContent(client, tenant.id, defaults);
        ok(res, defaults, 'Home content reset.');
      } finally {
        client.release();
      }
    }),
  );
}

// ── Admin: GET /admin/storefront-content/draft ──────────────────────────────
function registerGetDraft(router) {
  router.get(
    '/draft',
    asyncHandler(async (_req, res) => {
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        const draft = await loadDraft(client, tenant.id);
        res.set('Cache-Control', 'no-store');
        ok(res, draft); // null when no draft exists
      } finally {
        client.release();
      }
    }),
  );
}

// ── Admin: POST /admin/storefront-content/draft ─────────────────────────────
function registerSaveDraft(router) {
  router.post(
    '/draft',
    asyncHandler(async (req, res) => {
      const next = normalizeContent(req.body);
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        await saveDraft(client, tenant.id, next);
        return ok(res, clone(next), 'Draft saved.');
      } finally {
        client.release();
      }
    }),
  );
}

// ── Admin: DELETE /admin/storefront-content/draft ───────────────────────────
function registerDeleteDraft(router) {
  router.delete(
    '/draft',
    asyncHandler(async (_req, res) => {
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        await ensureDraftColumn(client);
        await client.query(
          'UPDATE store_settings SET home_content_draft = NULL WHERE tenant_id = $1',
          [tenant.id],
        );
        ok(res, null, 'Draft discarded.');
      } finally {
        client.release();
      }
    }),
  );
}

// ── Admin: POST /admin/storefront-content/publish ───────────────────────────
function registerPublishContent(router) {
  router.post(
    '/publish',
    asyncHandler(async (_req, res) => {
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        const live = await promoteDraftToLive(client, tenant.id);
        return ok(res, clone(live), 'Draft published to storefront.');
      } finally {
        client.release();
      }
    }),
  );
}

// ── Admin: POST /admin/storefront-content/preview-token ────────────────────
function registerPreviewToken(router) {
  router.post(
    '/preview-token',
    asyncHandler(async (_req, res) => {
      const token = createPreviewToken();
      res.set('Cache-Control', 'no-store');
      ok(res, { token, ttlSeconds: PREVIEW_TOKEN_TTL_MS / 1000 });
    }),
  );
}

// ── Public: GET /storefront-content/draft?token=TOKEN ──────────────────────
function registerPublicDraft(router) {
  router.get(
    '/draft',
    asyncHandler(async (req, res) => {
      const { token } = req.query;
      if (!validatePreviewToken(token)) {
        res.status(401).json({ success: false, message: 'Invalid or expired preview token.' });
        return;
      }
      const client = await db.pool.connect();
      try {
        const tenant = await ensureDefaultTenant(client);
        // Fall back to live content when no draft exists
        const draft = await loadDraft(client, tenant.id) || await loadContent(client, tenant.id);
        res.set('Cache-Control', 'no-store');
        ok(res, draft);
      } finally {
        client.release();
      }
    }),
  );
}

const publicRouter = Router();
registerGet(publicRouter);
registerPublicDraft(publicRouter);

const adminRouter = Router();
registerGet(adminRouter);
registerPatch(adminRouter);
registerGetDraft(adminRouter);
registerSaveDraft(adminRouter);
registerDeleteDraft(adminRouter);
registerPublishContent(adminRouter);
registerPreviewToken(adminRouter);

module.exports = {
  adminRouter,
  publicRouter,
  DEFAULT_HOME_CONTENT,
};
