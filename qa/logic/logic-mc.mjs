#!/usr/bin/env node
/**
 * L-SEA Monte Carlo LOGIC harness (SPEC §3).
 *
 * Exercises the REAL scientific core (`src/core/index.js` barrel) and the real
 * data services (`lola`, `horizons`, `sites`) with a file-backed `fetchImpl`
 * over the read-only repository. Tens of thousands of deterministic, seeded
 * random scenarios are generated (site / date / mission / region / degraded
 * paths) and checked against the 13 `@inv/*` invariants.
 *
 * Usage:
 *   node logic-mc.mjs [--trials 20000] [--seed 20261114] [--case <n>]
 *                     [--profile full|quick] [--max-azimuths <n>]
 *                     [--region both|hi|wide] [--tag <t>]... [--exclude-tag <t>]...
 *                     [--workers <n>] [--chunk <n>] [--out <path>] [--quiet]
 *
 * Results: qa/results/logic-mc-<utcstamp>.json and .md
 *
 * @module logic/logic-mc
 */
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { cpus } from 'node:os'
import { Worker } from 'node:worker_threads'

import { createFileFetch } from './lib/file-fetch.mjs'
import { INVARIANTS, TOLERANCES, runCase } from './lib/checks.mjs'
import { generateScenario } from './lib/scenario.mjs'

const LOGIC_DIR = dirname(new URL(import.meta.url).pathname)
const QA_DIR = resolve(LOGIC_DIR, '..')
const RESULT_DIR = join(QA_DIR, 'results')
const TAGS_FILE = join(QA_DIR, 'tags.json')

const DEFAULT_SEED = 20261114
const DEFAULT_TRIALS = 20000
const AZIMUTHS = { full: 72, quick: 36 }

// ----------------------------------------------------------------- CLI parsing
function parseArgs(argv) {
  const opts = {
    trials: DEFAULT_TRIALS,
    seed: DEFAULT_SEED,
    case: null,
    profile: 'full',
    maxAzimuths: null,
    region: 'both',
    tag: [],
    excludeTag: [],
    workers: null,
    chunk: 100,
    out: null,
    quiet: false,
    help: false,
  }
  const valueFor = (flag, i) => {
    const next = argv[i + 1]
    if (next === undefined || String(next).startsWith('--')) throw new Error(`${flag} needs a value`)
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--trials') opts.trials = Number(valueFor(arg, i++))
    else if (arg === '--seed') opts.seed = Number(valueFor(arg, i++))
    else if (arg === '--case') opts.case = Number(valueFor(arg, i++))
    else if (arg === '--profile') opts.profile = valueFor(arg, i++)
    else if (arg === '--max-azimuths') opts.maxAzimuths = Number(valueFor(arg, i++))
    else if (arg === '--region') opts.region = valueFor(arg, i++)
    else if (arg === '--tag') opts.tag.push(valueFor(arg, i++))
    else if (arg === '--exclude-tag') opts.excludeTag.push(valueFor(arg, i++))
    else if (arg === '--workers') opts.workers = Number(valueFor(arg, i++))
    else if (arg === '--chunk') opts.chunk = Number(valueFor(arg, i++))
    else if (arg === '--out') opts.out = valueFor(arg, i++)
    else if (arg === '--quiet') opts.quiet = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isFinite(opts.seed) || opts.seed <= 0) throw new Error('--seed must be a positive integer')
  if (!Number.isFinite(opts.trials) || opts.trials < 1) throw new Error('--trials must be >= 1')
  if (opts.case !== null && (!Number.isInteger(opts.case) || opts.case < 0)) throw new Error('--case must be a non-negative integer')
  if (!['full', 'quick'].includes(opts.profile)) throw new Error("--profile must be 'full' or 'quick'")
  if (!['both', 'hi', 'wide'].includes(opts.region)) throw new Error("--region must be 'both', 'hi' or 'wide'")
  return opts
}

