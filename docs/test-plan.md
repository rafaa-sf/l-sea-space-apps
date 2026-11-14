# Test Plan — L-SEA Space Apps (Lunar Site Explorer)


> **Status snapshot (2026-11-14, `origin/develop` @ `5db7603`).** The application is implemented in source: a Vue 3 mission-control shell with 11 feature panels, a pure-JavaScript core (geometry, terrain, Sun/Earth horizon engine, ephemeris, power, communications, autopilot), service adapters, a single Web Worker, a Three.js scene with a no-WebGL Canvas 2D fallback, and the full real NASA datasets (`public/data/pois.json` — 10 sites; `public/data/ephemeris/` — 10 files × 2 928 samples at 30-minute steps from JPL Horizons DE441; `public/data/layers.json` — 21 verified Moon Trek layers; `public/data/terrain/` — 2 LOLA regions). `npm test` passes 98 tests in 7 files and `npm run build` is green; CI runs on `develop`. **Not yet validated:** end-to-end demo on a deployed URL, accuracy against live JPL Horizons references, usability. **Status refresh before submission:** re-check the final commit, the deployed public URL and the Project page fields before Submit for Judging.

| Field | Value |
| --- | --- |
| Project | L-SEA Space Apps — NASA International Space Apps Challenge · Málaga 2026 |
| Challenge | 11 — *Navegador de aterrizaje lunar* (lunar landing-site browser) |
| Application | the repository root (branch `develop`, `origin/develop` @ `5db7603`; implemented application + real datasets; Gate S baseline checks at `263d724` are historical) |
| Owner of this plan | `test bench` (test bench / QA teammate) |
| Plan version | 1.0 — 2026-11-14 (hackathon weekend, day 1) |
| Contract reference | `docs/architecture.md` (15 features, module interfaces) |
| Deployment reference | `docs/deployment.md` (static build on GoDaddy hosting) |
| Report of executed checks | [`test-report.md`](./test-report.md) |
| Executed pre-deploy checklist | the deployment checklist run (internal QA evidence) |

## 1. Purpose and scope

This plan defines how the L-SEA application will be verified from the current
skeleton to a deployable submission. It covers nine test levels (build/deploy,
data integrity, unit/contract, integration, UI/E2E, internationalization, export
interoperability, resilience, security) and maps every one of the 15 features in
`docs/architecture.md` to concrete tests and acceptance criteria.

In scope:

- The static Vite build and its deployment contract (`dist/`, data files, MIME,
  caching headers, `.htaccess`).
- The shipped NASA LOLA terrain datasets in `public/data/terrain/`.
- All modules and public interfaces defined in `docs/architecture.md`
  (`src/core`, `src/services`, `src/components`, `src/render`, `src/workers`).
- English/Spanish behaviour and the JSON mission-brief export.
- The no-WebGL fallback and the background worker.
- Security hygiene of the build (no secrets, no local-only URLs).

Out of scope for this plan (verified separately by the team, not by the test
bench): GoDaddy account provisioning, DNS/HTTPS certificate issuance, the
submission form on the NASA platform, the 7-slide demo deck / 30-second video,
and the commercial/outreach material owned by the second machine.

## 2. System under test

### 2.1 Baseline at plan creation (what actually exists)

| Area | Present today | Evidence |
| --- | --- | --- |
| App shell | `src/App.vue` mission-control shell (11 feature panels + status panels), `src/main.js`, `index.html` | repository files |
| i18n | `src/i18n/en.js`, `es.js`, `index.js` (auto-detect + fallback) | 4 message keys per locale |
| Styles | `src/styles/main.css` (design tokens) | repository file |
| Data | Real LOLA polar DEMs: `south-pole-875s-20m` (2048²) and `south-pole-80s-80m` (1024²) int16 LE `.bin` + metadata + `index.json` | `public/data/terrain/` |
| Data pipeline | `scripts/nasa/build-terrain.py` (JP2 → web grid) | repository file |
| Tests | Vitest 5.x: **7 test files, 98 tests, all passing** at `5db7603` (`npm test`); the MCP package has its own suite/job. UI-level E2E and accuracy-vs-Horizons validation are not yet covered | executed, see `docs/test-report.md` §0 |
| 3D rendering | `three@0.187.0` installed but **never imported** | no canvas/`THREE` in built app |
| Feature code | `src/core`, `src/services`, `src/components`, `src/render`, `src/workers` **do not exist** | directory scan |
| CI | No `.github/` workflow | directory scan |

