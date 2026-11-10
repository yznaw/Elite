# 19 — Full Test Plan (Pre-Pilot Verification)

Consolidates every unverified test gate from [16-launch-roadmap.md](16-launch-roadmap.md)'s
Phases 0.5, 1, 3, 4, 5, 6, 7, and 9 into one sequential, actionable checklist.
Everything listed here is **built and pushed to `Elite-POS`**, but has not
had a real human/hardware/production check yet. Nothing in this document
requires more code — it's execution, not development.

**How to use this doc:** work through the sections in order. Each has a
setup step, the actual checks, and a pass/fail line to fill in. Don't skip
ahead — later sections assume earlier ones passed (e.g. you can't verify
Z-report printing before the printer fixes are confirmed).

---

## 0. Before you start

### 0.1 Deploy everything

```bash
ssh root@vmi3327182
cd /var/www/elite
git pull origin Elite-POS
cd server && npm install
cd ../client && npm install && npm run build:admin && npm run build:web
cd ..
pm2 restart elite-api
pm2 logs elite-api --lines 50
```

Confirm in the log tail:
- [ ] `Elite API running at http://localhost:3000/api`
- [ ] `[inventory-consistency] Scheduler started`
- [ ] No `Tenant bootstrap failed` line
- [ ] No fatal startup errors

### 0.2 Confirm the migration ran

```bash
cd /var/www/elite/server
psql "$DATABASE_URL" -c "\dt" | grep -E "pos_cash_movements|pos_card_reconciliation|pos_inventory_baselines"
```
- [ ] All three tables exist.

### 0.3 Set a working Manager PIN (blocks everything else if skipped)

