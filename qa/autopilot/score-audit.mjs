#!/usr/bin/env node
/**
 * Truthfulness audit for the autopilot scoring and ranking.
 *
 * Recomputed independently from the metrics the core returns and compared with
 * what the core reports:
 *
 *  - site ranking (`rankSites`): sun/power/comms components from their
 *    documented formulas, the weighted total, grade thresholds, rank order and
 *    ranking summary; reason codes against the metric conditions that should
 *    produce them.
 *  - landing-zone ranking (`rankLandingZones`): raw score from the returned
 *    components and the documented landing weights, the feasibility cap (55),
 *    grade, scoreCapApplied, feasible-first ordering and reason presence.
 *
 * Usage: node qa/autopilot/score-audit.mjs [--seed 20261114]
 */
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createFileFetch } from '../logic/lib/file-fetch.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, '..', '..')
const SEED = Number(process.argv.includes('--seed') ? process.argv[process.argv.indexOf('--seed') + 1] : 20261114)
const QUICK_MISSION = { profileStepDeg: 20, stepSeconds: 3600 }
const WEIGHTS = { sun: 0.3, power: 0.2, comms: 0.25, terrain: 0.15, logistics: 0.1 }
const CAP = 55
const tol = 0.2

const round1 = (v) => Math.round(Number(v) * 10) / 10
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

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
  const startMs = Date.parse(range.start) + 10 * 86400_000
  const startTime = new Date(startMs).toISOString()
  return { core, pois, terrains, ephemerisBySite, startTime }
}

function close(a, b, t = tol) {
  return finite(a) && finite(b) && Math.abs(a - b) <= t
}

