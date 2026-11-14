# Monte Carlo test bench — specification (contract)

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator* (NASA Space Apps Málaga 2026, Challenge 11)
**Owner:** Lead (contract, review, final run) · **Implementers:** test bench (`testbench`) for the logic engine; coordination (`commander`) for the device/UI matrix + report
**Date:** 2026-11-14 · **Version:** 1

---

## 1. Goal

Stress the application with a **massive randomised (Monte Carlo) test bench** and a **device/resolution matrix** covering PCs at every common resolution and mobile devices (portrait/landscape), then **tag every test and result** and provide **filtering**.

Two runners, one shared contract:

| Runner | What it simulates | Owner |
| --- | --- | --- |
| `logic-mc.mjs` | The scientific core (`src/core/*`) + data services, with tens of thousands of random site/date/mission scenarios | test bench |
| `ui-matrix.mjs` | The real built app in headless Chrome, emulating every *device box* (viewport, DPR, mobile/touch) and measuring layout boxes | coordination |

Shared files (this directory):

- `SPEC.md` — this contract.
- `devices.json` — device/resolution **boxes** (viewport + DPR + mobile/touch + tags).
- `tags.json` — tag taxonomy and filter semantics.
- `results/` — runner outputs (JSON + Markdown + filterable HTML).

**Hard constraints**
- The harness is a **read-only consumer of this repository**: do not modify the application code, configuration or data from a test run.
- Test artefacts (results, screenshots) are generated under `qa/**/results/`, which is git-ignored.
- Uploading to GitHub later is a **separate, user-authorised step** (Lead only).
- Tagging/filtering must be real: every case/result carries tags from `tags.json`; the CLI filters by include (AND) / exclude (ANY); the HTML report filters visually.

---

## 2. Determinism and runs

- Seeded PRNG (e.g. mulberry32) with a documented `--seed` (default `20261114`).
- Each case stores `index`, `seed`, `tags`, `inputs`, per-check `tag/status/detail`, `durationMs`.
- A failing case must be reproducible with `--seed <seed> --case <index>`.
- Runners record `gitSha` of the repo checkout (read-only) and the source commit date.
- Parallelism is allowed internally but results must be deterministic for a fixed seed and trial count.

---

## 3. Logic Monte Carlo runner (`logic-mc.mjs`)

**Import strategy:** Node ESM; import the real modules by path (`../../src/core/index.js` from `qa/logic/`). The browser services use `fetch`; provide a **file-backed fetchImpl** that reads `public/data/...` from disk and returns `Response`-like objects, so the real loaders (`loadEphemeris`, `loadTerrain`) and the real core are exercised — not copies.

**Scenario generation (random per trial):**
- site: `lat` uniform in [-90, -80]; `lon` uniform [0, 360); 30 % of cases forced inside a curated POI (from `public/data/pois.json`), 10 % exactly on a region edge/boundary.
- date/time: uniform in the ephemeris range (currently 2026-11-01 → 2026-12-31, 30-min steps, interpolated off-grid on purpose).
- mission profile: `missionDays` ∈ {7, 14, 28}, `powerNeedW` ∈ [40, 320], `sunDaysNeeded` ∈ [0, 14], `perimeterM` ∈ [50, 500], `mastM` ∈ [0, 20], `relayInOrbit` ∈ {true, false}.
- region: both LOLA regions (`south-pole-875s-20m`, `south-pole-80s-80m`) must be covered roughly proportionally to site coverage.

**Invariants (each is a check with its own `@inv/*` tag):**

