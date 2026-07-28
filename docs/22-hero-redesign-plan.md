# 22 — Hero Redesign Plan (mobile, tablet, desktop)

Storefront home hero. Unifies what a visitor can *do* across every screen size:
know how many products there are, move between them, and preview colourways.

Owner: Elite Collection
Created: 2026-07-27
Status: Phases 1–5 implemented; Phase 6 next; full production verification pending

---

## 1. Why

The hero currently ships two mutually exclusive content models:

| | ≤ 760px | > 760px |
|---|---|---|
| Pagination (counts products) | shown | **hidden** |
| Colour swatches | shown | **hidden** |
| Short description | shown | **hidden** |
| Four feature callouts | hidden | shown |
| Arrows | hidden | shown |

Consequences measured on the live build:

1. A desktop visitor has no indication the hero holds more than one product. The
   only cue is a pair of small low-contrast arrows sitting on the photo. With
   five products that hides 80% of the merchandising.
2. A desktop visitor cannot preview colourways at all.
3. iPad portrait is 768px, eight pixels above the mobile breakpoint, so it gets
   the desktop layout without desktop room. Callouts crowd both edges and a wide
   band of dead vertical space opens under the photo.

Decision: drop the callouts, and express the mobile content model on every size.

Phase 2 proved that simply making the missing controls visible is not enough.
The controls must also be grouped by what the visitor is trying to do:

- product information, its colourways and its shopping action belong together;
- product navigation belongs to the product image;
- neither group should be pinned to a viewport edge unrelated to its content.

---

## 2. Measurements this plan is built on

Captured on the running dev build, not estimated.

**Desktop 1440 × 900**

| Item | Value |
|---|---|
| Product box | 828 × 736 |
| Callout horizontal span | x 72 → 1358 (**1286px**) |
| Gap between product and CTA | **9px** |

The vertical axis is full: 736 of 900 goes to the photo. The callouts do not
constrain the photo vertically, they constrain it **horizontally**, occupying
1286px while the photo uses 828.

**Mobile 390 × 844**

| Item | Value |
|---|---|
| `--mobile-product-size` | `min(124vw, 620px)` → 484px |
| Stage height cap | `min(size / 1.4, 46svh)` → 345px used, 388px cap |
| Pagination bar | 240px wide, segments `flex: 1 1 0` |
| Segment tap target at 5 products | 41.6 × 44px |

Headroom exists: the width term (345px) is below the 46svh cap (388px), so the
photo can grow to roughly 139vw before the cap binds.

**Phase 2 visual review — 1919 × 836**

Source: `Screenshot 2026-07-28 at 12.06.08 AM.png`.

| Item | Observed result |
|---|---|
| Visible product silhouette | roughly one quarter of the viewport width |
| Colour control | pinned near the far-left viewport edge |
| Product pagination | pinned near the far-right viewport edge |
| Product arrows | separated from the visible product by large empty gaps |
| Description | detached above the media |
| CTA | isolated at the bottom edge |

The implementation preserves the product box height, but the customer's eye sees
the **visible product silhouette**, not the CSS box. The resulting composition has
five separate attention zones: copy, colours, product, pagination and CTA. The
visitor has to scan almost the entire viewport to understand one product.

Phase 2 therefore passes its functional goal but fails the desired hierarchy and
proximity. The wide-layout side rails are an intermediate implementation, not the
final desktop design.

---

## 3. Governing principle

> Mobile stacks vertically because it has height and no width.
> Desktop distributes horizontally because it has width and no height.
> Same information, transposed axis.

The second principle is **group by task, not by element type**:

- the copy group owns product name, subtitle, description, colour choice and CTA;
- the media group owns the product image, previous/next controls and product
  position indicator.

Do **not** port the mobile stack unchanged to desktop, but do not scatter controls
across the viewport merely because width exists. A wide two-zone composition uses
horizontal space while keeping every control close to the content it affects.

---

## 4. Ordering rationale

Phases are sequenced so each one lands on a stable base:

- Callouts are removed **first** because every later phase competes for the space
  they occupy. Rebuilding desktop before removing them means doing it twice.
- The first wide-layout controls are treated as a functional prototype. Visual
  review happens before breakpoint and sizing work so the rejected side-rail
  geometry does not become a dependency.
- Information architecture and control proximity are settled **before** product
  sizing. The media can then grow into a known, stable region.
- The breakpoint is centralised **before** it is moved, because the value is
  duplicated across SCSS and TS and a partial move produces layouts and image
  `sizes` that disagree.
