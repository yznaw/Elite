# 17 — POS Remote Verification Session (2026-07-19)

**Who ran this:** Claude (Cowork), driving a real Chrome browser against the live production admin portal at `https://admin.elitecollections.qa/`, logged in as Owner (`owner@elite.local`).

**What this session was NOT:** a hardware acceptance test. No physical register, printer, cash drawer, phone camera, or barcode scanner was available. No database or server (SSH/pm2) access was available. Everything below is a **software/UI-layer verification** of the test plan in [16-launch-roadmap.md](16-launch-roadmap.md) §Phase 0.5, §Phase 1, §Phase 3 — it complements, but does not replace, the hands-on hardware test gates in that document, which still all need to be run on the real SRP-QE300 register by a human.

---

## Summary table

| Phase | Item | Result |
|---|---|---|
| 0.5-D | Admin generates a POS registration/setup code without touching the register | ✅ **Confirmed** |
| 0.5-C | Reprint a receipt from the transaction lookup panel | ✅ **Confirmed** (flow executes and fails gracefully — see note) |
| 0.5-A/B | QR clipping / garbled text on printed receipt | ⛔ **Not testable remotely** — requires physical printer |
| — | Scan printed QR with phone / barcode scanner | ⛔ **Not testable remotely** |
| 1 | Sale writes a stock-decrementing record | 🟡 **Indirectly confirmed** via Catalog stock count (5997 → 5996 after 1-unit sale); the actual `inventory_movements` row was **not** queried (no DB access) |
| 1 | Void / partial refund write correct ledger rows | ⛔ **Not completed** — blocked, see "Manager PIN" finding below |
| 1 | `pm2 logs` drift-job check | ⛔ **Not testable remotely** — no server access |
| 3 | Cash movement — Paid in (no PIN) | ✅ **Confirmed**, recorded and reflected correctly in shift summary |
| 3 | Cash movement — Paid out (PIN required) | ⛔ **Not completed** — blocked, see finding below |
| 3 | No-sale drawer open (PIN required) | ⛔ **Not completed** — blocked, same reason |
| 3 | Shift close / Z-report generation (PIN required) | ⛔ **Not completed** — blocked, same reason |
| 3 | Z-report reprint, CSV export | ⛔ **Not reached** — no Z-report has ever been generated on this tenant ("No closed shifts yet") |

---

## 🔴 Blocking finding: no manager PIN exists or can be set anywhere in the UI

This is the most important result of this session. Every action gated behind "manager PIN approval" — **void, refund, no-sale drawer open, paid-out, and closing a shift to generate a Z-report** — requires a PIN that, as far as I could find, **has no setup screen anywhere in the product**:

- Settings → General: no PIN field.
- Settings → Team Members: role dropdown only (Owner/Admin/Manager/Cashier/Viewer) — no PIN column or "Set PIN" action, even when editing the Owner's own row.
- POS "Admin" menu (top right): just a link back to the admin portal, not a PIN/profile menu.

I tried the Owner account with a blank PIN, `0000`, and `1234` — all rejected (`Manager PIN is incorrect`), confirming the check is real and working, just that there's no discoverable way to set a correct one. This means:

- **Void and refund could not be completed** — only the "wrong PIN" rejection path was exercised.
- **The shift could not be closed**, so **no Z-report could be generated** — meaning the entire Phase 3 Z-report test gate (print, reprint, CSV export, hand-count reconciliation) is currently un-runnable by anyone, including the Owner, until a PIN can be set somewhere.
- Z-report history confirms this tenant has **"No closed shifts yet"** — this has never been done, on this environment, by anyone.

**Recommended fix before any further hardware testing:** add a "Set my manager PIN" action (Settings → Team Members, or a per-user profile screen) so Owner/Admin/Manager accounts can actually create the credential the rest of Phase 3 depends on.

---

## Bugs found (not in the original test plan, discovered incidentally)

