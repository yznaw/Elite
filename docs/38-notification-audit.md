# 38. Notifications (toasts): audit and rules

Written 2026-09-23 after the team reported that one connection problem filled the screen with eight identical "Connection lost" messages that never went away, and whose **Retry** button did nothing.

## What was wrong

| Problem | Cause |
|---|---|
| 6 to 10 identical toasts for one outage | `http-error.interceptor.ts` raised one toast per failed request, and a page loads several requests at once. |
| Messages never left | `ToastService` made every `error` persistent (`duration: null`). |
| Retry did nothing | The network and 5xx toasts had `run: () => {}`. |
| Two messages for one failure | About 60 page `catch` blocks toasted their own message ("Couldn't load report") on top of the interceptor's ("Server error"). |
| No "it's fixed" signal | Nothing noticed the connection coming back, so stale toasts stayed. |
| Validation said nothing useful | Server 422s carry the real problems in `errors[]` under the message "Validation failed.", and only the message was shown. |

## How it works now

**`services/toast.service.ts`**
- **One message, one toast.** A toast has a `key` (default: kind + title + sub). Raising it again refreshes the visible toast, adds a "×N" count and restarts its timer.
- **At most 3 visible** (`MAX_VISIBLE_TOASTS`). A 4th drops the oldest one that dismisses itself. Persistent toasts are kept, because they still need an answer.
- **Everything leaves on its own:** success and info after 3.5 s, warning after 6 s, error after 8 s. Only a toast that carries a real action passes `duration: null`, for example the POS "receipt not printed, Retry print" prompt.
- **Hover or focus holds a toast** (`pause` / `resume`), so a long message can be read.
- `errorFrom(err, …)` / `warningFrom(err, …)` show a page's own message **only if** the interceptor has not already shown one for that same error (`markToastShown` / `wasToastShown`).

**`services/connectivity.service.ts`** owns "can we reach the API?".
- The first status-0 failure (or the browser's `offline` event) shows **one** persistent "Connection lost. Reconnecting automatically." message.
- While the API is unreachable, it probes `GET /api/health` after 2, 5, 10, 20 and then every 30 s. **Try now** runs a probe immediately.
- Any successful response or probe clears the message and shows "Back online" for 3 s.
- The POS is not affected: it has its own offline mode and indicator.

**`interceptors/http-error.interceptor.ts`**
- Status 0 goes to `ConnectivityService`.
- 5xx: one keyed "Server error" message, without the no-op Retry.
- 422: shows the server's `errors[]` list.
- Every error it put on screen is marked, so pages do not repeat it.

**`shared/toast/toast.component.ts`**
- Errors use `role="alert"` (read immediately by screen readers); the others use `role="status"`.
- The "×N" count is shown next to the title.

## Inventory (292 call sites)

Counted by area. "From" = `errorFrom`/`warningFrom`, the page-level message that yields to the global one.

| Area | Total | success | info | warning | error | From | push |
|---|---|---|---|---|---|---|---|
| pos | 64 | 16 | 0 | 35 | 12 | 0 | 1 |
| catalog | 45 | 13 | 8 | 2 | 14 | 8 | 0 |
| settings | 29 | 24 | 2 | 0 | 2 | 1 | 0 |
| storefront | 21 | 6 | 2 | 0 | 4 | 9 | 0 |
| reference | 21 | 7 | 0 | 0 | 3 | 11 | 0 |
| orders | 15 | 8 | 1 | 1 | 3 | 2 | 0 |
| media | 13 | 8 | 1 | 1 | 1 | 2 | 0 |
| home-content | 12 | 2 | 1 | 0 | 4 | 5 | 0 |
| shared | 10 | 2 | 2 | 1 | 2 | 3 | 0 |
| interceptors | 9 | 0 | 0 | 4 | 4 | 0 | 1 |
| expenses | 9 | 3 | 0 | 0 | 0 | 6 | 0 |
| stocktake | 8 | 5 | 0 | 2 | 0 | 1 | 0 |
| collections | 7 | 2 | 1 | 0 | 2 | 2 | 0 |
| customers | 5 | 3 | 0 | 0 | 1 | 0 | 1 |
| policies | 5 | 2 | 0 | 0 | 0 | 3 | 0 |
| pos-reconciliation | 5 | 2 | 0 | 0 | 0 | 3 | 0 |
| feedback | 4 | 1 | 0 | 0 | 0 | 3 | 0 |
| restock-requests | 2 | 1 | 0 | 0 | 0 | 1 | 0 |
| reports | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| services | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| app, my-pin, diagnostics, login | 4 | 3 | 1 | 0 | 0 | 0 | 0 |

The remaining direct `error`/`warning` calls outside the POS were checked one by one. They report things the interceptor cannot know about, so they stay as they are:
- form validation before saving (missing name, duplicate SKU)
- a file that is not an image, or is too large before upload
- an upload that finished without a URL
- the print frame failing
- the order drawer's "Could not open order #… / Retry", whose Retry really reopens the order

**Open item, POS.** The POS keeps its own messages (they carry the request reference the shop reads out on the phone). It already skips the network toast, and it benefits from de-duplication and the cap. For a POS request that fails with 5xx or 422, the interceptor's message and the POS's own can still both appear. Converting those catch sites needs a decision about which of the two to keep, because only the POS message carries the "Ref" code.

## Inline state instead of toasts

Per-item progress belongs on the item, not in the toast stack. Stocktake rows (2026-09-24) show *Not saved / Saving / Saved / Not saved + Retry* next to the count box, and a single "N counts not saved" bar with **Save all**; saving forty rows produces no toasts at all. Only a real problem that needs a decision (unsaved counts before export, import, switching location or leaving) raises a dialog.

## Rules for new code

1. **Don't toast HTTP failures you didn't add information to.** The interceptor already said it. In a `catch` around an API call, use `toast.errorFrom(err, title, sub)`; it only shows when the global message didn't.
2. **Never create a persistent toast without a real action.** Pass `duration: null` only together with an `action` that does something.
3. **Never add a Retry that does nothing.** Either wire it to the actual retry or leave it out.
4. **Repeated states get a `key`.** One key per condition; clear it with `dismissKey` when the condition ends.
5. **Copy says what happened and what to do, in both languages:** "Please check the form / Some information is missing or not valid. Correct it and save again."

Tests: `npm run test:notifications` in `client/` (`test/toast-notifications.test.mjs`).
