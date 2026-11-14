# Deployment: static build on GoDaddy hosting

Plan for publishing the L-SEA application for the NASA Space Apps Challenge
Málaga 2026 submission. The application is a **static Vite build**: no Node.js
runtime, no server-side rendering, no database and no server-side environment
variables are needed in production. Any hosted directory that serves files over
HTTP(S) is enough; this document targets **GoDaddy Linux hosting (cPanel)** and
describes the exact steps the team will follow when the Lead provides the
credentials.

> **Status: not deployed yet.** This is the agreed procedure. Deploy only after
> the Lead gives the explicit go-ahead and the credentials; never store the
> credentials in the repository, in documentation, in issues or in chat.

## 1. Hosting requirements

| Requirement | Detail |
| --- | --- |
| Product | GoDaddy **Linux Web Hosting (cPanel)** plan, or any plan with cPanel/File Manager + FTP. |
| Not suitable | *Website Builder* plans (no arbitrary file uploads) and *Managed WordPress* plans. |
| Document root | `public_html` for the primary domain (or the docroot of the addon domain/subdomain used for the app). |
| Runtime | None. Node.js 24 is only used locally/CI to build `dist/`; the server only serves files. |
| HTTPS | Required. GoDaddy issues a certificate (AutoSSL/Let's Encrypt) once the domain points at the hosting. |
| Disk/bandwidth | Check the plan limits against the size of `dist/`, especially `dist/data/` (terrain and ephemeris JSON can be several MB). |
| URL | The final public URL will be provided by the Lead. It must open **without login or password** (submission rule). |

## 2. What gets deployed

`npm run build` (Vite) produces `dist/`:

```text
dist/
├── index.html          # entry point
├── .htaccess           # Apache config copied from public/.htaccess
├── assets/             # hashed JS/CSS (and .map sourcemaps)
├── data/               # copied from public/data/ (POIs, ephemeris, layers, terrain)
└── ...                 # anything else placed in public/
```

**Only the contents of `dist/` are uploaded** into the document root — the
`dist/` folder itself is not nested inside `public_html`.

Notes:

- `.htaccess` is tracked as `public/.htaccess` and Vite copies it into `dist/`,
  so the caching, MIME type, HTTPS redirect and SPA fallback rules ship with
  every build (section 5).
- Asset files under `assets/` have content hashes in their names. They can be
  cached forever; a new build produces new names.
- `public/data/` is copied verbatim to `dist/data/`. Missing data files are a
  deployment bug: the pre-deploy checklist below verifies them.
- Vite's `base` is `/` (see `vite.config.js`), so the app must be served from the
  **root of a domain or subdomain**. To deploy under a subpath instead, build
  with `npx vite build --base=/subpath/` and adjust the `.htaccess` rules.
- The build emits sourcemaps (`build.sourcemap: true`). The source code is public
  in the GitHub repository, so publishing maps is acceptable; to save space for
  the demo, build once with sourcemaps disabled (Lead decision).
- No API keys are embedded: Vite only exposes `VITE_*` variables, and the
  production app reads pre-computed datasets instead of calling NASA APIs. The
  local `NASA_API_KEY` in `.env` is never part of the build.

## 3. Pre-deploy checklist

Run every item from a clean checkout of the release commit; do not deploy on a
dirty working tree.

- [ ] Working tree clean: `git status --short` shows nothing.
- [ ] Release commit recorded: `git rev-parse --short HEAD` (note it in the
      release archive name).
- [ ] `npm ci` installs the locked dependency tree without errors.
- [ ] `npm test` is green (CI is green for the same commit).
- [ ] `npm run build` succeeds and `dist/index.html` exists.
- [ ] `dist/data/` contains the required datasets (`pois.json`, `ephemeris/`,
      `layers.json`, `terrain/`) and every file loads (see HTTP checks below).
- [ ] `dist/.htaccess` exists and contains the SPA fallback, the HTTPS redirect
      and the caching rules from section 5.
- [ ] No secrets in the build:
      `grep -rIl -E 'NASA_API_KEY|api_key=|Bearer |BEGIN (RSA|PRIVATE)' dist || true`
      prints nothing; no `.env` file inside `dist/`.
- [ ] No local-only URLs (`localhost`, `127.0.0.1`, `:5173`) in the build:
      `grep -rIl -E 'localhost|127\.0\.0\.1|:5173' dist || true` prints nothing.
- [ ] No `node_modules/`, no debug logs and no editor files in `dist/`.
- [ ] Only English is used in the default UI (Spanish available only through the
      language switcher).
- [ ] No NASA logo, flag or mission identifier is used as the team's own
      branding; NASA/partner data is attributed in the footer/about (per the
      participant guide).
- [ ] Public access verified: the built site is tested in a private window
      without logging in.
- [ ] EN/ES switcher and JSON brief export work from the deployed URL.
- [ ] A dated archive of the current live site exists (see section 6).
- [ ] The deployment date/time is recorded in the release notes or team log.

## 4. Deploy steps (cPanel File Manager, simplest path)

1. Build locally/CI: `npm ci && npm test && npm run build`.
2. Zip the **contents** of `dist/` (not the folder): `cd dist && zip -r ../l-sea-dist-$(date +%Y%m%d-%H%M)-$(git -C .. rev-parse --short HEAD).zip .`
3. Back up the current live site **before** overwriting it (section 6).
4. Log in to the GoDaddy cPanel for the hosting account → **File Manager**.
5. Open the document root (`public_html` or the addon-domain docroot).
6. Upload the zip with **Upload**, then right-click it → **Extract** into the
   document root, overwriting `index.html`.
7. Upload new hashed assets **before** replacing `index.html` when uploading file
   by file (the current page referenced by an open browser keeps working); with
   the zip+extract flow both land together and that is fine.
8. Keep the previous hashed assets on the server until the next deployment.
   Deleting them immediately can break visitors who still have the old
   `index.html`; they can be pruned in a later deployment.
9. `.htaccess` is inside the uploaded zip (shipped from `public/.htaccess`). If
   the plan ignores it or forces its own configuration, apply the fallback
   described in section 5.
10. Run the post-deploy verification in section 7.

Alternative transport: FileZilla/FTP or SFTP into the same document root, or
`rsync` over SSH when the plan includes SSH access. Whichever is used, it is the
same content of `dist/`.

## 5. SPA fallback and server configuration (`.htaccess`)

The app currently has **no client-side router** (no `vue-router` dependency): it
loads once from `index.html` and changes views inside the app, so deep links do
not exist yet and a fallback is only defensive. If a history-mode router is
added later, unknown paths must return `index.html`; otherwise a refresh on a
deep link returns a 404.

The plan must allow `.htaccess` (Apache on cPanel typically does, with
`mod_rewrite` and `mod_headers` enabled). The canonical file is tracked at
`public/.htaccess` and is copied to `dist/.htaccess` by the build, so it is
deployed with the rest of the site — do not create it by hand on the server.
Current contents:

```apache
# L-SEA Space Apps - static hosting configuration (Apache / GoDaddy cPanel).
Options -MultiViews

# SPA fallback: serve index.html for client-side routes, keep real files.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

# Force HTTPS once the cPanel certificate is active; the X-Forwarded-Proto
# guard avoids a redirect loop behind a TLS-terminating proxy.
<IfModule mod_rewrite.c>
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>

# MIME types for the pre-computed datasets.
<IfModule mod_mime.c>
  AddType application/json .json
  AddType application/geo+json .geojson
  AddType application/octet-stream .bin
</IfModule>

# Compression.
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

# Caching: hashed assets immutable for a year, datasets revalidated daily,
# HTML always revalidated.
<IfModule mod_headers.c>
  <FilesMatch "\.(js|css|woff2?|png|jpe?g|webp|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\.(json|bin|geojson)$">
    Header set Cache-Control "public, max-age=86400, must-revalidate"
  </FilesMatch>
  <FilesMatch "index\.html$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
</IfModule>
```

If the cPanel plan forces its own configuration, this file is the documented
fallback: disable it and apply the equivalent settings from cPanel.

**If the plan does not allow `.htaccess` or `mod_rewrite`:**

- No SPA fallback is possible; keep the app single-page with in-app navigation
  and no deep links, or switch the future router to hash mode (`#/path`), which
  works without server rules.
- Enable HTTPS through the cPanel toggle instead of the rewrite rule.
- Caching/compression must be set through cPanel ("Optimize Website") or defaults;
  hashed asset names already make long caching safe on most CDNs/hosts.

## 6. Rollback

The previous release must always be recoverable without rebuilding.

1. **Before each deploy**, save the current live site: cPanel → File Manager →
   select all in the document root → **Compress** → keep the archive outside
   `public_html` (e.g. in the account home directory), named with the date and
   the live commit (e.g. `public_html-backup-20261115-1200-abc1234.zip`).
   Alternatively use cPanel → **Backup** / **Backup Wizard** for a full account
   backup.
2. **To roll back**: upload the previous archive to the document root and
   extract it, overwriting `index.html` and restoring the old hashed assets;
   or delete the new files first and then extract the archive. Then clear any
   server-side cache (cPanel "Optimize Website"/cache tools) if enabled.
3. Verify with section 7 immediately after restoring.
4. Note the rollback and its cause in the team log so the next attempt fixes it.
5. A rebuild from Git is the alternative: `git checkout <previous-release-commit>`,
   `npm ci && npm run build`, upload `dist/`; do not rewrite history to roll back.

Keep at least the last two release archives until the submission is confirmed on
the NASA platform.

## 7. Post-deploy verification

From a machine outside the hosting account, in a private/incognito window:

- [ ] `https://<domain>/` returns `200` and the application shell renders.
- [ ] `http://<domain>/` redirects to `https://` (single 301).
- [ ] The browser reports a valid certificate (no warning, no mixed content).
- [ ] `https://<domain>/data/pois.json` returns `200` with
      `Content-Type: application/json` and valid JSON.
- [ ] The terrain/ephemeris files referenced by the app load (DevTools → Network:
      no 404s; Console: no errors).
- [ ] The Three.js view renders, or the no-WebGL fallback renders when WebGL is
      disabled.
- [ ] Language switcher EN → ES → EN keeps working after a hard refresh.
- [ ] The JSON brief export downloads a file and the QuickMap/Moon Trek links
      open in a new tab.
- [ ] Response headers: `index.html` is `no-cache`, `/assets/*` is
      `immutable`, `/data/*.json` and `/data/**/*.bin` revalidate daily
      (check with `curl -I`).
- [ ] The page is usable on a phone viewport and the demo flow runs end to end.
- [ ] The public URL works without login/registration, as required for the
      Project page "Final Project" link.

Useful commands:

```bash
curl -sI "https://<domain>/" | head -20
curl -sI "https://<domain>/assets/<hashed-file>.js" | head -20
curl -sI "https://<domain>/data/terrain/south-pole-875s-20m.bin" | head -20
curl -s "https://<domain>/data/pois.json" | head -c 200
```

## 8. Custom domain and HTTPS

1. The Lead confirms the domain and adds it to the GoDaddy hosting account
   (primary domain, addon domain or subdomain) and to the submission page.
2. DNS: point the domain at the hosting. For a GoDaddy-managed domain this is the
   default; for an external domain, set the `A` record for `@` to the hosting IP
   and a `CNAME` for `www`, or delegate nameservers to GoDaddy.
3. Wait for DNS propagation, then check cPanel → **SSL/TLS Status** and run
   **AutoSSL**/install the certificate. Publicly trusted TLS is mandatory for the
   submission link.
4. Force HTTPS (section 5) and confirm the `www`/apex variant redirects to one
   canonical URL.
5. Re-run the post-deploy verification on the final URL.

## 9. Credentials and secrets

- The Lead provides the cPanel/FTP credentials out of band when deployment
  starts. They are **never** committed, never written to `docs/`, and never
  pasted into the repository or the submission page.
- Use a dedicated hosting password, enable two-factor authentication on the
  GoDaddy account when available, and revoke/rotate the deployment password after
  the event.
- The production app needs no API keys; `NASA_API_KEY` stays in the local `.env`
  used only by the data-acquisition scripts.
- See [security.md](security.md) for the repository secrets policy.

## 10. Alternative static hosts (fallback)

If the GoDaddy plan cannot serve the build in time, the same `dist/` works on any
static host. A short-list for the Lead: a GitHub Pages `gh-pages` branch (built
with `npx vite build --base=/l-sea-space-apps/`) or another static CDN. This is a
fallback only; the primary plan is the GoDaddy domain, and the final URL must be
public and login-free either way.
