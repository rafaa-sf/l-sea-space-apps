#!/usr/bin/env node
/**
 * Autopilot / ranking Monte Carlo.
 *
 * Exercises the REAL `scoreSite()` and `rankSites()` (src/core/autopilot.js) over
 * the real NASA datasets (POIs, LOLA DEMs, JPL Horizons ephemerides) with a
 * matrix of mission needs:
 *
 *   baseline, comms-heavy, comms-extreme, relay, power-heavy, power-extreme,
 *   sun-hungry, short/long missions and a multi-need profile.
 *
 * For every date it ranks the ten curated sites under each profile and checks:
 *   - score/component/confidence validity, ordering and rank contiguity
 *   - determinism (same inputs → same ranking)
 *   - monotonic response to harder needs (sun/power/comms components must not
 *     increase when the corresponding need increases; relay must not reduce
 *     connectivity)
 *   - ranking responsiveness (top-1 changes, rank correlation vs baseline)
 *   - score saturation and ties (quantisation to 0.1 makes ties possible)
 *   - degenerate missions (zero/huge needs, 1-hour mission) and invalid sites
 *
 * Usage:
 *   node qa/autopilot/autopilot-mc.mjs [--dates 6] [--seed 20261114] [--out <dir>]
 *
 * @module qa/autopilot/autopilot-mc
 */
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createFileFetch } from '../logic/lib/file-fetch.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, '..', '..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DATES = Number(arg('dates', 6))
const SEED = Number(arg('seed', 20261114))
const OUT = resolve(String(arg('out', resolve(HERE, 'results'))))
// Quick profile for throughput: coarse horizon sampling + 1 h mission step
// (the shipped app uses 1° / 300 s; pass --quick false for the app defaults).
const QUICK = arg('quick', 'true') !== 'false'
const QUICK_MISSION = QUICK ? { profileStepDeg: 30, stepSeconds: 3600 } : {}

const PROFILES = [
  { name: 'baseline', mission: {} },
  { name: 'comms-low', mission: { dataNeedMb: 500 } },
  { name: 'comms-heavy', mission: { dataNeedMb: 6_000 } },
  { name: 'comms-extreme', mission: { dataNeedMb: 40_000 } },
  { name: 'relay', mission: { dataNeedMb: 6_000, relayInOrbit: true } },
  { name: 'power-heavy', mission: { powerNeedW: 600, panelAreaM2: 1.5 } },
  { name: 'power-extreme', mission: { powerNeedW: 2_000, panelAreaM2: 1.0 } },
  { name: 'sun-hungry', mission: { sunDaysNeeded: 20 } },
  { name: 'short-mission', mission: { missionDays: 3 } },
  { name: 'long-mission', mission: { missionDays: 28 } },
  { name: 'multi-need', mission: { missionDays: 28, powerNeedW: 1_200, sunDaysNeeded: 18, dataNeedMb: 15_000, mastM: 15 } },
]

const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const spearman = (a, b) => {
  // a, b: arrays of numbers; average ranks for ties.
  const rank = (arr) => {
    const idx = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v)
    const out = new Array(arr.length)
    for (let i = 0; i < idx.length; ) {
      let j = i
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j += 1
      const r = (i + j) / 2 + 1
      for (let k = i; k <= j; k += 1) out[idx[k].i] = r
      i = j + 1
    }
    return out
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const mean = (n + 1) / 2
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    num += (ra[i] - mean) * (rb[i] - mean)
    da += (ra[i] - mean) ** 2
    db += (rb[i] - mean) ** 2
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1
}

async function loadData() {
  const fetchImpl = createFileFetch(REPO)
  const dataRoot = '/data/'
  const core = await import(`${REPO}/src/core/index.js`)
  const lola = await import(`${REPO}/src/services/lola.js`)
  const sites = await import(`${REPO}/src/services/sites.js`)
  const horizons = await import(`${REPO}/src/services/horizons.js`)
  const [pois, terrains, index] = await Promise.all([
    sites.loadSites({ fetchImpl, dataRoot }),
    lola.loadTerrainRegions({ fetchImpl, dataRoot }),
    horizons.loadEphemerisIndex({ fetchImpl, dataRoot }),
  ])
  const ephemerisBySite = await horizons.loadEphemerisMap(pois.map((p) => p.id), { fetchImpl, dataRoot })
  const range = index?.range ?? {
    start: core.datasetRange(ephemerisBySite.values().next().value)?.startTime,
    end: core.datasetRange(ephemerisBySite.values().next().value)?.endTime,
  }
  return { core, pois, terrains, ephemerisBySite, range }
}

