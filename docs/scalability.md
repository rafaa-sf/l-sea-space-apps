# Impact and scalability

Impact assessment and scalability analysis for L-SEA Space Apps. This is the
companion of [commercial.md](commercial.md) (open-source and free policy, licensing
and who it helps),
[architecture.md](architecture.md) and [deployment.md](deployment.md) (the technical
constraints behind the scale limits), and [qa.md](qa.md) (measured build and test
evidence). Claims are hypotheses unless a source is cited, and every unverified claim
is marked as such.

## 1. Impact assessment

### 1.1 Beneficiaries

| Beneficiary | Need | How the tool helps |
| --- | --- | --- |
| Mission planners and systems engineers (agencies, CLPS providers) | Fast trade-offs between candidate sites and dates | Side-by-side scenarios with illumination, Earth visibility, power, communications and time-to-set metrics |
| Science teams | Preserve science value while meeting engineering constraints | Same comparison layer, with terrain and permanently shadowed region context |
| Commercial lunar landers | De-risk site and date selection on tight schedules | Install-free, shareable JSON scenario briefs |
| ISRU and resource teams | Understand illumination and shadowing near ice-bearing regions | Terrain, horizon and illumination views over the region |
| Educators and the public | Understand why the Moon is hard | Bilingual, accessible, no specialist tooling |
| Partner agencies and NASA programmes (Artemis, CLPS) | Accessible decision support and outreach | Aligns with the challenge's dual mission: planning plus education |

### 1.2 Operational, economic, scientific and educational impact

- **Cycle-time reduction.** The tool collapses multiple interfaces and manual
  interpretation into one comparison surface. Target KPI: time to compare 3 candidate
  sites x 3 dates, baseline "hours to days", target under 10 minutes (estimate, to be
  measured in a usability test).
- **Resilience to schedule change.** Re-answering "which alternative site or date
  still works?" in minutes directly reduces the cost of the most common
  mission-planning disruption.
- **Risk reduction.** Two failure modes become visible before commitment: a site whose
  solar illumination is marginal for the mission's power needs, and a site and date
  where direct-to-Earth communication is unavailable longer than planned.
- **Operational value.** Avoided re-planning work, faster schedule trades, and
  education and outreach value. No cost, price or financial figures are asserted.
- **Scientific and educational impact.** The science-versus-operability trade-off is
  made explicit; lunar conditions (no atmosphere, slow Sun, long shadows) become
  intuitive when visualised; the bilingual, install-free format lowers the barrier for
  Spanish-speaking audiences and classrooms.

### 1.3 Alignment with NASA and CSA strategy

| Strategic theme | Connection |
| --- | --- |
| Artemis and lunar south pole | Site selection and surface-operations planning |
| CLPS | Rapid, repeatable site and date trade studies for commercial landers |
| Open data | LOLA (PDS), JPL Horizons ephemerides, Moon Trek layers |
| Science enablement | Illumination and shadowing context for ice-bearing regions |
| Workforce and education | Accessible, bilingual, web-native tool for non-specialists |

### 1.4 Impact KPIs (to instrument in the product and in user tests)

| KPI | Definition | Target (hypothesis) |
| --- | --- | --- |
| Time-to-comparison | Minutes to compare N sites x M dates end to end | 10 minutes or less for 3 x 3 |
| Scenario throughput | Site and date scenarios evaluated per session | 5 or more |
| Decision confidence | Self-reported confidence after using the tool | 4 of 5 or more |
| Accuracy | Illumination and Earth visibility against JPL Horizons reference | Matches within a stated tolerance |
| Accessibility | Works without WebGL; EN/ES parity; keyboard usable | All core flows |
| Reuse | Exported briefs shared or opened by a second person | At least 1 per session |
| Reach | Non-specialist completion of the guided flow | 80 percent or more unassisted |

### 1.5 Evidence status

| Claim | Evidence today | Needed to call it proven |
| --- | --- | --- |
| Workflow gap exists | Challenge brief and repository documentation | Given by NASA/CSA |
| Tool reduces comparison time | Design and user-experience reasoning | Timed usability test with 3-5 users |
| Tool improves decision quality | Architecture supports the metrics | Scenario test against Horizons reference |
| Tool is usable by non-specialists | Accessibility design | Moderated test with an educator or public user |
| Operational value | Qualitative | One structured interview with a mission-planning professional |

## 2. Scalability

### 2.1 Technical scalability

**Terrain and geography.** Today two LOLA polar stereographic subsets are shipped
(`south-pole-875s-20m`, 2048 squared at 74.06 m/px, plus/minus 75,840 m;
`south-pole-80s-80m`, 1024 squared at 593.75 m/px, plus/minus 304,000 m; about 10.5 MB
of binaries). The pipeline already abstracts DEM products, so scaling is:

| Axis | Today | Next | Then |
| --- | --- | --- | --- |
| Coverage | South pole (87.5S-90S, 80S-90S) | North pole | Mercury and Mars polar analogues |
| Resolution | 74 m and 594 m | Native 20 m and 80 m tiles | Higher-resolution DEM products |
| Delivery | Two whole binaries | XYZ or quadtree tiles with level of detail, lazy loading | CDN and on-demand region fetch |
| Volume | About 10.5 MB shipped | Avoid shipping the widest region by default | Quantised, compressed, region-scoped downloads |

