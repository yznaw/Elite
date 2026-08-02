# 03 — Client Web (Storefront)

> **Audience:** Frontend developers  
> **Reading time:** ~12 minutes

---

## Overview

The **client-web** application is the customer-facing storefront. It's an Angular 17 standalone-component app that renders at `http://localhost:4200` in development and at the main domain (e.g., `https://website.com`) in production.

- **Prefix:** `cw` (all components use `<cw-*>` selectors)
- **Port:** 4200
- **Output:** `client/dist/client-web/`

---

## Pages & Routes

All page components are **lazy-loaded** via `loadComponent()`:

| Route | Component | File | Description |
|---|---|---|---|
| `/` | `HomeComponent` | `pages/home/` | Hero section, featured products, brand promise, stats |
| `/collection` | `CollectionComponent` | `pages/collection/` | All products grid with style/leather/sort filters |
| `/product/:id` | `ProductComponent` | `pages/product/` | Product detail — gallery, size selector, add to cart, accordions |
| `/checkout` | `CheckoutComponent` | `pages/checkout/` | 3-step checkout (details → delivery → payment) |
| `/story` | `StoryComponent` | `pages/story/` | Brand story with timeline chapters and artisan profiles |
| `/contact` | `ContactComponent` | `pages/contact/` | Contact form + advisor info cards |
| `**` | — | — | Redirects to `/` |

### Route Definition

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  // ... more lazy-loaded routes
  { path: '**', redirectTo: '' },
];
```

---

## App Shell

The root `AppComponent` renders:

```html
<cw-nav />          <!-- Navigation bar -->
<main>
  <router-outlet /> <!-- Active page -->