### 2.2 Target system (the contract)

`docs/architecture.md` defines 15 features and their modules. The test bench
tests the contract, not the current skeleton: every acceptance criterion below
is written against the documented interface so the tests remain valid when the
coder/ui teammates land their code.

## 3. References

- `docs/architecture.md` — feature map, domain model, core/services/render/worker
  interfaces, polar-stereographic transform, mission profile shape.
- `docs/deployment.md` — build output contract, pre-deploy checklist (section 3),
  `.htaccess` rules (section 5), post-deploy verification (section 7).
- `docs/security.md` — secrets policy, protected file types, checks before push.
- `docs/conventions.md` — English-only materials, code conventions.
- `docs/project.md`, `docs/guide.md` — event rules, submission requirements.
- `vite.config.js` — `base: '/'`, dev proxy `/nasa/horizons`, `sourcemap: true`.
- `package.json` — scripts (`dev`, `build`, `preview`, `test`), dependency pins.

## 4. Test levels

Each level lists its objective, technique, tooling and the exit criterion that
must be true before moving on.

### L0 — Build and static-deployment verification

- **Objective:** prove that `npm ci` → `npm test` → `npm run build` → `preview`
  produces a self-contained, portable static site.
- **Technique:** execute the documented commands; inspect `dist/`; audit for
  secrets, local-only URLs, stray artefacts; compare served bytes with build
  output; verify hashed asset references resolve; test content negotiation for
  data files; verify build reproducibility.
- **Tooling:** npm, curl, sha256sum, grep, headless Chrome (DevTools Protocol).
- **Exit criterion:** clean `npm ci`, green `npm test`, successful build,
  `dist/index.html` present, all referenced assets 200 with correct MIME,
  no secrets, no `localhost`/`127.0.0.1`/`:5173`, data copied verbatim.

### L1 — Data integrity (real NASA data)

- **Objective:** prove the shipped LOLA DEMs are structurally valid, correctly
  described, mutually consistent, and fit their declared projection/coverage.
- **Technique:** independent decoder (Node `DataView`, int16 little-endian)
  recomputes dimensions, min/max, sentinel values; metadata↔index↔binary
  cross-checks; polar-stereographic transform round-trip; coverage latitude from
  the documented formula; cross-region sampling consistency (high-res vs wide
  area); visual hillshade inspection; served-vs-disk checksums.
- **Tooling:** Node scripts under `docs/test-report.md`, Python + numpy/PIL, curl.
- **Exit criterion:** declared elevation ranges match decoded values exactly;
  file sizes match `width × height × 2`; derived pixel size matches metadata;
  coverage matches the documented latitude bands within one pixel; cross-region
  correlation r > 0.95; both `.bin` files served byte-identically.

### L2 — Unit / contract tests (Vitest)

- **Objective:** verify pure functions and module contracts with fast,
  deterministic tests: transforms, sampling, interpolation, scoring, budgeting,
  schema builders.
- **Technique:** Vitest unit tests per module with synthetic terrain fixtures and
  analytic oracles (flat plane, single ridge, known Sun elevation); schema
  assertions for every documented return shape; boundary and error cases.
- **Tooling:** Vitest (already installed), node environment; optionally
  `@vue/test-utils` + `jsdom`/`happy-dom` for components (new dev dependencies —
  Lead decision).
- **Exit criterion:** `npm test` exits 0 in the repository; every exported
  function in `docs/architecture.md` has at least one positive and one negative
  test; core modules ≥ 80 % line/branch coverage (target, not a submission
  gate).

### L3 — Integration tests

