# Impact & Scalability Dossier — L-SEA Space Apps


> **Status snapshot (2026-11-14, main @ 35149e4).** Application and real NASA datasets are merged on main; npm test passes 104 tests in 7 files plus 8 MCP tests; CI is green. Deployment URL and Project Demo link are still pending (docs/submission.md TODOs).

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator*
**Event:** NASA International Space Apps Challenge · Málaga 2026 (14–15 November 2026)
**Challenge:** #10 — "Lunar Landing Site Navigator" (ES: *Navegador de aterrizaje lunar*)
**Partner agency:** CSA (Canadian Space Agency)
**Owner:** Lead — impact & scalability
**Status:** working draft for the hackathon submission; complements `docs/architecture.md` (technical contract) and the Project page document (`docs/project-page.md`).
**Version:** 2026-11-14

> This dossier is deliberately honest about evidence. At the status snapshot
> (`origin/develop` @ `5db7603`) the application is implemented in source (mission-control
> shell with 11 panels, core engine, services, worker, Three.js + no-WebGL fallback), the
> full real NASA datasets are shipped, 98 automated tests pass and the build is green.
> The impact and scalability claims below are still framed as **design intent +
> measurable hypotheses**, not as validated results: end-to-end demo behaviour, accuracy
> against live JPL Horizons references and usability are pending. Numbers marked
> *(estimate)* are planning assumptions, not measurements.

---

## 1. One-page summary

The lunar south pole is the most sought-after and most unforgiving destination in the
current wave of lunar exploration: water ice and permanently shadowed regions make it
scientifically valuable, while extreme illumination and Earth-visibility geometry make it
operationally hard. Mission planners today answer "can we land **here** on **that date**?"
by stitching together Moon Trek, LROC QuickMap and JPL Horizons — tools built for detailed
analysis, not for rapid scenario comparison.

**L-SEA Space Apps closes that gap:** a browser-based, install-free tool that puts terrain,
Sun and Earth geometry, power, communications and site-date comparison in one place, so a
mission planner (and an educator, and the public) can compare candidate sites and landing
dates in minutes.

**Impact thesis.** Better, faster site-date decisions de-risk lunar surface missions:
they reduce the probability of choosing a site whose illumination or direct-to-Earth
geometry is operationally marginal, and they cut the cost of re-planning when launch
dates slip — a routine event in the CLPS era.

**Scalability thesis.** The product is contract-driven and data-driven: the same
architecture that serves one south-pole terrain grid can serve both poles, other bodies,
finer DEMs, more epochs and an API — with the browser doing the compute and a static host
(or CDN) doing the delivery.

---

## 2. The problem (grounded in the challenge brief)

From the challenge brief (see the official Challenge 10 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)):

- CLPS and other lunar missions depend on landing sites/dates that balance **science** and
  **engineering** needs.
- The critical unknown is the **local lighting and communication environment**: Sun position
  drives solar power and thermal conditions; Earth position determines whether
  direct-to-Earth communication is possible without a relay.
- At the south pole, **small changes in location or date dramatically change** power and
  comms windows — so rapid evaluation is critical.
- Mission timelines are unstable (hardware, launch slips); planners need to re-evaluate
  alternative sites **and** alternative dates quickly.
- Existing tools (QuickMap, Moon Trek, JPL Horizons) are built for detailed analysis and are
  hard for non-specialists to use for rapid comparison; the gap is an **intuitive interface**
  that turns ephemeris + topography into comparable visualizations.

This is a genuine, well-documented workflow gap — not a hypothetical one — which is what
makes the impact case credible and the judges' "why it matters" easy to defend.

---

## 3. Impact assessment

### 3.1 Beneficiaries

| Beneficiary | Need | How the tool helps |
| --- | --- | --- |
| Mission planners / systems engineers (agencies, CLPS providers) | Fast trade-offs between candidate sites and dates | Side-by-side scenarios with illumination, Earth visibility, power, comms and time-to-set metrics |
| Science teams | Preserve science value while meeting engineering constraints | Same comparison layer, with terrain and PSR/illumination context |
| Commercial lunar landers | De-risk site/date selection on tight schedules | Install-free, shareable scenario briefs (JSON export) |
| ISRU / resource teams | Understand illumination and shadowing near ice-bearing regions | Terrain + horizon + illumination views over the region |
| Educators and the public | Understand *why* the Moon is hard | Bilingual (EN/ES), accessible, no specialist tooling |
| Partner agencies (CSA) and NASA programs (Artemis, CLPS) | Accessible decision support and outreach | Aligns with the challenge's dual mission: planning + education |