- The crossfade is last because it is fully isolated and must not be entangled
  with layout debugging.

---

## 5. Phases

### Phase 0 — Baseline

Capture before touching anything, so regressions are detectable.

- Screenshot 390×844, 768×1024, 1024×768, 1440×900.
- Record element visibility and geometry at each width.
- Confirm nudge still measures one 1500ms pass (see §7 harness).

Exit: baseline recorded.

---

### Phase 1 — Remove the four callouts

Desktop-only element. `display: none` on mobile already, so mobile is untouched.

**Keep the callout data.** `activeHeroDescription()` falls back to joining callout
titles when no description is set. The CMS fields stay, no migration, no admin
change.

| File | Change |
|---|---|
| `home.component.html` | Remove the `@for` callout block and its `#heroCallout` refs |
| `home.component.scss` | Remove `.hero-callout*` rules including the four `--strap/--buckle/--sole/--stitching` positioning blocks and the connector-line rules |
| `home.component.ts` | Remove `heroCalloutElements`, `heroCalloutChanges`, `observeHeroGeometry()`, `updateHeroLines()`, `scheduleHeroLineUpdate()`, `heroGeometryObserver`, `heroGeometryFrame`, `heroCalloutTargets`, `mobileFeatureIcon()` |
| `home.component.ts` `ngOnDestroy` | Drop the matching teardown lines |
| `home.component.ts` `ngAfterViewInit` | Becomes empty; remove the hook if nothing remains |

Side benefit: drops a `ResizeObserver`, a `QueryList` subscription, a rAF loop and
roughly 150 lines of positioning CSS.

Verify: desktop renders without callouts and without console errors; mobile pixel
output unchanged; no unused-symbol warnings.

---

### Phase 2 — Desktop and tablet controls (functional prototype)

Give > 760px the three missing capabilities, on the transposed axis.

- Delete the blanket `display: none` for `.hero-pagination`, `.hero-description`,
  `.hero-swatches` (currently `home.component.scss:507`).
- Description: directly under the subtitle, centred, `max-width: 65ch`.
- Colour swatches: vertical column, left, in space vacated by the callouts.
- Pagination: vertical column, right. `flex: 1 1 0` already works on both axes, so
  the count behaviour carries over unchanged.
- Photo keeps full height and may grow into the freed width.

Verify at 1440, 1280, 1024: photo not shrunk versus baseline; all three controls
visible; swatch click swaps colour; pagination click changes product; segment
count equals product count.

---

### Phase 3 — Rebuild the wide-layout hierarchy

Replace the viewport-edge rails with two related zones. This is a structural
revision of Phase 2, not a cosmetic spacing pass.

**Wide layout**

| Copy / commerce zone | Product media zone |
|---|---|
| Product name and subtitle | Previous/next arrows close to the visible product |
| Short description | Large product visual |
| Labelled colour choices | Compact horizontal product position indicator |
| Primary product CTA | Decorative ring/aura behind the media only |
| Secondary collection link, when needed | |

```text
┌─────────────────────────────────────────────────────────────────────┐
│  PRODUCT NAME             │             ←   PRODUCT   →             │
│  Subtitle                 │                                         │
│  Short description        │               01 / 05                   │
│  Colours  ● ● ●  +2       │                                         │
│  [ Shop this style ]      │                                         │
│  Explore the collection   │                                         │
└─────────────────────────────────────────────────────────────────────┘
```

Use a responsive two-column grid rather than absolute positioning for the two
zones. The copy zone sits at logical `inline-start` and the media zone takes the
larger share. Arabic mirrors the composition through logical properties or grid
areas; do not duplicate the layout with left/right overrides.

**Copy and commerce**

- Keep the description directly below the subtitle, in the same flow, capped
  around `36–42ch`. It must not be independently positioned against the viewport.
- Add a visible, localised colour label and selected colour name. A row of
  unlabelled circles alone is recognisable only after experimentation.
- Keep colour buttons at least 44×44px, with visible selected, hover, focus and
  loading states.
- Remove the ambiguous bare `+` from the colour row. If it represents additional
  colours, render `+N` and label it accordingly. If its actual job is opening the
  product page, replace it with an explicit product CTA.
- When an active hero item has a product route, the primary CTA is explicit
  (`Shop this style` / its Arabic equivalent) and opens that product. Keep
  `Explore the collection` as a secondary action. Do not make a generic
  collection CTA look like the action for the selected colour.