</main>
@if (!hideFooter()) {
  <cw-footer />     <!-- Footer (hidden on checkout) -->
}
<cw-cart-drawer />   <!-- Slide-in cart panel -->
```

The footer is **conditionally hidden** on the checkout page using a computed signal that watches the current URL.

---

## Product Descriptions

Products carry two description pairs, for two different surfaces:

| Field | Where it shows | Format |
|---|---|---|
| `descriptionEn` / `descriptionAr` | Product detail page | Rich text, rendered via sanitised `innerHTML` |
| `shortDescriptionEn` / `shortDescriptionAr` | Home hero and other compact places | Plain text, around 90 characters |

`productDescription()` picks the active locale and falls back to the other language, so a product with copy in only one still shows it. When both are empty the page renders the generic `product.descriptionTemplate` house copy, which was previously shown for every product regardless of its real description.

---

## Home Page Landing Hero

The home page hero is a luxury bilingual merchandising surface for élite. It uses
a dominant product cutout on a warm canvas with the same product navigation,
colour preview, short description and shopping action at every breakpoint.

### Files

| File | Purpose |
|---|---|
| `projects/client-web/src/app/pages/home/home.component.ts` | Slide loading, colour previews, swipe teaching and directional navigation |
| `projects/client-web/src/app/pages/home/home.component.html` | Product copy, cutouts, swatches, pagination and CTA |
| `projects/client-web/src/app/pages/home/home.component.scss` | Responsive composition, product scaling, motion and touch targets |
| `projects/client-web/src/assets/hero-scroll/` | Source product photos plus the transparent hero cutout |

### Runtime Behavior

- Slides advance by horizontal swipe, previous/next arrows or pagination segments.
- Adjacent arrow moves on a fine pointer use a 16px directional crossfade at 220ms. Coarse pointers, pagination jumps and colour previews use a plain opacity crossfade, because navigation is repeated far more often by thumb than by mouse and the spatial cue reads as lag at that cadence.
- RTL reverses physical travel direction. Keyboard activation and `prefers-reduced-motion` skip directional drift.

### Hero Interaction Contract

A tap has to be acknowledged immediately and resolved correctly even when several arrive before any image is ready. Four rules carry that:

| Rule | Where | Why |
|---|---|---|
| Intent and commitment are separate signals | `heroPendingItemIndex` vs `activeHeroItemIndex` | Arrow taps step the intent instantly and the pagination follows it, so the control never feels dead. The committed index moves only once the destination image is decoded, so the art never blanks. Stepping from the committed index meant a burst of taps on a slow connection all targeted the same neighbour and advanced one slide. |
| Only the newest request may commit | `heroSlideRequestId`, `heroColorRequestId` | An earlier, slower image arriving late cannot overwrite a destination the visitor has since changed. |
| Decode is an optimisation, never a gate | `HERO_DECODE_DEADLINE_MS` | `img.decode()` on a detached element can stay pending forever in Chrome even after `load` fires. Awaiting it directly froze the hero completely: every control silently stopped working with no error. |
| One gesture owns the stage | `onHeroPointerMove` axis lock | The gesture locks to an axis after 10px and takes pointer capture only once it is horizontal. Extra fingers are ignored rather than moving the start point, so a pinch cannot resolve as a swipe. |

**Touch policy.** The viewport meta carries no scale cap: deliberate pinch zoom stays available everywhere. Accidental double-tap zoom is suppressed where it happens instead, by `touch-action: manipulation` on the hero's arrows, swatches, pagination segments and CTA. The stage itself declares `pan-y pinch-zoom`. Focus zoom on form fields is handled separately by the 16px control floor in `styles.scss` — that floor is what makes removing the cap safe, so the two must not be separated.

**Responsive sources.** `heroSrcset()` reads `mediaVariants` from the content payload; it does not derive candidates from the filename. The server joins `media_assets` on each hero image and reports the sizes it actually generated, keyed by upload filename. This matters because `createImageVariants` skips any size wider than roughly the source, so a hero uploaded at 1200px has no `-zoom` sibling — and the old string-concatenation version still advertised `-zoom` at `1800w`, which a retina browser would then choose. An upload the map does not cover gets no `srcset` and a plain `src`: heavier, but never a request for a file that was never written.

**Stacking.** `.hero-pagination` sets `position: relative; z-index: 3`. It runs an opacity animation with `fill: both`, which makes it a permanent stacking context; without an explicit z-index that context painted below `.hero-product`, and the absolutely positioned arrows inside it were completely unclickable at every width.
- The stacked layout groups product name and description before the art, then pagination, colours and CTA.
- On first eligible touch visit, a one-time swipe demonstration plays only while at least 45% of the hero stage is visible.

### Mobile Hero Layout

The stacked layout (`max-width: 1023px`) is a centered CSS grid driven by
`--hero-mobile-gap` and `--mobile-product-size`. The short-viewport queries at
700px and 620px keep the art flexible so copy and controls stay inside `100svh`.

| Block | Element | Notes |
|---|---|---|
| Name + description | `.hero-intro` | Keeps the two lines visually grouped with a small safety floor; longer copy grows naturally and short copy gives the freed space back to the art while lower controls stay stable |
| Product | `.hero-stage` / `.hero-product` | `touch-action: pan-y pinch-zoom` keeps both vertical page scroll and deliberate zoom working; `overflow: hidden` clips the entering preview |
| Side preview | `.hero-next-peek` | Next slide's product, offscreen at rest, slid in only during the one-time swipe demo |
| Pagination | `.hero-pagination` | One 44px-high button per slide, rendered only when there are 2+ slides |
| Description | `.hero-description` | Per-slide selling copy, clamped to three lines or two on very short screens |
| Swatches | `.hero-swatches` | Up to 4 featured colourways plus an explicit `+N` overflow control |
| CTA | `.hero-cta` | Primary filled shopping action linked to the active product |

### Hero Colour Swatches

Each slide can link to a product (`productId`) and feature up to 4 of its colourways (`colors[]`).

**Tapping a swatch previews that colour in place** by swapping the hero image to the product's photo for that colour. It does not navigate. Tapping the active swatch again clears back to the slide's default image, and changing slides resets the selection.

The primary CTA opens the active product and carries the selected colour. The
trailing `+N` control appears only when the product has additional colourways.

- **Slug matching.** Swatch slugs are generated by `utils/color-slug.ts`, the same helper the product page uses to resolve its `?color=` param. Both must stay in sync or a swatch deep-link silently resolves to nothing. `product.component.ts` delegates its private `colorKey` / `colorSlug` to this helper for exactly that reason.
- **Colour values are never stored on the slide.** Hex and swatch images resolve at render time from `ref_colors` via `ReferenceDataService`, so editing a colour in Reference Data updates every swatch across the app.
- **A colour with no `ref_colors` entry stays visible as a hatched neutral disc** so the row and label do not disappear. The admin editor still warns before publish (see [04 – Admin Portal](./04-admin-portal.md)).
- **Each colour carries its own hero shot** (`colors[].imageUrl`), set in the storefront editor and stored on the slide. These are preloaded on init so tapping a swatch swaps instantly instead of flashing blank.
- **The slide opens on its default colourway** (`defaultColorSlug`), and that colour's swatch reads as selected before the visitor taps anything. The slide's `imageUrl` is derived from it server-side, so there is no separate slide image to keep in sync. Re-tapping the current colour is a no-op: a slide always shows some colour.
- **Hero shots are deliberately separate from product gallery images.** Hero art is a cutout styled for the hero stage; the product's own `imageColors` gallery serves the product detail page. The hero makes no per-product API call for images at all.
- **A colour with no hero shot keeps the slide's default image.** That is a valid state, not an error, but the admin editor flags it so it stays a deliberate choice.
- For visual consistency, colour shots should share the slide image's angle, crop, and background treatment. Mismatched framing makes the product jump position as the visitor taps between colours.

### Hero Image Geometry

The mobile hero art is **width-driven with a 1.4:1 box**, not square. `--mobile-product-size` sets the width and the height is that divided by 1.4, on both `.hero-stage` and `.hero-product`.

This matters because `object-fit: contain` fits the whole image inside its box. A typical product photo is landscape (the current upload is 3480x2160, about 1.61:1), so a square box letterboxed it to roughly 62% of the available height and the product read as small no matter how much the box grew. Matching the box to the art's shape recovered that space.

The width cap deliberately exceeds `100vw` (`min(124vw, 620px)`). Product photos carry their own internal margin, so running past the viewport edge enlarges the shoe without clipping it. `.hero` has `overflow: clip` and the body has `overflow-x: hidden`, so this cannot produce a horizontal scrollbar.

> [!IMPORTANT]
> `--mobile-product-size` must contain **no viewport-height unit**. It previously included a `78svh` term, which made the hero render at two different sizes depending on whether you had just resized the viewport or reloaded the page: `svh` changes as browser chrome shows and hides, and device emulation reports a stale height on resize. Vertical fit is capped separately by `height: min(…, 46svh)` on `.hero-stage`, where it can only shorten the box and never feed back into the width. The same rule applies to `heroSizes`, which the browser evaluates once at parse time.

If hero art is ever swapped for a squarer or portrait crop, revisit the `1.4` divisor and `heroSizes` together.

### Preparing Hero Art

CSS centres the *image*, so if the product sits off-centre inside the file, it renders off-centre on the page. The container cannot correct for framing.

Requirements for a hero shot:

| | Target |
|---|---|
| Aspect ratio | Close to **1.4:1 landscape**, matching the hero box |
| Subject fill | **85% or more** of the frame |
| Margins | Even on all sides, ideally under 8% |
| Subject centre | 50% horizontally and vertically |
| Background | Transparent PNG, or pure white for `multiply` blending |
| Resolution | 2000px wide minimum; variants are generated automatically |

Cropping matters more than resolution. A 3480px photo whose subject fills only half the frame renders smaller than a 1600px photo cropped tight, and wastes bandwidth on empty background.

`object-position: center 44%` compensates for the usual case of more empty space below the subject than above. It is a small optical correction, not a substitute for a correctly cropped file.

### Hero Image Resolution

Uploaded images are stored with resized variants beside the original: `-thumb` 240, `-card` 640, `-grid` 900, `-pdp` 1400, `-zoom` 1800 (see `server/lib/storage.js`).

`heroSrcset()` builds a `<source srcset>` across the four larger variants, paired with `heroSizes`. The hero renders up to 400px on mobile and 1120px on desktop, so a phone pulls roughly the grid variant and a retina desktop the zoom variant, instead of the multi-megapixel original.

Two things must stay in step or the image renders soft:

- `heroSizes` must mirror `--mobile-product-size` and `.hero-product`'s width in the SCSS.
- The LCP `<link rel=preload>` carries the same `imagesrcset` / `imagesizes`, so the preload and the render resolve to one file rather than fetching two.

`heroSrcset()` strips any variant suffix before rebuilding the set, so a URL saved as `-card` still yields the full range. It returns `''` for bundled `/assets` art, which has no variants, and the template falls back to a plain `src`.

> [!IMPORTANT]
> The admin media picker must save the **full-size** URL (`storageUrl`), not `preview`. `preview` is the 640px card variant, intended for picker thumbnails.
- Every swatch carries an inset ring so white, cream, and milk stay visible against the cream canvas, and sits in a 44px tap target.

Swipe handling lives in `home.component.ts`. `onHeroPointerDown` /
`onHeroPointerUp` / `onHeroPointerCancel` commit after a 44px horizontal
threshold and require `|dx| > |dy| * 1.4`, preserving vertical page scroll.
There is no per-frame drag transform. After release, adjacent navigation uses a
bounded 16px/420ms directional crossfade; pagination and colour changes remain
plain fades.

CTA contrast: `#004538` on `#ffffff` is 12.4:1, clearing WCAG AA and AAA. Pagination segments carry a 44px tall hit area for WCAG 2.5.5.

