# Architecture

Technical contract for the L-SEA Space Apps application. It is the reference for
all teammates; changes to a public interface are coordinated through the Lead.

## Stack

Vue 3 and Vite for the interface, Three.js for the 3D viewport, plain JavaScript ES
modules for the domain core, a single Web Worker for background compute, vue-i18n for
English and Spanish, Vitest for tests, and a static Vite build deployed on GitHub Pages. No
TypeScript. The developer workflow and commands are in the [README](../README.md) and
[contributing.md](contributing.md).

## Runtime constraints

- The deployed application is **static**. There is no runtime server, so
  browser calls to NASA services that do not send CORS headers (JPL Horizons)
  cannot be made in production.
- Strategy: **pre-computed NASA datasets** downloaded by scripts and stored in
  `public/data/`. The Vite dev server proxies `/nasa/horizons` for optional live
  queries during development only.
- The application must work **without WebGL** (two-dimensional fallback).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/core/` | Pure domain logic: geometry, engine, terrain, ephemeris, power, comms, autopilot, zones, landingMetrics |
| `src/services/` | Data access and integration adapters (Horizons, LOLA, Moon Trek, export, sites, storage) |
| `src/workers/` | Background Web Worker (single CPU thread) |
| `src/components/` | Vue components and feature panels |
| `src/render/` | Three.js scene and no-WebGL fallback renderer |
| `src/i18n/` | English and Spanish message catalogues |
| `src/styles/` | Global styles and design tokens |
| `src/App.vue`, `src/main.js`, `index.html` | Application shell and bootstrap |
| `public/data/` | Pre-computed NASA datasets (ephemeris, terrain, POIs, layers) |
| `scripts/` | NASA data pipeline, deployment verification, QA and demo tooling |
| `docs/` | Project documentation (index in the [README](../README.md)) |
| `mcp/miro/` | Miro Model Context Protocol server ([miro.md](miro.md)) |
| `demo/` | Project Demo deck and generator ([demo.md](demo.md)) |

Changes to a public interface are coordinated through the Lead; the contribution
workflow is in [contributing.md](contributing.md).

## Domain model

Units: **meters** for distances, **degrees** for angles, **ISO-8601 UTC** for
times. The Moon reference radius is `1737400` m.

### Site

```js
{
  id: 'shackleton-rim',      // unique slug
  name: 'Shackleton rim',    // display name (i18n key or plain value)
  lat: -89.45,               // degrees, negative south
  lon: 129.2,                // degrees, 0..360 east
  elevationM: 0,             // meters, relative to reference radius
  source: 'poi',             // 'poi' | 'custom' | 'pointer'
  perimeterM: 200,           // optional: site perimeter radius (meters)
  mastM: 10,                 // optional: antenna mast height (meters)
}
```

### Ephemeris sample

```js
{
  time: '2026-11-14T12:00:00Z',
  sun: { az: 0, el: 0 },     // topocentric azimuth/elevation, degrees
  earth: { az: 0, el: 0 },
}
```

Pre-computed ephemeris files live in `public/data/ephemeris/<site-id>.json`. Each
file wraps a `samples` array of the objects above with its site and range:

```js
{
  siteId: 'shackleton-rim',
  site: { lat: -89.78, lon: 204.27 },
  moonRadiusM: 1737400,
  source: 'NASA/JPL Horizons API (DE441), topocentric apparent az/el',
  range: { start: '2026-11-01T00:00:00Z', end: '2026-12-31T23:30:00Z' },
  stepMinutes: 30,
  sampleCount: 2928,
  samples: [ /* 2 928 EphemerisSample objects, no gaps */ ],
}
```

Azimuth is degrees east of selenographic (true) north (`0..360`), elevation is
degrees above the local horizontal (airless). The exact contract and the
generation script are documented in `public/data/ephemeris/README.md`; the API
details are in [data.md](data.md).

### Pre-computed datasets

| Path | Contents | Producer |
| --- | --- | --- |
| `public/data/pois.json` | Array of `Site` objects for the 10 curated south-pole POIs (`source: 'poi'`, plus `provenance`, `sourceUrl`, DEM-sampled `elevationM`) | `scripts/nasa/build-pois.mjs` |
| `public/data/ephemeris/` | Per-site Sun/Earth az/el files + `index.json` + schema `README.md` | `scripts/nasa/fetch-horizons.mjs` |
| `public/data/terrain/` | LOLA polar-stereographic int16 grids + `index.json` (see above) | `scripts/nasa/build-terrain.py` |
| `public/data/layers.json` | 21 live-verified NASA Moon Trek WMTS layers (`type: 'wmts'`, tile URL template, zoom range, projection, attribution, verification record) | `scripts/nasa/build-layers.mjs` |
| `public/data/ai-usage.md` | Same declaration as [ai-usage.md](ai-usage.md), served to the deployed app (the UI links to `/data/ai-usage.md`) | copied from docs |

The static build copies `public/data/` to `dist/data/`, so the app fetches
`/data/...` at runtime; the dev server proxy for live Horizons queries exists
only for development. Data endpoints, provenance, licensing and known limitations are in [data.md](data.md).

### Terrain grid (LOLA DEM, polar stereographic)

The real LOLA polar DEMs are stored in **polar stereographic projection**, not as
a regular lat/lon grid. Two regions are shipped under `public/data/terrain/`:

| Region | Grid | Pixel size | Coverage | Role |
| --- | --- | --- | --- | --- |
| `south-pole-875s-20m` | 2048 × 2048 | 74.06 m | 87.5S–90S (±75,840 m) | High-resolution (default) |
| `south-pole-80s-80m` | 1024 × 1024 | 593.75 m | 80S–90S (±304,000 m) | Wide area for outer POIs |

`public/data/terrain/index.json` lists the available regions. Each region has a
`.bin` (int16 little-endian, row-major, elevation in metres relative to
R = 1,737,400 m) and a `.json` metadata file.

Polar stereographic transform (R = 1,737,400 m, central meridian 0°):

```text
lonLatToXY:  rho = 2 * R * tan(pi/4 + lat/2); x = rho * sin(lon); y = rho * cos(lon)
xyToLonLat:  rho = hypot(x, y); lon = atan2(x, y); lat = 2 * atan(rho / (2 * R)) - pi/2
grid:        col = (x - minX) / pixelSizeM; row = (maxY - y) / pixelSizeM
```

Row 0 is the `maxY` (north) edge; column 0 is the `minX` (west) edge. `y` grows
toward longitude 0°. The loader picks the widest region that contains the site
(high-resolution first), and samples bilinearly.

## Core interfaces (coder)

### `src/core/terrain.js`

- `lonLatToXY(latDeg, lonDeg) -> { x, y }` — polar stereographic, metres.
- `xyToLonLat(x, y) -> { latDeg, lonDeg }` — inverse transform.
- `sampleElevation(terrain, lat, lon) -> number` — converts to grid coordinates
  and samples bilinearly (metres relative to the reference radius).
- `slopeAt(terrain, lat, lon) -> { slopeDeg, aspectDeg }`.
- `findCraters(terrain, options) -> Array<{ lat, lon, diameterM, depthM }>`.

### `src/core/engine.js`

- `horizonAngle(terrain, site, azimuthDeg) -> number` — maximum terrain elevation
  angle along an azimuth, including lunar curvature correction.
- `rayTerrainIntersection(terrain, site, azimuthDeg, elevationDeg) -> { distanceM, lat, lon } | null`.
- `isSunVisible(terrain, site, sun) -> boolean`.
- `isEarthVisible(terrain, site, earth) -> boolean`.

### `src/core/ephemeris.js`

- `loadEphemeris(siteId) -> Promise<EphemerisDataset>`.
- `sampleAt(dataset, date) -> EphemerisSample` — linear interpolation.
- `nextSetEvent(dataset, site, terrain, body, from) -> { time, remainingSeconds }`.
- `visibilityWindows(dataset, site, terrain, body, from, to) -> Array<{ from, to }>`.

### `src/core/power.js`

- `solarPowerEstimate(site, terrain, ephemeris, mission) -> { averageW, peakW, dailyWh }`.

### `src/core/comms.js`

- `commWindows(site, terrain, ephemeris, mission, from, to) -> Array<{ from, to }>`.
- `dataBudget(commWindows, mission) -> { totalSeconds, estimatedMb }`.

### `src/core/autopilot.js`

- `scoreSite({ site, terrain, ephemeris, mission }) -> SiteScore`.
- `rankSites({ sites, terrain, ephemeris, mission }) -> SiteScore[]`.

Mission profile input:

```js
{
  missionDays: 14,
  powerNeedW: 120,
  relayInOrbit: false,       // lander in orbit available for communications
  sunDaysNeeded: 10,         // consecutive lunar days of sunlight required
  perimeterM: 200,
  mastM: 10,
  // optional mission-feasibility fields (backward compatible defaults):
  batteryCapacityWh: 40000,  // documented default battery class (40 kWh)
  batteryRoundTripEfficiency: 0.9,
  batteryDepthOfDischarge: 0.8,
  heaterMaxW: 400,
  heaterWPerK: 2,
  minOperatingTemperatureC: -40,
  maxOperatingTemperatureC: 50,
  landingEllipseRadiusM: 500,
  craterHazardMinDiameterM: 500,
  craterHazardReachM: 5000,
  scienceReachM: 5000,
  thermal: {                 // single-layer radiative model parameters
    albedo: 0.12, emissivity: 0.95, solarConstantWm2: 1361,
    nightTemperatureC: -180, psrTemperatureC: -200,
  },
  weights: null,             // optional zone component weight overrides
  powerSource: 'solar',      // 'solar' | 'rtg'
  rtgPowerW: null,           // required when powerSource === 'rtg'
}
```

Battery/feasibility notes: when a mission does not specify
`batteryCapacityWh`, the documented default of **40,000 Wh** is used and the
feasibility gate reports a `feasibility.batteryNotSpecified` warning
(`mission.batterySpecified` is exposed in `metrics.missionInputs`). Battery
sizing uses the **longest continuous eclipse**, not the total eclipse time.

### `src/core/zones.js`

- `detectLandingZones(terrain, options) -> { zones, meta }` — flat landing zones
  detected from the loaded DEM: central-difference slope in metres, a slope gate
  (`maxSlopeDeg`, default 8°), an optional roughness gate (`maxRoughnessM`, local
  max−min inside `roughnessRadiusCells`), 4-neighbour connected components and a
  minimum area (`minAreaKm2`, default 1 km²). Large grids are downsampled
  automatically (`maxCells`); the processing resolution is reported in
  `meta.resolutionM`. Returns at most `maxZones` (default 12) zones sorted
  largest-and-flattest first.
- Zone shape: `{ id, name, lat, lon, xMeters, yMeters, areaKm2, meanSlopeDeg,
  maxSlopeDeg, elevationM, reliefM, cellCount, suitability }`.

### `src/core/zoneAutopilot.js` and `src/core/landingMetrics.js`

- `rankLandingZones({ terrain, ephemeris, sites, mission, options }) -> { zones, meta }`
  — detects zones on the loaded DEM, anchors each zone to the nearest curated
  site's precomputed Sun/Earth ephemeris and computes the full mission variables
  with `computeLandingMetrics` (safety, illumination, power W/Wh, thermal, comms,
  logistics, science). Everything is recomputed on every call: terrain region,
  mission profile, mission start time and ephemeris window all feed the metrics,
  and the deterministic `meta.inputSignature` (short hex, also on each entry)
  changes whenever any of them changes. `meta.computedAt` / `meta.computeMs`
  record when the run happened.
- Ranked entry: `{ zone, rank, score, grade, gradeCode, confidence, components,
  metrics, reasons, warnings, ephemerisSiteId, nearestSiteId,
  nearestSiteDistanceM, zoneLabel, inputSignature }`.
- `metrics.safety` — mean/max/std slope [deg], roughness [m], relief [m], flat
  fraction [0..1], `ellipse` fit (`fitRatio`, required/available area [km²],
  required/equivalent radius [m], margin [m]) and `hazard` (nearest crater
  distance/diameter/depth [m], clearance [0..1], craters within reach).
- `metrics.illumination` — sunlit fraction [0..1], sunlit hours [h], continuous
  sun days [d], longest eclipse [h], min/max/mean sun elevation [deg], eclipse
  count, sunset/sunrise count, window hours.
- `metrics.power` — `source` (`'solar'`/`'rtg'`), average/max/min/peak power
  [W], `longestEclipseHours` vs `totalEclipseHours` [h],
  `eclipseDeficitWh` (energy deficit over the **longest** eclipse, battery
  sizing basis) vs `totalEclipseEnergyWh` (sum over all eclipses, informational)
  [Wh], `heaterLongestEclipseWh` [Wh], `requiredBatteryWh` [Wh],
  heater power/energy [W/Wh], margin vs `powerNeedW` [W, ratio], battery capacity
  and coverage, `meetsPowerNeed`, daily energy [Wh/day]; for RTG also
  `rtgPowerW` and `rtgMarginW` [W] with `requiredBatteryWh = 0`.
- `metrics.thermal` — day/night/PSR surface temperature [°C], min/max and cycling
  ΔT [°C], cycle count, heater [W/Wh], operating range flags.
- `metrics.comms` — direct/effective Earth visibility [0..1], longest LOS gap
  [h] and its start, available hours, relay coverage and benefit, data budget
  [Mb] vs need, data-rate and mast-clearance heuristic [deg].
- `metrics.logistics` — nearest curated site [m], nearest flat pad [m, km²],
  traverse distance/difficulty index, equivalent perimeter [m].
- `metrics.science` — nearest crater distance/diameter/depth [m], craters within
  reach, crater proximity score, PSR proximity (inferred from zero illumination).
- Legacy flat fields (`averageW`, `sunlitFraction`, `meanSlopeDeg`,
  `earthVisibleFraction`, `requiredBatteryWh`, `heaterWh`, `minTempC`,
  `maxTempC`, `maxLosGapHours`, …) are kept for backward compatibility.

Scoring weights (configurable through `mission.weights`, normalized to sum 1):
power 0.25, sun 0.20, comms 0.20, safety 0.15, thermal 0.10, logistics 0.05,
science 0.05. Every component is 0..100; `components.terrain` is a
backward-compatible alias of `components.safety`.

### Hard feasibility gate (zone autopilot)

A zone is only eligible as a real landing candidate when the mission is
physically feasible there. The gate is evaluated in
`computeLandingMetrics` → `evaluateZoneFeasibility` and exposed as
`entry.feasibility` (and the simple `entry.feasible` flag):

| Violation code | Trigger |
| --- | --- |
| `feasibility.powerDeficit` | solar: `powerMarginW < 0` (average solar power below load + average heater) |
| `feasibility.batteryInsufficient` | solar: `requiredBatteryWh > batteryCapacityWh`, where the battery is sized from the **longest continuous eclipse** |
| `feasibility.batteryNotSpecified` | solar: mission did not specify a battery; the documented 40,000 Wh default is used (warning, not fatal by itself) |
| `feasibility.illuminationInsufficient` | solar: `continuousSunDays < sunDaysNeeded` (disabled when `sunDaysNeeded = 0`) |
| `feasibility.rtgInsufficient` | RTG: `rtgPowerW < powerNeedW + heaterAveragePowerW` |
| `feasibility.thermalCold` | `heatedMinTempC < minOperatingTemperatureC` even with the heater at `heaterMaxW` |
| `feasibility.thermalHot` | `maxTempC > maxOperatingTemperatureC` |
| `feasibility.dataInsufficient` | `dataNeedMb` is specified and the estimated budget does not cover it |
| `feasibility.undetermined` | no terrain/ephemeris data to verify the mission (conservatively treated as not feasible) |

Power source model: `mission.powerSource = 'solar'` (default) applies the
solar/eclipse/battery/continuous-sun gates above. `mission.powerSource = 'rtg'`
with `mission.rtgPowerW` models a radioisotope generator: eclipses, solar
availability, battery sizing and the continuous-sun requirement do **not** gate
feasibility; the only power constraint is `rtgPowerW >= powerNeedW +
heaterAveragePowerW` (`feasibility.rtgInsufficient`). Thermal and data gates
still apply. `feasibility` exposes `powerSource`, `batterySpecified`,
`powerFeasible`, `batteryFeasible`, `thermalFeasible`, `dataFeasible`,
`illuminationFeasible`, `illuminationMeetsRequirement` and `rtgFeasible`.

Consequences:

- the reported score is capped at **55** (`rawScore` keeps the uncapped value,
  `scoreCapApplied` flags the cap);
- the grade is at most **conditional** (or `poor` below 45);
- violation reasons are prepended to `reasons` with severity `bad`;
- ranking is **feasible-first-then-score** (`meta.rankingRule`): all feasible
  zones rank before infeasible/undetermined ones, each group by score;
- meta exposes `feasibleZones`, `infeasibleZones`, `undeterminedZones`,
  `hasFeasibleZones`, `recommendedZoneId` (first feasible zone) and
  `feasibility.message` (`'ok'`, or `'no-feasible-zone'` when nothing is
  feasible). If no zone is feasible the best zone is still ranked #1 but is
  shown as conditional, never as a good site.

Metric naming (unambiguous; legacy aliases remain but must not be rendered
twice): `illumination.totalEclipseHours` (sum of all dark periods) vs
`illumination.longestEclipseHours` (single longest darkness);
`illumination.sunElevationMeanWindowDeg` vs `sunElevationMeanSunlitDeg`;
`thermal.heaterPowerSizedW` (eclipse rating) vs `heaterAveragePowerW` (window
average); `comms.earthVisibleFraction` (effective, relay included) vs
`directEarthVisibleFraction`, `maxLosGapHours` (effective gaps) vs
`directMaxLosGapHours`; `comms.dataBudgetRatio` (budget/need, may exceed 1)
instead of a percentage, with `dataBudgetCoverage` clamped to 0..1;
`safety.ellipse.requiredAreaKm2`/`availableAreaKm2` plus explicit
`requiredAreaM2`/`availableAreaM2`; panel area in m²; roughness/relief/distances
in m. `metrics.missionInputs` echoes the exact mission values used for the run
(`powerNeedW`, `batteryCapacityWh`, `heaterMaxW`, `heaterWPerK`, operating
temperatures, `missionDays`, `startTime`, `dataNeedMb`, `mastM`,
`relayInOrbit`), and every mission edit also changes `meta.inputSignature`.

Documented formulas/approximations:

- Thermal: `T = [ (1 − A)·S·sin(el) / (ε·σ) ]^(1/4)` for sunlit terrain
  (`σ = 5.670374419e-8`), fixed night/PSR temperatures for eclipse and
  permanently shadowed terrain, and `heaterWh = clip((minOperating − minTemp)·W/K,
  0, heaterMaxW) · eclipseHours`.
- Battery: `requiredBatteryWh = (powerNeedW + heaterPowerW)·eclipseHours /
  (batteryRoundTripEfficiency · batteryDepthOfDischarge)`.
- Landing ellipse: circular approximation `π·landingEllipseRadiusM²`; crater
  hazards and science proximity come from the DEM crater detector (a dedicated
  PSR raster is not shipped; PSR proximity is inferred from zero illumination).
- Ephemeris: each zone borrows the nearest curated site's precomputed dataset
  (`ephemeris-nearest-site` warning); the topocentric Earth parallax difference
  is <0.1° even across the 608 km wide DEM and the Sun is effectively
  unaffected, so the approximation is well inside the terrain-horizon
  uncertainty. Only the currently loaded DEM region is used.
- Missing data degrades gracefully: metrics are zeroed where impossible, explicit
  warnings (`data.ephemerisMissing`, `battery-capacity-not-specified`,
  `no-crater-hazard-data`, `psr-map-unavailable`, `zone.is-psr`, …) are attached
  and `confidence` is reduced instead of failing.

### `src/core/cycles.js`

- `computeMissionCycles({ terrain, site, ephemeris, mission, options }) -> cycles`
  — weekly sunlight/eclipse and Earth-link/no-link cycles over
  `mission.startTime` + `mission.missionDays`, clipped to the ephemeris coverage.
  Sun and Earth visibility use the **same ray-traced terrain horizon** (lunar
  curvature included) at a sampling step capped at 30 minutes; interval
  boundaries are bisection-refined, contiguous samples are merged and every row
  is a complete partition of the window clipped at both ends.
- Return shape: `window` (`startMs`, `endMs`, `start`, `end`, `days`, `weeks`,
  `clamped`); `weeks[]` with 7-day `index/startMs/endMs/start/end/days` plus
  hour summaries (`sunHours`, `eclipseHours`, `sunPeriods`, `eclipsePeriods`,
  `linkHours`, `gapHours`, `linkPeriods`, `gapPeriods`, `relayLinkHours`,
  `relayGapHours`, `relayBenefitHours`, fractions) and clipped interval arrays
  for rendering; `sunlight` (`intervals` with kind `sun|eclipse`, `sunHours`,
  `eclipseHours`, `eclipseCount`, `sunPeriods`, `sunFraction`); `direct`
  (`intervals` kind `link|gap`, `linkHours`, `gapHours`, `gapCount`,
  `linkPeriods`, `linkFraction`); `relay` (`enabled`, `coverage`,
  `periodMinutes`, `intervals` = effective availability, `linkHours`,
  `gapHours`, `gapCount`, `linkPeriods`, `benefitHours`, `benefitFraction`,
  `filledGapCount`, `relayOnlyIntervals`; empty intervals when disabled);
  `effective` (`enabled`, `source: 'direct'|'relay'`, intervals/hours) for the
  "Earth link with relay" row; `meta` (`modelVersion: 'mission-cycles/1'`,
  `inputSignature`, `computedAt`, `computeMs`, `site`, `terrainId`,
  `ephemerisSiteId`, `samplingSeconds`, `minIntervalSeconds`,
  `profileStepDeg`, `weekCount`, `warnings`, `assumptions`).
- Relay follows the documented `comms.js` time-fraction coverage model
  (`relayCoverage` per `relayPeriodMinutes`) unioned with the direct
  line-of-sight windows; `benefitHours` is the extra connected time. It is not
  an orbit propagation.
- Weeks are 7-day blocks measured from the mission start; first/last can be
  partial. Per-week period counts include intervals that cross a week boundary
  (they appear in both weeks), while hours always sum to the window totals.
- Visibility intervals shorter than the ephemeris resolution (≤30 min) are
  dropped as unresolvable sampling slivers.
- Performance target: <150 ms for 14 days with a cached horizon profile
  (measured on the wide 1024² DEM: ~44 ms cold including the horizon profile,
  ~5 ms warm).

Worker request (same protocol as `autopilot`/`landingZones`):

```js
// request
{ id, type: 'missionCycles', payload: { site, terrain, ephemeris, mission, options? } }
// response
{ id, type: 'result', payload: { window, weeks, sunlight, direct, relay, effective, meta } }
```

### `src/services/`

- `sites.js` — `loadSites()`, `createCustomSite({ lat, lon })`.
- `horizons.js` — loads `public/data/ephemeris/*`; `fetchLiveHorizons()` for dev.
- `lola.js` — `loadTerrain(region)`, DEM lookup helpers.
- `moontrek.js` — Moon Trek layer catalogue and tile/WMS URL builders.
- `export.js` — `buildBrief({ sites, mission, computation }) -> object` and JSON
  download helper; includes QuickMap and Moon Trek links.
- `storage.js` — persistence of sites, mission profile and locale in
  `localStorage`.

### `src/workers/compute.worker.js`

Single background CPU thread. Message protocol:

```js
// request
{ id, type: 'autopilot', payload: { sites, mission, region } }
// response
{ id, type: 'result', payload: { scores } }
// error
{ id, type: 'error', payload: { message } }
```

The worker also exposes the landing-zone autopilot (task type `landingZones`),
which ranks flat DEM zones instead of named POIs. The payload carries the
*currently loaded* terrain region (so results match the visible map) and is
answered with `{ zones, meta }`:

```js
// request
{ id, type: 'landingZones', payload: { terrain, sites, mission, ephemeris?, maxZones?, options? } }
// response
{ id, type: 'result', payload: { zones, meta } }
```

## UI interfaces (ui)

- `src/render/moonScene.js` — `createMoonScene(canvas, options)` returns
  `{ setTerrain, setSites, setSunDirection, setEarthDirection, setLayers, dispose }`.
- `src/render/fallback2d.js` — `createFallback2D(canvas)` with the same setters
  (map view, sun azimuth indicator, site markers).
- Feature panels are Vue components under `src/components/`.
- i18n catalogues in `src/i18n/en.js` and `src/i18n/es.js`; every visible string
  must exist in both languages.

## Feature map

| # | Feature | Modules |
| --- | --- | --- |
| 1 | Site selection (CSA Moon Explorer style POIs) | services/sites, components |
| 2 | Custom coordinates or pointer; LOLA altitude; Horizons bodies | engine/terrain, ephemeris |
| 3 | Site comparator (Horizons + LOLA, perimeter, mast) | autopilot, components |
| 4 | Dates and times | ephemeris |
| 5 | Sun/Earth vs horizon, ray tracing and curvature (`engine.js`) | engine |
| 6 | Time remaining until Sunset/Earthset | ephemeris |
| 7 | Power and communications | power, comms |
| 8 | Layers (Moon Trek) | moontrek |
| 9 | Real topography and craters (LOLA DEM, PDS) | terrain, lola |
| 10 | Autopilot algorithm (flat landing zones from the LOLA DEM, mission characteristics, power, relay, sun days) | autopilot, zones, zoneAutopilot |
| 11 | Background worker (single CPU thread) | workers |
| 12 | Adapter for PCs without WebGL | render/fallback2d |
| 13 | Orbital variation | ephemeris |
| 16 | Weekly sunlight and link/relay cycles | cycles |
| 14 | English/Spanish UI | i18n |
| 15 | JSON brief export (QuickMap, Moon Trek) | export |

## Testing and conventions

- Tests: Vitest unit and contract suites for the domain core and services; the
  strategy and executed results are in [qa.md](qa.md).
- Language: all code, comments, documentation and commit messages in English.
- Imports: absolute imports via the `@/` alias are not configured; use relative paths.
- Security: no secrets in the repository; keys live in a local `.env` (see
  [security.md](security.md)).
- Collaboration workflow, commit conventions and branch rules:
  [contributing.md](contributing.md).
