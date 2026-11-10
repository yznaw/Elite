# 23 — Hero Resilience Plan

Hard guarantees for where every hero component sits, how large it may grow, and
what it does when its content is missing, oversized or undersized.

Owner: Elite Collection
Created: 2026-07-28
Status: proposed
Related: `docs/22-hero-redesign-plan.md`

---

## 1. Why this is needed

The hero renders CMS-authored content at a fixed viewport height. Today the
layout is correct for the content that happens to be in the database. Nothing
enforces that it stays correct.

Three structural facts make silent breakage likely:

1. **The art row cannot flex.** `grid-template` declares the stage as
   `minmax(0, 1fr)`, but `.hero-stage` then sets
   `height: min(calc(var(--mobile-product-size) / 1.4), 46svh)`. A fixed height
   wins, so the row that looks like the shock absorber is actually rigid. Text
   growth has nowhere to go.
2. **`.hero` uses `overflow: clip`.** When rows do exceed the viewport, nothing
   scrolls and no scrollbar appears. Content is silently cut instead.
3. **The art deliberately overflows its own box.** `.hero-product img` is scaled
   (`1.14` stacked, up to `1.6` wide) to compensate for transparent padding in
   the source files. The shoe therefore paints outside the stage and can collide
   with whatever moves next to it.

### Observed under stress

Forcing a four-line name and a five-line description at 353x760, the composition
did not error and did not scroll. It degraded quietly: the stage was pushed down
until the shoe overlapped the indicator row, and the vertical rhythm collapsed.

That is the failure mode to design against. Not a crash. A slow, invisible slide
into a broken-looking hero that nobody gets alerted to.

### Already observed in real data

| Case | Effect today |
|---|---|
| `Nut Cream` missing from `ref_colors` | The **entire colour block disappears**, including the `+N` chip. A whole row vanishes and the composition silently reflows. |
| Description authored with a literal `...` | Three lines instead of two, pushing the art down. |
| Product name of four words | Wrapped to two lines and, until fixed, left-aligned while everything else was centred. |

---

## 2. Principles

1. **Every component owns a reserved box.** Its neighbours' positions must not
   depend on its content length.
2. **Text is clamped, never trusted.** The CMS is authored by humans; the layout
   must be correct for the worst string, not the current one.
3. **Absence collapses gracefully, it does not restructure.** A missing element
   must not cause the remaining ones to re-flow into a different composition.
4. **The art is the only elastic element.** It is the one thing that can shrink
   without breaking meaning, so it must be the shock absorber, not a fixed row.
5. **Failures must be visible in the admin, not on the storefront.** A missing
   colour hex should be caught before publish.

---

## 3. Component contracts

For each: where it sits, how big it may get, and what happens at the extremes.

### 3.1 Product name

| | Rule |
|---|---|
| Position | First row, stacked; first item in the copy column, wide |
| Max size | **2 lines** stacked, **3 lines** wide |
| Too long | Clamp with ellipsis. Never a third/fourth line. |
| Too short | Box keeps its 2-line reserve so the art does not jump between slides |
| Missing | Should be impossible; fall back to the product name, then to a non-empty placeholder rather than an empty row |

Implementation: `-webkit-line-clamp` with `min-height` equal to the clamp so the
reserve exists even for one-line names. Reserving the height is what stops the
shoe shifting up and down as the visitor swipes between slides.

### 3.2 Short description

| | Rule |
|---|---|
| Position | Directly under the name, stacked and wide |
| Max size | **2 lines** stacked, **3 lines** wide |
| Too long | Clamp with ellipsis |
| Too short | Reserve held, no jump |
| Missing | Row collapses to zero **and** its reserve is released, since the description is genuinely optional |

Note the deliberate asymmetry with the name: the name reserves when empty, the
description does not. The name is always present in practice, so its reserve buys
stability. The description is legitimately optional, so reserving for it would
waste a permanent band of empty space on slides that never use it.

### 3.3 Product art

| | Rule |
|---|---|
| Position | Between the description and the indicator, stacked |
| Size | **The elastic element.** Must become the real `1fr` row. |
| Floor | A minimum height below which it stops shrinking; past that the copy clamps harder instead |
| Ceiling | Current `min(size/1.4, 46svh)` becomes a `max-height`, not a `height` |
| Missing image | Reserve the box and show a neutral placeholder; never collapse, or every row below jumps |
| Wrong aspect | `object-fit: contain` already handles it; the ink-scale variable stays per-breakpoint, not per-product |

