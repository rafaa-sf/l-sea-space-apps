# Business case — L-SEA Space Apps (Lunar Landing Site Navigator)


> **Status snapshot (2026-11-14, `origin/develop` @ `5db7603`).** The application is implemented in source: a Vue 3 mission-control shell with 11 feature panels, a pure-JavaScript core (geometry, terrain, Sun/Earth horizon engine, ephemeris, power, communications, autopilot), service adapters, a single Web Worker, a Three.js scene with a no-WebGL Canvas 2D fallback, and the full real NASA datasets (`public/data/pois.json` — 10 sites; `public/data/ephemeris/` — 10 files × 2 928 samples at 30-minute steps from JPL Horizons DE441; `public/data/layers.json` — 21 verified Moon Trek layers; `public/data/terrain/` — 2 LOLA regions). `npm test` passes 98 tests in 7 files and `npm run build` is green; CI runs on `develop`. **Not yet validated:** end-to-end demo on a deployed URL, accuracy against live JPL Horizons references, usability. **Status refresh before submission:** re-check the final commit, the deployed public URL and the Project page fields before Submit for Judging.

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator*
**Event:** NASA International Space Apps Challenge · Málaga 2026 · Challenge #11 (partner agency: CSA)
**Owner:** commercial workstream · **Version:** 2026-11-14
**Status:** hackathon-stage business case. It is a **decision and narrative document**, not a validated business plan.
**Traceability:** every concrete claim cites the challenge brief, the Málaga/NASA event material, the repository docs or a named source. Anything unverified is tagged **`[HYPOTHESIS]`** or **TODO** — never presented as fact. No market-size, price or traction figures are asserted because no verified source for them is available in the provided material.

---

## 1. Executive summary

The lunar south pole is a focus of NASA's CLPS program and of other lunar missions, public and commercial — and, arguably, the hardest place in the current lunar economy to choose a landing site and date. The Sun drives solar power and thermal conditions; Earth visibility determines whether direct-to-Earth communications work without a relay; and small changes in site or date can change both dramatically. Mission timelines rarely hold, so re-evaluating alternatives is routine work done today across specialist tools: NASA's QuickMap, Moon Trek and the JPL Horizons System — all built for detailed analysis, not rapid scenario comparison (challenge brief).

**L-SEA Space Apps** is the design for the rapid comparison layer that decision needs: a static, install-free, bilingual (EN/ES) web tool that puts LOLA terrain, Sun/Earth-vs-horizon geometry, time-to-sunset/earthset, power and communications windows, and a mission-profile site scorer in one place, and exports a JSON mission brief linking back to QuickMap and Moon Trek.

**Commercial thesis.** Two buyers are credible at hackathon-to-pilot stage: (1) **mission-planning teams** (agency programs, CLPS providers, commercial landers) that need faster site/date trade studies and a shareable brief; (2) **education and outreach** (universities, museums, classrooms, partner-agency public engagement) for which an accessible, bilingual, no-specialist-tooling visualization is the product. The defensible path is **open-core + pilot partnerships**, not a closed SaaS play: the data is public, the algorithms are explainable, and the moat is validated UX, integration with the existing NASA/partner toolchain, and trust in the numbers.

**Honest state.** The application is a working foundation (shell + bilingual i18n + real, validated LOLA terrain data + build), and the comparison panels are planned work (`docs/architecture.md`). This business case is therefore framed as **design intent and measurable hypotheses**, with a validation plan in §10.

---

## 2. Problem and opportunity (grounded in the challenge)

From the official challenge brief (the official Challenge 11 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)):

| Fact (brief) | Commercial implication |
| --- | --- |
| CLPS and other lunar missions depend on landing-site/date choices that balance science and engineering. | The buyer is the mission-planning function, and the budget exists wherever a landing mission is planned. |
| The critical unknown is the **local lighting and communication environment**: Sun position → solar power and thermal conditions; Earth position → direct-to-Earth comms without relay. | Two operational risk drivers that program teams already spend engineering effort on. |
| At the south pole, **small changes in location or date dramatically affect** power generation and communication windows. | The decision is sensitive to input changes, so the value of fast iteration is high. |
| Mission development rarely proceeds on a fixed timeline; launch delays force re-evaluation of alternative sites in the same region, or alternative dates at the same site. | Recurring, high-frequency use case — the tool is used **when plans change**, which is often. |
| Tools providing this information (QuickMap, Moon Trek, JPL Horizons) are built for detailed analysis and are difficult for non-specialists to use for rapid scenario comparison. | The gap is a **UX/integration gap**, not a data gap: the raw inputs are already free and authoritative. |
| The challenge explicitly targets mission planners **and** educators and the general public. | Two-sided market: professional decision support plus education/outreach — useful for a public agency's dual mission. |

