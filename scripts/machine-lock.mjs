#!/usr/bin/env node
/**
 * Advisory cross-machine lock for this repository.
 *
 * Two machines work on the same repo (primary and commercial). Before pushing,
 * building on the shared test bench, or deploying, a machine acquires a lock.
 * The lock is an annotated git tag on `origin` named:
 *
 *   lock/<machine>/<YYYYMMDDTHHMMZ>
 *
 * The other machine checks those tags before pushing. If the other machine has
 * a fresh lock tag (age <= TTL, default 90 minutes), the push is refused.
 * Stale tags are ignored (and reported), so a crashed session cannot block the
 * team forever.
 *
 * Machine identity resolution: `LSEA_MACHINE` env var, then `git config
 * lsea.machine`, then "primary".
 *
 * Usage:
 *   node scripts/machine-lock.mjs status
 *   node scripts/machine-lock.mjs check
 *   node scripts/machine-lock.mjs acquire [--purpose "message"]
 *   node scripts/machine-lock.mjs release
 *   node scripts/machine-lock.mjs run [--purpose "message"] -- <command...>
 *
 * Exit codes: 0 = safe / success, 1 = blocked or failure.
 */
import { execFileSync } from 'node:child_process'

const REMOTE = process.env.LSEA_LOCK_REMOTE || 'origin'
const TTL_MINUTES = Number(process.env.LSEA_LOCK_TTL_MINUTES || 90)
const TAG_PREFIX = 'lock'

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function resolveMachine() {
  const fromEnv = (process.env.LSEA_MACHINE || '').trim()
  if (fromEnv) return fromEnv
  try {
    const fromConfig = git(['config', '--get', 'lsea.machine'])
    if (fromConfig) return fromConfig.trim()
  } catch {
    /* not configured */
  }
  return 'primary'
}

const MACHINE = resolveMachine()

function timestamp(date = new Date()) {
  const iso = date.toISOString() // 2026-11-14T12:01:02.345Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`
}

/** @param {string} stamp e.g. 20261114T1201Z */
function parseStamp(stamp) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(stamp)
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00Z`)
}

/** @returns {Array<{ machine: string, stamp: string, time: number, ageMinutes: number, tag: string }>} */
function remoteLocks() {
  let output = ''
  try {
    output = git(['ls-remote', '--tags', REMOTE, `refs/tags/${TAG_PREFIX}/*`])
  } catch {
    return []
  }
  const now = Date.now()
  const locks = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('refs/tags/')) continue
    const ref = line.split('refs/tags/')[1]
    if (ref.endsWith('^{}')) continue
    const parts = ref.split('/')
    if (parts.length !== 3 || parts[0] !== TAG_PREFIX) continue
    const time = parseStamp(parts[2])
    if (time === null) continue
    locks.push({
      machine: parts[1],
      stamp: parts[2],
      time,
      ageMinutes: Math.max(0, (now - time) / 60000),
      tag: ref,
    })
  }
  return locks
}

/** @param {string} machine */
function freshLocks(machine) {
  return remoteLocks().filter(
    (lock) => lock.machine === machine && lock.ageMinutes <= TTL_MINUTES,
  )
}

function describe(lock) {
  return `${lock.tag} (${lock.ageMinutes.toFixed(1)} min old)`
}

function printStatus() {
  const locks = remoteLocks()
  if (locks.length === 0) {
    console.log(`[lsea-lock] machine "${MACHINE}": no locks on ${REMOTE}. Push is allowed.`)
    return
  }
  console.log(`[lsea-lock] machine "${MACHINE}": locks on ${REMOTE}:`)
  for (const lock of locks) {
    const state = lock.ageMinutes <= TTL_MINUTES ? 'ACTIVE' : 'stale'
    const own = lock.machine === MACHINE ? ' (this machine)' : ''
    console.log(`  - ${describe(lock)} -> ${state}${own}`)
  }
  const otherActive = locks.filter(
    (lock) => lock.machine !== MACHINE && lock.ageMinutes <= TTL_MINUTES,
  )
  if (otherActive.length > 0) {
    console.log(`[lsea-lock] BLOCKED: another machine is using the test bench.`)
  } else {
    console.log(`[lsea-lock] OK: no other machine holds a lock.`)
  }
}

function check() {
  const other = freshLocks(
    (process.env.LSEA_OTHER_MACHINE || '').trim() ||
      (MACHINE === 'commercial' ? 'primary' : 'commercial'),
  )
  if (other.length > 0) {
    console.error(
      `[lsea-lock] BLOCKED by ${describe(other[other.length - 1])}: ` +
        `wait for it to finish or set LSEA_LOCK_BYPASS=1 for an emergency push.`,
    )
    process.exitCode = 1
    return false
  }
  return true
}

