# Authentication regression tests

Run from the project directory:

```sh
node --test tests/auth-security.test.mjs
```

These tests import the authentication modules directly. They use Node's test
runner, real scrypt/bcrypt/AES-GCM/HMAC/TOTP implementations, and synthetic
request, response, database, Google, QR, audit and mail adapters. They do not
import `server/index.js` or `server/db.js`, load `.env`, connect to a database,
start a listener, contact Google, send email or inspect existing user records.
The test process sets its own clearly synthetic signing and encryption keys.

Coverage includes password length and Unicode, bcrypt upgrade/reset handling,
cryptographic validation, immediate access-session revocation, Google
state/PKCE/nonce and account-link rejection, email verification registration,
mandatory staff MFA enrollment, protected MFA replacement, TOTP replay,
one-use recovery codes, refresh-family reuse rejection, bearer-only logout,
public-user responses, transaction cleanup and explicit schema readiness.

The adapters make these fast regression tests; they do not validate MySQL's
SQL dialect, storage engine or concurrent row-lock behaviour. Before deployment,
run the project's separate integration tests against a disposable MySQL database
and complete an end-to-end check with dedicated Google/SMTP test accounts.
Never point a test or migration command at production without the deployment
configuration and backup being reviewed.