**Why now.** The brief ties the need to the current wave of south-pole missions (CLPS and other lunar missions, water-ice science). The underlying data (LOLA, Horizons, Moon Trek layers) is openly available, and modern browsers can do the geometry locally — a static web application is technically feasible with near-zero infrastructure cost. That is exactly the moment when a lightweight accessibility layer over existing authoritative tools is cheap to build and cheap to distribute.

**What we are *not* claiming.** We do not claim that no alternative tool can compare scenarios, that the market is a certain size, or that a buyer has been identified and interviewed. Those are TODOs in §10.

---

## 3. Customers and segments

| Segment | Need | How the product helps | Buying route / decision-maker | Evidence status |
| --- | --- | --- | --- | --- |
| **Space agencies** (NASA programs, CSA and other partner agencies) | Defensible, reproducible site/date trade studies; public-facing mission explainers | One comparison surface; JSON brief for review; bilingual public mode | Program/project offices, mission design teams; procurement via existing agency vehicles | Need is stated in the challenge brief; no agency interview yet `[HYPOTHESIS]` |
| **CLPS and commercial lunar landers** | De-risk site/date selection on tight schedules; re-plan fast after slips; shared scenario briefs | Rapid comparison + JSON brief + QuickMap/Moon Trek links for cross-checks | Mission/system engineering leads at lander providers; small contracts / paid pilots | Need follows from the brief (CLPS named); no provider interview yet `[HYPOTHESIS]` |
| **ISRU / resource-prospecting teams** | Understand illumination and shadowing near ice-bearing regions | Terrain + horizon + illumination views over the region | Science/PI teams, resource companies | Adjacent to the brief's water-ice context; not directly addressed in the brief `[HYPOTHESIS]` |
| **Academia / research groups** | A teaching and analysis aid for lunar geometry and mission design | Reproducible method; English/Spanish; exportable scenarios | Universities, planetary-science departments; grants/teaching budgets | Plausible per the brief's educator objective; no pricing evidence `[HYPOTHESIS]` |
| **Education and public outreach** | Explain *why* the Moon is hard, accessibly | Guided, visual, bilingual, no-WebGL fallback, static URL | Museums, schools, space-education programs, agency outreach budgets | Objective stated in brief; no organization commitment yet `[HYPOTHESIS]` |
| **Media / general public** | Understand mission decisions and lunar conditions | Public mode; shareable links | Indirect (reach, not revenue) | Not a revenue buyer; supports the outreach mission |

**Beachhead recommendation:** professional mission-planning teams at CLPS providers and agency programs, because the brief makes the need explicit and the value is easy to state in engineering terms (time saved per trade study, avoided marginal-site risk). Education is the second market and the strongest *reach* story for Space Apps judges.

---

## 4. Value proposition

### 4.1 For mission planners

**Time-to-comparison.** Today, evaluating one site–date combination means navigating multiple interfaces and interpreting raw data (challenge brief). The product's value unit is a **scenario comparison** (N sites × M dates) in a single workflow. Target KPI `[HYPOTHESIS]`: reduce a 3-site × 3-date comparison from hours/manual tool work to **≤ 10 minutes**, to be measured in a timed usability test (the impact dossier `docs/impact-scalability.md` §3.6 defines the same KPI).

**Re-plan speed after a slip.** The brief's most concrete pain — schedule change — becomes a "swap the date, re-run, compare" action.

**Shareable evidence.** The JSON mission brief records sites, mission profile and computed scenarios and links to QuickMap/Moon Trek, so a decision can be reviewed by someone else. This is a workflow asset, not just a calculator.

**Risk framing.** The tool makes marginal illumination (power) and direct-to-Earth comms windows visible before commitment. Value = avoided re-planning cost + risk reduction on a high-value mission asset `[HYPOTHESIS: value sizing]`.

### 4.2 For educators and the public

**Accessible geometry.** The brief explicitly invites tools for "educators and the general public curious about why the Moon presents such distinct engineering challenges". A bilingual, install-free, no-WebGL-fallback, static web tool is the lowest-friction possible format.

**Two-audience design.** One product with a professional mode (metrics, scoring, export) and a public/education mode (guided views, plain-language explanations) — same data, different depth. This is also the cheapest route to visible impact for a public agency.

### 4.3 Positioning statement

