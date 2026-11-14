# Commercial case and judging criteria

Business case and the judging-criteria mapping for L-SEA Space Apps. Impact and
scalability are assessed in the companion document [scalability.md](scalability.md). This is a decision and narrative document, not a validated business
plan: every concrete claim cites the challenge brief, the event material, the
repository or a named source, and anything unverified is labelled as a hypothesis. No
market-size, price or traction figures are asserted, because no verified source for
them exists in the provided material.

## 1. Executive summary

The lunar south pole is a focus of NASA's CLPS programme and of other lunar missions,
public and commercial, and arguably the hardest place in the current lunar economy to
choose a landing site and date. The Sun drives solar power and thermal conditions;
Earth visibility determines whether direct-to-Earth communications work without a
relay; and small changes in site or date can change both dramatically. Mission
timelines rarely hold, so re-evaluating alternatives is routine work done today across
specialist tools: NASA QuickMap, Moon Trek and the JPL Horizons System, all built for
detailed analysis rather than rapid scenario comparison (challenge brief).

L-SEA Space Apps is the rapid comparison layer that decision needs: a static,
install-free, bilingual (EN/ES) web tool that puts LOLA terrain, Sun/Earth-versus-
horizon geometry, time to sunset or Earthset, power and communications windows, and a
mission-profile site scorer in one place, and exports a JSON mission brief linking back
to QuickMap and Moon Trek.

**Commercial thesis.** Two buyers are credible at hackathon-to-pilot stage:

1. **Mission-planning teams** (agency programmes, CLPS providers, commercial landers)
   that need faster site and date trade studies and a shareable brief.
2. **Education and outreach** (universities, museums, classrooms, partner-agency
   public engagement), for which an accessible, bilingual, no-specialist-tooling
   visualisation is the product.

The defensible path is **open-core plus pilot partnerships**, not a closed SaaS play:
the data is public, the algorithms are explainable, and the moat is validated user
experience, integration with the existing NASA and partner toolchain, and trust in the
numbers.

**Honest state.** The application is implemented, tested, merged on `main` and
deployed, and it ships real, validated NASA data. This document is framed as design
intent and measurable hypotheses, with a validation plan in section 10.

## 2. Problem and opportunity

From the official challenge brief:

| Fact (brief) | Commercial implication |
| --- | --- |
| CLPS and other lunar missions depend on landing-site and date choices that balance science and engineering. | The buyer is the mission-planning function, and the budget exists wherever a landing mission is planned. |
| The critical unknown is the local lighting and communication environment: Sun position drives solar power and thermal conditions; Earth position determines whether direct-to-Earth communication is possible without a relay. | Two operational risk drivers that programme teams already spend engineering effort on. |
| At the south pole, small changes in location or date dramatically affect power generation and communication windows. | The decision is sensitive to input changes, so the value of fast iteration is high. |
| Mission development rarely proceeds on a fixed timeline; launch delays force re-evaluation of alternative sites in the same region, or alternative dates at the same site. | A recurring, high-frequency use case: the tool is used when plans change, which is often. |
| Tools providing this information (QuickMap, Moon Trek, JPL Horizons) are built for detailed analysis and are difficult for non-specialists to use for rapid scenario comparison. | The gap is a user-experience and integration gap, not a data gap: the raw inputs are already free and authoritative. |
| The challenge explicitly targets mission planners as well as educators and the general public. | A two-sided market: professional decision support plus education and outreach. |

**Why now.** The brief ties the need to the current wave of south-pole missions (CLPS
and other lunar missions, water-ice science). The underlying data is openly available,
and modern browsers can do the geometry locally, so a static web application is
technically feasible with near-zero infrastructure cost.

**What is not claimed.** We do not claim that no alternative tool can compare
scenarios, that the market is a certain size, or that a buyer has been identified and
interviewed. Those are validation tasks, not facts.

## 3. Customers and segments

