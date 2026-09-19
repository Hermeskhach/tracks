# Tracks

A personal activity journal organized around tracks: projects, interests, and ongoing practice. Angular 21 + Angular Material, ASP.NET Core 10 + Identity, EF Core, and PostgreSQL 18.

## Included

- Email/password registration, sign-in, and sign-out with HTTP-only Identity cookies.
- Create/edit/archive/restore tracks, each with a name, description, icon, and color.
- Add/edit/delete dated activities with optional numeric value, unit, and notes.
- Clickable GitHub-style heatmaps: intensity reflects 0, 1, 2, 3, or 4+ entries per day.
- Overview with today's entries and 20-week graphs; track pages with annual graphs, lifetime statistics, and chronological history.
- Current and longest streaks use distinct activity dates. A current streak can end yesterday while today remains open.
- Secret read-only links with optional expiration, rotation, and immediate revocation. Anonymous visitors see only the shared track; notes are included and the sharing dialog explains this.
- Optional **editable example tracks**, explicitly added from an empty journal. Real accounts start empty.
- Responsive layouts, keyboard-operable controls, focus-trapped dialogs, inline errors, and accessible heatmap labels.

No goals, reminders, achievements, invited-user sharing, or AI features are included.

## Run locally on Windows

Prerequisites: Node.js 24, .NET SDK 10, PostgreSQL 18 (the script expects `C:\Program Files\PostgreSQL\18\bin`). Docker is not needed for local development.

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-dotnet.ps1
```

Open **http://localhost:5080** and create an account. Passwords require 8+ characters, uppercase and lowercase letters, a number, and a symbol.

The script creates an isolated PostgreSQL cluster in ignored `.local/postgres`, listening only on `127.0.0.1:55432`, with a generated password stored in ignored `.local/database.json`. It does not change the installed PostgreSQL service or existing databases. It builds Angular, copies the output into the API's static directory, applies the committed EF migration, and serves both from one origin. Subsequent starts preserve your data. `-SkipBuild` reuses the existing frontend build.

Stop the API with Ctrl+C. Stop the isolated database with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-database.ps1
```

For Angular live reload, leave the API running and use:

```powershell
cd web
npm start -- --proxy-config proxy.conf.json
```

Then open http://localhost:4200. API requests proxy to port 5080.

## Run with Docker

1. Copy `.env.example` to `.env`; set a long random `POSTGRES_PASSWORD`. Do not commit this file.
2. Set `DOMAIN` to your hostname and point its DNS to the server. Allow incoming ports 80/443.
3. Run `docker compose up --build -d`.

Caddy terminates HTTPS and forwards requests to the API; PostgreSQL is internal. For `DOMAIN=localhost`, Caddy uses its local certificate authority, which you must trust locally. Production cookies require HTTPS. Database, Caddy state, and Identity data-protection keys use persistent named volumes. Never remove the database volume unless you intend to erase the journal. Back up PostgreSQL and the data-protection keys before updating the deployment.

The initial schema is applied automatically on startup. For future multi-instance deployments, apply migrations once before starting replicas instead of enabling `Database__AutoMigrate` on every instance. No cloud deployment or paid infrastructure is provisioned by this repository.

## Tests

With the local server running:

```powershell
cd web
npm ci
npx playwright install chromium
npx playwright test
```

On Windows, set `$env:PLAYWRIGHT_CHANNEL="msedge"` to use an installed Edge browser instead of the Playwright download.

Tests cover leap-day and duplicate-entry streaks, authentication, CSRF protection, ownership isolation, input validation, persistence across reload, activity CRUD, heatmap day selection, public read-only sharing, token replacement/expiry/revocation, archiving/restoring, and mobile overflow. They create uniquely named test accounts in the configured database; use a disposable database for CI. Set `TRACKS_URL` to target a dedicated test server.

Build checks:

```powershell
dotnet build server
cd web
npm run build
```

Create a migration (set `ConnectionStrings__Journal` first):

```powershell
dotnet tool restore
dotnet ef migrations add YourChange --project server
```

## API

All owner endpoints require authentication. All mutations require `X-Tracks-Request: 1`; cross-origin access is not enabled. No bearer tokens or credentials are persisted in browser storage.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/logout` | Account session |
| `GET /api/auth/me` | Current account |
| `GET /api/projects` | Owner's tracks and activities |
| `POST /api/projects` | Create a track |
| `PUT /api/projects/{id}` | Edit or restore a track |
| `DELETE /api/projects/{id}` | Archive, preserving history |
| `GET/POST /api/projects/{id}/activities` | Activity list/create |
| `PUT/DELETE /api/activities/{id}` | Edit/delete an activity |
| `GET /api/projects/{id}/heatmap?year=2026` | Daily counts, including zero days |
| `GET/POST/DELETE /api/projects/{id}/share` | Inspect/create or rotate/revoke a link |
| `GET /api/shared/{token}` | Anonymous read-only track |
| `POST /api/examples` | Add editable examples to an empty account |

Share tokens contain 256 random bits. Only SHA-256 hashes are stored in PostgreSQL. A raw token is returned once, so recovering a lost link requires rotating it. API responses use `Cache-Control: no-store`; shared pages use `Referrer-Policy: no-referrer`.

## Boundaries

This MVP uses password authentication. Email verification, password-reset email delivery, and account deletion are not yet implemented. The journal query loads an owner's complete history; pagination will be needed for very large journals. Dates are stored as calendar dates without timezone conversion; the browser supplies the user's local date. Example data uses the browser's local date. The share page is a live view, not an immutable export.

The Docker configuration is supplied for deployment but must be validated on a Docker-enabled host. Local development serves plain HTTP on loopback; use HTTPS for any network-accessible deployment.
