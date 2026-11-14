# Security

> This repository is **public**. Anything committed becomes publicly visible
> permanently, even if it is removed later.

## Secrets policy

- Never commit secrets, credentials, tokens or real environment values.
- Real values live only in local `.env` files, which are ignored by git.
- `.env.example` is tracked and documents the required variables with empty or
  placeholder values.
- If a secret is ever exposed, it must be rotated (invalidated) immediately —
  removing it from the commit is not enough.

## Environment variables

| Variable | Purpose | Where |
| --- | --- | --- |
| `NASA_API_KEY` | NASA API access key (<https://api.nasa.gov/>) | Local `.env` only |

The local `.env` file is created from `.env.example` and never committed.

## Protected file types

The [`.gitignore`](../.gitignore) excludes, among others:

- Environment files: `.env`, `.env.*` (except `.env.example`).
- Secrets and credentials: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`,
  `credentials/`, `.npmrc`, `.aws/`.
- Dependencies and build artifacts: `node_modules/`, `dist/`, `build/`,
  `.next/`, `coverage/`, and Python virtual environments/caches.
- Logs, operating system and editor files.

## Checks before pushing

1. `git status` — confirm only intended files are staged.
2. `git diff --cached` — review the actual content being committed.
3. `git ls-files` — review the full list of tracked files.
4. Confirm that no environment values or secrets appear in the diff.

## If a secret is leaked

1. Revoke and rotate the exposed credential immediately.
2. Remove it from the repository history with coordinated history rewriting, or
   invalidate it and add a replacement through environment variables.
3. Force-push the rewritten history only with explicit coordination between the
   two machines.
4. Record the incident and the rotation in the pull request or commit message.

## GitHub credentials

- Authentication is handled by the GitHub CLI (`gh`); the token is stored in the
  system keyring.
- Never paste tokens into files, issues, pull requests or chat messages.
- Never commit `.git-credentials` or any credential helper output.

## Third-party data

- NASA and partner APIs are used according to their terms of use.
- API keys are kept out of source code and out of the repository.
