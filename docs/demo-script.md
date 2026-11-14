# Project Demo — slide and video script

Rules (from the [participant guide](guide.md)): one public link, **at most 7
slides including the cover**, OR a **video of at most 30 seconds**. Everything in
English. No identifiable minors, no NASA logos as project branding.

## Option A — 7 slides (recommended)

| # | Slide | Content | Visual |
| --- | --- | --- | --- |
| 1 | Cover | **L-SEA Space Apps — Lunar Landing Site Navigator** · NASA Space Apps Challenge Málaga 2026 · challenge: Lunar Landing Site Navigator · one sentence: "Compare lunar south-pole landing sites and dates in seconds." | App screenshot ([screenshots/app-3d.png](screenshots/app-3d.png)) |
| 2 | Problem | At the Moon's south pole, small changes in site or date dramatically change sunlight and Earth visibility. Mission planners need fast scenario comparison; existing tools (QuickMap, Moon Trek, Horizons) are built for detailed analysis, not rapid "what if" cycles. | Two contrasting site cards (sunlight vs shadow) |
| 3 | Solution | One workflow: pick a site (10 curated POIs, custom coordinates, or map pointer) → choose a date → see Sun and Earth relative to the terrain horizon → compare, rank and export. | App screenshot + simple diagram |
| 4 | NASA data | JPL Horizons: topocentric Sun/Earth ephemerides (10 sites, 30-min steps, 2026-11-01→12-31). LOLA: real polar DEMs (74 m and 594 m grids). Moon Trek: 21 verified south-pole layers. QuickMap: cross-check links. Explain the real role of each. | Data pipeline diagram with sources |
| 5 | Demo evidence | Live values: Shackleton rim (2026-11-14 12:00 UTC) Sun az 276.2°, el 1.58° vs terrain horizon −1.05° → visible with 2.63° margin; Earth el −4.37° → below horizon; "Sunset: no event" in window; "Earthset: 15 d 22 h 41 min". Autopilot ranks 10 sites; JSON brief exports with QuickMap/Moon Trek/Horizons/LOLA links. | Screenshots: horizon panel, countdown, autopilot ranking |
| 6 | Validation and limits | Verified against real datasets; ray-traced horizon includes lunar curvature; 2D fallback without WebGL; worker keeps the UI responsive. Limitations: ephemeris window Nov–Dec 2026; DEM resolution 74 m/594 m; simplified power/comms models; prototype, not certified mission design. | Checklist-style bullets |
| 7 | Impact and next step | Helps mission planners evaluate schedule changes and alternative sites, and helps educators/public understand lunar exploration. Next: live Horizons queries, higher-resolution polar DEM, richer power/thermal models, CLPS target library. | Roadmap + repo QR/link |

### Speaker notes (short)

- **Hook (slide 2):** "On the Moon, moving your landing site two kilometres can
  mean the difference between weeks of sunlight and permanent shadow."
- **Key demo moment (slide 5):** change the date by a few weeks and show the
  sunlight margin and Earth visibility change live.
- **Close:** "L-SEA turns complicated mission data into a two-minute decision."

## Option B — 30-second video script

| Time | Shot | Voice-over (English) |
| --- | --- | --- |
| 0:00–0:05 | South-pole terrain rotating, permanent shadow visible | "The Moon's south pole is a place of extremes — sunlight and Earth contact change dramatically from site to site." |
| 0:05–0:12 | Mouse selects a POI, date changes, panels update | "L-SEA lets you compare landing sites and dates in seconds, on real LOLA terrain and real JPL Horizons ephemerides." |
| 0:12–0:22 | Sun/Earth arrows, horizon margin, countdowns, autopilot ranking | "See exactly where the Sun and Earth are above the terrain horizon, how long until sunset or Earthset, the power potential and the communication windows." |
| 0:22–0:28 | Site ranking + JSON export | "An autopilot ranks the best site for your mission, and the brief exports with all NASA source links." |
| 0:28–0:30 | Title card: repo URL | "L-SEA Space Apps — faster lunar landing decisions." |

### Technical checks before exporting

- [ ] Total duration ≤ 30 seconds (time the exported file).
- [ ] Audio clear; English subtitles if narration is in another language.
- [ ] Link opens in a private window without login or permissions.
- [ ] No identifiable names, voices or images of minors.
- [ ] File size and resolution suitable for the platform; public link set.

## Evidence values (current build, 2026-11-14 12:00 UTC)

| Metric | Shackleton crater rim |
| --- | --- |
| Sun azimuth / elevation | 276.8° / 1.58° |
| Terrain horizon in Sun direction | −1.05° |
| Margin above horizon | 2.63° (visible) |
| Earth azimuth / elevation | 153.9° / −4.37° (below horizon) |
| Sunset in mission window | No event |
| Earthset | 15 d 22 h 41 min |
| Ray tracing | Clear line of sight to space |

Autopilot and JSON brief values are produced live by the app; capture them from
the final build for the slides.

Screenshots: [screenshots/app-3d.png](screenshots/app-3d.png),
[screenshots/app-2d-es.png](screenshots/app-2d-es.png).
