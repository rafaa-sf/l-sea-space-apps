# Judging criteria & evidence map — L-SEA Space Apps


> **Status snapshot (2026-11-14, `origin/develop` @ `5db7603`).** The application is implemented in source: a Vue 3 mission-control shell with 11 feature panels, a pure-JavaScript core (geometry, terrain, Sun/Earth horizon engine, ephemeris, power, communications, autopilot), service adapters, a single Web Worker, a Three.js scene with a no-WebGL Canvas 2D fallback, and the full real NASA datasets (`public/data/pois.json` — 10 sites; `public/data/ephemeris/` — 10 files × 2 928 samples at 30-minute steps from JPL Horizons DE441; `public/data/layers.json` — 21 verified Moon Trek layers; `public/data/terrain/` — 2 LOLA regions). `npm test` passes 98 tests in 7 files and `npm run build` is green; CI runs on `develop`. **Not yet validated:** end-to-end demo on a deployed URL, accuracy against live JPL Horizons references, usability. **Status refresh before submission:** re-check the final commit, the deployed public URL and the Project page fields before Submit for Judging.

**Project:** L-SEA Space Apps — *Lunar Landing Site Navigator* (challenge #11, partner agency CSA)
**Event:** NASA Space Apps Challenge · Málaga 2026 · **Owner:** commercial workstream · **Version:** 2026-11-14
**Purpose:** (1) translate the Málaga *judges guide* slides accurately from Spanish; (2) map the official NASA Space Apps criteria and the judges' stated professional lenses to this project; (3) state honestly what is proven today and what is not.
**Status:** working submission aid. This is **not** an official rubric and no percentages are claimed.

> **Important finding.** The extracted judges material is six image-only slides (the official Málaga 2026 event material, the six pages of "[NASA] Jueces · Space Apps Málaga 2026.pdf"). They contain a cover plus **five judge introductions** with each judge's professional lens — they do **not** contain a scoring rubric. The five scored criteria come from the official participant guide (the official Málaga 2026 participant guide (English summary in `docs/guide.md`) p. 13; English summary `docs/guide.md` §"Judging criteria"). The participant guide also references a longer judges guide ("Jurado · p. 9", "p. 17") whose content is **not** in the provided six-page extract; those references are marked **TODO — confirm with the Málaga organization**.

---

## 1. How the project is judged (sources and what is fixed)

| Item | Rule / reference | Status |
| --- | --- | --- |
| Scored criteria | **Impact, Creativity, Validity, Relevance, Presentation** | Fixed (participant guide p. 13; `docs/guide.md` §Judging criteria) |
| Scale | **1 to 5 per criterion** (reference scale) | Fixed in the reference material |
| Weights / percentages | **Not fixed.** The guide says a jury FAQ mentions 20 % per criterion, while the mentoring guide warns local evaluation may adapt scales or weights; the guide explicitly does **not** fix percentages | **TODO — confirm the local rubric with the organization** |
| Who reviews what | The **Project page** is the record the jury reviews; the Project Demo (≤ 7 slides OR ≤ 30 s video) is only one part | Fixed (`docs/guide.md` §"Deliverables: Project page") |
| Local pitch | Separate from the Project Demo and does **not** replace Submit for Judging; oral Spanish or English allowed, **visual material in English**; published duration/Q&A references differ (2–2:30 or 2–3 min; 2–3 questions) | **TODO — confirm final rule at the technical test** |
| Incomplete projects | Not automatically excluded; what exists, the reasoning and the limits are valued, with development level feeding especially into Validity | Fixed (`docs/guide.md` §"Judging criteria") |
| AI use | Not penalized by itself; authorship, verification, execution, originality and marking/declaration compliance matter | Fixed |
| Staging | Good staging improves Presentation but does not by itself prove validity, impact or relevance | Fixed |

---

## 2. The Málaga judges guide slides — accurate English translation

The deck is Spanish, image-only. Translation below is literal where wording matters; the intended meaning is preserved. Each slide is one judge profile: **headline / name and role / one-sentence description / three topic tags**.

### Slide 1 (cover) — "El jurado que impulsa las ideas hacia el futuro"

**Translation:** "The jury that drives ideas toward the future."
Header: NASA Space Apps Challenge · Málaga 2026. Five judge portraits. No criteria, no rules — cover only.

### Slide 2 — Judge 01 / César Trujillo

- **Headline:** *"De una idea a un proyecto con impacto."* → **"From an idea to a project with impact."**
- **Name / role:** César Trujillo — Managing Director, **TeamLabs**.
- **Description:** *"Inversión, gestión, emprendimiento y desarrollo de proyectos que convierten ideas en soluciones con impacto real."* → **"Investment, management, entrepreneurship and project development that turn ideas into solutions with real impact."**
- **Tags:** *INVERSIÓN / EMPRENDIMIENTO / PROYECTOS* → **INVESTMENT / ENTREPRENEURSHIP / PROJECTS**
- **Lens for us:** is there a real problem, a credible path from prototype to a funded project, and a team that can execute? He is likely to probe the business/impact story and execution discipline.

### Slide 3 — Judge 02 / Pedro Manjón

- **Headline:** *"La tecnología transforma lo imposible."* → **"Technology transforms the impossible."**
- **Name / role:** Pedro Manjón — CEO & Project Manager, **Atech Allied Technologies**.
- **Description:** *"Empresa de soluciones tecnológicas, innovación, ciberseguridad y transformación digital."* → **"Technology solutions company, innovation, cybersecurity and digital transformation."**
- **Tags:** *TECNOLOGÍA / INNOVACIÓN / CIBERSEGURIDAD* → **TECHNOLOGY / INNOVATION / CYBERSECURITY**
- **Lens for us:** is the technology sound, genuinely innovative, and responsibly engineered (security, data handling, no secrets, maintainable architecture)? Expect architecture and risk questions.

### Slide 4 — Judge 03 / Carmen H. Ledesma

- **Headline:** *"El talento crece cuando aprendemos juntos."* → **"Talent grows when we learn together."**
- **Name / role:** Carmen H. Ledesma — Director, **42 Málaga Fundación Telefónica**.
- **Description:** *"Un entorno de aprendizaje entre pares, proyectos prácticos y comunidad que impulsa el liderazgo y el talento digital."* → **"A peer-learning environment, practical projects and a community that drives leadership and digital talent."**
- **Tags:** *APRENDIZAJE / COMUNIDAD / TALENTO DIGITAL* → **LEARNING / COMMUNITY / DIGITAL TALENT**
- **Lens for us:** does this help people learn and participate — education value, accessibility, bilingual EN/ES, community/outreach reach? A strong story for the "educators and general public" half of the challenge.

### Slide 5 — Judge 04 / Carlos Pérez del Pulgar

- **Headline:** *"Robots que exploran la próxima frontera."* → **"Robots that explore the next frontier."**
- **Name / role:** Carlos Pérez del Pulgar — *Profesor Titular UMA* (Associate Professor, University of Málaga), **research lead at the Space Robotics Laboratory**.
- **Description:** *"Investigación en exploración planetaria, rovers, visión autónoma y colaboración con ESA."* → **"Research in planetary exploration, rovers, autonomous vision and collaboration with ESA."**
- **Tags:** *EXPLORACIÓN / ROBÓTICA / VISIÓN AUTÓNOMA* → **EXPLORATION / ROBOTICS / AUTONOMOUS VISION**
- **Lens for us:** is the lunar science/engineering correct — terrain, horizon, illumination, Earth visibility, libration, resolution and tolerances? He will find overclaims fastest and will value disclosing them.

### Slide 6 — Judge 05 / Lucía Pardo

- **Headline:** *"Jugar, crear, colaborar: ideas en acción."* → **"Play, create, collaborate: ideas in action."**
- **Name / role:** Lucía Pardo — President, **Málaga Jam**.
- **Description:** *"Desarrolladora y promotora de comunidad de videojuegos, creación colaborativa y proyectos que conectan talento y creatividad."* → **"Developer and promoter of the videogame community, collaborative creation, and projects that connect talent and creativity."**
- **Tags:** *VIDEOJUEGOS / COMUNIDAD / PROTOTIPADO* → **VIDEOGAMES / COMMUNITY / PROTOTYPING**
- **Lens for us:** is the experience clear, usable and creative? Does the prototype actually exist and can people engage with it? Values prototyping, collaborative spirit and UX/presentation craft.

### Translation notes

- "Profesor Titular" is a Spanish academic rank (associate professor / tenured lecturer); translated as **Associate Professor** with the Spanish term kept for accuracy.
- "TeamLabs", "Atech Allied Technologies", "42 Málaga Fundación Telefónica", "Málaga Jam" and "UMA" are proper names; no further claims are made about these organizations beyond what the slides state.
- The slides do not identify minors; no personal data is added here beyond what the judges deck already publishes.

---

## 3. Official criteria → project strengths, evidence and gaps

Definitions below are the English wording of the official guide (`docs/guide.md` §"Judging criteria", itself an English summary of the Spanish participant guide p. 13).

| # | Criterion (guide definition) | What a high score looks like for this project | Evidence today (honest) | Main gap | Where to say it in the pitch |
| --- | --- | --- | --- | --- | --- |
| 1 | **Impact** — problem, audience, quality/scope of the possible benefit, and the evidence supporting it | The audience and operational pain are concrete; the benefit is plausible and the evidence for the workflow gap is the challenge itself | Problem and audience are stated by the official challenge brief (CLPS and other lunar missions, south-pole water ice, schedule slips); two-market framing (planners + education); quantified benefit is a **hypothesis**, not measured | No user interviews, no timed usability result, no customer | Slide 2 (problem), slide 7 (impact hypotheses) |
| 2 | **Creativity** — originality of the approach or a significant improvement over alternatives | The *combination* is new: rapid scenario comparison + mission-profile autopilot + bilingual, no-WebGL, static UI + JSON brief, over the existing authoritative tools | Differentiation is argued from the brief's explicit gap (QuickMap/Moon Trek/Horizons are detailed-analysis tools); autopilot scoring is implemented in source (`src/core/autopilot.js`) and unit-tested | Creativity of the *idea* and of the integrated prototype; no novel algorithm claimed | Slide 3 (solution), slide 7 (next step) |
| 3 | **Validity** — scientific soundness and technical/functional/logical viability; evidence and limitations | The physics is standard and disclosed; the terrain pipeline is real and validated; limits are stated before the judge asks | LOLA terrain shipped and validated (2 regions, 0 failures; cross-region r = 0.9993); production build works; 98 automated tests pass across core/services modules. **Not** validated: end-to-end demo on a deployed URL and accuracy vs. live JPL Horizons references | Geometry implemented and unit-tested but not yet validated against live Horizons; deployment pending | Slide 4 (data), slide 6 (verified vs. not yet) |
| 4 | **Relevance** — answer to the challenge and substantial integration of NASA resources | Directly answers challenge #11 with the three named data streams; LOLA terrain, JPL Horizons ephemerides and the Moon Trek layer catalogue are shipped **and consumed by the application** | Challenge #11 answered feature-for-feature (site comparison, dates, Sun/Earth vs. horizon, time-to-set, power, comms, layers, autopilot, export); LOLA + Horizons + Moon Trek are implemented in source and unit-tested | End-to-end demo and accuracy validation still pending | Slides 3–4; Project page §4 |
| 5 | **Presentation** — clarity, structure and effectiveness in communicating problem, solution and importance | Slides are legible, honest, structured, English; the demo shows something real; the limits slide is confident rather than defensive | 7-slide deck designed (`pitch.md`) with built/planned labels; 30 s video script ready; demo runbook and fallbacks | Final deck/video assets and public links are TODO; depends on final build for the demo moment | Whole deck; slide 6 (limits) is the trust-builder |

**Málaga judges' lenses → what to emphasise (from §2):**

| Judge (lens) | Emphasise | Avoid |
| --- | --- | --- |
| César Trujillo (investment / entrepreneurship / projects) | The concrete customer segments, the open-core + pilot path, staged roadmap, honest absence of market numbers | Invented TAM, "we will win the market", revenue claims |
| Pedro Manjón (technology / innovation / cybersecurity) | Static architecture, no secrets, no personal data, worker-based compute, pre-computed datasets, validation plan | Hand-waving the architecture; ignoring security/privacy |
| Carmen H. Ledesma (learning / community / digital talent) | EN/ES parity, no-WebGL fallback, educator/public mode, Space Apps community story | Making it look like a closed enterprise tool |
| Carlos Pérez del Pulgar (exploration / robotics / autonomous vision) | LOLA terrain, horizon = terrain + lunar curvature, no atmosphere/refraction, libration question, resolution/tolerances, PDS provenance | Overclaiming flight-certified accuracy; hiding limits |
| Lucía Pardo (videogames / community / prototyping) | Working prototype, clear comparison UX, shareable public URL, honest "built vs planned" labels | A slide-only pitch with no visible artefact |

---

## 4. Honest self-assessment (not a prediction)

Scale 1–5, based on **evidence available today**. This is a team-internal calibration: use it to decide where to spend the remaining hours.

| Criterion | Self-score | Rationale | What would move it up |
| --- | --- | --- | --- |
| Impact | **3 / 5** | The problem is official and the two-market story is coherent; but the quantified benefit is a hypothesis and no user has touched the tool | Record a timed comparison, one educator/planner comment, one operational scenario with before/after time |
| Creativity | **3.5 / 5** | Integration + autopilot + bilingual accessibility is a meaningful improvement over the status quo; not a novel algorithm | Make the autopilot ranking visible in the demo; show the "what changes if the date slips" interaction |
| Validity | **3.5 / 5** | Real validated terrain, a working build, an implemented core geometry/comparison layer and 98 passing unit tests; the missing evidence is validation against live Horizons and the deployed demo | Validate horizon/illumination against Horizons reference values and record the tolerance; demo on the public URL |
| Relevance | **4.5 / 5** | Directly answers challenge #11 and ships and consumes all three NASA resources with disclosed provenance; end-to-end demo pending | Show the three resources in the demonstrated flow (LOLA horizon, Horizons visibility windows, Moon Trek layers) |
| Presentation | **3.5 / 5** | A clear, honest, English 7-slide structure and video script exist; assets are pending | Build the deck/video, test legibility, rehearse the 2:30 pitch with the honesty labels |

**Weighted interpretation:** with the reference "1–5 per criterion" scale and **unknown local weights**, the safest reading is that Relevance is our strongest card today and Validity is the one at risk; Presentation is under our control in the remaining hours. Do not assume local percentages (guide: 20 % is only mentioned in one jury FAQ, while the mentoring guide says local evaluation may adapt scales/weights).

---

## 5. What would lose points (and how we avoid it)

| Risk | Why it costs points | Avoid by |
| --- | --- | --- |
| Overclaiming ("already compares sites") | Judges cross-check the demo against the text; the guide values honesty explicitly | Keep built/planned labelling in Project page, slides and video |
| No working artefact in the demo | Presentation improves staging but does not prove validity | Show the running shell + real LOLA terrain; show the architecture contract as evidence of a real build |
| Superficial NASA-data use ("we cite NASA") | Relevance requires explaining *where* the resource intervenes and *what* it changes | Slide 4: LOLA → horizon → decision; before/after "without LOLA there is no terrain horizon" |
| Not answering the challenge exactly | Challenge #11 asks for rapid site/date comparison and Sun/Earth vs. horizon | Keep the scenario-comparison story front and centre; do not drift into a general lunar encyclopedia |
| Ignoring limits | The guide says limitations are part of Validity; hiding them reads as weakness | Slide 6 states limitations plainly |
| English errors in written material | Written materials must be English; clarity is judged | Proofread Project page/slides; the deck is already English |
| NASA/CSA branding misuse | Explicitly prohibited for generated content; can invalidate submission | Text wordmark only; no logos/flags/mission identifiers; attribution footer |
| Undeclared AI | Declaration required; authorship/verification is judged | Complete the AI declaration skeleton in `project-page.md` §6 |
| Minor privacy | Explicit rule for materials sent to NASA | No names/voices/images of minors; screen captures only |
| Broken/private links | Demo and Final Project must open without login | Test in a private window before submitting; re-test after any edit |

---

## 6. Evidence index (for Q&A and internal review)

| Claim | Where the evidence is |
| --- | --- |
| Challenge definition, gap and objectives | the official Challenge 11 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/); wallpaper the official Málaga 2026 event material |
| Event rules, demo limits, judging criteria | `docs/guide.md`; the official Málaga 2026 participant guide (English summary in `docs/guide.md`) (pp. 7–13) |
| Judge profiles/lenses (translated) | the official Málaga 2026 event material (this file §2) |
| Product scope and feature map | `docs/architecture.md` |
| Real LOLA terrain + provenance + grid specs | `public/data/terrain/*.json`; `scripts/nasa/build-terrain.py` |
| Terrain validation (PASS, cross-region agreement) | `docs/test-report.md`; previews in `docs/test-report.md` |
| Build works / no tests yet | `docs/test-report.md`; `docs/test-report.md` |
| Impact/scalability and KPI hypotheses | `docs/impact-scalability.md` |
| Pitch deck content and video script | the related document in `docs/` |
| Business model/comparables | the related document in `docs/` |
| Submission-page text and AI declaration skeleton | the related document in `docs/` |

