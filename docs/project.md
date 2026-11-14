# Project

## Purpose

L-SEA Space Apps is the team's project for the **NASA International Space Apps
Challenge · Málaga 2026**, a global hackathon that brings together participants
to solve challenges using NASA and partner open data.

The project answers the 2026 challenge **Lunar Landing Site Navigator**
(<https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>)
and integrates NASA resources from that challenge (JPL Horizons, LOLA, Moon Trek,
QuickMap) with an explained real contribution. It must be submitted through the
official Project page before the NASA deadline.

## Event facts

| Item | Detail |
| --- | --- |
| Challenge | Lunar Landing Site Navigator |
| Event | NASA International Space Apps Challenge · Málaga 2026 |
| Dates | 14–15 November 2026 |
| Venue | 42 Málaga Fundación Telefónica · Av. Sor Teresa Prat, 15 · Edificio E3 · 29003 Málaga |
| Development start | Saturday 14 November 2026, 09:00 local time |
| Submission deadline | Sunday 15 November 2026, before 23:59 local time |
| Team size | 1 to 6 people |
| Local lead | Celeste Sánchez · <nasa.spaceapps.malaga@gmail.com> |

The complete rules are summarized in [guide.md](guide.md).

## Team and machines

The team works from two machines:

| Machine | Role | Responsibility |
| --- | --- | --- |
| Primary (`L-SEA`) | Main development | Core application, integration, releases and repository administration |
| Commercial | Business side | Commercial and outreach work |

Both machines work on the same public repository:
<https://github.com/rafaa-sf/l-sea-space-apps>

Coordination rules for working from two machines are described in
[git-workflow.md](git-workflow.md).

## Current status

**Hackathon weekend (14–15 November 2026).** The repository, documentation,
shared resources index and real NASA datasets (JPL Horizons ephemerides, LOLA
DEM terrain, Moon Trek layers, POIs) are ready. The Vue 3 + Three.js application
is implemented and being hardened; the Miro MCP server is available for
agent–board collaboration.

Pending:

- Final application polish and end-to-end demo validation.
- GoDaddy deployment of the static build.
- Project page submission (Submit for Judging).
- Demo materials (at most 7 slides or a 30-second video).

## Technology

| Item | Detail |
| --- | --- |
| UI | Vue 3 + Vite (plain JavaScript) |
| 3D viewport | Three.js, with a Canvas 2D fallback for machines without WebGL |
| Domain logic | Framework-agnostic ES modules (`src/core/`, `src/services/`) |
| Background compute | Web Worker (single CPU thread) |
| i18n | English and Spanish (`vue-i18n`) |
| Deployment | Static build on GoDaddy hosting |
| AI collaboration | Miro MCP server (`mcp/miro/`) |

See [architecture.md](architecture.md) for the module contracts.

## Repository ownership

- GitHub account: `rafaa-sf`.
- Repository: `l-sea-space-apps`.
- Default branch: `main`.
