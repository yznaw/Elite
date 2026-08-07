# 32 — Permission Enforcement UX: Hide vs. Disable

When a logged-in user doesn't have permission for a piece of UI, should that
UI disappear entirely, or stay visible-but-disabled with an explanation? This
doc audits how the admin portal currently answers that question (inconsistently,
across four different patterns), analyzes the tradeoffs, and proposes one
convention going forward, with a concrete migration list.

Roles referenced throughout: `owner`, `admin`, `manager`, `cashier`, `viewer`
(`server/db/migrations/001_initial_schema.sql:10`, `019_cashier_role.sql:8`).

---

## 1. Current state: four patterns, applied inconsistently

### Pattern A — fully hidden (removed from the DOM)

The element never renders for a role that lacks access.

- Sidebar extras: `my-pin` link only appended for `role === 'manager'`;
  `diagnostics`/`stocktake` only for `owner`/`admin`
  (`shared/sidebar/sidebar.component.ts:344-352`).
- Team tab, the Owner row: role `<select>` and the Disable/Remove buttons are
  wrapped in `@if (r.role !== 'Owner')` — absent from the DOM, not disabled
  (`pages/settings/settings.component.ts:622-628`, `:639-644`).
- Settings → Security tab, via the `visibleTabs` filter
  (`settings.component.ts:721`) — currently redundant in practice, since the
  whole `/settings` route is already gated to `owner`/`admin` at the router
  level (`app.routes.ts:133`), so no role that could see a filtered-out
  Security tab ever reaches this component to begin with.

### Pattern B — shown, disabled, with an explanation (the one good example)

Settings → Security → Approvals: the self-close-shift and self-approval
toggles render for both owner and admin (who can both open the Security tab),
but only owner can edit them. Non-owners see:

```html
[disabled]="!canEditPosPolicy() || savingPosPolicy()"
[style.opacity]="canEditPosPolicy() ? 1 : 0.6"
```
`settings.component.ts:420,433`, plus an inline message that only renders
when the toggle is locked:
```html
@if (!canEditPosPolicy()) {
  <div class="muted small">{{ t('settings.security.approvals.ownerOnly') }}</div>
}
```
`settings.component.ts:443-445`, copy: *"Only the owner can change these."*
(`i18n/strings.ts:1710`).

This is the only place in the codebase today that does the disabled-with-
explanation pattern this doc is proposing as the default. It should be the
template, not the exception.

### Pattern C — shown, clickable, fails silently after navigation

Every sidebar/bottom-nav link to `/settings`, `/reconciliation`, `/reports`,
`/reference`, `/stocktake`, `/diagnostics` renders identically for **every**
role — the sidebar's `visibleGroups()` only ever *adds* extra links per role,
it never removes the base group list (`sidebar.component.ts:344-352`). A
viewer or cashier sees "Settings" in the nav, clicks it, and `roleGuard`
silently redirects them to `/dashboard`:

```ts
// guards/role.guard.ts
if (!auth.hasRole(...allowed)) return router.createUrlTree(['/dashboard']);
```

No toast, no message, no visual change at the point of the click — the page
just isn't the one they expected. This is worse than Pattern A: it invites
the click, then fails without explanation.

### Pattern D — shown, clickable, fails at the server

For pure API calls (not full navigations), a 403 from the server surfaces
through a global interceptor
(`interceptors/http-error.interceptor.ts:93-102`) as a **generic** toast —
`t('error.403.title')` / `t('error.403.sub')` — regardless of which action
was attempted, except one carved-out case (`isManagerPinVerify`, line 97)
that shows the specific server message instead. So the user does get *some*
feedback here, just generic and after the fact, never before the click.

### The server-side gap this exposes — CLOSED 2026-08-07

`admin.use('/settings', adminSettingsRouter)` applies only tenant-wide
`requireAuth()` — no route-level role restriction
(`server/routes/index.js:78`). Inside `admin-settings.route.js`, `PATCH
/store`, `POST /team`, `PATCH /team/:id`, `POST /integrations`, `POST
/invitations`, `POST /invitations/:id/resend`, and `DELETE
/invitations/:id` had **no explicit role check** of their own; the only
thing stopping a manager/cashier/viewer session from calling them was the
client-side `roleGuard(['owner','admin'])` on the `/settings` route — which
a direct API call (curl, browser devtools) bypassed entirely.

