import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import { rankLandingZones } from './zoneAutopilot.js'
import {
  DEFAULT_DATE_SEARCH_OPTIONS,
  getDateSearchWindow,
  normalizeDateSearchOptions,
  searchFeasibleDate,
} from './dateSearch.js'

const START = Date.parse('2026-11-01T00:00:00Z')
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

function makeTerrain() {
  const width = 64
  const height = 64
  const bounds = 3200
  const pixelSizeM = (2 * bounds) / width
  return createProjectedTerrain(
    { id: 'date-search-test', referenceRadiusM: MOON_RADIUS_M, width, height, pixelSizeM, minX: -bounds, maxX: bounds, minY: -bounds, maxY: bounds, dtype: 'float32', synthetic: true },
    new Float32Array(width * height),
  )
}

/** 10-day ephemeris at 30 min; `sun(hour)` controls visibility/shadows. */
function makeEphemeris(sun, hours = 10 * 24) {
  const samples = []
  for (let index = 0; index <= (hours * 60) / 30; index += 1) {
    const hour = (index * 30) / 60
    samples.push({ time: new Date(START + index * 30 * 60 * 1000).toISOString(), sun: sun(hour), earth: { az: 90, el: 2 } })
  }
  return normalizeEphemerisDataset({ siteId: 'date-search-ephemeris', samples })
}

function rank({ terrain, ephemeris, mission, options }) {
  const sites = [{ id: 'site', name: 'Site', lat: -90, lon: 0, elevationM: 0, ephemerisSiteId: 'date-search-ephemeris' }]
  return rankLandingZones({
    terrain,
    ephemeris: { site: ephemeris },
    sites,
    mission: { missionDays: 2, sunDaysNeeded: 0.5, powerNeedW: 120, startTime: new Date(START).toISOString(), ...mission },
    options: { maxZones: 4, searchDates: true, dateSearch: { stepHours: 6, evaluationStepSeconds: 1800 }, ...options },
  })
}

describe('date search window', () => {
  it('clips candidates so the mission fits the ephemeris coverage', () => {
    const dataset = normalizeEphemerisDataset(
      Array.from({ length: 5 * 48 + 1 }, (_, index) => ({
        time: new Date(START + index * 30 * 60 * 1000).toISOString(),
        sun: { az: 270, el: 2 },
        earth: { az: 90, el: 2 },
      })),
    )
    const window = getDateSearchWindow(dataset, { missionDays: 2 }, normalizeDateSearchOptions({ stepHours: 12 }))
    expect(window.startMs).toBe(dataset.startMs)
    expect(window.latestStartMs).toBe(dataset.endMs - 2 * DAY)
    expect(window.candidatesMs.length).toBeGreaterThan(1)
    expect(window.candidatesMs.every((value) => value <= window.latestStartMs)).toBe(true)
    const longMission = getDateSearchWindow(dataset, { missionDays: 30 }, normalizeDateSearchOptions({}))
    expect(longMission.clipped).toBe(true)
    expect(longMission.candidatesMs.length).toBe(1)
    expect(longMission.naturalCandidates).toBe(1)
    expect(longMission.truncated).toBe(false)
  })

  it('defaults to no candidate cap and still honours an explicit cap', () => {
    expect(DEFAULT_DATE_SEARCH_OPTIONS.maxCandidates).toBeNull()
    expect(normalizeDateSearchOptions({}).maxCandidates).toBe(Infinity)
    expect(normalizeDateSearchOptions({ maxCandidates: null }).maxCandidates).toBe(Infinity)
    expect(normalizeDateSearchOptions({ maxCandidates: 10.4 }).maxCandidates).toBe(10)
    expect(normalizeDateSearchOptions({ maxCandidates: 0 }).maxCandidates).toBe(1)
  })

  it('searches every natural candidate start when no cap is configured', () => {
    const dataset = makeEphemeris(() => ({ az: 270, el: 2 }), 61 * 24)
    const window = getDateSearchWindow(dataset, { missionDays: 14 }, normalizeDateSearchOptions({ stepHours: 6 }))
    expect(window.naturalCandidates).toBe(189)
    expect(window.candidatesMs.length).toBe(189)
    expect(window.truncated).toBe(false)
    const stepMs = 6 * HOUR
    const lastCandidate = window.candidatesMs.at(-1)
    expect(lastCandidate).toBeLessThanOrEqual(window.latestStartMs)
    expect(window.latestStartMs - lastCandidate).toBeLessThan(stepMs)
  })

  it('reports candidate truncation through searchFeasibleDate warnings', () => {
    const dataset = makeEphemeris(() => ({ az: 270, el: -3 }), 61 * 24)
    const options = { stepHours: 6, evaluationStepSeconds: 3600, maxCandidates: 10 }
    const window = getDateSearchWindow(dataset, { missionDays: 14 }, normalizeDateSearchOptions(options))
    expect(window.naturalCandidates).toBe(189)
    expect(window.candidatesMs.length).toBe(10)
    expect(window.truncated).toBe(true)
    const result = searchFeasibleDate({
      terrain: makeTerrain(),
      zone: { id: 'z', name: 'Z', lat: -90, lon: 0, elevationM: 0 },
      ephemeris: dataset,
      mission: { missionDays: 14, sunDaysNeeded: 10, powerNeedW: 5000, batteryCapacityWh: 1000, startTime: new Date(START).toISOString() },
      options,
    })
    expect(result.hasFeasibleDate).toBe(false)
    expect(result.feasibleDatesSearched).toBe(10)
    expect(result.warnings).toContain(
      'candidate-limit-truncated: only 10 of 189 candidate starts were searched; results may miss a feasible date',
    )
  })
})