| Tag | Assertion |
| --- | --- |
| `@inv/no-nan` | No `NaN`/`±Infinity` in any returned scalar/boolean/array |
| `@inv/bounds` | `slopeDeg ∈ [0,90]`, horizon angles ∈ [-90,90], `power ≥ 0`, windows ordered, `score ∈ [0,100]`, grade valid, lat ∈ [-90,90], lon ∈ [0,360) |
| `@inv/roundtrip` | `lonLatToXY` → `xyToLonLat` roundtrip error < 1e-9 deg; `sampleElevation` inside bounds is finite |
| `@inv/horizon-consistency` | `horizonAngleAt(profile, az)` equals direct `horizonAngle(terrain, site, az)` within 1e-6 (for a sample of azimuths) |
| `@inv/horizon-monotonicity` | For fixed site/az, sampled horizon angle is invariant to azimuth sampling density within tolerance (profile resolution ≥ 36 gives the same visibility decision as 72) |
| `@inv/visibility-consistency` | `isSunVisible/isEarthVisible` agree with `evaluateBodyVisibility/sunVisibility/earthVisibility` and with `body.el > horizonAngleAt(profile, body.az)` within documented tolerance |
| `@inv/set-events` | `nextSetEvent` returns time ≥ `from`; body not visible at the event instant (within one step tolerance); `nextRiseEvent` symmetric |
| `@inv/windows` | windows non-overlapping, ordered, within `[from,to]`; total duration ≤ span |
| `@inv/power` | `solarPowerEstimate` finite, `averageW ≤ peakW`, `dailyWh ≥ 0` |
| `@inv/comms` | `commWindows` valid; `dataBudget.totalSeconds ≥ 0`, `estimatedMb ≥ 0` |
| `@inv/scoring` | `scoreSite` finite 0..100, deterministic; `warnings`/`confidence` consistent; score does not throw with missing terrain/ephemeris (degraded path) |
| `@inv/ranking` | `rankSites` order equals `scoreSite` order sorted by score; `rankingSummary` counts consistent |
| `@inv/cache-neutrality` | `clearHorizonCache()` then recompute → identical results |

**Scale:** default `--trials 20000` (must be able to run 100000+). Azimuth resolution default 72, configurable; a `--profile quick` may reduce to 36. Target wall time for 20k trials: ≤ 10 min on this machine (report actual).

**Edge cases included:** poles (lat = -90), region boundary sites, longitude 0/360 wrap, dates exactly on sample points and between them, zero/negative-ish mission inputs, sites outside the high-res region, sites near the DEM edge.

**Outputs:** `results/logic-mc-<utcstamp>.json`, `results/logic-mc-<utcstamp>.md` (summary by tag/feature/invariant, failure list with seeds), plus a `--case <n>` repro mode.

---

## 4. Device/UI matrix runner (`ui-matrix.mjs`)

**Build/preview:** run the real production build (`npm run build` if `dist/` is stale) and serve it with `npm run preview -- --port <port> --strictPort` (or a static server); wait for readiness; stop it at the end. Record the URL and the git SHA.

**Headless Chrome via CDP** (no extra npm deps required; use `--remote-debugging-port` + WebSocket, as the existing QA scripts do). For each box in `devices.json`:

1. `Emulation.setDeviceMetricsOverride` (width, height, dpr, `mobile`, `screenWidth/Height`).
2. `Emulation.setTouchEmulationEnabled` when `touch`.
3. Navigate to the app, wait for network idle / a stable selector.
4. Collect: **console errors/warnings**, page exceptions, failed requests.
5. Measure **layout boxes**: bounding rects of `header`, `main`, `footer`, viewport container, timeline bar, and every visible panel; viewport scroll metrics.
6. Checks (each with `@ui/*` tag):
   - `@ui/no-horizontal-overflow`: `documentElement.scrollWidth <= clientWidth + 1` and no element extends past the viewport horizontally by > 1 px.
   - `@ui/no-vertical-overflow`: app shell fits the intended scroll model (content may scroll vertically, but no horizontal scroll from it and no clipped fixed bars).
   - `@ui/boxes-in-viewport`: every measured box is within the viewport (x ≥ -1, y ≥ -1, right ≤ width+1, bottom ≤ height+1) or inside an explicit scroll container.
   - `@ui/no-console-errors`: zero console errors and page exceptions.
   - `@ui/panels-rendered`: expected landmarks/panels present (count ≥ expected minimum).
   - `@ui/interactive-targets`: buttons/links ≥ 24×24 CSS px (report violations with the box id).
   - `@ui/fonts-readable`: no computed font-size < 10 px in visible text nodes.