### 3.2 Operational impact

**Cycle-time reduction.** Today, evaluating one site-date combination means multiple
interfaces and manual interpretation of raw ephemeris. The tool collapses that into a
single comparison surface. Target KPI: *time to compare 3 candidate sites × 3 dates* —
baseline "hours to days", target "under 10 minutes" *(estimate / to be measured in a
usability test)*.

**Resilience to schedule change.** The challenge explicitly calls out launch slips. A tool
that can re-answer "which alternative site/date still works?" in minutes directly reduces
the cost of the single most common mission-planning disruption.

**Risk reduction.** Two failure modes are made visible before commitment:
1. a site whose solar illumination is marginal for the mission's power needs;
2. a site/date where direct-to-Earth communication is unavailable longer than planned.
Making these explicit early is cheaper than discovering them in operations.

### 3.3 Economic impact (qualitative, to be quantified with a customer)

- **Avoided re-planning cost:** engineering hours per site/date re-evaluation.
- **Risk-adjusted mission value:** a lunar lander mission is a high-value asset; a
  marginal illumination/comms decision can threaten the mission. Better front-end
  analysis is cheap insurance.
- **Market timing:** CLPS is a recurring, cadence-driven program; a repeatable tool has
  value per mission, not just per program.
- **Education/outreach value:** the same product serves the public-facing mission of
  Space Apps and partner agencies.

*(No public price/cost figures are asserted here; the business case belongs to the
commercialization package and must be built on verified sources.)*

### 3.4 Scientific and educational impact

- **Science–engineering trade-off made visible:** the challenge's core tension is that the
  best science site is not always the most operable site. A comparison surface makes the
  trade-off explicit instead of implicit.
- **Accessible lunar geometry:** the extreme difference between lunar and terrestrial
  conditions (no atmosphere, slow Sun, long shadows) becomes intuitive when visualized.
- **Bilingual and install-free:** lowers the barrier for Málaga's Spanish-speaking
  audience and for classrooms — directly serving the challenge's "educators and public"
  objective.

### 3.5 Alignment with NASA/CSA strategy and the judging frame

| Strategic theme | Connection |
| --- | --- |
| Artemis / lunar south pole | Site selection and surface-operations planning |
| CLPS | Rapid, repeatable site/date trade studies for commercial landers |
| Open data | LOLA (PDS), JPL Horizons ephemerides, Moon Trek layers, all NASA/partner sources |
| Science enablement | Illumination/shadowing context for ice-bearing regions |
| Workforce & education | Accessible, bilingual, web-native tool for non-specialists |

### 3.6 Impact KPIs (to instrument in the product and in user tests)

| KPI | Definition | Target (hypothesis) |
| --- | --- | --- |
| Time-to-comparison | Minutes to compare N sites × M dates end-to-end | ≤ 10 min for 3×3 |
| Scenario throughput | Site-date scenarios evaluated per session | ≥ 5 |
| Decision confidence | Self-reported confidence after using the tool | ≥ 4/5 |
| Accuracy | Illumination/Earth-visibility vs JPL Horizons reference | Matches within stated tolerance |
| Accessibility | Works without WebGL; EN/ES parity; keyboard usable | 100% of core flows |
| Reuse | Exported briefs shared/opened by a second person | ≥ 1 per session |
| Reach | Non-specialist (educator/public) completion of guided flow | ≥ 80% unassisted |

### 3.7 Evidence status (honest)

| Claim | Evidence today | Needed to call it proven |
| --- | --- | --- |
| Workflow gap exists | Challenge brief + repo docs | — (given by NASA/CSA) |
| Tool reduces comparison time | Design + UX reasoning | Timed usability test with 3–5 users |
| Tool improves decision quality | Architecture supports the metrics | Scenario test vs Horizons reference |
| Tool is usable by non-specialists | Accessibility design | Moderated test with an educator/public user |
| Economic value | Qualitative | One structured interview with a mission-planning professional |

