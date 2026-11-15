# Decision log

Record of decisions made about this repository, in chronological order.

| ID | Date | Decision | Rationale |
| --- | --- | --- | --- |
| D-001 | 2026-11-14 | Repository initialized with `main` as default branch | Single stable branch is the simplest starting point for a two-machine team |
| D-002 | 2026-11-14 | Repository name is `l-sea-space-apps` | GitHub repository names are lowercase and cannot contain spaces |
| D-003 | 2026-11-14 | Repository is public | Requested by the project lead; the project is submitted and evaluated publicly |
| D-004 | 2026-11-14 | All repository content (code, comments, documentation, commits) is written in English | Team convention agreed at project start |
| D-005 | 2026-11-14 | `.env` is ignored by git; `.env.example` is tracked as a template | Prevents leaking secrets in a public repository |
| D-006 | 2026-11-14 | Commits use the GitHub noreply address `338253395+rafaa-sf@users.noreply.github.com` | Keeps the personal email address out of public commit history |
| D-007 | 2026-11-14 | GitHub CLI (`gh`) manages authentication and repository administration | Enables authenticated push/pull and repository setup without manual token handling |
| D-008 | 2026-11-14 | Commits follow Conventional Commits; work happens on short-lived feature branches | Readable history and safe parallel work from two machines |
| D-009 | 2026-11-14 | Documentation is organized under `docs/`, with the README as index | Keeps project documentation structured and easy to maintain |
| D-010 | 2026-11-14 | Documentation focuses on project knowledge; installation/run instructions are added only once the technology stack is defined | The stack is not defined yet, so setup instructions would be speculative |
| D-011 | 2026-11-14 | Two machines with distinct roles: primary (development) and commercial (business side) | Team structure agreed at project start |
| D-012 | 2026-11-14 | The organization's Drive folder is the shared source for the participant guide and event resources; files are linked from `docs/challenge.md` and not copied into the repository | The repository is public, the files are binary/large, and NASA brand-restricted material should not be redistributed |
| D-013 | 2026-11-14 | `docs/challenge.md` is the English working summary of the official Spanish participant guide | Team documentation is written in English, while the original guide remains the authoritative rules source |
| D-014 | 2026-11-14 | `main` remains the stable/submission branch; `develop` is the integration branch during the hackathon | Allows parallel work from several agents and the two machines without destabilizing `main` |
| D-015 | 2026-11-14 | The application ships as a static build and uses pre-computed NASA datasets instead of live API calls | JPL Horizons sends no CORS headers and the static host serves files; pre-computed data keeps the demo offline-safe |
| D-016 | 2026-11-14 | Terrain uses real LOLA polar DEM products in polar stereographic projection (74 m and 594 m grids) | The real PDS products are not regular lat/lon grids; metric projection keeps ray tracing and curvature correct |
| D-017 | 2026-11-14 | A Miro MCP server (`mcp/miro/`) exposes the Miro REST API v2 to AI agents | The team uses Miro as a collaboration platform; the MCP lets agents read and edit the same boards |
| D-018 | 2026-11-14 | All NASA-derived data, endpoints and their verification are documented in `docs/data.md` | Traceability is required for the submission and the jury checks the real use of NASA resources |
| D-019 | 2026-11-14 | The static build is deployed on **Vercel** instead of GoDaddy | Vercel provides free static hosting with CDN, automatic HTTPS and Git-based deploys; GoDaddy was the first option but Vercel is simpler for a Vite SPA |
| D-020 | 2026-11-14 | Documentation consolidated from 26 files into a focused set of 13: `challenge`, `architecture`, `data`, `submission`, `demo`, `ai-usage`, `deployment`, `contributing`, `security`, `decisions`, `commercial`, `qa`, `miro` | The repository was reviewed as cluttered with repeated content; a single canonical document per topic reads as a professional project and removes duplicated event, test and pitch material. `submission.md` holds the Project page content and `demo.md` is the only demo document |
| D-021 | 2026-11-14 | The Project Demo is a single public link to at most 7 slides or a 30-second video, produced from `demo/L-SEA-Project-Demo.pptx` and described in `docs/demo.md` | One demo document avoids drift between the slide plan, video script and submission page |
| D-022 | 2026-11-14 | Adopt the `qa/` Monte Carlo logic bench and device/resolution UI matrix as the project test bench | Adds reproducible evidence beyond the unit suite (randomised scientific-core scenarios and a 51-viewport browser matrix); run on demand rather than in CI because the full matrix takes minutes. Documented in `docs/qa.md` and `qa/README.md` |
| D-023 | 2026-11-14 | Impact assessment and scalability analysis move to their own `docs/scalability.md`, leaving `docs/commercial.md` focused on the business case and judging criteria | Keeps each document focused and avoids a 500-line commercial file; the two documents cross-link and share the same evidence base |
| D-024 | 2026-11-14 | Production moved from Vercel to **GitHub Pages** | The Vercel free plan hit its daily deployment quota during event week and added a security checkpoint; GitHub Pages is free for public repositories, builds through `.github/workflows/pages.yml` with the `/l-sea-space-apps/` base path, and needs no runtime secrets. The Vercel integration was later disconnected (D-025) |
| D-025 | 2026-11-14 | The Vercel GitHub integration is disconnected and `vercel.json` is removed | GitHub Pages is the only documented deploy target; the Vercel app kept posting rate-limited deployment checks and the kept configuration implied an unsupported mirror. The migration rationale and dates remain documented in `docs/deployment.md` and in D-015, D-019 and D-024 |
| D-026 | 2026-11-15 | Fix the 2026-11-15 audit findings in small sequential, reviewer-gated commits (one per finding) | Keeps each fix independently testable and revertible; no scoring, data-contract or NASA-dataset change was made, and CI plus the GitHub Pages deployment stayed green after each commit |
| D-027 | 2026-11-15 | Dates and numbers are formatted with the active locale (English/Spanish), and secondary UI text never renders below 12 px | Spanish users saw English month names and en-US thousands grouping; the 12 px floor keeps secondary text readable according to `docs/ux-compliance.md`. Formatters resolve the locale from `document.documentElement.lang` and accept an explicit locale for tests |
| D-028 | 2026-11-15 | Core results are pure and deterministic: they no longer embed wall-clock timing (`computedAt`, `computeMs`, `rankingMs`, `detectionMs`) | Wall-clock timestamps and durations made full-result equality unreproducible for tests and benches; timing is a presentation concern, so the UI records it in `landingZonesStatus.durationMs` / `landingZonesStatus.ranAt` while core results now re-verify byte-identical JSON equality |

## How to add a decision

Append a new row with the next sequential ID and the current date. Decisions
that replace an earlier one reference the ID they supersede.

