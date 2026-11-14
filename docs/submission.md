# Submission

Content and checklist for the official NASA Space Apps **Project page**, plus the
links and evidence the team submits. Everything below is in English, as required.

> **Status (2026-11-14):** application implemented, tested, merged on `main` and
> deployed. Live application: <https://l-sea-space-apps.vercel.app>. Automated tests:
> 104 application tests in 7 files plus 8 MCP tests, all passing; CI green; production
> build green. The only outstanding item before **Submit for Judging** is the
> **Project Demo link**.

## 1. Project identity

| Field | Value |
| --- | --- |
| Project name | L-SEA Space Apps, Lunar Landing Site Navigator |
| Short form for the form | L-SEA, Lunar Landing Site Navigator |
| Challenge | Lunar Landing Site Navigator (challenge 10, partner agency CSA) |
| Event | NASA International Space Apps Challenge, Málaga 2026 |
| Repository | <https://github.com/rafaa-sf/l-sea-space-apps> |
| Live application | <https://l-sea-space-apps.vercel.app> |
| Project Demo | Single public link, at most 7 slides or a 30-second video (content in [demo.md](demo.md)); link pending |
| Team | L-SEA (no names of minors) |

## 2. Summary (50-200 words)

> L-SEA Space Apps is a browser-based tool for comparing lunar south-pole landing
> sites and dates, built for the NASA Space Apps Challenge Málaga 2026 and challenge
> 10, "Lunar Landing Site Navigator". Landing on the Moon's south pole means trading
> sunlight for power, Earth visibility for direct communications, and terrain that
> hides the horizon. Mission planners face these trade-offs whenever a launch date or
> landing site changes, but the data sits in tools built for specialists. Our design
> puts site selection, Sun and Earth positions relative to the horizon, time to sunset
> or earthset, power and communications windows, and an autopilot site scorer in one
> interface for mission planners and educators, with a bilingual EN/ES UI and a JSON
> mission-brief export. The repository ships real NASA LOLA terrain and uses
> pre-computed JPL Horizons ephemerides so it runs as a static site, with a 2D fallback
> for machines without WebGL. The prototype is implemented and merged on `main`: a
> mission-control interface, a terrain and horizon engine, ephemeris-driven Sun and
> Earth visibility, power and communications metrics, a site comparator, autopilot
> scoring, JSON export and a no-WebGL 2D fallback; 104 app tests plus 8 MCP tests pass
> and CI is green.

Word count: 197 (limit 50-200). Re-count after any edit with `wc -w`.

## 3. Detailed description

### 3.1 What it does

L-SEA Space Apps answers one question fast and in comparable terms: **can we land
here on that date?**

For a lunar south-pole mission the answer depends on three coupled environments:

- **Terrain**: the local horizon is set by topography, not by a flat geometric
  horizon. The Moon has no atmosphere, so there is no refraction; the horizon is
  terrain plus the lunar limb.
- **Sun**: solar elevation drives power generation and thermal conditions; the time
  until sunset sets the usable surface duration.
- **Earth**: Earth elevation determines whether direct-to-Earth communications are
  possible or a relay is needed; the time until Earthset sets the communications
  deadline.

The tool is a rapid scenario-comparison surface: pick candidate sites (curated or
custom coordinates), pick landing dates, and compare illumination, Earth visibility,
power and communications side by side, including the time remaining until sunset or
Earthset. An autopilot scorer ranks sites against a mission profile (mission length,
power need, relay availability, required sunlight days), and the result can be
exported as a JSON mission brief with links back to NASA tools.

### 3.2 How it works (method and tools)

| Layer | Technology and method |
| --- | --- |
| UI | Vue 3 (Composition API), mission-control shell with 11 feature panels, English and Spanish |
| 3D view | Three.js scene, with a Canvas 2D fallback when WebGL is unavailable |
| Domain core | Plain JavaScript ES modules: terrain, horizon and ray tracing, ephemeris, power, communications, autopilot |
| Compute | Single Web Worker for horizon and scoring work, keeping the UI responsive |
| Build | Vite static build (`dist/`), deployed on Vercel |
| Tests | Vitest: 104 application tests in 7 files plus 8 MCP tests |
| Data | Pre-computed NASA datasets: LOLA terrain, JPL Horizons ephemerides, Moon Trek layer catalogue |