### Hero Side Preview and Swipe Hint

On mobile a one-time animation demonstrates the swipe gesture by sliding the next slide's product (`.hero-next-peek`) in from the trailing edge while the active product yields.

> [!IMPORTANT]
> The preview rests **fully outside the frame** and exists only mid-gesture. It is deliberately not a persistent edge sliver. `--mobile-product-size` is `min(124vw, 620px)` by design (see *Hero Image Geometry*), so the active product overflows roughly **81px past each edge** at 390px wide. A resting sliver was measured overlapping the active shoe by 101px and read as a cream smudge on top of it rather than as a second product. There is no free edge lane on a phone unless the hero art is shrunk, which would reverse a deliberate sizing decision.

**The demo moves both layers by the same `--peek-shift`.** That shared displacement is the physical model of a real swipe: one track moving under the finger. An earlier version moved the active product 14px and the incoming one ~150px, which gave the eye no causal link and taught nothing.

The two dials live on `.hero-stage`:

| Variable | Value | Role |
|---|---|---|
| `--peek-shift` | `clamp(88px, 26vw, 128px)` | How far the active product yields. Must **exceed the product's own right overflow** (~81px) or the preview lands on top of the current shoe rather than beside it. |
| `--peek-reveal` | `clamp(62px, 18vw, 92px)` | How much of the incoming product shows at the peak. Kept below `--peek-shift` so it occupies vacated space. |
| `--peek-dir` | `1`, or `-1` under `html[dir='rtl']` | Travel direction. One keyframe set serves both writing directions by multiplying offsets through this sign, instead of a second RTL set selected with an `animation-name` override. |

