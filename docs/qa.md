# Quality assurance

Test strategy and executed results for L-SEA Space Apps. The application is a static
Vite build; the QA covers the build and deployment surface, the shipped NASA datasets,
the domain logic and services, the browser experience and the live deployment.

Executed and re-run on 2026-11-14 at the release commit on `main`. All results below
are executed commands or recorded observations, not estimates.

## 1. Approach and scope

Levels:

| Level | Objective | Tooling |
| --- | --- | --- |
| L0 Build and static deployment | `npm ci`, `npm test`, `npm run build` and `vite preview` produce a self-contained static site; no secrets or local URLs | npm, curl, grep |
| L1 Data integrity | The shipped LOLA DEMs and NASA JSON files are structurally valid, mutually consistent and match their metadata | independent Node decoder, Python, curl |
| L2 Unit and contract tests | Pure functions and module contracts: transforms, sampling, interpolation, power, communications, autopilot, schema builders | Vitest |
| L3 Integration | Services load the real data; the worker protocol returns results; main-thread and worker results agree | Vitest, real datasets |
| L4 UI and end-to-end | The demo flow works in a real browser: worker, site selection, comparator, 2D fallback, autopilot, JSON export | headless Chrome 139 through the Chrome DevTools Protocol (`scripts/qa/e2e-ui.mjs`) |
| L5 Internationalisation | English and Spanish catalogues are complete and switchable | Vitest, browser checks |
| L6 Export interoperability | The JSON mission brief is valid and complete, with NASA links and no secrets | Vitest, browser download |
| L7 Resilience | Missing or corrupted data degrades gracefully; the no-WebGL fallback works; the worker failure path is handled | browser checks |
| L8 Security and privacy | No secrets or private data in tracked files or the build | pattern scans |
| L9 Performance and payload | Build payload is known and budgeted; terrain decode time is measured | size measurements, timings |

Out of scope for QA: the NASA platform submission form itself, legal and licensing
review (team review, see [data.md](data.md)), DNS and TLS operations, and lunar science
validation beyond the documented ephemeris datasets. The tool is a decision aid, not a
flight-dynamics tool.

## 2. Environments and tools

| Item | Value |
| --- | --- |
| OS | Linux 6.12 x86_64 |
| Node | v24.22.3 |
| npm | 11.19.1 |
| Python | 3.10 with numpy and Pillow (data inspection) |
| Browser | Google Chrome 139.0.7258.127, headless, Chrome DevTools Protocol |
| App dependencies | vue 3.5.45, vue-i18n 11.4.20, three 0.187.0, vite 8.3.8, vitest 5.1.0, @vitejs/plugin-vue 6.0.11 |
| CI | `.github/workflows/ci.yml`, Node 24, jobs `test-and-build` and `mcp-tests` on push and pull request to `main` and `develop` |

## 3. Automated tests

`npm test` (Vitest): **7 test files, 104 tests, all passing** in 403 ms.

| File | Tests |
| --- | --- |
| `src/core/engine.test.js` | 14 |
| `src/core/terrain.test.js` | 14 |
| `src/core/ephemeris.test.js` | 17 |
| `src/core/autopilot.test.js` | 18 |
| `src/core/power.test.js` | 8 |
| `src/core/comms.test.js` | 10 |
| `src/services/services.test.js` | 23 |

`npm --prefix mcp/miro test`: **8 tests, 8 passing** (mocked HTTP, no token or network).

Coverage focus: polar-stereographic transforms and bilinear sampling, horizon and ray
tracing with curvature, ephemeris interpolation and set-event detection, power and
communications arithmetic and windows, autopilot determinism and monotonic scoring,
service contracts for sites, ephemeris, terrain, layers and the JSON brief. UI
component tests are not part of the suite; the UI is covered by the live end-to-end
check in section 6.

CI runs the same commands on Node 24 for both packages and verifies the build output
contains `dist/index.html`, `dist/assets`, the three JSON datasets and
`dist/data/ai-usage.md`.

## 4. Data integrity results

Executed with two independent tools (Node `DataView` decoder and Python) against the
committed terrain files; 2 regions, 0 failures.