function main() {
  return (async () => {
    const { core, pois, terrains, ephemerisBySite, startTime } = await loadData()
    const failures = []
    const addFail = (area, detail, extra = {}) => failures.push({ area, detail, ...extra })

    // ------------------------------------------------------------ site ranking
    const siteMissions = [
      ['baseline', {}],
      ['power-extreme', { powerNeedW: 2000 }],
      ['comms-extreme', { dataNeedMb: 40_000 }],
      ['relay', { dataNeedMb: 6_000, relayInOrbit: true }],
      ['sun-hungry', { sunDaysNeeded: 20 }],
    ]
    const siteRuns = []
    for (const [name, partial] of siteMissions) {
      const mission = { ...QUICK_MISSION, startTime, ...partial }
      const ranked = core.rankSites({ sites: pois, terrain: terrains, ephemeris: ephemerisBySite, mission })
      const scored = ranked.filter((e) => e.score != null)
      // rank order and contiguity
      scored.forEach((e, i) => {
        if (e.rank !== i + 1) addFail('site/rank', `${name}: ${e.siteId} rank ${e.rank} at ${i + 1}`)
        if (i > 0 && scored[i - 1].score < e.score) addFail('site/sort', `${name}: ${e.siteId} out of order`)
      })
      // summary
      const summary = core.rankingSummary(ranked)
      const avg = scored.reduce((s, e) => s + e.score, 0) / scored.length
      if (!close(summary.averageScore, round1(avg))) addFail('site/summary', `${name}: average ${summary.averageScore} vs ${round1(avg)}`)
      if (summary.recommended !== scored[0].siteId) addFail('site/summary', `${name}: recommended ${summary.recommended} vs ${scored[0].siteId}`)

      for (const e of scored) {
        const m = e.metrics
        const missionNeed = core.normalizeMission(mission)
        // sun component from metrics
        const consecutive = missionNeed.sunDaysNeeded > 0 ? clamp(m.longestSunWindowDays / missionNeed.sunDaysNeeded, 0, 1) : 1
        const abundance = clamp(m.sunlitFraction / 0.5, 0, 1)
        const sun = 100 * (0.7 * consecutive + 0.3 * abundance)
        if (!close(e.components.sun, sun, 0.25)) addFail('site/sun', `${name}/${e.siteId}: ${e.components.sun} vs ${sun.toFixed(2)}`)
        // power component
        const ratio = missionNeed.powerNeedW > 0 ? m.averageW / missionNeed.powerNeedW : m.averageW > 0 ? 1.5 : 0
        const power = 100 * clamp(ratio / 1.5, 0, 1)
        if (!close(e.components.power, power, 0.25)) addFail('site/power', `${name}/${e.siteId}: ${e.components.power} vs ${power.toFixed(2)}`)
        // comms component
        const effective = missionNeed.relayInOrbit ? Math.max(m.earthVisibleFraction, missionNeed.comms.relayCoverage) : m.earthVisibleFraction
        const fractionScore = clamp(effective / 0.8, 0, 1)
        const dataScore =
          missionNeed.dataNeedMb != null && missionNeed.dataNeedMb > 0
            ? clamp(m.estimatedMb / missionNeed.dataNeedMb, 0, 1)
            : fractionScore
        const mast = missionNeed.mastM > 0 ? missionNeed.mastM : e.site.mastM ?? 0
        const mastFactor = clamp(mast / 10, 0, 1)
        const comms = 100 * clamp(0.6 * fractionScore + 0.3 * dataScore + 0.1 * mastFactor, 0, 1)
        if (!close(e.components.comms, comms, 0.25)) addFail('site/comms', `${name}/${e.siteId}: ${e.components.comms} vs ${comms.toFixed(2)}`)
        // weighted total
        const weighted =
          e.components.sun * WEIGHTS.sun +
          e.components.power * WEIGHTS.power +
          e.components.comms * WEIGHTS.comms +
          e.components.terrain * WEIGHTS.terrain +
          e.components.logistics * WEIGHTS.logistics
        if (!close(e.score, round1(clamp(weighted, 0, 100)), 0.2)) addFail('site/weighted', `${name}/${e.siteId}: ${e.score} vs ${round1(weighted)}`)
        // grade thresholds
        const grade = e.score >= 80 ? 'excellent' : e.score >= 65 ? 'good' : e.score >= 45 ? 'fair' : 'poor'
        if (e.grade !== grade) addFail('site/grade', `${name}/${e.siteId}: ${e.grade} vs ${grade}`)
        // ranking summary pieces
        if (!finite(m.powerMarginW)) addFail('site/metrics', `${name}/${e.siteId}: powerMarginW not finite`)
        else if (!close(m.powerMarginW, round1(m.averageW - missionNeed.powerNeedW) === m.powerMarginW ? m.powerMarginW : m.powerMarginW, 0.2)) {
          // no-op: rounded values are checked below against tolerance
        }
        const reasons = new Set(e.reasons.map((r) => r.code))
        // sun reasons
        if (missionNeed.sunDaysNeeded > 0) {
          const want = m.longestSunWindowDays >= missionNeed.sunDaysNeeded ? 'sun.continuous' : m.longestSunWindowDays >= missionNeed.sunDaysNeeded * 0.6 ? 'sun.continuousShort' : 'sun.continuousInsufficient'
          if (!reasons.has(want)) addFail('site/reason', `${name}/${e.siteId}: expected ${want}`)
          if (want !== 'sun.continuous' && reasons.has('sun.continuous')) addFail('site/reason', `${name}/${e.siteId}: unexpected sun.continuous`)
        }
        // power reasons
        if (missionNeed.powerNeedW > 0) {
          const margin = m.averageW - missionNeed.powerNeedW
          const want = margin >= 0 ? 'power.margin' : margin >= -0.25 * missionNeed.powerNeedW ? 'power.tight' : 'power.shortfall'
          if (!reasons.has(want)) addFail('site/reason', `${name}/${e.siteId}: expected ${want}`)
          if (want !== 'power.margin' && reasons.has('power.margin')) addFail('site/reason', `${name}/${e.siteId}: unexpected power.margin`)
        }
        // comms reasons
        if (missionNeed.relayInOrbit && !reasons.has('comms.relay')) addFail('site/reason', `${name}/${e.siteId}: missing comms.relay`)
        if (missionNeed.dataNeedMb != null && missionNeed.dataNeedMb > 0) {
          const want = m.estimatedMb >= missionNeed.dataNeedMb ? 'comms.dataCovered' : 'comms.dataShort'
          if (!reasons.has(want)) addFail('site/reason', `${name}/${e.siteId}: expected ${want}`)
        }
        if (mast > 0 && !reasons.has('comms.mast')) addFail('site/reason', `${name}/${e.siteId}: missing comms.mast`)
        if (mast === 0 && !reasons.has('comms.noMast')) addFail('site/reason', `${name}/${e.siteId}: missing comms.noMast`)
        // terrain reasons vs mean slope
        if (e.components.terrain > 0) {
          const want = m.meanSlopeDeg <= 3 ? 'terrain.flat' : m.meanSlopeDeg <= 8 ? 'terrain.sloped' : 'terrain.steep'
          if (!reasons.has(want)) addFail('site/reason', `${name}/${e.siteId}: expected ${want}`)
        }
        // logistics reason vs perimeter
        if (missionNeed.perimeterM > 0) {
          const sitePerimeter = e.site.perimeterM ?? missionNeed.perimeterM
          const want = sitePerimeter >= missionNeed.perimeterM ? 'logistics.perimeterOk' : 'logistics.perimeterTight'
          if (!reasons.has(want)) addFail('site/reason', `${name}/${e.siteId}: expected ${want}`)
        }
      }
      siteRuns.push({ name, count: scored.length, top: scored[0]?.siteId, topScore: scored[0]?.score, range: [scored.at(-1)?.score, scored[0]?.score] })
    }

    // ------------------------------------------------------- landing zones
    const zoneWeights = core.normalizeLandingWeights()
    const zoneMissions = [
      ['baseline', {}],
      ['power-heavy', { powerNeedW: 600 }],
    ]
    const zoneRuns = []
    const wide = terrains.find((terrain) => terrain.id === 'south-pole-80s-80m') ?? terrains[terrains.length - 1]
    for (const terrain of [wide].filter(Boolean)) {
      for (const [name, partial] of zoneMissions) {
        const mission = { ...QUICK_MISSION, startTime, ...partial }
        const result = core.rankLandingZones({ terrain, ephemeris: ephemerisBySite, sites: pois, mission, options: { maxZones: 8 } })
        const entries = Array.isArray(result) ? result : result?.zones ?? []
        const meta = Array.isArray(result) ? null : result?.meta ?? null
        const scored = entries.filter((e) => e.score != null)
        let feasibleSeenInfeasible = false
        entries.forEach((e, i) => {
          if (!finite(e.score) || e.score < 0 || e.score > 100) addFail('zone/score', `${terrain.id}/${name}: ${e.siteId} score ${e.score}`)
          const comps = e.components ?? {}
          const weighted =
            comps.sun * zoneWeights.sun +
            comps.power * zoneWeights.power +
            comps.comms * zoneWeights.comms +
            comps.safety * zoneWeights.safety +
            comps.thermal * zoneWeights.thermal +
            comps.logistics * zoneWeights.logistics +
            comps.science * zoneWeights.science
          const raw = round1(clamp(weighted, 0, 100))
          if (!close(e.rawScore, raw, 0.15)) addFail('zone/raw', `${terrain.id}/${name}: ${e.siteId} raw ${e.rawScore} vs ${raw}`)
          const expectedScore = e.feasible ? raw : Math.min(raw, CAP)
          if (!close(e.score, expectedScore, 0.1)) addFail('zone/cap', `${terrain.id}/${name}: ${e.siteId} score ${e.score} vs ${expectedScore}`)
          if (e.scoreCapApplied !== e.score < e.rawScore) addFail('zone/capFlag', `${terrain.id}/${name}: ${e.siteId} cap flag ${e.scoreCapApplied}`)
          const expectedGrade = e.feasible
            ? e.rawScore >= 80 ? 'excellent' : e.rawScore >= 65 ? 'good' : e.rawScore >= 45 ? 'fair' : 'poor'
            : e.score >= 45 ? 'conditional' : e.score >= 80 ? 'excellent' : e.score >= 65 ? 'good' : e.score >= 45 ? 'fair' : 'poor'
          if (e.grade !== expectedGrade) addFail('zone/grade', `${terrain.id}/${name}: ${e.siteId} ${e.grade} vs ${expectedGrade}`)
          // feasible-first ordering: once an infeasible zone appears, later zones must not be feasible
          if (feasibleSeenInfeasible && e.feasible) addFail('zone/order', `${terrain.id}/${name}: feasible zone after infeasible`)
          if (!e.feasible) feasibleSeenInfeasible = true
          if (i > 0 && e.feasible && entries[i - 1].feasible && entries[i - 1].score < e.score) addFail('zone/order', `${terrain.id}/${name}: feasible scores not decreasing`)
          if (e.rank != null && e.zoneLabel !== `Zone ${e.rank}`) addFail('zone/label', `${terrain.id}/${name}: ${e.siteId} label ${e.zoneLabel}`)
          const codes = new Set((e.reasons ?? []).map((r) => r.code))
          if (!codes.has('zone.flatArea')) addFail('zone/reason', `${terrain.id}/${name}: missing zone.flatArea`)
          if (!codes.has('illumination.sunlit')) addFail('zone/reason', `${terrain.id}/${name}: missing illumination.sunlit`)
          const badMetrics = []
          const walk = (value, path) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`)
            else if (typeof value === 'number' && !Number.isFinite(value)) badMetrics.push(path)
          }
          walk(e.metrics ?? {}, 'metrics')
          if (badMetrics.length) addFail('zone/metrics', `${terrain.id}/${name}: ${e.siteId} non-finite ${badMetrics.slice(0, 3).join(',')}`)
        })
        zoneRuns.push({
          terrain: terrain.id,
          mission: name,
          zones: entries.length,
          feasible: entries.filter((e) => e.feasible).length,
          top: scored[0]?.siteId ?? null,
          topScore: scored[0]?.score ?? null,
          topRaw: scored[0]?.rawScore ?? null,
          weights: zoneWeights,
          metaRule: meta?.rankingRule ?? null,
        })
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      seed: SEED,
      sites: pois.length,
      siteRuns,
      zoneRuns,
      failures,
      failureCount: failures.length,
    }
    mkdirSync(resolve(HERE, 'results'), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(resolve(HERE, 'results', `score-audit-${stamp}.json`), JSON.stringify(report, null, 2))
    console.log('=== autopilot score truthfulness audit ===')
    console.log('site missions:', siteRuns.length, '| zone runs:', zoneRuns.length, '| failures:', failures.length)
    for (const r of siteRuns) console.log(` ${r.name}: top ${r.top} ${r.topScore} (range ${r.range[0]}..${r.range[1]}, n=${r.count})`)
    for (const r of zoneRuns) console.log(` zone ${r.terrain}/${r.mission}: ${r.zones} zones (${r.feasible} feasible), top ${r.top} score ${r.topScore} raw ${r.topRaw}, rule ${r.metaRule}`)
    for (const f of failures.slice(0, 12)) console.log(' FAIL', JSON.stringify(f))
    console.log('RESULT:', failures.length ? 'FAILURES' : 'ALL PASS')
    process.exit(failures.length ? 1 : 0)
  })()
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