Every action below that needs "manager approval" requires **two different
accounts** — one cannot approve their own action with their own PIN (this
is intentional, see docs/17's 2026-07-20 retest). Before anything else:

1. Log in as Owner. Settings → Team → invite a second account as **Manager**
   or **Admin**. Accept the invite, set a password.
2. Log in as that second account.
   - If it's an **Owner/Admin** account: Settings → General → Manager PIN → set a PIN.
   - If it's a **Manager** account: sidebar → **My Manager PIN** → set a PIN.
3. Log back in as Owner (or whoever is doing the testing) for the rest of this plan.
4. **Use the second account's PIN**, never the acting user's own, for every "Manager PIN" prompt below.

- [ ] Second account created and PIN set successfully.

---

## 1. Receipt printing (Phase 0.5)

**Setup:** on the real register, in the browser, confirm Settings → Hardware
(or the POS "Hardware" button) has the correct printer selected — if it was
wiped by a browser data clear, open the Hardware dialog and use **Scan** to
rediscover it.

### 1.1 Text legibility
1. Ring up a real sale including a product name/variant that previously
   printed garbled (e.g. anything with "Net Cream" or similar in the name),
   using the real logged-in cashier's actual name.
2. Print the receipt.

- [ ] Every character is fully formed — no missing letter strokes anywhere on the receipt.
- [ ] Cashier name prints correctly, no dropped letters.

### 1.2 QR code — print 5 in a row (cutter timing can be intermittent)
Ring up and print **5 separate small sales** back to back.

- [ ] QR code #1 fully intact, not clipped top/bottom/left/right.
- [ ] QR code #2 fully intact.
- [ ] QR code #3 fully intact.
- [ ] QR code #4 fully intact.
- [ ] QR code #5 fully intact.

### 1.3 QR scannability
- [ ] Scan the QR with a phone camera — it reads correctly.
- [ ] If a dedicated barcode/QR scanner is available at the till, scan with that too — it reads correctly.

### 1.4 Reprint from lookup panel
1. POS → Returns/voids → look up any past receipt number.
2. Click **Reprint receipt**.

- [ ] Receipt prints again, correctly.

### 1.5 Remote register enrollment (only relevant if setting up a second register/location)
1. Settings → POS Registers → enter a name → **Generate setup code**.
2. On a **different** device/browser, use that code on the enrollment screen within 15 minutes.

- [ ] Second device enrolls successfully using the remotely-generated code.
- [ ] *(Skip this whole item if only one register is in use right now — note it as "not applicable yet" rather than fail.)*

**Section 1 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 2. Inventory ledger (Phase 1)

**Setup:** note the current stock count of a test product in Catalog before starting.

1. Ring up a sale of 1 unit of the test product.
2. Void that sale (needs the second account's Manager PIN).
3. Ring up another sale of 2 units of the test product.
4. Partially refund 1 unit of it (needs Manager PIN).

### 2.1 Database check
```bash
psql "$DATABASE_URL" -c "SELECT reason, delta, created_by_user_id, created_at FROM inventory_movements ORDER BY created_at DESC LIMIT 10;"
```
- [ ] A `pos_sale` row exists for each sale, with a negative delta matching the quantity sold.
- [ ] A `pos_void` row exists for the void, with a positive delta matching the voided quantity.
- [ ] A `pos_refund` row exists for the refund, with a positive delta matching the refunded quantity.

### 2.2 Stock count matches
- [ ] The product's displayed stock count in Catalog matches: `original stock - sale2's net quantity (2 - 1 refunded = 1 unit sold)`. The voided sale should have fully restored its stock, net zero effect.

### 2.3 Drift job (passive — just watch the logs)
```bash
pm2 logs elite-api --lines 200 | grep inventory-consistency
```
- [ ] No `stock drift` warning appears for the test product (would indicate a real bug if it did).
- [ ] Over the next 24 hours, confirm the hourly job keeps running with no drift warnings for any product.

**Section 2 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 3. Cash movements & Z-reports (Phase 3)

**Setup:** open a shift with a real opening float (e.g. QAR 500).

### 3.1 Cash movements
1. Cash movement → **Paid in**, QAR 50, reason "test top-up" — confirm it does **not** ask for a PIN.
2. Cash movement → **Paid out**, QAR 30, reason "test petty cash" — confirm it **does** ask for a PIN, use the second account's.
3. Cash movement → **No-sale drawer open** — confirm the drawer physically pulses open, and it required a PIN.

- [ ] Paid-in recorded without a PIN prompt.
- [ ] Paid-out recorded, required PIN, appears correctly in the shift's cash movement list with a proper label (not a raw enum like `paid_out` or `No Sale_drawer_open`).
- [ ] No-sale drawer open physically opened the drawer and required a PIN.
- [ ] Shift summary's "Cash in" / "Cash out" figures reflect exactly what was entered.

### 3.2 Shift close / Z-report
1. Note the shift summary's "Expected cash" figure.
2. Physically count the actual cash in the drawer.
3. Enter that counted amount and close the shift (Manager PIN required).

- [ ] Z-report generates successfully.
- [ ] Variance shown matches (counted cash − expected cash) exactly.
- [ ] **Z-report prints on paper** (first time this has ever happened on real hardware) — confirm it's legible and complete (all totals, no cut-off text).

### 3.3 Z-report history
1. Sidebar/POS → Z-report history (or the reports page's Z-report tab).
2. Find the Z-report just created.

- [ ] **Reprint** produces an identical printed report.
- [ ] **Export CSV** downloads a file; open it in Excel/Sheets — columns and numbers are all present and correct, no mangled text.

**Section 3 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 4. Card settlement reconciliation (Phase 4)

**Setup:** need one real business day with at least one real card sale, and that day's actual bank/acquirer settlement statement.

1. Admin → Reconciliation.
2. Select the register and business date, click **Check POS total** — note the figure.
3. Enter the real settlement total from the bank statement, submit.

- [ ] If within QAR 1.00 of the POS total: status shows **Matched** automatically.
- [ ] If more than QAR 1.00 off: status shows **Exception**.
- [ ] For an exception, attempting to mark it resolved **without** a note is rejected.
- [ ] Adding a note and resolving succeeds; status becomes **Resolved** and the note is saved/visible.
- [ ] The POS total shown matches what you'd calculate by hand from that day's real card transactions (sales minus refunds).

**Section 4 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 5. Core reporting (Phase 5)

**Setup:** use a business day that already has real sales, at least one void/refund, and at least one cash movement (from the sections above).

Admin → Reports. For **each** of the six tabs, set the date range to that business day and check:

### 5.1 Daily Sales
- [ ] Total matches what you'd expect by hand for that day.
- [ ] By-payment-method split (cash vs card) looks right.
- [ ] By-cashier breakdown shows the correct cashier(s).
- [ ] By-item breakdown includes the products actually sold that day.

### 5.2 Cash Movements
- [ ] Shows the paid-in/paid-out/drawer-open entries from Section 3.
- [ ] Shift-close variance row matches the Z-report from Section 3.

### 5.3 Card Settlement
- [ ] Shows the reconciliation entry created in Section 4, with the correct status.

### 5.4 Inventory
- [ ] `pos_sale`/`pos_void`/`pos_refund` all appear in the by-reason breakdown with sensible net deltas.
- [ ] No unexpected drift alerts (unless Section 2 intentionally caused one).

### 5.5 Refunds & Voids
- [ ] The void and refund from Section 2 both appear, with the correct manager name attached to each.

### 5.6 Z-Reports
- [ ] The Z-report from Section 3 appears in this list too (same data source, cross-check for consistency).

### 5.7 CSV export
- [ ] Export CSV from at least 2 of the six tabs — both open cleanly in Excel/Sheets, correct encoding, no mangled Arabic text if any cashier/product names are in Arabic.

**Section 5 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 6. Angular 22 upgrade regression check (Phase 6)

No new features here — just confirm nothing broke across the whole app after the framework jump.

### 6.1 Storefront (client-facing site)
- [ ] Browse products, view a product detail page.
- [ ] Add to cart, adjust quantity, remove an item.
- [ ] Complete a full checkout (test order).

### 6.2 Admin portal
- [ ] Catalog: open a product, edit and save a field.
- [ ] Orders: open an order, view its detail.
- [ ] Settings: General, Team, Manager PIN, POS Registers, Reconciliation, Reports — each tab/page loads without errors.
- [ ] Dashboard loads without the zero-KPI flash (confirm the loading spinner shows, then real numbers — no flicker of zeros first).

### 6.3 POS
- [ ] Cashier login → shift open → ring up a sale → payment → receipt.
- [ ] Void and refund flows both still work (already covered in Section 2, just confirm no visual/console errors while doing it).

**Section 6 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 7. PWA / offline resilience (Phase 7)

### 7.1 Installability
1. Visit `https://admin.elitecollections.qa` in Chrome or Edge.
- [ ] The browser shows an install icon in the address bar, or "Install Elite Collection Admin Portal" appears in the browser menu.
- [ ] Installing it works; the app opens in its own window.

### 7.2 Cold offline launch
1. With the app installed, fully close the browser/app.
2. Disconnect the register from the network entirely.
3. Reopen the installed app.
- [ ] The POS shell loads (may show offline-mode indicators) rather than a blank/error page.

### 7.3 API-down-but-network-up recovery
1. While online, start ringing up a sale.
2. Block the API specifically (e.g. temporarily point `/etc/hosts` at a bad IP for the API domain, or disable the API process briefly) while leaving general internet/LAN up.
3. Attempt a sale — it should queue offline.
4. Restore API access.
- [ ] Without touching the browser's online/offline state manually, the queued sale syncs automatically within ~30 seconds (the health-check poll interval) once the API is reachable again.
- [ ] The POS status strip showed "server unreachable" during the outage, not just a generic offline message.

### 7.4 Real network-cable test
1. Unplug the register's actual network cable mid-shift.
2. Ring up 2 real sales while disconnected.
3. Confirm they show as queued/pending in the POS.
4. Plug the cable back in.
- [ ] Both sales sync successfully.
- [ ] No duplicate transactions appear on the server for either sale.
- [ ] The receipt-number sequence has no gaps or collisions across the two synced sales and any sales made before/after.

**Section 7 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 8. Backup & restore drill (Phase 9)

**Setup:** requires SSH access to the VPS. Do this on a copy/drill database, never the live one.

### 8.1 Install
Follow `docs/18-backup-restore-runbook.md` §2 exactly (install GPG, generate
and safely store the passphrase, create `/var/backups/elite-postgres`,
create `/etc/elite-backup.env`, install the cron job).

- [ ] Manual first run of `scripts/backup-database.sh` succeeds; a `.dump.gpg` file appears in `BACKUP_DIR`.

### 8.2 Restore drill
Follow `docs/18-backup-restore-runbook.md` §3 exactly (create a disposable
`elite_restore_drill` database, run `scripts/restore-database.sh` against
it, never the live `elite` database).

- [ ] Restore completes without errors.
- [ ] Row counts match between `elite` and `elite_restore_drill` for `tenants`, `admin_users`, `products`, `pos_transactions`, `orders`.
- [ ] Spot-check one real recent order/transaction — details match exactly between the live and restored databases.
- [ ] Log this drill in `docs/18-backup-restore-runbook.md` §5's drill log table (date, who ran it, result).
- [ ] Clean up: `DROP DATABASE elite_restore_drill;`

### 8.3 Failure alert test
1. Temporarily break the backup job (wrong `DATABASE_URL` port/password in `/etc/elite-backup.env`, or stop Postgres briefly).
2. Run the backup script manually.
3. Restore the correct config.

- [ ] The script fails as expected and does not create a backup file.
- [ ] A failure email actually arrives at `BACKUP_ALERT_EMAIL` (not just a log line — check the real inbox).

**Section 8 result:** ☐ Pass ☐ Fail — notes: _______________

---

## 9. Sign-off

| Section | Result | Date | Tested by |
|---|---|---|---|
| 1. Receipt printing | | | |
| 2. Inventory ledger | | | |
| 3. Cash movements & Z-reports | | | |
| 4. Card settlement reconciliation | | | |
| 5. Core reporting | | | |
| 6. Angular upgrade regression | | | |
| 7. PWA / offline resilience | | | |
| 8. Backup & restore drill | | | |

**All sections must pass before Phase 10 (pilot) begins.** If any section
fails, note the failure in this document (or a linked issue), fix it, and
re-run just that section before moving on — no need to re-run sections
that already passed, unless the fix could plausibly have affected them.
