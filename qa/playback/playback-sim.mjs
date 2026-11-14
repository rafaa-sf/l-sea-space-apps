#!/usr/bin/env node
/**
 * Playback / time-control simulator (bug hunting for issue #11).
 *
 * Loads the REAL store actions from the repository
 * (`src/components/composables/useAppState.js`) under fake timers and fake
 * browser globals, then runs thousands of random operation sequences
 * (play, pause, toggle, now, ±1 h, setTime, jump-to-event, mission updates)
 * checking playback invariants after every step:
 *
 *   I1  when `playing === false`, advancing time must not change `state.time`
 *   I2  when `playing === true`, exactly one playback interval is active
 *   I3  when `playing === false`, no playback interval is active (no leaks)
 *   I4  two consecutive `startPlayback()` calls produce one interval
 *   I5  `togglePlayback()` twice returns to stopped with no interval
 *   I6  `setNow()` stops playback and clears the interval
 *
 * Deterministic seed, reproducible run:
 *   node qa/playback/playback-sim.mjs --sequences 5000 --seed 20261114
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Locate the repository root (works from qa/playback and from a work copy). */
function detectRepo() {
  const candidates = [
    process.env.PLAYBACK_REPO,
    resolve(HERE, '..', '..'),
    resolve(HERE, '..', '..', 'l-sea-space-apps'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'package.json')) && existsSync(resolve(candidate, 'src/components/composables/useAppState.js'))) {
      return candidate
    }
  }
  throw new Error('Cannot find the repository root; set PLAYBACK_REPO')
}

const REPO = detectRepo()

/* ------------------------------------------------------------------ */
/* Fake browser globals (needed before the store is imported)          */
/* ------------------------------------------------------------------ */
const memory = new Map()
const localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
}
globalThis.localStorage = localStorage
globalThis.window = {
  location: { search: '', hash: '', href: 'http://localhost/' },
  localStorage,
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.document = {
  documentElement: { lang: 'en', dataset: {} },
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  createElement: () => ({ style: {}, getContext: () => null, remove() {}, appendChild() {} }),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true })
} catch {
  /* Node exposes a getter-only navigator; i18n can use its language */
}

/* ------------------------------------------------------------------ */
/* Fake timers                                                         */
/* ------------------------------------------------------------------ */
let fakeTimersInstalled = false
let nowMs = Date.UTC(2026, 10, 14, 12, 0, 0)
let nextId = 1
const intervals = new Map() // id -> { fn, every, nextAt, kind }
const timeouts = new Map() // id -> { fn, due }

/** Install fake timers AFTER Vite finishes loading the module graph. */
function installFakeTimers() {
  if (fakeTimersInstalled) return
  fakeTimersInstalled = true
  Date.now = () => nowMs

  globalThis.setInterval = (fn, every) => {
    const id = nextId++
    intervals.set(id, { fn, every: Number(every) || 1, nextAt: nowMs + (Number(every) || 1), kind: 'interval' })
    return id
  }
  globalThis.clearInterval = (id) => {
    intervals.delete(id)
  }
  globalThis.setTimeout = (fn, delay) => {
    const id = nextId++
    timeouts.set(id, { fn, due: nowMs + (Number(delay) || 0) })
    return id
  }
  globalThis.clearTimeout = (id) => {
    timeouts.delete(id)
  }
}

const activePlaybackIntervals = () => [...intervals.values()].filter((i) => i.kind === 'interval')

