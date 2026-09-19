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
| `/contact` | `ContactComponent` | `pages/contact/` | Branch cards with live open/closed state, stockists, direct contact, enquiry form |
| `**` | `NotFoundComponent` | `pages/not-found/` | 404 dead end. Answers HTTP `404` from the server, sets `noindex, follow`; deliberately does **not** redirect |

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

### Search Engine Discovery

`robots.txt` lives at `projects/client-web/src/robots.txt` and is copied to the bundle root by the `assets` list in `client/angular.json`. It allows everything except `/checkout` and `/thank-you`, and points crawlers at `https://elitecollections.qa/sitemap.xml`.

The sitemap itself is **not** a static file. It is generated from live catalogue data by `GET /api/sitemap.xml` (see `docs/05-api-server.md`) and exposed at the site root by an nginx `location = /sitemap.xml` proxy, because the page renderer would otherwise answer it as a `404` page. Adding a public route to `app.routes.ts` therefore means adding it to `STATIC_ROUTES` in `server/routes/sitemap.route.js` as well, and giving it a render mode in `app.routes.server.ts` (see below) — nothing scans the route table automatically. `/experience` is the in-store feedback kiosk and is deliberately in neither.

### Catalogue Navigation Is Anchors, Not Click Handlers

Every card that moves a visitor deeper into the catalogue is an `<a [routerLink]>`: the collection cards on `/collection`, the sub-collection cards under a parent such as Men, the product cards in the grid, the hero's primary call to action, and the recommended products on a product page.

They used to be `<button (click)="router.navigate(...)">`. That is invisible to a crawler. The served HTML for `/collection/all-products` carried the names of all 48 products and not a single `href`, so Google could read the catalogue and never walk into it. Search Console reported 47 product pages as `Discovered - currently not indexed`, the signature of URLs known only from a sitemap with nothing linking to them: **a sitemap says a page exists, an internal link says it matters.**

Rules when adding a card:

- Navigation is an anchor with `routerLink`. Anything that is not navigation (a colour swatch, a size picker, add-to-cart) stays a `<button>`, and must be a **sibling** of the anchor, never nested inside it.
- Side effects that used to live in the navigate method (resetting filters, scrolling to top, swapping the rendered product) move into a `(click)` handler that first checks the click is a plain left click. `routerLink` leaves ctrl-, cmd-, shift- and middle-clicks to the browser, so a card opened in a background tab must not mutate the tab the visitor is still looking at.
- Anything feeding `[queryParams]` is memoised. It is a binding now, not a one-shot call, so a fresh object each change-detection pass would rebuild 48 hrefs on every pass.
- The anchors need `text-decoration: none`; the old `<button>` rules did not.

Recommended products on a product page are the one gap: they need the full catalogue, which the server deliberately does not load for a single product render (it cost roughly a megabyte per request). They appear in the browser only, so product-to-product linking passes no crawl signal. The crawl path into every product runs through the collection pages instead: `/collection` links the four collections, a parent links its children, and `/collection/all-products` links all 48 products.

### Per-page Head Tags (`SeoService`)

`services/seo.service.ts` owns everything in `<head>` that varies by page: `<title>`, `meta[name=description]`, `link[rel=canonical]`, the Open Graph and Twitter Card set, and one JSON-LD block.

Pages do not call it imperatively. They declare a factory in a **field initializer**:

```ts
private readonly seoTags = this.seo.watch(() => ({
  title: this.i18n.t('seo.story.title'),
  description: this.i18n.t('seo.story.description'),
  canonicalPath: '/story',
}));
```

`watch()` wraps the factory in an `effect`, which has two consequences worth knowing:

- It must stay in an injection context (field initializer or constructor). Moving the call into `ngOnInit` throws, and worse, an effect created outside the component's injector would outlive the page and keep writing to the head after navigation.
- It re-runs whenever any signal it reads changes. That covers both "the product finished loading" and "the visitor switched to Arabic" without either case needing its own wiring. Return `null` while data is still loading and the previous page's tags stay up rather than flashing an empty title.

Two behaviours exist for specific reasons:

- **The canonical drops the query string.** `/product/:id` carries `?color=`, and `/collection/...` carries filter and sort params. Left alone, every filter combination would present itself to Google as a separate page competing with the others. `canonicalPath` is built from the route, never from `router.url`.
- **JSON-LD is replaced, not appended.** One `script[data-seo]` element is reused across navigations and removed when a page supplies none, so a stale `Product` block cannot linger on a policy page.

Copy lives in `i18n/strings.ts` under the `seo.*` prefix, in both languages. `SeoService` appends the site name to every title, so those keys hold the page part only.