> [!WARNING]
> **The four `leatherPeek*` / `leatherHint*` / `leatherSwipeTag` keyframes live in `styles.scss`, not in the component.** Keep them there. Angular scopes component `@keyframes` names (`_ngcontent-xxx_leatherPeekNext`), and the component's reduced-motion block sets `animation: none` on the same selectors. In optimized builds the CSS optimizer treated that `none` as the resolved value for those rules and stopped rewriting the animation names, so `animation-name: leatherPeekNext` pointed at a scoped name that did not exist and **nothing ran**. Global keyframes are never renamed, so the names always match.
>
> This failed **only in production**: `ng serve` does not optimize, so the names stayed in sync and the animation worked locally. Verifying with `ng build --configuration development` will not catch it. Test the real production bundle:
> ```bash
> cd client && npx ng build client-web
> cd dist/client-web/browser && python3 -m http.server 4300
> ```
> The symptom is a hero preview stuck at `opacity: 0` with `getAnimations()` returning an empty array while `.is-leather-peeking` is present on the stage.

Other treatment: the stage carries `overflow: hidden` on mobile so the preview enters from a hard edge instead of appearing in mid-air; a `mask-image` gradient softens that boundary; `object-position: center 44%` matches the active product so both shoes sit at the same optical height; and the incoming layer peaks at `opacity: 0.92` / `scale(0.97)`, never reaching parity, so it always reads as "next". RTL flips the entry edge, mask, transform origin, and both keyframe sets via `:host-context(html[dir='rtl'])`, with the pill arrow flipping to `←` in the template.

