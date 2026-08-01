# 26 — Hero mobile production hardening plan

Storefront home hero. Follow-up to `22-hero-redesign-plan.md` after testing the
deployed build on a physical iPhone.

Owner: Elite Collection  
Created: 2026-08-01  
Status: Proposed — analysis complete, implementation not started

---

## 1. Outcome

Ship a hero that remains visually clean and deterministic when:

1. a transparent product image is rendered on a high-density phone display;
2. the visitor taps products and colours repeatedly or accidentally double-taps;
3. iOS Reduce Motion is enabled;
4. an image is still downloading or an earlier interaction is interrupted.

This is a production-hardening pass, not a visual redesign. Product scale,
information hierarchy and the new adaptive name/description spacing remain in
place unless a real-device test exposes a regression.

---

## 2. Evidence and root causes

The findings below are based on the deployed storefront at
`https://elitecollections.qa/`, the current source, and the exact product file
selected by the browser.

### 2.1 The visible image boundary is in the production asset

The first live hero image resolves to:

```text
/api/uploads/ms3a8ern-21229187-pdp.webp
```

The file has a real alpha channel, but viewing both the 1400px `-pdp` variant and
the 3480×2160 uploaded original shows long horizontal colour streaks extending
from the right-hand sandal. They remain partially opaque, so a Retina display
makes them read as the rectangular edge of the image.

This is not caused by `object-fit`, the hero ring or the mobile crop. The defect
already exists in the uploaded original. `server/lib/storage.js` correctly
preserves alpha while generating WebP variants, but it also preserves the bad
pixels because the upload pipeline has no alpha-quality check.

Implication: a CSS mask may hide one screenshot but is not the primary fix. The
source cut-outs must be cleaned and the upload workflow must prevent the same
defect from returning.

### 2.2 Rapid tapping has no complete touch policy

Current state:

- the stage declares `touch-action: pan-y`;
- hero buttons do not declare `touch-action: manipulation`;
- the page uses `maximum-scale=1.0` in the viewport meta tag;
- swipe tracking does not capture the pointer or explicitly reject non-primary
  touch points;
- navigation requests are asynchronous, but the next target is calculated from
  the last committed index instead of a pending intent index.

On iOS, rapid taps can therefore be interpreted inconsistently between button
activation, double-tap page zoom and a new pointer sequence. The viewport meta
restriction is not a robust interaction fix and unnecessarily limits user zoom.

There is a second failure mode that can look like zoom: rapidly restarted image
layers can briefly carry different transforms/scales. The implementation must
measure both `visualViewport.scale` and the active layer transform so the two
causes are not confused.

### 2.3 Reduced Motion currently creates an invalid layer state

Current reduced-motion CSS changes the image opacity transition to `0.01ms` and
sets the transition animations to `none`.

For product changes this produces an abrupt replacement after decoding. For a
colour change, `.hero-product__image--color-outgoing` still has `opacity: 1` but
its fade-out animation is disabled. The old colour therefore remains fully
opaque above the new one until the 280ms JavaScript timer removes it. That
explains the unpleasant flash/overlap reported on iPhone.

Reduce Motion should remove spatial travel, not remove state communication. A
short opacity-only crossfade is both accessible and visually stable.

---

## 3. Experience decisions

| Before | After | Why |
| --- | --- | --- |
| Corrupted transparent images are accepted and resized | Clean source cut-outs plus alpha QA before publish | CSS cannot reliably repair bad pixels embedded in an asset |
| `maximum-scale=1.0` attempts to suppress zoom globally | User zoom remains available; hero controls use an explicit touch policy | Fix the interaction without weakening accessibility |
| Stage only uses `touch-action: pan-y` | Stage uses `pan-y pinch-zoom`; buttons/links use `manipulation` | Preserve vertical scrolling and pinch zoom while suppressing double-tap activation zoom on controls |
| Rapid taps calculate from the last committed slide | Taps update a pending intent and coalesce to the latest valid destination | Repeated input stays deterministic even while images decode |
| 420ms keyframes can restart during frequent product navigation | Short, interruptible transition; coarse-pointer mobile uses opacity only | Navigation is frequent and must feel immediate when interrupted |
| Reduced Motion uses a `0.01ms` swap | 140–180ms opacity-only crossfade with no translation or scale | Reduced motion means gentler motion, not a broken or flashing swap |
| Colour outgoing layer stays opaque when its animation is disabled | Outgoing layer always reaches opacity zero before cleanup | Prevent two colourways remaining visibly stacked |
| Cleanup relies only on fixed timers | `transitionend`/`animationend` cleanup with a timeout fallback | State follows the rendered transition and remains safe if an event is lost |

