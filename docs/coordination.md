# Two-machine coordination

Two machines work on this project in parallel:

| Machine | Identity | Role |
| --- | --- | --- |
| Primary | `primary` | Development, integration, releases |
| Commercial | `commercial` | Commercial side, outreach and test bench |

They share the GitHub repository and the Miro team. To avoid pushing or using
the shared test bench at the same time, they use an **advisory lock made of git
tags on `origin`**.

## Lock tags

A lock is an annotated git tag:

```text
lock/<machine>/<YYYYMMDDTHHMMZ>
```

Example: `lock/primary/20261114T1201Z`.

- Machine identity: `git config lsea.machine <name>` (local config, never
  committed) or the `LSEA_MACHINE` environment variable. Default: `primary`.
- Locks are **fresh** for 90 minutes by default (`LSEA_LOCK_TTL_MINUTES`).
  A fresh lock from the other machine blocks pushes.
- Stale locks are ignored and reported, so a crashed session cannot block the
  team forever.
- Lock tags are coordination-only. They are deleted when released; they are
  not release tags.

## Commands

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

## Rules

1. **Before pushing, using the test bench, or deploying**, acquire the lock with
   a short purpose message.
2. **Release the lock** as soon as the operation ends (`run` does this
   automatically, even when the command fails).
3. **Do not push while the other machine holds a fresh lock.** The
   `.githooks/pre-push` hook enforces this automatically.
4. Emergency bypass only: `LSEA_LOCK_BYPASS=1 git push ...`. Mention it in the
   commit or in the chat so the other machine knows why the protocol was
   skipped.
5. Keep locks short. Do local work (editing, tests) without a lock; lock only
   for shared operations.
6. If a lock is stale (older than the TTL), it is safe to proceed; the next
   `release` on the owning machine cleans it up.

## Test bench

The "test bench" is the shared environment used to validate a build before it
is considered releasable — for example the staging deployment or the shared
preview used to compare machines.

- Only one machine uses it at a time, guarded by the lock.
- A deploy also uses the lock: acquire, deploy, verify, release.
- The machine that releases `main`/deploys runs the full validation while
  holding the lock.

## Setup on each machine

Run once per clone:

```bash
# Identify the machine (local git config, not committed)
git config lsea.machine primary        # or: commercial

# Enable the pre-push hook
git config core.hooksPath .githooks

# Sanity check
node scripts/machine-lock.mjs status
```

The commercial machine stores its own Miro token in its local `.env` (see
[miro-mcp.md](miro-mcp.md)); tokens are never committed or shared through git.

## Miro coordination

Both machines connect to the same Miro team with their own app access token.

- Use one board per workstream: a technical board (mission data, architecture,
  demo) and a commercial board (partners, outreach, presentation).
- Do not edit the same item at the same time; use frames to separate working
  areas and Miro comments/presence to coordinate.
- The git lock covers repository and test-bench operations, not live Miro
  editing (Miro has its own real-time collaboration).

## Release tags

Coordination tags are `lock/*`. Release tags (`v*`) are created only at
submission milestones, after final validation, and are never used for locking.
