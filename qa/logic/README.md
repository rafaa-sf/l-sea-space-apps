# Monte Carlo logic harness (L-SEA)

Massive randomised testing of the L-SEA scientific core and data services, per
[`../SPEC.md`](../SPEC.md) §3 and the tag taxonomy in [`../tags.json`](../tags.json).

The harness is a **read-only consumer** of the application repository
the repository root: it imports the real
`src/core/index.js` barrel and the real `lola` / `horizons` / `sites` services,
passing a file-backed `fetchImpl` that serves `public/data/**` from disk. No
network, no npm dependencies, no writes inside the repo, no git writes.

## Files

| File | Purpose |
| --- | --- |
| `logic-mc.mjs` | CLI runner (batch Monte Carlo, single-case repro, filters, JSON/MD output) |
| `logic-worker.mjs` | Worker-thread entry: loads the real modules/data once, executes scenario chunks |
| `lib/file-fetch.mjs` | `fetchImpl` over the repo `public/` directory (returns real `Response` objects, cached) |
| `lib/prng.mjs` | mulberry32 PRNG + per-case seed derivation (`caseSeedFor(seed, index)`) |
| `lib/scenario.mjs` | SPEC §3 scenario generation (site/date/mission/region/edge/degraded) |
| `lib/checks.mjs` | The 13 `@inv/*` invariants, tolerances, and per-case feature tags |
| `probe-bench.mjs` | Throwaway timing probe used to size the run (not part of the contract) |

## Usage

```bash
node logic-mc.mjs --trials 20000 --profile full
node logic-mc.mjs --trials 100000 --profile quick --workers 10
node logic-mc.mjs --seed 20261114 --case 4242            # exact repro of one case
node logic-mc.mjs --trials 500 --profile quick --tag @feature/terrain
node logic-mc.mjs --trials 500 --profile quick --exclude-tag @speed/slow
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--trials <n>` | 20000 | Number of random scenarios |
| `--seed <n>` | 20261114 | PRNG seed; `case n` is fully determined by `seed + index` |
| `--case <n>` | — | Run exactly one case, print its checks + repro command, write `results/logic-mc-case-<n>-seed-<seed>.json` |
| `--profile full\|quick` | full | Azimuth profile: full = 72 azimuths (5°), quick = 36 (10°) |
| `--max-azimuths <n>` | — | Explicit azimuth count (overrides `--profile`) |
| `--region both\|hi\|wide` | both | Site sampling region |
| `--tag <t>` | — | Include filter, repeatable, **AND** semantics |
| `--exclude-tag <t>` | — | Exclude filter, repeatable, **ANY** semantics |
| `--workers <n>` | min(10, cpu−2) | Worker threads |
| `--chunk <n>` | 100 | Cases per worker chunk (keep small enough to use all workers) |
| `--out <path>` | `results/logic-mc-<utcstamp>.json` | Output path (`.md` written next to it) |

Output JSON contains `meta` (repo `gitSha`, commit date, node, seed, profile,
workers, tolerances, filters, data inventory, invalid tags), `summary` (totals,
per-invariant pass/fail/warn/skip, per-feature and per-region/edge/degraded
counts, case-duration stats, up to 100 reproducible failures) and `cases` (every
included case with tags, inputs, per-check `tag/status/detail`, durationMs).
The MD file is the human summary with the reproducible failure list.

## Determinism and reproducibility

`caseSeed = caseSeedFor(seed, index)` (splitmix32-style avalanche) depends only on
the run seed and the case index, not on worker count or chunking. Therefore:

- results are deterministic for a fixed seed and trial count (same cases, same
  order, same checks);
- any case can be reproduced alone:
  `node logic-mc.mjs --seed 20261114 --case 1234`.

Trial `n` of a batch is bit-identical to `--case n` with the same seed.

## Scenarios (SPEC §3)

- **Site:** uniform `lat ∈ [-90, -80]`, `lon ∈ [0, 360)`; 30 % forced inside a
  curated POI (small jitter inside its terrain region); 10 % exactly on a DEM
  region boundary; 5 % exactly at the south pole; 5 % longitude-wrap cases
  (`lon = 0`, `359.999999`, and an explicit `360` input); both LOLA regions are
  covered naturally (reported per region) and can be forced with `--region`.
- **Date/time:** uniform in the ephemeris range
  (`2026-11-01T00:00:00Z … 2026-12-31T23:30:00Z`); 10 % snapped exactly to the
  30-minute sample grid, the rest deliberately off-grid (linear interpolation).