> For lunar mission planners and educators who must decide or explain **where and when to land at the Moon's south pole**, L-SEA Space Apps is a rapid scenario-comparison tool designed to turn authoritative NASA terrain and ephemeris data into side-by-side, mission-relevant answers — unlike QuickMap, Moon Trek and JPL Horizons, which are built for detailed analysis and are hard for non-specialists to use for quick comparisons.

---

## 5. Market sizing approach (no invented numbers)

**No TAM/SAM/SOM figure is asserted here.** The provided material contains no market data, and inventing one would violate the submission's honesty rules. Instead, the business case defines the sizing method to be completed with verified sources:

1. **Count landing opportunities, not companies.** The buying cycle is mission-driven: each lunar landing mission is a potential site/date trade-study user. Source to verify: public CLPS task-order records and agency lunar program documentation (TODO).
2. **Count planning seats per mission.** Trade studies are done by a small engineering group per mission project (mission design, surface systems, power, comms). Use public program org descriptions or interviews (TODO).
3. **Count education seats separately.** Universities/outreach programmes are typically licensed institutionally, not per mission (TODO).
4. **Price against alternatives.** The budget alternative is engineering hours in existing tools (QuickMap/Moon Trek/Horizons) plus spreadsheet/desktop analysis; the product must be cheaper than the hours it saves, or it must add evidence the alternatives cannot produce quickly (TODO: validate with 3–5 interviews).
5. **Do not claim a market until at least one interview and one public budget document are sourced.**

**Market risk:** the number of south-pole landing missions in any given year may be small, which caps a pure per-mission market. This is why the product design targets **two markets (professional + education) and a reusable engine** (see §8), and why a services/partnership-first model is recommended over a high-price SaaS bet.

---

## 6. Business model options

| Option | What it looks like | Pros | Cons / risks | Stage fit |
| --- | --- | --- | --- | --- |
| **A. Open-core + services** | Public static tool and open repo; paid support, custom studies, integration | Matches open-data/open-source norms; builds trust; low adoption friction | Services do not scale; requires client relationships | **Recommended stage 0–1** |
| **B. B2G pilot / SBIR-style contract** | Small paid feasibility/pilot for a mission team or agency | Clear buyer, real validation, funds development | Long procurement cycles; hackathon stage has no vehicle yet | Stage 1 (after demo evidence) |
| **C. Institutional SaaS (seats)** | Hosted workspace, saved studies, team sharing, exports | Recurring revenue; natural upsell from free tool | Requires trust, security review, SLAs; public data makes "why pay" hard at low value | Stage 2 |
| **D. Education licensing** | Classroom/outreach licence with guided curriculum material | Public-good alignment; institutional budgets; strong Space Apps story | Budget cycles; must prove classroom usability; content work | Stage 1–2 |
| **E. Integration / white-label SDK** | Embed the comparison engine in a partner's existing tool | Distribution through an established platform (Moon Trek-style ecosystem) | Integration cost; partner dependency; commercial terms unknown | Stage 2–3 |
| **F. Grants / sponsorship** | Agency innovation grants, university funding, competition prizes | Non-dilutive; fits research/education framing | Competitive, slow; not a product strategy on its own | Parallel |

**Recommended model:** **open-core + pilot partnerships.** Keep the public tool open and free (adoption, trust, agency fit, Space Apps values); monetize validation-grade missions and education with paid pilots, custom studies and institutional licences. Revisit SaaS only after a validated professional user base and a security/ops story exist.

**Pricing stance (deliberately unquantified):** paid pilot and per-institution licence hypotheses only; **no price point** is asserted until customer conversations exist. If a price is needed for the pitch, present it as a *hypothesis to test*, never as a validated number.

---

## 7. Go-to-market

| Horizon | Goal | Actions |
| --- | --- | --- |
| **0 — Hackathon (14–15 Nov 2026)** | Credible public demo; submission | Finish the comparison MVP; publish public URL and repo; complete Project page; rehearse pitch around the brief's gap; collect judge/mentor feedback. |
| **3 months** | Validation | 3–5 structured interviews (mission planners, educators); timed usability test of a 3×3 comparison; one accuracy comparison of illumination/comms vs JPL Horizons reference; publish method and limits. |
| **6 months** | First paid pilot | Partner with one CLPS/mission team or one education programme; scope a small paid study (e.g. "evaluate 5 candidate sites for two launch dates and deliver a briefing pack"); use the JSON brief as the deliverable format. |
| **12 months** | Product/platform decision | Based on pilot evidence: pursue integration (Moon Trek/QuickMap/agency toolchain), institutional education licences, or a funded R&D track. |