| Segment | Need | How the product helps | Decision-maker | Evidence status |
| --- | --- | --- | --- | --- |
| Space agencies (NASA programmes, CSA and other partner agencies) | Defensible, reproducible site and date trade studies; public-facing mission explainers | One comparison surface; JSON brief for review; bilingual public mode | Programme and project offices, mission design teams | Need stated in the challenge brief; no agency interview yet (hypothesis) |
| CLPS and commercial lunar landers | De-risk site and date selection on tight schedules; re-plan after slips; shared scenario briefs | Rapid comparison, JSON brief, QuickMap and Moon Trek links | Mission and system engineering leads | Need follows from the brief; no provider interview yet (hypothesis) |
| ISRU and resource-prospecting teams | Understand illumination and shadowing near ice-bearing regions | Terrain, horizon and illumination views over the region | Science and principal-investigator teams | Adjacent to the brief's water-ice context (hypothesis) |
| Academia and research groups | A teaching and analysis aid for lunar geometry and mission design | Reproducible method; English and Spanish; exportable scenarios | Universities, planetary-science departments | Plausible per the brief's educator objective (hypothesis) |
| Education and public outreach | Explain why the Moon is hard, accessibly | Guided, visual, bilingual, no-WebGL fallback, static URL | Museums, schools, space-education programmes | Objective stated in the brief; no commitment yet (hypothesis) |
| Media and general public | Understand mission decisions and lunar conditions | Public mode; shareable links | Indirect (reach, not revenue) | Not a revenue buyer; supports the outreach mission |

**Beachhead recommendation:** professional mission-planning teams at CLPS providers
and agency programmes, because the brief makes the need explicit and the value is easy
to state in engineering terms (time saved per trade study, avoided marginal-site risk).
Education is the second market and the strongest reach story for Space Apps judges.

## 4. Value proposition

### 4.1 For mission planners

- **Time-to-comparison.** Today, evaluating one site and date combination means
  navigating multiple interfaces and interpreting raw data. The product's value unit is
  a scenario comparison (N sites x M dates) in a single workflow. Target KPI
  (hypothesis): reduce a 3-site x 3-date comparison to 10 minutes or less, measured in
  a timed usability test.
- **Re-plan speed after a slip.** The brief's most concrete pain, schedule change,
  becomes a "swap the date, re-run, compare" action.
- **Shareable evidence.** The JSON mission brief records sites, mission profile and
  computed scenarios and links to QuickMap and Moon Trek, so a decision can be reviewed
  by someone else.
- **Risk framing.** The tool makes marginal illumination (power) and direct-to-Earth
  communications windows visible before commitment. Value is avoided re-planning cost
  plus risk reduction on a high-value mission asset (value sizing is a hypothesis).

### 4.2 For educators and the public

- **Accessible geometry.** The brief explicitly invites tools for educators and the
  general public curious about why the Moon presents such distinct engineering
  challenges. A bilingual, install-free, no-WebGL-fallback, static web tool is the
  lowest-friction format.
- **Two-audience design.** One product with a professional mode (metrics, scoring,
  export) and a public mode (guided views, plain-language explanations), same data,
  different depth.

### 4.3 Positioning statement

For lunar mission planners and educators who must decide or explain where and when to
land at the Moon's south pole, L-SEA Space Apps is a rapid scenario-comparison tool
designed to turn authoritative NASA terrain and ephemeris data into side-by-side,
mission-relevant answers, unlike QuickMap, Moon Trek and JPL Horizons, which are built
for detailed analysis and are hard for non-specialists to use for quick comparisons.

## 5. Market sizing approach

No TAM, SAM or SOM figure is asserted. The material contains no market data, and
inventing one would violate the submission's honesty rules. The sizing method to be
completed with verified sources is:

1. **Count landing opportunities, not companies.** The buying cycle is mission-driven:
   each lunar landing mission is a potential site and date trade-study user. Source to
   verify: public CLPS task-order records and agency lunar programme documentation.
2. **Count planning seats per mission.** Trade studies are done by a small engineering
   group per mission project (mission design, surface systems, power, communications).
3. **Count education seats separately.** Universities and outreach programmes are
   typically licensed institutionally, not per mission.
4. **Price against alternatives.** The budget alternative is engineering hours in
   existing tools plus spreadsheet analysis; the product must be cheaper than the hours
   it saves or add evidence the alternatives cannot produce quickly.
5. **Do not claim a market until at least one interview and one public budget document
   are sourced.**

**Market risk:** the number of south-pole landing missions in a given year may be
small, which caps a pure per-mission market. That is why the design targets two markets
and a reusable engine.

## 6. Business model options