Timing is **1500ms run twice** rather than one long pass, with the peak held only from 42% to 58% (~240ms). A long frozen peak is what makes such a state read as a broken layout instead of a demonstration.

Guards in `home.component.ts`:

- The hint is skipped entirely if the visitor has already swiped or used the pagination (`heroInteracted`), checked both before scheduling and again when the 1400ms settle timer fires.
- An `IntersectionObserver` requires 45% stage visibility. Scrolling away cancels the timer without spending the once-per-session flag; returning schedules it again.
- `sessionStorage` (`elite:hero-swipe-hint-shown`) scopes it to once per visit rather than once per navigation to `/`. Access is wrapped in `try/catch` for private-mode Safari.
- The dismiss timer is `duration × iterations + 200ms`. Dismissing exactly on the animation duration could pull the class on its final frame.
- Swiping mid-demo eases the layers home over 180ms via `.is-peek-releasing` rather than snapping. `stopHeroPeek` pins the live computed transform inline, drops the animation, then releases the pin. Two details are load-bearing and were both verified against a real touch event, since each fails silently:
  - The pin must use `setProperty(..., 'important')`. The keyframes are still running when it is written, and a running animation outranks a plain inline style, so without `!important` the pinned value is ignored and the snap happens anyway.
  - The release must wait **two** animation frames. One frame is not enough for Angular to flush the class change, so the inline value gets cleared before it has been committed as the transition's starting style.

> [!NOTE]
> Under `prefers-reduced-motion: reduce` the preview stays hidden: it only ever exists mid-gesture, so there is nothing to show statically. Those users are served by the swipe pill, which stays legible for 5s, and by the pagination segments, which show the slide count directly.

Swipe-hint pill text is `#7d5e28`, measured at 5.48:1 against its composited background. The previous `#8f6d32` measured 4.36:1 and missed the WCAG AA 4.5:1 floor.

### Hero Assets

The hero uses one dominant cutout and supporting detail images.

| Asset | Purpose |
|---|---|---|
| `/assets/hero-scroll/elite-angle-pair-cutout.png` | Main transparent hero product image |
| `/assets/hero-scroll/elite-angle-single.jpeg` | Leather strap thumbnail and natural grain detail |
| `/assets/hero-scroll/elite-front-pair.jpeg` | Buckle thumbnail |
| `/assets/hero-scroll/elite-top-pair.jpeg` | Stitching thumbnail and embossed footbed detail |
| `/assets/hero-scroll/elite-side-single.jpeg` | Comfort sole thumbnail and profile detail |

### Framing and Responsive Notes

The product is intentionally large and centered. Desktop callouts are absolutely placed around the shoe, while mobile intentionally avoids floating labels and stacks the same content into cards.