---

## 4. Scalability assessment

### 4.1 Technical scalability

**Terrain / geography.** Today: two LOLA polar stereographic subsets
(`south-pole-875s-20m`, 2048² @ 74.06 m/px, ±75,840 m; `south-pole-80s-80m`, 1024² @
593.75 m/px, ±304,000 m; ~11 MB of binaries). The pipeline (`scripts/nasa/build-terrain.py`)
already abstracts DEM products, so scaling is:

| Axis | Today | Next | Then |
| --- | --- | --- | --- |
| Coverage | South pole (87.5S–90S, 80S–90S) | North pole | Mercury/Mars polar analogues |
| Resolution | 74 m / 594 m | Native 20 m / 80 m tiles | Higher-resolution DEM products |
| Delivery | Two whole `.bin` files | XYZ/quadtree tiles + LOD, lazy load | CDN + on-demand region fetch |
| Volume | ~11 MB shipped | Avoid shipping the widest region by default | Quantized/compressed, region-scoped downloads |

**Risk:** the current `dist/` is ~12 MB, dominated by terrain (~11 MB). On a slow
connection this is a real UX risk for a "rapid" tool. Mitigations, in order of value:
1. ship only the high-resolution region by default and lazy-load the wide region;
2. tile the DEM and load regions on demand;
3. quantize (int16 already) / gzip (already compressible — verify server compression);
4. cache immutably (hashed assets) and use a CDN.

**Ephemeris.** Production uses pre-computed datasets (static hosting has no server runtime,
and JPL Horizons does not send CORS headers). Scaling means: more sites, more epochs, finer
time steps, and a documented regeneration pipeline. The dev-only Vite proxy
(`/nasa/horizons`) is the correct seam for validation against live Horizons without
changing the production architecture.

**Compute.** Horizon ray tracing and site scoring are the CPU-heavy paths; the architecture
already reserves a single-threaded Web Worker for autopilot/ranking. Scale path: cache
horizon profiles per (site, azimuth resolution), precompute where possible, and keep the UI
thread free. Complexity is linear in azimuth samples × terrain samples and can be tuned with
an explicit accuracy/latency trade-off.

**Architecture contract.** `docs/architecture.md` splits core (pure domain), services
(data adapters), components/render (UI), workers and data scripts — each with a stable
interface. That is the real scalability asset: pieces can be swapped (new dataset, new
renderer, new exporter) without rewriting the product, and teams can work in parallel.

### 4.2 Product & business scalability

| Stage | Product shape | Users | Commercial shape |
| --- | --- | --- | --- |
| 0 — Hackathon | Static web tool, curated sites, EN/ES, JSON brief | Judges, educators | Open source, public URL |
| 1 — Pilot | Validated metrics, more sites/epochs, shareable briefs, PDF export | Mission planners, classrooms | Partnership with a CLPS/agency team; consulting |
| 2 — Platform | API + scenario workspace, saved studies, team sharing, more bodies | Commercial landers, universities, agencies | SaaS / seat licensing; data add-ons |
| 3 — Operational | Validated, versioned, auditable (mission-configurable) | Program offices | Enterprise contracts / integration |

**Ecosystem plays.** Integrate rather than compete: close the loop with Moon Trek layers,
QuickMap links (already designed in the JSON brief), JPL Horizons validation, and — at
platform stage — exporters for STK/GMAT workflows. Each integration widens reach without
adding terrain/data cost.

**Constraints to respect at scale:** NASA/CSA brand and attribution rules (no logo/flag/
mission identifier as our own branding); data redistribution limits (binary/large DEMs and
brand-restricted material stay out of the public repo); accuracy/validation claims must be
bounded and disclosed.

### 4.3 Organizational scalability

- **Contract-first parallel work:** the architecture contract lets coder/UI/data/commercial
  workstreams run in parallel with low merge friction.
- **Conventions + CI:** Conventional Commits, short-lived branches, English-only repo,
  automated checks. Current state: the application suite exists and passes (98 tests in
  7 files, `docs/test-report.md` §0); the remaining scale gap is UI-level E2E coverage and
  accuracy validation against reference ephemerides before multiple contributors make
  regressions likely.