function usage() {
  console.log(`L-SEA Monte Carlo logic harness

  --trials <n>          number of random scenarios (default ${DEFAULT_TRIALS})
  --seed <n>            PRNG seed (default ${DEFAULT_SEED})
  --case <n>            reproduce exactly one case index (uses --seed)
  --profile full|quick  azimuth profile: full=72, quick=36 (default full)
  --max-azimuths <n>    explicit azimuth sample count (overrides --profile)
  --region both|hi|wide site sampling region (default both)
  --tag <t>             include filter (repeatable, AND)
  --exclude-tag <t>     exclude filter (repeatable, ANY)
  --workers <n>         worker threads (default: min(10, cpu-2))
  --chunk <n>           cases per work chunk (default 100)
  --out <path>          JSON output path (default results/logic-mc-<utcstamp>.json)
  --quiet               suppress progress output
  --help                show this help`)
}

// ------------------------------------------------------------------ utilities
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null)
const pct = (value) => (Number.isFinite(value) ? Number((value * 100).toFixed(1)) : null)

function gitInfo(repo) {
  const run = (args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return { gitSha: run(['rev-parse', 'HEAD']), gitCommitDate: run(['show', '-s', '--format=%cI', 'HEAD']) }
  } catch {
    return { gitSha: null, gitCommitDate: null }
  }
}

function loadTagNamespaces() {
  try {
    const taxonomy = JSON.parse(readFileSync(TAGS_FILE, 'utf8'))
    const staticTags = new Set()
    for (const [namespace, definition] of Object.entries(taxonomy.namespaces ?? {})) {
      if (definition && Array.isArray(definition.values)) {
        for (const value of definition.values) staticTags.add(value)
      }
      // namespace names themselves are not tags
      void namespace
    }
    return { taxonomy, staticTags }
  } catch {
    return { taxonomy: null, staticTags: new Set() }
  }
}

function validateTags(tags, staticTags, invalid) {
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('@')) {
      invalid.add(String(tag))
      continue
    }
    if (staticTags.has(tag)) continue
    if (tag.startsWith('@seed/') || tag.startsWith('@res/') || tag.startsWith('@dpr/')) continue
    invalid.add(tag)
  }
}

function applyFilters(tags, includeTags, excludeTags) {
  if (includeTags.length > 0 && !includeTags.every((tag) => tags.includes(tag))) return false
  if (excludeTags.length > 0 && excludeTags.some((tag) => tags.includes(tag))) return false
  return true
}

function newSummary() {
  return {
    cases: 0,
    filteredOut: 0,
    passed: 0,
    failed: 0,
    warned: 0,
    byInvariant: Object.fromEntries(INVARIANTS.map((tag) => [tag, { pass: 0, fail: 0, warn: 0, skip: 0, total: 0 }])),
    byFeature: {},
    byStatus: { pass: 0, fail: 0, warn: 0, skip: 0 },
    byRegion: {},
    byEdge: {},
    byDegraded: {},
    durationsMs: [],
    failures: [],
  }
}

