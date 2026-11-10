# Elite Card Bridge

Lets the browser POS drive the QNB card terminal (Newland N910) through
Ideal Solutions' ECR DLL. The DLL is .NET Framework and Windows-only, so this
small service runs on each till PC that has a terminal cabled to it and
exposes a loopback HTTP API on `http://127.0.0.1:8183`.

```
POS (browser) ──HTTP 127.0.0.1:8183──▶ EliteCardBridge.exe ──RS-232 9600 7E1──▶ N910 ──▶ QNB
```

Design and decisions: `docs/12-pos-system.md` ("Card terminal") and the plan
in `docs/39-qnb-card-terminal-integration.md`.

## What it guarantees

- **One operation at a time.** A second request while the terminal is busy gets `409 TERMINAL_BUSY`.
- **No double charge.** Every sale/void/refund is journaled by its UTN
  (`journal/journal.log`): a `sent` line is flushed *before* the DLL is called
  and a `done` line after. Re-sending a finished UTN returns the stored
  result instead of charging again. A UTN that was sent but never answered
  (crash, power cut) is refused with `UTN_IN_FLIGHT` until its status is
  checked.
- **Unclear is never "declined".** Lost cable, DLL timeout or an exception
  mid-payment returns `outcome: "unknown"`; the POS must call
  `GET /v1/transactions/{utn}` (journal first, then the DLL's
  `TransactionStatus`).
- **No card data beyond the slip.** Only a masked PAN (6 + X + 4), expiry,
  scheme, auth code and the terminal's own masked receipt leave the bridge.
  Anything that looks like a full card number (Luhn-valid 13-19 digits) is
  dropped from results and redacted from logs.
- **Reactive logon.** `ERROR_TNL` (terminal not logged on) triggers
  `HostLogOn()` and one resend with the retry digit bumped.

## API

All responses are `{ success, data }` or `{ success: false, code, message }`.
Every route except `/v1/health` needs header `X-Elite-Bridge-Key`. Requests
from an `Origin` not in `allowedOrigins` get `403`. Chrome's Private Network
Access preflight is answered for allowed origins.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | version, mode (real/simulator), DLL version, COM port, connected, busy |
| POST | `/v1/jobs` | start an operation, returns `202 { jobId, state }` |
| GET | `/v1/jobs/{jobId}` | poll: `state` (running/done), latest terminal `message`, final `result` |
| POST | `/v1/jobs/{jobId}/cancel` | always `409 CANCEL_ON_TERMINAL`: DLL 5.0.0.13 has no break command; press the red key on the terminal |
| GET | `/v1/transactions/{utn}` | `approved` / `declined` / `reversed` / `not_found` / `in_progress` / `unknown` |
| GET | `/v1/ports` | COM ports on this PC |
| PUT | `/v1/config` | `{ "comPort": "COM3" }`, saved to config.json |
| POST | `/v1/sim/next` | simulator only: `{ "scenario": "decline" }` |

Job body:

```json
{ "type": "sale", "utn": "EAB12C2610011230450010", "amountCents": 5000, "email": null }
{ "type": "void", "utn": "EAB12C2610011230460010", "originalUtn": "EAB12C2610011230450010", "amountCents": 5000 }
{ "type": "refund", "utn": "...", "amountCents": 5000,
  "original": { "seqNo": "001001005", "date": "011026", "authCode": "114857", "amountCents": 5000 } }
{ "type": "logon" }   // also: logoff, closeBatch, summary, audit, reprintLast,
                      // reprintInvoice (+ invoiceNumber), initialize, restart, settings
```

`utn` is up to 22 capital letters/digits **ending in the retry digit** (the
DLL strips the rightmost digit as a retry counter). A void has its own
`utn` (journal and Elite record) and sends the sale's UTN as `originalUtn`,
which is what the DLL's `VoidTransaction` takes. Refunds are always
card-present: card number and expiry are sent blank so the terminal asks for
the card (QCB NAPS mandate).

