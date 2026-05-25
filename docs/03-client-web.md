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

## Home Page 3D Hero

The home page hero uses a first-party Three.js model viewer instead of an embedded Sketchfab iframe.

### Files

| File | Purpose |
|---|---|
| `projects/client-web/src/app/pages/home/home.component.ts` | Three.js scene setup, model-slot carousel, GLB loading, color switching, animation, cleanup |
| `projects/client-web/src/app/pages/home/home.component.html` | Centered hero canvas, dynamic model heading, loading/error states, side model arrows, labeled model tabs, circular color radio controls |
| `projects/client-web/src/app/pages/home/home.component.scss` | Full-screen white product-view layout, title area, side arrow controls, labeled model tabs, circular color controls, scroll transition, responsive framing |
| `projects/client-web/src/assets/models/latest-brown-v2.glb` | Original local GLB product model |
| `projects/client-web/src/assets/models/or{4,8,9}.glb` | Additional local GLB product models |
| `projects/client-web/src/assets/draco/` | Local Draco decoder files required by the compressed GLB |

### Dependencies

The viewer depends on:

- `three`
- `@types/three`

The GLB uses `KHR_draco_mesh_compression`, so `DRACOLoader` is configured with local decoder assets:

```typescript
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/assets/draco/');
dracoLoader.setDecoderConfig({ type: 'wasm' });
loader.setDRACOLoader(dracoLoader);
```

### Runtime Behavior

- The canvas is initialized in `ngAfterViewInit()` and runs outside Angular via `NgZone.runOutsideAngular()`.
- `GLTFLoader` loads the URL for the active `heroModels` slot.
- The camera stays fixed in the center of the product stage. `OrbitControls` keeps damping/camera state stable, while pointer drag rotates the loaded model around a centered Three.js pivot group for manual 360-degree rotation. A quick horizontal swipe switches to the previous or next model.
- A `ResizeObserver` keeps the renderer and camera aspect ratio aligned with the hero visual container.
- The hero is a pinned scroll scene: the section is taller than one viewport, the model stage stays sticky, and scroll progress updates CSS variables so the model zooms/shifts before the page continues into the next section.
- As the model shifts right during pinned scroll, a large left-side editorial title fades/slides in using the same scroll progress variables.
- `ngOnDestroy()` cancels the animation frame, disconnects observers, disposes controls, disposes Draco, and disposes Three.js geometries/materials.

### Model Slots

The hero exposes four 3D model slots through `heroModels`.

| ID | Title | Current URL |
|---|---|---|
| `original` | Original | `/assets/models/latest-brown-v2.glb` |
| `or9` | Or9 | `/assets/models/or9.glb` |
| `or4` | Or4 | `/assets/models/or4.glb` |
| `or8` | Or8 | `/assets/models/or8.glb` |

Each slot controls the eyebrow, title, subtitle, and GLB URL shown in the hero. To replace a placeholder later, update only that slot's `url` value and keep the file under `projects/client-web/src/assets/models/`.

The `or4`, `or8`, and `or9` assets are optimized GLBs using `KHR_draco_mesh_compression` for geometry and embedded WebP textures capped at 2048px so they remain small enough for GitHub.

Model switching is exposed through left/right arrow buttons on either side of the 3D product stage, labeled model tabs below the stage, and horizontal swipe. The arrows and swipe call `selectAdjacentHeroModel(-1 | 1)`, which cycles through `heroModels`, updates the heading, and reloads the selected GLB slot.

### Color Options

The hero exposes three circular radio-style leather color controls under the model:

| ID | Label | Hex |
|---|---|---|
| `cognac` | Cognac | `#5f3423` |
| `espresso` | Espresso | `#4e2c22` |
| `sand` | Sand | `#8f6337` |

Color switching is handled in the component without reloading the model. The swatch colors are sampled from the product reference photo. During model preparation, leather `MeshStandardMaterial` instances are stored in `leatherMaterials`; this includes the original model's `Material` surface and the optimized models' `Outer_leather` materials. Non-switching details use fixed reference colors: tan footbeds, dark stitches, and darker buckle/trim.

For a more photographic read, the viewer uses a PMREM `RoomEnvironment` for studio reflections and material-specific roughness/env-map settings: leather keeps a soft highlight, footbeds stay matte, stitching is dry and dark, and buckle/trim has a slightly stronger reflection.

```typescript
selectLeatherColor(id: string): void {
  this.selectedLeatherColor.set(id);
  this.applyLeatherColor(id);
}
```

### Framing and Responsive Notes

The model is intentionally centered and scaled large for the desktop hero. Compact viewports use a smaller scale so the model remains visible without clipping.

When adjusting the model:

- Use `frameModel()` for scale, centered pivot setup, vertical position, and default rotation.
- Use `bindModelDrag()` and the pointer handlers for manual 360-degree turntable rotation. The camera should remain fixed so the product does not orbit away from the center.
- Use `queueHeroScroll()`, `.hero` height, `.hero-shell` sticky positioning, `.hero-scroll-copy`, and the shared CSS variables when changing the pinned zoom/shift/text-reveal transition.
- Check both desktop and mobile screenshots after changing scale or rotation.
- Keep the white canvas background; it is part of the premium product-view treatment.

### Verification

Run:

```bash
cd client
npm run build:web
```

Manual QA:

- Open the storefront home page.
- Confirm the GLB loads and the loading state disappears.
- Click the left and right model arrows; each should update the heading and keep the 3D canvas active.
- Drag the model to rotate it manually.
- Click Cognac, Espresso, and Sand; each should change the leather color instantly.
- Scroll down from the hero; the model should finish its zoom/right-shift transition, the large left editorial text should appear while pinned, then the featured section should begin scrolling into view.
- Check desktop and mobile widths to ensure the product is large but not clipped.

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