- The CTA follows the colour group in normal flow; it is not pinned to the bottom
  of the viewport.

**Product navigation**

- Place previous/next arrows against the visual bounds of the media, not at fixed
  viewport coordinates.
- Replace the far-right vertical rail with one compact horizontal indicator
  directly below the product inside the media zone. Show a clear current/total
  value such as `01 / 05` plus short clickable segments if visual testing shows
  that the count alone is not enough.
- Do not ship partial `role="tablist"` semantics. Either implement the complete
  tabs keyboard pattern with associated panels, or use a labelled navigation
  group containing ordinary buttons. The latter matches this carousel better.
- Consolidate slide announcements into one polite live region. The title and
  description should not announce separately on the same product change.

**Visual target**

- One dominant focal point: the product.
- One supporting block: copy, colours and shopping actions.
- Navigation reads as part of the product media, not as page chrome or a
  scrollbar.
- Preserve premium whitespace, but no interactive control may look unrelated to
  the element it changes.

Verify at 1280×720, 1366×768, 1440×900, 1919×836 and 1920×1080. At every size,
trace a short visual path: product name → colour choice → CTA, and product image
→ product navigation. No step should require scanning to the opposite viewport
edge.

**Implemented 2026-07-28.** The wide hero now uses a real copy/media grid. Product
name, description, labelled colour selection and both shopping actions share one
flow. Arrows stay inside the media stage and a horizontal `01 / 02` indicator
sits directly below it. The bare `+` control was removed. `Shop this style`
opens the product page with the previewed colour in the `?color=` query.

---

### Phase 4 — Move to a content-based stacked breakpoint

**Centralise first, then move.** The value `760px` is duplicated:

- SCSS: 7 media queries (`238`, `1067`, `1630`, `1638`, plus the `980` pair)
- TS: 5 `matchMedia` calls (`260`, `406`, `419`, `684`, `742`)
- TS: the `heroSizes` responsive-image string (`808`)

Steps:

1. Introduce `HERO_STACKED_MAX_PX` and derive `HERO_STACKED_QUERY` in TS as the
   single source for all layout `matchMedia` calls. Derive `heroSizes` from the
   same number.
2. Add a header comment in the SCSS stacked block naming the TS constant, since
   CSS cannot parameterise a media query.
3. Use `1023px` as the stacked maximum. Visual testing showed that the two-zone
   composition fits at 1024×768, while 1023×768 benefits from the centred stack.
   The boundary also keeps iPad portrait in the stacked layout without forcing
   1024px landscape and small laptops into an unnecessarily tall stack.
4. Verify the breakpoint by content at 1023 and 1024 before freezing it.
5. Retune vertical spacing for the taller tablet viewport.

The existing caps already absorb the wider viewport: at 768px
`min(124vw, 620px)` yields 620px and `min(240px, 62vw)` yields 240px, identical
to phone behaviour.

Do not use the layout breakpoint as a proxy for input. Swipe support and the
teaching nudge should depend on coarse/touch input; layout should depend on
available space. This preserves swipe on a touch laptop and avoids teaching a
mouse-only visitor to swipe.

**Risk:** if `heroSizes` is not moved with the layout, the browser picks the wrong
`srcset` candidate on tablet. Change them in the same commit.

Verify at 768, 820, 1023, 1024 and 1180: the chosen boundary has no overlap or
horizontal overflow; the correct image variant is chosen in the network panel.

**Implemented 2026-07-28.** `HERO_STACKED_MAX_PX = 1023` now derives the TS media
query, responsive image `sizes` and image-preload cache mode. SCSS carries a
matching source-of-truth comment. Swipe teaching additionally requires a coarse
pointer instead of assuming every narrow viewport is touch.

---

### Phase 5 — Enlarge and normalise the visible product

The acceptance target is the visible merchandise, not `.hero-product` dimensions.
Transparent padding, an opaque photographic background, inconsistent crop and
`object-fit: contain` can all make a large CSS box produce a small-looking shoe.

- Audit every hero base image and colour variant for canvas size, visible-content
  bounds, focal point and scale.
- Prefer re-exporting assets to a consistent crop. If sources cannot be changed,
  add optional per-item focal scale/position metadata with a safe default. Do not
  accumulate CSS selectors keyed to product IDs.
- Wide layout: target a visible silhouette around `34–42vw` and `48–60svh` at
  1919×836, constrained by the media zone rather than the full viewport. Start
  conservatively and compare all products; one item must not become dominant only
  because its source was cropped tighter.
