# Running locally

Use Node 24 or another version allowed by `package.json`, a separate development MySQL database, and TLS-capable SMTP for account verification/recovery. Fill `.env` from the example without overwriting an existing configuration. Never use production database credentials for local startup: development startup applies migrations.

Run in separate terminals from this project:

```sh
npm run server
```

Wait for `Student Advisor listening on 127.0.0.1:4000`, then:

```sh
npm run dev
```

Open `http://localhost:5173`. Stop each process with Ctrl+C before starting another copy. If the API refuses startup, fix the reported configuration instead of disabling verification. Mail is required; there is no console reset-link fallback. Staff accounts must verify their mailbox and enroll in MFA.

## Dependencies outside cloud storage

The Documents folder on this Mac is managed by a file provider. Some dependency files were `compressed,dataless`, causing Node/Vite to wait in filesystem reads. The project's `node_modules` now points to the fresh locked installation at:

```text
/Users/sorinrotaru/.local/share/student-advisor/dependencies-security-9vjz3e_y/node_modules
```

The old folders `.node_modules-cloud-backup-security-20261008` and `.node_modules-cloud-backup-20260930` are preserved and excluded from Git/Vite watching. Application source, uploads and existing database data were not moved to the dependency directory.

Keep the target directory available. To reinstall the current lockfile on this Mac, stop Node/Vite first and install in that directory; `npm ci` in the project may replace the symlink:

```sh
cp package.json package-lock.json /Users/sorinrotaru/.local/share/student-advisor/dependencies-security-9vjz3e_y/
npm --prefix /Users/sorinrotaru/.local/share/student-advisor/dependencies-security-9vjz3e_y ci
```

On another machine with a project on ordinary local storage, use `npm ci` normally.

## Checks and migration boundaries

```sh
npm test
npm run build
```

The test suite uses synthetic data/mocks and temporary resources; run any separate database integration checks only against an explicitly isolated disposable database. `npm run check` combines tests and the production build.

`npm run db:migrate` applies schema changes to the database selected by the environment. Check that target before running it. Production migrations must run separately using migration credentials, before the new application starts; production runtime requires the migrated schema and performs no automatic DDL.

`npm run preflight` is a read-only production-configuration check. It will intentionally fail on normal development settings, placeholder secrets, missing SMTP or an unapproved privacy notice. See [README.md](README.md) and `.env.example` for the production settings. Do not change `approved` in the privacy template merely to make a check pass.
