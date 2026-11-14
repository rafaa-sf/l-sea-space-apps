# Challenge: Lunar Landing Site Navigator

Official 2026 challenge selected for this project.

- **Challenge:** Lunar Landing Site Navigator
- **Official page:** <https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>
- **Challenge number:** 10 (CLPS)
- **Event:** NASA International Space Apps Challenge · Málaga 2026

## Official statement (summary)

Missions to the Moon's south pole face extreme lighting and communication
constraints. Mission planners need an intuitive tool to **compare landing sites
and dates quickly**, visualizing **Sun and Earth positions relative to the
horizon** to assess **power generation potential** and **direct-to-Earth
communication windows**.

The challenge describes the current gap: tools such as NASA QuickMap, Moon Trek
and JPL Horizons contain the right data but are built for detailed analysis and
are hard to use for rapid scenario comparison. An accessible interface that
turns ephemeris and topographic data into comparable visualizations would help
mission planners, educators and the public.

## Suggested objectives (from the challenge)

- Interactive site selection and comparison, with a curated list of notable
  landing sites and the ability to input custom lunar coordinates.
- Side-by-side or sequential comparison of multiple sites and dates.
- Sun and Earth position visualization relative to the horizon, including time
  remaining before sunset/Earthset.
- Power and communication assessment: solar elevation, sunlight duration,
  Earth-visibility windows.
- 2D maps, 3D surface visualizations, timeline/animation views.
- Accessibility for mission planners as well as educators and the public.

## Suggested NASA data (from the challenge)

| Resource | Link | Use in this project |
| --- | --- | --- |
| QuickMap (LROC/ASU) | <https://quickmap.lroc.asu.edu/> | Cross-check landing-site locations and terrain; deep links in the JSON brief |
| Moon Trek | <https://trek.nasa.gov/moon/> | Imagery, slope, illumination and temperature layers (21 verified WMTS layers) |
| JPL Horizons | <https://ssd.jpl.nasa.gov/horizons/> | Topocentric Sun and Earth azimuth/elevation (pre-computed datasets) |
| LOLA (via PDS Geosciences) | <https://pds-geosciences.wustl.edu/> | Real south-pole digital elevation models for terrain and horizon calculations |
| CSA Moon Exploration | <https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/> | Reference for lunar exploration context and the provided "Moon Explorer" site list |

## How this project answers the challenge

| Challenge objective | Implementation |
| --- | --- |
| Site selection and comparison | 10 curated south-pole POIs (Artemis III candidate regions + Shackleton rim), custom coordinates and terrain-pointer selection, comparator panel |
| Date/time flexibility | Mission timeline with playback, date/time controls and ephemeris range 2026-11-01 → 2026-12-31 |
| Sun/Earth vs horizon | Ray-traced terrain horizon with lunar curvature, sun and earth direction vectors, 3D/2D visualization |
| Time to sunset/Earthset | Countdown panel computed from the pre-computed Horizons datasets |
| Power and communications | Solar power estimate and Earth-visibility/relay communication windows |
| 2D/3D and temporal views | Three.js surface visualization, Canvas-2D fallback, timeline sparkline |
| Accessibility | English/Spanish UI, keyboard-friendly controls, WebGL fallback |
| Rapid comparison | Autopilot ranking over the mission window with human-readable reasons |

## NASA data used

- **JPL Horizons (DE441)** — topocentric Sun and Earth az/el, 30-minute steps,
  10 sites, 2026-11-01 → 2026-12-31 (pre-computed, no runtime API dependency).
- **LOLA polar DEMs (PDS Geosciences)** — `LDEM_875S_20M` (74 m/px web grid) and
  `LDEM_80S_80M` (594 m/px wide area), polar stereographic, meters relative to
  R = 1,737,400 m.
- **Moon Trek WMTS** — 21 verified south-pole layers (LOLA relief/slope, LROC
  imagery, illumination %, Earth visibility, PSR, Diviner temperature).
- **QuickMap** — deep links for cross-checking site locations and terrain.

Provenance, licensing and verification details are in
[data-sources.md](data-sources.md) and [api-integrations.md](api-integrations.md).
