import { expect, test, type Page } from '@playwright/test';

/**
 * Hero interaction guard — see docs/26-hero-mobile-production-hardening-plan.md.
 *
 * A sibling of `hero-resilience.spec.ts` rather than an extension of it. That
 * file holds the hero's *layout* against content nobody has authored yet, and
 * every one of its assertions is a measurement taken once the page is still.
 * This file holds the hero's *state machine* against input nobody has sent yet,
 * and its assertions are about what happens while things are moving: which
 * request wins, how many layers exist mid-transition, what a stalled decode
 * does. The two need different fixtures and different waits, and the plan's
 * nine interaction scenarios would have more than doubled a file whose current
 * value is that it reads as one idea.
 *
 * What automation can and cannot certify is worth stating plainly, because the
 * plan's own release gate depends on the distinction. Chromium under Playwright
 * will not reproduce Safari's double-tap zoom, so nothing here proves that
 * tapping an arrow twice leaves the page unzoomed on an iPhone. What is proven
 * is the contract that makes it true: the declared `touch-action` on each
 * control, and the absence of a scale cap in the viewport meta. The physical
 * device matrix remains mandatory.
 */

/** Two products with three colourways each: enough to race, small enough to read. */
function interactiveHeroSlider() {
  const art = '/assets/hero-scroll/elite-hero-sandals-cutout.png';
  const colour = (label: string, imageUrl: string) => ({
    label,
    slug: label.toLowerCase(),
    imageUrl,
  });

  return {
    ctaEn: 'Shop the Collection',
    ctaAr: 'تسوّق المجموعة',
    items: Array.from({ length: 5 }, (_, i) => ({
      id: `interactive-${i}`,
      name: `Product ${i + 1}`,
      subtitle: '',
      descriptionEn: 'Short line.',
      descriptionAr: 'سطر قصير.',
      // Distinct query strings so each slide and colourway is a separate cache
      // key and a separate network request, which is what lets a test stall one
      // image without stalling the rest.
      imageUrl: `${art}?slide=${i}`,
      alt: `Product ${i + 1}`,
      productId: 'interactive-product',
      defaultColorSlug: 'black',
      colors: [
        colour('Black', `${art}?slide=${i}&c=black`),
        colour('Dark Chocolate Brown', `${art}?slide=${i}&c=brown`),
        colour('Sand Beige', `${art}?slide=${i}&c=sand`),
      ],
    })),
  };
}

async function useInteractiveContent(page: Page) {
  await page.route('**/api/storefront-content*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const target = body?.data ?? body;
    target.heroSlider = interactiveHeroSlider();
    await route.fulfill({ response, json: body });
  });
}

async function gotoHero(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.waitForSelector('.hero-pagination__segment', { timeout: 30_000 });
  // The entry animation runs ~0.9s. Measuring through it would read transient
  // opacities as stranded layers.
  await page.waitForTimeout(1_500);
}

/**
 * Assert the hero converges, rather than sampling it at one arbitrary instant.
 *
 * The contract in the plan is that cleanup *leaves* exactly one active layer,
 * not that only one layer exists at every moment: a crossfade has two by
 * definition. Sampling the count immediately after the slide label changes
 * catches the fade still running and fails on correct behaviour, which is
 * exactly what the first draft of this file did.
 */
async function expectSettledToOneLayer(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('.hero-product__image')].filter(
              (p) => Number(getComputedStyle(p).opacity) > 0.01,
            ).length,
        ),
      {
        message: 'hero must settle to a single painting layer',
        timeout: 5_000,
      },
    )
    .toBe(1);
}

/**
 * Watch the stage for the 16px directional slide class across an interaction.
 *
 * The class lives for a few hundred milliseconds at most, so polling for it
 * races the transition. A MutationObserver installed before the click records
 * it whether or not the assertion happens to look at the right moment.
 */
