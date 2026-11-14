# Submission checklist — L-SEA Space Apps (Challenge 10)


> **Status snapshot (2026-11-14, main @ 35149e4).** Application and real NASA datasets are merged on main; npm test passes 104 tests in 7 files plus 8 MCP tests; CI is green. Deployment URL and Project Demo link are still pending (docs/submission.md TODOs).

**Scope:** NASA International Space Apps Challenge · Málaga 2026, Project page
requirements mapped from [`docs/guide.md`](guide.md) (lines 41–60 "Deliverables:
Project page", 62–90 "Project Demo rules", 92–107 "Submission", 109–124
"Responsible use", 178–191 "Last-30-minutes checklist") plus the Challenge 10
requirement baseline from the official challenge statement (NASA Space Apps 2026
challenges page: <https://www.spaceappschallenge.org/2026/challenges/>).

**Product:** L-SEA Space Apps — lunar south-pole landing-site navigation and
mission-briefing tool answering **Challenge 10, "Lunar Landing Site Navigator"**
(Málaga listing: "Navegador de aterrizaje lunar"; partner agency: **CSA**).

**Baseline (main @ `35149e4`, 2026-11-14).** The application and the real NASA
datasets are merged on `main`: a Vue 3 mission-control UI, a pure-JavaScript core
(geometry, terrain, horizon/ray-tracing engine, ephemeris, power, comms,
autopilot), service adapters, a single Web Worker, a Three.js scene with a
no-WebGL 2D fallback, LOLA terrain, 10 POIs, 10 ephemeris files × 2 928 samples,
21 Moon Trek layers, the data pipeline and CI. `npm test` passes 104 tests in 7
files plus 8 MCP tests and `npm run build` is green. **Not yet
validated/deployed:** end-to-end demo on a public URL, accuracy against live JPL
Horizons references, usability. **Status refresh before submission:** re-check
the final commit, the deployed public URL and every Project page field before
Submit for Judging.

**Deadline:** Sunday 15 November 2026, before 23:59 local time
(guide.md line 20/97). Local pitch and technical tests: Sunday 16:30–19:00
(guide.md lines 146–149). A submission is only complete after **Submit for
Judging** and a visible confirmation (guide.md lines 94–97).

**Status legend:** `DONE` · `IN PROGRESS` · `PARTIAL` · `PENDING` · `BLOCKED` ·
`AT RISK`.

**Owners:** *Lead* (team lead agent + user/platform actions), *commercial*
(commercial workstream: page copy, demo, business material), *test bench* (test bench
agent: QA evidence, deployment dry-run), *primary code* (primary `L-SEA`
machine that owns application code), *coordination* (this documentation workstream).

---

## 1. Project page requirements (official checklist)

| ID | Requirement (source) | Status | Owner | Artifact / evidence | Risk and mitigation |
| --- | --- | --- | --- | --- | --- |
| PG-01 | **Name and summary**: project name + 50–200 word summary of what was built, how it answers the challenge and why it matters (guide.md L48) | IN PROGRESS | commercial, reviewed by Lead | `docs/project-page.md`; name `L-SEA Space Apps` is used in `README.md` and `package.json`; summary is 194 words in the draft | Keep the summary 50–200 words and English; it now describes an implemented prototype, but the demo/validation claims must match the deployed build (see `docs/test-report.md` §0). |
| PG-02 | **Project Demo**: one public link, slides **≤ 7 including cover** OR video **≤ 30 s** (guide.md L49, 62–90) | IN PROGRESS | commercial + Lead publishes link | `docs/pitch.md` (7-slide outline + 30 s script) | The application is now implemented and merged on `main`, so the recorded demo can show real controls and computed outputs; it must still be honest about what was validated (accuracy vs. live Horizons and deployment are pending). Video in Spanish requires English subtitles (guide.md L57–59, 88–90); public link must open without login (L58–60). |
| PG-03 | **Final Project**: public link to project / repository / site / material that allows the solution to be understood and reviewed (guide.md L50) | BLOCKED | Lead (deployment + final URL), primary code (app) | Live URL TBD (deployment not done — `docs/deployment.md` L11–13); repo link: the public project repository (see `README.md`) | **High risk.** (a) No deployment yet; Vercel credentials and final URL are Lead-owned. (b) The repository default branch `main` still lags `develop` (the app and data are on `develop`), so a repo-only link would not show the app. (c) The production bundle is ~14–15 MB (≈13.4 MB of committed NASA data, mostly terrain + ephemeris) and the Three.js chunk is large; test first load on a slow connection. Mitigation: publish the static build (primary plan Vercel, fallback GitHub Pages per `docs/deployment.md` §10) and merge `develop` into `main` at the submission-candidate commit. |
| PG-04 | **Detailed description**: what it does, how it works, benefits, tools, method, **real development status and limitations** (guide.md L51) | IN PROGRESS | commercial (copy), primary code (technical facts), test bench (verified status) | `docs/project-page.md`; technical source `docs/architecture.md`; verified status `docs/test-report.md` | Must separate built vs validated/planned (guide.md L77). The application and its automated tests now exist, so "built in source" is accurate; keep the honest caveats: no end-to-end demo on a deployed URL yet, no accuracy validation against live Horizons yet, no usability testing. |
| PG-05 | **NASA Data**: NASA resources used, links, and explanation of their real contribution; for Global Awards at least one NASA resource **from the challenge** (guide.md L52; slide 4 in L71 explains the real role) | PARTIAL | commercial (narrative + links), primary code (data/UI), Lead (review) | Real LOLA polar DEMs committed in `public/data/terrain/` (2048² @ 74.06 m and 1024² @ 593.75 m, attribution `NASA/GSFC/LOLA (PDS Geosciences Node)`); **real JPL Horizons DE441 topocentric Sun/Earth ephemerides** in `public/data/ephemeris/` (10 sites × 2 928 samples, 30-min steps, 2026-11-01 → 2026-12-31, schema in `public/data/ephemeris/README.md`); **21 verified NASA Moon Trek WMTS layers** in `public/data/layers.json`; acquisition/verification scripts in `scripts/nasa/`; provenance/attribution/licensing in `docs/data-sources.md` and endpoints/CORS/rate limits in `docs/api-integrations.md` | All three NASA resources are committed **and consumed by the application** (`services/lola.js`, `services/horizons.js`/`core/ephemeris.js`, `services/moontrek.js` + `render/moontrekTiles.js`). Mitigation: explain each resource's real contribution (LOLA → terrain/horizon/power; Horizons → Sun/Earth visibility windows; Moon Trek → context layers) and cite PDS/Horizons/Moon Trek links from `docs/data-sources.md`/`docs/api-integrations.md`. |
| PG-06 | **Other data and references**: partner-agency sources and references for data, code, images, text and tools, even when open (guide.md L53) | PARTIAL | commercial + Lead | `docs/data-sources.md` now records per-dataset provenance, rights, attribution and limitations (incl. `docs/data-sources.md` §6 licensing summary); `docs/api-integrations.md` records endpoints/CORS/rate limits; `public/data/ephemeris/README.md` documents the ephemeris contract; `docs/resources.md` lists event/NASA portals | Remaining gaps: **CSA (challenge partner agency) is not named in the data/reference docs** (only "CSA Moon Explorer style" in `docs/architecture.md`), the repository still has **no LICENSE file**, and user-visible attribution is only the app footer string. Mitigation: cite NASA LOLA/PDS, JPL Horizons/DE441, Moon Trek/LROC and CSA as challenge partner on the Project page; add licence/attribution notes and avoid NASA logos/flags (guide.md L116, L119–120). |
| PG-07 | **AI / SI use**: tools used and how they were incorporated; required labels/declarations for generated content (guide.md L54, 109–123) | PARTIAL | Lead (declaration), commercial (labels), primary code (accuracy) | `docs/ai-usage.md` is a full AI declaration (tools, agent roles, what AI generated, human responsibilities, labelling) and is served to the app as `public/data/ai-usage.md` | The declaration's §6 is now accurate on the build and the unit tests (104 app tests plus 8 MCP tests pass on `main` @ `af859ef`); verify the agent-role/wording against the final release commit before copying it to the Project page. It already states that no AI-generated images/video/voices are used and that no NASA brand elements appear (guide.md L116). |
| PG-08 | **Review and acceptance**: all required fields and checkboxes, correct members, accessible links, submission confirmed within the deadline (guide.md L55, 92–107, 178–191) | PENDING | Lead + Team Owner (user/platform) | NASA Space Apps platform Project page; confirmation screenshot/URL | **High risk of process failure, not technical failure.** Every member must be registered, accepted and joined to the team (guide.md L25–28); the Team Owner performs the final Submit for Judging (L29–30). Mitigation: run the Last-30-minutes checklist (guide.md L178–191) as a gate; capture the confirmation; if anything changes afterwards, Save Progress + submit again + confirm again (L99–100). |
| PG-09 | **Language**: page, slides and written materials in **English**; video narrated in another language only with English subtitles (guide.md L57–60) | PARTIAL | all | Repository docs are English; app is bilingual by design | Two documented exceptions to review: the Spanish UI catalogue `src/i18n/es.js` (required for feature 14) and quoted Spanish official event material names in `docs/resources.md`. See `docs/conventions.md` and `docs/decisions.md`. Local pitch visuals must be English even if spoken in Spanish (guide.md L150–151). |
| PG-10 | **Public access**: Demo and Final Project links open without password, permission, registration or access request (guide.md L58–60, 189) | PENDING | Lead | Live URL; demo link (video/slides) — both still to be produced | Mitigation: test both links from a private window on a machine that is not logged in; set Drive/YouTube sharing to "anyone with the link"; verify after any file move. |
| PG-11 | **Deadline and freeze**: official NASA deadline Sunday 15 Nov 23:59 local; no later edits accepted (guide.md L20, 97–98); local pitch window 17:30–19:00 | PENDING | Lead | Weekend schedule (guide.md L160–176) | Mitigation: freeze submitted content before the local pitch; keep a 2-hour buffer; publish the deployment before 19:00 and re-verify the URL after any late change. |
| PG-12 | **Pre-existing work / participation rules**: no solution development before Saturday 09:00; pre-existing materials must be declared (guide.md L34–39) | DONE (evidence) | Lead | `git log` shows the repository created and all commits **after** 2026-11-14 09:00 (first commit 11:11 local); no pre-event solution code exists | Low risk. AI tooling and agent assistance are pre-existing and must be declared under PG-07 rather than hidden. |

## 2. Local pitch (not a Project page field, but event-scored)

| ID | Requirement (source) | Status | Owner | Artifact | Risk |
| --- | --- | --- | --- | --- | --- |
| LP-01 | Local pitch Sunday 17:30–19:00, technical tests 16:30–17:15; not a replacement for Submit for Judging (guide.md L144–158) | PENDING | Lead + commercial | Reuse the 7-slide demo deck (`docs/project-page.md`) plus spoken script | Pitch duration/slide-limit rules are ambiguous in published references (2–2:30 or 2–3 min) and must be confirmed with the organization before the technical test (guide.md L152–154). Visual material in English (L150–151). |

## 3. Challenge 10 requirement baseline (official brief)

Source: local copy of the official challenge text
(official challenge statement: <https://www.spaceappschallenge.org/2026/challenges/>);
cross-checked against the Challenge list images
(the official Málaga 2026 event material) as referenced in the internal task. "Architecture
coverage" refers to `docs/architecture.md`; "implementation" refers to the
`main` tree at `af859ef`.

| ID | Required capability (brief) | Architecture coverage | Implementation today (`main` @ `af859ef`) | Verdict |
| --- | --- | --- | --- | --- |
| C-01 | Rapid comparison of **landing sites and dates**; curated site list + custom coordinates; side-by-side/sequential comparison | Features 1, 2, 3 | Implemented in source (`services/sites`, `core/autopilot`, Sites/Coordinate/Comparator panels); unit-tested | **IMPLEMENTED IN SOURCE; demo validation pending** |
| C-02 | Display **Sun and Earth positions relative to the horizon** at a selected site/date | Features 2, 5 | Implemented (`core/engine`, `core/ephemeris`, Horizon panel); unit-tested | **IMPLEMENTED IN SOURCE; accuracy vs live Horizons pending** |
| C-03 | **Power generation potential and direct-to-Earth communication windows** | Features 6, 7 | Implemented (`core/power`, `core/comms`, PowerComms/Countdown panels); unit-tested | **IMPLEMENTED IN SOURCE; demo validation pending** |
| C-04 | **Date and time flexibility** across lunar days/seasons | Feature 4 | Implemented (`core/ephemeris`, DateTime panel, TimelineBar); ephemeris data 2026-11-01 → 2026-12-31 | **IMPLEMENTED IN SOURCE; range limited to the shipped dataset** |
| C-05 | **Time remaining until sunset / Earthset** | Feature 6 | Implemented (`nextSetEvent`, Countdown panel); unit-tested | **IMPLEMENTED IN SOURCE** |
| C-06 | **Visualization** of site–Sun–Earth relationships; usable by planners, educators, public | Features 8, 9, 12, 14 | Implemented: Three.js scene + no-WebGL 2D fallback, Moon Trek layers, EN/ES UI, 11 panels | **IMPLEMENTED IN SOURCE; usability/accessibility validation pending** |
| C-07 | **Topography-aware horizon** using real terrain, no atmosphere/curvature handling | Features 5, 9 | Implemented (`core/engine` curvature + LOLA DEM); terrain data validated | **IMPLEMENTED IN SOURCE; accuracy validation pending** |
| C-08 | **Substantial integration of at least one NASA resource** from the challenge | Features 2, 8, 9 | LOLA terrain, JPL Horizons ephemerides and Moon Trek layer catalogue are shipped **and consumed by the application** | **IMPLEMENTED (data + code)** |

## 4. Submission package inventory and assembly plan

| Package element | Producing artifact | Location / owner | Needed by |
| --- | --- | --- | --- |
| Project name + 50–200 word summary | `docs/project-page.md` | commercial | Before Submit for Judging |
| Detailed description (status + limitations) | `docs/project-page.md` + `docs/test-report.md` | commercial + test bench | Before Submit for Judging |
| NASA Data section (LOLA + Horizons + Moon Trek) | commercial copy + `docs/data-sources.md` + `docs/api-integrations.md` + `public/data/*` metadata | commercial + primary code | Before Submit for Judging |
| Other data/references + licences | commercial copy + `docs/data-sources.md` §6 + `docs/resources.md` | commercial + Lead | Before Submit for Judging |
| AI/SI declaration + generated-content labels | `docs/ai-usage.md` (accuracy-verified) + commercial labels | Lead + primary code | Before Submit for Judging |
| Project Demo link (slides or ≤30 s video) | `docs/project-page.md` → final slides/video file | commercial; Lead publishes | Before Submit for Judging |
| Final Project public link | Deployed `dist/` (Vercel or fallback) | Lead | Before local pitch / definitely before 23:59 |
| Submission confirmation evidence | Platform screenshot/URL | Lead / Team Owner | Before 23:59 Sunday |
| Readiness audit | This checklist | coordination | Continuously until freeze |

## 5. Critical path (dependency order)

1. **Validation & demo run** on the release commit: build, deploy, run the
   end-to-end demo path and record the QA evidence (test bench + Lead).
2. **Lead** publishes the build to a login-free public URL and merges the
   submission-candidate `develop` state into `main` so the repository is a valid
   "Final Project" link.
3. **Commercial** finishes page copy, NASA-data narrative, references and the
   ≤7-slide deck / ≤30 s video from the **validated** state.
4. **Coordination** re-runs this checklist against the release commit and flags
   any requirement that regressed.
5. **Lead + Team Owner** complete the platform checkboxes, test every link in a
   private window, press **Submit for Judging** and keep the confirmation.

## 6. Open decisions needed from Lead/user (blocking submission)

- Final public URL and hosting path (Vercel vs fallback) — Gate for PG-03,
  PG-10.
- Demo format: **slides** vs **video** — affects PG-02 production time.
- Exact AI tools to disclose — PG-07.
- Team registration status of every member on the Málaga event — PG-08.
- Documentation PR: a docs-only PR is authorised; merge it before the submission candidate so the repository reads as a complete project.

## 7. Verification snapshot (2026-11-14, `main` @ `af859ef`)

- Application implemented in source (`src/core`, `src/services`, `src/workers`,
  `src/render`, `src/components` with 11 feature panels); production build is
  green (`npm run build`, Three.js chunk ≈742.93 kB / gzip ≈187.84 kB with a
  chunk-size warning).
- Automated tests: **7 test files, 104 app tests plus 8 MCP tests, all passing** (`npm test`, Vitest
  5.x). UI end-to-end behaviour, accuracy against live JPL Horizons references
  and usability are **not** yet validated.
- Data present: `public/data/pois.json` (10 sites), `public/data/ephemeris/`
  (10 files × 2 928 samples at 30-min steps, JPL Horizons DE441),
  `public/data/layers.json` (21 Moon Trek layers, 1 unavailable),
  `public/data/terrain/` (2 LOLA regions ≈ 10.5 MB). Committed data ≈ 13.4 MB.
- CI: `.github/workflows/ci.yml` (`test-and-build` + `mcp-tests` jobs) on
  push/PR to `main`/`develop`.
- No public deployment exists yet (Vercel deployment pending). The application is
  merged on `main`; the public URL and the Project Demo link must be resolved before
  Submit for Judging.
- Every status claim above was checked at `main` @ `af859ef`; re-run the checks against
  the final release commit before submission.