Method in one pass over a scenario:

1. **Site input**: curated south-pole points of interest (in the spirit of the CSA
   Moon Explorer catalogue), custom latitude/longitude, or a terrain pointer.
2. **Terrain sampling**: convert latitude/longitude to polar-stereographic grid
   coordinates and sample the LOLA DEM bilinearly; compute local slope and aspect.
3. **Horizon**: for each azimuth, the maximum terrain elevation angle from the site,
   including the lunar-curvature correction; compare the Sun and Earth topocentric
   elevations with the horizon.
4. **Ephemeris**: sample the pre-computed Sun/Earth azimuth-elevation time series,
   interpolate, and produce visibility windows and time to sunset or Earthset.
5. **Mission metrics**: solar power estimate from Sun elevation and terrain;
   communications windows for direct-to-Earth or relay; data budget.
6. **Scoring and comparison**: rank sites against the mission profile and show the
   trade-offs side by side.
7. **Export**: JSON mission brief including QuickMap and Moon Trek links.

### 3.3 Benefits

- **Faster trade studies.** One comparison surface instead of navigating several
  specialist tools and interpreting raw data, the gap stated by the challenge.
- **Resilience to schedule change.** Re-answers "which alternative site or date
  still works?" when a launch date slips.
- **Honest constraints made visible.** Marginal sunlight or communications windows
  show up before commitment, not during operations.
- **Accessible by design.** Bilingual EN/ES, a 2D fallback without WebGL,
  static and install-free, usable by educators and the public as well as specialists.
- **Traceable output.** The JSON brief carries the inputs and scenarios used and
  links back to QuickMap and Moon Trek for verification.

### 3.4 Development status (2026-11-14)

**Built, merged on `main` and deployed:**

- Vue 3, Vite and Three.js application with the mission-control interface, 11 feature
  panels and English plus Spanish message catalogues.
- Domain core, services, Web Worker, Three.js renderer and no-WebGL 2D fallback
  implemented and unit-tested.
- Real NASA datasets shipped and consumed by the application: 10 curated POIs, 10
  JPL Horizons ephemeris files (2,928 samples each), two LOLA polar DEM regions and 21
  verified Moon Trek WMTS layers.
- Automated test suite: 104 application tests in 7 files plus 8 MCP tests, all
  passing; CI green; production build green.
- Live deployment on Vercel with post-deploy verification (entry point, favicon, NASA
  data files, terrain binary, SPA rewrite, cache headers) and an interactive live
  end-to-end check (worker, site selection, comparator, 2D fallback, autopilot,
  JSON brief export) recorded in [qa.md](qa.md).

**Remaining before submission:** the public Project Demo link (slides or video); see
[demo.md](demo.md).

### 3.5 Limitations (stated up front)

- **Validation status.** The application is implemented and passes its automated and
  live end-to-end checks. Horizon and illumination results have not yet been compared
  against live JPL Horizons reference values, and no formal usability testing has been
  performed.
- **Static deployment.** There is no server runtime, so there are no live NASA API
  calls: ephemerides are pre-computed, and JPL Horizons cannot be queried from the
  browser in production because it does not send CORS headers.
- **Terrain resolution.** The shipped grids are downsampled for the web: 74.06 m/px
  (87.5S-90S, default) and 593.75 m/px (80S-90S, wide area). Fine-scale horizon errors
  near the site are possible; the source LOLA products are 20 m/px and 80 m/px.
- **Data volume.** The committed NASA data is about 13.4 MB (terrain about 10.5 MB,
  ephemerides about 2.8 MB), and the whole `dist/` output is about 20 MB including
  JavaScript bundles and sourcemaps. First load on a slow connection is a real
  user-experience risk and a planned optimisation (lazy-loading and tiling).
- **Ephemeris scope.** The shipped datasets bound the dates the tool can answer for:
  2026-11-01 to 2026-12-31. The interface shows the validated range rather than
  extrapolating silently.
- **Physics simplifications.** No atmospheric refraction (correct for the Moon); the
  power and communications models are simplified engineering estimates.