function startDates(range, count) {
  const startMs = Date.parse(range.start)
  const endMs = Date.parse(range.end)
  const span = endMs - startMs
  const dates = []
  for (let i = 0; i < count; i += 1) {
    // keep the mission inside the ephemeris: start early enough for a 28-day window
    const offset = (span - 30 * 86400_000) * (i / Math.max(1, count - 1)) + 86400_000
    const ms = startMs + Math.max(0, offset)
    const d = new Date(ms)
    d.setUTCHours(12, 0, 0, 0)
    dates.push(d.toISOString())
  }
  return dates
}

async function main() {
  const { core, pois, terrains, ephemerisBySite, range } = await loadData()
  const dates = startDates(range, DATES)
  const failures = []
  const weaknesses = []
  const run = []

  // ---------------------------------------------------------------- rankings
  for (const profile of PROFILES) {
    console.log('profile:', profile.name)
    for (const startTime of dates) {
      const mission = { ...QUICK_MISSION, ...profile.mission, startTime }
      const entries = core.rankSites({ sites: pois, terrain: terrains, ephemeris: ephemerisBySite, mission })
      const scored = entries.filter((e) => e.score != null)
      const record = {
        profile: profile.name,
        startTime,
        top: scored[0]?.siteId ?? null,
        topScore: scored[0]?.score ?? null,
        order: scored.map((e) => e.siteId),
        scores: Object.fromEntries(scored.map((e) => [e.siteId, e.score])),
        components: Object.fromEntries(scored.map((e) => [e.siteId, e.components])),
        metrics: Object.fromEntries(
          scored.map((e) => [e.siteId, { averageW: e.metrics.averageW, earthVisibleFraction: e.metrics.earthVisibleFraction }]),
        ),
        ranks: Object.fromEntries(scored.map((e) => [e.siteId, e.rank])),
        ties: 0,
        maxTieGroup: 1,
      }
      run.push(record)

      // validity + ordering
      if (scored.length !== pois.length) failures.push({ profile: profile.name, startTime, kind: 'not-all-scored', detail: `${scored.length}/${pois.length}` })
      scored.forEach((e, i) => {
        if (!Number.isFinite(e.score) || e.score < 0 || e.score > 100) failures.push({ profile: profile.name, startTime, kind: 'score-range', detail: `${e.siteId}=${e.score}` })
        if (!Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1) failures.push({ profile: profile.name, startTime, kind: 'confidence', detail: `${e.siteId}=${e.confidence}` })
        for (const [k, v] of Object.entries(e.components || {})) {
          if (!Number.isFinite(v) || v < 0 || v > 100) failures.push({ profile: profile.name, startTime, kind: 'component-range', detail: `${e.siteId}.${k}=${v}` })
        }
        if (e.rank !== i + 1) failures.push({ profile: profile.name, startTime, kind: 'rank-order', detail: `${e.siteId} rank ${e.rank} at position ${i + 1}` })
        if (i > 0 && scored[i - 1].score < e.score) failures.push({ profile: profile.name, startTime, kind: 'sort-order', detail: `${scored[i - 1].siteId} < ${e.siteId}` })
      })

      // ties (scores are rounded to 0.1)
      const counts = new Map()
      for (const e of scored) counts.set(e.score, (counts.get(e.score) ?? 0) + 1)
      record.ties = [...counts.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0)
      record.maxTieGroup = Math.max(1, ...counts.values())
    }
  }

  // determinism: rerun one ranking twice
  const detMission = { ...QUICK_MISSION, startTime: dates[0] }
  const a = core.rankSites({ sites: pois, terrain: terrains, ephemeris: ephemerisBySite, mission: detMission })
  const b = core.rankSites({ sites: pois, terrain: terrains, ephemeris: ephemerisBySite, mission: detMission })
  const detEqual = JSON.stringify(a.map((e) => [e.siteId, e.score, e.rank])) === JSON.stringify(b.map((e) => [e.siteId, e.score, e.rank]))
  if (!detEqual) failures.push({ kind: 'determinism', detail: 'rankSites differs between identical runs' })

  // ------------------------------------------------ need-sensitivity checks
  const byKey = new Map(run.map((r) => [`${r.profile}|${r.startTime}`, r]))
  const sensitivity = {
    sun: { checked: 0, violations: [] },
    power: { checked: 0, violations: [] },
    comms: { checked: 0, violations: [] },
    relay: { checked: 0, violations: [] },
  }
  for (const startTime of dates) {
    const base = byKey.get(`baseline|${startTime}`)
    if (!base) continue
    for (const site of pois) {
      const baseComps = base.components[site.id]
      if (!baseComps) continue
      // Higher sun requirement, same mission window: the sun component must not improve.
      const sun = byKey.get(`sun-hungry|${startTime}`).components[site.id]
      sensitivity.sun.checked += 1
      if (sun && sun.sun > baseComps.sun + 0.05) sensitivity.sun.violations.push({ site: site.id, base: baseComps.sun, value: sun.sun })
      // Higher power requirement: the power component must not improve.
      const power = byKey.get(`power-extreme|${startTime}`).components[site.id]
      sensitivity.power.checked += 1
      if (power && power.power > baseComps.power + 0.05) sensitivity.power.violations.push({ site: site.id, base: baseComps.power, value: power.power })
      // Higher data requirement: compare equal-mission profiles (500 MB vs 40 GB).
      const commsLow = byKey.get(`comms-low|${startTime}`).components[site.id]
      const commsExtreme = byKey.get(`comms-extreme|${startTime}`).components[site.id]
      sensitivity.comms.checked += 1
      if (commsLow && commsExtreme && commsExtreme.comms > commsLow.comms + 0.05) sensitivity.comms.violations.push({ site: site.id, base: commsLow.comms, value: commsExtreme.comms })
      // Relay must never reduce connectivity vs direct-to-Earth with the same data need.
      const relay = byKey.get(`relay|${startTime}`).components[site.id]
      const direct = byKey.get(`comms-heavy|${startTime}`).components[site.id]
      sensitivity.relay.checked += 1
      if (relay && direct && relay.comms < direct.comms - 0.05) sensitivity.relay.violations.push({ site: site.id, base: direct.comms, value: relay.comms })
    }
  }
  for (const [name, s] of Object.entries(sensitivity)) {
    if (s.violations.length) failures.push({ kind: `sensitivity-${name}`, detail: `${s.violations.length}/${s.checked} violations`, examples: s.violations.slice(0, 3) })
  }

  // ------------------------------------------ ranking responsiveness + stats
  const top1Changes = {}
  const spearmanVsBaseline = {}
  for (const startTime of dates) {
    const base = byKey.get(`baseline|${startTime}`)
    if (!base) continue
    for (const profile of PROFILES) {
      if (profile.name === 'baseline') continue
      const rec = byKey.get(`${profile.name}|${startTime}`)
      if (!rec) continue
      const key = profile.name
      top1Changes[key] = top1Changes[key] ?? { changed: 0, dates: 0 }
      top1Changes[key].dates += 1
      if (rec.top !== base.top) top1Changes[key].changed += 1
      const common = base.order.filter((id) => rec.order.includes(id))
      const rho = spearman(common.map((id) => base.ranks[id]), common.map((id) => rec.ranks[id]))
      spearmanVsBaseline[key] = spearmanVsBaseline[key] ?? []
      spearmanVsBaseline[key].push(rho)
    }
  }
  const responsiveness = Object.fromEntries(
    Object.entries(top1Changes).map(([k, v]) => [
      k,
      {
        top1Changed: `${v.changed}/${v.dates}`,
        meanSpearman: round(spearmanVsBaseline[k].reduce((s, x) => s + x, 0) / spearmanVsBaseline[k].length, 3),
        minSpearman: round(Math.min(...spearmanVsBaseline[k]), 3),
      },
    ]),
  )

  // component saturation: how often a component is pinned at 100
  const saturation = {}
  for (const profile of PROFILES) {
    const recs = run.filter((r) => r.profile === profile.name)
    const all = recs.flatMap((r) => Object.values(r.components))
    saturation[profile.name] = {
      sun100: `${all.filter((c) => c.sun === 100).length}/${all.length}`,
      power100: `${all.filter((c) => c.power === 100).length}/${all.length}`,
      comms100: `${all.filter((c) => c.comms === 100).length}/${all.length}`,
      scoreRange: [round(Math.min(...recs.flatMap((r) => Object.values(r.scores)))), round(Math.max(...recs.flatMap((r) => Object.values(r.scores))))],
    }
  }

  // comms top-site quality under the different comms profiles
  const commsFocus = {}
  for (const profile of ['baseline', 'comms-heavy', 'comms-extreme', 'relay']) {
    const recs = run.filter((r) => r.profile === profile)
    const topFractions = recs.map((r) => r.metrics[r.top]?.earthVisibleFraction ?? null).filter((v) => v != null)
    commsFocus[profile] = {
      meanTopEarthFraction: round(topFractions.reduce((s, v) => s + v, 0) / Math.max(1, topFractions.length), 3),
      topSites: [...new Set(recs.map((r) => r.top))],
    }
  }

  // power focus
  const powerFocus = {}
  for (const profile of ['baseline', 'power-heavy', 'power-extreme']) {
    const recs = run.filter((r) => r.profile === profile)
    const topPower = recs.map((r) => r.metrics[r.top]?.averageW ?? null).filter((v) => v != null)
    powerFocus[profile] = {
      meanTopAverageW: round(topPower.reduce((s, v) => s + v, 0) / Math.max(1, topPower.length), 1),
      topSites: [...new Set(recs.map((r) => r.top))],
    }
  }

  // ties
  const ties = run.map((r) => ({ profile: r.profile, startTime: r.startTime, ties: r.ties, maxTieGroup: r.maxTieGroup }))
  const tiedRankings = ties.filter((t) => t.ties > 0)
  if (tiedRankings.length) weaknesses.push({ kind: 'score-ties', detail: `${tiedRankings.length}/${ties.length} rankings have tied scores (max group ${Math.max(...ties.map((t) => t.maxTieGroup))}); ranks are assigned by sort order, so equal scores get different ranks` })
  if (saturation.baseline.power100 !== `0/${pois.length * dates.length}` || saturation.relay.comms100 !== `0/${pois.length * dates.length}`) {
    weaknesses.push({ kind: 'component-saturation', detail: 'a score component reaches 100 for many sites (see saturation table)' })
  }
  const weakResponsiveness = Object.entries(responsiveness).filter(
    ([, v]) => v.meanSpearman != null && v.meanSpearman > 0.95,
  )
  if (weakResponsiveness.length) {
    weaknesses.push({
      kind: 'ranking-insensitivity',
      detail: `profiles whose ranking stays close to the baseline (mean rank correlation > 0.95): ${weakResponsiveness
        .map(([k, v]) => `${k} (rho=${v.meanSpearman}, top1 changed ${v.top1Changed})`)
        .join('; ')}`,
    })
  }

  // ------------------------------------------- randomized mission sweep
  const rand = (() => { let a = SEED >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 } })()
  const sweep = { cases: 0, failures: [], monotonicity: [] }
  const sweepDate = dates[Math.floor(dates.length / 2)]
  const sweepSite = pois[0]
  const sweepTerrain = terrains
  const sweepEphemeris = ephemerisBySite
  for (let i = 0; i < 150; i += 1) {
    const mission = {
      ...QUICK_MISSION,
      missionDays: [3, 7, 14, 28][Math.floor(rand() * 4)],
      powerNeedW: Math.floor(rand() * 2001),
      sunDaysNeeded: Math.floor(rand() * 31),
      dataNeedMb: rand() < 0.2 ? null : Math.floor(rand() * 50_001),
      relayInOrbit: rand() < 0.5,
      mastM: Math.floor(rand() * 21),
      perimeterM: Math.floor(50 + rand() * 451),
      startTime: sweepDate,
    }
    sweep.cases += 1
    const base = core.scoreSite({ site: sweepSite, terrain: sweepTerrain, ephemeris: sweepEphemeris, mission })
    if (!Number.isFinite(base.score) || base.score < 0 || base.score > 100) sweep.failures.push({ i, kind: 'score', value: base.score })
    for (const [k, v] of Object.entries(base.components)) if (!Number.isFinite(v) || v < 0 || v > 100) sweep.failures.push({ i, kind: 'component', key: k, value: v })
    const variants = [
      ['power', { ...mission, powerNeedW: mission.powerNeedW + 500 }, 'power'],
      ['sun', { ...mission, sunDaysNeeded: mission.sunDaysNeeded + 10 }, 'sun'],
      ['data', mission.dataNeedMb == null ? null : { ...mission, dataNeedMb: mission.dataNeedMb + 10_000 }, 'comms'],
    ]
    for (const [name, variantMission, key] of variants) {
      if (!variantMission) continue
      const variant = core.scoreSite({ site: sweepSite, terrain: sweepTerrain, ephemeris: sweepEphemeris, mission: variantMission })
      if (variant.components[key] > base.components[key] + 0.05) sweep.monotonicity.push({ i, need: name, base: base.components[key], value: variant.components[key] })
    }
    const relayVariant = core.scoreSite({ site: sweepSite, terrain: sweepTerrain, ephemeris: sweepEphemeris, mission: { ...mission, relayInOrbit: !mission.relayInOrbit } })
    if (!mission.relayInOrbit && relayVariant.components.comms < base.components.comms - 0.05) sweep.monotonicity.push({ i, need: 'relay', base: base.components.comms, value: relayVariant.components.comms })
  }
  if (sweep.failures.length) failures.push({ kind: 'sweep-invalid', detail: `${sweep.failures.length} invalid results`, examples: sweep.failures.slice(0, 3) })
  if (sweep.monotonicity.length) failures.push({ kind: 'sweep-monotonicity', detail: `${sweep.monotonicity.length} non-monotonic cases`, examples: sweep.monotonicity.slice(0, 5) })

  // ------------------------------------------------------------ edge missions
  const edgeMissions = [
    ['zero-needs', { powerNeedW: 0, sunDaysNeeded: 0, dataNeedMb: 0, perimeterM: 0, mastM: 0 }],
    ['one-hour', { missionDays: 1 / 24 }],
    ['huge-needs', { powerNeedW: 1e6, sunDaysNeeded: 365, dataNeedMb: 1e9, perimeterM: 1e6, mastM: 1e5 }],
    ['negative-needs', { powerNeedW: -100, sunDaysNeeded: -5, dataNeedMb: -10 }],
    ['relay-no-data', { relayInOrbit: true, dataNeedMb: null }],
  ]
  const edge = []
  for (const [name, mission] of edgeMissions) {
    try {
      const entries = core.rankSites({ sites: pois, terrain: terrains, ephemeris: ephemerisBySite, mission: { ...mission, startTime: dates[0] } })
      const bad = entries.filter((e) => e.score == null || !Number.isFinite(e.score))
      edge.push({ name, scored: entries.length - bad.length, bad: bad.map((e) => e.siteId), top: entries.find((e) => e.score != null)?.siteId ?? null, topScore: entries.find((e) => e.score != null)?.score ?? null })
      if (bad.length) failures.push({ kind: `edge-${name}`, detail: `${bad.length} sites did not score` })
    } catch (error) {
      edge.push({ name, error: String(error.message) })
      failures.push({ kind: `edge-${name}`, detail: String(error.message) })
    }
  }

  // invalid site must not break the ranking
  let invalidHandled = true
  try {
    const entries = core.rankSites({ sites: [...pois, { id: 'invalid', name: 'Invalid', lat: Number.NaN, lon: 0 }], terrain: terrains, ephemeris: ephemerisBySite, mission: { startTime: dates[0] } })
    const invalid = entries.find((e) => e.siteId === 'invalid')
    invalidHandled = invalid?.score == null && invalid?.rank == null && typeof invalid?.error === 'string'
    if (!invalidHandled) failures.push({ kind: 'invalid-site', detail: 'invalid site entry not marked with score/rank null and an error' })
  } catch (error) {
    invalidHandled = false
    failures.push({ kind: 'invalid-site', detail: `threw: ${error.message}` })
  }

  // ------------------------------------------------------------------ report
  const report = {
    generatedAt: new Date().toISOString(),
    repo: REPO,
    seed: SEED,
    dates,
    profiles: PROFILES.map((p) => p.name),
    sites: pois.map((p) => p.id),
    runs: run.length,
    failures,
    weaknesses,
    sensitivity: Object.fromEntries(Object.entries(sensitivity).map(([k, v]) => [k, { checked: v.checked, violations: v.violations.length }])),
    responsiveness,
    saturation,
    commsFocus,
    powerFocus,
    ties: tiedRankings.length,
    determinism: detEqual,
    edge,
    sweep,
    invalidHandled,
    rankings: run.map((r) => ({ profile: r.profile, startTime: r.startTime, top: r.top, topScore: r.topScore })),
  }
  mkdirSync(OUT, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(resolve(OUT, `autopilot-mc-${stamp}.json`), JSON.stringify(report, null, 2))

  console.log('=== autopilot/ranking Monte Carlo ===')
  console.log(`runs: ${run.length} (${PROFILES.length} profiles × ${dates.length} dates) · sites: ${pois.length}`)
  console.log('determinism:', detEqual ? 'PASS' : 'FAIL')
  console.log('failures:', failures.length)
  for (const f of failures.slice(0, 8)) console.log(' FAIL', JSON.stringify(f))
  console.log('weaknesses:')
  for (const w of weaknesses) console.log(' WEAK', JSON.stringify(w))
  console.log('responsiveness vs baseline:', JSON.stringify(responsiveness))
  console.log('comms focus:', JSON.stringify(commsFocus))
  console.log('power focus:', JSON.stringify(powerFocus))
  console.log('saturation:', JSON.stringify(saturation))
  console.log('edge cases:', JSON.stringify(edge))
  console.log('random sweep:', JSON.stringify({ cases: sweep.cases, failures: sweep.failures.length, monotonicity: sweep.monotonicity.length }))
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