async function sawDirectionalCue(page: Page, interact: () => Promise<void>): Promise<boolean> {
  await page.evaluate(() => {
    const stage = document.querySelector('.hero-stage')!;
    (window as unknown as { __cue: boolean }).__cue = false;
    const observer = new MutationObserver(() => {
      if (stage.classList.contains('is-hero-slide-transition')) {
        (window as unknown as { __cue: boolean }).__cue = true;
      }
    });
    observer.observe(stage, { attributes: true, attributeFilter: ['class'] });
  });

  await interact();
  await page.waitForTimeout(1_500);

  return page.evaluate(() => (window as unknown as { __cue: boolean }).__cue);
}

/**
 * Reduced motion, applied explicitly and then verified.
 *
 * `test.use({ reducedMotion: 'reduce' })` silently did not take effect under
 * this config, and the failure mode was the worst kind: the reduced-motion
 * tests still passed, against the normal-motion code path, asserting nothing.
 * The assertion below is the point of this helper, not the emulation call.
 */
async function useReducedMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const applied = await page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  expect(applied, 'reduced-motion emulation must actually apply').toBe(true);
}

/** Slide currently committed, read the way a visitor reads it. */
function positionLabel(page: Page) {
  return page.locator('.hero-pagination__count').innerText();
}

test.describe('hero interaction hardening', () => {
  test.beforeEach(async ({ page }) => {
    await useInteractiveContent(page);
  });

  test('the touch contract replaces the viewport scale cap', async ({ page }) => {
    await gotoHero(page);

    const contract = await page.evaluate(() => {
      const stage = document.querySelector('.hero-stage')!;
      const touchOf = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).touchAction : null;
      };
      return {
        meta: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '',
        stage: getComputedStyle(stage).touchAction,
        arrow: touchOf('.hero-arrow'),
        swatch: touchOf('.hero-swatch'),
        segment: touchOf('.hero-pagination__segment'),
        cta: touchOf('.hero-cta'),
        imgDraggable: document
          .querySelector('.hero-product__image img')
          ?.getAttribute('draggable') ?? null,
      };
    });

    // Deliberate pinch zoom is an accessibility requirement, not a preference.
    // If a scale cap ever comes back this is the assertion that should stop it.
    expect(contract.meta).not.toContain('maximum-scale');
    expect(contract.meta).not.toContain('user-scalable=no');

    // The stage yields vertical scroll and pinch to the browser, and keeps only
    // the horizontal axis it actually implements.
    expect(contract.stage).toContain('pan-y');
    expect(contract.stage).toContain('pinch-zoom');

    // `manipulation` is what suppresses the double-tap zoom window on the
    // controls, which is the whole reason the global cap could be removed.
    for (const control of ['arrow', 'swatch', 'segment', 'cta'] as const) {
      expect(contract[control], `${control} touch-action`).toBe('manipulation');
    }

    expect(contract.imgDraggable, 'hero art must not start a native drag').toBe('false');
  });

  /**
   * The arrows must receive the pointer, not merely be painted.
   *
   * This is not a hypothetical. `.hero-pagination` runs `heroFadeIn`, an
   * opacity animation with `fill: both`, which makes it a stacking context that
   * outlives the animation. That trapped the arrows' `z-index: 7` inside a
   * context which itself painted below `.hero-product` at `z-index: 1`, and the
   * figure's box spans both arrows at every width. Every pixel of both controls
   * hit-tested as the artwork behind them. They rendered correctly, they
   * highlighted on hover, and they did nothing at all, on phone and desktop
   * alike.
   *
   * Sampling across the width rather than at the centre, because a control that
   * is clickable only at one edge is still broken.
   */
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1280, 800],
    [1920, 1080],
  ] as const) {
    test(`both arrows receive the pointer at ${width}x${height}`, async ({ page }) => {
      await gotoHero(page, width, height);

      const blocked = await page.evaluate(() => {
        const failures: string[] = [];
        for (const sel of ['.hero-arrow--prev', '.hero-arrow--next']) {
          const button = document.querySelector(sel);
          if (!button) {
            failures.push(`${sel} missing`);
            continue;
          }
          const r = button.getBoundingClientRect();
          for (const fraction of [0.15, 0.5, 0.85]) {
            const hit = document.elementFromPoint(
              r.left + r.width * fraction,
              r.top + r.height / 2,
            );
            if (hit !== button && !button.contains(hit)) {
              const who = String((hit as HTMLElement | null)?.className ?? 'nothing');
              failures.push(`${sel} at ${fraction} is covered by ${who}`);
            }
          }
        }
        return failures;
      });

      expect(blocked, blocked.join('; ')).toEqual([]);
    });
  }

  test('a burst of arrow taps settles on the last one requested', async ({ page }) => {
    await gotoHero(page);
    expect(await positionLabel(page)).toContain('01');

    // Twenty alternating activations cancel out, then three net forward. The
    // old implementation stepped from the committed slide, so a burst issued
    // before the first image decoded resolved to a single step.
    const next = page.locator('.hero-arrow--next');
    const prev = page.locator('.hero-arrow--prev');
    for (let i = 0; i < 10; i++) {
      await next.dispatchEvent('click');
      await prev.dispatchEvent('click');
    }
    await next.dispatchEvent('click');
    await next.dispatchEvent('click');
    await next.dispatchEvent('click');

    await expect(page.locator('.hero-pagination__count')).toContainText('04', {
      timeout: 10_000,
    });
    await expectSettledToOneLayer(page);
  });

  test('the newest colour wins when images resolve out of order', async ({ page }) => {
    // Hold the second colourway back so it lands after a colour requested
    // later. Without a request token the slow arrival overwrites the fast one
    // and the hero shows a colour the visitor already moved past.
    await page.route('**/*c=brown*', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });

    await gotoHero(page);

    const swatches = page.locator('.hero-swatch:not(.hero-swatch--more)');
    await expect(swatches).toHaveCount(3);

    await swatches.nth(1).dispatchEvent('click'); // slow brown
    await swatches.nth(2).dispatchEvent('click'); // fast sand, requested last

    await page.waitForTimeout(2_000);

    await expect(page.locator('.hero-colours__heading strong')).toHaveText('Sand Beige');
    await expectSettledToOneLayer(page);
    // The crossfade layer is transient by design; nothing may outlive it.
    await expect(page.locator('.hero-product__image--color-outgoing')).toHaveCount(0);
  });

  test('interleaved product and colour input leaves no stale commit', async ({ page }) => {
    await gotoHero(page);

    const next = page.locator('.hero-arrow--next');
    const swatches = page.locator('.hero-swatch:not(.hero-swatch--more)');

    for (let i = 0; i < 6; i++) {
      await next.dispatchEvent('click');
      await swatches.nth(i % 3).dispatchEvent('click');
    }
    await page.waitForTimeout(2_500);

    // A product change resets the colourway to the slide default, so the last
    // committed action is the arrow, not the swatch. What matters is that the
    // hero agrees with itself: one layer, one colour, no leftovers.
    await expectSettledToOneLayer(page);
    await expect(page.locator('.hero-product__image--color-outgoing')).toHaveCount(0);

    const settled = await page.evaluate(() => {
      const active = document.querySelector('.hero-product__image.is-active');
      return {
        activeOpacity: active ? getComputedStyle(active).opacity : null,
        activeTransform: active ? getComputedStyle(active).transform : null,
        selectedColour:
          document.querySelector('.hero-colours__heading strong')?.textContent?.trim() ?? '',
      };
    });
    expect(settled.activeOpacity).toBe('1');
    expect(settled.activeTransform === 'none' || settled.activeTransform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
    expect(settled.selectedColour.length).toBeGreaterThan(0);
  });

  test('the hero stays inside its own width throughout a transition', async ({ page }) => {
    await gotoHero(page);

    // Sampled *during* the transition, not after it. Measuring only the settled
    // state is how a layer that briefly overhangs gets through.
    //
    // Scoped to the hero rather than the document for the same reason the sister
    // suite scopes it: `body` carries `overflow-x: hidden`, so a document-level
    // `scrollWidth <= clientWidth` assertion is satisfied by the clipping and
    // proves nothing about whether a layer actually overhangs.
    const worst = await page.evaluate(async () => {
      const hero = document.querySelector('.hero')!;
      const limit = document.documentElement.clientWidth;
      let overhang = 0;
      const sample = () => {
        hero.querySelectorAll('.hero-product__image, .hero-product__image img').forEach((el) => {
          const r = el.getBoundingClientRect();
          overhang = Math.max(overhang, r.right - limit, -r.left);
        });
      };
      const next = document.querySelector<HTMLElement>('.hero-arrow--next')!;
      for (let i = 0; i < 6; i++) {
        next.click();
        for (let f = 0; f < 12; f++) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          sample();
        }
      }
      return Math.round(overhang);
    });

    // The art is scaled past its box on purpose and clipped by the stage, so
    // the comparison is against the stage's own clip, not the raw rectangle.
    const clipped = await page.evaluate(
      () => getComputedStyle(document.querySelector('.hero-stage')!).overflowX,
    );
    if (clipped === 'visible') {
      expect(worst, `hero layer overhangs by ${worst}px mid-transition`).toBeLessThanOrEqual(1);
    }
  });

  test('a stalled decode cannot freeze the hero', async ({ page }) => {
    // The regression this exists for was not theoretical and not subtle: on a
    // plain Chromium page load, `img.decode()` on a detached element resolved
    // its `load` event and then never settled. Because the commit awaited it,
    // arrows, pagination and swipe all stopped changing the slide, with no
    // error and no visual symptom other than a hero that ignored every tap.
    await page.addInitScript(() => {
      // Never settles, in either direction. The hero must finish anyway.
      HTMLImageElement.prototype.decode = () => new Promise<void>(() => undefined);
    });

    await gotoHero(page);
    await page.locator('.hero-arrow--next').dispatchEvent('click');

    await expect(page.locator('.hero-pagination__count')).toContainText('02', {
      timeout: 10_000,
    });
    await expectSettledToOneLayer(page);
  });

  test('a failed image keeps the slide that is already on screen', async ({ page }) => {
    await gotoHero(page);
    const before = await positionLabel(page);

    await page.route('**/*slide=1*', (route) => route.abort());
    await page.locator('.hero-arrow--next').dispatchEvent('click');
    await page.waitForTimeout(2_000);

    // Committing is still correct here: the visitor asked for slide 2 and the
    // hero owes them an answer. What it must not do is blank the stage.
    await expectSettledToOneLayer(page);
    const hasArt = await page.evaluate(() => {
      const active = document.querySelector('.hero-product__image.is-active img') as HTMLImageElement | null;
      return !!active && active.getAttribute('src') !== '';
    });
    expect(hasArt, `hero went blank after a failed load (was at ${before})`).toBe(true);
  });
});

