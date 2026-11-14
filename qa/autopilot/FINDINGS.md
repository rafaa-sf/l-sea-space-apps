# Autopilot / ranking Monte Carlo — findings

Run: 2026-11-14, seed `20261114`, 11 profiles × 3 mission dates × 10 curated
sites = **33 rankings** (330 scores), plus **150 randomized missions** and the
edge-case missions below. Harness: [`autopilot-mc.mjs`](autopilot-mc.mjs)
(app-default 1° horizon, 300 s mission step).

## What passes

- **0 invariant failures**: every score is finite and inside 0–100, every
  component inside 0–100, confidence inside 0–1, ranking sorted best-first with
  contiguous ranks and one entry per site.
- **Determinism**: identical inputs produce identical scores and ranks.
- **Need monotonicity** (equal-window comparisons): increasing the power
  requirement never improves the power component; increasing the sun requirement
  never improves the sun component; increasing the data requirement never
  improves the comms component; enabling a relay never reduces connectivity.
  The 150-mission randomized sweep produced **0 monotonicity violations**.
- **Degenerate inputs**: zero/negative needs, a one-hour mission, huge needs
  (1e6 W, 1e9 MB, 365 days) and relay-without-data all score without NaN or
  throws.
- **Invalid site**: a NaN latitude is reported as an error entry (`score: null`,
  `rank: null`, `error`) and does not break the ranking.

## Weaknesses observed

1. **Mission-aware weighting is missing (main weakness).** The five weights are
   fixed (`sun 0.30, power 0.20, comms 0.25, terrain 0.15, logistics 0.10`) and do
   not depend on the mission profile. Consequences:
   - *Comms-hungry missions barely change the ranking*: `comms-heavy` and
     `comms-extreme` (6 GB / 40 GB of data) produce the same top site as the
     baseline in 2 of 3 dates (mean rank correlation **0.956–0.964**), and the
     top site's direct Earth-visibility fraction is identical (**0.493**).
   - *Power-hungry missions pick a **less** powerful site*: the top site's mean
     available power drops from **664 W** (baseline) to **498 W** (600 W need)
     and **332 W** (2 000 W need), because the fixed sun weight (0.30) dominates
     the power weight (0.20). Power-extreme rank correlation vs baseline: 0.988.
   - **Relay missions lose connectivity discrimination**: with the default
     `relayCoverage: 1`, the comms component saturates at **100 for 30/30**
     site-dates, and the top site's Earth-visibility falls to 0.321 because
     relay coverage ignores direct visibility. The relay flag raises every site
     equally instead of rewarding good relay geometry.
2. **Score ties (6/33 rankings).** Scores are rounded to 0.1, so equal scores
   appear; ranks are then assigned by sort order, which makes an arbitrary
   ordering look authoritative.
3. **Component saturation.** In the baseline profile, power = 100 for **26/30**
   site-dates and sun = 100 for **17/30**; score differences then come mostly
   from the remaining components, reducing discrimination between sites.
4. **Sun profile semantics.** Increasing `sunDaysNeeded` with the same mission
   window correctly lowers the sun component, but changing `missionDays` also
   changes the sun score (a longer window can improve the longest continuous
   sunlight window) — the UI should explain that the window, not just the need,
   drives this component.
5. **Data-need semantics.** With `dataNeedMb = null` the data score equals the
   visibility fraction; with a numeric need it becomes `estimated / need`. A
   "no requirement" mission can therefore score *higher* than a mission with a
   small requirement, and the top site does not change between no-need and
   extreme-need profiles.

## Recommendations

- Make the weights mission-adaptive (e.g., derive power/comms weights from
  `powerNeedW` / `dataNeedMb` relative to the fleet median) or expose them in the
  mission profile; then re-run this harness and require the top-1 to change for
  extreme needs.
- Replace the binary relay assumption (`relayCoverage: 1`) with a per-site relay
  geometry/coverage model, and keep direct Earth visibility in the relay score
  as a fallback (e.g., `max(direct, relay)` is already used; add a penalty when
  direct coverage is poor and the relay is the only path).
- Break ties deterministically (documented secondary criterion: confidence,
  then site id) instead of relying on sort stability.
- Explain score saturation in the UI (component chips already show 100) and
  consider a non-linear score curve to spread the top of the distribution.

## Truthfulness audit (score statistics)

Run with [`score-audit.mjs`](score-audit.mjs): components, weighted totals, grades,
ranks, feasibility caps and reason codes are **recomputed independently** from the
metrics the core returns and compared with what the core reports. Also checked the
UI: the displayed landing-zone rows are compared with the exported JSON brief from
the same run (which carries `rankedLandingZones` with components and feasibility),
and the mission inputs are changed through the real UI to confirm the numbers
respond.

**Result: 0 mismatches.**

| Area | Checked | Result |
| --- | --- | --- |
| Curated-site ranking | 8 mission profiles × 10 sites = **80 scores**: sun/power/comms components from their formulas, weighted total (0.30/0.20/0.25/0.15/0.10), grade thresholds, rank order, ranking summary (average + recommended), reason codes vs metrics | all pass |
| Landing-zone ranking | **24 zone runs** (6 DEM sets × 4 missions): rawScore = Σ components·landing-weights, feasibility cap 55, `scoreCapApplied`, grade, feasible-first ordering, `Zone N` label, reason presence | all pass |
| UI vs exported brief | displayed scores and ranks equal `rankedLandingZones`; feasible count matches the “5 of 8 zones feasible” header; brief score recomputed from its components | all pass |
| Mission responsiveness | changing **POWER NEED (W)** to 600 through the real inputs recomputes the list and collapses infeasible zones to the capped score (`55.0*`) | all pass |

Observation (not a bug): infeasible zones are shown with the capped score plus an
asterisk (the raw score is in the title tooltip). It is correct, but the asterisk
deserves a visible legend in the panel.