- **Automated tests.** The unit and contract suites cover the core geometry, terrain,
  ephemeris, power, communications, autopilot and service adapters; the UI is covered
  by the live end-to-end check rather than by component-level tests, and accuracy
  against live Horizons is not yet asserted.
- **No commercial validation.** No customer interviews, pricing evidence or
  market-size figures are claimed anywhere in this submission; the commercial framing
  is explicitly a set of hypotheses (see [commercial.md](commercial.md)).

## 4. NASA Data

For Global Awards the team must use at least one NASA resource from the challenge and
explain its real contribution. Three NASA resources are central; LOLA is the one
shipped and validated.

### 4.1 NASA LOLA (Lunar Orbiter Laser Altimeter) south-pole DEM

- **What it is:** LRO LOLA polar gridded topographic products from NASA/GSFC,
  archived by the NASA Planetary Data System (PDS) Geosciences Node.
- **Products used:** `ldem_875s_20m.jp2` (7584 x 7584, 20 m/px, 87.5S-90S) and
  `ldem_80s_80m.jp2` (7600 x 7600, 80 m/px, 80S-90S), from the PDS Geosciences Node
  LRO LOLA gridded data records. Attribution shipped in the metadata:
  `NASA/GSFC/LOLA (PDS Geosciences Node)`.
- **What is shipped:** two web-ready polar-stereographic grids (latitude of origin
  -90 degrees, central meridian 0, reference radius R = 1,737,400 m; int16
  little-endian, row-major; elevations in metres relative to that radius):

  | Region ID | Role | Grid | Pixel size | Coverage | Elevation range |
  | --- | --- | --- | --- | --- | --- |
  | `south-pole-875s-20m` | high-resolution (default) | 2048 x 2048 | 74.0625 m | plus/minus 75,840 m (87.5S-90S) | -4,378 to +2,369 m |
  | `south-pole-80s-80m` | wide area | 1024 x 1024 | 593.75 m | plus/minus 304,000 m (80S-90S) | -7,274 to +7,001 m |

- **Real contribution:** this is the terrain the tool samples for site elevation,
  slope and aspect, crater detection, horizon angles (including lunar curvature) and
  ray-terrain intersection. Without LOLA the tool would be a generic Sun/Earth
  calculator; with it, two sites a few kilometres apart can produce different answers.
- **Verification evidence (2026-11-14):** both binary files match their declared
  dimensions and byte sizes; derived pixel sizes match the metadata; decoded elevation
  ranges match the declared values exactly; the edge radius agrees with 87.5S and 80S
  within 19.6 m (0.27 px) and -5.6 m respectively; cross-region agreement over 1,600
  paired samples gives Pearson r = 0.9993, mean absolute difference 28.8 m and maximum
  233 m. Full detail in [qa.md](qa.md).
- **Link:** [PDS Geosciences Node, LRO LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm).

### 4.2 NASA JPL Horizons System

- **What it is:** the JPL Horizons system, the reference source for high-precision
  positions of solar-system bodies, using the DE441 ephemeris.
- **Real contribution:** topocentric Sun and Earth azimuth/elevation for each site and
  epoch, the input to time-to-sunset and Earthset, visibility windows and Earth
  visibility. Because production is static and Horizons does not send CORS headers,
  the team ships pre-computed ephemeris datasets under `public/data/ephemeris/`,
  consumed by `src/core/ephemeris.js`; the Vite dev proxy `/nasa/horizons` is used
  only during development to validate against live Horizons.