| Option | What it looks like | Pros | Cons and risks | Stage fit |
| --- | --- | --- | --- | --- |
| Open-core plus services | Public static tool and open repository; paid support, custom studies, integration | Matches open-data norms; builds trust; low adoption friction | Services do not scale; requires client relationships | Recommended stage 0-1 |
| B2G pilot or SBIR-style contract | Small paid feasibility pilot for a mission team or agency | Clear buyer, real validation, funds development | Long procurement cycles | Stage 1, after demo evidence |
| Institutional SaaS (seats) | Hosted workspace, saved studies, team sharing, exports | Recurring revenue; natural upsell | Requires trust, security review and SLAs; public data makes low-value subscriptions hard | Stage 2 |
| Education licensing | Classroom and outreach licence with curriculum material | Public-good alignment; institutional budgets | Budget cycles; must prove classroom usability | Stage 1-2 |
| Integration or white-label SDK | Embed the comparison engine in a partner's tool | Distribution through an established platform | Integration cost; partner dependency | Stage 2-3 |
| Grants and sponsorship | Agency innovation grants, university funding, prizes | Non-dilutive; fits research and education framing | Competitive and slow; not a product strategy alone | Parallel |

**Recommended model:** open-core plus pilot partnerships. Keep the public tool open and
free for adoption, trust and agency fit; monetise validation-grade missions and
education with paid pilots, custom studies and institutional licences. Revisit SaaS
only after a validated professional user base and a security and operations story
exist.

**Pricing stance:** paid pilot and per-institution licence hypotheses only; no price
point is asserted until customer conversations exist.

## 7. Go-to-market

| Horizon | Goal | Actions |
| --- | --- | --- |
| 0, hackathon (14-15 November 2026) | Credible public demo and submission | Publish the public URL and repository; complete the Project page; rehearse the pitch around the brief's gap; collect judge and mentor feedback |
| 3 months | Validation | 3-5 structured interviews (mission planners, educators); timed usability test of a 3 x 3 comparison; one accuracy comparison against JPL Horizons reference; publish the method and limits |
| 6 months | First paid pilot | Partner with one CLPS or mission team or one education programme; scope a small paid study; use the JSON brief as the deliverable format |
| 12 months | Product or platform decision | Based on pilot evidence: integration with the NASA/partner toolchain, institutional education licences, or a funded research track |

**Channels.** Space Apps community and the Málaga network; the CSA challenge
ecosystem; university planetary-science and aerospace-engineering departments; agency
SBIR and innovation channels; lunar conference and community venues. The existing
NASA/partner toolchain is a partner channel, not a competitor channel: every brief
links back to QuickMap and Moon Trek.

**Proof assets for outreach:** the live static demo, the public repository, the
validated LOLA terrain pipeline, the architecture contract and this documentation set.
Do not lead with unbuilt features.

## 8. Competitive landscape

The challenge brief names the core comparables and their limitation: NASA QuickMap,
Moon Trek and the JPL Horizons System are built for detailed analysis and are often
difficult for non-specialists to use effectively for rapid scenario comparison.

| Tool | What it is | Strength | Gap for rapid site and date comparison | Our differentiation |
| --- | --- | --- | --- | --- |
| JPL Horizons | NASA/JPL ephemeris system | Authoritative, high-precision body positions | Not a terrain or horizon tool; raw ephemeris output; specialist interface | We consume its data and translate it into horizon, window and "time remaining" answers for a chosen site |
| NASA Moon Trek | NASA lunar visualisation portal | Rich layers, authoritative context, mission-planning heritage | Detailed-analysis tool; not built for rapid side-by-side comparison | We add the scenario-comparison and scoring layer and deep-link back to Moon Trek |
| LROC QuickMap | LROC/ASU lunar map interface | Excellent imagery and terrain browsing | Browsing-oriented; not a mission-scenario comparator | The brief links to QuickMap for verification; we do the scenario math and comparison |
| CSA Moon Explorer | CSA tool referenced as style inspiration for curated points of interest | Curated lunar sites, accessible presentation | Not a site and date feasibility comparator for our use case | We adopt the curated-site experience and add Sun/Earth-horizon, power, communications and ranking |
| STK and GMAT | Professional astrodynamics and mission-analysis tools (comparables, not named in the challenge brief) | Industry-standard high-fidelity mission analysis | Desktop and expert tooling; not a web-native rapid comparison for non-specialists | We are the fast, accessible front end; export to professional tools is a later opportunity |
| Spreadsheets and ad-hoc scripts | The status quo for many trade studies (hypothesis) | Flexible and familiar | Error-prone, non-reproducible, no terrain, no shareable brief | One method, reproducible JSON brief, validated terrain |