---

## 4. Scope

### In scope

- all product and colour images rendered inside the home hero;
- upload-time responsive WebP variants used by the hero;
- hero arrow, pagination, swatch and swipe interactions;
- normal motion and `prefers-reduced-motion: reduce`;
- iPhone Safari, Android Chrome and responsive desktop browsers;
- automated regression tests and a physical-device release checklist.

### Out of scope

- changing product photography or the visual composition of the shoes;
- disabling pinch-to-zoom for the entire storefront;
- a new carousel library;
- animation changes outside the home hero;
- automatic AI background removal inside the upload pipeline.

---

## 5. Implementation phases

### Phase 0 — Reproduce and record the production failures

Before changing code, capture a small, repeatable baseline.

1. On a physical iPhone, record:
   - model, iOS version and Safari version;
   - Display Zoom setting (`Default` or `Larger Text`);
   - Reduce Motion state;
   - portrait and landscape behaviour;
   - a screen recording of ten rapid arrow taps and ten alternating swatch taps.
2. Log at each failure:
   - `visualViewport.scale`;
   - `innerWidth`, `documentElement.clientWidth` and `scrollWidth`;
   - active product index, pending product index and selected colour key;
   - computed transform and opacity for every hero image layer.
3. Save the original and actual `currentSrc` candidate for each visible product.

Exit criteria: each report is classified as real viewport zoom, horizontal
overflow, image-layer scale, or a combination. Do not implement a global
`overflow-x: hidden` workaround before this classification.

### Phase 1 — Repair assets and harden media publishing

#### 1A. Immediate production asset repair

1. Re-cut every live hero product from the source photography.
2. Inspect at 400% on three backgrounds:
   - white;
   - hero canvas colour;
   - dark green/checkerboard.
3. Remove horizontal streaks, opaque islands, matte halos and accidental shadow
   rectangles while preserving the intentional contact shadow if present.
4. Export a lossless PNG or lossless WebP master with straight alpha.
5. Upload as a new media asset, regenerate all variants and update the hero
   references. Use a new filename so browser/CDN caches cannot serve the old
   corrupt image.

Do not overwrite only `-pdp.webp`: phones and desktops choose different
`srcset` candidates, so the master and every generated variant must belong to
the same clean generation.

#### 1B. Upload pipeline guard

Update `server/lib/storage.js` and the admin media workflow:

- record `hasAlpha`, source dimensions and generated variant dimensions in
  media metadata;
- generate an alpha-QA contact sheet on white, canvas and checkerboard;
- warn on suspicious semi-transparent horizontal runs, detached alpha islands,
  or non-transparent pixels unusually far from the main subject;
- show the QA contact sheet in the admin before a media asset can be assigned to
  the hero;
- treat numeric checks as warnings, with the three-background visual review as
  the final authority;
- generate `srcset` from variant metadata rather than assuming every suffix
  exists.

Add a maintenance script that audits existing hero media and prints the product,
colour, original URL, chosen variants and QA status. It must not mutate files
unless run with an explicit repair flag.

Exit criteria: no boundary is visible on a physical Retina iPhone or desktop at
100%, 200% and during a crossfade.

### Phase 2 — Make touch interaction deterministic without disabling zoom

#### 2A. Browser touch contract