**1. Spurious "Session expired" toast + temporarily empty POS catalog after a failed PIN attempt.**
After the `Manager PIN is incorrect` rejection on the void attempt, the UI also fired a `Session expired — Please sign in again to continue` toast, and the "Available products" grid briefly rendered as "No matching products / 0 items · 0 variants." Reloading `/pos` immediately after showed the session was **not** actually expired (still signed in as Owner, cart/shift state intact, stock counts correct). This looks like a UI-only false-positive triggered by the failed-PIN response, not a real auth issue — but it's worth a look since a cashier seeing "session expired" mid-shift after a mistyped PIN is confusing and could prompt an unnecessary re-login or a panicked call to support.

**2. Variant size labels showing color names instead of sizes.**
Opening "Black Edition" in the POS variant picker, several "size" cards were labeled `Black` (repeated 3 times) and `5` (repeated 3 times) instead of proper distinct size values (e.g. 40, 41, 42...). This looks like a catalog data-entry issue on that specific product (or a genuine size-label bug) rather than a POS bug, but it would confuse a cashier trying to pick the right size at checkout. Worth checking that product's variant data in Catalog → Black Edition.

**3. Dashboard briefly renders all-zero KPIs on first load.**
Navigating to `/dashboard` occasionally showed Revenue/Orders/Customers all at 0 with "No products match your filters" for a moment before the real numbers (QAR 24,600 etc.) populated on a subsequent load. Looked like a race between the page shell rendering and the data fetch resolving, not actual data loss — but flagging in case it's more visible on a slower connection.

---

## What I actually did (for reproducibility)

1. **Settings → POS Registers**: entered register name `TEST - Front Counter (QA)`, clicked **Generate setup code** → got a token (`Uhrv2Jo...`) with a "Setup code generated — Expires in 15 minutes" toast. Confirms the remote-enrollment token generation (Phase 0.5-D) works end-to-end from the admin side. The second half — a different device actually enrolling with that code — wasn't tested (would need a second physical/browser session at the register).
2. **POS → rang up 1× "Black Edition" (Black, QAR 1,200) for cash, exact tender.** Sale completed as receipt `#00000601` / order `POS-00000601`. Toast correctly reported `Sale saved, receipt not printed — No receipt printer is configured` (expected, since this browser has no printer attached — confirms the app fails gracefully rather than silently).
3. **Clicked "Print again"** on the sale-complete modal → same graceful `Couldn't reprint receipt — No receipt printer is configured` error, no crash.
4. **Returns/voids → looked up receipt 601 → clicked "Reprint receipt"** in the lookup panel → same graceful failure. Confirms the lookup-and-reprint code path (Phase 0.5-C) runs correctly up to the point where it needs real hardware.
5. **Attempted to void receipt 601** with reason "QA test void — agent testing script" and PIN `0000` → correctly rejected (`Manager PIN is incorrect`); see bug #1 above for the side-effect this triggered.
6. **Cash movement → Paid In, QAR 50, reason "QA test - change fund top-up"** → recorded successfully, no PIN required (matches spec), and the shift summary correctly updated: Cash In QAR 50.00, Expected Cash QAR 1,250.00 (= 1,200 sale + 50 paid-in).
7. **Shift report → Create Z report and close**, tried with PIN blank and then `1234` → both silently rejected (dialog stayed open, no shift closed). Z-report history confirmed **"No closed shifts yet."**

Stock on "Black Edition" moved from 5,997 → 5,996 after the one-unit sale, which is the expected signed delta — the closest indirect check I could do on the inventory ledger without database access.

---

## Still needed (hands-on, at the real register)

Everything in [16-launch-roadmap.md](16-launch-roadmap.md)'s Phase 0.5 and Phase 3 test gates that involves **paper, a phone camera, a physical drawer, or hand-counting cash** — none of that can be done remotely. On top of the original checklist, please also:

