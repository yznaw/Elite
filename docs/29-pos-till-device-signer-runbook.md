# 29 — POS Till: Offline Device Signer Install (field runbook)

Self-contained. Whoever does this does not need any other document or prior
context — every command and every value you need is either below or has an
exact instruction for where to get it.

**Who this is for:** whoever has hands-on access to the physical POS till
(the Windows register machine), plus root SSH access to the production
server for one step. Two people can split this: one on the server, one at
the till.

**What this fixes:** right now, if the till loses internet or the Elite API
server is unreachable, the register **cannot print receipts at all** — every
print/drawer command has to be cryptographically signed, and normally the
server does that signing. This installs a small local service on the till
itself that can sign those commands instead, so printing keeps working
through a network outage. It is scoped to exactly this: it does not process
payments, does not need internet once installed, and never exposes the
private key it uses — only proof that it possesses it.

**Time:** about 20–30 minutes, plus the final offline test.

---

## Before you start

- [ ] Node.js is already confirmed installed on the till (v24 — confirmed 2026-08-02). Verify again if this is a different till: open PowerShell and run `node --version`. Anything ≥ 20 works.
- [ ] You have Administrator rights on the till's Windows account.
- [ ] You have `root` SSH access to the production server (`vmi3327182.contaboserver.net`), or someone who does is available to hand you two files (see Step 1).
- [ ] The till can currently reach the Elite admin site normally (`https://admin.elitecollections.qa`) — confirm this *before* you start, so that if something looks wrong later you know it's this install and not a pre-existing network problem.

**Security rule for this whole procedure:** the two files in Step 1 are
cryptographic key material. Move them by direct transfer only — USB drive or
`scp` directly between the two machines. **Never** paste their contents into
chat, email, or a ticket, and never upload them anywhere other than the
till's own disk.

---

## Step 1 — Copy the certificate and private key to the till

Two files live on the server at `/var/lib/elite-pos/qz/`. Both are required —
the install script in Step 5 will refuse to run without both.

**Option A — `scp` directly from the till** (if the till has SSH access to the server):

```powershell
scp root@vmi3327182.contaboserver.net:/var/lib/elite-pos/qz/private-key.pem C:\ProgramData\ElitePOS\qz\private-key.pem
scp root@vmi3327182.contaboserver.net:/var/lib/elite-pos/qz/digital-certificate.txt C:\ProgramData\ElitePOS\qz\digital-certificate.txt
```

If `C:\ProgramData\ElitePOS\qz\` doesn't exist yet, create it first:

```powershell
New-Item -ItemType Directory -Force -Path 'C:\ProgramData\ElitePOS\qz'
```

**Option B — USB drive**, if the till has no direct path to the server: someone
with server access copies both files to a USB drive, walks it to the till,
and copies them into the same `C:\ProgramData\ElitePOS\qz\` folder above.

**Checkpoint:** confirm both files landed and are non-empty:

```powershell
Get-Item 'C:\ProgramData\ElitePOS\qz\private-key.pem', 'C:\ProgramData\ElitePOS\qz\digital-certificate.txt' | Select Name, Length
```

Both should show a non-zero size. Stop and re-copy if either is 0 bytes or
missing.

---

## Step 2 — Lock down the private key's permissions

Restrict it to the current Windows account and Administrators only — nobody
else logged into this machine should be able to read it.

```powershell
icacls 'C:\ProgramData\ElitePOS\qz\private-key.pem' /inheritance:r /grant:r "$env:USERNAME:(R)" /grant:r 'Administrators:(F)'
```

Expected output ends with `Successfully processed 1 files`.

---

## Step 3 — Copy the signer program itself to the till

This is a small folder from the Elite codebase: `tools/pos-device-signer/`.
It has **no external dependencies** — it only uses Node's built-in modules,
so you do not need to run `npm install` and you do not need internet access
on the till for this step.

Copy the whole `tools/pos-device-signer/` folder to the till, by USB or `scp`,
to any convenient location (e.g. `C:\ElitePOS-setup\pos-device-signer\` — this
is a staging location only, the installer in Step 5 copies it to its real
permanent home automatically).

**Checkpoint:** the folder should contain at least these three files:

```
index.js
package.json
install-windows-startup.ps1
```

---

## Step 4 — Optional dry run before installing as a permanent service

Skippable, but recommended the first time: catches a bad file path or a
typo before it's wired into Windows startup.

Open PowerShell **in** the folder from Step 3, and run:

```powershell
$env:ELITE_POS_QZ_CERT_PATH = 'C:\ProgramData\ElitePOS\qz\digital-certificate.txt'
$env:ELITE_POS_QZ_KEY_PATH = 'C:\ProgramData\ElitePOS\qz\private-key.pem'
$env:ELITE_POS_ALLOWED_ORIGINS = 'https://admin.elitecollections.qa'
node index.js
```

Leave that window running, and in a **second** PowerShell window:

```powershell
curl http://127.0.0.1:8182/health
```

Expected response: `ok`. If you get that, close the first window (`Ctrl+C`)
and move to Step 5. If you don't get `ok`, see Troubleshooting below —
resolve it before proceeding.

---

## Step 5 — Install it as a permanent Windows startup service

Open an **elevated** PowerShell (right-click → "Run as Administrator") in the
`pos-device-signer` folder from Step 3, and run:

```powershell
.\install-windows-startup.ps1 `
  -CertificatePath 'C:\ProgramData\ElitePOS\qz\digital-certificate.txt' `
  -PrivateKeyPath 'C:\ProgramData\ElitePOS\qz\private-key.pem' `
  -AllowedOrigins 'https://admin.elitecollections.qa'
```