---

## Sources

- Judges guide slides (Spanish, image-only): the official Málaga 2026 event material; source PDF the official Málaga 2026 event material (6 pages)
- Participant guide 2026 (Spanish): the official Málaga 2026 participant guide (English summary in `docs/guide.md`) (criteria p. 13; pitch pp. 11–12; checklist p. 15)
- English rules summary: `docs/guide.md`
- Challenge brief #11: the official Challenge 11 statement (NASA Space Apps 2026 challenges page: https://www.spaceappschallenge.org/2026/challenges/)
- Official judging references (as linked by the participant guide): [NASA Space Apps 2026](https://www.spaceappschallenge.org/2026/), [Challenges 2026](https://www.spaceappschallenge.org/2026/challenges/), [Participant FAQs](https://www.spaceappschallenge.org/resources/participant-faqs/)

## Open questions / TODOs

1. **Local rubric weights** — confirm with the Málaga organization whether the local evaluation uses the reference 1–5 scale, 20 % per criterion, or adapted weights.
2. **Judges guide pages 9 and 17** — the participant guide cites them for pitch format (2–3 min incl. walk-on, 2–3 questions; one FAQ says the pitch has the same format as the official demo). These pages are not in the six-slide extract; confirm at the technical test.
3. **Exact local pitch rule** — duration/slide limit/Q&A; confirm before Sunday 16:30.
4. **Final build status** — the application and 98 tests now exist; re-score §4 after the end-to-end demo on the deployed URL and keep the validation caveats.
5. **Reference links** — verify external judging references and external tool URLs before publication.