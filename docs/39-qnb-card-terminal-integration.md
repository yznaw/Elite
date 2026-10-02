# QNB Card Terminal Integration (ECR)

## Status (2026-10-01)

| Phase | State |
|---|---|
| 1. Elite Card Bridge (`tools/elite-card-bridge`): core, simulator, journal, HTTP API, real QNB adapter, installer | ✅ Built. Compiles against the delivered DLL 5.0.0.13; 35 bridge tests pass (`dotnet test tests/EliteCardBridge.Tests`). |
| 2. Server: migration 047, `card-terminal-service.js`, sale/void/refund/Z changes, routes | ✅ Built. `server/test/pos-card-terminal-e2e.test.js` plus all existing POS tests pass. |
| 3. POS payment sheet, recovery, Settings card-terminal panel | ✅ Built and walked through in the browser against the simulator: decline → try again → approved sale (`qnb-ecr` payment, linked attempt), void through the terminal (linked, original UTN). |
| 4. Card slip printing, Z close with CloseBatch, reconciliation tab | 🟡 Slip rendering + printing and Z CloseBatch built (not yet printed on a real Bixolon). Admin reconciliation tab not built; the API (`GET /api/admin/pos-reconciliation/card-attempts`) is ready. |
| Automated browser tests (Playwright, bridge mocked) | ⬜ Not written yet |
| 5. Real terminal (QNB test terminal + cards, ~1 week from 2026-09-30) | ⬜ Waiting on QNB |
| 6-7. QNB test cases, pilot, rollout | ⬜ |

Deviations from the original plan, found while building:

