# 28. POS Payment & Sale-Complete Screens — UI/UX Plan

> **Scope discipline:** this is a plan for visual/interaction polish of screens that already exist. No new fields, no new data, no new buttons, no new logic. Anything that would add a feature is listed under "Explicitly out of scope" instead, so it doesn't quietly creep back in during implementation.

Source: `client/projects/admin-portal/src/app/pages/pos/pos.component.html` (payment sheet ~L455-540, receipt card ~L555-573) and `pos.component.scss`.

## 1. Payment screen (`.payment-sheet`)

### 1.1 "Change due" always renders in the same style, whether it's ₀ or real money
`.change-row strong` (`pos.component.scss:1429`) is unconditionally bold green Georgia 21px, for both `QAR 0.00` (the common case — cash received defaults to the exact total on `selectPayment('cash')`, `pos.component.ts:793`) and a real change amount like `QAR 50.00` (the case that actually requires the cashier to physically hand money back).

Same weight for "nothing to do" and "hand back cash" is a habituation risk: a cashier who sees `0.00` here dozens of times a shift can glance-skip a real `50.00` the same way.

**Recommendation:** two visual states on `.change-row`, driven by the existing `changeCents()` signal — no new computation needed:
- `changeCents() === 0`: keep it quiet — muted grey, same weight as the field label. It's inert information.
- `changeCents() > 0`: make it the loudest thing on the screen — orange/amber accent (`var(--pos-orange)`, already in the palette) and materially larger, since it's the one number the cashier must act on before the customer leaves.

### 1.2 "Cash received" field doesn't visually echo the change state
The input and the change row currently read as two unrelated pieces of UI, even though one drives the other. When change is owed, echo that on the field itself (e.g. a thin amber border/background tint on `.tendered-field` matching the amber from 1.1) so the "this sale needs change" signal isn't only at the bottom of the screen — it's visible at the point the cashier is looking (the number they just typed).

### 1.3 `.secondary-action` ("Print again" et al.) wasn't part of the touch-sizing pass
The 2026-08-02 touch-sizing work (colour pills, quantity stepper, size tiles, modal close, tools bar) raised those targets to a 52-56px floor, but `.primary-action` / `.secondary-action` / `.checkout-button` — the generic action buttons used across every sheet, including this one — were not touched. `.primary-action` is close (padding `15px 20px` + bold text ≈ 50px) but `.secondary-action` (padding `12px 18px`) is thinner. Bring both up to the same floor established elsewhere, for consistency as much as for touch accuracy.

## 2. Sale-complete screen (`.receipt-card`)

### 2.1 The success glyph is the literal text "OK" in a circle
`.success-mark` (`pos.component.html:558`) renders the string `OK` at 12px inside a 54px green circle. At a glance — which is exactly how this screen is meant to be read, mid-rush, before the next customer — a checkmark shape reads as "done" faster than parsing two literal letters. Two ways to fix it, in order of preference for this specific screen:
1. **CSS-only checkmark** (two short rotated bars via `::before`/`::after` on `.success-mark`, no image, no import): keeps the POS bundle exactly as self-contained as it is today, which matters here specifically because this page is precached by the offline service worker (`pos-sw.js`) — every added chunk is one more thing the precache step has to fetch and version.
2. The shared `IconComponent` already ships a `check` glyph (`icon.component.ts`) used elsewhere in the admin portal. Reusable, but it isn't currently imported into `pos.component.ts` (only `PaginationComponent` is) — pulling it in adds a component to the precached page's dependency graph. Only worth it if a checkmark shows up in a second place in the POS later; for one glyph, prefer 2.2.1.

### 2.2 "Order" reads at the same weight as "Receipt" and "Payment"
All four `dl` rows (`Receipt`, `Order`, `Payment`, `Change`) use identical styling (`pos.component.scss:1471-1489`). `Order` is the internal/reconciliation reference; `Receipt` is the number a cashier actually reads back to a customer. Consider de-emphasizing `Order` (smaller, muted) relative to the other three, so the row a person actually needs mid-conversation isn't competing visually with one that's mostly for records.

### 2.3 Button order is already correct — no change
Primary action "New sale" sits above secondary "Print again". That matches actual frequency (every sale needs "New sale"; "Print again" is an exception — jammed paper, a second copy). Confirmed by inspection, not touching it.

## Explicitly out of scope (feature creep to resist)

These came up while reviewing the same screens and are genuinely reasonable ideas, but they're features, not polish — don't fold them into this pass:
- Quick-cash buttons (+50 / +100 / round up) on the tendered field.
- An itemized line-count or item list on the sale-complete screen.
- Any change to what data the receipt card or payment sheet actually shows.

## Suggested order of implementation

1. §1.1 (change-due two-state colour) — highest value, smallest change, pure CSS + one class binding on an existing signal.
2. §1.3 (button touch-size floor) — closes a gap in already-shipped work, mechanical.
3. §2.1 (checkmark glyph) — cosmetic, no logic.
4. §1.2 (tendered-field echo) — cosmetic, depends on 1.1's state existing.
5. §2.2 (de-emphasize Order) — cosmetic, lowest priority, easy to skip if time-boxed.