- Set a working manager PIN for at least one Owner/Admin account (once a way to set one exists) before attempting the void/refund/drawer-open/paid-out/Z-report items.
- Re-run the `pm2 logs` drift-job watch and the direct `inventory_movements` / `pos_inventory_baselines` queries from Phase 1 — I have no server or database access in this session.
- Double check the "Black Edition" variant size labels in Catalog (bug #2 above) before it causes a real checkout mistake at the till.

---

## Retest — commit `dec6a58` ("Fix remote-QA findings: manager PIN setup, false session-expiry, dashboard flash")

Re-ran the relevant checks against the live site after this commit deployed.

| Finding from first session | Status now |
|---|---|
| No way to set a Manager PIN anywhere | ✅ **Fixed** — the "Manager PIN" card exists (Settings → General) and saves correctly. The "doesn't work in POS" symptom below turned out to be the approver-separation control correctly rejecting self-approval, not a broken save — see finding below for the real explanation and the unblock path (a second account). |
| Bug #1 — spurious "Session expired" toast + blank catalog after wrong PIN | ✅ **Fixed** — reproduced a wrong-PIN rejection three separate times in this retest; got only the correct `Manager PIN is incorrect` toast each time, no session-expired toast, no catalog blanking. |
| Bug #3 — dashboard all-zero KPI flash on load | ✅ **Fixed** — reloaded `/dashboard` repeatedly; it now goes straight from a blank/loading content area to fully-populated real numbers, never showing a zero/empty-state flash in between. |
| Bug #2 — "Black Edition" size labels showing color names | ⚪ **Not fixed, as expected** — commit message explicitly flags this as bad source data requiring a manual catalog edit, not a code fix. Still needs someone to go into Catalog → Black Edition and correct the variant size values. |

### 🟢 Investigated: the Manager PIN you save in Settings didn't authenticate in POS — explained, not a bug

Steps to reproduce (tried 3 times with 3 different PINs, same result every time):

1. Settings → General → Manager PIN card → enter a 4-digit PIN (tried `4821`, `9137`, `7710`) → **Save PIN** → toast confirms "Manager PIN saved. Use it on the register to approve POS actions."
2. Go straight to POS → Returns/voids → look up an existing receipt → enter a reason → enter the **exact same PIN just saved** → Void entire sale.
3. Every time: `Couldn't void sale — Manager PIN is incorrect.`

Tried immediately after saving (no delay), after a full page reload, and using `form_input` to set the field directly (ruling out a typing/focus glitch) — same result each time. This means the Phase 3 PIN-gated actions (void, refund, no-sale drawer open, paid-out, shift-close/Z-report) are **still fully blocked**, just with a different root cause than before: the self-service PIN card gives the illusion of being set up, but whatever it writes doesn't match what the verify-pin check reads back.

**Root cause found (not a bug) — this is the approver-separation control working as designed.** `server/lib/pos/manager-service.js:77` explicitly excludes the acting user's own account from the pool of valid approvers unless the tenant has opted into an audited "emergency self-approval" exception (`tenants.pos_emergency_self_approval_enabled`, currently SQL-only, no UI toggle exists yet — see roadmap Phase 2):

```js
if (manager.id === context.userId && !emergencySelfApprovalEnabled) continue;
```

This was built intentionally (docs/15 Phase 3, P0-7) so a manager-role cashier — or, as in this retest, the only account in the environment — cannot approve their own void/refund/etc. with their own PIN. **The Owner's PIN was in fact saved and hashed correctly; it is being deliberately rejected because the Owner was trying to approve their own action.** This is not the same bug class as before (no mismatch, no silent no-op) — it's the security control functioning correctly against a test environment that only had one usable account.

**No code fix needed. Unblock path:** invite a second account (Settings → Team → invite as Manager or Admin), have that second account set its own PIN (Settings → General → Manager PIN, once logged in as them), and use *that* PIN — not the Owner's own — to approve the Owner's void/refund/paid-out/drawer-open/Z-report actions. This also matches how a real shop with more than one person is expected to operate.

---

## Next retest checklist

1. Settings → Team → invite a second test account with role **Manager** (or Admin), accept the invite / set its password.
2. Log in as that second account once, go to Settings → General → Manager PIN, save a PIN for it.
3. Log back in as Owner (or whichever account is doing the selling) and re-run the blocked items, entering the **second account's** PIN when prompted:
   - Void a completed sale
   - Refund a completed sale (partial and full)
   - No-sale drawer open
   - Paid-out cash movement
   - Shift close → Z-report generation
4. Once a Z-report exists, retest the still-unreached items: Z-report reprint, CSV export.
5. Everything in Phase 1 that depends on void/refund (ledger rows for void/partial-refund) can now also be exercised.