When adjusting the hero:

- Keep the hero background at `#faf7f2`.
- Keep connector lines and pill borders on the local gold token `#b8965a`.
- Check the desktop first viewport to ensure the CTA, lookbook rail, callouts, and product do not overlap.
- Check mobile to ensure the order remains name, product, pagination, description, CTA, and that the CTA stays visible without scrolling.
- Keep slide descriptions to roughly 18 words. Longer copy wraps past two lines and pushes the CTA below the fold.

### Verification

Run:

```bash
cd client
npm run build:web
```

Manual QA:

- Open the storefront home page.
- Confirm the main sandal appears on the cream background without a white image box.
- Hover each desktop callout and confirm the connector line/dot highlight.
- Confirm the CTA is visible in the first desktop viewport.
- Check mobile widths to ensure the feature cards stack cleanly and the floating desktop callouts are hidden.
- On a mobile viewport, wait ~1.4s after load and confirm the swipe demo plays: the active product slides left and the next product enters from the trailing edge, recognisably a shoe rather than a cream smudge. `--peek-shift` and `--peek-reveal` are the two dials if it needs tuning.
- Swipe **during** the demo and confirm the layers ease home over ~180ms rather than snapping.
- Reload and confirm the demo does not replay in the same session.
- Switch to Arabic and confirm the preview enters from the leading edge and the pill arrow points `←`.
- With `prefers-reduced-motion: reduce`, confirm nothing animates and the swipe pill still appears.
- **Verify the hero preview against a production bundle, not just `ng serve`.** See the warning above: this animation has already broken once in production while working locally.

---

## Shared Components

Located in `app/shared/`:

| Component | Selector | Description |
|---|---|---|
| `NavComponent` | `<cw-nav>` | Floating green primary navigation bar with logo, desktop links, cart icon, and mobile menu |
| `FooterComponent` | `<cw-footer>` | Footer with link columns, brand tagline, copyright |
| `CartDrawerComponent` | `<cw-cart-drawer>` | Slide-in cart panel with items, quantities, subtotal, checkout button |

---

## Services

### `ProductsService`

- **File:** `services/products.service.ts`
- **Provider:** Root-level (`providedIn: 'root'`)
- **State:** `_products` signal (empty initial, loaded from `/api/products` on construction); `defaultImage` string (loaded from `/api/config` before products load, falls back to `/assets/brand/elite-logo-green.png` if not configured)
- **Methods:**
  - `getAll(): Product[]` — Returns products signal value
  - `getById(id: string): Product | undefined` — Find by UUID
  - `getFeatured(): Product[]` — Returns first 3 products
  - `ensureLoaded() / refresh()` — Force-reload from API
- **Image normalization:** All products returned from the API pass through `normalizeProductImages()` which resolves `/uploads/…` paths via `resolveMediaUrl()` (→ `/api/uploads/…`), deduplicates the `images[]` array, and applies `colorImages` normalization. Missing images fall back to `this.defaultImage`.

**`resolveMediaUrl()` — Bug fix (June 2026):** The previous implementation stripped `/api/` from the base URL (`apiBase.replace(/\/api\/?$/, '')`), leaving an empty prefix in production. Now uses `${this.apiBase}${value}` directly so `/uploads/abc.jpg` becomes `/api/uploads/abc.jpg`, which routes through the Nginx proxy to Express.

**Fallback images:** `FALLBACK_IMAGE` constant (used by `onImgError` in collection and product pages) was changed from a hardcoded Unsplash URL to `/assets/brand/elite-logo-green.png`.

### `CartService`

- **File:** `services/cart.service.ts`
- **State:** Angular Signals (`signal()`, `computed()`)
- **Persistence:** `localStorage` key `elite_cart`
- **API:**
  - `items` — Readonly signal of cart items
  - `isOpen` — Readonly signal for drawer visibility
  - `count` — Computed total quantity
  - `subtotal` — Computed total price
  - `add(item)` — Add or increment item
  - `remove(id, size)` — Remove by ID + size combo
  - `clear()` — Empty cart
  - `openDrawer()` / `closeDrawer()` — Toggle cart panel

