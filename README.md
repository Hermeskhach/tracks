# Tracks — personal activity journal

Tracks is a personal activity journal: Angular 21 + Angular Material on Cloudflare Workers Static Assets, a TypeScript Worker API, and Cloudflare D1 (SQLite). The interface and API paths are preserved from the original .NET version.

[Open the app](https://tracks-journal.aregak-demo.workers.dev) · [Local setup](#local-development) · [Deployment](#deployment-to-your-own-cloudflare-account)

## Features

- Email/password accounts with an 8-character minimum, upper/lowercase letters, number, and symbol.
- Private tracks; create, edit, archive, and restore.
- Dated activities with optional amount, unit, and notes; edit/delete.
- Clickable count-based activity heatmaps, streaks, and chronological history.
- Anonymous, read-only sharing with random secret links, expiration, rotation, and revocation.
- Explicitly opt-in sample tracks; new accounts start empty.

## Local development

Requires Node.js 24. No Docker, .NET, or PostgreSQL is needed for the Cloudflare version.

```powershell
npm ci
npm ci --prefix web
node scripts/setup-auth-secret.mjs
npm run build
npm run db:local
npm run dev
```

Open **http://127.0.0.1:5080**. `npm run dev` uses Cloudflare's local Worker runtime and a local D1 database. Its data persists in ignored `.wrangler/state`. Local D1 and hosted D1 are separate databases; deploying code does not upload local data.

The convenience script `scripts/start-local.ps1` installs missing dependencies, builds, applies local migrations, and starts the Worker. For Angular live reload, run `npm start --prefix web -- --proxy-config proxy.conf.json` alongside the Worker and use port 4200.

## Project structure

| Path | Purpose |
| --- | --- |
| `web/` | Angular interface, styles, static assets, and Playwright tests |
| `worker/src/` | Cloudflare API, authentication, and example data |
| `worker/migrations/` | D1 database schema migrations |
| `worker/tests/`, `worker/integration/` | Credential and API security tests |
| `scripts/` | Local startup, secret setup, and PostgreSQL migration tools |
| `wrangler.jsonc` | Worker, static asset, and D1 configuration |
| `server/` | Original .NET backend, retained for reference |

Run commands from the repository root unless a step says otherwise.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local app on port 5080 |
| `npm run build` | Build Angular, check Worker types, and validate the deployment bundle |
| `npm test` | Run credential unit tests |
| `npm run test:api` | Run integration tests against the isolated local instance on port 5082 |
| `npm run db:local` | Apply migrations to local D1 |
| `npm run deploy` | Build, migrate hosted D1, and deploy to the configured Cloudflare account |

Private data and credentials belong in ignored `.local/`, `.wrangler/`, and `.dev.vars` files. A fresh clone starts without journal data. Cloudflare account/database IDs in the configuration identify resources; authorization still requires your Cloudflare login.

## Deployment to your own Cloudflare account

The repository does not opt into a paid Workers plan or add payment details. Use the account's Free plan. Do not switch to a paid plan to work around a deployment problem without deciding to incur charges.

1. Run `npx wrangler login` and authorize your account in the browser.
2. This workspace already has its Cloudflare account and D1 database IDs in `wrangler.jsonc`. For a separate deployment, create a database with `npx wrangler d1 create tracks-journal` and replace both account and database IDs.
3. Run `npm run build` and `npm run db:remote`.
4. If migrating the existing journal, import its private export **once into the empty database**, as described below, before publishing.
5. Run `node scripts/setup-auth-secret.mjs --remote` to install the authentication secret, then `npx wrangler deploy`. The script preserves an existing local secret. Back up `.dev.vars` securely: losing or changing its `PASSWORD_PEPPER` makes the stored credentials unusable. Never commit it. Wrangler reports the HTTPS `workers.dev` address. A custom domain is optional.
6. Test registration, login, a private activity, and an anonymous share link on the deployed URL. Check actual Worker CPU usage, particularly password verification, before relying on the Free plan. Local tests cannot certify Cloudflare's hosted CPU allowance.

For subsequent code/schema updates, `npm run deploy` builds, applies new D1 migrations, and deploys. Applied migration files must not be edited; add a new SQL file to `worker/migrations` for schema changes.

### Free-tier considerations

Static asset requests are free and unlimited. API requests and D1 queries/storage have separate quotas. Only `/api/*` invokes the Worker; Angular files are served directly as static assets. The browser performs PBKDF2-SHA512 (210,000 iterations for new accounts), so expensive password derivation does not consume Worker CPU. The Worker verifies a secret-backed HMAC. No paid fallback is configured. Measure hosted CPU after authentication changes; successful requests alone do not establish that usage fits the Free plan.

Official references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Migrating existing PostgreSQL data

The original database is retained in `.local/postgres`, and the original .NET implementation remains in `server/` for rollback. Migration is a copy, not a deletion. Avoid adding/changing entries in the old app during the final export and handover.

With the original local PostgreSQL database running:

```powershell
npm run export:postgres
```

This uses a read-only, consistent transaction and the ignored `.local/database.json` connection settings. It writes `.local/postgres-to-d1.sql` plus record counts. Accounts created by this project's earlier automated tests are excluded. Password hashes, user IDs, track IDs, activities, dates, and share-token hashes are preserved.

The export contains private journal data and password hashes. It stays outside Git and the public assets directory. Do not upload it as a static asset or commit it.

Import once, after schema migrations, into an **empty** target:

```powershell
# Local development database:
npx wrangler d1 execute DB --local --file .local/postgres-to-d1.sql

# Hosted database (only after configuring its real database ID):
npx wrangler d1 execute DB --remote --file .local/postgres-to-d1.sql

# Wrap imported legacy credentials with the configured authentication secret:
node scripts/upgrade-credentials.mjs
node scripts/upgrade-credentials.mjs --remote
```

The import uses ordinary INSERT statements, not destructive replacement or silent conflict handling. A duplicate import fails instead of overwriting journal records. Inspect the target if an import fails; do not blindly rerun a partially imported file. Compare user/track/activity/share counts with `.local/postgres-to-d1-counts.json` before handover. For larger datasets, split an export at whole statements within Cloudflare's import limits.

ASP.NET Identity v3 credentials keep their original salt, algorithm, and iteration count. Their stored subkeys are wrapped with the authentication secret, without knowing or changing the original password. Authentication also upgrades imported legacy records automatically. Existing users keep their passwords but must sign in again because .NET cookies are not reused. Share tokens still work with the new hostname; the old localhost hostname cannot become a public address.

## Security and data behavior

- The browser enforces the eight-character complexity policy before deriving a credential. The server validates a signed, five-minute challenge bound to the email, operation, salt, and work factor. As with other client-derived credential designs, a custom client can bypass password complexity checks for its own account.
- The derived credential is password-equivalent and is sent only over HTTPS in production; it is never persisted in the browser. D1 stores its HMAC-SHA256 verifier, keyed with `PASSWORD_PEPPER` in a Worker secret. A database-only leak therefore does not directly disclose a replayable credential. Keep the secret separate from database backups. Do not rotate it without a credential migration plan.
- Random 256-bit sessions are stored only as SHA-256 hashes in D1, expire after 14 days, and are revoked on logout. Cookies are HttpOnly, SameSite=Strict, and Secure outside loopback development.
- Every mutation requires a custom request header. Foreign origins and cross-site requests are rejected; CORS is not enabled.
- Authentication has a persistent per-IP rate limit and five-attempt account lockout. Track/activity/share mutations check ownership.
- Share tokens also contain 256 random bits; D1 stores only their hashes. Sharing includes the description and all activity notes, as disclosed in the dialog.
- API responses are not cached. Static pages carry CSP, referrer, and content-type protection headers.
- D1 SQL uses bound parameters. Schema migrations are separate from application requests.
- The optional example import is capped at 40 statements, within the Free plan query allowance per invocation.

Email verification, password-reset email delivery, and account deletion remain outside this MVP. Full owner history is loaded in one query; very large journals will eventually need pagination.

## Validation

```powershell
npm run build
npm test
```

For the isolated API integration suite, create a separate local database and start a second runtime:

```powershell
npx wrangler d1 migrations apply DB --local --persist-to .local/d1-tests
npx wrangler dev --ip 127.0.0.1 --port 5082 --persist-to .local/d1-tests
# In another terminal:
npm run test:api
$env:TRACKS_URL='http://127.0.0.1:5082'
cd web
npx playwright test tests/journal.spec.ts --grep 'API|calendar'
```

These checks cover legacy password compatibility, minimum password length, expired/revoked sessions, lockout, input validation, owner isolation, activity CRUD, heatmap counts, sharing expiration/rotation/revocation, archive/restore, and sample-data import. Tests use the separate test database and do not modify the migrated journal. Authentication is rate-limited, so allow a minute between repeated authentication-heavy test runs.

Deployment verification on 2026-09-19 passed the hosted API lifecycle test, including registration and login. Observed authentication CPU usage was 2–6 ms (under the Free plan's 10 ms allowance); this is a measured sample, not a guarantee for every future invocation. Temporary hosted test accounts were removed after verification.

Existing browser tests are in `web/tests/` and can be run against the isolated Worker using `TRACKS_URL` and `PLAYWRIGHT_CHANNEL=msedge` on Windows. The Cloudflare migration's automated verification uses the API/password tests; the interface is retained.

## Original implementation / rollback

[LEGACY-DOTNET.md](LEGACY-DOTNET.md) describes the original Docker/.NET/PostgreSQL setup. Start it with `scripts/start-dotnet.ps1` after stopping the Worker on port 5080. The old deployment files are kept for reference and do not participate in the Cloudflare build.

The Angular sign-in flow now uses the Cloudflare challenge endpoint. A rollback to .NET also requires restoring its original plaintext-over-HTTPS login/register client flow; the new frontend cannot sign in to the old backend unchanged.

After new data has been written to D1, rolling back the code alone does not copy those changes into PostgreSQL. Export or migrate the new data before reverting to the original app for ongoing use.