/** Advance fake time, firing due timeouts and intervals. */
function runTimers(ms) {
  const end = nowMs + ms
  let guard = 0
  while (nowMs < end) {
    if (++guard > 100000) throw new Error('timer starvation')
    let next = end
    for (const t of timeouts.values()) if (t.due < next) next = t.due
    for (const i of intervals.values()) if (i.nextAt < next) next = i.nextAt
    if (next > nowMs) nowMs = next
    for (const [id, t] of [...timeouts]) {
      if (t.due <= nowMs) {
        timeouts.delete(id)
        t.fn()
      }
    }
    for (const [id, i] of [...intervals]) {
      if (i.nextAt <= nowMs) {
        i.nextAt = nowMs + i.every
        try {
          i.fn()
        } catch {
          /* the store may schedule analysis that needs DOM data; ignore here */
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Seeded PRNG                                                        */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const SEQUENCES = Number(flag('sequences', 5000))
const SEED = Number(flag('seed', 20261114))
const MAX_STEPS = Number(flag('max-steps', 30))

/* ------------------------------------------------------------------ */
/* Load the real store                                                 */
/* ------------------------------------------------------------------ */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireFromRepo = createRequire(new URL(`file://${REPO}/package.json`))
const viteEntry = requireFromRepo.resolve('vite')
const { createServer } = await import(pathToFileURL(viteEntry).href)
const vite = await createServer({
  root: REPO,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
})
const store = await vite.ssrLoadModule('/src/components/composables/useAppState.js')
const { state, actions } = store
await vite.close()
installFakeTimers()
await Promise.resolve()

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */
const rand = mulberry32(SEED)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const iso = (ms) => new Date(ms).toISOString()

function randomTime() {
  // anywhere inside a plausible mission window
  const base = Date.UTC(2026, 10, 1)
  return base + Math.floor(rand() * 60) * 24 * 3600 * 1000
}

const OPS = [
  { name: 'play', run: () => actions.startPlayback() },
  { name: 'pause', run: () => actions.stopPlayback() },
  { name: 'toggle', run: () => actions.togglePlayback() },
  { name: 'now', run: () => actions.setNow() },
  { name: 'shift+1h', run: () => actions.shiftTime(60) },
  { name: 'shift-1h', run: () => actions.shiftTime(-60) },
  { name: 'shift+1d', run: () => actions.shiftTime(1440) },
  { name: 'setTime', run: () => actions.setTime(iso(randomTime())) },
  { name: 'jump-sun', run: () => actions.jumpToEvent('sun') },
  { name: 'jump-earth', run: () => actions.jumpToEvent('earth') },
  { name: 'mission', run: () => actions.updateMission({ missionDays: 7 + Math.floor(rand() * 21) }) },
  { name: 'wait', run: () => runTimers(500 + Math.floor(rand() * 1500)) },
]

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */
const failures = []

function check(seq, step, opName) {
  const playing = Boolean(state.playback.playing)
  const count = activePlaybackIntervals().length
  const timeBefore = state.time
  runTimers(2000) // two seconds of simulated time
  const timeAfter = state.time
  runTimers(0)

  if (playing) {
    if (count !== 1) {
      failures.push({ invariant: 'I2', seq, step, op: opName, playing, intervals: count })
      return false
    }
    if (timeAfter === timeBefore) {
      // playing but time did not move: suspicious, record separately
      failures.push({ invariant: 'I2b', seq, step, op: opName, playing, intervals: count, note: 'playing but time frozen' })
      return false
    }
  } else {
    if (count !== 0) {
      failures.push({ invariant: 'I3', seq, step, op: opName, intervals: count, leaked: true })
      return false
    }
    if (timeAfter !== timeBefore) {
      failures.push({ invariant: 'I1', seq, step, op: opName, intervals: count, before: timeBefore, after: timeAfter })
      return false
    }
  }
  return true
}

function resetStore() {
  // Let the store clear its own clock handle first; deleting fake intervals
  // behind its back would leave the clock thinking it is still running.
  try {
    actions.stopPlayback()
  } catch {
    /* ignore */
  }
  for (const id of [...intervals.keys()]) intervals.delete(id)
  for (const id of [...timeouts.keys()]) timeouts.delete(id)
  state.playback.playing = false
  state.playback.speedMinutes = 20
  state.time = iso(nowMs)
}

const failingOps = []

function runSequence(ops) {
  resetStore()
  const seq = ops.map((o) => o.name)
  for (let step = 0; step < ops.length; step += 1) {
    const op = ops[step]
    try {
      op.run()
      runTimers(0)
      if (!check(seq, step, op.name)) {
        if (failingOps.length < 200) failingOps.push(ops)
        return false
      }
    } catch (error) {
      failures.push({ invariant: 'EXC', seq, step, op: op.name, error: String(error?.message || error) })
      if (failingOps.length < 200) failingOps.push(ops)
      return false
    }
  }
  return true
}

/* ------------------------------------------------------------------ */
/* 1) deterministic invariants                                         */
/* ------------------------------------------------------------------ */
const deterministic = []
function det(name, fn) {
  resetStore()
  try {
    const ok = fn()
    deterministic.push({ name, ok })
    if (!ok) failures.push({ invariant: 'DET', name })
  } catch (error) {
    deterministic.push({ name, ok: false, error: String(error?.message || error) })
    failures.push({ invariant: 'DET', name, error: String(error?.message || error) })
  }
}

det('start twice keeps one interval', () => {
  actions.startPlayback()
  actions.startPlayback()
  return activePlaybackIntervals().length === 1
})
det('toggle twice leaves stopped', () => {
  actions.togglePlayback()
  actions.togglePlayback()
  return state.playback.playing === false && activePlaybackIntervals().length === 0
})
det('setNow stops playback and clears the timer', () => {
  actions.startPlayback()
  runTimers(1000)
  actions.setNow()
  return state.playback.playing === false && activePlaybackIntervals().length === 0
})
det('stopPlayback clears the timer', () => {
  actions.startPlayback()
  actions.stopPlayback()
  return activePlaybackIntervals().length === 0
})

/* ------------------------------------------------------------------ */
/* 2) random sequences                                                 */
/* ------------------------------------------------------------------ */
let passing = 0
for (let n = 0; n < SEQUENCES; n += 1) {
  const length = 4 + Math.floor(rand() * (MAX_STEPS - 4))
  const ops = Array.from({ length }, () => pick(OPS))
  if (runSequence(ops)) passing += 1
}

/* ------------------------------------------------------------------ */
/* 3) targeted "play a lot with time changes" family                  */
/* ------------------------------------------------------------------ */
const targeted = []
const targetedTemplates = [
  ['play', 'now', 'play', 'pause', 'wait'],
  ['play', 'now', 'play', 'toggle', 'wait'],
  ['play', 'shift+1h', 'pause', 'wait'],
  ['play', 'shift-1h', 'play', 'pause', 'wait'],
  ['play', 'setTime', 'pause', 'wait'],
  ['play', 'now', 'now', 'pause', 'wait'],
  ['play', 'toggle', 'now', 'play', 'pause', 'wait'],
  ['play', 'shift+1d', 'shift-1h', 'pause', 'wait'],
  ['play', 'jump-sun', 'pause', 'wait'],
  ['play', 'mission', 'play', 'now', 'pause', 'wait'],
  ['now', 'play', 'now', 'pause', 'wait'],
  ['play', 'play', 'pause', 'wait'],
]
for (const names of targetedTemplates) {
  const ops = names.map((name) => OPS.find((o) => o.name === name))
  const ok = runSequence(ops)
  targeted.push({ sequence: names.join(' → '), ok })
  if (!ok) failures.push({ invariant: 'TARGETED', sequence: names.join(' → ') })
}

/* ------------------------------------------------------------------ */
/* Minimal reproducer (delta debugging on a failing sequence)          */
/* ------------------------------------------------------------------ */
function minimize(ops) {
  let current = ops.slice()
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < current.length; i += 1) {
      const candidate = current.slice(0, i).concat(current.slice(i + 1))
      if (candidate.length >= 2 && !runSequence(candidate) && failingOps.length >= 0) {
        // runSequence only returns false when the candidate fails; keep it
        current = candidate
        changed = true
        break
      }
    }
  }
  return current
}

const minimal = failingOps.length ? minimize(failingOps[0]) : []
const minimalNames = minimal.map((o) => o.name)

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */
mkdirSync(resolve(HERE, 'results'), { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  seed: SEED,
  sequences: SEQUENCES,
  maxSteps: MAX_STEPS,
  passing,
  failing: SEQUENCES - passing,
  deterministic,
  targeted,
  failureCount: failures.length,
  failingOpsSeen: failingOps.length,
  minimalReproducer: minimalNames.join(' → '),
  failuresByOp: failures.reduce((acc, f) => {
    const k = f.op || f.sequence || f.name || 'unknown'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {}),
  failuresByInvariant: failures.reduce((acc, f) => {
    acc[f.invariant] = (acc[f.invariant] || 0) + 1
    return acc
  }, {}),
  sampleFailures: failures.slice(0, 12),
}
const out = resolve(HERE, 'results', `playback-sim-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))

console.log('=== playback simulator ===')
console.log('sequences:', SEQUENCES, '| passing:', passing, '| failing:', SEQUENCES - passing)
console.log('deterministic:', deterministic.map((d) => `${d.name}=${d.ok ? 'PASS' : 'FAIL'}`).join(' · '))
console.log('minimal reproducer:', minimalNames.join(' → '))
console.log('failures by op:', JSON.stringify(report.failuresByOp))
console.log('targeted template failures:', targeted.filter((t) => !t.ok).length, '/', targeted.length)
console.log('failures by invariant:', JSON.stringify(report.failuresByInvariant))
for (const f of failures.slice(0, 8)) console.log('  FAIL', JSON.stringify(f))
console.log('report:', out)
process.exit(SEQUENCES - passing > 0 || deterministic.some((d) => !d.ok) ? 1 : 0)
