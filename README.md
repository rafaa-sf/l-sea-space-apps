# L-SEA Space Apps

Lunar south-pole landing site navigator built for the NASA International Space
Apps Challenge, Málaga 2026.

L-SEA compares candidate lunar south-pole landing sites and mission dates from
real NASA data. Select a DEM region and a curated site, or a detected landing
zone; the autopilot ranks the zones and can search the 2026-11-01..2026-12-31
ephemeris window for an earliest feasible mission-start date automatically
(manual date selection remains available). The selected case shows the Sun and
Earth against the local terrain horizon, with power and direct-to-Earth/relay
communication windows derived from the same data.

[![CI](https://github.com/rafaa-sf/l-sea-space-apps/actions/workflows/ci.yml/badge.svg)](https://github.com/rafaa-sf/l-sea-space-apps/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-rafaa--sf.github.io%2Fl--sea--space--apps-2ea44f)](https://rafaa-sf.github.io/l-sea-space-apps/)
[![Stack](https://img.shields.io/badge/stack-Vue%203%20%2B%20Three.js-3f80ea)](https://vuejs.org)
[![Docs](https://img.shields.io/badge/docs-index-6f42c1)](docs/README.md)

**Live application:** <https://rafaa-sf.github.io/l-sea-space-apps>

![L-SEA application overview](docs/screenshots/app-3d.png)

## What it does

L-SEA is a browser-based mission-planning console for the lunar south pole. It
combines a LOLA polar DEM, precomputed JPL Horizons topocentric Sun/Earth
ephemerides and a mission profile into one analysis: the user selects a DEM
region, a curated site or a detected landing zone, sets the mission start date
(or a preset), and the application ray-traces the local terrain horizon before
computing illumination, power and communications.

- **Terrain and hazard inputs.** LOLA polar DEMs are loaded in
  polar-stereographic projection; slope, roughness, relief, crater hazards and
  landing-ellipse fit are computed from the same grid, and the local horizon is
  ray-traced for every azimuth with lunar curvature.
- **Mission modelling.** Topocentric Sun/Earth positions feed illumination,
  thermal equilibrium, solar/RTG power, eclipse battery sizing, direct and relay
  communications, and the hard feasibility gate (continuous sunlight,
  longest-eclipse battery, power margin, thermal, data).
- **Autopilot and date search.** The autopilot is deterministic: it detects
  contiguous flat zones from DEM slope and roughness thresholds, ray-traces the
  local horizon for each zone, evaluates the hard feasibility gates (continuous
  sunlight, longest-eclipse battery, power margin, thermal, data) and ranks zones
  by the documented weighted score; it also searches 2026-11-01..2026-12-31 for
  each zone's earliest feasible mission-start date.
- **Outputs.** 3D and top-down 2D views with Moon Trek layers, a timeline and
  weekly sunlight/link/relay cycle strips, a site comparator and per-site
  analysis panels, and an exportable JSON mission brief.
- **Boundaries.** The application is a static front end with computation in a Web
  Worker; NASA inputs are precomputed (ephemeris 2026-11-01..2026-12-31, LOLA
  DEMs), results are planning estimates rather than certification, and missing
  coverage is reported instead of extrapolated.

Implementation details and module contracts are in
**[docs/architecture.md](docs/architecture.md)**; the feature reference is
**[docs/features.md](docs/features.md)**.

## Entry points

- `/` — project landing page: the challenge, what the tool does, the NASA data
  behind it, impact and scalability, and the grouped documentation index.
- `/#/tool` — the interactive mission console (lazy-loaded; a `Project overview`
  link returns to the landing page).

## Documentation

Full grouped index: **[docs/README.md](docs/README.md)**. Feature reference:
**[docs/features.md](docs/features.md)**.

- **Project and challenge:** [features](docs/features.md) · [challenge](docs/challenge.md) · [architecture](docs/architecture.md) · [NASA data](docs/data.md) · [AI use declaration](docs/ai-usage.md)
- **Product, impact and submission:** [submission](docs/submission.md) · [demo](docs/demo.md) · [impact and scalability](docs/scalability.md) · [commercial case](docs/commercial.md)
- **Quality and operations:** [QA and test bench](docs/qa.md) · [UX compliance](docs/ux-compliance.md) · [deployment](docs/deployment.md) · [contributing](docs/contributing.md) · [security](docs/security.md) · [decisions](docs/decisions.md) · [Miro integration](docs/miro.md)
- **Reproducible test bench:** [qa/README.md](qa/README.md) · [qa/REPORT.md](qa/REPORT.md)

## NASA data

| Source | Use |
| --- | --- |
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) (DE441) | Topocentric Sun and Earth azimuth/elevation for 10 sites, 30-minute steps, 2026-11-01 to 2026-12-31 |
| [LOLA polar DEMs](https://pds-geosciences.wustl.edu/) (PDS Geosciences) | Real south-pole terrain, converted to 74 m and 594 m polar-stereographic grids |
| [NASA Moon Trek](https://trek.nasa.gov/moon/) | 21 verified south-pole WMTS layers (relief, slope, imagery, illumination, Earth visibility, temperature) |
| [LROC QuickMap](https://quickmap.lroc.asu.edu/) | Cross-checks and deep links exported with the mission brief |

The data pipeline, verification evidence and attribution are documented in
[`docs/data.md`](docs/data.md). NASA data is real; no values are generated by AI.

## Stack

Vue 3 and Vite for the interface, Three.js for the 3D viewport, plain
JavaScript for the framework-agnostic domain core, a single Web Worker for
background scoring, Vitest for tests and GitHub Actions for continuous
integration. The production build is fully static and is deployed on GitHub Pages; the earlier Vercel hosting was migrated away (history in [`docs/deployment.md`](docs/deployment.md) and the decision log).

## Repository layout

```text
src/
  core/        Frame-independent domain logic (terrain, horizon, ephemeris, power, comms, autopilot, zones)
  services/    Data adapters (NASA datasets, Moon Trek, export, storage, worker client)
  workers/     Background compute worker
  components/  Vue interface (panels, primitives, composables)
  render/      Three.js scene (3D and top-down 2D presets) and Canvas 2D fallback
  i18n/        English and Spanish messages
public/data/   Pre-computed NASA datasets and terrain grids
scripts/       Data pipeline, deployment verification, QA and demo tooling
mcp/miro/      Model Context Protocol server for the Miro REST API
demo/          Project Demo deck (7 slides) and generator
docs/          Project documentation
```

## Development

```bash
npm ci
npm run dev      # local development server
npm test         # Vitest suite
npm run build    # production build in dist/
npm run preview  # preview the production build
```

The Miro MCP server is a separate package: `npm --prefix mcp/miro ci` and
`npm --prefix mcp/miro test`.

## Deployment

Production is deployed on **GitHub Pages** at
<https://rafaa-sf.github.io/l-sea-space-apps/>. The Pages workflow builds and
publishes every push to `main`. The earlier Vercel deployment was disconnected and its
configuration removed; the migration is documented in [`docs/deployment.md`](docs/deployment.md)
and [`docs/decisions.md`](docs/decisions.md).

## Quality and verification

- **Unit and contract tests** — 241 Vitest tests in 16 files for the scientific
  core and the data services (`npm test`), plus 8 tests for the Miro MCP package.
- **Monte Carlo logic bench** — seeded randomised site/date/mission scenarios over
  the real core with 13 invariants. A 20,000-case run found one real
  terrain-boundary defect, fixed with a regression test.
- **Device/resolution matrix** — headless Chrome emulation of 51 viewports in
  English and Spanish, plus the no-WebGL fallback, measuring layout boxes,
  overflow, console errors, control sizes and font sizes.
- **Reproduce** — commands, tag taxonomy and the executed runs are documented in
  [`qa/README.md`](qa/README.md) and [`qa/REPORT.md`](qa/REPORT.md); the test
  strategy is in [`docs/qa.md`](docs/qa.md).

Production verification: <https://rafaa-sf.github.io/l-sea-space-apps> returns HTTP 200,
serves the pre-computed NASA datasets and the AI-use declaration at
`/data/ai-usage.md`.

## Limits

The tool is a decision aid, not a flight-dynamics tool. It models a spherical
Moon, uses the shipped LOLA grids (74 m to 594 m per pixel) and the pre-computed
ephemeris window 2026-11-01 to 2026-12-31, treats relay communications as a
documented coverage fraction rather than an orbit propagation, and simplifies
power and thermal behaviour. The full scope, assumptions and non-goals are listed
in [docs/features.md](docs/features.md#20-assumptions-and-limits) and
[docs/architecture.md](docs/architecture.md).

## AI usage

The project was built with AI agent teams under human direction. The complete
declaration, including the tools used, the human responsibilities, the
follow-up hardening rounds and the agent-opened issues/pull requests, is in
[`docs/ai-usage.md`](docs/ai-usage.md) and is served by the application at
`/data/ai-usage.md`.

## License

No license has been selected for this repository yet. Contact the maintainers
before reuse.