### `LocaleService`

- **File:** `services/locale.service.ts`
- **State:** Signal with `'en' | 'ar'` locale
- **Persistence:** `localStorage` key `elite-web:locale`
- **Side effects:** Sets `lang` and `dir` attributes on `<html>`, toggles `.rtl` class on `<body>`
- **API:**
  - `locale` — Current locale signal
  - `dir` — Computed `'ltr' | 'rtl'`
  - `isRtl` — Computed boolean
  - `set(locale)` — Set locale
  - `toggle()` — Switch between EN/AR

### `I18nService`

- **File:** `services/i18n.service.ts`
- **Dependency:** `LocaleService`
- **API:**
  - `t(key: string): string` — Translate a key using the current locale

---

## i18n System

### How It Works

1. All translatable strings live in `app/i18n/strings.ts`
2. The file exports `STRINGS` — a record mapping locale (`'en' | 'ar'`) to a key-value dictionary
3. Components inject `I18nService` and use `i18n.t('key.name')` to get translated strings
4. Switching language is instant — no page reload needed

### String File Structure

```typescript
// i18n/strings.ts
const EN = {
  'brand.name': 'ELITE',
  'brand.tagline': 'Arabic Leather Artisans',
  'nav.collection': 'Collection',
  // ... 300+ keys
} as const;

const AR: Record<keyof typeof EN, string> = {
  'brand.name': 'إيليت',
  'brand.tagline': 'حرفيون عرب لصناعة الجلود',
  'nav.collection': 'المجموعة',
  // ... same keys, Arabic values
};

export const STRINGS: Record<Locale, Record<string, string>> = { en: EN, ar: AR };
```

### Key Categories

| Prefix | Content |
|---|---|
| `brand.*` | Brand name, tagline, heritage |
| `nav.*` | Navigation labels |
| `common.*` | Shared UI labels (buttons, etc.) |
| `cart.*` | Cart drawer |
| `footer.*` | Footer content |
| `home.*` | Home page sections |
| `collection.*` | Collection page filters & sorting |
| `product.*` | Product detail page |
| `checkout.*` | Checkout flow |
| `story.*` | Brand story page |
| `contact.*` | Contact page |

### Adding a New String

1. Add the key + English value to the `EN` object
2. Add the same key + Arabic value to the `AR` object
3. TypeScript will enforce that both objects have the same keys (AR uses `Record<keyof typeof EN, string>`)
4. Use in component: `this.i18n.t('your.new.key')`

---

## Styling System

### Design Tokens (CSS Custom Properties)

All visual tokens are defined in `styles.scss` under `:root`:

```scss
:root {
  // Colors
  --bg:        #faf8f4;        // Page background (warm cream)
  --surface:   #f4f0e8;        // Elevated surface
  --card:      #eee9df;        // Card background
  --gold:      #b8924a;        // Primary accent (gold)
  --gold-dim:  #9a7535;        // Darker gold
  --gold-glow: rgba(184,146,74,0.12);  // Gold tint
  --cream:     #1a1208;        // Primary text (near-black)
  --muted:     #8a7a62;        // Secondary text
  --border:    rgba(0,0,0,0.10);

  // Typography
  --ff-serif:  'Thmanyah Serif Display', Georgia, serif;  // Headings
  --ff-sans:   'Thmanyah Sans', system-ui, sans-serif;    // Body text
}
```

### To rebrand: change ONLY the `:root` variables. All components reference these tokens.

### Utility Classes

