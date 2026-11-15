# Features

Canonical feature reference for **L-SEA Space Apps**, the lunar south-pole
landing-site navigator built for the NASA International Space Apps Challenge,
Málaga 2026. For each feature: what it does, how it is implemented (real modules
and functions) and why that design was chosen.

Companion documents: [architecture.md](architecture.md) (contracts), [data.md](data.md) (dataset provenance), [decisions.md](decisions.md) (decision log) and [qa.md](qa.md) (verification).

## Contents

**User experience:** [Landing page](#1-landing-page) · [Mission console](#2-mission-console) · [Site catalogue and selection](#3-site-catalogue-and-selection) · [Custom sites and pointer picking](#4-custom-sites-and-pointer-picking) · [Viewport: 3D, top-down 2D and Canvas fallback](#5-viewport-3d-top-down-2d-and-canvas-fallback) · [Comparator and mission presets](#6-comparator-and-mission-presets) · [Orbital variation](#7-orbital-variation) · [Moon Trek layers](#8-moon-trek-layers) · [Mission brief export](#9-mission-brief-export) · [Bilingual interface, accessibility and UX](#10-bilingual-interface-accessibility-and-ux)

**Mission analysis:** [LOLA terrain and DEM areas](#11-lola-terrain-and-dem-areas) · [Sun and Earth ephemerides](#12-sun-and-earth-ephemerides) · [Ray-traced horizon and visibility](#13-ray-traced-horizon-and-visibility) · [Date, time and countdowns](#14-date-time-and-countdowns) · [Mission cycles](#15-mission-cycles) · [Mission autopilot](#16-mission-autopilot) · [Landing-zone detection and ranking](#17-landing-zone-detection-and-ranking) · [Feasible-date search](#18-feasible-date-search) · [Power, communications and thermal](#19-power-communications-and-thermal) · [Assumptions and limits](#20-assumptions-and-limits)

**Data and operations:** [QA benches and verification](#21-qa-benches-and-verification) · [Data pipeline](#22-data-pipeline) · [CI and deployment](#23-ci-and-deployment)

## 1. Landing page

- **What.** The presentation at `#/` (default route): pitch, three-step
  workflow, challenge context, NASA data credits, impact and a documentation
  grid.
- **How.** `src/landing/LandingPage.vue` renders it from the i18n catalogues;
  `src/Root.vue` hash-routes `#/` and lazy-loads the console with
  `defineAsyncComponent(() => import('./App.vue'))` at `#/tool`.
- **Why.** Judges need a public, no-login explanation before the tool; hash
  routing works on static hosting and lazy loading keeps the first page small.

## 2. Mission console

- **What.** The surface at `#/tool`: left site rail (sites, custom, compare),
  dominant viewport, compact timeline, right analysis rail (position, lighting,
  power, autopilot, cycles); layers, terrain, diagnostics and limits live in a
  drawer.
- **How.** `src/App.vue` owns resizable, persisted rails (left 220–420 px, right
  260–480 px, centre at least 420 px) and a 1024 px compact breakpoint;
  `SitesSurface.vue`, `AnalysisSurface.vue`, `TimelineBar.vue` and
  `ToolsDrawer.vue` (Tab focus trap) compose it, with state in `useAppState.js`.
- **Why.** Comparisons need map and numbers together, and persisted widths
  respect repeat use.

## 3. Site catalogue and selection

- **What.** Ten curated sites (nine Artemis III candidate regions plus
  Shackleton rim), searchable; selecting one drives the marker, analysis rail
  and timeline.
- **How.** `public/data/pois.json` via `loadSites()` in `src/services/sites.js`;
  `scripts/nasa/build-pois.mjs` samples each elevation from LOLA; selection
  lives in `useAppState.js`.
- **Why.** Referenced targets need no coordinate knowledge, and committed JSON
  keeps the demo offline-safe.

## 4. Custom sites and pointer picking

- **What.** A site defined by latitude/longitude or a map click, thereafter
  treated like a curated site.
- **How.** `CustomSitePanel.vue` calls `actions.addCustomSite()`;
  `createCustomSite()` in `src/services/sites.js` validates latitude, normalizes
  longitude and returns `source: 'custom' | 'pointer'`; the pointer route reuses
  the last clicked position. Sites outside the loaded DEM extent are counted,
  not drawn.
- **Why.** Planners need arbitrary coordinates, and clicking removes
  coordinate-format friction; sites persist across reloads.

## 5. Viewport: 3D, top-down 2D and Canvas fallback

- **What.** A lit 3D LOLA mesh with markers, Sun/Earth indicators, the horizon
  ray, layer drapes and a scale bar; a north-up top-down 2D mode; auto Canvas 2D
  when WebGL is unavailable or 3D fails.
- **How.** `src/render/moonScene.js` exposes `createMoonScene()` with
  `setTerrain`, `setSites`, `setSelectedSite`, `setSunDirection`,
  `setEarthDirection`, `setRay`, `setLabels`, `setLayers`, `setViewPreset`,
  `resetView`, `resize`, `dispose`; the top mode is a camera preset
  (`setViewPreset('top')`, rotation locked, canvas never rebuilt), and
  `src/render/fallback2d.js` returns the same data setters and lifecycle
  minus `setViewPreset`, which is camera-only in the Three.js scene; the Canvas
  path is chosen after `detectWebgl()` in `src/render/webgl.js`.
- **Why.** A second 2D renderer would drift from the 3D scene; a camera preset
  cannot, and scale parity is asserted in the end-to-end check. The automatic
  fallback keeps locked-down devices usable.

## 6. Comparator and mission presets

- **What.** Side-by-side comparison of up to three sites against the mission
  profile, plus eight historical mission presets.
- **How.** `ComparatorPanel.vue` shows sunlight, links, perimeter, mast, slope,
  power and rank (`MAX_COMPARE = 3`); `src/core/missionPresets.js` applies
  mission-level constraints app-wide, documented with sources in
  [mission-presets.md](mission-presets.md).
- **Why.** The same site looks viable or impossible under different eras; Apollo
  fuel cells are unsupported, so those presets use the non-solar
  (RTG-equivalent) path and say so; relay is the documented coverage model.

## 7. Orbital variation

- **What.** Sun and Earth elevation across the ephemeris window, with
  minimum/maximum and a marker at the current time.
- **How.** `OrbitalVariationPanel.vue` samples the site ephemeris and renders
  `src/components/ui/Sparkline.vue`; `src/core/ephemeris.js` also supports
  alternate epochs (`variants`) and a replayed cycle via `orbitPeriodDays`.
- **Why.** At the pole the monthly cycle is not obvious from one instant; the
  window shows when sunlight and Earth access exist.

## 8. Moon Trek layers

- **What.** 33 verified NASA Moon Trek south-polar raster layers draped in 3D
  and 2D, with coverage and zoom information; link-type entries open on Moon
  Trek.
- **How.** `public/data/layers.json`; `src/services/moontrek.js` builds tile/WMS
  URLs and `src/render/moontrekTiles.js` assembles the mosaic;
  `scripts/nasa/build-layers.mjs` verifies capabilities, a real tile and CORS at
  build time.
- **Why.** Illumination, slope, temperature and imagery add context the DEM
  lacks, and Moon Trek sends `Access-Control-Allow-Origin: *`, so layers load
  live; verification removes broken entries from the 347-layer catalogue.

## 9. Mission brief export

- **What.** "Export JSON" downloads a self-contained brief: sites, mission,
  analysis, attributions, known limitations and LROC QuickMap / Moon Trek links.
- **How.** `src/services/export.js` exposes `buildBrief({ sites, mission,
  computation })` and the download helper, schema `lsea.mission-brief/1`; wired
  in `useAppState.js` (`runExport()`, `state.export.status`).
- **Why.** Judging asks for sources and development status, so the brief carries
  both; it is reproducible, secret-free and reopenable in NASA tools.

## 10. Bilingual interface, accessibility and UX

- **What.** Full English and Spanish UI, persisted locale, locale-aware dates,
  keyboard access, visible focus, reduced motion and explicit loading, empty,
  error and worker states.
- **How.** `src/i18n/en.js` and `src/i18n/es.js` hold every string; the header
  switch also sets `document.documentElement.lang`. Landmarks, `:focus-visible`,
  the drawer trap, keyboard rails, `aria-live`, `sr-only`, 12 px minimum type
  and plain error copy are audited in [ux-compliance.md](ux-compliance.md).
- **Why.** The challenge requires an accessible, understandable product and the
  Málaga UX guide sets measurable criteria; one catalogue per language keeps
  both complete.

## 11. LOLA terrain and DEM areas

- **What.** Real south-pole elevation in six regions: the default 74.06 m grid,
  a 593.75 m wide-area grid, and 100/200/300/400 km presets at 97.66 / 195.31 /
  292.97 / 390.63 m per pixel.
- **How.** int16 `.bin` grids plus metadata in `public/data/terrain/`;
  `src/services/lola.js` provides `loadTerrain()` and `selectRegionForBounds()`,
  which prefers the highest resolution containing the extent;
  `src/core/terrain.js` provides `sampleElevation()` (bilinear), `slopeAt()`,
  `findCraters()` and `lonLatToXY()` / `xyToLonLat()`.
- **Why.** LOLA products are polar-stereographic rasters, not lat/lon grids; the
  metric projection keeps distances, slopes and curvature correct. `npm run
  data:lola` regenerates custom crops from verified PDS bytes.

## 12. Sun and Earth ephemerides

- **What.** Topocentric Sun/Earth azimuth/elevation for every site, 30-minute
  steps from 2026-11-01 to 2026-12-31: 2,928 samples per site and body,
  58,560 in total (10 sites × 2 bodies).
- **How.** `public/data/ephemeris/<site-id>.json` wraps samples;
  `src/core/ephemeris.js` provides `loadEphemeris()`, `sampleAt()` (linear
  interpolation, shortest arc for azimuth), `nextSetEvent()` and
  `visibilityWindows()`.
- **Why.** JPL Horizons sends no CORS headers, so static hosting cannot query it
  (D-015); pre-computed data stays real and offline-safe. Sampling stays well
  below horizon uncertainty, and terrain occlusion is left to the DEM.

## 13. Ray-traced horizon and visibility

- **What.** The terrain horizon elevation at any azimuth, the ray to space and
  the Sun/Earth visibility decisions built on them.
- **How.** `src/core/engine.js`: `horizonAngle()`, `rayTerrainIntersection()`,
  `isSunVisible()`, `isEarthVisible()` and a cached `horizonProfile()` (1°
  step), with the surface drop `d²/(2R)` for `R = 1,737,400 m`.
- **Why.** At the pole Sun and Earth stay within a few degrees of the horizon,
  so terrain decides visibility; ignoring curvature errs at range (11.5 km at
  200 km).

## 14. Date, time and countdowns

- **What.** UTC date/time bounded by the ephemeris window, a "now" button, ±1
  hour, play/pause and countdowns to the next sunset and Earthset.
- **How.** `TimelineBar.vue` (`formatDateInput()`, `formatTimeInput()`,
  `combineUtc()`) advances `state.playback.speedMinutes` (5, 20 or 60 mission
  minutes per tick) through a single-interval clock in `playbackClock.js`;
  `CountdownPanel.vue` uses `nextSetEvent()` with the ray-traced horizon.
- **Why.** Changing the date is the core question, so input must be fast and
  backed by shipped data; one interval handle prevents double time advancement
  after a re-render.

## 15. Mission cycles

- **What.** Weekly sunlight/eclipse and Earth-link/no-link cycles for the
  selected site and mission profile, with relay coverage; rendered in the
  Cycles tab and usable to seek the mission clock.
- **How.** `src/core/cycles.js` `computeMissionCycles()` ray-traces the local
  horizon (curvature included), samples at no wider than 30-minute steps,
  bisection-refines interval boundaries and merges adjacent intervals; relay
  coverage is the documented time-fraction model unioned with direct line of
  sight. `CyclesPanel.vue` renders it, and the worker answers
  `type: 'missionCycles'` with `modelVersion 'mission-cycles/1'` and an
  `inputSignature`.
- **Why.** Countdowns answer the next event, but a mission needs the weekly
  pattern of long eclipses and relay gaps; deterministic sampling keeps results
  reproducible, and the measured computation stays well under the 150 ms target.

## 16. Mission autopilot

- **What.** Scores and ranks curated sites for the mission profile with reasons,
  warnings and confidence.
- **How.** `src/core/autopilot.js` (`scoreSite()`, `rankSites()`) combines five
  weighted components: Sun 0.30, Power 0.20, Communications 0.25, Terrain 0.15,
  Logistics 0.10, explained as `{ code, params, severity, text }` reasons. Work
  runs in `src/workers/compute.worker.js` (`type: 'autopilot'`) with a
  main-thread fallback.
- **Why.** The ranking must be auditable and deterministic; a missing dataset
  lowers the score with a warning instead of throwing, and the worker keeps the
  UI responsive.

## 17. Landing-zone detection and ranking

- **What.** Flat zones detected from the loaded DEM and ranked for the mission,
  with battery, thermal and feasibility checks.
- **How.** `src/core/zones.js` `detectLandingZones()` (central-difference slope,
  8° slope and 12 m roughness gates, 4-neighbour components, 1 km² minimum, 12
  zones, about 1.1 M cells on the 2048² grid); `rankLandingZones()` in
  `zoneAutopilot.js` / `landingMetrics.js` weights power 0.25, sun 0.20, comms
  0.20, safety 0.15, thermal 0.10, logistics 0.05, science 0.05 and applies
  `feasibility.*` gates (power deficit, battery, illumination, RTG, thermal,
  data), capping infeasible scores.
- **Why.** Spacecraft land on flat areas, not named pins, so DEM detection finds
  candidates the catalogue lacks; gates separate "cannot work" from "works
  worse".

## 18. Feasible-date search

- **What.** The earliest feasible mission start for a detected zone, also used
  to sort zones.
- **How.** `src/core/dateSearch.js` `searchFeasibleDate()`: 12-hour step
  (`dateSearch.stepHours`), 30-minute screening, cached 360° horizon per zone;
  `rankLandingZones({ searchDates: true })` adds `feasibleDate`,
  `feasibleDateScore`, `hasFeasibleDate` and sorts feasible dates first.
- **Why.** A small schedule change can make a site feasible, so scheduling
  belongs to the decision; the search stays near two seconds on the wide DEM and
  never leaves the two-month window.

## 19. Power, communications and thermal

- **Power.** `src/core/power.js` `solarPowerEstimate()` applies `P(t) = S0 ·
  cos(incidence) · A · η · derate` (`S0 = 1361 W/m²`, vertical single-axis
  panel) after testing the Sun against the ray-traced horizon, and sizes the
  battery from the longest continuous eclipse: `(powerNeedW + heaterPowerW) ·
  eclipseHours / (eff · depthOfDischarge)`. Terrain shadowing, not solar
  elevation, limits a polar panel, so a Sun-angle-only model would overstate
  power.
- **Communications.** `src/core/comms.js` `commWindows()` and `dataBudget()` use
  the same horizon (optional `earthLimbRadiusDeg`); the relay is a documented
  coverage model (`relayCoverage` per `relayPeriodMinutes`, unioned with direct
  line of sight), not an orbit propagation. Stating the fraction is more honest
  than hiding a propagator.
- **Thermal.** `src/core/landingMetrics.js` computes `T = [(1 − A) · S · sin(el)
  / (ε · σ)]^(1/4)` (`σ = 5.670374419e-8`, albedo 0.12, emissivity 0.95), a
  heater model (400 W, 2 W/K), a −40 to +50 °C operating range and PSR flags.
  Illumination buys power but a ridge can mean cold, so temperature makes the
  trade-off measurable.

## 20. Assumptions and limits

- **What.** A visible "Assumptions & limits" panel repeats the modelling scope
  in the app; the brief and docs carry the same constraints.
- **How.** `LimitsPanel.vue`, `BRIEF_LIMITATIONS` in `src/services/export.js`,
  and the contracts in [architecture.md](architecture.md).
- **Why.** The tool is a decision aid, not flight dynamics; naming the ephemeris
  window, DEM resolution, spherical Moon and simplified models prevents a
  plausible map from passing as flight-qualified.

## 21. QA benches and verification

- **What.** Unit/contract tests, a seeded Monte Carlo bench, a 51-viewport
  device matrix, an end-to-end viewer check and live data spot-checks.
- **How.** `npm test` runs 275 tests in 19 files (plus 24 MCP tests); `qa/logic/`
  runs 13 invariants over 20,000 seeded cases (one real terrain-boundary defect,
  now fixed with a regression test); `qa/ui/` emulates 51 viewports plus the
  no-WebGL fallback; `scripts/qa/e2e-ui.mjs` asserts canvases, scale parity,
  terrain anchoring and panes via CDP; `npm run verify:horizons` re-queries
  Horizons (480 samples, 0.0000° maximum deviation on 2026-11-15). Evidence:
  [qa/README.md](../qa/README.md), [qa/REPORT.md](../qa/REPORT.md),
  [qa.md](qa.md).
- **Why.** Each claim about real data and honest limits needs an executed check;
  seeded, tagged cases (`@inv/*`, `@ui/*`, `@device/*`, `@res/*`, `@status/*`)
  reproduce exactly.

## 22. Data pipeline

- **What.** Reproducible scripts that acquire, verify and package every shipped
  NASA dataset.
- **How.** `scripts/nasa/`: `sites.mjs` (catalogue source of truth),
  `fetch-horizons.mjs` (polite client: 1.5 s delay, 429/5xx retries,
  `--force`/`--only`/`--dry-run`), `build-pois.mjs`, `build-layers.mjs`,
  `build-terrain.py`, `download-lola.mjs` + `lola_crop.py` (SHA-256 verified PDS
  products and crops), `verify-ephemeris.mjs`, `verify-sources.mjs`; outputs in
  `public/data/` (about 19 MB terrain, 2.8 MB ephemerides, 40 KB layers, 12 KB
  POIs).
- **Why.** NASA data must be real and auditable; committed datasets keep the
  build static and offline-safe, and byte-identical regeneration traces a grid
  to its official source.

## 23. CI and deployment

- **What.** CI on every push and pull request, and a public, no-login site on
  GitHub Pages.
- **How.** `.github/workflows/ci.yml` runs `npm ci`, `npm test` and `npm run
  build` on Node.js 24 (`contents: read`) and the MCP tests separately;
  `.github/workflows/pages.yml` builds with `--base=/l-sea-space-apps/`, copies
  `dist/index.html` to `dist/404.html` and deploys via `actions/deploy-pages`;
  `scripts/deploy/verify-live.mjs` checks the live URL. Vercel was disconnected
  and its configuration removed (D-024, D-025).
- **Why.** The challenge needs a public link with no password: static hosting
  plus a Git-driven workflow, with no runtime or secrets.