- **Objective:** verify module seams: services load real data, core consumes it,
  the worker protocol executes autopilot off the main thread, and renderers
  receive the same state.
- **Technique:** integration tests in Node (worker simulated via
  `worker_threads`/mock port) plus data-backed tests that load
  `public/data/terrain/index.json` and sample real points (e.g. Shackleton rim
  coordinates); contract tests for `loadSites`, `loadEphemeris`, `loadTerrain`,
  `buildBrief`; parity test between main-thread `rankSites` and worker results.
- **Tooling:** Vitest, Node `worker_threads`, real terrain data.
- **Exit criterion:** services round-trip the shipped data; worker request
  `{ id, type: 'autopilot', payload }` returns `{ id, type: 'result', payload: { scores } }`
  or `{ id, type: 'error', payload: { message } }`; the main thread stays
  responsive during a full ranking run.

### L4 — UI / E2E

- **Objective:** prove the end-to-end demo flow works in a real browser: select
  sites, adjust the mission profile, read the compare/visibility panels, export
  the brief, switch language.
- **Technique:** headless-browser E2E (Chromium + Firefox) against `vite
  preview`; smoke render for every build; viewport matrix (390×844, 768×1024,
  1440×900); console/network error assertions; disabled-WebGL run; screenshot
  diffs for the main panels.
- **Tooling:** headless Chrome 139 / Firefox 159 (present); recommend adding
  Playwright as the durable E2E harness (new dev dependency — Lead decision).
  The current ad-hoc CDP harness lives in `docs/test-report.md`.
- **Exit criterion:** the happy path passes with zero console errors and no
  horizontal overflow at the three viewports; every Architecture feature panel
  renders data; the no-WebGL fallback produces an equivalent interactive map.

### L5 — Internationalization (EN/ES)

- **Objective:** every visible string is translated and switchable at runtime.
- **Technique:** static key-parity test (en vs es); source scan that every `t()`
  key used in templates exists in both catalogues; runtime E2E: switch EN→ES→EN,
  hard-refresh and confirm persistence (`localStorage['lsea.locale']`); check
  `<html lang>` and `<title>` update; verify number/date formatting uses locale;
  verify no untranslated fallback strings appear in either language.
- **Tooling:** Vitest (static), headless Chrome with `--lang`/CDP locale override.
- **Exit criterion:** key sets identical; zero missing keys; switcher persists;
  `html[lang]`/title follow the locale; no English leakage in Spanish UI except
  documented proper nouns.

### L6 — Export interoperability (JSON brief)

- **Objective:** the exported mission brief is valid, complete, and usable.
- **Technique:** schema test of `buildBrief({ sites, mission, computation })`;
  E2E download and `JSON.parse`; content assertions for selected sites, mission
  profile numbers, computed values, timestamps (ISO-8601 UTC), QuickMap and
  Moon Trek links; link-format test (`https://quickmap.lroc.asu.edu/...`,
  Moon Trek URL builder) without requiring live network; no secrets in export.
- **Tooling:** Vitest, Node `fetch`/`JSON.parse`, headless browser download.
- **Exit criterion:** export validates against the documented shape; links open
  a new tab and point at the selected site; no environment values inside.

### L7 — Resilience and degradation

- **Objective:** the app degrades gracefully instead of breaking.
- **Technique:** disable WebGL (`--disable-webgl`/null context) → fallback
  renderer must be used; simulate missing/corrupt data files (SPA fallback
  returns HTML with 200 — loader must reject content-type) and expect a visible
  error state; terminate/deny the worker and expect main-thread fallback or a
  clear message; test localStorage unavailable (private mode/stub throwing);
  test Horizons dev-proxy failure offline (production must not depend on it).
- **Exit criterion:** no unhandled rejection/white screen in any degradation
  scenario; user-visible error is localized; the app remains usable without
  WebGL.

### L8 — Security and privacy hygiene

- **Objective:** no secrets, no private data, no local-only URLs in shipped
  artefacts; repository stays public-safe.
