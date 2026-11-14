# Autopilot / ranking Monte Carlo

Exercises the real mission autopilot (`src/core/autopilot.js`: `scoreSite`,
`rankSites`, `rankingSummary`) over the real datasets (10 curated POIs, LOLA
DEMs, JPL Horizons ephemerides) with a matrix of **mission needs**:

`baseline`, `comms-low`, `comms-heavy`, `comms-extreme`, `relay`,
`power-heavy`, `power-extreme`, `sun-hungry`, `short-mission`,
`long-mission`, `multi-need`.

For every date it ranks the ten sites under each profile and verifies:

| Check | Meaning |
| --- | --- |
| score / component / confidence validity | finite values inside their documented ranges |
| ordering | sorted best-first, ranks contiguous 1..N, no null scores |
| determinism | identical inputs produce an identical ranking |
| need monotonicity | harder sun/power/data requirements never **improve** that component (equal-window comparisons); relay never reduces connectivity |
| ranking responsiveness | top-1 changes and rank correlation against the baseline profile |
| saturation and ties | components pinned at 100 and equal scores (score is rounded to 0.1) |
| degenerate missions | zero/negative/huge needs, a one-hour mission, relay with no data need |
| invalid site | a NaN site must be reported as an error entry, not crash the ranking |
| randomized sweep | 150 random missions; increasing power/sun/data needs must not improve the matching component |

## Usage

```bash
# quick profile (coarse 30° horizon sampling, 1 h mission step) — fast
node qa/autopilot/autopilot-mc.mjs --dates 3 --seed 20261114

# full app defaults (1° horizon, 300 s step) — slow, exact
node qa/autopilot/autopilot-mc.mjs --dates 3 --seed 20261114 --quick false
```

Results are written to `qa/autopilot/results/` (git-ignored). Exit code 1 means
at least one invariant failed.

## Findings

See [`FINDINGS.md`](FINDINGS.md) for the executed run, the weaknesses it found
(ranking insensitivity to data/power needs, relay saturation, ties) and the
recommendations.