Result: `outcome` (approved / declined / cancelled / unknown / error / ok),
`code`, `message` (plain English for the cashier), `terminalErrorCode`,
`hostResponseCode`, `authCode`, `maskedPan`, `cardExpiry`, `issuer`, `tid`,
`mid`, `seqNo`, `invoiceNo`, `hostTrace`, `txnAt`, `entryMethod`,
`pinVerified`, `receiptText`.

## Build

The QNB DLL package is bank property and is **not committed**. Copy the
delivered files into `lib/` (see `lib/README.md`). Needs the .NET 8 SDK
(builds the .NET Framework 4.8 exe on any OS via reference assemblies).

```bash
dotnet test tests/EliteCardBridge.Tests
dotnet publish src/EliteCardBridge -c Release -f net48 -o publish
```

Copy `publish/` plus `install-windows.ps1` to the till PC.

## Install on a till (Windows 10/11)

1. Put the terminal on its QNB docking station and connect the serial cable
   (USB-to-Serial adapter with an FTDI chip if the PC has no COM port).
2. Device Manager > Ports (COM & LPT): note the COM number. Set it fixed
   (Port Settings > Advanced) so it never changes.
3. Close QNB's test app if it is open (it holds the COM port).
4. Elevated PowerShell in the publish folder:

   ```powershell
   .\install-windows.ps1 -ComPort COM3 -PosUser 'SHOP-PC\cashier'
   ```

   It checks the DLL's SHA-256 against the QNB delivery, installs to
   `%ProgramFiles(x86)%\ElitePOS\CardBridge`, writes
   `%ProgramData%\ElitePOS\card-bridge\config.json` with a new bridge key,
   locks that folder to SYSTEM/Administrators/the POS account, and registers
   the `Elite POS Card Bridge` logon task (restarts every minute on failure).
5. Enter the printed bridge key in POS > Settings > Card terminal, and set
   the till's card mode to **Integrated** (owner/admin).

Files on the till:

| Path | What |
|---|---|
| `%ProgramData%\ElitePOS\card-bridge\config.json` | COM port, bridge key, allowed origins |
| `...\card-bridge\journal\journal.log` | payment journal (keep; rotates at 5 MiB, 10 files) |
| `...\card-bridge\logs\bridge.log` | bridge log, JSON lines, no card numbers |
| `%ProgramFiles(x86)%\ElitePOS\CardBridge\Logs\` | the QNB DLL's own log (log4net) |

## Develop without a terminal

```bash
ELITE_CARD_DATA_DIR=/tmp/ecb ELITE_CARD_BRIDGE_KEY=dev-bridge-key-0123456789abcdef \
  dotnet run --project src/EliteCardBridge -f net8.0 -- --simulator
```

Queue the next outcome:

```bash
curl -s -X POST http://127.0.0.1:8183/v1/sim/next \
  -H 'X-Elite-Bridge-Key: dev-bridge-key-0123456789abcdef' \
  -H 'content-type: application/json' -d '{"scenario":"insufficient"}'
```

Scenarios: `approve` (default), `decline`, `insufficient`, `wrong_pin`,
`cancel`, `card_timeout`, `pin_timeout`, `not_logged_on`, `port_lost`
(approved, then cable lost: status says approved), `dll_timeout`,
`approve_no_auth`, `out_of_paper`, `no_host`.

## Open points with QNB / Ideal (Teams call)

- Refund `originalAmount`: we send `"550.00"` and rely on DLL 5.0.0.13
  converting it to its 12-digit field. Confirm, or switch to
  `Formatting.Amount12`.
- Receipt control bytes (0x1E/0x11/0x12/0x0C/0x22/0x23) are rendered by the
  POS for the Bixolon; confirm none others appear.
- Whether the MOI log fields (`FileName`, `severPath`, `LocalPath`) apply to us.
- Cancel from the till: v5.0.0.13 has no `SendBreakCommand`.
