# Git and GitHub workflow

## Remote

- Remote `origin` points to
  `https://github.com/rafaa-sf/l-sea-space-apps.git`.
- The default and stable branch is `main`.
- `origin/main` is the shared source of truth for both machines.

## Branches

- `main` is always in a releasable state.
- All work happens on short-lived branches created from an up-to-date `main`.
- Branches follow the naming rules in [conventions.md](conventions.md)
  (`feature/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`).
- Once a branch is merged, it is deleted.

## Commits

- Follow the commit message format in [conventions.md](conventions.md).
- Commit often and in logical units; do not mix unrelated changes.
- Never commit secrets or generated artifacts (see [security.md](security.md)).

## Pull requests

- Every change reaches `main` through a pull request.
- The pull request description explains the change and its motivation, in
  English.
- Review requirements and merge strategy (squash or merge commit) are to be
  defined by the team; until then, prefer squash merges to keep `main` history
  linear.

## Two-machine workflow

Both machines push to the same public repository. To avoid conflicts:

1. **Before starting work**, update the local `main`:

   ```bash
   git checkout main
   git pull --rebase origin main
   ```

2. **Create a branch** for the work:

   ```bash
   git checkout -b feature/<short-slug>
   ```

3. **Commit and push** the branch regularly:

   ```bash
   git push -u origin feature/<short-slug>
   ```

4. **Open a pull request** into `main` and merge it when ready.

5. **After merging**, both machines update `main` before starting new work.

Rules:

- Never force-push `main`.
- Force-push a shared feature branch only with `--force-with-lease`, and never
  while another machine is actively working on it.
- Keep branches short-lived to minimize merge conflicts.
- If both machines work at the same time, they use separate branches and rebase
  on `origin/main` before opening the pull request.
- Before pushing, using the shared test bench or deploying, acquire the
  advisory lock described in [coordination.md](coordination.md). The
  `.githooks/pre-push` hook blocks pushes while the other machine holds a fresh
  lock.

## Authentication

- GitHub operations use the GitHub CLI (`gh`), authenticated as `rafaa-sf`.
- `gh auth setup-git` configures the credential helper, so HTTPS pull/push work
  without asking for credentials again.
- Tokens are stored by `gh` in the system keyring and are never committed to the
  repository.

## Releases and tags

To be defined once the project has buildable releases.