| ID | Check | Observed result | Verdict |
| --- | --- | --- | --- |
| D-01 | `index.json` parses; schema fields present | reference radius 1,737,400 m; polar_stereographic; default region `south-pole-875s-20m`; 2 regions | PASS |
| D-02 | Binary size versus width x height x 2 bytes | high resolution 8,388,608 B = 2048 x 2048 x 2; wide 2,097,152 B = 1024 x 1024 x 2; `meta.grid.fileBytes` matches | PASS |
| D-03 | int16 little-endian decode, dtype, endianness, layout | decoded row-major; all values inside the int16 range; no decode errors | PASS |
| D-04 | Decoded min and max versus declared `elevationRangeM` | high resolution [-4,378, 2,369] exactly; wide [-7,274, 7,001] exactly | PASS |
| D-05 | Derived pixel size and symmetric bounds | 151,680 / 2048 = 74.0625 m and 608,000 / 1024 = 593.75 m, equal to declared; bounds symmetric around the pole | PASS |
| D-06 | Coverage versus documented latitude bands | high-resolution edge radius 75,840 m gives -87.4994 degrees (expected -87.5, difference 19.6 m = 0.265 px); wide edge 304,000 m gives -80.0002 degrees (difference -5.6 m) | PASS |
| D-07 | Polar-stereographic forward and inverse round trip at 5 probe points | latitude drift under 1e-9 degrees, longitude drift under 1e-9 degrees | PASS |
| D-08 | Cross-region consistency, 1,600 paired samples | Pearson r = 0.9993; mean absolute difference 28.8 m; maximum 233 m | PASS |
| D-09 | Visual plausibility (hillshade and elevation render) | cratered, coherent lunar south-pole relief in both grids; no noise or constant field | PASS |
| D-10 | Metadata source geometry | 7584 x 7584 at 20 m covers 151,680 m; 7600 x 7600 at 80 m covers 608,000 m; both consistent with grid bounds | PASS |
| D-11 | Sentinel and no-data scan (-32768, 32767, zeros) | no int16 sentinels; zeros are 2,256 px (0.054 percent) high resolution and 191 px (0.018 percent) wide, spatially scattered | PASS (info) |
| D-12 | Every JSON data file parses | 6 of 6 files valid JSON | PASS |
| D-13 | Served bytes equal disk bytes | SHA-256 identical for all four terrain files | PASS |
| D-14 | Terrain decode performance | 8 MiB read 13.7 ms and int16 scan 47.1 ms; 2 MiB read 3.5 ms and scan 50.8 ms (Node, warm cache) | PASS (info) |

Note for loader authors: the documented "87.5S-90S" and "80S-90S" coverage refers to the
edge radius of the square grid; the corners extend further north (86.46S and 75.89S).
Region selection therefore uses the square bounds, not a circular latitude cutoff.

The NASA JSON datasets were also checked during their generation (section 3 of
[data.md](data.md)): 2,928 ephemeris samples per site with zero time gaps and zero
non-finite values; every POI received a DEM-sampled elevation; all 21 Moon Trek layers
were verified with real tile requests and CORS checks.

## 5. Build, payload and security hygiene

`npm run build` succeeds (Vite 8.3.8, about 0.7 s) with one chunk-size warning for the
Three.js chunk. Measured payload at the release commit:

| Artefact | Size |
| --- | --- |
| `dist/` total | 20,045,326 B (about 19.1 MiB) |
| `dist/data/` (NASA datasets) | 13,426,733 B (about 12.8 MiB) |
| `dist/assets/` (JS, CSS, sourcemaps) | 6,613,120 B |
| Three.js chunk | 742,936 B raw, about 187.84 kB gzip |
| Main application chunk | 272,255 B raw |
| Sourcemaps | 3,132,302 B (three.js) and 1,310,782 B (index) |

The NASA data dominates the build: two LOLA binaries account for 10,485,760 B (about
78 percent of the data payload). The chunk-size warning is accepted; sourcemaps are
published because the source is public.

Security and hygiene checks:

| Check | Result |
| --- | --- |
| Secret patterns in `dist/` (`NASA_API_KEY`, `api_key=`, `Bearer `, private-key headers) | no matches |
| Environment and key files in `dist/` (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`) | none |
| Secret patterns in tracked files | only the empty `.env.example` placeholder and the scan commands quoted in documentation; no real values |
| Local-only URLs in `dist/` (`localhost`, `127.0.0.1`, `:5173`) | no matches |
| Sourcemap source list | 13 sources (application and framework), no absolute local paths, no secrets in `sourcesContent` |
| `.env` ignored by git | yes; no `.env` tracked |

Static-server behaviour: the SPA fallback returns `200 text/html` for unknown paths
when the client sends a default `Accept` header, so data loaders validate the
`Content-Type` and parse the payload instead of trusting the status code.

## 6. Live deployment verification

### 6.1 Post-deploy verification (2026-11-14)

`node scripts/deploy/verify-live.mjs https://l-sea-space-apps.vercel.app` — all checks
passed:

```text
PASS  app entry                200  text/html                    1075 bytes
PASS  favicon                  200  image/svg+xml                307 bytes
PASS  POIs                     200  application/json             8475 bytes
PASS  layers catalogue         200  application/json             39282 bytes
PASS  terrain index            200  application/json             1464 bytes
PASS  AI usage declaration     200  text/markdown                10263 bytes
PASS  terrain LOLA binary      200  application/octet-stream     8388608 bytes
PASS  SPA deep-link fallback   200  text/html                    1075 bytes
PASS  hashed asset cache       200  public, max-age=31536000, immutable
```

### 6.2 Live end-to-end UI check (2026-11-14)

`node scripts/qa/e2e-ui.mjs https://l-sea-space-apps.vercel.app/?lang=en` against
headless Chrome 139, exit code 0, zero console errors and zero browser exceptions.
The check ran against the deployment as served at that time and exercises the
production bundle end to end. Observed in the running application:

| Step | Result |
| --- | --- |
| Initial load | Worker badge "Worker OK"; initial autopilot completed by the background worker in about 2 s |
| Site selection | Selected `de-gerlache-rim-1`; LOLA panel showed 88.68S, 292.07E, LOLA altitude 1,782 m, slope 4.5 degrees, aspect 98 degrees, distance from pole 40.0 km |
| Comparator | Site added to the comparator (1 of 3 selected) |
| 2D fallback | Manual 2D view active with the fallback banner and the map controls |
| Autopilot | Ranking returned `#1 Connecting Ridge` |
| JSON export | Downloaded `lsea-brief-2026-11-14-11-45-33Z.json`, schema `lsea.mission-brief/1`, 10 sites |

Screenshots of the running application are stored in `docs/screenshots/` (`app-3d.png`,
`app-2d-es.png`).

## 7. Feature coverage

All 15 architecture features are present in source and covered at module level, with
the caveats noted.

| # | Feature | Status |
| --- | --- | --- |
| 1 | Site selection (curated POIs and custom coordinates) | Present, unit-tested |
| 2 | Custom coordinates, LOLA altitude, Horizons bodies | Present, unit-tested |
| 3 | Site comparator | Present, unit-tested |
| 4 | Dates and times | Present, unit-tested |
| 5 | Sun/Earth versus horizon, ray tracing, curvature | Present, unit-tested |
| 6 | Time remaining until sunset or Earthset | Present, unit-tested |
| 7 | Power and communications | Present, unit-tested |
| 8 | Layers (Moon Trek) | Present, unit-tested; tiles not end-to-end tested |
| 9 | Real topography and craters (LOLA) | Present, unit-tested and data validated |
| 10 | Autopilot algorithm | Present, unit-tested |
| 11 | Background worker | Present; protocol exercised by the live E2E check |
| 12 | No-WebGL adapter | Present; covered by the live E2E check, not by a unit test |
| 13 | Orbital variation | Present, unit-tested |
| 14 | English and Spanish UI | Present; covered by the live checks, not by a unit test |
| 15 | JSON brief export | Present, unit-tested and exercised in the live E2E check |

### 7.1 Functional viewer checks

The end-to-end script also asserts the viewer geometry and the map scale:

- **Square canvases, no stretching.** The 3D and the 2D canvases are checked to be
  genuinely square: `canvas.clientWidth === canvas.clientHeight` and the drawing
  buffer matches the CSS size (`canvas.width === canvas.height`), in both renderers.
- **Live scale bar.** The scale bar is present and updates when zooming: the 3D
  label changes from `100 km` (1 px = 823 m) to `50 km` (1 px = 728 m) on a wheel
  zoom, and the 2D fallback from `100 km` (1 px = 808 m) to `50 km` (1 px = 564 m).
- **Regression gate.** `scripts/qa/e2e-ui.mjs` exits non-zero if a canvas is not
  square or if the scale label/caption does not change on zoom, so aspect-ratio and
  scale regressions fail QA instead of passing silently.

### 7.2 Terrain geometry, layout and layer-scale checks

The same end-to-end run covers the cartographic and layout behaviour:

- **Rectangular DEM, real extents.** The 3D and 2D views expose the real grid extent
  through `data-terrain-layout="rectangular"`, `data-terrain-extent` and
  `data-markers-anchored="true"`; site, custom and pointer markers are anchored to the
  sampled terrain surface (no floating at the datum), and the 3D view uses the same
  planar layout and horizontal scale as the 2D view (metres-per-pixel parity is
  asserted within 2%: e.g. 745 m/px vs 743 m/px at the same map width).
- **Resizable split panes.** The left and right rails expose
  `resize-handle-left`/`resize-handle-right` handles: dragging and the ArrowLeft/
  ArrowRight keys change the rail width, double-click or Home resets it, the value
  persists in `localStorage` across a reload, and the centre canvas stays square after
  the resize.
- **Per-layer Moon Trek scale.** Layer coverage is derived from each layer's own
  `boundsM` rather than the whole region: the catalogue reports e.g.
  `Coverage 152 x 152 km` and `Zoom 6, 36/36 tiles`, and the E2E check fails if the
  coverage label or the claimed zoom/tile count regresses.

## 8. Historical baseline (superseded)

The first Gate S baseline was executed at the initial scaffold commit `263d724`, when
the repository contained only the shell and terrain data: 55 checks (46 passed, 7
failed, 2 warnings), `npm test` failed with "No test files found", no feature modules
existed, and the `pois.json`, `ephemeris/` and `layers.json` datasets were missing.
Those findings were all resolved by later commits: the application modules, the test
suite, the datasets, the CI workflow and the deployment configuration were added, and
the current results in sections 3 to 6 supersede them. The historical evidence is kept
in the repository history (commit `263d724`).

## 9. Known gaps and limitations

- **Accuracy validation.** Computed horizons and illumination have not yet been
  compared against live JPL Horizons reference values; this is the next validation
  step and is not claimed anywhere as verified.
- **Usability testing.** No formal usability session with mission planners or educators
  has been performed.
- **UI test coverage.** The UI is covered by the live end-to-end check rather than by
  component-level unit tests, and the check requires a running preview or deployment
  plus a headless browser.
- **Firefox.** Firefox was available but not automated; only Chromium was exercised.
- **First-load performance.** The build is about 19 MB, dominated by NASA terrain
  binaries; the default terrain region is 8 MiB raw. Server compression and
  lazy-loading are the planned mitigations (see [scalability.md](scalability.md) section 2.4).
- **SPA fallback.** Missing data paths return `200 text/html` with a default `Accept`
  header; loaders must validate content type, and tests must assert MIME and parse the
  payload rather than trusting the status code.
- **Data scope.** Everything is bounded by the shipped data: ephemerides cover
  2026-11-01 to 2026-12-31 and terrain covers 80S-90S (with 87.5S-90S at higher
  resolution).
- **Deployment freshness.** The live site is deployed from `main`; after any further
  change, compare the asset hash in the served `index.html` with a local
  `npm run build`, then re-run `scripts/deploy/verify-live.mjs` and
  `scripts/qa/e2e-ui.mjs` against the production URL.
- **End-to-end script selectors.** `scripts/qa/e2e-ui.mjs` follows the current interface:
  the Compare text button and the tabbed analysis rail (Position/Autopilot). The
  selectors are maintained with the UI and re-checked against production.

## 10. Reproducible test bench (`qa/`)

In addition to the commands above, the repository ships a reproducible QA bench
under [`qa/`](../qa/README.md):

| Document | Contents |
| --- | --- |
| [`qa/README.md`](../qa/README.md) | How to run the bench, its commands, tags and outputs |
| [`qa/SPEC.md`](../qa/SPEC.md) | Specification: scenario model, invariants, tolerances and the device matrix |
| [`qa/devices.json`](../qa/devices.json) | The 51 device/resolution profiles used by the UI matrix |

The bench has two independent runners that share one contract and one tag taxonomy:

- **Monte Carlo logic bench** (`qa/logic/`): randomised site/date/mission
  scenarios over the real scientific core with 13 invariants. Run
  `node qa/logic/logic-mc.mjs --trials 20000 --profile full` for the full set,
  limit it with `--trials`/`--case` for a quick pass, or run
  `node qa/logic/probe-bench.mjs` for a throughput probe. Node only, no extra
  dependencies.
- **Device/resolution UI matrix** (`qa/ui/`): the 51 viewport profiles in English
  and Spanish plus explicit no-WebGL probes, driven by headless Chrome through the
  DevTools Protocol (`node qa/ui/ui-matrix.mjs`, subsets via `--devices`/`--tag`).
  Results can be filtered and aggregated with `qa/ui/filter-results.mjs` and
  `qa/ui/run-all.mjs`.

Generated artefacts land in `qa/**/results/` and are gitignored. The bench is run
on demand and is deliberately not part of CI; the executed runs and their findings
are summarised in [`qa/REPORT.md`](../qa/REPORT.md).

## 11. Reproduction

```bash
# Install, test and build (the CI commands)
npm ci
npm test
npm run build

# Miro MCP package tests
npm --prefix mcp/miro ci
npm --prefix mcp/miro test

# Build payload
du -sb dist dist/data dist/assets

# Deployed-build verification (needs a deployed URL)
node scripts/deploy/verify-live.mjs https://l-sea-space-apps.vercel.app

# Interactive end-to-end check (needs a preview or deployed URL and headless Chrome)
google-chrome --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 about:blank &
node scripts/qa/e2e-ui.mjs https://l-sea-space-apps.vercel.app/?lang=en http://127.0.0.1:9222
```

QA evidence (screenshots and recorded results) is stored in `docs/screenshots/` and in
the repository history; the dataset and API evidence is documented in
[data.md](data.md).
