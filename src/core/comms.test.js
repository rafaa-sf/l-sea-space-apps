/**
 * Unit tests for the communications model: Earth line-of-sight windows,
 * relay-in-orbit coverage and the data budget.
 */

import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import { commWindows, dataBudget, commSummary, normalizeCommsModel } from './comms.js'

const START = '2026-11-01T00:00:00Z'
const START_MS = Date.parse(START)

/**
 * Flat synthetic terrain (horizon ≈ 0).
 *
 * @returns {import('./terrain.js').Terrain}
 */
function flatTerrain() {
  const width = 65
  const height = 65
  const boundsM = 40000
  return createProjectedTerrain(
    {
      referenceRadiusM: MOON_RADIUS_M,
      width,
      height,
      pixelSizeM: (2 * boundsM) / width,
      minX: -boundsM,
      maxX: boundsM,
      minY: -boundsM,
      maxY: boundsM,
      dtype: 'float32',
    },
    new Float32Array(width * height),
  )
}

/**
 * Synthetic 24-hour ephemeris with a constant Earth elevation.
 *
 * @param {{earthEl: number, hours?: number, sunEl?: number}} options
 * @returns {import('./ephemeris.js').EphemerisDataset}
 */
function ephemeris({ earthEl, hours = 24, sunEl = 1 }) {
  const samples = []
  for (let index = 0; index <= (hours * 60) / 30; index += 1) {
    samples.push({
      time: new Date(START_MS + index * 30 * 60 * 1000).toISOString(),
      sun: { az: 270, el: sunEl },
      earth: { az: 180, el: earthEl },
    })
  }
  return normalizeEphemerisDataset({ siteId: 'comms-test', samples })
}

const SITE = { lat: -89.5, lon: 90 }

describe('commWindows', () => {
  it('returns a single full window when the Earth is above the horizon', () => {
    const windows = commWindows(SITE, flatTerrain(), ephemeris({ earthEl: 2 }), {}, START, START_MS + 24 * 3600 * 1000)
    expect(windows.length).toBe(1)
    expect(windows[0].source).toBe('earth')
    expect(windows[0].durationSeconds).toBeGreaterThan(23 * 3600)
  })

  it('returns no window when the Earth is below the horizon', () => {
    const windows = commWindows(SITE, flatTerrain(), ephemeris({ earthEl: -3 }), {}, START, START_MS + 24 * 3600 * 1000)
    expect(windows).toEqual([])
  })

  it('models relay-in-orbit coverage', () => {
    const mission = { relayInOrbit: true, missionDays: 1 }
    const continuous = commWindows(SITE, flatTerrain(), ephemeris({ earthEl: -3 }), mission, START, START_MS + 24 * 3600 * 1000)
    expect(continuous.length).toBe(1)
    expect(continuous[0].source).toBe('relay')

    const partial = commWindows(
      SITE,
      flatTerrain(),
      ephemeris({ earthEl: -3 }),
      {
        relayInOrbit: true,
        comms: { relayCoverage: 0.5, relayPeriodMinutes: 60 },
      },
      START,
      START_MS + 4 * 3600 * 1000,
    )
    expect(partial.length).toBe(4)
    expect(partial[0].durationSeconds).toBeCloseTo(1800, 0)
  })
})

describe('dataBudget', () => {
  it('sums window time and converts it to megabits', () => {
    const windows = [
      { from: START, to: new Date(START_MS + 3600 * 1000).toISOString(), durationSeconds: 3600 },
      { from: START, to: new Date(START_MS + 1800 * 1000).toISOString(), durationSeconds: 1800 },
    ]
    const budget = dataBudget(windows, { comms: { dataRateMbps: 1 } })
    expect(budget.totalSeconds).toBe(5400)
    expect(budget.estimatedMb).toBe(5400)
    expect(budget.estimatedMB).toBe(675)
    expect(budget.windowCount).toBe(2)
    expect(budget.averageMbps).toBe(1)
  })

  it('uses the relay data rate for relay windows', () => {
    const budget = dataBudget(
      [{ from: START, to: new Date(START_MS + 3600 * 1000).toISOString(), durationSeconds: 3600, source: 'relay' }],
      { comms: { dataRateMbps: 1, relayDataRateMbps: 4 } },
    )
    expect(budget.estimatedMb).toBe(14400)
  })

  it('reports whether the mission data need is covered', () => {
    const windows = [{ from: START, to: new Date(START_MS + 7200 * 1000).toISOString(), durationSeconds: 7200 }]
    const budget = dataBudget(windows, { dataNeedMb: 5000, comms: { dataRateMbps: 1 } })
    expect(budget.meetsDataNeed).toBe(true)
    expect(budget.marginMb).toBeCloseTo(2200, 0)
  })

  it('returns a zero budget for no windows', () => {
    const budget = dataBudget([], {})
    expect(budget.totalSeconds).toBe(0)
    expect(budget.estimatedMb).toBe(0)
    expect(budget.averageMbps).toBe(0)
  })
})

describe('commSummary and model normalization', () => {
  it('combines windows and budget', () => {
    const summary = commSummary(
      SITE,
      flatTerrain(),
      ephemeris({ earthEl: 2 }),
      {},
      START,
      START_MS + 12 * 3600 * 1000,
    )
    expect(summary.windows.length).toBe(1)
    expect(summary.budget.totalSeconds).toBeGreaterThan(11 * 3600)
    expect(summary.availabilityFraction).toBeGreaterThan(0.9)
  })

  it('clamps model values', () => {
    const model = normalizeCommsModel({ relayCoverage: 3, dataRateMbps: -2, relayPeriodMinutes: 0 })
    expect(model.relayCoverage).toBe(1)
    expect(model.dataRateMbps).toBe(0)
    expect(model.relayPeriodMinutes).toBe(120)
  })
})
