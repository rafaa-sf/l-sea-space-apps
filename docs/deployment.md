# Deployment: Vercel static hosting

Plan for publishing the L-SEA application for the NASA Space Apps Challenge
Málaga 2026 submission. The application is a **static Vite build**: no Node.js
runtime, no server-side rendering, no database and no server-side environment
variables are needed in production.

> **Status: not deployed yet.** This is the agreed procedure. Deploy only after
> the Lead gives the go-ahead and the credentials; never store credentials in the
> repository, documentation, issues or chat.

## 1. Target

| Item | Detail |
| --- | --- |
| Platform | **Vercel** (static hosting / CDN) |
| Runtime | None in production. Node 24 is used only to build `dist/` (locally or in CI). |
| URL | `https://<project>.vercel.app` (or a custom domain). Must open **without login or password** (submission rule). |
| Config | [`vercel.json`](../vercel.json) at the repository root |
| Framework | Vite — detected automatically; explicit build command and output directory in `vercel.json` |

## 2. How to deploy

### Option A — GitHub integration (recommended)

1. Go to <https://vercel.com/new> and import `rafaa-sf/l-sea-space-apps`.
2. Framework preset: **Vite** (auto-detected). The values in `vercel.json`
   (`buildCommand: npm run build`, `outputDirectory: dist`) are used automatically.
3. Deploy. Every push to `main` then produces a production deployment; every pull
   request gets a preview URL.
4. Copy the production URL into [submission.md](submission.md).

### Option B — CLI

```bash
# authenticate (interactive, once per machine)
npx vercel login

# deploy a preview
npx vercel

# deploy production
npx vercel --prod
```

For CI/non-interactive use, create a token at
<https://vercel.com/account/tokens> and pass it through the environment:

```bash
VERCEL_TOKEN='<token>' npx vercel --prod --yes
```

The token is a secret: keep it in the local `.env` or the shell environment,
never in the repository.

## 3. What gets deployed

`npm run build` (Vite) produces `dist/`:

```text
dist/
├── index.html          # entry point (includes the favicon link)
├── favicon.svg         # copied from public/
├── assets/             # hashed JS/CSS (and .map sourcemaps)
├── data/               # copied from public/data/ (POIs, ephemeris, layers, terrain)
└── ...                 # anything else placed in public/
```

Notes:

- Vite's `base` is `/` (see `vite.config.js`): the app is served from the root of
  the Vercel project. For a subpath deployment, build with `--base=/subpath/` and
  adjust the rewrite in `vercel.json`.
- `vercel.json` rewrites unknown paths to `index.html` (SPA fallback). Existing
  static files — `/assets/*`, `/data/*`, `/favicon.svg` — are served untouched.
- Cache headers: `/assets/*` is immutable for one year; `/data/*` is cached for
  one day with `must-revalidate`. Markdown files are served as `text/markdown`.
- Sourcemaps are published (the source is public); acceptable for the hackathon.
- No API keys are embedded: Vite only exposes `VITE_*` variables, and the
  production app reads pre-computed datasets instead of calling NASA APIs. The
  local `NASA_API_KEY` in `.env` is never part of the build.
- The GoDaddy `.htaccess` file is no longer shipped (Vercel does not need it).

## 4. Pre-deploy checklist

Run every item from a clean checkout of the release commit; do not deploy on a
dirty working tree.

- [ ] Working tree clean: `git status --short` shows nothing.
- [ ] Release commit recorded: `git rev-parse --short HEAD`.
- [ ] `npm ci` installs the locked dependency tree without errors.
- [ ] `npm test` is green and CI is green on `main`.
- [ ] `npm run build` succeeds and `dist/index.html` exists.
- [ ] `dist/data/` contains `pois.json`, `ephemeris/`, `layers.json`, `terrain/`.
- [ ] No secrets in the build:
      `grep -rIl -E 'NASA_API_KEY|api_key=|Bearer |BEGIN (RSA|PRIVATE)' dist || true`
      prints nothing; no `.env` file inside `dist/`.
- [ ] No local-only URLs in the build:
      `grep -rIl -E 'localhost|127\.0\.0\.1|:5173' dist || true` prints nothing.
- [ ] `vercel.json` is present and valid JSON.

## 5. Post-deploy verification

Open the production URL and verify:

- [ ] `/` returns the app (HTTP 200, `text/html`).
- [ ] `/favicon.svg` returns 200.
- [ ] `/data/pois.json`, `/data/layers.json`, `/data/terrain/index.json`,
      `/data/ai-usage.md` return 200.
- [ ] Terrain `.bin` files load (the 3D view renders real LOLA terrain).
- [ ] The app works in a private window (no login, no permissions).
- [ ] Browser console has no errors and the worker badge shows “Worker OK”.
- [ ] Deep links / refresh on the root page work (SPA rewrite).

The release commit is `git rev-parse --short HEAD`; record it with the deployed
URL in the submission notes.

## 6. Rollback

- **Dashboard**: Project → Deployments → open the last known-good deployment →
  Promote to Production.
- **Git**: revert the offending commit on `main`; the next deployment rebuilds
  from the reverted state.

## 7. Cleanup after the event

- The Vercel project can stay as a public demo. Keep the deployment URL in the
  submission and in the README.
- Do not commit Vercel tokens, `.vercel/` project metadata or local deployment
  state (the root `.gitignore` already ignores `.vercel`).