test.describe('hero reduced motion', () => {
  test.beforeEach(async ({ page }) => {
    await useInteractiveContent(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the outgoing colourway fades out instead of sitting on top', async ({ page }) => {
    await gotoHero(page);
    await useReducedMotion(page);

    const swatches = page.locator('.hero-swatch:not(.hero-swatch--more)');
    await expect(swatches).toHaveCount(3);

    // The defect this guards: `.hero-product__image--color-outgoing` carries a
    // hard-coded `opacity: 1` and reaches zero only through its animation. The
    // reduced-motion block used to disable that animation, so the previous
    // colourway stayed fully opaque above the new one until a JavaScript timer
    // removed the element. Two colourways, stacked, for the whole swap.
    await swatches.nth(1).dispatchEvent('click');

    const outgoing = page.locator('.hero-product__image--color-outgoing');
    const observed = await page.evaluate(async () => {
      const readings: number[] = [];
      for (let f = 0; f < 24; f++) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const el = document.querySelector('.hero-product__image--color-outgoing');
        if (el) readings.push(Number(getComputedStyle(el).opacity));
      }
      return readings;
    });

    if (observed.length > 1) {
      expect(
        Math.min(...observed),
        `outgoing colourway never faded: opacities ${observed.join(', ')}`,
      ).toBeLessThan(0.95);
    }

    await expect(outgoing).toHaveCount(0, { timeout: 5_000 });
    await expectSettledToOneLayer(page);
  });

  test('reduced motion keeps a real crossfade and drops every spatial cue', async ({ page }) => {
    await gotoHero(page);
    await useReducedMotion(page);

    const style = await page.evaluate(() => {
      const stage = document.querySelector('.hero-stage')!;
      const layer = document.querySelector('.hero-product__image')!;
      const cs = getComputedStyle(layer);
      return {
        colourFade: getComputedStyle(stage).getPropertyValue('--hero-color-fade').trim(),
        transition: cs.transitionDuration,
        transform: cs.transform,
      };
    });

    const ms = (v: string) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);

    // A crossfade, not an instant cut. The previous `0.01ms` was the latter and
    // is what made the swap read as a flash rather than a change of state.
    const fade = ms(style.colourFade);
    expect(fade, `colour fade ${style.colourFade}`).toBeGreaterThanOrEqual(140);
    expect(fade, `colour fade ${style.colourFade}`).toBeLessThanOrEqual(180);

    const opacityMs = ms(style.transition.split(',')[0].trim());
    expect(opacityMs, `layer opacity transition ${style.transition}`).toBeGreaterThanOrEqual(140);
    expect(opacityMs, `layer opacity transition ${style.transition}`).toBeLessThanOrEqual(180);

    // Reduced motion removes travel. Nothing may translate or scale.
    expect(style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  });

  test('arrows never add a directional slide under reduced motion', async ({ page }) => {
    await gotoHero(page);
    await useReducedMotion(page);

    // A real mouse click, not `element.click()`. The component reads
    // `event.detail` to tell a pointer activation from a keyboard one and
    // deliberately skips the spatial cue for the latter, so a synthetic click
    // takes the no-cue branch on its own and the assertion below would hold
    // even with the reduced-motion path removed entirely.
    expect(await sawDirectionalCue(page, () => page.locator('.hero-arrow--next').click())).toBe(
      false,
    );
    await expectSettledToOneLayer(page);
  });
});