- **Two-machine → many-machine:** the repo already models a primary + commercial split;
  adding a reviewer/pusher role and branch protection is the natural next step.

### 4.4 Scale limits and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 12 MB build / ~11 MB terrain | Slow first load; "rapid" promise broken | Lazy-load + tile + CDN + compression |
| Static hosting, no server | No live Horizons, no heavy server compute | Pre-computed datasets; worker-side compute; dev proxy for validation |
| DEM accuracy/resolution | Horizon errors at fine scales | State resolution/tolerance; validate against Horizons; ship native-res tiles where needed |
| Ephemeris scope | Wrong conclusions outside covered epochs | Generate wider epochs; show "within validated range" in UI |
| Automated tests exist but no UI/E2E or accuracy suite | Regressions as team grows; accuracy claims unproven | Keep the 98-test suite green in CI; add UI/E2E and Horizons-reference accuracy tests next |
| Brand/licensing | Submission rejection | Attribution footer; no NASA/CSA logos as own branding |
| Scope creep | Hackathon deadline (15 Nov 23:59) | Stage-0 scope discipline: comparison + Sun/Earth + power/comms + fallback |

### 4.5 Roadmap (impact × scalability)

| Phase | Milestone | Impact proof | Scalability proof |
| --- | --- | --- | --- |
| 0 | Submission MVP | Demo of 3 sites × 3 dates comparison | Static build, EN/ES, JSON brief |
| 1 | Post-event pilot | Timed usability + Horizons accuracy test | Second terrain region + more epochs |
| 2 | Platform | One real planning team uses it | API + workspace + integrations |
| 3 | Operational | Reused across missions/programs | Validated, versioned, auditable |

---

## 5. Validation hooks (hand-off to the test bench)

The impact claims are only credible if the geometry is right. Minimum validation set:

1. **Horizon correctness:** computed Sun/Earth horizon angle vs JPL Horizons for a fixed
   site/date within a declared tolerance.
2. **Terrain integrity:** DEM binaries parse as int16 LE, dimensions match metadata,
   min/max within declared elevation ranges, bilinear sampling stable.
3. **Time-to-set correctness:** sunset/earthset countdown matches the ephemeris crossing
   within the sampling interval.
4. **Power/comms sanity:** daily energy and comm-window durations respond monotonically to
   Sun elevation and Earth visibility.
5. **Accessibility:** no-WebGL fallback renders the same conclusions; EN/ES parity.
6. **Reproducibility:** a scenario exported as JSON reproduces the same numbers on reload.

---

## 6. Decisions and open questions for the Lead/team

1. **Data budget:** is ~11 MB acceptable for the hackathon demo, or do we ship high-res
   only and lazy-load the wide region? (Recommendation: measure first-load on a throttled
   connection; decide by Saturday evening.)
2. **Terrain scope for the demo:** keep both regions, or high-res only to protect the
   "rapid" promise?
3. **Accuracy statement:** which tolerance do we publicize (e.g. horizon angle ±x°)?
   Must be measured before the submission page text is frozen.
4. **Business case depth:** hackathon submission needs a believable, sourced commercial
   angle — not a full business plan (owned by the commercialization package).
5. **Asset/attribution:** confirm footer attributions (NASA/JPL/LOLA/PDS, Moon Trek, CSA)
   before publishing the public URL.

---

## 7. Sources

- Challenge brief (extracted): the official Challenge 10 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)
- Challenge wallpapers (14 challenges; #10 is the match): the official Málaga 2026 event material … `retos-3.png`
- Participant guide (rules, deliverables): the official Málaga 2026 participant guide (English summary in `docs/guide.md`); summary in repo `docs/guide.md`
- Technical contract and feature map: repo `docs/architecture.md`
- Deployment/static constraints: repo `docs/deployment.md`
- Terrain metadata and DEM provenance: repo `public/data/terrain/index.json`, `scripts/nasa/build-terrain.py`
- External references named by the challenge: NASA LOLA/PDS, JPL Horizons, Moon Trek, LROC QuickMap, CSA