**Fixed**: each write route now applies `requireAuth({ roles: ['owner',
'admin'] })` directly (`admin-settings.route.js`, the `ownerOrAdmin`
middleware defined near the top of the file). Read routes (`GET /store`,
`/team`, `/integrations`, `/invitations`) are deliberately left broader per
the existing documented intent in `index.js`'s mount comment. Verified with
a real invite→accept→login→attempt flow in
`server/test/admin-settings-role-gate-e2e.test.js` — a genuine cashier
session gets 403 on every write route and still succeeds on reads.

---

## 2. Why "just always hide" and "just always disable" both fail

**Always hide** breaks for anything the user might reasonably expect to see
and understand *why* it's unavailable — a manager who knows self-close-shift
exists but can't toggle it benefits from seeing the disabled control and the
one-line reason, not from the setting vanishing as if it didn't exist. It
also breaks silently: hiding a whole *route* (not just a button) still lets
a stale bookmark or a nav click reach a guard that redirects with zero
feedback (Pattern C above) — hiding the entry point doesn't fix the
destination's own failure mode.

**Always disable** breaks for primary navigation. A viewer seeing "Team",
"Reconciliation", "Diagnostics" grayed out in the sidebar on every single
page load is a permanently degraded nav for a role that will never need
those items — cashiers and viewers are not occasional visitors to
owner/admin tooling, they simply never use it. Disabling it everywhere,
forever, is visual noise with no payoff; those users never "unlock" it later
in the same session the way a manager might unlock something after being
promoted.

The right split is by **surface type**, not one global rule.

---

## 3. Recommended convention

### 3.1 Navigation-level (sidebar, bottom-nav, top-level routes) → hide