**Channels.** Space Apps community and Málaga local network; the CSA challenge ecosystem (partner agency alignment); university planetary-science and aerospace-engineering departments; agency SBIR/innovation channels; lunar conference and community venues. The existing NASA/partner toolchain is a **partner channel, not a competitor channel** — every brief links back to QuickMap/Moon Trek.

**Proof assets for outreach (honest):** the live static demo, the public repository, the validated LOLA terrain pipeline (PASS evidence), the architecture contract (shows a real product plan), and this package. Do not lead with unbuilt features.

---

## 8. Competitive and comparable landscape

The challenge brief names the core comparables and their limitation: **NASA's QuickMap, Moon Trek and the JPL Horizons System are built for detailed analysis and are often difficult for non-specialists to use effectively for rapid scenario comparison.** The table adds the other comparables named in this work package; the characterizations are deliberately high-level and must be verified before publication in any external material.

| Tool | What it is (source / note) | Strength | Gap for "rapid site–date comparison" | Our differentiation |
| --- | --- | --- | --- | --- |
| **JPL Horizons** | NASA/JPL ephemeris system (challenge brief) | Authoritative, high-precision body positions | Not a terrain/horizon tool; raw ephemeris output; specialist interface | We consume its data and translate it into horizon, window and "time remaining" answers for a chosen site |
| **NASA Moon Trek** | NASA lunar visualization portal (challenge brief; [trek.nasa.gov/moon](https://trek.nasa.gov/moon/)) | Rich layers, authoritative context, mission-planning heritage | Detailed-analysis tool; not built for rapid side-by-side site/date comparison | We add the scenario-comparison and scoring layer, and deep-link back to Moon Trek |
| **LROC QuickMap** | LROC/ASU lunar map interface ([quickmap.lroc.asu.edu](https://quickmap.lroc.asu.edu/)); named by the challenge brief as "Quickmap" | Excellent imagery/terrain browsing, high-resolution context | Browsing-oriented; not a mission-scenario comparator | Brief links to QuickMap for verification; we do the scenario math and comparison |
| **CSA Moon Explorer** | CSA tool referenced in the repo as the style inspiration for curated points of interest (`docs/architecture.md`, feature 1) | Curated lunar sites, accessible presentation | Not a site×date feasibility comparator (per our use case); URL/licence **TODO verify** | We adopt the curated-site UX and add Sun/Earth-horizon, power, comms and ranking |
| **STK / GMAT** | Professional astrodynamics and mission-analysis tools (comparables named for this analysis; **not** named in the challenge brief) | Industry-standard high-fidelity mission analysis | Desktop/expert tooling; not a web-native rapid comparison for non-specialists; steeper setup | We are the fast, accessible front end; integration/export to professional tools is a later opportunity |
| **Spreadsheets / ad-hoc scripts** | The actual status quo for many trade studies `[HYPOTHESIS]` | Flexible, familiar | Error-prone, non-reproducible, no terrain, no shareable brief | One method, reproducible JSON brief, validated terrain |

**Differentiation summary**

1. **Scenario comparison as the core object**, not a single site analysis — directly answers "which site/date?".
2. **Mission-profile scoring** (power need, relay availability, required sunlight days) turns data into a decision.
3. **Bilingual EN/ES** and **no-WebGL fallback** lower the barrier for Málaga/Spain, Latin America and classrooms.
4. **Static, install-free, open** — trivially shareable with a public link, no account.
5. **Complements the authoritative tools** (QuickMap/Moon Trek links in the brief; Horizons data) — integration is the strategy, not competition.

**Honest moat assessment:** there is no deep technical moat — the data is public and the math is standard. The durable advantages would be **validated accuracy with disclosed tolerance**, a **trusted comparison UX**, **integrations into agency workflows**, and **institutional relationships**. That is an execution and trust moat, not an IP moat — and the business case should be planned accordingly.

---

## 9. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
| --- | --- | --- |
| Nobody pays because the data/tools are free | Medium / High | Open-core + paid pilots tied to *validation and delivered briefs*, not data access; education licensing as second market |
| Market is small (few missions/year) | Medium / High | Two-market design; reusable engine for other bodies/poles; services model; integration with established platforms |
| Accuracy challenge: a wrong illumination/comms claim destroys trust | Medium / High | Disclose method and tolerance; validate against Horizons; keep the tool framed as planning support, not flight-certified analysis |
| Static-hosting limits (no live Horizons, no server) | Known / Medium | Pre-computed datasets + versioned generation; dev proxy for validation; document coverage; refresh pipeline |
| 12 MB build / slow first load undermines "rapid" | Medium / Medium | Lazy-load, tile, CDN, compression (impact dossier §4.1) |
| NASA/CSA brand and data-licence mistakes | Medium / High | No logos/flags/mission IDs as branding; attribution in metadata and UI; verify licences before publishing |
| Hackathon scope creep vs. deadline | High / Medium | Stage-0 scope: comparison + Sun/Earth + power/comms + fallback; everything else declared as planned |
| Team capacity (small team, two machines) | Medium / Medium | Contract-first architecture; fixed interfaces; this package separates claims from evidence |
| AI-generated content policy breach | Low / High | Complete the AI declaration; mark generated assets; verify all content |

---

## 10. Validation plan — what would make this business case credible

| # | Question | Test | Success signal |
| --- | --- | --- | --- |
| 1 | Does the workflow gap actually cost time? | 3–5 interviews with mission-planning professionals; walk through current workflow | At least 3 confirm the multi-tool/manual-comparison pain |
| 2 | Is the tool faster? | Timed usability test: 3 sites × 3 dates vs. baseline workflow | ≤ 10 min to a defensible comparison `[HYPOTHESIS]` |
| 3 | Are the numbers defensible? | Compare illumination/Earth-visibility results against JPL Horizons reference for fixed site/date | Agreement within a published tolerance; method documented |
| 4 | Can a non-specialist use it? | Moderated test with an educator/public user | Completes the guided flow unassisted; explains the trade-off correctly |
| 5 | What would a buyer pay for? | Structured interview: pilot scope, deliverable, budget route | One concrete pilot scope and a procurement path |
| 6 | What is the market? | Public agency budget/CLPS records + interviews | A sourced, modest estimate — not a top-down TAM guess |

**Evidence today (honest):** the workflow gap is given by the challenge brief; the terrain data pipeline is validated (team test bench: PASS, cross-region Pearson r = 0.9993); the UI is a shell; the comparison/scoring is planned. No business validation has been performed.

---

## 11. Milestones and funding options

| Stage | Milestone | Funding / resource route |
| --- | --- | --- |
| 0 | Public demo + validated terrain (now) | Hackathon effort; no external funding |
| 1 | Pilot evidence: interviews, usability, accuracy test, first paid study | Agency innovation/SBIR-style small grant, university collaboration, competition prizes, sponsor |
| 2 | Platform: API/workspace, more regions/epochs, integrations | Seed/accelerator, research grant, partner co-development |
| 3 | Operational/validated tool | Procurement/enterprise contract, institutional licences, integration partnership |

Grants and competitions are non-dilutive and fit the public-data/public-good framing; **none is committed**. List them as options, not facts, and verify eligibility before citing.

---

## Sources

- Challenge brief #11 "Lunar Landing Site Navigator": the official Challenge 11 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/) (official challenge statement; local extraction truncated)
- Málaga 2026 challenge wallpapers (challenge 11 = "Navegador de aterrizaje lunar"): the official Málaga 2026 event material
- Participant guide 2026 and English summary: the official Málaga 2026 participant guide (English summary in `docs/guide.md`); `docs/guide.md`
- Technical contract, feature map and static constraints: `docs/architecture.md`, `docs/deployment.md`
- Current code/build/test status: the application is implemented in source (`src/`), 98 automated tests pass, the production build is green, and the real NASA datasets are shipped — see `docs/test-report.md` §0. Remaining: end-to-end demo on a deployed URL and accuracy validation against live Horizons
- Impact/scalability dossier and KPIs: `docs/impact-scalability.md`
- External tools named by the challenge: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), [NASA Moon Trek](https://trek.nasa.gov/moon/), [LROC QuickMap](https://quickmap.lroc.asu.edu/); licensed products/concepts (STK/GMAT, CSA Moon Explorer) are comparables for this analysis and their URLs/licences need verification before external publication
- External links cited: [NASA Space Apps 2026](https://www.spaceappschallenge.org/2026/), [Málaga Local Event](https://www.spaceappschallenge.org/2026/local-events/malaga/)

## Open questions / TODOs

1. **Market data** — no TAM/SAM/SOM until public budget/CLPS records and interviews are sourced (do not invent).
2. **Customer evidence** — run the first 3–5 interviews; replace `[HYPOTHESIS]` labels with findings.
3. **Pricing** — define pilot and licence hypotheses after interviews; do not publish a price before then.
4. **CSA Moon Explorer / STK / GMAT** — verify official URLs, licences and one-sentence descriptions before external use.
5. **Final build status** — align §1 and §7 with the final demo (built vs. planned) at submission time.