describe('rankLandingZones date search', () => {
  it('finds an earliest feasible start when the zone flips from shadow to sun', () => {
    const result = rank({
      terrain: makeTerrain(),
      ephemeris: makeEphemeris((hour) => ({ az: 270, el: hour < 96 ? -3 : 2 })),
    })
    const entry = result.zones[0]
    expect(entry.hasFeasibleDate).toBe(true)
    expect(Date.parse(entry.feasibleDate)).toBeGreaterThan(START)
    expect(Date.parse(entry.feasibleDate)).toBeLessThan(START + 10 * DAY)
    expect(entry.feasibleDatesSearched).toBeGreaterThan(1)
    expect(typeof entry.feasibleDateScore).toBe('number')
    expect(entry.feasible).toBe(true)
    expect(result.meta.dateSearch.enabled).toBe(true)
    expect(result.meta.dateSearch.message).toBe('ok')
    expect(result.meta.dateSearch.searchWindow.startMs).toBe(START)
    expect(result.meta.rankingRule).toBe('feasible-date-first-then-score')
  })

  it('reports no feasible date when no candidate passes the gate', () => {
    const result = rank({
      terrain: makeTerrain(),
      ephemeris: makeEphemeris(() => ({ az: 270, el: -3 })),
      mission: { powerNeedW: 5000, batteryCapacityWh: 1000 },
    })
    const entry = result.zones[0]
    expect(entry.hasFeasibleDate).toBe(false)
    expect(entry.feasibleDate).toBeNull()
    expect(entry.feasibleDateScore).toBeNull()
    expect(entry.feasibleDatesSearched).toBeGreaterThan(1)
    expect(result.meta.feasibility.message).toBe('no-feasible-zone')
    expect(result.meta.dateSearch.noFeasibleDate).toBe(true)
    expect(result.meta.dateSearch.message).toBe('no-feasible-date')
  })

  it('finds the earliest date for an RTG mission in permanent shadow', () => {
    const result = rank({
      terrain: makeTerrain(),
      ephemeris: makeEphemeris(() => ({ az: 270, el: -3 })),
      mission: { missionDays: 2, sunDaysNeeded: 10, powerSource: 'rtg', rtgPowerW: 1000 },
    })
    const entry = result.zones[0]
    expect(entry.hasFeasibleDate).toBe(true)
    expect(entry.feasibleDate).toBe(new Date(START).toISOString())
    expect(entry.feasibleDatesSearched).toBe(1)
    expect(result.meta.dateSearch.zonesWithFeasibleDate).toBe(1)
  })

  it('is deterministic and includes the search options in the signature', () => {
    const terrain = makeTerrain()
    const ephemeris = makeEphemeris((hour) => ({ az: 270, el: hour < 24 ? -3 : 2 }))
    const first = rank({ terrain, ephemeris })
    const second = rank({ terrain, ephemeris })
    expect(second.meta.inputSignature).toBe(first.meta.inputSignature)
    expect(second.zones[0].feasibleDate).toBe(first.zones[0].feasibleDate)
    expect(second.zones[0].feasibleDatesSearched).toBe(first.zones[0].feasibleDatesSearched)
    const coarser = rank({ terrain, ephemeris, options: { dateSearch: { stepHours: 24, evaluationStepSeconds: 1800 } } })
    expect(coarser.meta.inputSignature).not.toBe(first.meta.inputSignature)
    expect(coarser.meta.dateSearch.stepHours).toBe(24)
  })

  it('searchFeasibleDate returns the raw search result for one zone', () => {
    const terrain = makeTerrain()
    const zone = { id: 'z', name: 'Z', lat: -90, lon: 0, elevationM: 0 }
    const result = searchFeasibleDate({
      terrain,
      zone,
      ephemeris: makeEphemeris((hour) => ({ az: 270, el: hour < 48 ? -3 : 2 })),
      mission: { missionDays: 1, sunDaysNeeded: 0, powerNeedW: 120, startTime: new Date(START).toISOString() },
      options: { stepHours: 6 },
    })
    expect(result.hasFeasibleDate).toBe(true)
    expect(result.feasibleDateMs).toBeGreaterThan(START)
    expect(result.feasibleDatesSearched).toBeGreaterThan(1)
  })
})
