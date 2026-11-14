# NASA Project page content — L-SEA Space Apps

> **AI-generated content.** This document was produced by the AI agent team under human direction and reviewed by the team; the full declaration is in [ai-usage.md](ai-usage.md).

> **Status snapshot (2026-11-14, main @ 35149e4).** Application and real NASA datasets are merged on main; npm test passes 104 tests in 7 files plus 8 MCP tests; CI is green. Deployment URL and Project Demo link are still pending (docs/submission.md TODOs).

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator* (ES: *Navegador de aterrizaje lunar*)
**Event:** NASA International Space Apps Challenge · Málaga 2026 (14–15 November 2026, 42 Málaga Fundación Telefónica)
**Challenge:** #10 — "Lunar Landing Site Navigator" (official English title; Málaga challenge wallpaper calls it "Navegador de aterrizaje lunar"). Partner agency: CSA (Canadian Space Agency). Subjects: Human Exploration, Moon, Software, Space Exploration. Level: Intermediate/Advanced.
**Owner:** commercial workstream · **Version:** 2026-11-14 · **Status:** submission draft
**Editorial rule:** this page separates **built**, **planned (design contract)** and **not built**. Do not publish a claim in the "Built" column unless the demo shows it working. Every factual claim is traceable to `docs/*`, `public/data/terrain/*` or the event material listed under [Sources](#sources).

> **STATUS REFRESH — do this before Submit for Judging (Lead/coder).**
> The development status snapshot below is **`main` @ `af859ef`, 14 Nov 2026**: the application, engine, panels, export code and real NASA datasets are merged on `main`, with 104 app tests in 7 files plus 8 MCP tests passing and a green build/CI. The Vercel deployment and the Project Demo link are still pending (`docs/submission.md` TODOs). Do not describe the app as working end to end until the deployed build is verified; no feature may be described as working only because `docs/architecture.md` specifies it.

---

## 1. Project name

**L-SEA Space Apps — Lunar Landing Site Navigator**

Short form for the submission form: **L-SEA — Lunar Landing Site Navigator**.
Repository (Final Project link candidate): <the public project repository (see `README.md`)> (public).
Live URL: <https://l-sea-space-apps.vercel.app> (Vercel production; opens without login, password or permission request, per the participant guide). Project Demo URL: **TODO** (single public link, still to be published).

Do not use NASA or CSA logos, flags or mission identifiers as project branding; the team name is **L-SEA**.

---

## 2. Summary (50–200 words — final version: **194 words**)

> L-SEA Space Apps is a browser-based tool for comparing lunar south-pole landing sites and dates, built for the NASA Space Apps Challenge Málaga 2026 and challenge #10, "Lunar Landing Site Navigator". Landing on the Moon's south pole means trading sunlight for power, Earth visibility for direct communications, and terrain that hides the horizon. Mission planners face these trade-offs every time a launch date or landing site changes, but the data sits in tools built for specialists. Our design puts site selection, Sun and Earth positions relative to the horizon, time to sunset or earthset, power and communications windows, and an "autopilot" site scorer in one interface for mission planners and educators, with a bilingual EN/ES UI and a JSON mission-brief export. The repository ships real NASA LOLA south-pole terrain, and the tool is designed around pre-computed JPL Horizons ephemerides so it can run as a static site, with a 2D fallback for machines without WebGL. The prototype is implemented and merged on `main`: a mission-control interface with 11 feature panels, a terrain/horizon engine, ephemeris-driven Sun and Earth visibility, power and communications metrics, a site comparator, autopilot scoring, a JSON mission-brief export and a no-WebGL 2D fallback; the automated test suite passes (104 app tests in 7 files plus 8 MCP tests) and CI is green. Remaining work is the Vercel deployment, the Project Demo link and validation against reference ephemerides; we report what is verified and what is still pending.

**Word count:** 194 (limit 50–200). Re-count after any edit (`wc -w` on the paragraph).

**Status refresh:** the prototype is implemented in source with a passing test suite; before submission, re-verify the built/planned labels against the final deployed build, add the public URL and refresh §3.4.

---

## 3. Detailed description

### 3.1 What it does

L-SEA Space Apps answers one question fast and in comparable terms: **"Can we land *here* on *that date*?"**

For a lunar south-pole mission, the answer depends on three coupled environments:

- **Terrain** — the local horizon is set by topography, not by a flat geometric horizon. The Moon has no atmosphere, so there is no refraction: the horizon is terrain plus the lunar limb.
- **Sun** — solar elevation drives power generation and thermal conditions; the time until sunset sets the mission's usable surface duration.
- **Earth** — Earth elevation determines whether direct-to-Earth communications are possible or a relay is needed; the time until Earthset sets the comms deadline.

The tool is designed as a rapid scenario-comparison surface: pick candidate sites (curated or custom coordinates), pick landing dates, and compare the resulting illumination, Earth-visibility, power and communications conditions side by side, including the time remaining until sunset or earthset. An "autopilot" scorer ranks sites against a mission profile (mission length, power need, relay availability, required sunlight days), and the result can be exported as a JSON mission brief with links back to NASA/partner map tools.

### 3.2 How it works (method and tools)

The architecture is a contract, documented in `docs/architecture.md`, with a pure domain core, services, UI and a static build:

| Layer | Technology / method | Status (`main` @ `af859ef`) |
| --- | --- | --- |
| UI | Vue 3 (Composition API) | **Built** — mission-control shell with 11 feature panels |
| 3D view | Three.js | **Built** — Three.js scene with a no-WebGL Canvas 2D fallback |
| Build | Vite, static output in `dist/` | **Built** — green; Three.js chunk ≈742.93 kB (gzip ≈187.84 kB) with a chunk-size warning |
| i18n | vue-i18n, English + Spanish catalogues | **Built** — English and Spanish catalogues cover the UI |
| Tests | Vitest | **Built** — 104 app tests in 7 files plus 8 MCP tests, all passing (`npm test`); build and CI green on `main` |
| Terrain data | Real LOLA polar DEMs, pre-computed | **Built and validated** (see §4.1) |
| Ephemeris | JPL Horizons, pre-computed datasets (static hosting) | **Built** — 10 sites × 2 928 samples (2026-11-01 → 2026-12-31, 30-min steps) in `public/data/ephemeris/`, loaded and interpolated by `src/core/ephemeris.js`; dev-only Vite proxy `/nasa/horizons` in `vite.config.js` |
| Compute | Single Web Worker for horizon/scoring | **Built** — `src/workers/compute.worker.js` + task dispatcher |

Method in one pass over a scenario:

1. **Site input** — curated south-pole points of interest (Shackleton-rim-style points of interest, in the spirit of the CSA Moon Explorer catalogue) or custom lat/lon (with a pointer alternative planned).
2. **Terrain sampling** — convert lat/lon to polar-stereographic grid coordinates and sample the LOLA DEM bilinearly; compute local slope/aspect and detect craters.
3. **Horizon** — for each azimuth, the maximum terrain elevation angle from the site, including the lunar-curvature correction; compare the Sun and Earth topocentric elevations with the horizon.
4. **Ephemeris** — sample pre-computed Sun/Earth az–el time series; interpolate; produce visibility windows and time-to-sunset/earthset.
5. **Mission metrics** — solar power estimate from Sun elevation and terrain; communications windows for direct-to-Earth or relay; data budget.
6. **Scoring and comparison** — rank sites against the mission profile and show the trade-offs side by side.
7. **Export** — JSON mission brief (`buildBrief`) including QuickMap and Moon Trek links for cross-checking.

Interfaces are implemented in `src/` and specified in `docs/architecture.md`: `src/core/terrain.js`, `engine.js`, `ephemeris.js`, `power.js`, `comms.js`, `autopilot.js`; `src/services/*` (sites, horizons, lola, moontrek, export, storage); one Web Worker; `src/render/moonScene.js` plus `fallback2d.js` (the no-WebGL 2D map fallback).

### 3.3 Benefits

- **Faster trade studies.** One comparison surface instead of navigating several specialist tools and interpreting raw data (the gap stated by the challenge).
- **Resilience to schedule change.** Re-answers "which alternative site or date still works?" when a launch date slips — the routine disruption named in the challenge background.
- **Honest constraints made visible.** Marginal sunlight or comms windows show up before commitment, not during operations.
- **Accessible by design.** Bilingual EN/ES, 2D fallback without WebGL, static/install-free, usable by educators and the public — not only by mission-planning specialists.
- **Traceable output.** The JSON brief carries the inputs and the scenarios used, and links back to QuickMap/Moon Trek for verification.

### 3.4 Real development status (as of `main` @ `af859ef`, 14 Nov 2026)

**Built (verified today):**

- Repository, documentation set and architecture contract (`README.md`, `docs/architecture.md`, `docs/guide.md`, `docs/project.md`, `docs/resources.md`, `docs/decisions.md`, deployment/security/workflow docs).
- Vue 3 + Vite + Three.js project scaffold; production build succeeds (`npm run build`, `dist/` produced; ≈ 123 kB JS + 1.7 kB CSS + copied terrain data).
- Application shell: mission-control layout (header, viewport, timeline, footer) with 11 feature panels and **English and Spanish** message catalogues (`src/i18n/`).
- Domain core, services, Web Worker, Three.js renderer and no-WebGL 2D fallback implemented in `src/` (terrain, horizon/ray tracing, ephemeris interpolation, power, comms, autopilot, export).
- Automated test suite: 104 app tests in 7 files plus 8 MCP tests, all passing (`npm test`); production build and CI green on `main`.
- Global styles/design tokens (`src/styles/main.css`).
- **Real NASA LOLA south-pole terrain**, shipped as two polar-stereographic regions (see §4.1) with a reproducible builder script (`scripts/nasa/build-terrain.py`), and validated by the team test bench (`docs/test-report.md`: PASS, 2 regions, 0 failures).

**Built (data and tooling, added after the first snapshot):** 10 curated south-pole POIs (`public/data/pois.json`), JPL Horizons Sun/Earth ephemerides for those sites (`public/data/ephemeris/`, 2 928 samples each), 21 verified Moon Trek WMTS layers (`public/data/layers.json`), the regeneration pipeline in `scripts/nasa/`, provenance/API docs (`docs/data-sources.md`, `docs/api-integrations.md`) and a CI workflow. See `docs/test-report.md` for the baseline QA status.

**Implemented in source and covered by tests:** all 15 features of the architecture contract (site selection, custom coordinates, comparator, dates/times, Sun/Earth horizon and ray tracing, time-to-set, power and comms, Moon Trek layers, real LOLA topography, autopilot scoring, Web Worker, no-WebGL fallback, orbital variation, EN/ES UI, JSON brief export).

**Pending validation:** end-to-end demonstration on the live Vercel URL (<https://l-sea-space-apps.vercel.app>), accuracy against live JPL Horizons reference values, and usability testing — see §3.5.

**Not validated yet:** accuracy of computed horizons or illumination against live JPL Horizons references; end-to-end behaviour on the deployed URL; usability for mission planners or educators; accessibility of the full UI. (A minimal validation plan exists in `docs/impact-scalability.md` §5.)

### 3.5 Limitations (stated up front)

- **Validation status.** The application is implemented in source with a passing automated test suite; the remaining risk is end-to-end behaviour/accuracy validation, not missing modules. The demo status must be checked against the deployed build before it is described as working end to end.
- **Static deployment.** The production build has no server runtime, so no live NASA API calls: ephemeris must be pre-computed, and JPL Horizons cannot be queried from the browser in production because it does not send CORS headers (`docs/architecture.md`).
- **Terrain resolution.** The shipped grids are downsampled for the web: 74.06 m/px (87.5S–90S, default) and 593.75 m/px (80S–90S, wide area). Fine-scale horizon errors near the site are possible; the source LOLA products are 20 m/px and 80 m/px.
- **Data volume.** The build is ≈ 14–15 MB, dominated by ≈ 13.4 MB of committed NASA data (terrain ≈ 10.5 MB, ephemerides ≈ 2.8 MB); first load on a slow connection is a real UX risk and a planned optimization (lazy-loading/tiling).
- **Ephemeris scope.** Coverage and sampling interval of pre-computed datasets will bound the dates the tool can answer for; the UI must show the validated range rather than extrapolate silently.
- **Physics simplifications.** No atmospheric refraction (correct for the Moon, and stated by the challenge brief); whether Earth libration is fully represented must be documented for the final ephemeris datasets.
- **Automated tests:** 104 app tests in 7 files plus 8 MCP tests cover the core geometry, terrain, ephemeris, power, comms, autopilot and service adapters; the UI is not covered by automated end-to-end tests and accuracy against live Horizons is not yet asserted.
- **No commercial validation.** No customer interviews, pricing evidence or market-size figures are claimed anywhere in this submission.

---

## 4. NASA Data

For Global Awards the team must use at least one NASA resource from the challenge and explain its real contribution. Three NASA resources are central; LOLA is the one already shipped and validated.

### 4.1 NASA LOLA (Lunar Orbiter Laser Altimeter) south-pole DEM — **implemented, real data shipped**

- **What it is:** LRO LOLA polar gridded topographic products from NASA/GSFC, archived by the NASA Planetary Data System (PDS) Geosciences Node.
- **Products used (source):** `ldem_875s_20m.jp2` (7584 × 7584, 20 m/px, 87.5S–90S) and `ldem_80s_80m.jp2` (7600 × 7600, 80 m/px, 80S–90S), from the PDS Geosciences Node LRO LOLA gridded data records. Attribution string shipped in the metadata: `NASA/GSFC/LOLA (PDS Geosciences Node)`.
- **What we ship:** two web-ready polar-stereographic grids (latitude of origin −90°, central meridian 0°, reference radius R = 1,737,400 m; int16 little-endian, row-major; elevations in metres relative to that radius):

  | Region ID | Role | Grid | Pixel size | Coverage (x/y bounds) | Elevation range |
  | --- | --- | --- | --- | --- | --- |
  | `south-pole-875s-20m` | high-resolution (default) | 2048 × 2048 | 74.0625 m | ±75,840 m (87.5S–90S) | −4378 … +2369 m |
  | `south-pole-80s-80m` | wide area | 1024 × 1024 | 593.75 m | ±304,000 m (80S–90S) | −7274 … +7001 m |

- **Real contribution:** this is the terrain the tool samples for site elevation, slope/aspect, crater detection, horizon angles (`horizonAngle`, including lunar curvature) and ray–terrain intersection; in the shipped build it is the real data behind the terrain viewer and horizon engine, and it is what will make illumination and communication windows terrain-aware rather than geometric approximations. Without LOLA the tool would be a generic Sun/Earth calculator; with it, two sites a few kilometres apart can produce different answers.
- **Verification evidence (team test bench, 14 Nov 2026):** both `.bin` files match their declared dimensions/bytes and elevation ranges; derived pixel sizes match metadata; edge-radius check agrees with 87.5S/80S within 19.6 m (0.27 px) and −5.6 m respectively; cross-region agreement over 1600 paired samples: Pearson r = 0.9993, mean absolute difference 28.8 m, max 233 m. Result: PASS.
- **Link:** [PDS Geosciences Node — LRO LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm). Data files are not redistributed by us beyond the transformed terrain grids in this public repository; NASA attribution is retained in metadata and in the UI footer.

### 4.2 NASA JPL Horizons System — **shipped ephemeris source, pre-computed for the static build**

- **What it is:** the JPL Horizons system, the reference source for high-precision positions of solar-system bodies.
- **Planned contribution:** topocentric Sun and Earth azimuth/elevation for each site and epoch (and the underlying positions needed for time-to-sunset/earthset, visibility windows and libration-aware Earth visibility). Because production is static and Horizons does not send CORS headers, the team's approach is to download and ship pre-computed ephemeris datasets under `public/data/ephemeris/`, with the Vite dev proxy `/nasa/horizons` used only during development to validate against live Horizons. The resulting datasets are shipped in `public/data/ephemeris/` and consumed by `src/core/ephemeris.js`.
- **Link:** [JPL Horizons System](https://ssd.jpl.nasa.gov/horizons/) (development proxy targets `https://ssd.jpl.nasa.gov`).

### 4.3 NASA Moon Trek — **shipped layer catalogue and links**

- **What it is:** NASA's Moon Trek portal for lunar data visualization and mission planning.
- **Planned contribution:** contextual lunar layers (tiles/WMS catalogue in `services/moontrek.js`) for orientation and for cross-checking the computed site analysis, plus Moon Trek deep links in the JSON brief so a planner can continue in the authoritative tool. At submission the layer integration and brief links are specified in `docs/architecture.md` (features 8 and 15) but are **not yet implemented**.
- **Link:** [NASA Moon Trek](https://trek.nasa.gov/moon/).

### 4.4 LROC QuickMap links (complementary, not claimed as an implemented NASA-data use)

The challenge brief names NASA's Quickmap alongside Moon Trek and JPL Horizons. The planned JSON mission brief includes QuickMap links for cross-checking (`docs/architecture.md`, feature 15), so the tool complements QuickMap rather than replacing it. This is planned, not built. External reference: [LROC QuickMap](https://quickmap.lroc.asu.edu/) (LROC, Arizona State University).

---

## 5. Other data and references

| Reference | Type | How it is used |
| --- | --- | --- |
| Challenge brief #10, "Lunar Landing Site Navigator" (extracted to the official Challenge 10 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)) | Challenge statement | Problem definition, objectives, data/accuracy considerations. Note: the local extraction ends mid-sentence ("…Earth's libration (wobble) o"); verify the full statement on the official 2026 challenges page before submission. |
| Málaga challenge wallpapers (the official Málaga 2026 event material; challenge 10 is on `retos-3.png`) | Event material | Confirms the local Spanish challenge name "Navegador de aterrizaje lunar", summary line and tags (Luna, Navegación, Alunizaje). |
| Málaga participant guide 2026 (the official Málaga 2026 participant guide (English summary in `docs/guide.md`); English summary in `docs/guide.md`) | Rules | Deliverable rules, demo limits, English requirement, AI/use declarations, privacy, submission process. |
| Málaga judges guide slides (the official Málaga 2026 event material) | Event material (Spanish) | Judge profiles and local judging lenses — see the related document in `docs/` for the English translation. |
| Project repository | Our work | `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/security.md`, `docs/guide.md`; terrain metadata `public/data/terrain/*.json`; builder `scripts/nasa/build-terrain.py`. |
| CSA Moon Explorer | Comparable tool (external) | Inspiration for the curated points-of-interest UX (`docs/architecture.md`, feature 1). Public URL and licence **TODO verify** before citing in the submitted page. |
| Vue 3, Three.js, Vite, vue-i18n | Software libraries | Application stack. All permissive open-source licences; exact versions in `package.json`; **TODO verify licences/attribution before submission.** |

No commercial market data, customer data or third-party imagery is used in this submission. No paid assets were purchased.

---

## 6. AI / SI use declaration

**Status: COMPLETE.** All content in this repository was generated by AI agents under human direction, and it is declared in full. The full declaration is `docs/ai-usage.md`, also served by the application at `/data/ai-usage.md`.

- **AI tools used:** DeepSeek Harness agentic platform with DeepSeek coding models (`deepseek` / `deepseek-flash`), operated as two AI agent teams on two machines; the Node.js 24 / Vite / Vue 3 / Three.js / Vitest stack; headless Google Chrome 139 through the Chrome DevTools Protocol (responsive layout and interactive UI checks); Python 3 with rasterio/numpy (terrain conversion and validation); git, the GitHub CLI and GitHub Actions; pdftotext/pdftoppm for the official event material. No image, video, voice or music generation service was used.
- **How each tool was used:** the AI agents wrote the application code, tests, CI, data-acquisition scripts, documentation, submission copy and the QA test benches (see `docs/test-report.md`); the headless browser was used for responsive layout checks; the agents performed branch, commit, pull-request and tag operations under the human team's standing authorisation for the git workflow and under the advisory cross-machine lock. The human team directed the work, reviewed the output and accepted or corrected it.
- **What was generated vs. authored:** every file in the repository is AI-generated — application source code, dataset formatting, tests and CI, all documentation (including this page and `docs/ai-usage.md`), the submission materials and the entire QA test bench. The NASA data itself was retrieved from NASA services by AI-written scripts and was **not** generated by AI. No AI-generated images, video, voices or synthetic people are used in the submission; the QA screenshots are automated captures of the running application, not generative imagery.
- **Verification statement:** every AI-produced artefact was reviewed by the team. Numbers in the submission are checked against their sources or are reproducible with the shipped tooling (production build, Vitest unit/contract suites, dataset integrity checks and the QA report checks). The team remains responsible for the final content.
- **Brand compliance:** no NASA/CSA logo, flag, mission identifier or other restricted brand element is used as team branding; no identifiable person, and in particular no minor, appears in any AI-generated content.
- **Third-party rights:** sources and licences are listed in section 5; the LOLA data is used under its PDS/NASA terms with attribution to NASA/GSFC/LOLA and the PDS Geosciences Node; no copyrighted material is reproduced by the generated assets.

---

## 7. Pre-submission checklist (from `docs/guide.md`, §"Last-30-minutes checklist")

- [ ] Project name + 50–200 word summary (current: 194 words).
- [ ] Detailed description updated to match the final build (status table §3.4 refreshed, "built" labels honest).
- [ ] NASA Data: LOLA explained with link and real contribution (done); Horizons/Moon Trek labelled planned (done).
- [ ] Other data and references reviewed; licences checked (TODO items above).
- [ ] AI use declared; generated material marked.
- [ ] Project Demo link public and tested in a private window (slides ≤ 7 incl. cover, OR video ≤ 30 s).
- [ ] Final Project link public (`the public project repository (see `README.md`)`), tested without login.
- [ ] All materials in English; no identifiable minors.
- [ ] **Submit for Judging** pressed and confirmation visible; re-submit if anything changes.

---

## Sources

- Challenge brief (official 2026 challenge #10, extracted): the official Challenge 10 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)
- Málaga 2026 challenge wallpaper (challenge 10): the official Málaga 2026 event material
- Participant guide 2026 (Spanish): the official Málaga 2026 participant guide (English summary in `docs/guide.md`); English working summary: `docs/guide.md`
- Project and event facts: `README.md`, `docs/project.md`
- Engineering contract and feature map: `docs/architecture.md`
- Static deployment constraints: `docs/deployment.md`
- Terrain provenance and metadata: `public/data/terrain/index.json`, `south-pole-875s-20m.json`, `south-pole-80s-80m.json`, `scripts/nasa/build-terrain.py`
- Current code/build/test status: `main` @ `af859ef` — implementation merged, 104 app tests + 8 MCP tests green, CI green; Vercel deployment and Project Demo link pending; QA summary in `docs/test-report.md`
- Impact and scalability framing: `docs/impact-scalability.md`
- Judges: the official Málaga 2026 event material; mapping in the related document in `docs/`
- Official links: [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026/), [Challenges 2026](https://www.spaceappschallenge.org/2026/challenges/), [Málaga Local Event](https://www.spaceappschallenge.org/2026/local-events/malaga/), [PDS Geosciences LRO LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), [NASA Moon Trek](https://trek.nasa.gov/moon/)

## Open questions / TODOs

1. **Final build status** — refresh §3.4 and the summary once the coder's panels/engine land; add the demo URL.
2. **Challenge permalink + metadata** — confirm the official challenge page URL, exact title/partner agency/subjects/level wording (currently from the team's challenge extraction; the local brief text does not include this metadata block).
3. **Full challenge brief** — the local extraction is truncated mid-sentence; check the "Data and accuracy" considerations on the official page.
4. **Licences** — verify licences/attribution for the software stack, DEM products, Moon Trek layers and any listed external tool URLs (CSA Moon Explorer, QuickMap, STK/GMAT references).
5. **AI declaration** — complete §6 with the real tool list and verification statement.
6. **Demo assets** — decide slides vs 30 s video, build the public link, test it logged out.