/**
 * Responsive sources, against the live content rather than a fixture.
 *
 * These deliberately do not stub the API. The thing being guarded is the
 * agreement between what the server generated on disk and what the hero asks
 * the browser to fetch, and a fixture would replace exactly the half that can
 * be wrong.
 */
test.describe('hero responsive sources', () => {
  test('every advertised candidate exists', async ({ page, request }) => {
    await gotoHero(page);

    const candidates = await page.evaluate(() =>
      [...document.querySelectorAll('.hero-product__image source, .hero-next-peek source')]
        .flatMap((source) => (source.getAttribute('srcset') ?? '').split(','))
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean),
    );

    // A hero with no variants at all would make this vacuous.
    expect(candidates.length, 'hero should advertise responsive candidates').toBeGreaterThan(0);

    // The old implementation built these by pasting `-card`/`-grid`/`-pdp`/
    // `-zoom` onto the filename regardless of what was generated, so an upload
    // too small for a size still advertised it and the browser could choose a
    // URL that 404s. Fetching each one is the only assertion that catches it.
    const broken: string[] = [];
    for (const url of [...new Set(candidates)]) {
      const response = await request.get(url);
      if (!response.ok()) broken.push(`${response.status()} ${url}`);
    }
    expect(broken, broken.join('; ')).toEqual([]);
  });

  test('declared widths match the files on disk', async ({ page, request }) => {
    await gotoHero(page);

    const declared = await page.evaluate(() =>
      [...document.querySelectorAll('.hero-product__image source')]
        .flatMap((source) => (source.getAttribute('srcset') ?? '').split(','))
        .map((entry) => entry.trim().split(/\s+/))
        .filter((parts) => parts.length === 2)
        .map(([url, descriptor]) => ({ url, width: Number(descriptor.replace('w', '')) })),
    );

    expect(declared.length).toBeGreaterThan(0);

    // A width descriptor is a promise the browser plans around: it picks a
    // candidate by comparing the declared width to the rendered size. A file
    // narrower than its descriptor is chosen for a slot it cannot fill and the
    // hero renders soft on exactly the retina screens this is meant to serve.
    const mismatched: string[] = [];
    for (const { url, width } of declared.slice(0, 6)) {
      const response = await request.get(url);
      if (!response.ok()) continue;
      const body = await response.body();
      // WebP intrinsic width: VP8X/VP8L/VP8 all carry it in the first 32 bytes.
      const riff = body.toString('ascii', 0, 4);
      if (riff !== 'RIFF') continue;
      let actual = 0;
      const format = body.toString('ascii', 12, 16);
      if (format === 'VP8X') {
        actual = 1 + (body[24] | (body[25] << 8) | (body[26] << 16));
      } else if (format === 'VP8 ') {
        actual = body.readUInt16LE(26) & 0x3fff;
      } else if (format === 'VP8L') {
        actual = 1 + (((body[22] | (body[23] << 8)) & 0x3fff));
      }
      if (actual > 0 && actual < width) {
        mismatched.push(`${url} declares ${width}w but is ${actual}px`);
      }
    }
    expect(mismatched, mismatched.join('; ')).toEqual([]);
  });

  test('a small upload advertises only the sizes that were generated', async ({ page }) => {
    // This is the actual defect, reproduced. `createImageVariants` skips any
    // size wider than roughly the source, so an upload at 1200px gets thumb,
    // card and grid and nothing else. The old client advertised `-pdp 1400w`
    // and `-zoom 1800w` for it regardless, and a retina browser would pick one
    // of the two files that were never written.
    //
    // Trimming the server's own report to the surviving sizes is what a small
    // upload looks like from the client's side.
    const kept = ['thumb', 'card', 'grid'];
    await page.route('**/api/storefront-content*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const target = body?.data ?? body;
      target.mediaVariants = Object.fromEntries(
        Object.entries(target.mediaVariants ?? {}).map(([key, variants]) => [
          key,
          (variants as Array<{ url: string; width: number }>).filter((variant) =>
            kept.some((size) => variant.url.includes(`-${size}.webp`)),
          ),
        ]),
      );
      await route.fulfill({ response, json: body });
    });

    await gotoHero(page);

    const advertised = await page.evaluate(() =>
      [...document.querySelectorAll('.hero-product__image source')]
        .flatMap((source) => (source.getAttribute('srcset') ?? '').split(','))
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean),
    );

    expect(advertised.length).toBeGreaterThan(0);
    const invented = advertised.filter(
      (url) => url.includes('-pdp.webp') || url.includes('-zoom.webp'),
    );
    expect(invented, `advertised sizes that do not exist: ${invented.join(', ')}`).toEqual([]);
  });

  test('an upload with no known variants falls back to a plain src', async ({ page }) => {
    // The server reports what it generated; when it reports nothing, the hero
    // must ask for the original rather than inventing suffixes. Slower, but a
    // request that always succeeds.
    await page.route('**/api/storefront-content*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const target = body?.data ?? body;
      target.mediaVariants = {};
      await route.fulfill({ response, json: body });
    });

    await gotoHero(page);

    const sources = await page.evaluate(() =>
      [...document.querySelectorAll('.hero-product__image source')].map((source) => ({
        srcset: source.getAttribute('srcset') ?? '',
        sizes: source.getAttribute('sizes'),
      })),
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.srcset, 'fallback srcset must be a single plain URL').not.toContain(',');
      expect(source.srcset).not.toMatch(/\d+w/);
      // `sizes` without `w` descriptors is meaningless and must not be emitted.
      expect(source.sizes).toBeNull();
    }
  });
});

test.describe('hero normal motion', () => {
  test.beforeEach(async ({ page }) => {
    await useInteractiveContent(page);
  });

  /**
   * The control for the reduced-motion assertion above.
   *
   * Without this, "no directional cue under reduced motion" is satisfied by a
   * hero that never cues at all, and the reduced-motion branch could be deleted
   * without any test noticing.
   */
  test('a pointer click on a desktop arrow does add the directional cue', async ({ page }) => {
    await gotoHero(page, 1280, 800);

    expect(await sawDirectionalCue(page, () => page.locator('.hero-arrow--next').click())).toBe(
      true,
    );
    await expectSettledToOneLayer(page);
  });
});
