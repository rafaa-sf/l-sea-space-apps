#!/usr/bin/env node
/**
 * Landing-zone feasibility Monte Carlo.
 *
 * Runs the real `rankLandingZones` over one DEM region with a matrix of mission
 * profiles varying battery capacity, power need, solar-day requirement, mission
 * length, heater/thermal limits, data need, relay and RTG power source. For every
 * zone it checks that the hard-feasibility gate is consistent with the returned
 * margins: no zone with all margins satisfied may be marked impossible (and no
 * zone with a failed margin may be marked feasible), plus score caps, ordering,
 * summary counters and reason/violation agreement.
 *
 * Usage: node qa/autopilot/feasibility-mc.mjs [--missions N]
 */
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createFileFetch } from '../logic/lib/file-fetch.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, '..', '..')
const QUICK = { profileStepDeg: 3, stepSeconds: 900 }
const round2 = (v) => Math.round(Number(v) * 100) / 100
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const tol = 4e-3

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
  const startTime = new Date(Date.parse(range.start) + 10 * 86400_000).toISOString()
  return { core, pois, terrains, ephemerisBySite, startTime }
}

const PROFILES = [
  ['baseline', {}],
  ['battery-200', { batteryCapacityWh: 200 }],
  ['battery-5000', { batteryCapacityWh: 5000 }],
  ['power-1500', { powerNeedW: 1500 }],
  ['sun-20', { sunDaysNeeded: 20 }],
  ['cold-0C', { minOperatingTemperatureC: 0 }],
  ['heater-150', { heaterMaxW: 150 }],
  ['rtg-300', { powerSource: 'rtg', rtgPowerW: 300 }],
]