function acquire(purpose = '') {
  if (!check()) return false
  const ownExisting = freshLocks(MACHINE)
  for (const lock of ownExisting) {
    console.log(`[lsea-lock] refreshing existing own lock: ${describe(lock)}`)
  }
  const tag = `${TAG_PREFIX}/${MACHINE}/${timestamp()}`
  const message = [
    `L-SEA advisory lock`,
    `machine: ${MACHINE}`,
    `purpose: ${purpose || 'push/test-bench'}`,
    `host: ${process.env.HOSTNAME || 'unknown'}`,
    `commit: ${git(['rev-parse', '--short', 'HEAD'])}`,
    `created: ${new Date().toISOString()}`,
  ].join('\n')
  try {
    git(['tag', '-a', tag, '-m', message])
    git(['push', REMOTE, `refs/tags/${tag}`])
  } catch (error) {
    console.error(`[lsea-lock] failed to create lock tag ${tag}: ${error.message}`)
    return false
  }
  // Race mitigation: another machine may have acquired between check and push.
  if (!check()) {
    console.error('[lsea-lock] lost the race; releasing our lock.')
    release()
    return false
  }
  console.log(`[lsea-lock] acquired ${tag} (TTL ${TTL_MINUTES} min). Run "release" when done.`)
  return true
}

function release() {
  // Deleting our own lock must never be blocked by the pre-push hook, even when
  // the other machine holds a lock at the same time.
  const previousBypass = process.env.LSEA_LOCK_BYPASS
  process.env.LSEA_LOCK_BYPASS = '1'
  const locks = remoteLocks().filter((lock) => lock.machine === MACHINE)
  for (const lock of locks) {
    try {
      git(['push', REMOTE, `--delete`, `refs/tags/${lock.tag}`])
    } catch (error) {
      console.error(`[lsea-lock] could not delete remote ${lock.tag}: ${error.message}`)
    }
  }
  if (previousBypass === undefined) delete process.env.LSEA_LOCK_BYPASS
  else process.env.LSEA_LOCK_BYPASS = previousBypass
  // Delete local tags of this machine, including stale ones.
  let local = []
  try {
    local = git(['tag', '--list', `${TAG_PREFIX}/${MACHINE}/*`])
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    /* ignore */
  }
  for (const tag of local) {
    try {
      git(['tag', '--delete', tag])
    } catch {
      /* ignore */
    }
  }
  console.log(`[lsea-lock] released ${locks.length} remote lock(s) for ${MACHINE}.`)
}

async function runWithLock(command, purpose) {
  if (!acquire(purpose)) {
    process.exitCode = 1
    return
  }
  let code = 1
  try {
    const child = await import('node:child_process')
    code = await new Promise((resolve) => {
      const proc = child.spawn(command[0], command.slice(1), { stdio: 'inherit' })
      proc.on('exit', (exitCode) => resolve(exitCode ?? 1))
      proc.on('error', (error) => {
        console.error(`[lsea-lock] command failed to start: ${error.message}`)
        resolve(1)
      })
    })
  } finally {
    release()
  }
  process.exitCode = code
}

function parseArgs(argv) {
  const args = [...argv]
  let purpose = ''
  const purposeIndex = args.indexOf('--purpose')
  if (purposeIndex !== -1 && args[purposeIndex + 1]) {
    purpose = args[purposeIndex + 1]
    args.splice(purposeIndex, 2)
  }
  return { args, purpose }
}

const { args, purpose } = parseArgs(process.argv.slice(2))
const [command, ...rest] = args

switch (command) {
  case 'status':
    printStatus()
    break
  case 'check':
    if (check()) console.log('[lsea-lock] OK: push is allowed.')
    break
  case 'acquire':
    if (!acquire(purpose)) process.exitCode = 1
    break
  case 'release':
    release()
    break
  case 'run': {
    const separator = rest.indexOf('--')
    const cmd = separator === -1 ? rest : rest.slice(separator + 1)
    if (cmd.length === 0) {
      console.error('Usage: machine-lock.mjs run [--purpose "..."] -- <command...>')
      process.exitCode = 2
      break
    }
    await runWithLock(cmd, purpose)
    break
  }
  default:
    console.error(
      'Usage: machine-lock.mjs <status|check|acquire|release|run> [--purpose "..."] [-- command...]',
    )
    process.exitCode = 2
}