- **Technique:** pattern scans over `dist/` and tracked files (`NASA_API_KEY`,
  `api_key=`, `Bearer `, private-key headers, `.env`), local-URL scan
  (`localhost`, `127.0.0.1`, `:5173`), sourcemap source-list audit, check that
  no `VITE_` secret would be inlined, confirm `.env` ignored.
- **Exit criterion:** all scans clean; no `.env*` or key material in `dist/`;
  no local URLs; `.gitignore` rules cover secrets and build artefacts.

### L9 — Performance and payload budget

- **Objective:** keep the static build fast on a venue/4G connection.
- **Technique:** record raw/gzip sizes per artefact; measure terrain decode time;
  measure first render (headless); watch budgets as Three.js and services land.
- **Budgets:** initial JS ≤ 250 kB gzip (three.js included); CSS ≤ 10 kB gzip;
  first required terrain region ≤ 6 MB gzip; time-to-interactive ≤ 2.5 s on
  localhost and ≤ 5 s on a throttled 4G profile.
- **Exit criterion:** budgets met or explicitly waived by the Lead with a
  documented alternative (e.g. ship only the wide-area region for the demo).

## 5. Test coverage of the 15 architecture features

Legend: **Not impl.** = module absent today; **Data only** = dataset present but
no consuming code; **Partial** = some behaviour present. "Planned tests" are the
must-have tests before submission; IDs are reused in `test-report.md`.

| # | Feature | Contract modules | Today | Planned tests | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| 1 | Site selection (CSA Moon Explorer style POIs) | `services/sites.js`, `components/` | Not impl. | U: `loadSites()` schema, ID uniqueness, in-coverage coords; E2E: list → select → map marker + details | POIs load from `public/data/pois.json`; selection updates map/panels; no duplicate IDs; every POI inside a shipped terrain region |
| 2 | Custom coordinates or pointer; LOLA altitude; Horizons bodies | `core/terrain.js`, `core/ephemeris.js` | Not impl. | U: `createCustomSite` validation/clamping (lat −90..−80, lon 0..360); `sampleElevation` matches known DEM value; E2E: enter coordinates and pointer click agree | Custom site gets DEM elevation within ±1 m of bilinear oracle; invalid input rejected with localized error; body list comes from pre-computed ephemeris |
| 3 | Site comparator (Horizons + LOLA, perimeter, mast) | `core/autopilot.js`, `components/` | Not impl. | U: `rankSites` deterministic ordering; ties; perimeter/mast affect score monotonically; E2E: compare table renders ≥2 sites | Ranked list deterministic for identical input; every `SiteScore` field documented and finite; recomputation after mission change |
| 4 | Dates and times | `core/ephemeris.js` | Not impl. | U: `sampleAt` interpolation at exact/between/boundary samples; ISO-8601 UTC parsing; E2E: date change re-renders values | No NaN/undefined at dataset edges; interpolation linear within tolerance; times shown in UTC with locale formatting |
| 5 | Sun/Earth vs horizon, ray tracing and curvature | `core/engine.js` | Not impl. | U: `horizonAngle` on synthetic flat/ridge fixtures vs analytic value; lunar curvature term; `rayTerrainIntersection` hit/miss; `isSunVisible` boundary | Horizon/ray results within 0.1° of analytic fixture; no intersection beyond dataset bounds; visibility agrees with horizon comparison |
| 6 | Time remaining until Sunset/Earthset | `core/ephemeris.js` | Not impl. | U: `nextSetEvent` returns future event consistent with `visibilityWindows`; E2E: countdown is positive/monotonic | Event inside queried window; remaining seconds ≥ 0; agrees with windows boundary ±1 sample interval |
| 7 | Power and communications | `core/power.js`, `core/comms.js` | Not impl. | U: `solarPowerEstimate` bounds (0 ≤ average ≤ peak; dailyWh ≥ 0), zero-sun case; `commWindows` sorted/non-overlapping; `dataBudget` arithmetic | All outputs finite and non-negative; windows sorted and non-overlapping; budget = Σ window seconds × mission rate |
| 8 | Layers (Moon Trek) | `services/moontrek.js` | Not impl. | U: catalogue loads; URL builders deterministic; toggling layer updates renderer setter; E2E toggle | URL builders produce HTTPS Moon Trek URLs for the selected site; toggle changes scene/fallback state without reload |
| 9 | Real topography and craters (LOLA DEM, PDS) | `core/terrain.js`, `services/lola.js` | **Data only** | D: full integrity suite (already executed); U: `lonLatToXY`/`xyToLonLat` round-trip, bilinear sampling, `findCraters` on synthetic pit; E2E: terrain visible in 3D/2D | Existing data checks pass (done); inverse transform error < 1e-6°; sampled elevation equals independent oracle; crater finder returns documented shape |
| 10 | Autopilot algorithm | `core/autopilot.js` | Not impl. | U: `scoreSite` deterministic; monotonic responses to power/relay/sun-days inputs; edge cases (no relay, impossible sun days); I: worker parity | Score changes in the documented direction for each mission field; impossible missions flagged; main-thread result == worker result |
| 11 | Background worker (single CPU thread) | `workers/compute.worker.js` | Not impl. | I: protocol request/result/error messages with `id`; single worker instance; terminate on unmount | Response matches request `id`; error path returns `{ type: 'error' }`; no blocking > 100 ms on main thread |
| 12 | Adapter for PCs without WebGL | `render/fallback2d.js` | Not impl. | E2E: run preview with WebGL disabled; assert fallback map, sun azimuth indicator, site markers; parity with 3D setters | Fallback renders all sites/terrain and stays interactive; no console errors; identical setter API |
| 13 | Orbital variation | `core/ephemeris.js` | Not impl. | U: sample a multi-day dataset; verify Sun/Earth elevation variation and no discontinuities; E2E: date slider spans the dataset | Interpolated values within dataset range; no discontinuity > documented tolerance at day boundaries |
| 14 | English/Spanish UI | `i18n/en.js`, `es.js`, `index.js`, components | **Partial** | U: key parity + `t()` usage (already executed outside repo); E2E: switcher EN→ES→EN, persistence, `html[lang]`, localized title | Key sets equal; no missing key in either language; switcher persists; `html[lang]`/title follow locale; zero English leakage |
| 15 | JSON brief export (QuickMap, Moon Trek) | `services/export.js` | Not impl. | U: `buildBrief` schema; X: download+parse round-trip; URLs valid; no secrets | Valid JSON with sites/mission/computation/links; QuickMap and Moon Trek links present and well-formed; downloadable from deployed URL |