**Differentiation summary:** scenario comparison as the core object rather than a
single-site analysis; mission-profile scoring that turns data into a decision;
bilingual EN/ES with a no-WebGL fallback; static, install-free and open; complementing
the authoritative tools rather than competing with them.

**Honest moat assessment:** there is no deep technical moat, because the data is public
and the maths is standard. The durable advantages would be validated accuracy with a
disclosed tolerance, a trusted comparison experience, integrations into agency
workflows and institutional relationships: an execution and trust moat, not an
intellectual-property moat.

## 9. Risks and mitigations

| Risk | Likelihood and impact | Mitigation |
| --- | --- | --- |
| Nobody pays because the data and tools are free | Medium and high | Open-core plus paid pilots tied to validation and delivered briefs; education licensing as a second market |
| Market is small (few missions per year) | Medium and high | Two-market design; reusable engine for other bodies and poles; integration with established platforms |
| Accuracy challenge: a wrong illumination or communications claim destroys trust | Medium and high | Disclose method and tolerance; validate against Horizons; frame the tool as planning support, not flight-certified analysis |
| Static-hosting limits (no live Horizons, no server) | Known and medium | Pre-computed datasets with a versioned pipeline; dev proxy for validation; document coverage |
| Large build undermines "rapid" | Medium and medium | Lazy-load, tile, CDN, compression |
| NASA and CSA brand and data-licence mistakes | Medium and high | No logos, flags or mission identifiers as branding; attribution in metadata and UI; verify licences before publishing |
| Hackathon scope creep versus deadline | High and medium | Stage-0 scope: comparison, Sun/Earth, power and communications, fallback; everything else declared as planned |
| Team capacity (small team, two machines) | Medium and medium | Contract-first architecture; fixed interfaces; this documentation separates claims from evidence |
| AI-generated content policy breach | Low and high | Complete AI declaration; mark generated assets; verify all content |

## 10. Validation plan

| Question | Test | Success signal |
| --- | --- | --- |
| Does the workflow gap actually cost time? | 3-5 interviews with mission-planning professionals | At least 3 confirm the multi-tool comparison pain |
| Is the tool faster? | Timed usability test: 3 sites x 3 dates versus the baseline workflow | 10 minutes or less to a defensible comparison |
| Are the numbers defensible? | Compare illumination and Earth-visibility results against JPL Horizons reference for a fixed site and date | Agreement within a published tolerance; method documented |
| Can a non-specialist use it? | Moderated test with an educator or public user | Completes the guided flow unassisted and explains the trade-off correctly |
| What would a buyer pay for? | Structured interview: pilot scope, deliverable, budget route | One concrete pilot scope and procurement path |
| What is the market? | Public agency budget and CLPS records plus interviews | A sourced, modest estimate, not a top-down TAM guess |

Evidence today: the workflow gap is given by the challenge brief; the terrain data
pipeline is validated (two source regions + four DEM area presets, 0 failures, cross-region r = 0.9993); the
application is implemented, tested and deployed. No business validation has been
performed.

## 11. Milestones and funding options

| Stage | Milestone | Funding or resource route |
| --- | --- | --- |
| 0 | Public demo and validated terrain (now) | Hackathon effort; no external funding |
| 1 | Pilot evidence: interviews, usability, accuracy test, first paid study | Agency innovation or SBIR-style small grant, university collaboration, competition prizes, sponsor |
| 2 | Platform: API and workspace, more regions and epochs, integrations | Seed or accelerator, research grant, partner co-development |
| 3 | Operational and validated tool | Procurement or enterprise contract, institutional licences, integration partnership |

Grants and competitions are non-dilutive and fit the public-data and public-good
framing; none is committed. They are options, not facts.

## 12. Judging-criteria mapping

### 12.1 How the project is judged

| Item | Rule | Status |
| --- | --- | --- |
| Scored criteria | Impact, Creativity, Validity, Relevance, Presentation | Fixed (participant guide) |
| Scale | 1 to 5 per criterion (reference scale) | Fixed in the reference material |
| Weights and percentages | Not fixed in the reference material; the local rubric may adapt scales or weights | Confirm with the Málaga organisation |
| Who reviews what | The Project page is the record the jury reviews; the Project Demo is one part of it | Fixed |
| Local pitch | Separate from the Project Demo and does not replace Submit for Judging; oral Spanish or English allowed, visual material in English | Confirm duration and Q&A at the technical test |
| Incomplete projects | Not automatically excluded; what exists, the reasoning and the limits are valued | Fixed |
| AI use | Not penalised by itself; authorship, verification, execution, originality and declaration compliance matter | Fixed |
| Staging | Good staging improves Presentation but does not by itself prove validity, impact or relevance | Fixed |

