# Deployment: static hosting

Publishing plan for the L-SEA application for the NASA Space Apps Challenge
Málaga 2026 submission. The application is a **static Vite build**: no Node.js
runtime, no server-side rendering, no database and no server-side environment
variables are needed in production.

> **Status: deployed.** Production URL:
> <https://rafaa-sf.github.io/l-sea-space-apps/> — GitHub Pages, built and
> published by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)
> on every push to `main`. The site must open **without login or password**
> (submission rule). Never store credentials in the repository, documentation,
> issues or chat.

## 1. Target

| Item | Detail |
| --- | --- |
| Platform | **GitHub Pages** (static hosting, free for public repositories) |
| Runtime | None in production. Node 24 is used only to build `dist/` in CI. |
| URL | <https://rafaa-sf.github.io/l-sea-space-apps/> |
| Base path | `/l-sea-space-apps/` (`npm run build -- --base=/l-sea-space-apps/`) |
| Routing | Hash routing (`/#/tool`), so no server rewrite is required; `dist/404.html` serves the app shell for other paths |
| Config | [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) |

The previous Vercel project (`l-sea-space-apps`) remains available as a legacy
mirror but is no longer the documented production target; its daily deployment
quota can be exhausted during event week. The GitHub Pages deployment has no
runtime quota concerns for this static site.

## 2. How to deploy

### Automatic (recommended)

1. Push to `main`. The **Deploy GitHub Pages** workflow:
   - checks out the commit and installs the locked dependencies (`npm ci`);
   - builds with the Pages base path
     (`npm run build -- --base=/l-sea-space-apps/`);
   - writes `dist/404.html` (copy of the app shell for hash routing);
   - uploads the artifact and deploys it with `actions/deploy-pages`.
2. The workflow reports the deployment URL; no tokens or secrets are needed
   (the workflow uses the repository `GITHUB_TOKEN` with `pages: write` and
   `id-token: write`).

### Manual dispatch

From the GitHub UI: **Actions → Deploy GitHub Pages → Run workflow** on `main`,
or from the CLI:

```bash
gh workflow run "Deploy GitHub Pages" --repo rafaa-sf/l-sea-space-apps --ref main
```

### One-time repository setting

Pages must use the workflow build type. This is already configured; to
re-create it from scratch:

```bash
gh api -X POST repos/rafaa-sf/l-sea-space-apps/pages -f build_type=workflow
```

## 3. Build output

`npm run build` produces the static site in `dist/`: `index.html`,
`favicon.svg`, hashed JavaScript and CSS bundles with sourcemaps, and a
verbatim copy of `public/data/` (POIs, ephemerides, layers, terrain and the AI
usage declaration) under `dist/data/`. No API keys are embedded: Vite only
exposes `VITE_*` variables and the application reads pre-computed datasets
instead of calling NASA APIs at runtime.

For GitHub Pages the build uses `--base=/l-sea-space-apps/`, so asset and data
URLs are prefixed with the repository path. A root deployment (such as the
legacy Vercel mirror) builds with the default `/` base.

## 4. Pre-deploy checklist

Run every item from a clean checkout of the release commit; do not deploy on a
dirty working tree.

- [ ] Working tree clean: `git status --short` shows nothing.
- [ ] Release commit recorded: `git rev-parse --short HEAD`.
- [ ] `npm ci` installs the locked dependency tree without errors.
- [ ] `npm test` is green and CI is green on `main`.
- [ ] `npm run build -- --base=/l-sea-space-apps/` succeeds.
- [ ] `dist/index.html`, `dist/404.html`, `dist/data/` and `dist/assets/` exist.
- [ ] No secrets or local-only files copied into `dist/`.
- [ ] After the workflow finishes:
  - [ ] `node scripts/deploy/verify-live.mjs https://rafaa-sf.github.io/l-sea-space-apps/`
        reports all checks passing (the script accepts the GitHub Pages
        404 app-shell fallback and the 600 s static-asset cache).
  - [ ] Browser console has no errors and the worker badge shows “Worker OK”.
  - [ ] `/#/tool` loads the mission console and the DEM selector shows the six
        local area presets.

Record the deployed commit and URL in the submission notes.

## 5. Rollback

- **Git**: revert the offending commit on `main`; the next Pages workflow
  rebuilds from the reverted state.
- **Workflow**: re-run the workflow on the last known-good commit
  (`gh workflow run ... --ref <sha>` with a commit that is reachable on `main`,
  or revert first).

## 6. Legacy Vercel project

`vercel.json` keeps a valid Vercel configuration (Vite preset, SPA rewrite,
cache headers) so the mirror can be refreshed with `npx vercel --prod` when
quota allows. It is not the documented production target and must not be used
for the submission link.

## 7. Cleanup after the event

- Keep the GitHub Pages deployment as the public demo; record the URL in the
  submission and the README.
- Do not commit deployment tokens or local state (`.vercel/` and `.cache/` are
  already ignored).
