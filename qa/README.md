# Monte Carlo test bench

Automated, randomised stress-testing for **L-SEA Space Apps** (NASA Space Apps
Challenge · Málaga 2026, Challenge 10 — *Lunar Landing Site Navigator*).

Two independent runners share one contract (`SPEC.md`), one device matrix
(`devices.json`) and one tag taxonomy (`tags.json`). Every test case and every
executed result is **tagged**, and results can be **filtered** by tag, status and
device class.

| Runner | What it exercises | Output |
| --- | --- | --- |
| `logic/logic-mc.mjs` | The real scientific core (`src/core/*`) and data services, with tens of thousands of randomised site / date / mission scenarios | `results/logic-mc-*.json` + `.md` |
| `ui/ui-matrix.mjs` | The real production build in headless Chrome, emulating every device/resolution box in EN and ES (plus the no-WebGL fallback) | `ui/results/ui-matrix-*.json` + `.md` + `ui/results/shots/*.png` |

The aggregators turn results into a **self-contained, offline, filterable HTML
report** (`run-all.mjs`) and can re-filter existing results without re-running
(`filter-results.mjs`).

## Layout

```text
qa/
├── SPEC.md            # the contract: scenarios, invariants, UI checks, tagging, acceptance
├── devices.json       # device "boxes": desktop/laptop/tablet/mobile/foldable/TV, portrait+landscape, DPR
├── tags.json           # tag namespaces and filter semantics
├── REPORT.md          # digest of the executed runs and their findings
├── logic/
│   ├── logic-mc.mjs       # seeded Monte Carlo runner (workers, CLI, repro by --seed/--case)
│   ├── logic-worker.mjs   # worker thread entry
│   ├── probe-bench.mjs    # quick throughput probe
│   └── lib/               # PRNG, scenario generator, invariant checks, file-backed fetch
└── ui/
    ├── ui-matrix.mjs      # headless-Chrome CDP device/resolution matrix
    ├── filter-results.mjs # re-filter JSON results (md/json/html/summary)
    └── run-all.mjs        # merge logic + UI results → summary.md + index.html
```

`qa/**/results/` is generated and **git-ignored**.

## Requirements

- Node.js 24 (no npm dependencies are added by the harness).
- Google Chrome / Chromium available as `google-chrome` (UI matrix only).
- The repository's own dependencies installed (`npm ci`) for the UI matrix.

## Usage

### Logic Monte Carlo

```bash
# full profile: 20,000 randomised cases, 72 azimuth samples (writes qa/results/)
cd qa/logic
node logic-mc.mjs --trials 20000 --profile full

# fast profile (36 azimuths), custom seed, tag/status filters on the output
node logic-mc.mjs --trials 2000 --profile quick --seed 20261114
node logic-mc.mjs --trials 2000 --profile quick --tag @inv/scoring --exclude-tag @speed/slow

# reproduce one case exactly
node logic-mc.mjs --seed 20261114 --case 6000
```

### Device / UI matrix

```bash
# every box in devices.json, EN + ES, plus the no-WebGL probes
node qa/ui/ui-matrix.mjs

# subsets by tag or by id; filter the report
node qa/ui/ui-matrix.mjs --devices @device/mobile
node qa/ui/ui-matrix.mjs --devices mob-390x844,desk-1920x1080 --locale en
node qa/ui/ui-matrix.mjs --tag @device/mobile --exclude-tag @device/desktop
```

The runner builds the application if `dist/` is stale and serves it with
`npm run preview`; Chrome is driven through the Chrome DevTools Protocol (no
browser-automation dependency).

### Filtering and aggregated report

```bash
# re-filter existing JSON results (include = AND, exclude = ANY)
node qa/ui/filter-results.mjs --tag @device/mobile --status fail --format md

# merge the latest logic + UI results into a filterable report
node qa/ui/run-all.mjs
node qa/ui/run-all.mjs --tag @device/mobile
```

`run-all.mjs` writes `ui/results/summary.md` and a self-contained
`ui/results/index.html` (tag checkboxes by namespace, status/device/search
filters, screenshot links) that opens offline, with no CDN.

## Tags

See `tags.json` for the full taxonomy. Main namespaces:

- `@level/logic`, `@level/ui` — runner level.
- `@inv/*` — logic invariants (no-NaN, bounds, determinism, round-trip, horizon
  consistency, visibility, set events, windows, power, comms, scoring, ranking,
  cache neutrality).
- `@ui/*` — UI checks (overflow, boxes-in-viewport, console errors, panels,
  interactive targets, font readability).
- `@device/*`, `@orientation/*`, `@res/<w>x<h>`, `@dpr/*`, `@tier/*` — the box.
- `@feature/*` — application feature exercised.
- `@status/pass|fail|warn|skip` — attached to executed results.
- `@speed/fast|slow` — expected runtime class.

## Determinism and reproduction

- Every logic case stores its `seed`, `index` and inputs; rerun with
  `--seed <seed> --case <index>`.
- Results record the repository git SHA, so a report is always tied to a commit.
- Generated results are not committed; run the commands above to reproduce them.

## Limitations

- UI emulation is not a real-device lab: there is no iOS Safari engine and no
  real touch.
- Headless Chrome has no GPU; for very large 3-D buffers the matrix exercises the
  documented no-WebGL 2D fallback deterministically (recorded per run as
  `probe: layout-2d-fallback`). 78 of 104 runs used the real 3-D path.
- The harness never modifies the application: findings are reported, not fixed.

See `REPORT.md` for the executed runs, their numbers and the findings.