function aggregate(summary, result) {
  summary.cases++
  if (result.status === 'pass') summary.passed++
  else if (result.status === 'fail') summary.failed++
  else if (result.status === 'warn') summary.warned++
  for (const check of result.checks) {
    const bucket = summary.byInvariant[check.tag] ?? (summary.byInvariant[check.tag] = { pass: 0, fail: 0, warn: 0, skip: 0, total: 0 })
    bucket[check.status] = (bucket[check.status] ?? 0) + 1
    bucket.total++
    summary.byStatus[check.status] = (summary.byStatus[check.status] ?? 0) + 1
  }
  for (const tag of result.tags) {
    if (tag.startsWith('@feature/')) {
      const bucket = summary.byFeature[tag] ?? (summary.byFeature[tag] = { pass: 0, fail: 0, warn: 0, total: 0 })
      bucket[result.status === 'pass' ? 'pass' : result.status === 'fail' ? 'fail' : 'warn']++
      bucket.total++
    }
  }
  const region = result.inputs.regionId ?? 'none'
  summary.byRegion[region] = (summary.byRegion[region] ?? 0) + 1
  for (const edge of result.inputs.edge ?? []) summary.byEdge[edge] = (summary.byEdge[edge] ?? 0) + 1
  summary.byDegraded[result.inputs.degraded ?? 'none'] = (summary.byDegraded[result.inputs.degraded ?? 'none'] ?? 0) + 1
  summary.durationsMs.push(result.durationMs)
  if (result.status === 'fail' && summary.failures.length < 100) {
    summary.failures.push({
      index: result.index,
      caseSeed: result.caseSeed,
      failedInvariants: result.failedInvariants,
      tags: result.tags.filter((tag) => tag.startsWith('@inv/') || tag.startsWith('@feature/')),
      inputs: result.inputs,
      details: result.checks.filter((check) => check.status === 'fail').map((check) => ({ tag: check.tag, detail: check.detail })),
      repro: `node logic-mc.mjs --seed ${result.tags.find((t) => t.startsWith('@seed/'))?.slice(6)} --case ${result.index}`,
    })
  }
}

function finalizeSummary(summary, durationMs, workers, chunkSize, opts, azCount) {
  const durations = summary.durationsMs
  const sorted = [...durations].sort((a, b) => a - b)
  const percentile = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null)
  const byInvariant = {}
  for (const [tag, bucket] of Object.entries(summary.byInvariant)) {
    const checks = bucket.pass + bucket.fail + bucket.warn + bucket.skip
    byInvariant[tag] = {
      ...bucket,
      checks,
      passRate: checks - bucket.skip > 0 ? pct(bucket.pass / (checks - bucket.skip)) : null,
      failRate: checks > 0 ? pct(bucket.fail / checks) : null,
    }
  }
  return {
    cases: summary.cases,
    filteredOut: summary.filteredOut,
    passed: summary.passed,
    failed: summary.failed,
    warned: summary.warned,
    byInvariant,
    byFeature: summary.byFeature,
    byStatus: summary.byStatus,
    byRegion: summary.byRegion,
    byEdge: summary.byEdge,
    byDegraded: summary.byDegraded,
    failures: summary.failures,
    durationMs,
    caseDurationMs: {
      min: round(sorted[0]),
      p50: round(percentile(0.5)),
      p90: round(percentile(0.9)),
      max: round(sorted[sorted.length - 1]),
      mean: round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)),
    },
    rateCasesPerSecond: round(summary.cases / Math.max(0.001, durationMs / 1000)),
    trialsPerSecondPerWorker: round(summary.cases / Math.max(0.001, durationMs / 1000) / workers),
    workers,
    chunkSize,
    azimuths: azCount,
    profile: opts.profile,
    region: opts.region,
    seed: opts.seed,
    trials: opts.trials,
    filters: { include: opts.tag, exclude: opts.excludeTag },
    tolerances: TOLERANCES,
  }
}

// ------------------------------------------------------------------ data load
async function loadData(repo) {
  const fetchImpl = createFileFetch(repo)
  const dataRoot = '/data/'
  const core = await import(`${repo}/src/core/index.js`)
  const lola = await import(`${repo}/src/services/lola.js`)
  const sitesService = await import(`${repo}/src/services/sites.js`)
  const horizons = await import(`${repo}/src/services/horizons.js`)
  const [pois, terrains, ephemIndex] = await Promise.all([
    sitesService.loadSites({ fetchImpl, dataRoot }),
    lola.loadTerrainRegions({ fetchImpl, dataRoot }),
    horizons.loadEphemerisIndex({ fetchImpl, dataRoot }),
  ])
  const ephemerisBySite = await horizons.loadEphemerisMap(
    pois.map((poi) => poi.id),
    { fetchImpl, dataRoot },
  )
  const range =
    ephemIndex?.range ??
    (() => {
      const first = ephemerisBySite.values().next().value
      const datasetRange = first ? core.datasetRange(first) : null
      return { start: datasetRange?.startTime, end: datasetRange?.endTime }
    })()
  return { core, pois, terrains, ephemerisBySite, ephemerisRange: range, dataRoot, fetchImpl }
}