- **No cancel from the till.** DLL 5.0.0.13 has no `SendBreakCommand` (it exists only in the 6.x DLL for the U2000). The cashier cancels with the terminal's red key; `POST /v1/jobs/:id/cancel` answers `409 CANCEL_ON_TERMINAL` so the UI can say so.
- **Admin token for bridge admin operations deferred.** The bridge key (entered once by an owner) plus role checks in the POS UI gate Initialize/Restart/port change. None of these move money.
- **Bridge program folder** is `%ProgramFiles(x86)%\ElitePOS\CardBridge` (read-only for the cashier account except the DLL's `Logs\`), data in `%ProgramData%\ElitePOS\card-bridge`.
- **Refund `originalAmount`** is sent as `"550.00"`; DLL 5.0.0.13's note implies it converts to the 12-digit field. To confirm in the Teams call (`Formatting.Amount12` is ready if not).
- **Status-only approvals.** If a payment is approved but the details were lost (only `TransactionStatus` = approved, no auth code), the till voids it on the terminal and charges again rather than recording a sale without an approval code.


## Context

Today a card sale is "manual": the cashier types the amount into the QNB terminal, then types the approval code into the POS (`terminalReference`, `provider='pos-manual'`). docs/15 assumed the terminal was standalone forever. QNB has now offered ECR semi-integration and sent the DLL package (`Ideal.PointOfSale.Integration.dll` v5.0.0.13, test app `Ideal.PointOfSale.Integration.Form.exe`, low-level spec v2.13).

Facts that shape the design:
- DLL is **.NET Framework (4.5+, test app targets 4.8), Windows only**. The POS runs in a browser, so a local Windows process must host the DLL.
- Link is **RS-232 only** (QNB cable, USB-to-Serial adapter if needed). N910: 9600 baud, 7 data bits, Even parity, 1 stop bit.
- DLL calls are **blocking**; DLL global timeout 120 s; intermediate screen messages and receipt text arrive via callbacks.
- Terminal paper printing will be **disabled**: the ECR (our Bixolon via QZ) prints the card slip; merchant copy must be stored digitally.
- Mandatory functions: HostLogOn/Off, Sale, EnhanceRefund, CloseBatch, Summary/Audit report, Reprint last / by invoice, Initialize, Void, TransactionStatus, Restart, ReturnTerminalSettings.
- QCB rule: NAPS refunds within 15 days must be **card-present** (blank PAN/expiry).
- `uniqueTransactionNumber` (UTN): AN up to 22 + 1 rightmost retry digit; must be unique across the whole deployment.
- v5.0.0.12+: transaction refused with `ERROR_LOG_FILE_NOT_CREATED` if the DLL cannot write its log.
- v5.0.0.13: refund original amount must be 12-digit numeric (`000000055000`).
- Dev must use a QNB **test terminal** (arriving in about 1 week); then bank test cases, pilot, rollout.

Update from QNB (guide v1.29 received)
- QNB supplies a **docking station + direct serial cable** per terminal; USB-to-Serial adapter allowed.
- Receipt: terminal sends a **pre-formatted** receipt; QNB says pass it straight to the printer. We still map the few control bytes (0x1E/0x11/0x12/0x0C/0x22/0x23) to Bixolon ESC/POS, since the Bixolon does not understand them natively. To confirm in the Teams call.
- v1.29 adds `Sale(amount, utn, emailAddress, out tagbuffer)` for a digital receipt by email (optional; use the POS customer's email when present, otherwise the plain overload), error codes `ERROR_TIME_TO_RESTART_TERMINAL = 27` and `ERROR_LOG_FILE_NOT_CREATED = 101`, and moves Branding + NAPS refund mandate to Appendix E.
- Compatibility table: N910 line uses DLL 5.0.0.x (6.x is for the U2000), so the delivered 5.0.0.13 is the right DLL.
- Teams call: Sunday 4 Oct 2026, 10:30-11:30.

Decisions (owner, 2026-10-01)
- **Some branches have 2+ tills.** One terminal is cabled to one PC, so `card_mode` is per register: the till with the terminal is `integrated`, the others stay `manual` (today's flow) until QNB supplies more terminals. Ask QNB about an extra terminal per extra till.
- **Manual fallback allowed without manager PIN** when the terminal/bridge is down; every manual card sale on an integrated till is flagged (`manual_override`), audited and listed in reconciliation.
- **Refunds always card-present** (customer presents card on the terminal). No card-not-present path is built.

Outcome: the cashier presses one button, the amount goes to the terminal, the result comes back and completes the sale with no typing. No double charge and no lost approval in any crash or network case, and PCI scope stays on the terminal.

---

## 1. Architecture

```
Angular POS (browser, https://admin.elitecollections.qa/pos)
   │  fetch http://127.0.0.1:8183  (CORS allowlist + bridge key)
   ▼
Elite Card Bridge  (C# .NET Framework 4.8, Windows startup task, per till)
   │  ITerminal ── RealTerminal (Ideal DLL)  |  SimulatedTerminal (dev/test)
   ▼  RS-232 COMx 9600 7E1
QNB Newland N910  ──4G──▶  QNB host

Browser ──HTTPS──▶ Elite API (Express/Postgres): card attempts, sales, refunds, Z, audit
```

Principles
- **Terminal first, server second.** Money moves on the terminal; Elite records the fact. Every step is idempotent on the UTN.
- **Three durable copies of each outcome**: bridge journal (disk), browser IndexedDB, server `pos_card_attempts`. Any one surviving is enough to recover.
- **Bridge is dumb about business rules.** Amount, register, shift, sale linkage and permissions are enforced by the browser and the server. The bridge only drives the terminal and journals results.
- Same deployment pattern as the existing `tools/pos-device-signer` (loopback service, origin allowlist, Windows scheduled-task installer, rotating JSON logs).

---

## 2. Middleware – Elite Card Bridge (`tools/elite-card-bridge/`)

Tech: C# .NET Framework 4.8 console app, `HttpListener` on `http://127.0.0.1:8183` (no external deps beyond the Ideal DLL set). Installed under `C:\ProgramData\ElitePOS\card-bridge`, started by a scheduled task (copy of `tools/pos-device-signer/install-windows-startup.ps1`, adapted).

Structure
- `ITerminal`: Connect, Logon, Logoff, Sale, Void, EnhanceRefund, Status, CloseBatch, SummaryReport, AuditReport, ReprintLast, ReprintInvoice, Initialize, Restart, Settings, Break. Events: `Message(title, l1..l4)`, `Receipt(text)`.
- `RealTerminal`: wraps `EcrPointOfSale(port, 9600, Even, 7, One)`; keeps the connection open; reconnects on `ERROR_PORT_CONNECTION`; ensures the DLL log folder exists and is writable before every call.
- `SimulatedTerminal`: scripted outcomes (approve, decline 051/055, cancel, card timeout, PIN timeout, TNL, port lost mid-txn, approved-then-disconnect, will-reverse, out of paper, slow host). Selected with `ELITE_CARD_TERMINAL=simulator`; scenario via `POST /v1/sim/next` (refused unless simulator mode).
- `JobRunner`: a single worker (the terminal is single-tasking). One active job; a second request returns `409 TERMINAL_BUSY`.
- `Journal`: append-only JSON lines `journal.log` keyed by UTN (request, messages, final tag buffer subset, receipt text, error code). Written **before** the call (state `sent`) and after it (state `done`). Rotated at 5 MiB, keep 10.
- `Formatting`: cents → DLL amount string; 12-digit original amount for refunds; DDMMYY dates; UTN validation `^[A-Z0-9]{8,22}[0-9]$`.
- `ErrorMap`: DLL error code + host response code → stable `code` + plain-English message (table from guide Appendix A/B).

HTTP API (JSON, all under `/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | bridge version, DLL version, mode (real/sim), COM port, connected, loggedOn, busy |
| GET | `/ports` | available COM ports (for setup) |
| PUT | `/config` | set COM port (admin, needs bridge key) |
| POST | `/jobs` | start `{type: sale|void|refund|logon|logoff|closeBatch|summary|audit|reprintLast|reprintInvoice|initialize|restart|settings, utn?, amountCents?, original?:{seq,date,auth,amountCents}, cardPresent?}` → `202 {jobId}` |
| GET | `/jobs/{id}` | `{state: queued|running|done, message:{title,lines}, result?}` (POS polls every 400 ms) |
| POST | `/jobs/{id}/cancel` | `SendBreakCommand` (only works on card-entry screen) |
| GET | `/transactions/{utn}` | journal lookup first; else `TransactionStatus(utn)` → `approved|will_reverse|not_found|unknown` |

Result shape (never contains full PAN):
`{outcome: approved|declined|cancelled|error|unknown, code, message, hostResponseCode, authCode, maskedPan(first6+XXXXXX+last4), expiry(MMYY), issuer, tid, mid, seqNo, invoiceNo, hostTrace, txnDate, txnTime, entryMethod, pinVerified, receiptText}`

Behaviour rules
- Sale with `ERROR_TNL` → auto HostLogOn once, then retry the same UTN with retry digit +1.
- `ERROR_DLL_TIME_OUT`, port lost, or exception mid-sale → outcome `unknown`; never `declined`. The POS must resolve via `/transactions/{utn}`.
- DLL v5.0.0.10 semantics: after MSG-13 sent, a disconnect returns 0 = approved.

---

## 3. Backend (Express + Postgres)

Migration `047_pos_card_terminal.sql` (use the `elite-migration` skill)
- `pos_card_attempts`: `id, tenant_id, register_id, shift_id, utn (unique per tenant), kind (sale|void|refund), amount_cents, status (pending|approved|declined|cancelled|unknown|reversed|voided), error_code, host_response_code, auth_code, masked_pan, card_expiry, issuer, tid, mid, seq_no, invoice_no, host_trace, txn_at, entry_method, pin_verified, receipt_text, original_attempt_id, pos_transaction_id, pos_refund_id, created_by, created_at, updated_at`.
  - CHECK `masked_pan ~ '^[0-9]{6}X{2,9}[0-9]{4}$'` (DB-level guard against storing a real PAN).
  - Unique: one approved sale attempt links to at most one `pos_transaction_id`.
- `pos_registers`: `card_mode text NOT NULL DEFAULT 'manual' CHECK (card_mode IN ('manual','integrated'))`, `card_manual_fallback boolean NOT NULL DEFAULT true`.
- `payments`: integrated card sales use `provider='qnb-ecr'`, `provider_payment_id = utn`, `terminal_reference = auth_code`; partial unique index on `(tenant_id, provider_payment_id) WHERE provider='qnb-ecr'`.
- `pos_z_reports`: `card_batch_closed_at`, `card_batch_status`, `card_batch_receipt_text`.
- Extend `pos_transactions_payment_shape_check` only if needed (card shape unchanged).

New service `server/lib/pos/card-terminal-service.js`
- `recordAttempt(context, body)`: upsert by UTN (idempotent). Register and shift come from the session/device cookie (`requireRegister()`), never the body.
- `recordResult(context, utn, result)`: allowed transitions only (`pending → approved|declined|cancelled|unknown`, `unknown → approved|reversed|declined`); redacts anything that is not in the whitelist of fields; validates masked PAN.
- `listUnresolved(context)`: pending/unknown older than 3 min for this register.
- `resolveManually(context, utn, {outcome, note, managerPin})`: manager-only, audited.

Changes to existing code
- `server/lib/pos/sale-service.js`: card payment accepts `payment.cardAttempt` (UTN plus result snapshot). If present: attempt must be approved, `amount_cents == totalCents`, same register, not linked to another sale → insert payment with `provider='qnb-ecr'`. Offline-queued sales carry the snapshot so the attempt row is created on sync. If absent and register is `integrated`, the sale must carry `manualOverride: true` plus the typed reference (no PIN, per owner decision); stored on the payment `raw_payload`, audited as `pos.card.manual_override`, and counted in reconciliation.
- `server/lib/pos/correction-service.js`: `voidTransaction` and `createRefund` accept `cardAttempt` for the terminal void/refund; `terminal_reference` filled from its auth code; existing manual path kept for manual mode.
- `server/lib/pos/shift-service.js`: `closeShift` accepts `cardBatch {status, receiptText}` and stores it on the Z.
- `server/lib/pos/card-reconciliation-service.js`: add an "integrated" view: POS card total vs sum of approved minus voided/refunded attempts per register/business day; settlement import flow unchanged.
- Routes in `server/routes/pos.route.js`: `POST /card-attempts`, `PATCH /card-attempts/:utn`, `GET /card-attempts/unresolved`, `POST /card-attempts/:utn/resolve`; admin read `GET /api/admin/pos-reconciliation/card-attempts` (owner/admin/manager). Register card settings via the existing admin POS security/branch routes.
- Audit events: `pos.card.attempt`, `pos.card.result`, `pos.card.unknown_resolved`, `pos.card.manual_override`, `pos.card.batch_closed`.
- Staff notification (existing `045_staff_notifications`) when an attempt stays `unknown` more than 10 min.

---

## 4. Frontend (Angular admin portal, POS)

New `services/pos-card-terminal.service.ts`
- Talks to the bridge (`fetch`, timeouts, polling), exposes signals: `status`, `message`, `busy`.
- `charge(amountCents, utn)`, `void(utn)`, `refund(...)`, `checkStatus(utn)`, admin ops.
- UTN generator: `E` + 5-char register code + `yyMMddHHmmss` + 2-digit counter + retry digit `0` (22 chars, unique per register per second, and register code makes it deployment-unique).
- Persists every attempt (cart snapshot, amount, UTN, state) to IndexedDB via `pos-local-store.service.ts` **before** calling the bridge.

`pages/pos/pos.component.*` payment sheet, Card tender (integrated mode)

| State | Screen | Actions |
|---|---|---|
| Ready | Large amount, terminal status chip (Connected / Not connected), short hint "Customer pays on the card machine" | **Charge on terminal** (primary, Enter key); "Enter manually" (secondary text link, opens today's reference field; no PIN) |
| Waiting | Mirror of the terminal screen text (e.g. "Insert / tap card", "Enter PIN", "Processing") with a calm progress indicator; amount stays visible | **Cancel** (enabled only while waiting for the card; otherwise disabled with "Can't cancel while the bank is processing") |
| Approved | Check mark, "VISA •••• 0293", auth code | Auto-completes the sale (no extra tap); prints receipt + card slip |
| Declined | Plain reason ("Insufficient funds", "Wrong PIN", "Card expired", "Cancelled on terminal") | **Try again** (new UTN), **Change payment method** |
| Checking | "Connection lost. Checking with the terminal…" auto status check | No retry button until resolved (prevents double charge) |
| Unresolved | Banner on the till: "1 card payment needs checking" | Manager resolves with PIN after checking the terminal's last receipt |

- The sheet cannot be closed while a charge is in flight (Escape/backdrop disabled).
- Bridge down: Card tender shows "Card machine not connected" plus Retry connection and "Enter manually".
- Tills in `manual` mode (extra tills in a branch) keep today's card flow unchanged.
- On POS load and before every new card charge: resolve any pending/unknown attempt from IndexedDB (bridge journal → TransactionStatus → server). An approved-but-unrecorded attempt resumes its stored sale automatically.
- Refund dialog: for card sales shows "Ask the customer to present their card on the terminal" (always card-present: blank PAN/expiry to EnhanceRefund; satisfies the NAPS rule). A refund of a sale paid on another till uses the terminal of the till doing the refund. Same-day + batch open uses **Void** instead (cheaper, no card needed).
- Shift open: automatic HostLogOn (status chip shows result). Shift close / Z: step "Closing card batch…" → CloseBatch → prints batch report → Z continues even if the batch fails (flagged, retry button in Settings).
- Settings → Devices → **Card terminal** panel: mode (manual / integrated), COM port picker (from `/ports`), bridge key, Test connection, Logon, Reprint last, Reprint by invoice, Summary report, Audit report, Terminal info, Initialize, Restart terminal, bridge and DLL version. Owner/admin only for mode and port.
- Receipt: extend `services/pos-receipt-renderer.service.ts` with `renderTerminalSlip(text)`: 40-column text, control bytes 0x1E double width, 0x11 double height, 0x12 inverse, reset after newline, 0x0C copy separator, 0x22 contactless symbol, 0x23 DCC disclaimer; no shop logo on the slip (bank branding rule). Print via the existing `pos-hardware.service.ts` queue (`printRendered`). Customer copy printed; merchant copy stored only.
- Reports/Reconciliation page: new "Card terminal" tab listing attempts with status filter and the unresolved count.
- Keep `services/pos-payment.ts` union unchanged (`card` stays `card`); integration is a property of the card payment, not a new tender.

---

## 5. Security

Card data / PCI
- No PAN, track data, PIN or CVV ever reaches Elite. Masked PAN only (6+4), enforced in the bridge whitelist, the server validator and a DB CHECK.
- Receipt text stored is the terminal's own masked e-receipt.
- DLL log folder (log4net `Logs\`) and the bridge journal readable only by the POS Windows account and admins; retention 90 days.

Bridge
- Binds to `127.0.0.1` only. CORS allowlist of the Elite admin origins (same env var pattern as the device signer) and reply to Chrome Private Network Access preflight (`Access-Control-Allow-Private-Network: true`) only for allowed origins.
- **Bridge key**: random 32-byte secret generated at install, entered once in POS Settings (stored in IndexedDB with the register credential) and sent as `X-Elite-Bridge-Key`. Stops other local sites and processes without the key from driving the terminal. Constant-time compare.
- Admin operations (`/config`, initialize, restart) additionally require the POS to send a short-lived server-signed admin token (HMAC with a per-register secret from the server) proving an owner/admin session.
- Request body size limit, strict JSON schema, amount bounds (1 to 9,999,999,999 cents), UTN pattern.
- Executable signed (code-signing cert) and installed to ProgramData with ACLs; installer verifies the DLL SHA-256 against the delivered package.

Server
- Amount authority stays server-side: attempt amount must equal the sale total.
- One attempt cannot pay two sales (unique index + check).
- Register and shift derived from the session and device lease, not the payload.
- Unknown-attempt resolution needs manager PIN; refunds and voids follow the existing approvals policy; manual card fallback needs no PIN but is flagged and audited.

Operational
- Terminal admin functions (Initialize, Restart, CloseBatch from Settings) role-gated in the UI and on the bridge.
- No secrets in logs; error logs redact anything matching a PAN pattern (`\b\d{13,19}\b`).

---

## 6. Phases

| # | Deliverable | Needs QNB? |
|---|---|---|
| 1 | Bridge skeleton, `ITerminal`, `SimulatedTerminal`, job runner, journal, HTTP API, installer | No |
| 2 | Migration 047, `card-terminal-service.js`, sale/void/refund/shift changes, routes, tests | No |
| 3 | POS payment sheet states, recovery logic, Settings card-terminal panel | No |
| 4 | Card slip rendering and printing; Z close with CloseBatch; reconciliation tab | No |
| 5 | `RealTerminal` against the test terminal with the DLL; tune timeouts and error mapping | Test terminal |
| 6 | Bank test cases, submit results | Test case doc |
| 7 | Pilot on one branch (integrated mode, manual fallback on) → rollout per branch by flipping `card_mode` | Bank approval |

Docs to update: `docs/12-pos-system.md` (Card section), `docs/05-api-server.md`, `docs/04-admin-portal.md`, `docs/07-dev-guide.md`, `docs/pos-hardware-runbook.md`, `docs/15` (mark Phase 4 superseded), new `tools/elite-card-bridge/README.md`.

---

## 7. Test plan

Automated
- **Bridge (C#, NUnit/MSTest)**: amount formatting incl. 12-digit refund original amount; UTN validation and retry digit; error-map table; job runner busy/cancel; journal write-before-call and recovery after kill; whitelist strips unknown tag fields; CORS, PNA preflight and bridge key rejection.
- **Server (`server/test`, existing node test setup)**: `pos-card-terminal.test.js` and e2e: attempt idempotency; illegal state transitions; masked PAN validation; card sale with approved attempt; amount mismatch → 422; attempt reuse → 409; other register's attempt → 403; integrated register refuses manual card without manager approval; offline-queued sale creates the attempt on sync; void and refund with attempt; Z stores batch result; reconciliation totals.
- **Client unit**: UTN generator uniqueness; renderer `renderTerminalSlip` against the sample e-receipts in the spec (fixtures from guide pages 57-60); recovery decision table.
- **Playwright e2e (`client/e2e`)** with the bridge mocked by route interception: approve, decline, cancel, bridge down, approved-then-browser-reload (sale resumes, no second charge), unknown → status approved, unknown → will_reverse, refund card-present, Z close with batch.

Simulator scenario matrix (manual on a Windows PC, `ELITE_CARD_TERMINAL=simulator`)

| Scenario | Expected |
|---|---|
| Approve | Sale completes automatically, slip prints, attempt approved, payment `qnb-ecr` |
| Decline 051 / 055 / 116 | Reason shown, no sale, retry uses new UTN |
| Cancel on card screen | Cancelled, sheet back to Ready |
| Card / PIN timeout | Declined with reason |
| TNL | Auto logon, then approve |
| Port unplugged mid-transaction | Checking → status → correct final state |
| Browser closed after approval | On reopen, sale is completed once |
| Bridge killed mid-transaction | Restart → journal + status resolve it |
| Elite API offline | Card still works; sale queues offline with the attempt; syncs later |
| Two tabs try to charge | Second gets TERMINAL_BUSY |
| Out of paper | Error shown; sale not completed unless approved |

Hardware UAT (QNB test terminal + test cards)
1. Run QNB `Ideal.PointOfSale.Integration.Form.exe` first: Logon, Sale, Void, Refund. Confirms cable, COM port and profile before our code.
2. Repeat every simulator scenario against the real terminal (pull the cable for disconnect cases).
3. Cards: VISA, Mastercard, NAPS (card-present refund), contactless, PIN, declined card.
4. CloseBatch, Summary, Audit, Reprint last / by invoice, Initialize, Restart, Terminal settings.
5. Slip print check on the Bixolon at each branch: control codes, contactless symbol, 40 columns.
6. Execute the QNB test-case document; save evidence (screens, slips, logs); submit.

Pilot acceptance (one branch, 1 week)
- Zero unresolved attempts at end of each day.
- Daily POS card total equals terminal batch total.
- No double charges in the bank settlement.
- Cashier feedback on speed; median card checkout under 30 s.

---

## Verification (developer)
- `npm test` in `server/` (new and existing POS tests green).
- Client unit tests and `npx playwright test e2e/pos-card-terminal.spec.ts`.
- Bridge: `dotnet test` / MSBuild test project on Windows; run in simulator mode with the local admin (`http://localhost:4300/pos`) and walk the scenario matrix.
- Preview the POS payment sheet states in the browser pane with the mocked bridge and take screenshots of each state.