### 12.2 Málaga judges' professional lenses

The Málaga judges guide is a six-slide Spanish deck with a cover and five judge
profiles; it does not contain a scoring rubric. The five criteria above come from the
participant guide. The judges' stated professional lenses, translated into what the
project should emphasise:

| Judge lens | Background | Emphasise | Avoid |
| --- | --- | --- | --- |
| Investment, entrepreneurship, projects | César Trujillo, Managing Director at TeamLabs | Concrete customer segments, the open-core plus pilot path, staged roadmap, honest absence of market numbers | Invented TAM, "we will win the market", revenue claims |
| Technology, innovation, cybersecurity | Pedro Manjón, CEO and Project Manager at Atech Allied Technologies | Static architecture, no secrets, no personal data, worker-based compute, pre-computed datasets, validation plan | Hand-waving the architecture; ignoring security and privacy |
| Learning, community, digital talent | Carmen H. Ledesma, Director at 42 Málaga Fundación Telefónica | EN/ES parity, no-WebGL fallback, educator and public mode, Space Apps community story | Making it look like a closed enterprise tool |
| Exploration, robotics, autonomous vision | Carlos Pérez del Pulgar, Associate Professor at the University of Málaga and research lead at the Space Robotics Laboratory | LOLA terrain, horizon equals terrain plus lunar curvature, no atmosphere or refraction, libration, resolution and tolerances, PDS provenance | Overclaiming flight-certified accuracy; hiding limits |
| Videogames, community, prototyping | Lucía Pardo, President of Málaga Jam | A working prototype, a clear comparison experience, a shareable public URL, honest built-versus-planned labels | A slide-only pitch with no visible artefact |

### 12.3 Criteria mapped to evidence

| Criterion (guide definition) | What a high score looks like | Evidence today (honest) | Main gap |
| --- | --- | --- | --- |
| Impact: problem, audience, quality and scope of benefit, and the evidence supporting it | The audience and operational pain are concrete; the benefit is plausible and the evidence for the workflow gap is the challenge itself | Problem and audience stated by the brief (CLPS and other lunar missions, south-pole water ice, schedule slips); two-market framing; quantified benefit is a hypothesis, not measured | No user interviews, no timed usability result, no customer |
| Creativity: originality of the approach or a significant improvement over alternatives | The combination is new: rapid scenario comparison, mission-profile autopilot, bilingual no-WebGL static UI and JSON brief over the existing authoritative tools | Differentiation argued from the brief's explicit gap; autopilot scoring is implemented and unit-tested | The creativity is in the integration and experience, not in a novel algorithm |
| Validity: scientific soundness and technical, functional or logical viability; evidence and limitations | The physics is standard and disclosed; the terrain pipeline is real and validated; limits are stated before the judge asks | LOLA terrain shipped and validated (2 source regions + 4 area presets, 0 failures, cross-region r = 0.9993); production build green; 128 app tests plus 8 MCP tests pass; live end-to-end check passes | Accuracy against live JPL Horizons references not yet validated; no formal usability test |
| Relevance: answer to the challenge and substantial integration of NASA resources | Directly answers challenge 10 with the three named data streams; LOLA terrain, JPL Horizons ephemerides and the Moon Trek layer catalogue are shipped and consumed | Challenge answered feature for feature (site comparison, dates, Sun and Earth versus horizon, time-to-set, power, communications, layers, autopilot, export); all three NASA resources implemented and consumed | End-to-end accuracy validation still pending |
| Presentation: clarity, structure and effectiveness | Slides are legible, honest, structured and in English; the demo shows something real; the limits slide is confident rather than defensive | Seven-slide deck and 30-second video script designed; demo runbook and fallbacks prepared | Final deck or video assets and the public link |

### 12.4 Honest self-assessment (internal calibration, not a prediction)