// --------------------------------------------------------------------- output
async function writeJsonAtomic(outPath, meta, summary, tempCasesFile) {
  const output = createWriteStream(outPath)
  const write = (text) =>
    new Promise((resolveWrite, rejectWrite) => {
      output.write(text, (error) => (error ? rejectWrite(error) : resolveWrite()))
    })
  await write(`{"meta":${JSON.stringify(meta)},"summary":${JSON.stringify(summary)},"cases":[`)
  let first = true
  if (existsSync(tempCasesFile)) {
    const lines = createInterface({ input: createReadStream(tempCasesFile, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line) continue
      await write(`${first ? '' : ','}${line}`)
      first = false
    }
  }
  await write(']}\n')
  await new Promise((resolveEnd, rejectEnd) => {
    output.end(() => resolveEnd())
    output.once('error', rejectEnd)
  })
}

function writeMarkdown(mdPath, meta, summary) {
  const lines = []
  const inv = summary.byInvariant
  lines.push('# L-SEA Monte Carlo logic run — summary', '')
  lines.push(`- **Generated:** ${meta.generatedAt} (UTC)`)
  lines.push(`- **Repository:** \`${meta.repo}\` @ \`${meta.gitSha ?? 'unknown'}\` (${meta.gitCommitDate ?? 'date unknown'})`)
  lines.push(`- **Seed:** ${meta.seed} — **trials:** ${summary.cases} — **profile:** ${summary.profile} (${summary.azimuths} azimuths) — **region:** ${summary.region}`)
  lines.push(`- **Workers/chunks:** ${summary.workers} / ${summary.chunkSize} cases per chunk`)
  lines.push(`- **Wall time:** ${(summary.durationMs / 1000).toFixed(2)} s (${summary.rateCasesPerSecond} cases/s)`)
  lines.push(`- **Case time:** mean ${summary.caseDurationMs.mean} ms, p50 ${summary.caseDurationMs.p50} ms, p90 ${summary.caseDurationMs.p90} ms, max ${summary.caseDurationMs.max} ms`)
  lines.push(`- **Filters:** include=${JSON.stringify(summary.filters.include)} exclude=${JSON.stringify(summary.filters.exclude)}`)
  lines.push(`- **Result:** ${summary.failed === 0 ? 'PASS — 0 invariant failures' : `FAIL — ${summary.failed} failing case(s)`}, ${summary.warned} warning case(s), ${summary.filteredOut} filtered out`)
  lines.push('')
  lines.push('## Failures by invariant')
  lines.push('')
  lines.push('| Invariant tag | pass | fail | warn | skip | fail rate |')
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const tag of INVARIANTS) {
    const bucket = inv[tag] ?? { pass: 0, fail: 0, warn: 0, skip: 0, failRate: null }
    lines.push(`| ${tag} | ${bucket.pass} | ${bucket.fail} | ${bucket.warn} | ${bucket.skip} | ${bucket.failRate ?? '—'} % |`)
  }
  lines.push('')
  lines.push('## Cases by feature tag')
  lines.push('')
  lines.push('| Feature tag | cases | pass | fail | warn |')
  lines.push('| --- | ---: | ---: | ---: | ---: |')
  for (const [tag, bucket] of Object.entries(summary.byFeature).sort()) {
    lines.push(`| ${tag} | ${bucket.total} | ${bucket.pass} | ${bucket.fail} | ${bucket.warn} |`)
  }
  lines.push('')
  lines.push('## Coverage')
  lines.push('')
  lines.push(`- **By region:** ${Object.entries(summary.byRegion).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`)
  lines.push(`- **By degraded path:** ${Object.entries(summary.byDegraded).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  lines.push(`- **Edge tags:** ${Object.entries(summary.byEdge).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  lines.push(`- **Status:** pass=${summary.byStatus.pass}, fail=${summary.byStatus.fail}, warn=${summary.byStatus.warn}, skip=${summary.byStatus.skip}`)
  lines.push('')
  if (summary.failures.length > 0) {
    lines.push('## Reproducible failures')
    lines.push('')
    summary.failures.forEach((failure, i) => {
      lines.push(`### ${i + 1}. case ${failure.index} — ${failure.failedInvariants.join(', ')}`)
      lines.push('')
      lines.push('```bash')
      lines.push(failure.repro)
      lines.push('```')
      lines.push('')
      lines.push(`Inputs: \`${JSON.stringify(failure.inputs)}\``)
      lines.push('')
      for (const detail of failure.details) lines.push(`- **${detail.tag}**: ${detail.detail}`)
      lines.push('')
    })
  } else {
    lines.push('## Reproducible failures', '', 'None — all invariant checks passed.', '')
  }
  lines.push('## Notes', '')
  lines.push('- The harness imports the real `src/core/index.js` barrel and real services (`lola`, `horizons`, `sites`) with a file-backed fetch over the read-only repo.')
  lines.push('- Every case is generated from `seed` + `index` only, so a single case is reproducible with `--seed <seed> --case <index>` without replaying earlier cases.')
  lines.push('- `--tag` is AND (all include tags must be present); `--exclude-tag` drops a case if ANY exclude tag is present; `@status/*` tags are attached to results.')
  writes(mdPath, lines)
}

function writes(path, lines) {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, lines.join('\n') + '\n')
  } finally {
    closeSync(fd)
  }
}