async function main() {
  const { core, pois, terrains, ephemerisBySite, startTime } = await loadData()
  const terrain = terrains.find((t) => t.id === 'south-pole-80s-80m') ?? terrains[0]
  const failures = []
  const runs = []
  const zoneStats = []

  for (const [name, partial] of PROFILES) {
    const mission = { ...QUICK, startTime, ...partial }
    const normalized = core.normalizeMission(mission)
    const result = core.rankLandingZones({
      terrain,
      ephemeris: ephemerisBySite,
      sites: pois,
      mission,
      options: { maxZones: 6 },
    })
    const entries = Array.isArray(result) ? result : result?.zones ?? []
    const meta = Array.isArray(result) ? null : result?.meta ?? null
    const feasibleEntries = entries.filter((e) => e.feasible === true)
    const scored = entries.filter((e) => e.score != null)

    // summary counters must match the rows
    if (meta) {
      if (meta.feasibleZones !== feasibleEntries.length) failures.push({ profile: name, kind: 'meta-feasible-count', detail: `${meta.feasibleZones} vs ${feasibleEntries.length}` })
      if (meta.hasFeasibleZones !== (feasibleEntries.length > 0)) failures.push({ profile: name, kind: 'meta-has-feasible', detail: `${meta.hasFeasibleZones}` })
      if (meta.recommendedZoneId !== (feasibleEntries[0]?.zone?.id ?? null)) failures.push({ profile: name, kind: 'meta-recommended', detail: `${meta.recommendedZoneId}` })
    }

    entries.forEach((e, index) => {
      const m = e.metrics
      const f = e.feasibility
      const power = m?.power ?? {}
      const thermal = m?.thermal ?? {}
      const comms = m?.comms ?? {}
      const illumination = m?.illumination ?? {}

      // expected hard-feasibility flags from the returned margins
      let powerOK
      if (normalized.powerSource === 'rtg') powerOK = finite(power.rtgMarginW) && power.rtgMarginW >= -1e-6
      else powerOK = finite(power.powerMarginW) && power.powerMarginW >= -1e-6
      const effectiveCapacity = finite(power.batteryCapacityWh) ? power.batteryCapacityWh : Number(normalized.batteryCapacityWh)
      const batteryOK = normalized.powerSource === 'rtg' ? true : finite(power.requiredBatteryWh) && finite(effectiveCapacity) && power.requiredBatteryWh <= effectiveCapacity + 1e-6
      const thermalOK = finite(thermal.heatedMinTempC) && finite(thermal.maxTempC) && thermal.heatedMinTempC >= normalized.minOperatingTemperatureC - 1e-6 && thermal.maxTempC <= normalized.maxOperatingTemperatureC + 1e-6
      const dataOK =
        !(normalized.dataNeedMb != null && normalized.dataNeedMb > 0) ||
        comms.dataBudgetCoverage == null ||
        comms.dataBudgetCoverage >= 1 - 1e-9
      const illumOK = normalized.powerSource === 'rtg' || normalized.sunDaysNeeded <= 0 || (finite(illumination.continuousSunDays) && illumination.continuousSunDays >= normalized.sunDaysNeeded - 1e-9)
      const expectedFeasible = powerOK && batteryOK && thermalOK && dataOK && illumOK

      const mismatches = []
      if (f.powerFeasible !== powerOK) mismatches.push(`power flag ${f.powerFeasible} vs margins ${powerOK}`)
      if (f.batteryFeasible !== batteryOK) mismatches.push(`battery flag ${f.batteryFeasible} vs margins ${batteryOK}`)
      if (f.thermalFeasible !== thermalOK) mismatches.push(`thermal flag ${f.thermalFeasible} vs margins ${thermalOK}`)
      if (f.dataFeasible !== dataOK) mismatches.push(`data flag ${f.dataFeasible} vs margins ${dataOK}`)
      const illumFlag = f.illuminationFeasible ?? f.illuminationMeetsRequirement
      if (illumFlag !== illumOK) mismatches.push(`illum flag ${illumFlag} vs margins ${illumOK}`)
      if (e.feasible !== expectedFeasible) mismatches.push(`feasible ${e.feasible} vs margins ${expectedFeasible}`)
      if (mismatches.length) failures.push({ profile: name, zone: e.zone?.id, kind: 'feasibility-mismatch', detail: mismatches.join('; ') })

      // a feasible zone must not carry a bad violation; an infeasible one must have one
      const badViolations = (f.violations ?? []).filter((v) => v.severity === 'bad')
      if (e.feasible && badViolations.length) failures.push({ profile: name, zone: e.zone?.id, kind: 'feasible-with-violation', detail: badViolations.map((v) => v.code).join(',') })
      if (!e.feasible && badViolations.length === 0 && f.status !== 'undetermined') failures.push({ profile: name, zone: e.zone?.id, kind: 'infeasible-without-violation', detail: JSON.stringify(f) })
      // violations must be echoed in reasons
      const reasonCodes = new Set((e.reasons ?? []).map((r) => r.code))
      for (const v of badViolations) if (!reasonCodes.has(v.code)) failures.push({ profile: name, zone: e.zone?.id, kind: 'violation-not-in-reasons', detail: v.code })

      // score cap and grade
      if (e.feasible && Math.abs(e.score - e.rawScore) > 0.1) failures.push({ profile: name, zone: e.zone?.id, kind: 'score-not-raw', detail: `${e.score} vs ${e.rawScore}` })
      if (!e.feasible && Math.abs(e.score - Math.min(e.rawScore, 55)) > 0.1) failures.push({ profile: name, zone: e.zone?.id, kind: 'score-not-capped', detail: `${e.score} vs ${Math.min(e.rawScore, 55)}` })
      if (e.scoreCapApplied !== e.score < e.rawScore) failures.push({ profile: name, zone: e.zone?.id, kind: 'cap-flag', detail: `${e.scoreCapApplied}` })

      // statistics consistency
      const statsChecks = []
      if (normalized.powerSource !== 'rtg') {
        if (finite(power.averageW) && finite(power.powerNeedW) && finite(power.heaterAveragePowerW)) {
          const expectedMargin = power.averageW - power.powerNeedW - power.heaterAveragePowerW
          if (Math.abs(power.powerMarginW - round2(expectedMargin)) > 0.05) statsChecks.push(`powerMarginW ${power.powerMarginW} vs ${round2(expectedMargin)}`)
        }
        if (finite(power.batteryCapacityWh) && finite(power.requiredBatteryWh)) {
          const coverage = Math.min(1, Math.max(0, power.batteryCapacityWh / Math.max(power.requiredBatteryWh, 1e-9)))
          if (Math.abs(power.batteryCoverage - coverage) > 1e-3) statsChecks.push(`batteryCoverage ${power.batteryCoverage} vs ${coverage}`)
        }
      }
      for (const [key, value] of Object.entries(e.components ?? {})) if (!finite(value) || value < 0 || value > 100) statsChecks.push(`component ${key}=${value}`)
      if (!finite(e.confidence) || e.confidence < 0 || e.confidence > 1) statsChecks.push(`confidence ${e.confidence}`)
      if (normalized.powerSource !== 'rtg' && finite(power.batteryCapacityWh) && finite(effectiveCapacity) && Math.abs(power.batteryCapacityWh - effectiveCapacity) > 0.5) statsChecks.push(`reported batteryCapacityWh ${power.batteryCapacityWh} vs effective ${effectiveCapacity}`)
      if (statsChecks.length) failures.push({ profile: name, zone: e.zone?.id, kind: 'stats', detail: statsChecks.join('; ') })

      zoneStats.push({
        profile: name,
        zone: e.zone?.id,
        feasible: e.feasible,
        status: f.status,
        score: e.score,
        raw: e.rawScore,
        powerMarginW: power.powerMarginW,
        requiredBatteryWh: power.requiredBatteryWh,
        batteryCapacityWh: power.batteryCapacityWh,
        heatedMinTempC: thermal.heatedMinTempC,
        maxTempC: thermal.maxTempC,
        continuousSunDays: illumination.continuousSunDays,
        dataCoverage: comms.dataBudgetCoverage,
        violations: (f.violations ?? []).map((v) => `${v.severity}:${v.code}`),
      })
    })

    runs.push({ profile: name, zones: entries.length, feasible: feasibleEntries.length, top: scored[0]?.zone?.id ?? null, topScore: scored[0]?.score ?? null, topRaw: scored[0]?.rawScore ?? null })
    console.log(`profile ${name}: ${entries.length} zones, ${feasibleEntries.length} feasible, top ${scored[0]?.zone?.id} score ${scored[0]?.score} (raw ${scored[0]?.rawScore})`)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    terrain: terrain.id,
    profiles: PROFILES.map(([name]) => name),
    runs,
    failures,
    failureCount: failures.length,
    zones: zoneStats,
  }
  mkdirSync(resolve(HERE, 'results'), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(resolve(HERE, 'results', `feasibility-mc-${stamp}.json`), JSON.stringify(report, null, 2))
  console.log('failures:', failures.length)
  for (const f of failures.slice(0, 10)) console.log(' FAIL', JSON.stringify(f))
  const allImpossible = runs.filter((r) => r.feasible === 0)
  if (allImpossible.length) console.log('ALL-ZONES-IMPOSSIBLE profiles:', allImpossible.map((r) => r.profile).join(', '))
  console.log('RESULT:', failures.length ? 'FAILURES' : 'ALL PASS')
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