- Stacked layout: change `--mobile-product-size` from `min(124vw, 620px)` to
  `min(132vw, 620px)`, then re-measure before going further.
- Re-anchor arrows to the measured media/visible-product area after scaling.
- Keep the copy/commerce zone stable while colours load; a colour change must not
  resize or recenter the layout.

**Implemented 2026-07-28.** The product box is constrained by the media stage and
viewport height, while the visible image content scales to `1.22` on normal wide
screens and `1.36` at 1600px and above. The stacked art uses
`min(132vw, 620px)`. This enlarges the actual merchandise without letting the
box force the arrows or pagination outside their media column.

**Revised 2026-07-28 after silhouette measurement.** The `1.36` step missed the
acceptance target and the `1600px` trigger was the wrong axis.

Root cause: `.hero-product` is capped by `90svh`. On a wide *and short* viewport
the box shrinks while the media column stays wide, so the shoe looks marooned.
Width alone does not predict this: 1920x1080 is wide but tall, and needs the base
scale. The boost is therefore gated on `min-width: 1600px` **and**
`max-height: 920px`.

A second defect surfaced at the narrow end, pre-dating this pass: at 1024x768 the
shoe overlapped the next arrow by 4px, and 1180x800 left only 3px. Clearance
recovers by 1280, so 1024–1279 gets its own reduced scale.

Scale is now one custom property, `--hero-art-scale`, in three bands:

| Band | Scale |
|---|---|
| 1024–1279px | 1.08 |
| base wide | 1.22 |
| ≥1600px and ≤920px tall | 1.6 |

The stacked layout keeps its own `transform: scale(1.14)` and is deliberately
outside this variable, so wide-layout tuning cannot regress the phone.

Measured silhouette after the change (target 34–42vw):

| Viewport | Scale | Ink vw | Ink svh | Gap to prev / next / indicator |
|---|---|---|---|---|
| 1024x768 | 1.08 | 35.4 | 36.3 | 47 / 29 / 128 |
| 1180x800 | 1.08 | 35.5 | 40.2 | 61 / 42 / 116 |
| 1280x720 | 1.22 | 35.0 | 47.8 | 74 / 53 / 79 |
| 1366x768 | 1.22 | 35.0 | 47.8 | 83 / 61 / 94 |
| 1440x900 | 1.22 | 37.4 | 45.9 | 74 / 49 / 121 |
| 1920x1080 | 1.22 | 35.0 | 47.8 | 76 / 44 / 168 |
| 1919x836 | 1.6 | 34.2 | 60.2 | 84 / 53 / 42 |

Every band is inside the target and no control is overlapped. Stacked layout
re-measured unchanged at 390x844: ink 333x256, hero fits 844 of 844, and the
silhouette sits 28px inside each edge so `--peek-shift` still clears it.

**Hard constraint:** `--peek-shift` must stay larger than the photo's per-side
overflow, or the preview lands on top of the current shoe instead of beside it.

**Measure, do not compute.** The SCSS comment states ~81px overflow at 390px while
the naive formula `(124vw - 100vw) / 2` gives 47px. The two disagree, so read the
real value off the element before trusting either.

Verify: hero still fits `100svh` at 390×844, 390×667 and 360×640; the CTA remains
reachable; nudge clears the shoe. At 1919×836, compare the visible-product bounds
against the Phase 2 screenshot rather than comparing only the element rectangle.

---

### Phase 6 — Directional crossfade

Keep the dissolve, add orientation. Applies to **adjacent** moves only.

| Interaction | Animation |
|---|---|
| Swipe / arrow | Crossfade **+ 16px directional drift**, ~450ms |
| Pagination tap | Plain crossfade, unchanged |
| Colour swatch | Plain crossfade, unchanged |

Incoming layer enters offset 16px from the travel direction; outgoing drifts 16px
opposite. Under 20px the eye reads a dissolve, not a slide, so the premium feel
survives while direction is still registered.

Requires storing the last travel direction and multiplying by `--peek-dir` so RTL
is handled by the existing mechanism.

Verify: direction correct in both LTR and Arabic; no shake on release; reduced
motion collapses to plain opacity.

---

### Phase 7 — Nudge and touch-target polish

- Gate the nudge behind an `IntersectionObserver` on the hero stage. It currently
  fires on a timer with no check that the hero is still on screen, so a visitor
  who scrolls in the first two seconds burns the once-per-session flag on an
  animation nobody sees.
