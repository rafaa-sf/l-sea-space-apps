# Pitch & Project Demo package — L-SEA Space Apps


> **Status snapshot (2026-11-14, `origin/develop` @ `5db7603`).** The application is implemented in source: a Vue 3 mission-control shell with 11 feature panels, a pure-JavaScript core (geometry, terrain, Sun/Earth horizon engine, ephemeris, power, communications, autopilot), service adapters, a single Web Worker, a Three.js scene with a no-WebGL Canvas 2D fallback, and the full real NASA datasets (`public/data/pois.json` — 10 sites; `public/data/ephemeris/` — 10 files × 2 928 samples at 30-minute steps from JPL Horizons DE441; `public/data/layers.json` — 21 verified Moon Trek layers; `public/data/terrain/` — 2 LOLA regions). `npm test` passes 98 tests in 7 files and `npm run build` is green; CI runs on `develop`. **Not yet validated:** end-to-end demo on a deployed URL, accuracy against live JPL Horizons references, usability. **Status refresh before submission:** re-check the final commit, the deployed public URL and the Project page fields before Submit for Judging.

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator* (challenge #11, partner agency CSA)
**Event:** NASA Space Apps Challenge · Málaga 2026 · **Owner:** commercial workstream · **Version:** 2026-11-14
**This document covers:** (A) the 7-slide Project Demo deck (cover + 6), (B) the local Málaga pitch (2–3 min oral, English slides), (C) a ≤ 30 s video script, (D) Q&A preparation and the demo runbook.
**Rules basis:** `docs/guide.md` §§"Deliverables: Project page", "Project Demo rules", "Local pitch (Málaga)" — slides ≤ 7 including cover OR video ≤ 30 s; all written material in English; visual material in English even when the oral pitch is Spanish or English; public link, no login; no identifiable minors; honest labelling of built vs. simulated vs. planned.

**Honesty labels used on every slide:** 🟩 **BUILT** (implemented in source, automated tests pass — and visibly working if the deployed demo is available) · 🟨 **NOT YET VALIDATED** (no accuracy-vs-Horizons/end-to-end evidence yet) · 🟦 **DATA** (real NASA data shipped).

> **Reality check before you present (Lead + coder).** The status below reflects `origin/develop` @ `5db7603` (14 Nov 2026): the mission-control application is implemented in source (11 panels, core engine, services, worker, Three.js + no-WebGL fallback), with 98 passing tests, a green build, the full datasets, the pipeline and CI. **BUILT** = the application and its module tests. **Not yet validated** = end-to-end demo on the deployed URL, accuracy against live JPL Horizons references, usability. Use Demo Path A (§D) if the deployed build works end to end; do not present unvalidated behaviour as proven.

---

## A. 7-slide Project Demo (cover + 6)

Deck total: **7 slides** (limit is 7 *including* cover). Target export: public Google Slides / PDF link that opens without login. Keep each slide legible at projection size: ≤ 6 short lines, ≥ 24 pt body text.

### Slide 1 — Cover · Team and project · challenge · one sentence

- **On-slide text:**
  - **L-SEA Space Apps** — *Lunar Landing Site Navigator*
  - NASA Space Apps Challenge · Málaga 2026 — Challenge #11 (partner agency: CSA)
  - *"Compare lunar south-pole landing sites and dates in one rapid, bilingual tool — built on real NASA terrain data."*
  - Team: L-SEA (max. 1–6 members; **no names of minors**, per the participant guide)
  - Link(s): public demo + repository *(TODO: add final URLs)*
- **Visual:** dark lunar-surface background (own/terrain-derived render, not NASA branding), project wordmark text only.
- **Notes (15 s):** "We are L-SEA. We took challenge #11: build a tool to compare lunar south-pole landing sites and dates. One sentence: our design turns NASA terrain and Sun/Earth data into a rapid side-by-side comparison for mission planners and educators."
- **Label:** — (cover)

### Slide 2 — Concrete problem and who it affects

- **On-slide text** (facts from the challenge brief):
  - South-pole missions must balance **science** and **engineering** in the site/date choice.
  - **Sun** → solar power and thermal conditions. **Earth** → direct-to-Earth comms without a relay.
  - Small changes in site or date **dramatically change both**.
  - Launch slips are routine → planners must **re-evaluate sites and dates fast**.
  - Existing tools (QuickMap, Moon Trek, JPL Horizons) are built for **detailed analysis**, not **rapid comparison**.
  - Affected: CLPS and commercial lander teams, agency mission planners, science teams, educators, public.
- **Visual:** simple diagram: site pin + two arrows (Sun, Earth) above a jagged horizon; and "3 sites × 3 dates = 9 scenarios" grid.
- **Notes (20 s):** "At the south pole the Sun is barely above the horizon and Earth is low too. Two sites a few kilometres apart can have different power and comms windows. Today a planner answers 'can we land here on that date?' by stitching together Moon Trek, QuickMap and Horizons. That is a specialist workflow, and it breaks exactly when plans change — which is often."
- **Label:** — (problem statement sourced from the official challenge brief)

### Slide 3 — Solution and user journey

- **On-slide text** (planned product; label accordingly):
  - Choose **site** (curated south-pole POIs or custom coordinates) and **date**.
  - See **Sun and Earth vs. the local horizon** (terrain + lunar curvature, no atmosphere).
  - See **time to sunset / earthset**, **power estimate**, **direct-to-Earth comms windows**.
  - Compare **side by side**, score sites against a **mission profile** (autopilot).
  - Export a **JSON mission brief** with QuickMap/Moon Trek links.
  - **EN/ES** UI · **2D fallback without WebGL** · static, install-free.
  - Journey: *Landing-site question → scenario → evidence → shareable brief.*
- **Visual:** 4-step horizontal journey diagram (site/date → compare → evidence → brief).
- **Notes (30 s):** "The journey is three clicks and a comparison. Here is what the user does: pick a site, pick a date; the tool draws the Sun and Earth against the real terrain horizon, then reports time to set, power and comms. Pick a second site or date and the numbers sit side by side. The autopilot scores each site against the mission's power, relay and sunlight-days needs. Then the brief exports as JSON with links back to QuickMap and Moon Trek. It is bilingual and works without WebGL."
- **Label:** 🟩 BUILT (implemented in source; automated tests pass) — validation caveats on the limits slide

### Slide 4 — NASA data: origin and real role

- **On-slide text** (all three NASA resources shipped and consumed by the app):
  - 🟩 **LOLA south-pole DEM** (LRO LOLA, NASA/GSFC, PDS Geosciences Node): real polar terrain shipped — 2048² @ 74 m/px (87.5S–90S) + 1024² @ 594 m/px (80S–90S); the terrain layer supports elevation, slope, horizon and ray–terrain intersection.
  - 🟨 **JPL Horizons**: Sun and Earth topocentric positions; pre-computed for the static build because production has no server and Horizons does not send CORS headers.
  - 🟨 **Moon Trek**: contextual layers + deep links in the exported brief (complements, doesn't replace).
  - Terrain validated by our test bench: 2 regions, 0 failures; cross-region r = 0.9993.
- **Visual:** terrain hillshade/elevation render from the shipped data + data-flow arrow (LOLA → horizon → decision), small reference table of the two grids.
- **Notes (25 s):** "What makes this real is the data. We ship two real LOLA polar grids, not a mock: 74 metres per pixel around the pole, and a wide 80-to-90-south context grid. The terrain is what decides the horizon — without it, this is just a Sun-and-Earth calculator. We validated the grids against their metadata and against each other: correlation 0.9993. Horizons and Moon Trek are the next data integrations, specified in our architecture."
- **Label:** 🟩 BUILT for LOLA · 🟩 BUILT for Horizons ephemerides · 🟩 BUILT for Moon Trek layer catalogue (live tile behaviour to be re-checked before the demo)

### Slide 5 — Demonstration: evidence of the concept

- **On-slide text** (choose ONE, honestly):
  - **If panels land:** screenshot of two scenarios side by side (site A date X vs. site B date Y) with the metrics that differ; one click path shown.
  - **If the deployed build works end to end:** record the real flow (site → date → horizon/power/comms → comparison → export); caption with the validated values and the honest limits. If the deployment is not ready in time, fall back to the source + unit-test evidence and label it as built-but-not-deployed.
  - Always: what the viewer is looking at and whether it is built or planned.
- **Visual:** annotated screenshot; 2–3 callouts max.
- **Notes (30 s):** "This is what runs today. Two scenarios side by side — same site, two dates; look how the sunlight window and the Earth window differ. One click gives the brief. The app is implemented and its 98 automated tests pass; what we have not yet validated is accuracy against live JPL Horizons and the deployed end-to-end demo."
- **Label:** 🟩 BUILT (as stated on the slide)

### Slide 6 — What has been verified, what works, limitations

- **On-slide text:**
  - **Verified today:** production build succeeds; terrain binaries parse and match metadata; cross-region agreement r = 0.9993; documentation/architecture contract complete.
  - **Works:** static app shell, EN/ES locale handling, real LOLA terrain shipped (~11 MB), reproducible terrain builder.
  - **Limitations (say them):** application implemented in source with 98 passing tests, but the end-to-end demo on the deployed URL and the accuracy comparison against live Horizons are still pending; ~14–15 MB first load (≈13.4 MB of committed NASA data, Three.js chunk ≈743 kB); 74 m/px default resolution; dates bounded by the shipped ephemeris range (2026-11-01 → 2026-12-31).
  - **Not claimed:** flight-certified analysis; market size; customer traction.
- **Visual:** two-column "Verified / Not yet" table with checkmarks and honest grey items.
- **Notes (15 s):** "We are explicit about this: the application is implemented and its 98 automated tests pass; the real NASA datasets are shipped. What is not done yet is end-to-end validation on the deployed site and an accuracy comparison against live Horizons. Those are the next steps."
- **Label:** 🟩 BUILT / transparent gaps

### Slide 7 — Expected impact, next step, essential references

- **On-slide text:**
  - **Impact:** faster site/date trade studies; resilience to launch slips; accessible to non-specialists; bilingual education/outreach.
  - **Next step (post-event):** finish comparison MVP → validate against JPL Horizons → timed usability test with 3–5 users → first pilot with a mission team or education programme.
  - **References (legible):** Challenge #11 brief; NASA LRO LOLA (PDS Geosciences Node); JPL Horizons; NASA Moon Trek; repository link; public demo link.
- **Visual:** 3-step roadmap arrow + QR/reference block (plain text URLs, readable).
- **Notes (15 s):** "The impact we are going after is decision speed: fewer hours per trade study and a faster answer when a launch slips — plus a public, bilingual way to explain why the Moon is hard. Next: finish the comparison, validate the geometry against Horizons, then pilot it with a real team. Thank you."
- **Label:** 🟦 HYPOTHESIS (impact framing, not yet validated)

**Total 2:30 local-pitch timing:** 15 + 20 + 30 + 25 + 30 + 15 + 15 = **150 s**, plus stage walk-on (the Málaga reference includes walk-on time in the 2–3 min; confirm the final rule with the organization at the technical test — see `docs/guide.md`).

---

## B. Local Málaga pitch (2–3 min oral)

- **Format:** oral Spanish **or** English allowed; **slides in English** required (`docs/guide.md`). References differ on duration (2–2:30, 2–3 min) and Q&A (2–3 questions); **confirm with the organization before the technical test** (Sunday 16:30–17:15 per the guide).
- **Story (recommended by the guide):** problem → solution → NASA resource → evidence → limits → next step. The 7-slide deck above follows exactly that.
- **Delivery rules:** one presenter, 2.5 min, no feature tour; every claim paired with a visible screen, data point or file. Say "this is built" / "this is planned" out loud; judges reward honesty (guide: "good staging does not by itself prove validity, impact or relevance").
- **Spanish oral variant:** deliver the same 7 beats in Spanish if the room is Spanish-speaking; keep the slides English. Do not add claims not in the slides.
- **If the demo fails live:** fall back to the Project Demo screenshots (slide 5) and the terrain render; never debug on stage.

---

## C. ≤ 30 s video script (Option B — four beats)

**Target:** 28–30 s, 1440p or 1080p screen recording + voice-over; **English narration** (or Spanish with **English subtitles**); ≤ 30.0 s in the exported file (measure it); public link, no login; no identifiable minors; no NASA/CSA logos.

| Time | Beat | Visual (screen) | Narration (English) |
| --- | --- | --- | --- |
| 0–6 s | **Problem** | Moon south-pole terrain slowly rotating / dark; a site pin with Sun and Earth low on the horizon; text "Small site or date changes → different power & comms" | "Landing on the Moon's south pole means choosing a site **and** a date. Move either one, and sunlight and Earth contact change." |
| 6–14 s | **Solution** | UI: choose site → choose date → Sun/Earth horizon + "time to set" + power/comms appear | "L-SEA compares sites and dates in one rapid, bilingual tool — terrain, Sun, Earth, power and communications." |
| 14–24 s | **Demo** | Two scenarios side by side; highlight the differing windows; JSON brief exports with QuickMap/Moon Trek links | "Pick two sites, or one site and two dates; the numbers sit side by side. Export a mission brief." |
| 24–30 s | **NASA** | LOLA terrain hillshade + data-flow caption: "NASA LRO LOLA (PDS) → horizon → decision" | "Real NASA LOLA terrain drives the horizon. That is the difference between a Sun calculator and a landing-site decision." |

**Narration length:** 77 words → ~28 s at a measured 165 wpm; trim the last clause if the export runs long. **On-screen text is in English** and matches the narration; captions must be readable. Mark generated visuals visibly if any are AI-generated (participant guide).

**Honesty rule for the video:** record the real application if the deployed build works end to end; otherwise record the built source/automated-test evidence and say clearly that the end-to-end demo and accuracy validation are pending. **Never fake a working scenario** in a video: judges compare the video with the Project page and repo.

---

## D. Demo runbook and Q&A

### Demo paths

- **Path A — panels built:** pre-load two sites and two dates before the pitch (avoid live loading over venue Wi-Fi); click: site → date → compare → open brief. Keep a second browser tab with the same state as backup. Have a screen recording of the flow as fallback.
- **Path B — skeleton (current):** show the running static build (shell, EN/ES toggle) and the terrain render produced from the shipped LOLA data (`docs/test-report.md`); state the interface contract; do not click through unbuilt panels.
- **Both:** pre-open repo, README and `docs/architecture.md` in tabs for Q&A evidence; public links tested logged out.

### Likely questions and short answers

Several questions below are the ones the participant guide suggests rehearsing (p. 12); the rest are the obvious follow-ups from the judges' professional lenses (`judging-criteria.md` §2).

| Likely question | Answer (evidence-based) |
| --- | --- |
| Where does the NASA resource intervene? | LOLA terrain is the horizon input to every Sun/Earth visibility decision; shipped and validated (grids, ranges, cross-region r = 0.9993). Horizons provides Sun/Earth positions; Moon Trek layers/deep links. All planned in `docs/architecture.md`. |
| What works today, what is pending? | Built: static shell, EN/ES, real LOLA terrain pipeline, build. Pending: horizon engine, ephemeris datasets, power/comms, comparison, scoring, export, 3D/2D views. |
| What evidence supports the conclusions? | Terrain validation PASS (2 regions, 0 failures); cross-region agreement r = 0.9993, mean absolute difference 28.8 m; build succeeds. Accuracy vs. Horizons is the next validation — not yet claimed. |
| What is the main limitation? | Prototype status and terrain resolution (74 m/px default), plus static hosting: ephemerides must be pre-computed. We disclose rather than hide it. |
| Which decision adds the most value? | Comparing scenarios, not single-site inspection; and exporting a reproducible brief. That is the gap the challenge brief names in existing tools. |
| Why not just use Moon Trek/QuickMap/Horizons? | They are authoritative but built for detailed analysis; the brief says they are hard for non-specialists to use for rapid comparison. We consume their data and link back to them. |
| How is this creative? | A "mission-profile autopilot" that ranks sites against power/relay/sunlight-days needs, plus a bilingual, no-WebGL, static UX for planning *and* education. |
| Is it scientifically valid? | Physics is standard (spherical Moon, no atmosphere → no refraction; terrain + lunar curvature for the horizon); tolerances and coverage must be documented; validation against Horizons is the next step. |
| What would you do with more time? | Finish the comparison MVP, validate against Horizons, run a timed usability test, ship lazy-loaded terrain tiles. |
| Are you using AI? | Per the guide, declare tools and how they were used; the submission's AI declaration (§ later in the Project page) is the authoritative answer. **TODO: align this answer with the final declaration.** |

### Asset checklist (before linking the deck/video)

- [ ] Exactly 7 slides (cover included) or video ≤ 30.00 s — measured on the exported file.
- [ ] English text everywhere; Spanish oral okay, English visuals required.
- [ ] Public link tested in a private window (no login/permission).
- [ ] No identifiable minors (names, voices, images).
- [ ] No NASA/CSA logos, flags or mission identifiers as our branding; attribution line present.
- [ ] Generated images/video visibly marked; AI declaration consistent with the Project page.
- [ ] Every BUILT label matches the demo; every PLANNED label visible on its slide.
- [ ] Final URLs (demo, repo) inserted (currently **TODO**).
- [ ] Confirm pitch duration/format/Q&A with the organization at the technical test.

---

## Sources

- Demo/pitch rules and recommended structures: `docs/guide.md` §§"Deliverables: Project page", "Project Demo rules", "Local pitch (Málaga)"; Spanish original the official Málaga 2026 participant guide (English summary in `docs/guide.md`) (pp. 7–12, 15)
- Challenge facts: the official Challenge 11 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/); the official Málaga 2026 event material
- Product/architecture features: `docs/architecture.md`
- Terrain details and validation: `public/data/terrain/*.json`, `scripts/nasa/build-terrain.py`, `docs/test-report.md`
- Build/test status: `docs/test-report.md`, `docs/test-report.md`
- Impact framing: `docs/impact-scalability.md`
- Judging lenses: the related document in `docs/`