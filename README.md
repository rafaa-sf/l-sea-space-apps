# L-SEA Space Apps

Repository for **L-SEA Space Apps**, the team's project for the **NASA
International Space Apps Challenge · Málaga 2026** (14–15 November 2026, 42
Málaga Fundación Telefónica).

> **Status:** hackathon weekend. Team rules and event resources are documented;
> the technology stack and application structure are being defined.

## Overview

L-SEA Space Apps is developed by a two-machine team:

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

Full rules: [docs/guide.md](docs/guide.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/project.md](docs/project.md) | Project scope, event facts, team roles and current status |
| [docs/guide.md](docs/guide.md) | English summary of the official participant guide and event rules |
| [docs/resources.md](docs/resources.md) | Shared Drive folder, official links and NASA data resources |
| [docs/conventions.md](docs/conventions.md) | Language, commit message, branch naming and code conventions |
| [docs/git-workflow.md](docs/git-workflow.md) | Git and GitHub workflow for the two machines |
| [docs/security.md](docs/security.md) | Secrets handling, environment variables and repository safety |
| [docs/decisions.md](docs/decisions.md) | Decision log for the repository |

## Repository layout

```text
.
├── .env.example      # Environment variable template (no real values)
├── .gitignore        # Ignored files: secrets, dependencies, build artifacts
├── README.md         # This file
└── docs/             # Project documentation
```

## Conventions (short version)

- All code, comments, commit messages and documentation are written in **English**.
- Never commit secrets or real environment values.
- `main` is the stable branch; all changes go through feature branches.
- At least one NASA resource from the challenge must be used and explained.

See [docs/conventions.md](docs/conventions.md) and
[docs/git-workflow.md](docs/git-workflow.md) for details.
