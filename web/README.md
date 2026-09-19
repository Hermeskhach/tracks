# Tracks frontend

Angular 21 and Angular Material interface for the Tracks activity journal.

See the [project README](../README.md) for setup, authentication, database migrations, deployment, and testing instructions.

For frontend live reload, start the Worker from the repository root with `npm run dev`, then run these commands in this directory:

```powershell
npm ci
npm start -- --proxy-config proxy.conf.json
```

Open http://localhost:4200. API requests are proxied to the local Worker on port 5080.

`npm run build` creates production assets in `dist/web/browser`. The root build also checks the Worker and validates the Cloudflare deployment bundle.

Playwright tests live in `tests/`. Use an isolated test database as described in the root README; these tests create accounts and journal entries.