Risk: the whole build is about 20 MB, dominated by terrain. On a slow connection that
is a real risk for a "rapid" tool. Mitigations, in order of value: ship only the
high-resolution region by default and lazy-load the wide region; tile the DEM and load
regions on demand; quantise (already int16) and verify server compression; cache
immutably on a CDN.

**Ephemeris.** Production uses pre-computed datasets because static hosting has no
server runtime and Horizons does not send CORS headers. Scaling means more sites, more
epochs and finer time steps, with a documented regeneration pipeline. The dev-only Vite
proxy is the correct seam for validation against live Horizons without changing the
production architecture.

**Compute.** Horizon ray tracing and site scoring are the CPU-heavy paths, and the
architecture already reserves a single-threaded Web Worker for autopilot and ranking.
Scale path: cache horizon profiles per site and azimuth resolution, precompute where
possible, keep the UI thread free. Complexity is linear in azimuth samples times
terrain samples and can be tuned with an explicit accuracy and latency trade-off.

**Architecture contract.** The split into core (pure domain), services (data adapters),
components and render (UI), workers and data scripts, each with a stable interface, is
the real scalability asset: pieces can be swapped (new dataset, new renderer, new
exporter) without rewriting the product, and teams can work in parallel.

### 2.2 Product and open-source scalability

| Stage | Product shape | Users | Open-source shape |
| --- | --- | --- | --- |
| 0, hackathon | Static web tool, curated sites, EN/ES, JSON brief | Judges, educators | MIT public repository and free public demo |
| 1, pilot | Validated metrics, more sites and epochs, shareable briefs, PDF export | Mission planners, classrooms | Free self-hosting; partnerships with a CLPS or agency team welcome |
| 2, platform | API and scenario workspace, saved studies, team sharing, more bodies | Lunar landers, universities, agencies | Free hosted and self-hosted use; grants or partnerships welcome, never required |
| 3, operational | Validated, versioned, auditable, mission-configurable | Programme offices | Same MIT terms; optional institutional partnerships and integration |

**Ecosystem plays.** Integrate rather than compete: close the loop with Moon Trek
layers, QuickMap links (already designed in the JSON brief), JPL Horizons validation
and, at platform stage, exporters for STK and GMAT workflows.

**Constraints to respect at scale:** NASA and CSA brand and attribution rules (no logo,
flag or mission identifier as our branding); data redistribution limits (binary or
large DEMs and brand-restricted material stay out of the public repository); accuracy
and validation claims must be bounded and disclosed.

### 2.3 Organisational scalability

- **Contract-first parallel work:** the architecture contract lets coder, UI, data and
  commercial workstreams run in parallel with low merge friction.
- **Conventions and CI:** Conventional Commits, short-lived branches, English-only
  repository and automated checks. Current state: the application suite passes (275
  tests in 17 files) plus 8 MCP tests, and CI is green; the remaining scale gap is
  a full accuracy-validation campaign against reference ephemerides (the sampled
  `npm run verify:horizons` spot-check passes) and expanded end-to-end coverage.
- **Two machines to many:** the repository already models a primary and commercial
  split; adding reviewer roles and branch protection is the natural next step.

### 2.4 Scale limits and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 20 MB build, 10.5 MB terrain | Slow first load breaks the "rapid" promise | Lazy-load, tile, CDN, compression |
| Static hosting, no server | No live Horizons, no heavy server compute | Pre-computed datasets; worker-side compute; dev proxy for validation |
| DEM accuracy and resolution | Horizon errors at fine scales | State resolution and tolerance; validate against Horizons; ship native-resolution tiles where needed |
| Ephemeris scope | Wrong conclusions outside covered epochs | Generate wider epochs; show "within validated range" in the UI |
| Accuracy only sampled against Horizons | Sampled check passes; a full campaign is unproven | Keep `npm run verify:horizons` green; extend it to a non-sampled campaign |
| Brand and licensing | Submission rejection | Attribution footer; no NASA or CSA logos as own branding |
| Scope creep | Hackathon deadline | Stage-0 scope discipline: comparison, Sun/Earth, power and communications, fallback |

### 2.5 Roadmap

| Phase | Milestone | Impact proof | Scalability proof |
| --- | --- | --- | --- |
| 0 | Submission MVP | Demo of a 3 sites x 3 dates comparison | Static build, EN/ES, JSON brief |
| 1 | Post-event pilot | Timed usability plus Horizons accuracy test | Second terrain region and more epochs |
| 2 | Platform | One real planning team uses it | API, workspace and integrations |
| 3 | Operational | Reused across missions and programmes | Validated, versioned, auditable |

## 3. Sources

- Challenge brief 10, Lunar Landing Site Navigator:
  <https://www.spaceappschallenge.org/2026/challenges/>
- Technical contract and feature map: [architecture.md](architecture.md)
- Static deployment constraints: [deployment.md](deployment.md)
- Build, test and QA evidence: [qa.md](qa.md)
- Terrain metadata and provenance: `public/data/terrain/index.json` and
  `scripts/nasa/build-terrain.py`
- Open-source, licensing and judging context: [commercial.md](commercial.md)