### 5.1 Feature-completeness baseline (measured)

- Features with implemented code: **0 / 15**.
- Feature partially present: **1 / 15** (F14: catalogues + auto-detection only).
- Feature with data but no code: **1 / 15** (F9: LOLA DEMs + builder script).
- Missing required datasets for the documented app: `public/data/pois.json`,
  `public/data/ephemeris/`, `public/data/layers.json`.

## 6. Environments

| Environment | Stack | Purpose | Notes |
| --- | --- | --- | --- |
| Local dev (today) | Node v24.22.3, npm 11.19.1, Vite 8.3.8, Chrome 139, Firefox 159, Linux 6.12 x86_64 | L0, L1, L2, L3, L4, L5, L6, L7, L8, L9 | `npm run dev` on :5173 with `/nasa/horizons` proxy (verified reachable) |
| Local preview (today) | `vite preview --host` on :4173 | Static-build E2E | Serves `dist/`; SPA fallback content-negotiation must be understood (see report B-10) |
| CI (recommended) | Node 24 + `npm ci && npm test && npm run build` | Regression gate | CI workflow exists on `develop` (`.github/workflows/ci.yml`, `test-and-build` + `mcp-tests` jobs) |
| Target hosting | GoDaddy Linux cPanel Apache, HTTPS, docroot `public_html`, `.htaccess` allowed | Deployment verification | Only `dist/` contents uploaded; base `/` requires root domain/subdomain |
| Browser matrix | Chromium (primary), Firefox (secondary), mobile viewport 390×844 | L4/L5 | WebGL on/off runs |