This is the single most important change. Converting `height` to
`max-height` restores the shock absorber the grid already expects.

### 3.4 Indicator and arrows

| | Rule |
|---|---|
| Position | Directly under the art |
| Size | Fixed 44px row; arrows 40px stacked, 52px wide |
| Many slides | Segments have a **minimum width**; past that the row scrolls horizontally rather than shrinking targets below 44px |
| One slide | Whole nav hides, including arrows |
| Missing labels | Arrows are icon-only with `aria-label`; no text to overflow |

### 3.5 Colour swatches

| | Rule |
|---|---|
| Position | Under the indicator, stacked; under the description, wide |
| Size | 48px targets, max 4 plus the `+N` chip, **never wraps** |
| More than 4 | Already handled by the `+N` chip |
| Colour lacking hex and swatch | **Currently drops the swatch, and if all drop, the whole block vanishes.** Must instead render a neutral placeholder dot so the row keeps its shape, and surface the problem in the admin |
| No colours at all | Block collapses; acceptable, but the CTA must not move as a result |
| Long colour name | Clamp the name to one line with ellipsis |

The `Nut Cream` case proves this matters: one unmapped colour removed an entire
interactive row from the storefront with no warning.

### 3.6 Primary CTA

| | Rule |
|---|---|
| Position | Last row, always the closest interactive element to the thumb |
| Size | Single line, never wraps |
| Long label | Clamp to one line with ellipsis; the button widens to its max, then clips |
| Missing product link | Falls back to the collection CTA, already implemented |

---

## 4. Global guarantees

1. **The CTA is always fully visible without scrolling**, at every supported
   viewport, for every content extreme. This is the top-level invariant; if a
   change breaks it, the change is wrong.
2. **No horizontal scrollbar**, ever.
3. **No component overlaps another.** Specifically the art must never paint over
   the indicator row, which is what the stress test produced.
4. **Swapping slides never moves a row.** Reserves make the composition stable
   as the visitor navigates.

---

## 5. Phases

### Phase 1 — Make the art elastic

Convert `.hero-stage` `height` to `max-height` and give it a `min-height` floor.
This alone fixes the overlap seen under stress, because growth in the copy then
shrinks the art instead of pushing it into the indicator.

Verify: force a 2-line name plus 2-line description and confirm the art shrinks
and nothing overlaps.

### Phase 2 — Clamp the text

Line clamps and height reserves for the name, description and colour name, per
the contracts above.

Verify: inject a 60-character name and a 200-character description; the row count
must not change.

### Phase 3 — Make absence safe

- Neutral placeholder dot for a colour with no hex and no swatch image, so the
  block never disappears wholesale.
- Placeholder box for a missing image.
- Confirm the CTA does not move when the colour block is absent.

### Phase 4 — Protect the indicator targets

Minimum segment width with horizontal scroll past that point, so a future
ten-slide hero cannot shrink targets below 44px.

### Phase 5 — Catch it in the admin instead

The storefront should be the last line of defence, not the first.

- Block publish, or warn prominently, when a featured colour has no hex and no
  swatch image.
- Show a live character count against the clamp limits on the name and
  description fields, so the author sees the truncation before it ships.

### Phase 6 — Automated guard

A test that renders the hero at the supported viewport matrix against a fixture
of deliberately hostile content, and asserts the four global guarantees in
Section 4. Without this, every guarantee above decays as the code changes.

---

## 6. Viewport matrix

`320x568`, `353x760`, `390x844`, `430x932`, `768x1024`, `1024x768`, `1280x720`,
`1440x900`, `1920x1080`, plus `1919x836` for the wide-and-short case.

Each viewport is tested against: minimal content, typical content, hostile
content (longest plausible strings, missing colours, missing image), and Arabic
RTL.

---

## 7. Known couplings

Carried forward from `docs/22-hero-redesign-plan.md`, still live:

1. `HERO_PEEK_DURATION_MS x HERO_PEEK_ITERATIONS` must equal the CSS animation
   total.
2. The stacked breakpoint must match across SCSS, TS `matchMedia`, and the
   `heroSizes` string.
3. `--peek-reveal` must stay below `--peek-shift`.
4. `--peek-shift` must exceed the art's per-side overflow. **Phase 1 changes the
   art's height behaviour, so re-measure this after it lands.**