// -------------------------------------------------------------------- runners
function createScenarioFactory(data, opts, azCount) {
  return (index) =>
    generateScenario({
      index,
      seed: opts.seed,
      core: data.core,
      terrainRegions: data.terrains,
      pois: data.pois,
      ephemerisRange: { start: data.ephemerisRange.start, end: data.ephemerisRange.end },
      azCount,
      region: opts.region,
    })
}

async function runWithWorkers(data, opts, azCount, outBase) {
  const repoSlash = data.repo
  const totalTrials = opts.trials
  const chunkSize = Math.max(1, opts.chunk)
  const workersCount = opts.workers ?? Math.max(1, Math.min(10, cpus().length - 2))
  const generate = createScenarioFactory(data, opts, azCount)
  const summary = newSummary()
  const tempCasesFile = `${outBase}.cases.ndjson`
  mkdirSync(dirname(tempCasesFile), { recursive: true })
  const tempFd = openSync(tempCasesFile, 'w')

  const invalidTags = new Set()
  const workers = []
  const started = performance.now()
  const totalChunks = Math.ceil(totalTrials / chunkSize)
  let nextChunk = 0
  let nextWrite = 0
  const pending = new Map()

  const writeCases = (results) => {
    for (const result of results) {
      validateTags(result.tags, data.staticTags, invalidTags)
      if (!applyFilters(result.tags, opts.tag, opts.excludeTag)) {
        summary.filteredOut++
        continue
      }
      writeSync(tempFd, JSON.stringify(result) + '\n')
      aggregate(summary, result)
    }
  }
  const flush = () => {
    while (pending.has(nextWrite)) {
      writeCases(pending.get(nextWrite))
      pending.delete(nextWrite)
      nextWrite++
    }
  }

  const spawned = Array.from({ length: workersCount }, () => {
    const worker = new Worker(new URL('./logic-worker.mjs', import.meta.url), {
      workerData: { repo: repoSlash, dataRoot: data.dataRoot },
    })
    return worker
  })
  const ready = await Promise.all(
    spawned.map(
      (worker) =>
        new Promise((resolveReady, rejectReady) => {
          worker.once('message', (message) => {
            if (message.type === 'ready') resolveReady(message)
            else rejectReady(new Error(`unexpected worker message ${message.type}`))
          })
          worker.once('error', rejectReady)
        }),
    ),
  )

  const callWorker = (worker, jobId, scenarios) =>
    new Promise((resolveCall, rejectCall) => {
      const onMessage = (message) => {
        if (message.type !== 'done' || message.jobId !== jobId) return
        worker.off('message', onMessage)
        worker.off('error', onError)
        resolveCall(message.results)
      }
      const onError = (error) => {
        worker.off('message', onMessage)
        rejectCall(error)
      }
      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.postMessage({ type: 'work', jobId, scenarios })
    })

  let progressAt = 0
  const loop = async (worker) => {
    for (;;) {
      const chunkIndex = nextChunk++
      if (chunkIndex >= totalChunks) return
      const first = chunkIndex * chunkSize
      const scenarios = []
      for (let i = first; i < Math.min(first + chunkSize, totalTrials); i++) scenarios.push(generate(i))
      const results = await callWorker(worker, chunkIndex, scenarios)
      pending.set(chunkIndex, results)
      flush()
      if (!opts.quiet && summary.cases - progressAt >= 2000) {
        progressAt = summary.cases
        const elapsed = (performance.now() - started) / 1000
        process.stderr.write(`  progress: ${summary.cases}/${totalTrials} cases (${(summary.cases / elapsed).toFixed(0)} cases/s)\n`)
      }
    }
  }

  try {
    await Promise.all(spawned.map((worker) => loop(worker)))
  } finally {
    await Promise.all(spawned.map((worker) => worker.terminate()))
    closeSync(tempFd)
  }
  const durationMs = performance.now() - started
  await Promise.all(ready) // keep reference; workers already reported their data
  return {
    summary,
    durationMs,
    workersCount,
    chunkSize,
    tempCasesFile,
    invalidTags,
    workerMeta: ready,
  }
}