Test data environments: real LOLA DEMs (committed) plus fixtures generated by
the test bench; no production secrets and no live NASA calls are required for
the test suite. The dev-only Horizons proxy may be exercised opportunistically
(reachability verified) but must never be a test dependency.

## 7. Tools and harness

| Tool | Status | Use |
| --- | --- | --- |
| Vitest 5.1.0 | **Installed; 98 tests in 7 files pass** (`src/core/*.test.js`, `src/services/services.test.js`) | L2/L3 unit and integration tests (`npm test`) |
| Node 24 scripts | Available | L1 data integrity, harness utilities (kept outside the repo in `docs/test-report.md`) |
| `vite preview` + curl | Available | L0 static deployment checks |
| Headless Chrome 139 (CDP) | Available | L4/L5/L7 E2E, screenshots, viewport/console assertions |
| Firefox 159 | Available | Secondary E2E (not yet automated) |
| Python 3.10 + numpy/PIL | Available | Terrain hillshade/visual inspection, fixture generation |
| Playwright / Cypress | **Not installed** | Recommended durable E2E harness (Lead decision, dev dependency) |
| jsdom / happy-dom / `@vue/test-utils` | **Not installed** | Recommended for component unit tests (Lead decision) |

Rules for the test bench:

- Do not create test files inside the app repository. The repository has hard
  read-only status for this teammate; throwaway harnesses live in
  `docs/test-report.md` and import repo sources read-only.
- Every executed check in the report must show the actual command and observed
  output; failures are reported as failures.
- No git write commands and no deployment actions.

## 8. Test data strategy

1. **Committed real data (authoritative for L1):** `south-pole-875s-20m` and
   `south-pole-80s-80m` DEMs, their metadata, and `index.json`.
2. **Golden values (recorded in the report):** byte sizes, SHA-256 hashes,
   elevation min/max/mean, centre elevation, cross-region statistics, coverage
   latitudes. These become regression oracles for future rebuilds of the data
   pipeline (`scripts/nasa/build-terrain.py`).
3. **Synthetic terrain fixtures:** flat plane (elevation 0), single Gaussian
   ridge (known horizon angle), bowl/crater (known `findCraters` output) stored
   as in-memory int16 arrays in unit tests — no new files in the repo.
4. **Synthetic ephemeris datasets:** constant, linear ramp, and a sinusoid with
   known set/rise instants (including a boundary case at exactly 0° elevation).
5. **Mission profiles:** the documented default profile plus edge cases
   (`relayInOrbit` true/false, `sunDaysNeeded` 0/10/30, `missionDays` 1/14).
6. **Temporary missing/corrupt data:** exercised by testing a copy of `dist/`
   with a removed file or by pointing a mock at an HTML body; never by deleting
   committed data.

## 9. Execution model, gates and priorities

Hackathon reality: coding starts now and the submission deadline is Sunday
15 Nov 2026, 23:59. The plan is run in three gates; only Gate S can be executed
against today's skeleton.

### Gate S — Skeleton gate (today, executed in `test-report.md`)

Hard requirements:

- S1: `npm ci` succeeds; `npm run build` succeeds; `dist/index.html` exists.
- S2: `npm test` exits 0 (currently **FAILS**).
- S3: terrain data integrity suite passes.
- S4: preview serves the shell and all data with correct MIME and byte-identical
  content; no secrets and no local URLs in `dist/`.
- S5: i18n key parity passes; the application renders in EN and ES (UI language switch).
- S6: pre-deploy checklist executable items evaluated honestly.

### Gate A — Feature gate (target: late Saturday 14 Nov)

- F1–F15 implemented per contract; unit + integration tests green; E2E happy
  path green (Chromium); EN/ES switcher and JSON export working.
- P0 priority order for testing: F9 terrain sampling → F5/F6 visibility →
  F1/F2 site selection/custom → F3/F10 compare/autopilot → F15 export →
  F14 i18n switcher → F7 power/comms → F8 layers → F4/F13 dates/orbital →
  F11 worker → F12 fallback. (P0 = required for the challenge demo, P1 =
  required to claim the feature, P2 = nice to have.)

