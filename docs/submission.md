# Submission draft — Project page

Content for the official NASA Space Apps **Project page** (English). Fill the
link marked `TODO` once the Project Demo is published.

## Project

- **Name:** L-SEA Space Apps — Lunar Landing Site Navigator
- **Challenge:** Lunar Landing Site Navigator
  (<https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>)
- **Event:** NASA International Space Apps Challenge · Málaga 2026
- **Repository:** <https://github.com/rafaa-sf/l-sea-space-apps>
- **Live app:** <https://l-sea-space-apps.vercel.app> (Vercel, production)
- **Project Demo:** TODO (single public link: ≤7 slides or ≤30 s video)

## Summary (50–200 words)

L-SEA Space Apps is an interactive mission-planning tool for the Moon's south
pole. It lets mission planners, educators and the public compare lunar landing
sites and dates in seconds: select one of ten notable south-pole sites or a
custom coordinate, choose a date inside the mission window, and immediately see
the Sun and Earth positions relative to the local terrain horizon. The app
combines real LOLA digital elevation models, pre-computed JPL Horizons
ephemerides and NASA Moon Trek layers to compute sunlight, sunset and Earthset
countdowns, solar power potential and direct-to-Earth communication windows,
with a ray-traced horizon that accounts for lunar curvature. A mission autopilot
ranks candidate sites against the mission profile, and a JSON brief exports the
scenario with QuickMap and Moon Trek links. The interface is available in
English and Spanish and includes a 2D fallback for machines without WebGL.

## Detailed description

**What it does.** The application answers the question "which landing site and
which date work for this mission?" It combines terrain, illumination and
communication data into one comparison workflow:

- Site selection from 10 curated south-pole points of interest (nine Artemis III
  candidate regions plus Shackleton crater rim), custom coordinates, or a
  terrain pointer.
- Real LOLA terrain rendered in 3D with a Canvas-2D fallback.
- Sun and Earth positions computed from JPL Horizons topocentric ephemerides.
- Ray-traced terrain horizon with lunar curvature, sun/Earth visibility and
  countdowns to sunset and Earthset.
- Power estimate (solar elevation, sunlight fraction, panel assumptions) and
  communication windows (direct-to-Earth and relay-in-orbit).
- Mission autopilot: scoring and ranking of sites against mission duration,
  power need, required solar days, perimeter and mast.
- Moon Trek layers: LOLA relief/slope, LROC imagery, illumination, Earth
  visibility, PSR and temperature.
- Orbital variation views and a JSON mission brief export (with QuickMap, Moon
  Trek, Horizons and LOLA links).

**How it works.** The browser loads pre-computed datasets: Horizons ephemerides
for the ten sites (30-minute steps, 2026-11-01 → 2026-12-31) and two LOLA polar
digital elevation models (74 m and 594 m grids, polar stereographic). A
framework-agnostic JavaScript core computes terrain horizon profiles with
curvature correction, interpolates ephemerides, evaluates visibility and powers
the autopilot. The Vue 3 + Three.js interface runs heavy scoring in a background
Web Worker and degrades gracefully to a 2D renderer.

**Tools and method.** Vue 3, Vite, Three.js, plain JavaScript, Vitest, GitHub
Actions. NASA data are pre-computed so the static deployment works without a
server and without relying on third-party CORS proxies.

**Real status and limitations.** Working prototype: all features above are
implemented and verified against real NASA data. Known limitations: ephemerides
cover 2026-11-01 → 2026-12-31; terrain resolution is 74 m (high-resolution area)
and 594 m (wide area); the power and communication models are simplified
engineering estimates; Moon Trek imagery layers require network access (the
terrain mesh and analysis keep working offline); the app is an educational and
planning prototype, not a certified mission-design tool.

## NASA Data

- **JPL Horizons (DE441)** — topocentric Sun and Earth azimuth/elevation for 10
  lunar south-pole sites, 30-minute steps, 2026-11-01 → 2026-12-31.
  <https://ssd.jpl.nasa.gov/horizons/>
- **LOLA polar DEMs, PDS Geosciences** — `LDEM_875S_20M` and `LDEM_80S_80M`,
  converted to web grids (74 m/px and 594 m/px), meters relative to
  R = 1,737,400 m. <https://pds-geosciences.wustl.edu/>
- **NASA Moon Trek** — 21 verified south-pole WMTS layers (LOLA relief and
  slope, LROC imagery, illumination percentage, Earth visibility, PSR, Diviner
  temperature). <https://trek.nasa.gov/moon/>
- **LROC QuickMap** — deep links used to cross-check site locations and terrain.
  <https://quickmap.lroc.asu.edu/>
- **CSA Moon Exploration** — reference context for lunar exploration and site
  lists. <https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/>

No NASA logos, flags or mission identifiers are used as project branding.

## Other data and references

- Artemis III candidate landing region coordinates and site descriptions.
- Project documentation and decision log:
  <https://github.com/rafaa-sf/l-sea-space-apps/tree/main/docs>
- Source attribution and verification record:
  [data-sources.md](data-sources.md), [api-integrations.md](api-integrations.md).

## AI / SI use

This solution was built with an AI-assisted agent workflow (DeepSeek Harness
agent sessions coordinating research, implementation, review and documentation;
see [ai-usage.md](ai-usage.md) for the full declaration). All AI-generated
content was reviewed by the team, which remains responsible for the decisions,
verification and authorship of the submission. No AI-generated media with
identifiable people is included.

## Review checklist (from the participant guide)

- [ ] Project name and 50–200 word summary
- [ ] Project Demo: single public link (≤7 slides OR ≤30 s video), English
- [ ] Final Project: public repository link
- [ ] Detailed description, NASA data and references
- [ ] AI/SI declaration
- [ ] Links public, no password, no registration
- [ ] Submit for Judging + confirmation before Sunday 23:59 local
