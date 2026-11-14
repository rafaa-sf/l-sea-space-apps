# Architecture

Technical contract for the L-SEA Space Apps application. It is the reference for
all teammates; changes to a public interface are coordinated through the Lead.

## Stack

| Layer | Technology |
| --- | --- |
| UI framework | Vue 3 (Composition API, `<script setup>`) |
| 3D view | Three.js |
| Build tool | Vite |
| i18n | vue-i18n (English and Spanish) |
| Tests | Vitest |
| Deployment | Static build (`dist/`) on GoDaddy hosting |

No TypeScript: plain JavaScript ES modules.

## Runtime constraints

- The deployed application is **static**. There is no runtime server, so
  browser calls to NASA services that do not send CORS headers (JPL Horizons)
  cannot be made in production.
- Strategy: **pre-computed NASA datasets** downloaded by scripts and stored in
  `public/data/`. The Vite dev server proxies `/nasa/horizons` for optional live
  queries during development only.
- The application must work **without WebGL** (two-dimensional fallback).

## Repository layout and ownership

| Path | Owner | Contents |
| --- | --- | --- |
| `src/core/` | coder | Pure domain logic: geometry, engine, terrain, ephemeris, power, comms, autopilot |
| `src/services/` | coder | Data access and integration adapters (Horizons data, LOLA, Moon Trek, export, sites) |
| `src/workers/` | coder | Background Web Worker (single CPU thread) |
| `src/components/` | ui | Vue components and feature panels |
| `src/render/` | ui | Three.js scene and no-WebGL fallback renderer |
| `src/i18n/` | ui | English and Spanish message catalogues |
| `src/styles/` | ui | Global styles and design tokens |
| `src/App.vue`, `src/main.js`, `index.html` | ui | Application shell and bootstrap |
| `docs/` | commander + Lead | Project documentation |
| `scripts/nasa/` | commander | Data acquisition scripts for NASA sources |
| `public/data/` | commander | Pre-computed datasets (ephemeris, terrain, POIs, layers) |
| `.github/`, `docs/deployment.md` | reviewer-pusher | CI and deployment documentation |
| `package.json`, `vite.config.js` | Lead | Build configuration (changes coordinated with the Lead) |

Only `reviewer-pusher` runs git write commands (`add`, `commit`, `push`).

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
}
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
| 10 | Autopilot algorithm (mission characteristics, power, relay, sun days) | autopilot |
| 11 | Background worker (single CPU thread) | workers |
| 12 | Adapter for PCs without WebGL | render/fallback2d |
| 13 | Orbital variation | ephemeris |
| 14 | English/Spanish UI | i18n |
| 15 | JSON brief export (QuickMap, Moon Trek) | export |

## Conventions

- All code, comments, documentation and commit messages in **English**.
- Absolute imports via the `@/` alias are **not** configured; use relative paths.
- No secrets: NASA API keys live in `.env` (see `docs/security.md`).