- **Link:** [JPL Horizons System](https://ssd.jpl.nasa.gov/horizons/).

### 4.3 NASA Moon Trek

- **What it is:** NASA's Moon Trek portal for lunar data visualisation and mission
  planning.
- **Real contribution:** 21 verified south-polar WMTS layers (LOLA relief and slope,
  LROC imagery, illumination percentage, Earth visibility, permanently shadowed
  regions, Diviner temperature, Artemis III site mosaics) shown in the application,
  plus Moon Trek deep links in the JSON brief so a planner can continue in the
  authoritative tool.
- **Link:** [NASA Moon Trek](https://trek.nasa.gov/moon/).

### 4.4 LROC QuickMap (complementary)

The challenge brief names NASA QuickMap alongside Moon Trek and JPL Horizons. The
JSON mission brief includes QuickMap deep links for cross-checking, so the tool
complements QuickMap rather than replacing it. External reference:
[LROC QuickMap](https://quickmap.lroc.asu.edu/) (LROC, Arizona State University).

## 5. Other data and references

| Reference | Type | Use |
| --- | --- | --- |
| Challenge brief (challenge 10, Lunar Landing Site Navigator) | Challenge statement | Problem definition, objectives, data and accuracy considerations |
| Málaga 2026 challenge wallpapers | Event material | Confirms the local Spanish challenge name "Navegador de aterrizaje lunar" and tags |
| Málaga 2026 participant guide (Spanish, summary in [challenge.md](challenge.md)) | Rules | Deliverables, demo limits, English requirement, AI declarations, privacy, submission process |
| Málaga 2026 judges guide | Event material (Spanish) | Judge profiles and local judging lenses, mapped in [commercial.md](commercial.md) |
| Artemis III candidate landing regions and site coordinates | Published literature | POI coordinates and provenance, cited per entry in [data.md](data.md) |
| CSA Moon Explorer | Comparable tool (external) | Inspiration for the curated points-of-interest experience |
| Vue 3, Three.js, Vite, vue-i18n, Vitest | Software libraries | Application stack; all permissive open-source licences, versions in `package.json` |
| NASA LOLA/PDS, JPL Horizons, Moon Trek, LROC QuickMap | NASA/partner data | Datasets, endpoints, licences and attribution in [data.md](data.md) |

No commercial market data, customer data or third-party imagery is used. No paid
assets were purchased. The repository does not redistribute NASA imagery beyond the
transformed terrain grids and data files required by the application.

## 6. AI / SI use

The solution was built with an AI-assisted agent workflow (DeepSeek Harness agent
sessions coordinating research, implementation, review and documentation). The full
declaration, including the tools used and the human responsibilities, is in
[ai-usage.md](ai-usage.md) and is served by the application at `/data/ai-usage.md`.
All AI-generated content was reviewed by the team, which remains responsible for the
decisions, verification and authorship of the submission. No AI-generated media with
identifiable people is included.

## 7. Readiness checklist

Mapped to the official Project page fields (see [challenge.md](challenge.md) for the
source rules):

| Requirement | Status | Artifact |
| --- | --- | --- |
| Project name and 50-200 word summary | Done | Section 2 (194 words) |
| Project Demo: one public link, at most 7 slides including cover or at most 30 seconds of video | **Pending** | [demo.md](demo.md); the link is the only outstanding item |
| Final Project: public link to the project, repository or site | Done | Live application and repository links in section 1 |
| Detailed description: what it does, how it works, benefits, method, status and limitations | Done | Section 3 |
| NASA Data: resources, links and their real contribution | Done | Section 4 and [data.md](data.md) |
| Other data and references | Done | Section 5 |
| AI / SI use declaration | Done | Section 6 and [ai-usage.md](ai-usage.md) |
| Language: page, slides and written materials in English | Done | This document set |
| Public access: links open without login, password or permission | Done for the app; demo link pending | Live application verified from the deployed build |
| Review and acceptance: correct team, checkboxes, Submit for Judging confirmation | Pending platform action | Submit for Judging |

## 8. Submission steps

1. Verify the live application in a private browser window (no login or permissions).
2. Finish and publish the Project Demo as a single public link (slides or video) and
   insert it in the Project page and in section 1 of this document.
3. Copy the Project page fields (sections 1 to 6) into the NASA platform.
4. Run the last-30-minutes checklist in [challenge.md](challenge.md).
5. Press **Submit for Judging** and keep the confirmation.
6. If any content changes before the deadline, save, submit again and confirm again.

## 9. Link inventory

| Purpose | URL |
| --- | --- |
| Live application | <https://l-sea-space-apps.vercel.app> |
| Repository | <https://github.com/rafaa-sf/l-sea-space-apps> |
| Documentation | <https://github.com/rafaa-sf/l-sea-space-apps/tree/main/docs> |
| Project Demo | Pending: single public link, at most 7 slides or a 30-second video |
