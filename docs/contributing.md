# Contributing

Conventions, git workflow and the two-machine collaboration protocol used to build
L-SEA. The repository is public and the project is submitted to NASA Space Apps, so
all repository content is in English and every change is reviewable.

## 1. Language and file conventions

- All code, identifiers, comments, commit messages, branch names, pull request
  titles and descriptions, and documentation are written in **English**.
- Documentation lives in `docs/` as Markdown; file names are lowercase and
  hyphen-separated. `README.md` is the entry point and index.
- Documentation is updated in the same change that modifies the documented
  behaviour.
- Text files use UTF-8 encoding and LF line endings. Binary data files are stored
  with the rules in [`.gitattributes`](../.gitattributes).
- Do not commit dead or commented-out code, generated artifacts or secrets (see
  [security.md](security.md)).

## 2. Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <summary>
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`,
  `build`.
- **Scope** is optional and names the affected area.
- **Summary** is written in the imperative mood, starts lowercase and has no trailing
  period (`add orbit visualization`, not `Added orbit visualization.`).
- The subject line is at most 72 characters; the body, when needed, explains **why**
  the change was made, wrapped at 72 characters.

Examples:

```text
feat(api): add NASA image search endpoint
fix(ui): correct timezone offset in date picker
docs: describe repository workflow for two machines
```

## 3. Branch naming

- `feature/<short-slug>`: new functionality.
- `fix/<short-slug>`: bug fixes.
- `docs/<short-slug>`: documentation-only changes.
- `refactor/<short-slug>`: code restructuring without behaviour changes.
- `chore/<short-slug>`: tooling, configuration and maintenance.

Slugs are lowercase and hyphenated (`feature/solar-data-charts`).

## 4. Code and quality gates

- Plain JavaScript ES modules, Vue 3 Composition API (`<script setup>`), no
  TypeScript.
- Formatting and linting are expected to pass in CI; code must pass the configured
  checks before merging.
- `npm test` (Vitest) and `npm run build` are the required local gates; CI runs the
  same commands on Node.js 24 (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
- The Miro MCP server is a separate package with its own test suite:
  `npm --prefix mcp/miro test`.
- Keep changes small and focused. Do not commit build output (`dist/`),
  `node_modules/` or local caches.

## 5. Git and GitHub workflow

- Remote `origin` points to `https://github.com/rafaa-sf/l-sea-space-apps.git`.
- `main` is the default and stable branch; it is always releasable and every push to
  it deploys the production site on GitHub Pages.
- All work happens on short-lived branches created from an up-to-date `main`; once a
  branch is merged it is deleted.
- Every change reaches `main` through a pull request in English that explains the
  change and its motivation. Prefer squash merges to keep history linear.
- Never force-push `main`. Force-push a shared feature branch only with
  `--force-with-lease` and never while another machine is working on it.

### Working from two machines

1. Before starting work, update `main`:

   ```bash
   git checkout main
   git pull --rebase origin main
   git checkout -b feature/<short-slug>
   ```

2. Commit and push the branch regularly: `git push -u origin feature/<short-slug>`.
3. Open a pull request into `main`, review it and merge when ready.
4. Both machines update `main` before starting new work.
5. If both machines work at the same time, use separate branches and rebase on
   `origin/main` before opening the pull request.
6. Before pushing, using the shared test bench or deploying, acquire the advisory
   lock described in section 6. The `.githooks/pre-push` hook blocks pushes while the
   other machine holds a fresh lock.

### Authentication

- GitHub operations use the GitHub CLI (`gh`), authenticated as `rafaa-sf`.
- `gh auth setup-git` configures the credential helper, so HTTPS pull and push work
  without asking for credentials again.
- Tokens are stored by `gh` in the system keyring and are never committed.

## 6. Two-machine coordination (advisory lock)

Two machines work on this project in parallel:

| Machine | Identity | Role |
| --- | --- | --- |
| Primary | `primary` | Development, integration, releases |
| Commercial | `commercial` | Commercial side, outreach and test bench |

They share the GitHub repository and the Miro team. To avoid pushing or using the
shared test bench at the same time, they use an **advisory lock made of git tags on
`origin`**.

### Lock tags

A lock is an annotated git tag named `lock/<machine>/<YYYYMMDDTHHMMZ>`, for example
`lock/primary/20261114T1201Z`.

- Machine identity comes from `git config lsea.machine <name>` (local config, never
  committed) or the `LSEA_MACHINE` environment variable; the default is `primary`.
- Locks are fresh for 90 minutes by default (`LSEA_LOCK_TTL_MINUTES`). A fresh lock
  from the other machine blocks pushes; stale locks are ignored and reported, so a
  crashed session cannot block the team forever.
- Lock tags are coordination-only: they are deleted when released and are not release
  tags.
- `claim/*` and `sync/*` tags from early on predate this protocol and are advisory
  only; they are kept as artifacts and are not interpreted by the tooling. All new
  coordination uses `lock/<machine>/<stamp>` tags.

### Commands

```bash
# Show the locks currently on origin and whether pushing is allowed
node scripts/machine-lock.mjs status

# Exit 0 when allowed, exit 1 when the other machine holds a fresh lock
node scripts/machine-lock.mjs check

# Acquire the lock for this machine (refuses if the other machine holds one)
node scripts/machine-lock.mjs acquire --purpose "running the shared test bench"

# Release this machine's lock (remote and local tags)
node scripts/machine-lock.mjs release

# Acquire, run a command, and always release afterwards
node scripts/machine-lock.mjs run --purpose "build and preview" -- npm run build
```

### Rules

1. Before pushing, using the test bench or deploying, acquire the lock with a short
   purpose message.
2. Release the lock as soon as the operation ends; `run` does this automatically,
   even when the command fails.
3. Do not push while the other machine holds a fresh lock; the pre-push hook enforces
   this.
4. Emergency bypass only: `LSEA_LOCK_BYPASS=1 git push ...`. Mention it in the commit
   or in the chat.
5. Keep locks short. Do local work (editing, tests) without a lock; lock only for
   shared operations.
6. If a lock is stale (older than the TTL), it is safe to proceed; the next `release`
   on the owning machine cleans it up.

### Test bench

The "test bench" is the shared environment used to validate a build before it is
considered releasable, for example the staging deployment or a shared preview. Only
one machine uses it at a time, guarded by the lock. A deploy also uses the lock:
acquire, deploy, verify, release. The machine that releases `main` or deploys runs
the full validation while holding the lock.

### Setup on each machine

Run once per clone:

```bash
# Identify the machine (local git config, not committed)
git config lsea.machine primary        # or: commercial

# Enable the pre-push hook
git config core.hooksPath .githooks

# Sanity check
node scripts/machine-lock.mjs status
```

Each machine stores its own Miro token in its local `.env` (see [miro.md](miro.md));
tokens are never committed or shared through git.

## 7. Miro coordination

Both machines connect to the same Miro team with their own app access token.

- Use one board per workstream: a technical board (mission data, architecture, demo)
  and a commercial board (partners, outreach, presentation).
- Do not edit the same item at the same time; use frames to separate working areas
  and Miro comments and presence to coordinate.
- The git lock covers repository and test-bench operations, not live Miro editing
  (Miro has its own real-time collaboration).

## 8. Releases and tags

Coordination tags are `lock/*`. Release tags (`v*`) are created only at submission
milestones, after final validation, and are never used for locking.
