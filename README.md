# L-SEA Space Apps

Repository for **L-SEA Space Apps**, the team's project for the **NASA
International Space Apps Challenge · Málaga 2026** (14–15 November 2026, 42
Málaga Fundación Telefónica).

> **Status:** hackathon weekend. The lunar site selection application is under
> active development; the documentation, NASA datasets and shared resources are
> ready.

## Overview

L-SEA Space Apps is a lunar south-pole site selection and mission briefing tool.
It uses real NASA data to compare candidate landing sites: terrain from LOLA,
Sun/Earth visibility from JPL Horizons, and Moon Trek layers.

The project is developed by a two-machine team:

| Machine | Role | Responsibility |
| --- | --- | --- |
| Primary (`L-SEA`) | Main development | Core application, integration and releases |
| Commercial | Business side | Commercial and outreach work |

The repository is public: <https://github.com/rafaa-sf/l-sea-space-apps>

## At a glance

| Item | Detail |
| --- | --- |
| Event | NASA International Space Apps Challenge · Málaga 2026 |
| Dates | 14–15 November 2026 |
| Development start | Saturday 14 November 2026, 09:00 local time |
| Submission deadline | Sunday 15 November 2026, before 23:59 local time |
| Team size | 1 to 6 people, all registered for the Málaga Local Event |
| Project Demo | At most 7 slides (cover included) OR a video of at most 30 seconds |
| Language | All submitted materials in English |
| Submission | Save Progress → **Submit for Judging** + visible confirmation |
| Challenge | Lunar Landing Site Navigator |

Full rules: [docs/guide.md](docs/guide.md).

## Application

| Item | Detail |
| --- | --- |
| Stack | Vue 3 + Vite + Three.js (plain JavaScript) |
| Deployment | Static build on GoDaddy hosting |
| UI languages | English and Spanish |
| NASA data | JPL Horizons, LOLA DEM (PDS Geosciences), Moon Trek |
| Fallback | Canvas 2D renderer for machines without WebGL |

Architecture and module contracts: [docs/architecture.md](docs/architecture.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/project.md](docs/project.md) | Project scope, event facts, team roles and current status |
| [docs/challenge.md](docs/challenge.md) | Official 2026 challenge statement, objectives and NASA resources |
| [docs/guide.md](docs/guide.md) | English summary of the official participant guide and event rules |
| [docs/submission.md](docs/submission.md) | Project page submission draft (name, summary, description, NASA data, AI declaration) |
| [docs/demo-script.md](docs/demo-script.md) | Project Demo script (7 slides or 30-second video) |
| [demo/L-SEA-Project-Demo.pptx](demo/L-SEA-Project-Demo.pptx) | Project Demo deck: 7 slides, English (generated from docs/demo-script.md) |
| [docs/resources.md](docs/resources.md) | Shared Drive folder, official links and NASA data resources |
| [docs/architecture.md](docs/architecture.md) | Technical architecture, data flow and module contracts |
| [docs/api-integrations.md](docs/api-integrations.md) | NASA endpoints, exact queries, CORS status and attribution |
| [docs/data-sources.md](docs/data-sources.md) | Datasets, provenance, licensing and pre-compute plan |
| [docs/ai-usage.md](docs/ai-usage.md) | AI tools declaration for the NASA submission |
| [docs/conventions.md](docs/conventions.md) | Language, commit message, branch naming and code conventions |
| [docs/git-workflow.md](docs/git-workflow.md) | Git and GitHub workflow for the two machines |
| [docs/coordination.md](docs/coordination.md) | Two-machine lock protocol (git tags), test bench and Miro coordination |
| [docs/security.md](docs/security.md) | Secrets handling, environment variables and repository safety |
| [docs/deployment.md](docs/deployment.md) | GoDaddy static deployment plan |
| [docs/miro-mcp.md](docs/miro-mcp.md) | Miro MCP server for agent–board collaboration |
| [docs/decisions.md](docs/decisions.md) | Decision log for the repository |

### Commercial workstream

Produced by the commercial machine; they cover the business, impact, pitch and
QA side of the submission.

| Document | Contents |
| --- | --- |
| [docs/business-case.md](docs/business-case.md) | Business case: problem, users, value proposition and sustainability |
| [docs/impact-scalability.md](docs/impact-scalability.md) | Impact and scalability dossier: audiences, measurable impact, growth and risks |
| [docs/judging-criteria.md](docs/judging-criteria.md) | Judging criteria and evidence map with proven/unproven status |
| [docs/pitch.md](docs/pitch.md) | Pitch and Project Demo package: slides, oral pitch, video script and Q&A |
| [docs/project-page.md](docs/project-page.md) | NASA Project page copy (summary, detailed description, NASA data, references, AI declaration) |
| [docs/submission-readiness.md](docs/submission-readiness.md) | Submission checklist mapped to the participant guide, requirement baseline and verification snapshot |
| [docs/test-plan.md](docs/test-plan.md) | QA test plan: levels, cases, evidence and gates |
| [docs/test-report.md](docs/test-report.md) | Test report: baseline and delta results, evidence and limitations |

## Repository layout

```text
.
├── .env.example          # Environment variable template (no real values)
├── .gitignore            # Ignored files: secrets, dependencies, build artifacts
├── index.html            # Vite entry point
├── package.json          # App dependencies and scripts
├── vite.config.js        # Vite configuration
├── src/                  # Vue application, Three.js scene and domain logic
├── public/data/          # Pre-computed NASA datasets (ephemeris, terrain, POIs, layers)
├── scripts/nasa/         # Data acquisition and processing scripts
├── mcp/miro/             # Miro MCP server (separate package)
├── demo/                 # Project Demo deck (pptx) and regeneration notes
├── docs/                 # Project documentation
└── .github/workflows/    # CI: tests and production build
```

## Conventions (short version)

- All code, comments, commit messages and documentation are written in **English**.
- Never commit secrets or real environment values.
- `main` is the stable branch; `develop` is the integration branch for the
  hackathon build; all work happens on short-lived feature branches.
- At least one NASA resource from the challenge must be used and explained.

See [docs/conventions.md](docs/conventions.md) and
[docs/git-workflow.md](docs/git-workflow.md) for details.
