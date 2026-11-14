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

## How to add a decision

Append a new row with the next sequential ID and the current date. Decisions
that replace an earlier one reference the ID they supersede.
