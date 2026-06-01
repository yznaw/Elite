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

## Home Page Landing Hero

The home page hero is a luxury bilingual brand landing moment for élite. It uses a dominant sandal cutout on a warm cream canvas, annotated craft callouts, detail thumbnails, and a dedicated stacked mobile layout.

### Files

| File | Purpose |
|---|---|
| `projects/client-web/src/app/pages/home/home.component.ts` | Hero callout/detail data and ordinary home-page navigation |
| `projects/client-web/src/app/pages/home/home.component.html` | Brand mark, main product cutout, feature callouts, detail imagery, mobile feature cards, CTA |
| `projects/client-web/src/app/pages/home/home.component.scss` | Cream landing canvas, Claude-style local design tokens, desktop connectors, staggered load motion, mobile stack |
| `projects/client-web/src/assets/hero-scroll/` | Source product photos plus the transparent hero cutout |

### Runtime Behavior

- The main product uses `elite-angle-pair-cutout.png` so the sandal sits directly on the cream canvas.
- Four desktop callout pills annotate strap, buckle, stitching edge, and sole with thin gold connector lines and dot endpoints.
- Each pill includes a matching thumbnail crop and highlights its line/dot on hover.
- Three detail cards show the embossed footbed, leather grain, and side profile in a lookbook rail.
- Mobile hides floating callouts and uses a stacked layout: brand, product, feature cards, detail cards, CTA.

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
- Check mobile to ensure the order remains brand, product, feature cards, detail cards, CTA.

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
- **Methods:**
  - `getAll(): Product[]` — Returns all products
  - `getById(id: number): Product | undefined` — Find by ID
  - `getFeatured(): Product[]` — Returns first 3 products

> **Note:** Currently uses hardcoded mock data. To connect to an API, replace the `ALL_PRODUCTS` array with `HttpClient.get()` calls.

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
  id: number;
  name: string;
  price: number;
  tag: string;       // 'Signature' | 'New' | 'Bestseller' | 'Limited' | ''
  leather: string;   // e.g. 'Camel Nappa', 'Goat Suede'
  style: string;     // 'Oxford' | 'Derby' | 'Loafer' | 'Boot'
  sizes: number[];   // EU sizes
  image: string;     // URL
}
```

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