### Gate R — Release gate (target: Sunday 15 Nov before submission)

- `npm ci && npm test && npm run build` on a clean checkout of the release
  commit; CI green.
- Full `docs/deployment.md` section 3 checklist passes; `.htaccess` shipped.
- Post-deploy verification (section 7) passes on the public HTTPS URL, including
  the EN/ES switcher and JSON export.
- No P0/P1 blocker open; waived P2 items recorded with owner.

### Test bench responsibilities

- Own Gate S execution and reporting (this document set).
- Add repository tests in a branch via the Lead (the test bench itself does not
  write into the repo); keep throwaway harnesses outside.
- Re-run the data integrity suite whenever `public/data/terrain/` or
  `scripts/nasa/build-terrain.py` changes, comparing against the golden values.
- Re-run the pre-deploy checklist for each release candidate.

## 10. Traceability: architecture feature → test level → report check

| Feature | Test levels | Executed today | Report IDs |
| --- | --- | --- | --- |
| F1 site selection | U, E2E | Not implemented | — |
| F2 custom/pointer, LOLA altitude, Horizons | U, E2E | Not implemented | — |
| F3 comparator | U, E2E | Not implemented | — |
| F4 dates/times | U, E2E | Not implemented | — |
| F5 horizon/ray/curvature | U | Not implemented | — |
| F6 time to set | U, E2E | Not implemented | — |
| F7 power/comms | U | Not implemented | — |
| F8 layers | U, E2E | Not implemented | — |
| F9 topography/craters | D, U, E2E | Data integrity fully executed; code absent | D-01…D-14 |
| F10 autopilot | U, I | Not implemented | — |
| F11 worker | I | Not implemented | — |
| F12 no-WebGL fallback | E2E | Not implemented | — |
| F13 orbital variation | U, E2E | Not implemented | — |
| F14 EN/ES | U, E2E | Catalogue contract + auto-detection executed; switcher absent | U-01…U-05, L-01…L-04 |
| F15 JSON brief | U, X | Not implemented | — |
| Cross-cutting build/deploy/i18n/security | L0/L5/L8 | Executed | B-01…B-16, S-01…S-05, C-01…C-15 |

## 11. Risks to the test plan

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Feature code lands late in the weekend | No time for full L2/L3/L4 | Run Gate S now; write tests alongside features; prioritise P0 features (section 9) |
| No durable E2E harness installed | Ad-hoc Chrome scripts are not reusable | Add Playwright (Lead decision, new dev dependency) or keep CDP scripts in `docs/test-report.md` |
| SPA fallback masks missing data as HTTP 200 | False-positive "data loads" checks | Always assert `Content-Type` and parse JSON, never status alone |
| Test bench cannot write into the repo | Tests must be transferred manually | Hand test code to the Lead/coder via shared task/patches; keep planning + report outside |
| Real data provenance cannot be re-derived without the source JP2s | Cannot prove raw NASA accuracy | Treat committed DEMs + builder script + documented provenance as source of truth; verify internal consistency and metadata as done |
| Deployment target specifics unknown until credentials exist | Headers/HTTPS/compression unverifiable locally | Execute section 3 now, section 7 only on the real URL; mark N/A honestly |

## 12. Out of scope / not tested by this plan

- Legal/licensing review of NASA imagery and attribution wording (team review).
- GoDaddy cPanel operations, DNS, TLS certificate issuance.
- Realistic lunar illumination science validation (beyond the documented
  ephemeris datasets) — the tool is a decision aid, not a flight dynamics tool.
- Browser support beyond current Chromium/Firefox; no IE/Safari matrix planned.
- Load/soak testing (static site, no backend) beyond payload budgets.

## 13. Sign-off

QA sign-off requires: Gate S report published (done), Gate A and Gate R reports
with all P0/P1 checks passing or explicitly waived by the Lead, and the executed
deployment checklist attached to the release notes. Any FAIL in the report must
either be fixed or accepted in writing by the Lead before submission.