| Class | Purpose |
|---|---|
| `.serif` | Apply serif font |
| `.gold-text` | Gradient gold text (background-clip) |
| `.glass` | Glassmorphism effect (blur + transparency) |
| `.btn-gold` | Gold gradient CTA button |
| `.btn-outline` | Outlined button with gold accent |
| `.anim-fade-up` | Fade-up entrance animation |
| `.anim-fade-in` | Simple fade-in |
| `.anim-float` | Gentle floating animation |
| `.divider` | Horizontal gradient line |
| `.float-wrap` / `.float-input` / `.float-label` | Floating-label input fields |
| `.product-card` | Product card with hover scale effect |
| `.filter-pill` | Filter button with active state |
| `.size-btn` | Size selector button |
| `.tag-chip` | Tag/label chip |
| `.step-indicator` | Checkout step circle |

### Fonts

Self-hosted from `assets/fonts/thmanyah/` (woff2 format). The Thmanyah font family is a bilingual Arabic+Latin typeface with three sub-families:

| Family | CSS Variable | Weights | Used For |
|---|---|---|---|
| **Thmanyah Sans** | `--ff-sans` | 300, 400, 500, 700, 900 | Body text, UI labels, buttons |
| **Thmanyah Serif Display** | `--ff-serif` | 300, 400, 500, 700, 900 | Headings, hero text, editorial |
| **Thmanyah Serif Text** | (available) | 300, 400, 500, 700, 900 | Long-form body text (optional use) |

All `@font-face` declarations are at the top of `styles.scss`. No external font loading (Google Fonts) is needed.

### Animations

8 keyframe animations are defined globally:
- `fadeUp`, `fadeIn`, `slideInRight` — Page/component entrances
- `shimmer` — Loading placeholder
- `floatY` — Subtle floating motion
- `rotateSlow` — 360° rotation
- `pulseGold` — Gold glow pulse
- `metaIn` — Metadata entrance

---

## Models

### `Product` (client-web)

```typescript
interface Product {
  id: string;              // UUID (was `number` in the mock era)
  name: string;
  price: number;
  tag: string;             // 'Signature' | 'New' | 'Bestseller' | 'Limited' | ''
  leather: string;         // e.g. 'Camel Nappa', 'Goat Suede'
  style: string;           // 'Oxford' | 'Derby' | 'Loafer' | 'Boot'
  sizes: number[];         // EU sizes — empty [] for size-optional products (sunglasses, accessories)
  image: string;           // Primary URL (resolved via resolveMediaUrl)
  images?: string[];       // Full gallery
  colorImages?: Record<string, string>; // color name → image URL
  variants?: ProductVariant[];
}
```

#### Size-optional products

Products where `sizes.length === 0` (e.g. sunglasses, accessories) are handled gracefully:

- **Product page:** the entire size selector section is hidden (`@if (p.sizes && p.sizes.length > 0)`).
- **`selectedSizeInStock`:** checks total variant stock instead of per-size stock.
- **`cartItem()`:** `size` defaults to `0` (not hardcoded `40`).
- **Restock form:** no longer requires a size to be selected before submitting.

The public products API previously returned `[40, 41, 42, 43, 44]` as a fallback when a product had no size variants. This fallback was removed — the API now returns `sizes: []` for size-optional products.

### `CartItem`

```typescript
interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  leather: string;
  size: number;
  qty: number;
}
```

---

## How To: Add a New Page

1. **Create component folder:** `client/projects/client-web/src/app/pages/your-page/`
2. **Create component file:**

```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'cw-your-page',
  standalone: true,
  template: `<h1>Your Page</h1>`,
})
export class YourPageComponent {}
```

3. **Add route** in `app.routes.ts`:

```typescript
{
  path: 'your-page',
  loadComponent: () =>
    import('./pages/your-page/your-page.component').then(m => m.YourPageComponent),
},
```

4. **Add i18n keys** if needed
5. **Add nav link** in `NavComponent` if it should appear in navigation

---

## Related Documents

- [02 – Architecture](./02-architecture.md) — Monorepo and build setup
- [04 – Admin Portal](./04-admin-portal.md) — The other Angular app
- [06 – White-Label Guide](./06-white-label-guide.md) — How to rebrand