If a role can never reach a destination, don't show the door. Extend
`sidebar.component.ts`'s existing `visibleGroups()` pattern (which already
correctly *adds* role-specific extras) to also *filter* the base groups by
role, so it becomes the single source of truth both for what's shown and
what `app.routes.ts`'s guards allow — today these two lists (nav visibility
and route guards) are maintained separately and have already drifted (nav
shows everything, guards don't allow everything). One `ROLE_NAV_MAP`
consumed by both the sidebar/bottom-nav *and* referenced in each route's
`data.roles` removes that drift risk entirely.

This also fixes Pattern C: if the nav never shows a link a role can't use,
the silent-redirect failure mode in `roleGuard` becomes unreachable through
normal use (it remains as a defense-in-depth backstop for direct URL entry,
which is fine — that's what guards are for).

### 3.2 In-page controls (toggles, buttons, fields on a page the user CAN open) → disable + message

Once a user is on a page that's legitimately theirs to view (e.g. Settings
→ Security is open to both owner and admin, but only owner can edit
Approvals), don't hide the controls they can't use — disable them and say
why, exactly like the existing Approvals example. This is more honest
(the setting exists, here's its current value, here's who can change it)
and scales to future cases without new decisions each time.

**Standard shape** (already established by the Approvals example, just
generalize it into a reusable piece instead of one-off per feature):

```html
<button [disabled]="!can()" [title]="!can() ? t('perm.ownerOnly.tooltip') : null">
  ...
</button>
@if (!can()) {
  <div class="muted small">{{ t('perm.ownerOnly.hint') }}</div>
}
```

A single shared i18n key family (`perm.ownerOnly.*`, `perm.adminOnly.*`,
etc.) instead of one bespoke string per feature keeps this cheap to apply
everywhere and keeps the wording consistent across the app.

### 3.3 API calls that still 403 despite the above → keep Pattern D as the backstop, make it accurate

Even with 3.1 and 3.2 correctly applied client-side, the server is the real
authority and a race condition is always possible (role changed mid-session,
session stale, direct API call). The existing generic interceptor toast is
the right backstop — it should stay generic by default (a specific "you
can't do that" is plenty), but the manager-PIN-verify carve-out shows the
pattern for the rare case that does need its own message. No change needed
here beyond closing the server-side gap in §1.

### 3.4 Close the server-side gap

Add `requireAuth({ roles: ['owner', 'admin'] })` to the team/invitation
routes in `admin-settings.route.js` (or scope it at the router-mount level
in `index.js` the way `/pos-security` and `/pos-branches` already do). This
is independent of the hide-vs-disable question — it's a real authorization
hole, not a UX choice, and should be fixed regardless of which convention
above ships first.

---

## 4. Migration checklist

Concrete, in priority order:

- [x] **Security fix — done 2026-08-07:** explicit role gates added to
      `PATCH /store`, `POST /team`, `PATCH /team/:id`, `POST /integrations`,
      `POST /invitations`, `POST /invitations/:id/resend`, `DELETE
      /invitations/:id` in `admin-settings.route.js`, matching the client's
      `roleGuard(['owner','admin'])` on `/settings`. Regression-tested in
      `server/test/admin-settings-role-gate-e2e.test.js`.
- [x] **Nav filtering — done 2026-08-07:** both `sidebar.component.ts` and
      `bottom-nav.component.ts` now carry a `roles?: Role[]` field per
      `NavLink`/`SecondaryItem`, set to match the corresponding
      `roleGuard([...])` in `app.routes.ts` exactly (`/pos` excludes
      viewer; `/reconciliation` and `/reports` exclude cashier+viewer;
      `/reference` and `/settings` are owner/admin only). `visibleGroups()`
      now filters the *base* links by role, not just appends extras —
      closing the silent-redirect failure mode (Pattern C) for every link
      it covers: a viewer no longer sees "POS" or "Settings" in the nav at
      all, so `roleGuard`'s redirect-to-dashboard is now unreachable
      through normal navigation and stays only as a defense-in-depth
      backstop for direct URL entry, exactly as intended. `Dashboard`,
      `Catalog`, `Collections`, `Media`, `Storefront`, `Orders`,
      `Customers`, `Feedback`, `Policies`, `Analytics`, and the external
      staff-guide link carry no `roles` field, matching their genuinely
      unguarded routes.
      Not yet done: a single shared source of truth generating both the nav
      map and the route guards from one table (would need a build-time or
      startup cross-check, e.g. a unit test asserting the two lists agree)
      — today they're two hand-matched lists with a comment pointing at
      each other, better than before but still capable of drifting again if
      a future route's guard changes without the nav being updated to
      match. Worth a follow-up if this area keeps growing.
- [x] **Shared hint pattern — done 2026-08-07:** added the `perm.ownerOnly.*`
      / `perm.adminOnly.*` i18n key family and `<ap-perm-hint scope="owner
      | admin"/>` (`shared/perm-hint/perm-hint.component.ts`) as the
      reusable piece — pair `[disabled]="!can()"` on the control with
      `<ap-perm-hint *ngIf="!can()" scope="..."/>` beneath it instead of a
      one-off `<div>{{ t('some.bespoke.key') }}</div>` per feature. Proved
      out on a real caller: the Settings → Security → Approvals card
      (previously the only existing instance of this pattern, using its
      own bespoke `settings.security.approvals.ownerOnly` key) now uses the
      shared component and generic key; the old key was removed as
      orphaned once it had no other callers.
- [x] **In-page control audit — done 2026-08-07.** Grepped every
      owner/admin in-page permission check in the client
      (`hasRole('owner')`, `role !== 'Owner'`) — there are exactly three:
      1. Team tab, Owner row: role `<select>` and Disable/Remove buttons
         hidden via `@if (r.role !== 'Owner')`
         (`settings.component.ts:622,640`).
      2. Settings → Security → Approvals toggles, owner-only via
         `canEditPosPolicy` (`settings.component.ts:808`) — already Pattern B,
         see above.
      **Conclusion for #1: correctly stays hidden (Pattern A/3.1), not a
      candidate for converting to disable+message.** The distinction this
      doc draws between 3.1 and 3.2 is about *who's allowed*, not *whether
      the action exists at all* — the Owner row's role/disable/remove
      controls aren't "an action you personally lack permission for," they're
      an action nobody can perform through this UI, for anyone, ever (you
      cannot demote, disable, or remove the account's only owner — see
      `docs/33-user-roles-guide.pdf`'s Owner-addition plan for the intended
      future flow). Showing a disabled control with an "ask your admin"
      style message here would misleadingly imply some other user *could*
      do this if only they had more permission, when in fact no one can.
      No further in-page conversions are needed — the two real owner-vs-admin
      splits in the app are #1 (correctly hidden) and #2 (correctly
      disabled+explained already).
- [x] No changes needed to the global 403 interceptor or the manager-PIN
      carve-out — confirmed both already match the recommended shape.

**All items closed as of 2026-08-07.** This was a UX/consistency change
plus one real security fix, not a feature build — the work was applying an
existing good pattern (§1 Pattern B) more broadly, closing a real
server-side authorization gap, and bringing two nav-visibility lists that
had drifted apart back in sync with the route guards they're supposed to
mirror. Remaining known gap: the nav map and the route guards are still two
hand-matched lists (not generated from one shared source) — noted inline
above as a possible follow-up, not blocking.