- **Mission:** `missionDays ∈ {7,14,28}`, `powerNeedW ∈ [40,320]`,
  `sunDaysNeeded ∈ [0,14]`, `perimeterM ∈ [50,500]`, `mastM ∈ [0,20]`,
  `relayInOrbit ∈ {true,false}`, random `startTime` and `dataNeedMb`.
- **Degraded paths (~4 %):** missing terrain, missing ephemeris, or both — the
  modules must report warnings and keep finite/complete results.
- **Ephemeris dataset:** real topocentric Horizons dataset of the POI itself for
  curated sites; for random sites the **nearest POI dataset** is used (the
  static app ships exactly ten per-site datasets — documented approximation).

## Invariants (13, tagged `@inv/*`)

| Tag | What is checked |
| --- | --- |
| `@inv/no-nan` | Recursive scan of all outputs for `NaN`/`±Infinity` |
| `@inv/bounds` | site/horizon/slope/score/component/confidence ranges, grade validity, longitude normalisation |
| `@inv/roundtrip` | `lonLatToXY` ⇄ `xyToLonLat` < 1e-9° (longitude skipped exactly at the poles), DEM sample finite inside coverage |
| `@inv/horizon-consistency` | `horizonAngleAt(profile, az)` ≡ direct `horizonAngle(terrain, site, az)` (< 1e-6°) on profile-grid azimuths |
| `@inv/horizon-monotonicity` | profile resolution **72 vs 36** azimuths: horizon difference ≤ 6° and visibility decision equal outside a 6° graze band. Failures only at DEM-boundary sites are downgraded to `warn` with an explicit detail (known sampling limitation at the data edge) |
| `@inv/visibility-consistency` | `isSunVisible`/`isEarthVisible` ≡ `sunVisibility`/`earthVisibility`/`evaluateBodyVisibility`/`bodyStateAt` ≡ `el > horizonAngleAt(profile, az)`, margin arithmetic exact |
| `@inv/set-events` | `nextSetEvent`/`nextRiseEvent`: returned time ≥ `from`, body state at the event is below/above the horizon within 0.25°, `remainingSeconds` consistent |
| `@inv/windows` | windows ordered, non-overlapping, inside `[from,to]`, non-negative durations, total ≤ span, `visibilityStatistics` totals match |
| `@inv/power` | `solarPowerEstimate` finite, `averageW ≤ peakW`, non-negative energy, `sunlitFraction ∈ [0,1]`, missing-ephemeris path flagged |
| `@inv/comms` | `commWindows` valid/ordered/sourced, `dataBudget` non-negative, availability fraction ∈ [0,1] |
| `@inv/scoring` | `scoreSite` finite 0..100, valid grade/components/confidence/warnings; degraded calls (no terrain / no ephemeris) do not throw and set warnings |
| `@inv/ranking` | `rankSites` order equals score order, ranks numbered, `rankingSummary` counts/recommended consistent |
| `@inv/cache-neutrality` | `clearHorizonCache()` then recompute `scoreSite`/profile → bit-identical score, components, grade, confidence, angles |

Checks that need terrain/ephemeris are reported as `skip` on degraded cases
(instead of a false failure).

## Tags and filtering

Every case carries `@level/logic`, `@mc`, `@invariant`, `@speed/fast|slow`,
`@seed/<seed>`, its `@feature/*` set, one `@inv/*` tag per check, and the result
adds `@status/pass|fail|warn`. Include filters are AND; exclude filters drop a
case if any excluded tag is present. Example counts:

```bash
node logic-mc.mjs --trials 2000 --profile quick --tag @feature/terrain
node logic-mc.mjs --trials 2000 --profile quick --exclude-tag @speed/slow
```

## Performance

Measured on this machine (12 logical cores, Node v24.22.3): **~75–82
cases/s** with 10 workers and `--chunk 100` (quick profile, ~123 ms CPU per
case). `--chunk` values that exceed `trials / workers` under-use the worker pool
(e.g. chunk 500 with 2 000 trials runs only 4 workers) — keep chunk ≈ 100.

The 20k full-profile run and the 100k quick run wall times are reported in the
`results/logic-mc-*.md` files produced by those runs.

## Limits / honest notes

- Emulation of the scientific core, not a real-device lab; UI is covered by the
  separate device-matrix runner (`../ui/`).
- Reference-profile comparison at DEM boundaries is intrinsically sensitive to
  azimuth sampling; such `@inv/horizon-monotonicity` findings are surfaced as
  `warn` with the measured degrees, never silently dropped.
- No network; the dev-only Horizons proxy is not exercised (production must not
  depend on it).
- `clearHorizonCache()` is a documented no-op in the current engine; the
  cache-neutrality check still verifies bit-identical recomputation.
