/**
 * Unit tests for the mission cycle computation: sunlight/eclipse intervals,
 * Earth direct-link gaps, relay gap filling, week splitting/clipping, interval
 * merging and determinism/signature.
 *
 * Synthetic analytic terrain/ephemeris only (no dependency on public/data).
 */

import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import {
  MISSION_CYCLES_MODEL_VERSION,
  computeCyclesSignature,
  computeMissionCycles,
  mergeWindows,
  partitionIntervals,
  splitWeeks,
} from './cycles.js'

const START = Date.parse('2026-11-01T00:00:00Z')
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/** Flat synthetic planar DEM (horizon ≈ 0). */
function makeTerrain({ id = 'cycles-test', bounds = 3200 } = {}) {
  const width = 64
  const height = 64
  const pixelSizeM = (2 * bounds) / width
  const data = new Float32Array(width * height).fill(0)
  return createProjectedTerrain(
    {
      id,
      referenceRadiusM: MOON_RADIUS_M,
      width,
      height,
      pixelSizeM,
      minX: -bounds,
      maxX: bounds,
      minY: -bounds,
      maxY: bounds,
      dtype: 'float32',
      synthetic: true,
    },
    data,
  )
}

/**
 * Synthetic 14-day ephemeris (30-min sampling) with caller-controlled bodies.
 *
 * @param {{hours?: number, sun?: (hour: number) => {az: number, el: number}, earth?: (hour: number) => {az: number, el: number}}} [options]
 */
function makeEphemeris({ hours = 14 * 24, sun, earth } = {}) {
  const samples = []
  for (let index = 0; index <= (hours * 60) / 30; index += 1) {
    const hour = (index * 30) / 60
    samples.push({
      time: new Date(START + index * 30 * 60 * 1000).toISOString(),
      sun: sun ? sun(hour) : { az: 270, el: 2 },
      earth: earth ? earth(hour) : { az: 90, el: 2 },
    })
  }
  return normalizeEphemerisDataset({ siteId: 'cycles-ephemeris', samples })
}

const SITE = { id: 'cycles-site', lat: -90, lon: 0, elevationM: 0 }
const MISSION = { missionDays: 14, startTime: new Date(START).toISOString(), relayInOrbit: false }

/** First 84 h of every week sunlit (+2°), otherwise shadowed (−2°). */
const weeklySun = (hour) => ({ az: 270, el: hour % 168 < 84 ? 2 : -2 })
/** First 24 h of every week Earth link (+2°), otherwise no link (−2°). */
const weeklyEarth = (hour) => ({ az: 90, el: hour % 168 < 24 ? 2 : -2 })

describe('interval helpers', () => {
  it('merges overlapping/touching windows and clips them', () => {
    const from = 0
    const to = 10 * HOUR
    const merged = mergeWindows(
      [
        { from: -1 * HOUR, to: 2 * HOUR },
        { from: 2 * HOUR, to: 4 * HOUR },
        { from: 6 * HOUR, to: 12 * HOUR },
      ],
      from,
      to,
    )
    expect(merged.length).toBe(2)
    expect(merged[0]).toEqual({ fromMs: 0, toMs: 4 * HOUR })
    expect(merged[1]).toEqual({ fromMs: 6 * HOUR, toMs: 10 * HOUR })
  })

  it('partitions into visible/complement intervals clipped at both edges', () => {
    const from = 2 * HOUR
    const to = 8 * HOUR
    const intervals = partitionIntervals(
      [
        { from: 0, to: 3 * HOUR },
        { from: 5 * HOUR, to: 6 * HOUR },
        { from: 7 * HOUR, to: 10 * HOUR },
      ],
      from,
      to,
      'sun',
      'eclipse',
    )
    expect(intervals.map((interval) => interval.kind)).toEqual(['sun', 'eclipse', 'sun', 'eclipse', 'sun'])
    expect(intervals[0].startMs).toBe(from)
    expect(intervals[intervals.length - 1].endMs).toBe(to)
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index].startMs).toBe(intervals[index - 1].endMs)
    }
    expect(intervals.reduce((total, interval) => total + interval.hours, 0)).toBeCloseTo(6, 6)
  })

  it('splits the window into 7-day blocks with a partial last week', () => {
    const weeks = splitWeeks(0, 10 * DAY)
    expect(weeks.length).toBe(2)
    expect(weeks[0].days).toBeCloseTo(7, 6)
    expect(weeks[1].days).toBeCloseTo(3, 6)
    expect(weeks[1].endMs).toBe(10 * DAY)
  })
})

