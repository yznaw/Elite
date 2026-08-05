# 31 — Multi-Branch Receipts: Verification Checklist

What was verified for the multi-branch feature (`server/db/migrations/027_pos_branches.sql` onward, `docs/12-pos-system.md` §13.2), what that verification actually proves, and what is still open because it needs physical hardware or production access this session does not have.

Every item below is either checked off with real evidence attached, or left open with the exact next step named — nothing is marked done on the strength of "the code looks right."

---

## 1. Automated — re-run 2026-08-04, both green

```bash
cd server && npm test
```
**41/41 passing**, including `test/pos-branches-e2e.test.js` (853ms), which is the one that actually matters here — see §2.

```bash
cd client && npx ng build admin-portal --configuration production
```
Clean build, no type errors. (One pre-existing, unrelated CommonJS warning for `jsbarcode` — not from this work.)

## 2. End-to-end, against a real server and a real database

`server/test/pos-branches-e2e.test.js` boots a real Express server and a disposable tenant, then over real HTTP:

- Confirms a brand-new tenant starts with **zero** branches, and `GET /pos/business-profile` returns `null` rather than a 500.
- Creates a branch; confirms creating a branch never auto-makes it default.
- Confirms a *second* branch resolves as the effective profile via the "oldest branch" fallback, even with no default explicitly set yet.
- Flips the default branch; confirms the till read path follows it.
- Enrolls a real register, assigns it to a *non-default* branch, and confirms `GET /pos/business-profile` returns that branch — not the tenant default — proving resolution is per-register, not per-tenant.
- Unassigns the register; confirms it falls back to the default again.
- Confirms both delete guards fire over real HTTP: `BRANCH_HAS_REGISTERS` (409) while a register is still assigned, `BRANCH_LAST_REMAINING` (409) when it's the only branch left.
- Confirms a `manager`-role account is rejected (403) from the branch service directly.
- Cleans up its own tenant via cascade delete — confirmed zero leftover `pos-branches-e2e-*` tenants after the run.

This is the one piece of coverage that existed nowhere before this feature — `pos-authenticated-e2e.test.js`, the older checkout/shift test, never touches `/business-profile`, `/pos-branches`, or the register-branch endpoint at all.

## 3. Visual proof — the actual rendered receipt, not just the JSON

The e2e test above proves the *data* resolves correctly per register. It does not prove the *receipt image* comes out right — different address lengths (Pearl's three lines vs. Lusail's one), optional fields present for one branch and absent for the other, and correct dynamic canvas height are a rendering concern, not a data concern.

Rendered both through the real `PosReceiptRenderer`, through QZ's exact 1-bit luma threshold (`quantization: 'luma'` — the same hard black/white cutoff the physical printer applies, not a soft preview), side by side, same base sale, two different branch profiles:

**The Pearl** — full profile: 3-line address, phone, CR number, return policy.
**Lusail** — partial profile: 1-line address, phone, no CR number, no return policy.

Confirmed in the output:
- Correct address, phone on each — no cross-contamination between branches.
- CR number line and return-policy line print for Pearl and are **cleanly absent** for Lusail — no blank gap, no stray label.
- Canvas height is different per receipt (844px vs 762px) — proving the renderer's dynamic sizing responds correctly to how much a given branch's profile actually has to print, not a fixed template with empty fields.

Image: `branches-receipt-proof.png` (sent separately — see below).

## 4. What this does **not** prove — needs a human with real hardware

Everything above is real code exercised against a real server and a real renderer. None of it touches an actual thermal printer, an actual QZ Tray install, or actual production data. These need someone physically present:

- [ ] **Two physical prints, one per shop's register**, each showing that shop's own correct address/phone/CR/policy on paper — not a screen render.
- [ ] **QR still scans** on both prints (module size and centering were fixed earlier this session, but only tested via the renderer, not a fresh physical print of a *branch-resolved* receipt specifically).
- [ ] **Production migration confirmed applied.** `027_pos_branches.sql` self-applies on next server boot (see `docs/DEPLOYMENT.md`), but that boot hasn't happened yet on production as of this writing — confirm via `SELECT * FROM pos_branches;` after the next deploy.
- [ ] **Real branch data entered on production**, not dev. The Pearl's real address was entered and verified during this session, but on the **development** database. Confirm the same data exists on production `pos_branches` after deploy.
- [ ] **Every production register assigned to its correct branch** — Settings → Devices & Security → Branch column, per register, confirmed against a real receipt from that exact register (see `docs/pos-hardware-runbook.md`'s updated checklist item, and `docs/12-pos-system.md` §13.2 for why an unassigned register fails silently rather than loudly).

## 5. Sign-off

| Check | Status | Evidence |
|---|---|---|
| Server test suite | ✅ | 41/41, this file's §1 |
| Admin build | ✅ | clean, this file's §1 |
| Branch CRUD + guards, real HTTP | ✅ | `pos-branches-e2e.test.js`, this file's §2 |
| Per-register resolution, real HTTP | ✅ | same test, this file's §2 |
| Rendered receipt correctness, real renderer + real threshold | ✅ | this file's §3, `branches-receipt-proof.png` |
| Physical print, both shops | ⬜ | needs hardware — §4 |
| Production migration applied | ⬜ | needs next deploy — §4 |
| Production branch data entered | ⬜ | needs owner action — §4 |
| Production register assignment | ⬜ | needs owner/installer action — §4 |

Everything checkable from this session is checked. What's left is exactly the boundary between "the software is correct" and "the software has been correctly operated on real hardware with real data" — and that boundary can't be closed from here.
