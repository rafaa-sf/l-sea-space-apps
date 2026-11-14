# L-SEA Space Apps

Repository for the **NASA International Space Apps Challenge** project
**L-SEA Space Apps**.

> **Status:** early setup. Project rules, technology stack and final application
> structure will be documented here as they are defined.

## Overview

L-SEA Space Apps is developed by a two-machine team:

| Machine | Role | Responsibility |
| --- | --- | --- |
| Primary (`L-SEA`) | Main development | Core application, integration and releases |
| Commercial | Business side | Commercial and outreach work |

The repository is public: <https://github.com/rafaa-sf/l-sea-space-apps>

## Documentation

| Document | Contents |
| --- | --- |
| [docs/project.md](docs/project.md) | Project scope, team roles, current status and pending decisions |
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

See [docs/conventions.md](docs/conventions.md) and
[docs/git-workflow.md](docs/git-workflow.md) for details.