async function runSingleCase(data, opts, azCount) {
  const generate = createScenarioFactory(data, opts, azCount)
  const scenario = generate(opts.case)
  const terrain =
    scenario.degraded === 'no-terrain' || scenario.degraded === 'both'
      ? null
      : data.terrains.find((t) => t.id === scenario.regionId) ??
        data.terrains.find((t) => data.core.isInsideTerrain(t, scenario.site.lat, scenario.site.lon)) ??
        null
  const dataset =
    scenario.degraded === 'no-ephemeris' || scenario.degraded === 'both'
      ? null
      : data.ephemerisBySite.get(scenario.datasetSiteId) ?? null
  const started = performance.now()
  const result = runCase({
    core: data.core,
    scenario,
    terrain,
    terrains: data.terrains,
    dataset,
    pois: data.pois,
    ephemerisBySite: data.ephemerisBySite,
  })
  const durationMs = performance.now() - started
  return { scenario, result, durationMs }
}

// ----------------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }
  const repo = resolve(LOGIC_DIR, '../..') + '/'
  const repoGit = repo.replace(/\/$/, '')
  const azCount = opts.maxAzimuths ?? AZIMUTHS[opts.profile]
  if (!Number.isFinite(azCount) || azCount < 4) throw new Error('azimuth count must be >= 4')
  if (!existsSync(join(repo, 'src/core/index.js'))) throw new Error(`repository not found at ${repo}`)
  const { staticTags } = loadTagNamespaces()
  const data = await loadData(repo)
  data.repo = repo
  data.staticTags = staticTags
  if (data.terrains.length === 0 || data.pois.length === 0 || data.ephemerisBySite.size === 0) {
    throw new Error('datasets unavailable: the harness needs terrains, POIs and ephemerides in public/data/')
  }
  const git = gitInfo(repoGit)
  const startedAt = new Date().toISOString()
  const t0 = performance.now()

  if (opts.case !== null) {
    const { scenario, result, durationMs } = await runSingleCase(data, opts, azCount)
    const meta = {
      runner: 'logic-mc',
      version: 1,
      mode: 'case',
      generatedAt: new Date().toISOString(),
      repo: repoGit,
      ...git,
      node: process.version,
      platform: process.platform,
      seed: opts.seed,
      case: opts.case,
      azimuths: azCount,
      profile: opts.profile,
      region: opts.region,
      invariants: INVARIANTS,
      tolerances: TOLERANCES,
      tagsFile: TAGS_FILE,
      taxonomyLoaded: staticTags.size > 0,
    }
    const outBase =
      opts.out ?? join(RESULT_DIR, `logic-mc-case-${opts.case}-seed-${opts.seed}`)
    mkdirSync(dirname(outBase), { recursive: true })
    writes(`${outBase}.json`, [JSON.stringify({ meta, case: result }, null, 2)])
    const failed = result.checks.filter((check) => check.status === 'fail')
    console.log(
      JSON.stringify(
        {
          case: opts.case,
          seed: opts.seed,
          caseSeed: scenario.caseSeed,
          scenario,
          status: result.status,
          failedInvariants: result.failedInvariants,
          checks: result.checks,
          durationMs: round(durationMs),
          repro: `node logic-mc.mjs --seed ${opts.seed} --case ${opts.case}`,
          file: `${outBase}.json`,
        },
        null,
        2,
      ),
    )
    if (failed.length > 0) process.exitCode = 1
    return
  }

  const outPath = opts.out ?? join(RESULT_DIR, `logic-mc-${stamp()}.json`)
  const mdPath = outPath.replace(/\.json$/, '.md')
  mkdirSync(dirname(outPath), { recursive: true })
  const run = await runWithWorkers(data, opts, azCount, outPath.replace(/\.json$/, ''))
  const durationMs = performance.now() - t0
  const summary = finalizeSummary(
    run.summary,
    round(durationMs),
    run.workersCount,
    run.chunkSize,
    opts,
    azCount,
  )
  const meta = {
    runner: 'logic-mc',
    version: 1,
    mode: 'batch',
    generatedAt: new Date().toISOString(),
    startedAt,
    repo: repoGit,
    ...git,
    node: process.version,
    platform: process.platform,
    seed: opts.seed,
    trialsRequested: opts.trials,
    azimuths: azCount,
    profile: opts.profile,
    region: opts.region,
    workers: run.workersCount,
    chunkSize: run.chunkSize,
    invariants: INVARIANTS,
    tolerances: TOLERANCES,
    tagsFile: TAGS_FILE,
    taxonomyLoaded: staticTags.size > 0,
    invalidTags: [...run.invalidTags],
    workerMeta: run.workerMeta,
    data: {
      pois: data.pois.length,
      terrains: data.terrains.map((terrain) => terrain.id),
      ephemerides: data.ephemerisBySite.size,
      ephemerisRange: data.ephemerisRange,
    },
    filtersApplied: true,
  }
  await writeJsonAtomic(outPath, meta, summary, run.tempCasesFile)
  try {
    unlinkSync(run.tempCasesFile)
  } catch {
    /* temp file already gone */
  }
  writeMarkdown(mdPath, meta, summary)
  if (!opts.quiet) {
    console.log(`\nL-SEA logic Monte Carlo — ${summary.cases} cases in ${(summary.durationMs / 1000).toFixed(2)} s (${summary.rateCasesPerSecond} cases/s)`)
    console.log(`seed=${opts.seed} profile=${summary.profile} azimuths=${summary.azimuths} workers=${run.workersCount} region=${summary.region}`)
    console.log(`status: pass=${summary.passed} fail=${summary.failed} warn=${summary.warned} filteredOut=${summary.filteredOut}`)
    for (const tag of INVARIANTS) {
      const bucket = summary.byInvariant[tag]
      console.log(`  ${tag.padEnd(32)} pass=${bucket.pass} fail=${bucket.fail} warn=${bucket.warn} skip=${bucket.skip}`)
    }
    console.log(`json: ${outPath}`)
    console.log(`md:   ${mdPath}`)
  }
  if (summary.failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[logic-mc] fatal: ${error?.stack ?? error}`)
  process.exit(1)
})