| Criterion | Self-score | Rationale | What would move it up |
| --- | --- | --- | --- |
| Impact | 3 of 5 | The problem is official and the two-market story is coherent, but the quantified benefit is a hypothesis and no user has touched the tool | Record a timed comparison, one educator or planner comment, one operational scenario with before and after timing |
| Creativity | 3.5 of 5 | Integration, autopilot and bilingual accessibility are a meaningful improvement over the status quo, but not a novel algorithm | Make the autopilot ranking visible in the demo; show the "what changes if the date slips" interaction |
| Validity | 3.5 of 5 | Real validated terrain, a working build, an implemented core geometry and comparison layer, 104 passing unit tests and a live end-to-end check; the missing evidence is accuracy against live Horizons | Validate horizon and illumination against Horizons reference values and record the tolerance |
| Relevance | 4.5 of 5 | Directly answers challenge 10 and ships and consumes all three NASA resources with disclosed provenance | Show the three resources in the demonstrated flow (LOLA horizon, Horizons visibility windows, Moon Trek layers) |
| Presentation | 3.5 of 5 | A clear, honest, English seven-slide structure and video script exist; final assets and the public link are pending | Build the deck or video, test legibility, rehearse the pitch with the honesty labels |

With the reference 1-5 scale and unknown local weights, the safest reading is that
Relevance is the strongest card today and Validity is the one at risk. Do not assume
local percentages.

### 12.5 What would lose points

| Risk | Why it costs points | Avoid by |
| --- | --- | --- |
| Overclaiming ("already validated against Horizons") | Judges cross-check the demo against the text; the guide values honesty | Keep built and pending labels in the Project page, slides and video |
| No working artefact in the demo | Presentation improves staging but does not prove validity | Show the running application with real LOLA terrain and live values |
| Superficial NASA-data use | Relevance requires explaining where the resource intervenes and what it changes | Slide 4: LOLA to horizon to decision; Horizons to visibility windows; Moon Trek to context layers |
| Not answering the challenge exactly | Challenge 10 asks for rapid site and date comparison and Sun/Earth versus horizon | Keep the scenario-comparison story front and centre |
| Ignoring limits | Limitations are part of Validity; hiding them reads as weakness | Slide 6 states limitations plainly |
| English errors in written material | Written materials must be in English | Proofread the Project page and slides |
| NASA or CSA branding misuse | Explicitly prohibited; can invalidate the submission | Text wordmark only; no logos, flags or mission identifiers; attribution footer |
| Undeclared AI | Declaration required; authorship and verification are judged | Complete declaration in [ai-usage.md](ai-usage.md) |
| Minor privacy | Explicit rule for materials sent to NASA | No names, voices or images of minors; screen captures only |
| Broken or private links | Demo and Final Project must open without login | Test in a private window before submitting and re-test after any edit |

## 13. Local pitch delivery

The 7-slide deck and the 30-second video script are in [demo.md](demo.md); this section
covers delivery only.

- **Format:** oral Spanish or English allowed; slides in English required. References
  differ on duration (2-2:30 or 2-3 minutes) and Q&A (2-3 questions); confirm with the
  organisation before the technical test.
- **Story:** problem, solution, NASA resource, evidence, limits, next step. The deck
  follows exactly that order.
- **Delivery rules:** one presenter, 2.5 minutes, no feature tour; every claim paired
  with a visible screen, data point or file. Say "this is built" and "this is pending"
  out loud; judges reward honesty.
- **Spanish oral variant:** deliver the same beats in Spanish if the room is
  Spanish-speaking; keep the slides in English and do not add claims not in the slides.
- **If the demo fails live:** fall back to the demo screenshots and the terrain render;
  never debug on stage.

## 14. Sources

- Challenge brief 10, Lunar Landing Site Navigator:
  <https://www.spaceappschallenge.org/2026/challenges/>
- Málaga 2026 challenge wallpapers and judges guide: official Málaga 2026 event
  material (Spanish); rules summary in [challenge.md](challenge.md)
- Participant guide 2026 (Spanish): official Málaga 2026 participant guide; English
  summary in [challenge.md](challenge.md)
- Technical contract and feature map: [architecture.md](architecture.md)
- Static deployment constraints: [deployment.md](deployment.md)
- Terrain metadata and provenance: `public/data/terrain/index.json` and
  `scripts/nasa/build-terrain.py`
- Build, test and QA status: [qa.md](qa.md)
- External tools named by the challenge: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/),
  [NASA Moon Trek](https://trek.nasa.gov/moon/),
  [LROC QuickMap](https://quickmap.lroc.asu.edu/)
- NASA Space Apps 2026: <https://www.spaceappschallenge.org/2026/>; Málaga Local Event:
  <https://www.spaceappschallenge.org/2026/local-events/malaga/>