Deliberately **not** implemented: `AggregateRating` in the product JSON-LD (the storefront has no rating aggregate to read, and inventing one violates Google's structured-data policy) and `hreflang` (EN and AR share one URL, so there is no alternate to point at).

On server-rendered routes these tags are in the HTML the server sends, so every crawler sees them, including the social ones behind WhatsApp, Facebook and X that never run JavaScript. That now covers product pages: their title, description, image and `Product` JSON-LD (price and availability included) ship with the page. The routes still rendered in the browser — checkout and its result pages, thank-you, the in-store kiosk — carry only the static site-level tags from `index.html`, and none of them is meant to be indexed.

---

## Server-Side Rendering

Public pages are rendered per request by `@angular/ssr` (`outputMode: "server"` in `angular.json`) and hydrated in the browser. Nothing is prerendered at build time, so content published from the admin is live on the next page view.

| File | Role |
|---|---|
| `src/server.ts` | Express entry run by PM2 `elite-web` on `127.0.0.1:4000`. Sends `Cache-Control: no-store` on every page. |
| `src/main.server.ts` | Server bootstrap. |
| `app/app.routes.server.ts` | Render mode per route. |
| `app/app.config.server.ts` | Server-only providers: the API backend and `SITE_ORIGIN`. |
| `app/core/api-base.ts` | `API_BASE`, `PUBLIC_API_BASE`, `SITE_ORIGIN` injection tokens. |
| `scripts/ssr-smoke.mjs` | Renders every route with the API down and (with `--api`) up. |

### Render modes

| Mode | Routes | Why |
|---|---|---|
| Server | `/`, `/collection`, `/collection/:collection`, `/collection/:parent/:child`, `/story`, `/contact`, `/policy/:handle` | Content worth indexing and sharing. |
| Server, status `404` | `**` | Unknown URLs used to answer `200`. |
| Server | `/product/:slug` | The catalogue's other half. Answers `404` (via `RESPONSE_INIT`) for a slug that no longer exists, so a removed product leaves the index instead of lingering as a soft 404. |
| Client | `/checkout` and its result routes, `/thank-you`, `/experience` | Session-bound or kiosk pages with nothing to index. |

A client-rendered route is served as `index.csr.html`, the same shell nginx falls back to when the renderer is down (`docs/09-nginx-https.md`).

### Product URLs

A product lives at `/product/<slug>`. The route parameter also accepts the uuid every link shared or indexed before slugs existed used, and the page swaps it for the slug with `replaceUrl` once it knows the product, so one URL ends up in search results without any old link dying.

Build product links with `ProductsService.productKey()` (route segment) or `productPath()` (canonical, JSON-LD) — never from `product.id` directly, or the link costs a redirect and splits the page's ranking. `GET /api/products/:idOrSlug` resolves both forms.

The page fetches its own product through `ProductsService.fetchOne()` rather than waiting for the catalogue: a server render would otherwise pull roughly a megabyte to find one row on every request. The browser still loads the catalogue afterwards, which is what fills in related products and nav search.

### Rules for code that runs on the server

- **No browser globals at construction time.** `window`, `document`, `location`, `localStorage`, `matchMedia`, `requestAnimationFrame` and `new Image()` do not exist on the server. Inject `DOCUMENT`, and guard browser-only work with `isPlatformBrowser(inject(PLATFORM_ID))` or `afterNextRender`.
- **No timers during a render.** Zone.js waits for pending `setTimeout`/`setInterval` before sending the page, so an interval started on the server (the contact page's open/closed clock, the experience kiosk reset) hangs the request forever. Start them in the browser only. `ssr-smoke.mjs` fails any route slower than 5 s to catch this.
- **API URLs come from the tokens, never from `window.location`.** `API_BASE` and `PUBLIC_API_BASE` resolve to the same value on both sides for the same page: `/api` in production, `http://<host>:3000/api` on a development host. That equality matters twice: image `src`s rendered into the HTML must match what the browser renders, and the transfer cache (below) keys responses by the literal request URL.
- **The cart is browser-only.** `CartService` never loads on the server; it belongs to the visitor's session.

### How server renders reach the API

`app.config.server.ts` replaces the `HttpBackend` on the server. `@angular/platform-server` first makes `/api/x` absolute against the page (`https://elitecollections.qa/api/x`); the backend then sends any request for the page's own host under `/api/` to `API_ORIGIN` (`http://127.0.0.1:3000` in production), so renders never leave the machine. It also drops `Set-Cookie` and `Cache-Control` from those responses: the API sets its CSRF cookie on every response and marks some reads `no-store`, and Angular's transfer cache refuses anything carrying either, which left it empty.

### Transfer cache

`provideClientHydration(withEventReplay(), withHttpTransferCacheOptions(...))` in `app.config.ts` embeds each server-side GET response in the page, so the browser does not fetch the same data again and does not repaint the rendered page with loading states. Cart requests (sent with credentials) and admin preview drafts are excluded.

A request made in the browser during startup has to use the exact URL the server used. That is why `HomeContentService.refresh(true)`, which appends a `?t=` cache-buster, only busts once the app is stable; until then it shares the plain load.

### Language

`LocaleService` stores the choice in `localStorage` and in an `elite_locale` cookie (path `/`, one year, `SameSite=Lax`). The server reads the cookie and renders Arabic with `lang="ar" dir="rtl"` from the first byte, so there is no English flash and no hydration mismatch. Because the HTML varies by cookie, pages must never be cached by nginx or a CDN.

### Environment (`deploy/pm2/elite-web.config.cjs`)

| Variable | Production | Purpose |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `4000` | Loopback only; nginx is the public edge. |
| `API_ORIGIN` | `http://127.0.0.1:3000` | Where server renders send API requests. |
| `SITE_URL` | `https://elitecollections.qa` | Origin written into canonical, `og:url` and JSON-LD. |

Allowed `Host` values are compiled in from `security.allowedHosts` in `angular.json` (`elitecollections.qa`, `localhost`, `127.0.0.1`). Any other Host gets a `400` and is never rendered, which is Angular's protection against Host-header SSRF. A new public domain must be added there.

### Verifying

```bash
cd client
npm run build:web
node scripts/ssr-smoke.mjs                                                     # API down: renders degrade, never hang
node scripts/ssr-smoke.mjs --api https://elitecollections.qa --timeout 20000   # real data (read-only GETs)
```

The API-down pass also fails if a data page still ships API data, which would mean renders are reaching an API other than `API_ORIGIN`. The API-up pass fails if a data page ships an empty transfer cache.

**Run it on the production Node major (22).** The script refuses to run on any other. Node 25+ defines browser globals such as `sessionStorage`, so an unguarded call passes on a newer local Node and still crashes the production render: that is exactly how `/?order_id=…` (Sadad's cancel return) shipped as a `404` on 12 September 2026. On macOS with Homebrew: `$(brew --prefix node@22)/bin/node scripts/ssr-smoke.mjs`.

**Only pages that display products fetch them on the server.** `ProductsService` loads the catalogue eagerly in the browser but, on the server, only when a page calls `ensureLoaded()` — which now means `/collection` alone, the one page that actually renders a product grid. Anything injected on every page (nav, footer, cart drawer) must not trigger a full-catalogue request during a render.

Home used to call it too, for two fields on the hero's linked product, and paid for the whole catalogue to get them: the transfer cache embeds whatever the render fetched, so the rendered HTML measured **853 kB, of which 731 kB was one `/api/products` response**. It now reads `content.heroProducts` instead, a projection the content route already had to build for `mediaVariants` (`docs/05-api-server.md`). Measured on the same data: **853 kB → 148 kB** of HTML, **130 kB → 29 kB** gzipped, and the render itself **94 ms → 29 ms**, against a 20 ms floor for `/story`, a page with no catalogue at all.

The rule this leaves behind: **a page that does not render products should never load the catalogue to read a field off one of them.** If the hero needs something new about its product, widen the projection in `storefront-content.route.js`, do not reach for `ensureLoaded()`.

The order inside `heroProduct()` in `home.component.ts` is load-bearing. It reads `content.heroProducts` first and `ProductsService` only as a fallback, because the content response is in the transfer state at hydration while the catalogue is still in flight. Reversing the two would leave the first client-side change detection with nothing, and the `+N` chip and hero product link would visibly reset before coming back.

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

**Responsive sources.** `heroSrcset()` reads `mediaVariants` from the content payload; it does not derive candidates from the filename. The server joins `media_assets` on every image in the content tree — not just the hero's — and reports the sizes it actually generated, keyed by upload filename. The name is historical: the discount hero (`.discount-image`) and the collection tiles use the same helper, with their own `sizes` strings on the component. This matters because `createImageVariants` skips any size wider than roughly the source, so a hero uploaded at 1200px has no `-zoom` sibling — and the old string-concatenation version still advertised `-zoom` at `1800w`, which a retina browser would then choose. An upload the map does not cover gets no `srcset` and a plain `src`: heavier, but never a request for a file that was never written.

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

### Colour Names on the Product Page

`ref_colors` has carried `name_ar` since migration 003 and `GET /api/ref/colors` has always returned it — `ReferenceDataService` simply discarded it, keeping only hex and swatch image. The Arabic storefront therefore showed English colour names.

- **`colorLabel(name)`** on `product.component.ts` resolves the display name: Arabic locale looks up `colorNameArByName` (keyed by the lowercased English name via `colorKey`), everything else returns the stored name. It falls back to the stored name when a colour has no `name_ar` yet, or no `ref_colors` row at all — some catalogue "colours" are supplier codes like `390`, and an English label beats a blank one.
- **The English name stays the join key.** Products, variants, `imageColors`, and the `?color=` deep link all match on it. Arabic is a render-time lookup and is never persisted on a product, so renaming a colour in Reference Data updates every surface at once.
- **The name sits beside the label, not across the row.** `.section-label` defaults to `justify-content: space-between`, which is right for the size row (its trailing Size Guide button belongs at the far end) but pushed the colour name to the opposite edge of the panel. The colour row carries `.section-label--pair` instead: `flex-start` with a 10px gap, so "Select Colour" and "Black" read as one phrase in both directions.
- **Used for the section label, swatch `title`, `aria-label`, `alt`, and the screen-reader name** — a swatch is a coloured dot with no text, so those attributes are the only name a screen reader gets.
- **The first colour is selected on load** (unless `?color=` already picked one). Without a selection the section rendered "Select Colour" over unlabelled dots with no name beside it. This also means `availableSizes` is colour-scoped from the start and the cart records a colour rather than `null`.

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

Two more tokens were below the same floor on white and have been darkened by a
uniform brightness scale, so hue and saturation are unchanged:

| Token | Was | Now | Contrast on white |
|---|---|---|---|
| `--claude-text-gold` (`home.component.scss`) | `#9f783c` | `#947038` | 4.02 -> 4.53 |
| `--muted` (`styles.scss`) | `#8a7a62` | `#83745d` | 4.17 -> 4.54 |

`--muted` is the site-wide secondary text colour, so this is the floor for every
surface that uses it, not just the home stats grid where the audit caught it.

### Hero Assets

**The hero no longer ships its own art.** It renders whatever the home content
points at (`contentData().hero.imageUrl` and `heroSlider.items[]`), uploaded
through the admin Media library and sized by the variant pipeline.

`src/assets/hero-scroll/` is left over from the version that did bundle its art:
roughly 13 MB, and as of this change nothing in `src/` references it. It used to
have exactly one reference, a `<link rel="preload">` in `index.html` naming
`elite-hero-sandals-cutout.webp` at `fetchpriority="high"` — 227 kB fetched
before anything else and then never painted, because the element it was meant
for had long since become CMS-driven. That line is gone. A correct preload here
would have to name a URL that only the API knows, so `home.component.ts`
issues it at runtime instead (`preloadHeroAssets`).

The folder itself is still on disk. It costs build and deploy time rather than
visitor bandwidth, so it can be deleted once a release has proven nothing 404s.

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
| `OverlayComponent` | `<cw-overlay>` | The storefront's one dialog. Owns the modal contract; callers project content |
| `SizeSheetComponent` | `<cw-size-sheet>` | "Select Size" sheet, used by the product page and the collection card |
| `RestockFormComponent` | `<cw-restock-form>` | Back-in-stock alert form (size, email) over a collection card |

### The overlay contract (September 2026)

Every dialog on the storefront used to be hand-rolled, and each implemented a different
subset of the modal contract: the product page's size sheet declared `aria-modal="true"`
without trapping focus, the size guide never locked scroll, and only the review modal
returned focus to the element that opened it. `cw-overlay` now owns all of it in one place:
`role="dialog"`, `aria-modal`, `aria-labelledby`, Escape, backdrop click, body scroll lock,
initial focus into the panel, a Tab/Shift+Tab trap, and focus restored to the trigger.

Three variants:

| Variant | Above 760px | Below 760px |
|---|---|---|
| `sheet` | centred panel | bottom sheet |
| `dialog` | centred panel, max 430px | bottom sheet |
| `card` | covers the element it is anchored to | bottom sheet |

The `card` variant is how the collection card shows its back-in-stock form "inside" the card.
The anchor must be `position: relative` and must not clip overflow or carry a transform: a
transformed ancestor becomes the containing block for fixed children, so the panel would be
clipped at the card's edge and would slide with the card's hover lift. That is why
`.product-tile` (which does both) is wrapped in a `.product-cell` and the overlay is a
sibling of the tile rather than a child.

**Scroll lock** lives in `shared/overlay/body-scroll-lock.ts` and is **reference counted**,
because the product page can have the size guide open on top of the size sheet and a boolean
per component would unlock the page underneath the one still open. It also holds the layout
width with `padding-inline-end` while the scrollbar is hidden; without that, hiding the
scrollbar reflowed the whole product grid sideways by the scrollbar's width every time a
dialog opened. `MOBILE_SHEET_QUERY` (759px) is exported from the same file so the two pages
cannot drift apart. The collection page's mobile *pagination* keeps its own 767px query on
purpose; it is a separate feature.

**A `<select>` inside an overlay must set `selected` on its options**, not `[value]` on the
select. The select is created before its options exist, so the value binding is discarded and
the browser falls back to the first enabled option. Both restock forms hit this, and so did the
collection card's size select, which is why its "Choose size" placeholder is always rendered
and bound with `[selected]` rather than inserted only when the size is cleared.

**Desktop scroll lock hides only the body's overflow.** With `html, body { height: 100% }`
and `body { overflow-x: hidden }` in `styles.scss`, hiding the root's overflow as well turns
the body into its own scroller and the viewport snaps to the top: the collection page jumped to
its start with the card overlay left off-screen. The root is hidden only on the mobile path,
where the body is pinned with `position: fixed`.

**Stacking.** `.ovl` is `z-index: 85`: above the fixed nav (80) so the backdrop dims it and a
click there closes the overlay, below the mobile menu (90) and the cart drawer (100). A `card`
overlay scrolls its panel into view on open with `scroll-margin-top: 120px` so the nav never
covers its heading. The product page's size guide is not a `cw-overlay` yet; it takes the same
`BodyScrollLock` and closes on Escape.

### Colour and size selection (September 2026)

One rule on both the collection card and the product page, in `carriedSize()`
(`shared/stock-availability.ts`):

- A picked size follows the customer to another colour **only while it is in stock there**.
- A sold-out size (picked to ask for a restock alert) stays on the colour it was picked on.

On the collection card, hovering or focusing a swatch only **previews** (`previewColors`);
clicking **selects** (`selectedColors`). Leaving the swatch row drops the preview. Leaving the
card no longer resets anything, so opening "Notify me" (which covers the card) keeps the colour.
With a colour filter on, each card opens on the matching colour. The card's product link
carries `?color=` and, when in stock, `?size=`; the product page applies `?size` only if it is
in stock. A colour whose every size is sold out is drawn faded and struck through on both pages.

**Tests.** `npm run test:stock-availability` (logic) and `npm run test:storefront`
(Playwright, `e2e-storefront/`, desktop 1400 and phone 390 against a fixture product).

---

## Contact Page

Structured around what a visitor to a physical retailer actually wants: where the shops are, whether they are open, and how to call. Order is branches, stockists, direct contact, then the form.

- **Branches** come from `contact.branches` in the storefront CMS. Hours are stored as whole hours on a 24h clock, not a display string, which is what lets the page compute the `Open now` badge (in Doha time, fixed UTC+3) and emit the same values as `openingHoursSpecification`.
- **Stockists** (`contact.stockists`) are shops that carry Elite but are not Elite's premises, such as the counter inside Printemps. They get a lighter treatment, no map of their own, and are **deliberately excluded from the `Store` structured data** — describing them as Elite locations, or reusing the host's map link in `sameAs`, would tell search engines the two businesses are one.
- **`LocalBusiness` / `Store` JSON-LD** is built from the same CMS data, so the page and the structured data cannot drift. `priceRange` is the one field that is not CMS-driven: it is the symbol `$$$`, because the catalogue is not loaded on this page (loading it cost every content page roughly 800 kB) and a hard-coded number range would go stale.

> **Bidirectional text:** Latin runs and digits inside Arabic copy need the `.num` utility (`direction: ltr; unicode-bidi: isolate`). Without it a phone number renders as `4475 8172 974+` and trailing full stops jump to the head of the line. This bug is not unique to this page; apply `.num` anywhere a number sits in RTL copy.

## Services

### `SeoService`

- **File:** `services/seo.service.ts`
- **Provider:** Root-level (`providedIn: 'root'`)
- **Purpose:** Owns everything in `<head>` that varies per route: title, description, canonical, Open Graph, Twitter Card, `robots`, and JSON-LD.
- **Usage:** call `seo.watch(factory)` from a **field initializer** so the effect is owned by the component's injector and is destroyed on navigation. Returning `null` from the factory means "data not ready", which leaves the previous tags in place instead of flashing an empty title.

```typescript
private readonly seoTags = this.seo.watch(() => ({
  title: this.i18n.t('seo.home.title'),
  description: this.i18n.t('seo.home.description'),
  canonicalPath: '/',
  jsonLd: [ /* ... */ ],
}));
```

- **`noIndex: true`** emits `<meta name="robots" content="noindex, follow">` and, just as importantly, the tag is **removed** on the next page that does not set it. Navigation is client-side, so a tag left behind would silently de-index the next real page the visitor lands on. Only `NotFoundComponent` sets it today.
- **`FALLBACK_IMAGE`** is `/assets/brand/og-default.jpg`, a 1200x630 card — not the logo. `og:image` feeds a `summary_large_image` preview, where a tall transparent wordmark is letterboxed or cropped to nonsense. Regenerate the card from `docs/seo/og-image-source.html`.

> **Server-rendered vs client-rendered routes:** on server-rendered routes (see *Server-Side Rendering*) everything this service writes is already in the HTML the server sends, so social crawlers that never run JavaScript (WhatsApp, Facebook, X, LinkedIn, iMessage) get the per-page tags. On client-rendered routes, and in nginx's fallback shell when the renderer is down, they still read only the static `index.html`. That file therefore keeps a duplicated set of site-level `og:`/`twitter:` tags; `Meta.updateTag` overwrites them in place, so server-rendered pages never carry duplicates. It deliberately carries **no** `canonical` and **no** `og:url`, because a hardcoded per-URL value would tell every non-JS crawler that all pages are duplicates of the homepage. `SITE_ORIGIN` (from `SITE_URL` on the server) is the origin written into canonical, `og:url` and JSON-LD.


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

**No size is chosen for the customer (September 2026):** `defaultSize()` used to preselect the
first in-stock size on product load, on every colour change and on every collection card, so a
shopper who never touched the size control still bought whatever size happened to be in stock first.
Nothing is preselected now, and `add()` / `buyNow()` refuse to proceed without one: below 760px the
size sheet opens carrying `product.size.required` in its head, and above it the page scrolls the
size picker into view, shows the same message inline and focuses the first available size. The
collection card does the same through `requireCardSize()`, with the message inline in the card's
purchase panel, since the storefront has no toast of any kind.

Three things had to be fixed first, because they all assumed a size was always set:

- **`availableStock(product, colour, null)` is 0 for anything sized.** A null size means "a variant
  with no size of its own", not "any size" (`matchingVariants` in `shared/stock-availability.ts`).
  Left alone it would have hidden Add to Cart on the whole grid, frozen the quantity stepper and
  rendered the restock panel on every sized product. `colorStock(product, colour)` now answers
  "stock across every size of this colour" — deliberately a max, not a sum, because a cart line is
  one variant — and `colorState()` is a wrapper over it, so there is one definition. `maxQty` uses
  it while no size is chosen.
- **`availableSizes()` bailed out on an empty `product.sizes`**, but `sizeOptions()` also derives
  sizes from the variants. A product whose sizes live only on its variants therefore rendered no
  size UI at all, and — once the default size was gone — would have gone into the cart with size
  `0`. Both it and the template gate now follow `hasSizeOptions()`.
- **`cartItem()` could invent a size.** It fell back to `selectedSize() ?? p.sizes?.[0] ?? 0`, which
  is a plausible-looking wrong size on a real order. The size is now a required argument, and `0`
  survives only for genuinely sizeless products. No variant in the catalogue uses size `0`, so it
  stays unambiguous in `CartService.itemKey` (`id|variantId|size|colour`) and in the delete query.

Two smaller ones: hovering a colour swatch on a card used to write a size into the selection (it
fired on `mouseenter` and `focus`, and could store the literal `0`), and a dismissed size sheet now
keeps its message, because closing it without picking does not answer the question.

**The stock line says something useful or nothing (September 2026):** the quantity row used to be
followed by "Max 10", a stray `<small>` outside both the quantity row and the CTA stack, so it
floated between the stepper and the buy button. Nobody wants ten pairs, and the `+` already stops at
the ceiling. `lowStockLeft` now returns a count only when it is at or below `LOW_STOCK_AT` (5, a
front-end constant: the admin's own low-stock threshold is a restocking signal and `/api/config`
does not publish it), and the line renders as "Only n left" via the existing `cart.stock.onlyLeft`
key. It also stays silent until a size is chosen, since before that `maxQty` is the colour's best
size. `stock.maxQty` is gone from both locales.

Two presentation fixes on the desktop size chips, both from the same work:

- A sold-out chip shows its number only. `(Sold out)` inside a 46px square stretched each one into
  a three-line block and turned the row into a wall of text; the muted `.out-of-stock` styling
  carries the meaning instead, and the words stay in an `.sr-only` span for screen readers.
- Hovering the selected chip used to blank out its number. `.size-btn:not(:disabled):hover` sets
  `color` and sits one specificity step above `.size-btn.active`, so it repainted the text green on
  the green background `.active` had just given it. The hover lift now applies to every enabled
  chip and the colour change only to chips that are not selected.

**Back-in-stock alerts from the collection card (September 2026):** the card's `NOTIFY ME`
button used to navigate to `/product/:id?color=…&notify=1` so the customer could type one
email address on the product page, losing the size they had just picked on the way. It now
opens `cw-restock-form` over the card itself. Submission goes through
`shared/restock/restock.service.ts`, shared with the product page, which returns
`ok | in-stock | error` and leaves recovery to the caller: the product page puts itself back
into a buyable state, the collection page reloads the catalogue so the card flips to ADD TO
CART. The product page's inline restock panel and the `?notify=1` deep link are unchanged, so
existing links keep working.

The card CTA has three states rather than two, because a sold-out size can now be picked from
the sheet: buyable → ADD TO CART, selected size sold out but others in stock → "Choose size"
plus a note, whole colour sold out → the alert. `canPurchase()` still gates the cart, so a
sold-out selection cannot reach it.

**Per-colour images — no positional inference (September 2026):** `productImageForColor()` in both
`collection.component.ts` and `product.component.ts` returns an image only when the admin linked one
to that colour (`colorImages`, matched by normalized name or slug; the PDP additionally accepts a
filename hint via `urlContainsColor()`). Otherwise it returns `null` and the caller falls back to
`product.image`, the admin's primary. Both used to fall back to `images[colorIndex]`, pairing an
alphabetically-sorted colour array against a gallery array sorted by `sort_order` — two unrelated
orders, so a card could show an image that was never assigned to the colour it displayed.

**`resolveMediaUrl()` — Bug fix (June 2026):** The previous implementation stripped `/api/` from the base URL (`apiBase.replace(/\/api\/?$/, '')`), leaving an empty prefix in production. Now uses `${this.apiBase}${value}` directly so `/uploads/abc.jpg` becomes `/api/uploads/abc.jpg`, which routes through the Nginx proxy to Express.

**Fallback images:** `FALLBACK_IMAGE` constant (used by `onImgError` in collection and product pages) was changed from a hardcoded Unsplash URL to `/assets/brand/elite-logo-green.png`.

### `CartService`

- **File:** `services/cart.service.ts`
- **State:** Angular Signals (`signal()`, `computed()`)
- **Persistence:** server-side session cart (`/api/carts/current`), refreshed on app start and on entering `/checkout`
- **API:**
  - `items` — Readonly signal of cart items
  - `isOpen` — Readonly signal for drawer visibility
  - `count` — Computed total quantity
  - `subtotal` — Computed total price
  - `stockIssues` — Computed lines whose `qty` exceeds `available` (sold out, or partly)
  - `rejectedAdd` — The `StockShortage` from the last add the server refused (409 `INSUFFICIENT_STOCK`), shown as a notice in the drawer
  - `add(item)` — Add or increment item
  - `remove(id, size, variantId?, color?)` — Remove a line
  - `setQty(item, qty)` — Lower a line to what is left (delete + re-add, since the API has no quantity update)
  - `clear()` — Empty cart
  - `openDrawer()` / `closeDrawer()` — Toggle cart panel
- **`stockShortages(err)`** — exported helper that pulls the per-line details out of a 409 `INSUFFICIENT_STOCK` response.

#### Out-of-stock handling (2026-09-14)

Stock used to be checked only by `POST /api/carts/checkout`, so a bag line that sold out after it was added (POS sale, another web order, admin edit, variant deactivated), or the same size added twice past stock, was only discovered at "Proceed to Payment", with the generic "We could not place the order" message.

- The drawer and the checkout order summary flag each short line ("Sold out" / "Only N left") with a **Remove** or **Change to N** action.
- Checkout re-reads the bag on entry and again before the payment step, and blocks Continue with a message naming the item and size (`checkout.stock.*`).
- A 409 from checkout refreshes the bag so the flags appear. Network failures (`checkout.error.network`) and 422s (`checkout.error.validation`) get their own messages; anything else keeps `checkout.error.submit`.

### `LocaleService`

- **File:** `services/locale.service.ts`
- **State:** Signal with `'en' | 'ar'` locale
- **Persistence:** `localStorage` key `elite-web:locale`, mirrored to the `elite_locale` cookie (path `/`, one year, `SameSite=Lax`, `Secure` on HTTPS) so the server renders the same language. In the browser `localStorage` wins, then the cookie; on the server only the cookie exists.
- **Side effects:** Sets `lang` and `dir` attributes on `<html>`, toggles `.rtl` class on `<body>`, through the injected `DOCUMENT` so it works during server rendering too
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

`AR` is typed `Record<keyof typeof EN, string>` on purpose: a key that exists in
Arabic but not English is a compile error, so the two dictionaries cannot drift
apart silently.

### Counted Nouns

English needs two forms. Arabic needs four and picks between them by the number:
one, two, a few (3 to 10), and everything else, where the 11-and-above case
takes the singular noun. Writing `{{ n }} pieces` in a template renders
"3 قطعة" on the Arabic storefront, which reads the way "3 piece" does in
English.

`pieceCount()` on the collection component is the pattern to copy: it selects
`collection.pieces.{one,two,few,other}` from the number and passes `{ count }`
as a parameter, falling back to `other` for any locale that does not define a
form. English defines all four so the type constraint above holds; its `few` and
`other` are the same string.

### Strings Live In `strings.ts`, Not In The Template

A literal typed straight into a template or a component constant renders in
English on both storefronts. This is not visible while developing in English and
there is no error for it — the page just stays half-translated. The collection
page had accumulated the whole filter sidebar this way: the group headings were
English constants in `collection.component.ts` while the sort control beside
them translated correctly.

The same applies to `aria-label`. Bind it (`[attr.aria-label]="t('...')"`)
rather than hardcoding, so an Arabic visitor on a screen reader does not hit
English landmarks.

**Not everything English on the page is a missing string.** Collection titles,
descriptions and category names come from the database as the admin authored
them. Those need an Arabic value entered in the admin; no key will fix them.

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

The storefront has no Angular animations. There is no `animations: []` metadata
and no `@angular/animations` import anywhere in the app, and `app.config.ts`
deliberately does not call `provideAnimations()` — the provider was booting the
animation engine, and adding it to the initial bundle, for nothing. Add it back
alongside the first component that actually declares a trigger, not before.

---

## Mobile Touch and Performance Contract

Everything below exists because of one report: the shop felt heavy on a phone
and the screen kept zooming when you touched things. These are the parts that
have to stay true together, so they are written down as one contract rather
than rediscovered per page.

### Zoom

Two separate iOS behaviours zoom the page, and each needs its own guard. Both
live in `styles.scss`, under `pointer: coarse`, and neither is a viewport-meta
scale cap — `maximum-scale` is what the codebase used to use, and it took real
pinch zoom away from every visitor to fix an accidental one. Do not bring it
back (there is a note in `index.html` saying so).

| Zoom | Trigger | Guard |
|---|---|---|
| Focus zoom | A focused text control rendering below 16px | The 16px control floor. Any new focusable text control on the storefront joins that list. |
| Double-tap zoom | Two taps anywhere, which on a shop is almost always an impatient second press on a size pill or "add to cart" | `touch-action: manipulation` on `html`. |

`manipulation` disables double-tap zoom and the click delay that comes with
waiting for the second tap, and leaves pinch zoom and scrolling alone. A
component that needs the browser's own gesture handling back (a pinch-zoom
viewer, a map) overrides `touch-action` locally.

### Cost per frame

A phone repaints while it scrolls, so anything permanently on screen is a cost
paid on every frame rather than once:

- **The grain overlay** (`body::before`) is a fixed, full-viewport layer above
  every other element. It is hidden under `pointer: coarse`. It renders at 1.2%
  effective opacity, which is not visible on a phone; desktop keeps it.
- **The PDP sticky add-to-cart bar** is fixed over the page for the whole
  scroll. Its backdrop blur is dropped on mobile and the background made
  opaque: at 97% opacity there was nothing underneath for the blur to show.
- **The PDP gallery** stacks every image in the frame at once so the swipe can
  cross-fade. Inactive images carry `visibility: hidden` and no colour
  `filter`, which are the two properties that would promote each one to its own
  composited layer. A 16-photo product was otherwise holding 16 full-size
  layers live in the viewport.

### Change detection

Components on this app are `OnPush` unless there is a reason. The v17 to v22
migration wrote `ChangeDetectionStrategy.Eager` onto every existing component to
preserve the old framework default; that is a migration artifact, not a
decision. `Eager` plus zone.js means the whole template is re-evaluated on every
touch, scroll and timer on the page — on the product page that was roughly a
hundred translation lookups, the price formatter and every per-image srcset
builder, per event, which is what the delay between pressing a size and seeing
it select was made of.

**The whole storefront is now on `OnPush`.** There is no `Eager` left in
`client-web`. It was safe because every value these templates read comes from a
signal, including the ones read inside the methods the templates call. The
non-signal fields that remain are private plumbing that never reaches a
template: timers, RxJS subscriptions, `MediaQueryList` handles,
`IntersectionObserver`s, idempotency keys.

Anything added later that a template must react to has to be a signal. That is
now a requirement rather than a preference, and it fails quietly: the build
still passes and no error is thrown, the view simply stops updating and shows a
stale value.

**Order matters if this is ever redone.** `app.component` is the shell holding
the nav, the footer, the cart drawer and the router outlet, and an `OnPush` view
that is not dirty is not descended into. Flipping the root while its children
were still eager would stop them updating. Leaves first, root last.

Verified after the switch, in a browser rather than by building: hero arrows and
the burst/interleaved-tap cases (the hero suite, 29 passing), collection filters
re-rendering the grid, add-to-cart updating the nav badge and drawer, the
checkout stepper advancing, `hideFooter()` removing the footer on a client-side
route into `/checkout` and restoring it on browser-back, `isExperience()` hiding
the shell, and the locale toggle re-rendering nav, footer and `dir` across
component boundaries.

### Image weight

The storefront never sizes images itself; it hands the browser a `srcset` of
the stored variants and lets it choose. That only works if the variants exist.
When an asset's `imageVariants` is empty, `imageSrcset()` returns null, the
`src` fallback is the **full-size original**, and a phone downloads it — which
in practice meant multi-megabyte PNGs on the product gallery. See
`07-dev-guide.md`, "Backfill missing image variants", for how to detect and
repair that.

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
  id: string;
  variantId?: string;
  sku?: string;
  name: string;
  price: number;
  image: string;
  leather: string;
  color?: string | null;
  size: number;
  qty: number;
  available?: number | null; // units still in stock; null when the line has no variant
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
6. **Wire the head tags.** Inject `SeoService` and declare a `seoTags` field
   initializer with `seo.watch(...)`, plus `seo.<page>.title` / `.description`
   keys in both languages (see Search Engine Discovery above). A page without
   this inherits whatever the previously visited page left in `<head>`.
7. **Add the path to `STATIC_ROUTES`** in `server/routes/sitemap.route.js` if
   the page should be indexed. The sitemap does not read `app.routes.ts`.

---

## Related Documents

- [02 – Architecture](./02-architecture.md) — Monorepo and build setup
- [04 – Admin Portal](./04-admin-portal.md) — The other Angular app
- [06 – White-Label Guide](./06-white-label-guide.md) — How to rebrand
