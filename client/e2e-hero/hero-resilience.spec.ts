import { expect, test, type Page } from '@playwright/test';

/**
 * Hero resilience guard — see docs/23-hero-resilience-plan.md.
 *
 * Every rule the hero relies on is a CSS rule, and CSS has no type checker. The
 * failures this guards against are silent: nothing throws, nothing scrolls, the
 * page simply degrades until the shoe overlaps the indicator or the buy button
 * slides under the fold. Twice during development a later rule in the same file
 * quietly reinstated the behaviour an earlier one had just removed, and only
 * re-measuring caught it.
 *
 * The point is therefore not to re-check the current content. It is to hold the
 * layout against content nobody has authored yet.
 */

/** Longest plausible strings, an unmapped colour, a slide with no art. */
function hostileHeroSlider() {
  const longName = 'Signature Heritage Ostrich Crossline Limited Edition Deluxe';
  const longDescription =
    'Arabic slippers made from genuine calf leather with a matt finish, featuring a ' +
    'hand stitched strap across the front, a cushioned footbed, a reinforced heel ' +
    'counter and a durable outsole built for daily wear in every season of the year.';

  const colour = (label: string, imageUrl = '') => ({ label, slug: label.toLowerCase(), imageUrl });

  return {
    ctaEn: 'Shop the Collection',
    ctaAr: 'تسوّق المجموعة',
    items: [
      {
        id: 'hostile-long',
        name: longName,
        subtitle: '',
        descriptionEn: longDescription,
        descriptionAr: longDescription,
        imageUrl: '/assets/hero-scroll/elite-hero-sandals-cutout.png',
        alt: 'Long name slide',
        productId: 'hostile-product',
        defaultColorSlug: 'black',
        // "Nutmeg Cream Exotic" is deliberately absent from ref_colors: it has no
        // hex and no swatch image, the case that used to delete the whole row.
        colors: [colour('Black'), colour('Nutmeg Cream Exotic'), colour('Dark Chocolate Brown')],
      },
      {
        id: 'hostile-empty',
        name: 'No Art',
        subtitle: '',
        descriptionEn: '',
        descriptionAr: '',
        imageUrl: '',
        alt: 'Slide with no image',
        productId: 'hostile-product',
        defaultColorSlug: '',
        colors: [],
      },
      // Eight further slides push the indicator past its floor and into scroll.
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `hostile-${i}`,
        name: `Slide ${i + 3}`,
        subtitle: '',
        descriptionEn: 'Short line.',
        descriptionAr: 'سطر قصير.',
        imageUrl: '/assets/hero-scroll/elite-hero-sandals-cutout.png',
        alt: `Slide ${i + 3}`,
        productId: 'hostile-product',
        defaultColorSlug: 'black',
        colors: [colour('Black')],
      })),
    ],
  };
}

/** Swap the hero slider inside the real payload, leaving every other section. */
async function useHostileContent(page: Page) {
  await page.route('**/api/storefront-content*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const target = body?.data ?? body;
    target.heroSlider = hostileHeroSlider();
    await route.fulfill({ response, json: body });
  });
}

type Geometry = {
  viewportHeight: number;
  scrollWidth: number;
  clientWidth: number;
  ctaBottom: number | null;
  stageBottom: number | null;
  navTop: number | null;
  stageHeight: number | null;
  stageTop: number | null;
  titleLines: number;
  descriptionLines: number;
  heroOverflowPx: number;
  minSegmentWidth: number | null;
  segmentHeight: number | null;
  colourBlockPresent: boolean;
  swatchCount: number;
  brokenImages: number;
};

async function readGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const lineCount = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return 0;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (!lh) return 0;
      return Math.round(el.getBoundingClientRect().height / lh);
    };
    const segments = [...document.querySelectorAll('.hero-pagination__segment')];
    const cta = box('.hero-cta');
    const stage = box('.hero-stage');
    const nav = box('.hero-pagination');

    return {
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // Widest point of anything inside the hero that an ancestor does not clip.
      // Scoped to the hero on purpose: the page already carries ~12px of
      // horizontal overflow from a section below it, with real content and no
      // hostile fixture, and that is a separate defect. Asserting document-wide
      // here would make this guard fail for a reason it does not govern.
      heroOverflowPx: (() => {
        const hero = document.querySelector('.hero');
        if (!hero) return 0;
        const limit = document.documentElement.clientWidth;
        let worst = 0;
        hero.querySelectorAll('*').forEach((el) => {
          let node = el.parentElement;
          while (node && node !== hero.parentElement) {
            const o = getComputedStyle(node).overflowX;
            if (o === 'clip' || o === 'hidden') return;
            node = node.parentElement;
          }
          const r = el.getBoundingClientRect();
          worst = Math.max(worst, r.right - limit, -r.left);
        });
        return Math.round(worst);
      })(),
      ctaBottom: cta ? cta.bottom : null,
      stageBottom: stage ? stage.bottom : null,
      navTop: nav ? nav.top : null,
      stageHeight: stage ? stage.height : null,
      stageTop: stage ? stage.top : null,
      titleLines: lineCount('.hero-brand p'),
      descriptionLines: lineCount('.hero-description'),
      minSegmentWidth: segments.length
        ? Math.min(...segments.map((s) => s.getBoundingClientRect().width))
        : null,
      segmentHeight: segments.length ? segments[0].getBoundingClientRect().height : null,
      colourBlockPresent: !!document.querySelector('.hero-colours'),
      swatchCount: document.querySelectorAll('.hero-swatch:not(.hero-swatch--more)').length,
      brokenImages: [...document.querySelectorAll('.hero-product img')].filter(
        (img) => (img as HTMLImageElement).currentSrc === '' ||
          (img as HTMLImageElement).getAttribute('src') === '',
      ).length,
    };
  });
}

