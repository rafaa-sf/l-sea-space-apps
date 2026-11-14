# Documentation index

Canonical documentation for **L-SEA Space Apps**, the lunar landing-site
navigator built for the NASA International Space Apps Challenge, Málaga 2026.

Live application: <https://rafaa-sf.github.io/l-sea-space-apps/>

This index is the entry point when browsing the `docs/` directory. Every
document is written in English and kept in sync with the implementation.

## Project and challenge

| Document | What it covers |
| --- | --- |
| [challenge.md](challenge.md) | Official 2026 challenge statement, event rules, shared resources and NASA data links |
| [architecture.md](architecture.md) | Technical architecture, runtime constraints, domain model, module contracts and feature map |
| [data.md](data.md) | NASA endpoints, CORS evidence, dataset provenance, LOLA download record, licensing and official-source verification |
| [ai-usage.md](ai-usage.md) | AI use declaration required by the challenge: tools, agent teams, human responsibilities |

## Product, impact and submission

| Document | What it covers |
| --- | --- |
| [mission-presets.md](mission-presets.md) | Historical mission profile presets for the site comparator, with sources and modelling assumptions |
| [submission.md](submission.md) | Project page content, submission checklist and link inventory |
| [demo.md](demo.md) | Project Demo format, seven-slide plan, 30-second video script and evidence values |
| [scalability.md](scalability.md) | Impact assessment and scalability analysis: beneficiaries, measurable impact, growth, scale limits and roadmap |
| [commercial.md](commercial.md) | Business case, market, business model and judging-criteria mapping |

## Quality and operations

| Document | What it covers |
| --- | --- |
| [qa.md](qa.md) | Test strategy and executed QA evidence (unit, contract, Monte Carlo bench, device matrix, live checks) |
| [ux-compliance.md](ux-compliance.md) | Compliance with the Málaga 2026 UX support guide: 7 requirements, measured audit, gaps and change-control process |
| [deployment.md](deployment.md) | GitHub Pages deployment, verification checklist and rollback |
| [contributing.md](contributing.md) | Language, commit and branch conventions plus the two-machine collaboration protocol |
| [security.md](security.md) | Secrets policy, protected files and repository safety |
| [decisions.md](decisions.md) | Decision log for architecture, data, tooling and process |
| [miro.md](miro.md) | Miro MCP server setup, authentication and tool list |

## Reproducible test bench

The `qa/` directory contains the runnable test bench referenced by the QA
documentation:

| Document | What it covers |
| --- | --- |
| [qa/README.md](../qa/README.md) | Monte Carlo logic bench and device/resolution matrix: how to run, contracts and layout |
| [qa/SPEC.md](../qa/SPEC.md) | Test-bench contract: scenarios, invariants, UI checks and tagging |
| [qa/REPORT.md](../qa/REPORT.md) | Executed runs, numbers, findings and reproduction |

## Screenshots

| Asset | Content |
| --- | --- |
| [app-3d.png](screenshots/app-3d.png) | Application in 3D mode with the rectangular LOLA terrain |
| [app-2d-es.png](screenshots/app-2d-es.png) | Spanish interface in the no-WebGL 2D fallback |
| [layer-coverage-3d.png](screenshots/layer-coverage-3d.png) | Moon Trek layer with its coverage footprint and per-layer zoom |
| [custom-extent-3d.png](screenshots/custom-extent-3d.png) | Custom rectangular LOLA DEM extent with a Moon Trek layer draped in 3D |
| [area-presets-3d.png](screenshots/area-presets-3d.png) | LOLA area preset (300 km) selected from the DEM area dropdown |
| [landing-zones-3d.png](screenshots/landing-zones-3d.png) | Autopilot ranking of flat landing zones detected from the LOLA DEM |

## Repository entry points

| Location | Content |
| --- | --- |
| [README.md](../README.md) | Project overview, live application, stack and quick links |
| [src/](../src) | Vue 3 application, Three.js scene and framework-agnostic domain core |
| [public/data/](../public/data) | Pre-computed NASA datasets (Horizons ephemerides, LOLA terrain, Moon Trek layers, POIs) |
| [scripts/](../scripts) | Data pipeline, deployment verification, QA and Miro tooling |
| [mcp/miro/](../mcp/miro) | Model Context Protocol server for the Miro REST API |
