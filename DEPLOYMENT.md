# Secure deployment checklist

This archive contains the application release prepared on 9 October 2026. It does not contain `.env`, user uploads, database data, dependencies, private keys, test accounts or audit evidence.

Do not replace the live application until the real production settings and privacy notice are ready. Existing accounts will need email verification, old sessions will end, staff must enroll in MFA, and some legacy passwords will require a reset.

## Required order

1. Take restorable database, application and private-upload backups.
2. Extract this archive to a staging release directory. Keep the existing production `.env`, uploads and persistent data outside the extracted directory. `UPLOADS_DIR` must point to persistent storage shared across releases: Edit Mode stores published website images in its `site-content/` subdirectory.
3. Install exactly the locked dependencies with `npm ci --omit=dev --ignore-scripts`, using Node 24 or another version accepted by `package.json`.
4. Complete an approved privacy JSON file based on `config/privacy.example.json`. Do not approve or publish the placeholder template.
5. Configure all values described in `.env.example`, including SMTP, the exact HTTPS origin, the verified proxy setting, database TLS/grants and strong independent secrets. Preserve the existing `TWO_FACTOR_ENCRYPTION_KEY` during an upgrade.
6. Run `npm run preflight`. Resolve every required item. Warnings identify staging checks that still need verification.
7. Point migration credentials at the verified production database and run `npm run db:migrate` once before the new runtime starts. Production startup does not apply migrations automatically.
8. Switch to a dedicated limited runtime database account and start the app with `npm start`. The included `dist/` directory is already built.
9. Before public traffic is enabled, test email verification/reset, Google sign-in, staff MFA, upload/download/PDF, website Edit Mode text/image publishing, logout, direct `/admin`, `/advisor`, recovery and privacy URLs, CSP/no-store headers, client IP handling and backup restoration.

The host must route browser and `/api` requests to this Node application. Serving only `dist/` will omit login, recovery, applications and administration APIs. Preserve HTTPS end to end and do not let a CDN cache private `/api` responses.

See `README.md` and `.env.example` for the complete settings and operational boundaries.

## Website Edit Mode

An admin, or a moderator with the `manageContent` permission, can open **Admin dashboard → Open website Edit Mode**. Text is stored in the `site_content` database table. Replacement images are validated, resized, converted to WebP and stored beneath `UPLOADS_DIR/site-content`; include that directory in backups and preserve it when switching releases. Changes publish immediately and are recorded in the audit log.