This copies the signer to its permanent home
(`C:\ProgramData\ElitePOS\device-signer`), registers a limited startup task
under the current Windows user, sets it to restart automatically one minute
after any failure, starts it immediately, and checks `/health` itself as
part of the install. Watch for errors in the output — it should finish
without any red text.

**Checkpoint:**

```powershell
curl http://127.0.0.1:8182/health
```

Expected: `ok`.

---

## Step 6 — Point Elite's own Hardware settings at the signer

Installing the signer is not enough by itself — the Elite POS screen in the
browser also has to be told to use it. This is a one-time setting **inside
the Elite app**, not on the command line:

1. On the till, open the Elite POS screen (the same browser profile the
   register normally uses) and sign in.
2. Open **Hardware** (in the selling screen).
3. Find the **device signer URL** field and enter exactly:
   ```
   http://127.0.0.1:8182
   ```
4. Save.
5. Confirm the hardware indicator on that page shows a successful
   connection.

This setting lives in that browser profile's local storage — if the browser
profile is ever reset, reimaged, or migrated to a new machine, this step (and
the printer queue name next to it) has to be redone.

---

## Step 7 — Restart and reconfirm (proves it survives a reboot)

The whole point is that this keeps working automatically, including after
the till itself restarts — for example after a Windows update.

1. Restart the till.
2. Once it's back up, **without opening a terminal**, open the Elite POS
   screen and confirm the hardware indicator still shows connected. Or, if
   you do want to check manually:
   ```powershell
   curl http://127.0.0.1:8182/health
   ```
   Expected: `ok`, with no manual steps needed to get there.

---

## Step 8 — The real test: print while actually offline

**Do not skip this.** `/health` responding only proves the signer service is
running — it does not prove offline signing actually works end-to-end
through a real print. This is the step that actually validates the fix.

1. Disconnect the till's Wi-Fi (or unplug its ethernet cable) so it has no
   path to the Elite server at all.
2. Ring up any test sale (or use whatever test-sale process the shop
   normally uses) and print the receipt.
3. **Confirm the receipt actually prints.**
4. Reconnect the network.

If it prints while offline: this task is done. If it does not: see
Troubleshooting, and do not consider this task complete until a real offline
print succeeds.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `curl` to `/health` gets no response / connection refused | Service isn't running | Open Task Scheduler, look for "Elite POS Device Signer", check its last run result. Re-run Step 5. |
| Install script errors "Required file does not exist" | Cert or key path is wrong, or Step 1 didn't actually finish | Re-check both files exist at the exact paths with `Get-Item` from Step 1's checkpoint. |
| `icacls` in Step 2 says access denied | PowerShell wasn't elevated | Close and reopen PowerShell as Administrator. |
| Printer still shows an "Action Required" popup on every print | This is a separate, one-time QZ Tray trust step, not the signer | Not covered by this runbook — see `docs/pos-hardware-runbook.md` §9 ("Trust the signing certificate"). |
| Offline print (Step 8) fails even though `/health` says `ok` | Step 6 (pointing Elite's Hardware settings at the signer URL) was likely skipped or has a typo | Re-check the exact URL in Elite's Hardware page matches `http://127.0.0.1:8182` exactly. |
| Signer worked yesterday, fails today, nothing changed | The QZ signing certificate may have expired | Check its validity: `openssl x509 -in 'C:\ProgramData\ElitePOS\qz\digital-certificate.txt' -noout -dates`. If expired, this needs a new certificate issued from the server side — that's outside this runbook, escalate to whoever manages the server. |

Diagnostic logs, if you need to dig deeper or report back a real failure:

```
C:\ProgramData\ElitePOS\device-signer\logs\signer.log
```

(Rotates automatically at 5MB, keeps 5 previous files. Never contains keys or
signing payloads — safe to share for troubleshooting.)

---

## When you're done — report back

Reply to whoever asked for this with:

- [ ] Which till/register this was done on (name it exactly as it appears in Elite's register list).
- [ ] Confirmation Step 8 (real offline print) passed.
- [ ] The certificate's expiry date (from the Troubleshooting table's `openssl` command, or ask whoever provisioned it) — this needs a calendar reminder set well before it lapses, since printing will silently start failing once it does, with no other symptom.
- [ ] Anything from the Troubleshooting table you had to use.

---

*Source material: `tools/pos-device-signer/README.md`, `docs/pos-hardware-runbook.md` §10–12, and `docs/27-server-ops-followups.md` item 6. If those and this file ever disagree, this file is the one written for someone doing the install cold — but flag the mismatch so the others get fixed too.*