7. Take one screenshot per box (`results/shots/<device-id>-<locale>.png`).
8. Run locales `en` and `es` (toggle the language switch if present; otherwise `--lang`/localStorage) — every box must render in both.
9. Also probe the **no-WebGL fallback** (disable WebGL via CDP or a flag) for at least the desktop + mobile extremes.

**Scale:** all boxes in `devices.json` (currently 51) × 2 locales = ~102 UI runs; must support filtering a subset (`--devices @device/mobile`, `--devices mob-390x844,desk-1920x1080`).

**Outputs:** `results/ui-matrix-<utcstamp>.json`, `results/ui-matrix-<utcstamp>.md`, screenshots.

---

## 5. Tagging and filtering

- Tags come from `tags.json` namespaces only (`@level`, `@type`, `@inv`, `@feature`, `@device`, `@orientation`, `@res`, `@dpr`, `@tier`, `@ui`, `@status`, `@speed`).
- Logic cases carry: `@level/logic`, `@mc`, one `@type/@invariant`, one or more `@inv/*`, one or more `@feature/*`, `@seed/<n>`, `@speed/*`; results add `@status/*`.
- UI cases carry: `@level/ui`, `@matrix`, `@type/@matrix`, `@device/*`, `@orientation/*`, `@res/<w>x<h>`, `@dpr/*`, `@tier/*`, `@feature/render3d|render2d|i18n`; results add `@status/*` and `@ui/*` per check.
- **Filtering CLI:** every runner and the aggregator accept repeatable `--tag <t>` (include, AND semantics) and `--exclude-tag <t>` (drop if present). `--status pass|fail|warn` filters by result.
- **Aggregator** `run-all.mjs`: runs both runners (or reads latest), merges results, applies filters, writes:
  - `results/summary.md` — totals, pass/fail by tag, top failures, seed/repro info.
  - `results/index.html` — **self-contained, filterable report** (no CDN): tag checkboxes + status/device/search filters, table of cases with tags and details, links to screenshots. Must work offline by opening the file.
- `filter-results.mjs`: re-filter existing JSON results without re-running (`--tag`, `--exclude-tag`, `--status`, `--format md|json|html`).

---

## 6. Acceptance criteria

1. `logic-mc.mjs --trials 20000` completes, writes JSON/MD, and reports: 0 crashes, 0 invariant failures (or an explicit, reproducible failure list), per-tag summary, actual duration.
2. `ui-matrix.mjs` runs **all** device boxes × EN/ES: 0 horizontal-overflow failures, 0 console errors, boxes measured and stored, one screenshot per run.
3. Every result carries valid tags; include/exclude filters demonstrably change the output counts.
4. `run-all.mjs --tag @device/mobile` and `--exclude-tag @speed/slow` produce correctly filtered summaries.
5. `results/index.html` opens offline and filters by tag/status/device.
6. The harness lives under `qa/` and does not modify the application; generated results are git-ignored.

---

## 7. Ownership and sequencing

1. **Lead:** this contract + `devices.json` + `tags.json`; final run; review; upload decision.
2. **testbench:** `logic-mc.mjs` + edge cases + `results/logic-mc-*` (start now, independent).
3. **commander:** `ui-matrix.mjs` + screenshots + `filter-results.mjs`/`run-all.mjs` + filterable HTML report (start now; needs only the preview build + devices.json).
4. **Lead:** integrate, run the full suite at the end, fix gaps, report to the user with filtered results, and **ask permission before uploading anything** to GitHub.

---

## 8. Non-goals

- Not a real-device lab (emulation only; no iOS Safari engine, no real touch).
- No NASA network calls in tests (offline datasets only).
- Not a full WCAG audit (basic size/readability checks only).
- No changes to application code — findings are reported, not fixed by QA.