Update `client/projects/client-web/src/index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Remove `maximum-scale=1.0`. User pinch zoom must remain available.

Update the hero styles:

- `.hero-stage`: `touch-action: pan-y pinch-zoom`;
- hero buttons and links: `touch-action: manipulation`;
- image layers: `user-select: none`, `-webkit-user-drag: none` and no browser
  drag ghost;
- keep text selectable outside controls;
- do not use a document-wide `touch-action: none` or a global `preventDefault()`.

#### 2B. Pointer and gesture ownership

Update the swipe handlers:

- accept only `event.isPrimary` and the original `pointerId`;
- call `setPointerCapture()` after a horizontal gesture is intentionally owned;
- release capture on up, cancel, lost capture and component destroy;
- ignore additional fingers rather than moving the start point;
- cancel swipe recognition when vertical travel wins the axis lock;
- keep the current 44px distance threshold, but add velocity as a second valid
  completion path for a deliberate flick;
- never turn a pointer sequence that starts on a button into a swipe.

#### 2C. Rapid-input state machine

Introduce one hero transition coordinator shared by product and colour changes.

It owns:

- committed product index;
- intended product index;
- committed colour key;
- monotonically increasing request token;
- incoming and outgoing image URLs;
- phase: `idle | loading | transitioning`;
- motion mode: `normal | reduced`.

Rules:

1. Arrow taps update the intended index immediately, even if the previous target
   is still decoding.
2. Only the newest request token may commit visual state.
3. Repeated taps are coalesced to the final intent; interaction is not blocked
   behind a long animation.
4. A swatch tap cancels only an obsolete colour request, not a product request
   that already owns a newer token.
5. Re-tapping the committed colour is a no-op.
6. At most two visible media layers may exist: one incoming and one outgoing.
7. Cleanup leaves exactly one active layer with `opacity: 1` and `transform:
   none`.

Exit criteria: 30 mixed product/colour taps never change viewport scale, never
create horizontal document overflow and settle on the last requested state.

### Phase 3 — Build explicit normal and reduced-motion transitions

#### Normal motion

- mobile/coarse pointer: 160–200ms opacity-only crossfade;
- desktop/fine pointer adjacent arrow: at most 220ms with a subtle 12–16px
  directional cue;
- pagination jump and colour preview: opacity-only;
- decode incoming media before committing the swap;
- use only `opacity` and `transform` for animation;
- prefer interruptible transitions for frequently repeated navigation.

The existing 420ms adjacent transition is too long for repeated navigation and
should not run on coarse-pointer mobile.

#### Reduced motion

- no translate, scale, swipe demonstration or animated loading spinner;
- retain a 140–180ms opacity-only crossfade for both product and colour changes;
- outgoing opacity must animate from 1 to 0 instead of remaining opaque;
- selected indicator and accessible label update with the committed image;
- keep the old image visible while the new image decodes;
- on load failure, retain the old image and clear the busy state;
- listen for changes to the media query so changing the iOS setting while the
  page is open updates the mode safely.

The reduced-motion path must not be implemented by setting every animation to
`none`. The reduced path is its own complete visual state machine.

Exit criteria: frame-by-frame inspection shows no blank frame, double-exposed
colourway, spatial movement or late snap.

### Phase 4 — Automated regression coverage

Extend `client/e2e-hero/hero-resilience.spec.ts` with:

1. **Rapid product input:** 20 alternating next/previous activations; final
   slide matches final intent and exactly one image layer is active.
2. **Rapid colour input:** alternate all swatches while mocked images resolve
   out of order; the last requested colour wins.
3. **Mixed input:** arrows and swatches interleaved during decoding; no stale
   request commits.
4. **Double activation:** repeated pointer activation leaves
   `visualViewport.scale === 1` in supported automation and does not change
   document width.
5. **Overflow:** `scrollWidth <= clientWidth + 1` throughout the transition,
   not only after it settles.
6. **Reduced motion:** emulate `reduce`; verify opacity transition duration is
   within 140–180ms, every transform is `none`, and the outgoing colour reaches
   zero before removal.
7. **Setting change:** switch motion preference while a transition is active and
   verify deterministic cleanup.
8. **Load failure:** failed incoming image keeps the committed image visible.
9. **Asset alpha QA:** run the master and every variant through the contact-sheet
   and anomaly checks.

Automation cannot certify Safari double-tap behaviour. It catches state and
overflow regressions; the physical-device gate remains mandatory.

### Phase 5 — Physical-device release gate

Required matrix:

| Device/browser | Motion | Orientation | Required interaction |
| --- | --- | --- | --- |
| Current iPhone / Safari | Normal | Portrait + landscape | swipe, arrows, pagination, colours, deliberate pinch |
| Current iPhone / Safari | Reduce Motion | Portrait + landscape | arrows, pagination, rapid colours |
| Previous supported iOS / Safari | Normal + reduced | Portrait | rapid mixed input |
| Android / Chrome | Normal + reduced | Portrait | rapid mixed input and vertical scroll |
| Desktop Safari + Chrome | Normal + reduced | Full viewport | arrows, pagination and colour stress test |

For each row:

- run 30 mixed interactions;
- deliberately double-tap controls and empty stage space;
- confirm pinch zoom still works when intentionally requested;
- confirm ordinary control taps never zoom;
- inspect the shoe edge on white and dark compositing backgrounds;
- rotate once while a product is active;
- leave the final screen idle for two seconds and confirm one stable layer.

Exit criteria: zero unintended zoom events, zero visible image rectangles, zero
overlap/flash in Reduce Motion and no loss of intentional pinch zoom.

### Phase 6 — Rollout and observability

1. Deploy the cleaned assets first as a cache-busted production hotfix.
2. Deploy the interaction coordinator and motion modes behind a temporary hero
   hardening flag if the production release process supports flags.
3. Add development-only diagnostics for request token, phase and active layer
   count; do not log customer data.
4. Watch client error logs for image load/decode failures and transition states
   that remain non-idle beyond one second.
5. Remove diagnostics/flag after the physical-device matrix and a 48-hour clean
   production window.

Rollback must restore the previous code bundle without restoring corrupt image
assets.

---

## 6. File map

| File | Planned responsibility |
| --- | --- |
| `client/projects/client-web/src/index.html` | Accessible viewport policy |
| `client/projects/client-web/src/app/pages/home/home.component.html` | Image drag attributes and stable layer state classes |
| `client/projects/client-web/src/app/pages/home/home.component.scss` | Touch policy plus normal/reduced visual transitions |
| `client/projects/client-web/src/app/pages/home/home.component.ts` | Pointer ownership, pending intent and transition coordinator |
| `client/e2e-hero/hero-resilience.spec.ts` | Stress, reduced-motion, zoom and layer assertions |
| `server/lib/storage.js` | Alpha metadata and verified variant generation |
| `server/scripts/` | Read-only hero media audit/contact-sheet generator |
| Admin media/storefront editor | Three-background alpha preview and publish warning |

---

## 7. Definition of done

- [ ] All live hero masters are clean and all responsive variants regenerated.
- [ ] No CSS mask is relied on to conceal corrupted source pixels.
- [ ] `maximum-scale=1.0` is removed and deliberate pinch zoom still works.
- [ ] Hero controls suppress accidental double-tap zoom through their touch
      contract, not a global viewport restriction.
- [ ] Thirty rapid mixed interactions settle on the last requested product and
      colour with one active image layer.
- [ ] Normal mobile transitions remain under 200ms and are interruptible.
- [ ] Reduce Motion uses a short opacity-only crossfade with no overlap or snap.
- [ ] Automated hero suite and production build pass.
- [ ] Physical iPhone Safari matrix passes in normal and reduced-motion modes.
- [ ] CDN/browser caches serve the new clean asset generation.
- [ ] Documentation records the final timings, tested devices and production
      asset IDs.

---

## 8. Recommended execution order

1. Asset hotfix and cache busting — removes the visible production defect with
   the lowest code risk.
2. Touch contract and rapid-input coordinator — fixes unintended zoom/races.
3. Reduced-motion transition path — fixes flashing and double exposure.
4. Automated stress coverage.
5. Physical-device gate and production rollout.

Do not combine the asset replacement and interaction state-machine change in one
unverified release. Separate deployment checkpoints make regression diagnosis
and rollback unambiguous.