describe('computeMissionCycles', () => {
  const terrain = makeTerrain()

  it('returns a complete window and two weekly summaries', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
    })
    expect(result.meta.modelVersion).toBe(MISSION_CYCLES_MODEL_VERSION)
    expect(result.window.days).toBeCloseTo(14, 2)
    expect(result.window.startMs).toBe(START)
    expect(result.window.endMs).toBe(START + 14 * DAY)
    expect(result.weeks.length).toBe(2)
    expect(result.weeks.map((week) => week.index)).toEqual([1, 2])
    expect(result.weeks[0].start).toBe(new Date(START).toISOString())
    expect(result.weeks[1].end).toBe(new Date(START + 14 * DAY).toISOString())
  })

  it('computes sunlight/eclipse intervals and hours', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
    })
    expect(result.sunlight.sunHours).toBeCloseTo(168, 0)
    expect(result.sunlight.eclipseHours).toBeCloseTo(168, 0)
    expect(result.sunlight.sunPeriods).toBe(2)
    expect(result.sunlight.eclipseCount).toBe(2)
    expect(result.sunlight.intervals[0].startMs).toBe(result.window.startMs)
    expect(result.sunlight.intervals[result.sunlight.intervals.length - 1].endMs).toBe(result.window.endMs)
    for (const interval of result.sunlight.intervals) {
      expect(['sun', 'eclipse']).toContain(interval.kind)
      expect(interval.hours).toBeGreaterThan(0)
      expect(interval.start).toBe(new Date(interval.startMs).toISOString())
    }
    // Weekly split: each week has 84 h sun and 84 h eclipse.
    for (const week of result.weeks) {
      expect(week.sunHours).toBeCloseTo(84, 0)
      expect(week.eclipseHours).toBeCloseTo(84, 0)
      // Periods that cross a week boundary are counted in both weeks.
      expect(week.sunPeriods).toBeGreaterThanOrEqual(1)
      expect(week.eclipsePeriods).toBeGreaterThanOrEqual(1)
    }
  })

  it('computes direct Earth-link intervals, gaps and per-week split', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
    })
    expect(result.direct.linkHours).toBeCloseTo(48, 0)
    expect(result.direct.gapHours).toBeCloseTo(288, 0)
    expect(result.direct.linkPeriods).toBe(2)
    expect(result.direct.gapCount).toBe(2)
    expect(result.effective.source).toBe('direct')
    expect(result.effective.linkHours).toBe(result.direct.linkHours)
    expect(result.weeks[0].linkHours).toBeCloseTo(24, 0)
    expect(result.weeks[0].gapHours).toBeCloseTo(144, 0)
  })

  it('relay fills the direct-link gaps and reports the benefit', () => {
    const ephemeris = makeEphemeris({ sun: weeklySun, earth: weeklyEarth })
    const withoutRelay = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris,
      mission: MISSION,
    })
    const fullRelay = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris,
      mission: { ...MISSION, relayInOrbit: true, comms: { relayCoverage: 1 } },
    })
    expect(fullRelay.relay.enabled).toBe(true)
    expect(fullRelay.relay.linkHours).toBeCloseTo(336, 0)
    expect(fullRelay.relay.gapHours).toBeCloseTo(0, 0)
    expect(fullRelay.relay.benefitHours).toBeCloseTo(336 - withoutRelay.direct.linkHours, 0)
    expect(fullRelay.effective.source).toBe('relay')
    expect(fullRelay.effective.linkHours).toBe(fullRelay.relay.linkHours)
    expect(fullRelay.relay.intervals.length).toBe(1)
    expect(fullRelay.relay.intervals[0].kind).toBe('link')

    // Partial relay coverage: the union must still be better than direct only.
    const partialRelay = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris,
      mission: { ...MISSION, relayInOrbit: true, comms: { relayCoverage: 0.5, relayPeriodMinutes: 1440 } },
    })
    expect(partialRelay.relay.linkHours).toBeGreaterThan(withoutRelay.direct.linkHours)
    expect(partialRelay.relay.gapHours).toBeLessThan(withoutRelay.direct.gapHours)
    expect(partialRelay.relay.benefitHours).toBeCloseTo(
      partialRelay.relay.linkHours - withoutRelay.direct.linkHours,
      1,
    )
    expect(partialRelay.relay.benefitHours).toBeGreaterThan(0)
    // Every row is a full partition of the window.
    expect(partialRelay.relay.linkHours + partialRelay.relay.gapHours).toBeCloseTo(336, 0)
  })

  it('reports zero relay benefit when the relay is disabled', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
    })
    expect(result.relay.enabled).toBe(false)
    expect(result.relay.benefitHours).toBe(0)
    expect(result.relay.benefitFraction).toBe(0)
    expect(result.relay.intervals).toEqual([])
    expect(result.effective.source).toBe('direct')
    expect(result.relay.linkHours).toBe(result.direct.linkHours)
  })

  it('clips intervals and splits partial weeks when the window starts mid-day', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: { missionDays: 10, startTime: '2026-11-01T12:00:00Z' },
    })
    const expectedStart = Date.parse('2026-11-01T12:00:00Z')
    expect(result.window.startMs).toBe(expectedStart)
    expect(result.weeks.length).toBe(2)
    expect(result.weeks[1].days).toBeCloseTo(3, 2)
    expect(result.sunlight.intervals[0].startMs).toBe(expectedStart)
    expect(result.sunlight.intervals[result.sunlight.intervals.length - 1].endMs).toBe(result.window.endMs)
    const totalSun = result.weeks.reduce((total, week) => total + week.sunHours, 0)
    expect(totalSun).toBeCloseTo(result.sunlight.sunHours, 1)
    const totalEclipse = result.weeks.reduce((total, week) => total + week.eclipseHours, 0)
    expect(totalEclipse).toBeCloseTo(result.sunlight.eclipseHours, 1)
  })

  it('warns when no terrain is available but keeps a valid shape', () => {
    const result = computeMissionCycles({
      terrain: null,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
    })
    expect(result.meta.warnings.join(' ')).toContain('no-terrain')
    expect(result.sunlight.sunHours).toBeCloseTo(336, 0)
    expect(result.effective.linkHours).toBeGreaterThan(0)
  })

  it('caps the sampling step at 30 minutes', () => {
    const result = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris: makeEphemeris({ sun: weeklySun, earth: weeklyEarth }),
      mission: MISSION,
      options: { stepSeconds: 3600 },
    })
    expect(result.meta.samplingSeconds).toBe(1800)
  })

  it('is deterministic and changes its signature with the inputs', () => {
    const ephemeris = makeEphemeris({ sun: weeklySun, earth: weeklyEarth })
    const first = computeMissionCycles({ terrain, site: SITE, ephemeris, mission: MISSION })
    const second = computeMissionCycles({ terrain, site: SITE, ephemeris, mission: MISSION })
    expect(second.meta.inputSignature).toBe(first.meta.inputSignature)
    expect(first.meta.inputSignature).toMatch(/^[0-9a-f]{8}$/)
    const strip = (result) => ({ ...result, meta: { ...result.meta, computedAt: null, computeMs: null } })
    expect(JSON.stringify(strip(second))).toBe(JSON.stringify(strip(first)))

    const relaySignature = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris,
      mission: { ...MISSION, relayInOrbit: true, comms: { relayCoverage: 1 } },
    }).meta.inputSignature
    expect(relaySignature).not.toBe(first.meta.inputSignature)

    const timeSignature = computeMissionCycles({
      terrain,
      site: SITE,
      ephemeris,
      mission: { ...MISSION, startTime: '2026-11-02T00:00:00Z' },
    }).meta.inputSignature
    expect(timeSignature).not.toBe(first.meta.inputSignature)

    const terrainSignature = computeMissionCycles({
      terrain: makeTerrain({ id: 'other-region' }),
      site: SITE,
      ephemeris,
      mission: MISSION,
    }).meta.inputSignature
    expect(terrainSignature).not.toBe(first.meta.inputSignature)

    expect(computeCyclesSignature({ terrain, site: SITE, mission: MISSION, ephemeris, options: {} })).toMatch(
      /^[0-9a-f]{8}$/,
    )
  })

  it('throws without an ephemeris', () => {
    expect(() => computeMissionCycles({ terrain, site: SITE, ephemeris: null, mission: MISSION })).toThrow(TypeError)
    expect(() => computeMissionCycles({ terrain, ephemeris: makeEphemeris(), mission: MISSION })).toThrow(TypeError)
  })
})
