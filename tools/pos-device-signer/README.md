# Elite POS Device Signer

This loopback-only service lets QZ Tray verify print and drawer commands while
the Elite API is offline. It never returns the private key to the browser.

Required environment variables:

- `ELITE_POS_QZ_CERT_PATH`: QZ `digital-certificate.txt` path.
- `ELITE_POS_QZ_KEY_PATH`: QZ PKCS#8 private key path. Restrict this file to the
  dedicated signer OS account using operating-system ACLs or a managed secret.
- `ELITE_POS_ALLOWED_ORIGINS`: comma-separated Elite admin origins. Defaults to
  `http://localhost:4300,https://admin.elitecollections.qa`.

There is no printer/call-type allowlist here (or in the main API's signing
endpoint): QZ Tray's client only ever sends a SHA-256 hash of the call to be
signed, never the original printer name or call type, so this service cannot
verify what it is signing — it can only bound the request size and prove
possession of the private key. Printer scoping is enforced earlier, by the
authenticated/enrolled-register checks on the API's own `/pos/transactions`
and print endpoints.

Optional: `ELITE_POS_SIGNER_PORT` defaults to `8182`.

Run the signer as a restricted startup service on the POS device. Provision and
revoke its certificate per register. Validate the exact Posiflex, Bixolon,
Windows startup, Chrome local-network permission, drawer pin, and QZ trust chain
before production rollout.
