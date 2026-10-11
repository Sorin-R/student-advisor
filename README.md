# Student Advisor

React/Vite frontend and an Express/MySQL API. Use a supported Node version from `package.json` (for example Node 24). Dependencies are pinned in `package-lock.json`.

## Development

Use a separate development database and TLS-capable SMTP account. The example expects the database and development user to be provisioned first (`MYSQL_SKIP_CREATE_DATABASE=true`). Copy `.env.example` to `.env` only if a local configuration does not already exist, then fill in the database, mail and security settings. `.env` must remain private and outside source control.

```sh
npm ci
npm run server
```

Run `npm run dev` in another terminal and open `http://localhost:5173`. Vite proxies `/api` to port 4000. On this Mac, follow [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md) instead of replacing the existing dependency symlink.

Development startup applies schema migrations to the configured database. Do not point development settings at production. Email verification and recovery require working SMTP; links are no longer printed to the console.

## Accounts and applications

- Password accounts must verify their mailbox. Existing accounts must verify after this upgrade; old sessions require a fresh sign-in. Verified Google sign-in is available only when its OAuth settings are configured.
- Advisers, moderators and admins must enroll in MFA before receiving workspace access. Keep recovery codes securely. The first trusted admin must be provisioned by an authorized database operator; subsequent staff account creation and permissions are managed at `/admin`. Advisers use `/advisor`.
- Access tokens stay in browser memory. Refresh cookies are HttpOnly, SameSite and Secure in production. Password/security changes and logout revoke server sessions.
- There is one current application per account. Students may save or submit; advisers control processing states. Completed applications are locked until reopened. Writes require the current application version, and submissions record the accepted terms version and server timestamp.
- Document uploads are validated and normalized in resource-limited workers. Each request accepts at most 10 MB of decoded files; the interface uploads selected files sequentially. PDFs are limited to 100 pages and images to 16 megapixels. Historical downloads are also validated. New files are stored in MySQL; legacy files remain private under `UPLOADS_DIR`.

## Configuration and release preparation

`.env.example` lists supported settings. Generate two independent random signing secrets and a 32-byte hexadecimal MFA encryption key for a **new installation**; run `openssl rand -hex 32` separately for each value and store the results privately. An existing MFA encryption key must be preserved unless a controlled re-enrollment/key migration is planned. Changing signing secrets ends existing sessions. Never place server secrets in `VITE_*` variables: those values are public browser code.

Production requires all of the following:

- `NODE_ENV=production`, an exact HTTPS `FRONTEND_URL`, and verified `TRUST_PROXY` addresses/subnets or a verified hop count. Use `false` when no reverse proxy is trusted; unrestricted `true` is rejected. Restrict direct access to an upstream-only backend.
- A dedicated runtime database account. Remote MySQL requires certificate-verified TLS (`MYSQL_SSL=true`, with `MYSQL_SSL_CA` when needed). Use a separate migration account for schema changes; runtime startup does not create or alter production tables. Grant audit-table insertion/reading without deletion.
- Working SMTP and an approved sender. Port 587 uses required STARTTLS; port 465 uses `SMTP_SECURE=true`. Verification and reset links expire and are single-use.
- A completed, approved privacy notice supplied through `PRIVACY_NOTICE_PATH`. **`config/privacy.example.json` is an unapproved template, not a publishable privacy policy.** Fill it with the actual operator, processors, retention periods and rights process before approval. Missing/unapproved notices block production startup and make the privacy API unavailable.
- Durable private document storage and reviewed retention/backups. Application deletion cleans its database records and its own current legacy directory; historical deployments, backups and downloaded exports require a separate retention process.

Optional Google OAuth uses `${FRONTEND_URL}/api/auth/google/callback` as its exact callback. A Google Maps browser key must be restricted to the actual website origins and required APIs.

For antivirus scanning, configure a local ClamAV daemon socket in `DOCUMENT_CLAMAV_SOCKET` and set `DOCUMENT_REQUIRE_MALWARE_SCAN=true`. Configured scanner failures reject the upload/download. Without a scanner, structural validation and normalization still run, but **the application does not claim an antivirus scan**. `AUDIT_LOG_PATH` enables an additional file copy for events using the central logger; application transaction events remain in the database. Protected database/log shipping is needed for a complete independent audit trail.

Before releasing an upgrade, verify the intended database target, take a recoverable backup, and test the release in staging. Apply `npm run db:migrate` with migration credentials **before** starting the new production runtime, then switch to runtime credentials. The migration adds security/application fields and revokes legacy refresh sessions; it does not approve privacy text or configure external services.

```sh
npm run check
npm run preflight
```

`check` runs the test suite and production build. `preflight` reads the configured production environment and privacy notice, reports missing settings, and changes nothing; it is not a deployment command or a network/TLS/mail delivery test. Production startup also checks the required schema versions. Verify SMTP delivery, Google/MFA flows, proxy IP handling, CSP/no-store headers, backup restore and actual database grants in staging before deployment.