/** Widths span the smallest phone still supported up to a wide-and-short desktop. */
const VIEWPORTS = [
  { name: '320x568 smallest phone', width: 320, height: 568 },
  { name: '353x760 narrow phone', width: 353, height: 760 },
  { name: '390x844 common phone', width: 390, height: 844 },
  { name: '430x932 large phone', width: 430, height: 932 },
  { name: '768x1024 tablet portrait', width: 768, height: 1024 },
  { name: '1024x768 stacked boundary', width: 1024, height: 768 },
  { name: '1280x720 laptop', width: 1280, height: 720 },
  { name: '1440x900 desktop', width: 1440, height: 900 },
  { name: '1919x836 wide and short', width: 1919, height: 836 },
  { name: '1920x1080 wide and tall', width: 1920, height: 1080 },
];

const STACKED_MAX = 1023;

for (const viewport of VIEWPORTS) {
  test(`hero survives hostile content at ${viewport.name}`, async ({ page }) => {
    await useHostileContent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.waitForSelector('.hero-stage', { timeout: 30_000 });
    // The art fades in over ~0.9s; measure after it has settled.
    await page.waitForTimeout(1_500);

    const g = await readGeometry(page);
    const stacked = viewport.width <= STACKED_MAX;

    // ── Guarantee 1: the buy button is reachable without scrolling ──────────
    expect(g.ctaBottom, 'CTA must render').not.toBeNull();
    expect(
      g.ctaBottom!,
      `CTA bottom ${g.ctaBottom} must sit within viewport height ${g.viewportHeight}`,
    ).toBeLessThanOrEqual(g.viewportHeight + 1);

    // ── Guarantee 2: the hero never pushes the page sideways ────────────────
    expect(
      g.heroOverflowPx,
      `hero content extends ${g.heroOverflowPx}px past the viewport`,
    ).toBeLessThanOrEqual(1);

    // ── Guarantee 3: the art never reaches the indicator row ────────────────
    // Measured on the stage, not the <img>: the image is scaled past its box on
    // purpose and is clipped by the stage's overflow, so the element rectangle
    // overlaps by design while the painted pixels do not.
    if (stacked && g.stageBottom !== null && g.navTop !== null) {
      expect(
        g.stageBottom,
        `stage bottom ${g.stageBottom} must not pass indicator top ${g.navTop}`,
      ).toBeLessThanOrEqual(g.navTop + 1);
    }

    // ── Phase 2: text is clamped, never trusted ─────────────────────────────
    expect(g.titleLines, 'product name line count').toBeLessThanOrEqual(stacked ? 2 : 3);
    expect(g.descriptionLines, 'description line count').toBeLessThanOrEqual(3);

    // ── Phase 4: indicator targets keep a floor ─────────────────────────────
    if (g.minSegmentWidth !== null) {
      expect(
        g.minSegmentWidth,
        `narrowest segment ${g.minSegmentWidth}px must clear the 26px floor`,
      ).toBeGreaterThanOrEqual(25.5);
      expect(g.segmentHeight!, 'segment height').toBeGreaterThanOrEqual(43.5);
    }

    // ── Phase 3: absence collapses gracefully ───────────────────────────────
    // The first hostile slide features a colour that is absent from ref_colors.
    // It must still render, because dropping it used to delete the whole row.
    expect(g.colourBlockPresent, 'colour block must survive an unmapped colour').toBe(true);
    expect(g.swatchCount, 'unmapped colour still occupies a swatch').toBeGreaterThan(0);
    expect(g.brokenImages, 'no <img> may be left with an empty src').toBe(0);
  });
}

test('short copy gives space back to the art without moving the lower controls', async ({ page }) => {
  await useHostileContent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForSelector('.hero-pagination__segment', { timeout: 30_000 });
  await page.waitForTimeout(1_500);

  const before = await readGeometry(page);

  // Slide 3 onwards carries short copy where slide 1 carries the maximum. The
  // stage should expand upward into the released space, while its lower edge
  // and all controls below it remain stable.
  await page.locator('.hero-pagination__segment').nth(2).click();
  await page.waitForTimeout(1_200);

  const after = await readGeometry(page);

  expect(
    after.stageTop!,
    `short copy should let the art rise above ${before.stageTop}, got ${after.stageTop}`,
  ).toBeLessThan(before.stageTop! - 20);
  expect(
    Math.abs(after.stageBottom! - before.stageBottom!),
    `art bottom moved from ${before.stageBottom} to ${after.stageBottom}`,
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs(after.navTop! - before.navTop!),
    `indicator moved from ${before.navTop} to ${after.navTop}`,
  ).toBeLessThanOrEqual(8);
  expect(after.ctaBottom!).toBeLessThanOrEqual(after.viewportHeight + 1);
});