- Gate the nudge by coarse/touch input rather than by the stacked layout query.
- Pagination width `min(240px, 62vw)` → `min(268px, 68vw)`, lifting the segment
  tap target from 41.6px to 48px at five products.

---

### Phase 8 — Full verification

Matrix: 360×640, 390×667, 390×844, 768×1024, 1024×768, 1100×800,
1280×720, 1366×768, 1440×900, 1919×836 and 1920×1080.

For each: layout correct, pagination counts products, colour swap works, product
navigation works, hero fits viewport, controls remain visibly associated with
their content, and the visible product—not merely its box—is large enough.

Cross-cutting: Arabic RTL, `prefers-reduced-motion`, production build
(`npm run build:web`), keyboard-only use, 200% browser zoom, coarse pointer versus
mouse, slow colour-image loading, then re-run the nudge harness.

---

## 6. Known couplings

Breaking any of these produces a silent visual bug, not an error.

1. `HERO_PEEK_DURATION_MS × HERO_PEEK_ITERATIONS` in TS must equal the real CSS
   animation total. Too short pulls the class mid-animation and snaps the layers;
   too long leaves it hanging.
2. The stacked-layout breakpoint must be identical in SCSS media queries, TS
   `matchMedia` calls, and the `heroSizes` string. Input capability queries remain
   separate and must not reuse that value.
3. `--peek-reveal` must stay below `--peek-shift`, or the incoming preview
   overlaps the active product instead of occupying the space it vacated.
4. `--peek-shift` must exceed the photo's per-side overflow.
5. RTL travel is driven by `--peek-dir`, not by a second keyframe set. A previous
   `animation-name` override broke in production because Angular scopes
   `@keyframes` names and the optimizer did not rewrite the longhand. Do not
   reintroduce that pattern.
6. **An element centred with `transform` must not run a keyframe that also writes
   `transform`.** The animation wins for its whole run and the centring is
   silently dropped, with no error. This bit all three wide-layout controls in
   Phase 2: `heroFadeUp` animates `translateY`, which cancelled the
   `translateX(-50%)` and `translateY(-50%)` that centred them, leaving the
   description 202px off centre and both rails 100px low. Fixed by giving them
   `heroFadeIn`, which animates opacity only. Reach for the opacity-only
   keyframe whenever an element is positioned by transform.

---

## 7. Verification harness

Reusable browser snippet. Samples the animation rather than trusting the eye.

```js
window.__s = [];
if (window.__si) clearInterval(window.__si);
window.__si = setInterval(() => {
  const st = document.querySelector('.hero-stage'); if (!st) return;
  const pk = document.querySelector('.hero-next-peek');
  const ac = document.querySelector('.hero-product__image.is-active');
  const hn = document.querySelector('.hero-swipe-hint');
  const row = {
    t: Math.round(performance.now()),
    cls: st.className.replace('hero-stage', '').trim(),
    peekX: pk ? Math.round(new DOMMatrix(getComputedStyle(pk).transform).m41 * 10) / 10 : null,
    peekO: pk ? Math.round(getComputedStyle(pk).opacity * 100) / 100 : null,
    actX: ac ? Math.round(new DOMMatrix(getComputedStyle(ac).transform).m41 * 10) / 10 : null,
    pill: hn ? Math.round(getComputedStyle(hn).opacity * 100) / 100 : 'absent',
  };
  const k = JSON.stringify(row).replace(/"t":\d+,/, '');
  const last = window.__s[window.__s.length - 1];
  if (!last || last.k !== k) window.__s.push(Object.assign(row, { k }));
}, 40);
```

Reset the once-per-visit guard:

```js
sessionStorage.removeItem('elite:hero-swipe-hint-shown')
```

**Two testing traps.**

`decode()` never settles while `document.visibilityState === 'hidden'`, so the
nudge appears completely dead in a backgrounded tab. Keep the tab visible, or take
a screenshot to force visibility, before concluding anything is broken.

A full reload wipes the sampler. To keep instrumentation alive, navigate to
another route and back via the router instead of reloading.

---

## 8. Rollback

Each phase is an independent commit on `Elite-POS`. Phase 1 is the only
irreversible-feeling one; the callout markup and CSS are recoverable from git, and
the callout *data* is never deleted.

---

## 9. Docs to update on completion

- `docs/03-client-web.md` — hero behaviour, breakpoints, navigation model.
