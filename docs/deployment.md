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

The earlier Vercel project (`l-sea-space-apps`) is no longer part of the
deployment setup: the GitHub integration was disconnected and `vercel.json` was
removed. Its history is recorded in [section 6](#6-deployment-history-vercel--github-pages)
and in the decision log (`docs/decisions.md`). GitHub Pages is the single
documented production target and needs no runtime quota or secrets.

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
URLs are prefixed with the repository path. Local preview and any other host at
a domain root build with the default `/` base.

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

## 6. Deployment history: Vercel → GitHub Pages

The project was first published on **Vercel** (free plan) because it offered
Git-based deploys and HTTPS in minutes. During event week the free plan reached
its daily deployment quota and added a security checkpoint, so production moved
to **GitHub Pages**, built and published by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push to
`main` with the `/l-sea-space-apps/` base path and a `404.html` app-shell
fallback.

| Stage | Date | Detail |
| --- | --- | --- |
| Initial host | 2026-11-14 | Vercel project `l-sea-space-apps`, built from the default `/` base with `vercel.json` (Vite preset, SPA rewrite, cache headers) |
| Migration | 2026-11-14 | GitHub Pages became the production target; the workflow builds with the repository base path and needs no secrets (decision D-024) |
| Cleanup | 2026-11-14 | The Vercel GitHub integration was disconnected and `vercel.json` removed (decision D-025); no Vercel tokens or configuration remain in the repository |

The migration kept the same static build: only the hosting, base path and the
routing fallback changed. The historical Vercel-era decisions remain in
`docs/decisions.md` (D-015, D-019, D-024, D-025).

## 7. Cleanup after the event

- Keep the GitHub Pages deployment as the public demo; record the URL in the
  submission and the README.
- Do not commit deployment tokens or local state (`.cache/` is ignored; no
  deployment token is needed for GitHub Pages).
