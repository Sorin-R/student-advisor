# Disposable database integration

`scripts/security-integration.mjs` is an opt-in HTTP/MySQL check. It is outside the default unit-test glob. Use a separate disposable MySQL server with networking disabled; never a shared or production database server.

The runner accepts only a `/tmp/student-advisor-security-test-*.sock` socket, creates a randomly named `student_advisor_security_test_*` database, uses synthetic signing keys/accounts, and stubs email and Google. It ignores `.env` via `DOTENV_CONFIG_PATH=/dev/null`. Its database is dropped on normal completion/failure. It does not test real SMTP delivery, Google signature verification or production infrastructure.

After an operator has started that isolated server, finish the frontend build first, then run the integration checks. Do not rebuild `dist` while this server is serving it:

```sh
npm run build
SECURITY_TEST_SOCKET=/tmp/student-advisor-security-test-mysql.sock node scripts/security-integration.mjs
```

For a local browser smoke session, add `--serve`. It binds only `127.0.0.1:4055`; stop with SIGINT/SIGTERM to close it and remove its database. The runner creates `browser@example.test` with the synthetic password defined in the script. Do not use these credentials on a deployed site. No emails leave the process. Rate middleware is tested separately with real MySQL counters; functional HTTP flows inject a permissive counter so the test suite cannot exhaust its own login budget.

Evidence is written to `output/security-fixes-2026-10-08/integration-results.json`. The script records check names and statuses, not auth tokens, recovery codes or personal records. Shut down the disposable MySQL instance after testing; do not stop other MySQL services on the machine.
