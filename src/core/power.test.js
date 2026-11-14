/**
 * Unit tests for the solar power model: panel incidence, terrain shadowing and
 * the integrated average/peak/daily energy figures.
 */

import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import {
  DEFAULT_POWER_MODEL,
  normalizePowerModel,
  panelPowerW,
  solarPowerEstimate,
} from './power.js'

const START = '2026-11-01T00:00:00Z'
const START_MS = Date.parse(START)

/**
 * Flat synthetic terrain (horizon ≈ 0).
 *
 * @param {{elevationM?: number}} [options]
 * @returns {import('./terrain.js').Terrain}
 */
function flatTerrain(options = {}) {
  const width = 65
  const height = 65
  const boundsM = 40000
  const data = new Float32Array(width * height).fill(options.elevationM ?? 0)
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
    data,
  )
}

/**
 * Synthetic 48-hour ephemeris with a constant Sun and Earth position.
 *
 * @param {{sun: {az: number, el: number}, earth?: {az: number, el: number}, hours?: number}} options
 * @returns {import('./ephemeris.js').EphemerisDataset}
 */
function constantEphemeris({ sun, earth = { az: 180, el: 2 }, hours = 48 }) {
  const samples = []
  for (let index = 0; index <= (hours * 60) / 30; index += 1) {
    samples.push({
      time: new Date(START_MS + index * 30 * 60 * 1000).toISOString(),
      sun,
      earth,
    })
  }
  return normalizeEphemerisDataset({ siteId: 'power-test', samples })
}

const SITE = { lat: -89.5, lon: 90 }

describe('panelPowerW', () => {
  it('uses the solar constant, area, efficiency and derate', () => {
    const model = normalizePowerModel({})
    const expected =
      DEFAULT_POWER_MODEL.solarConstantWm2 *
      DEFAULT_POWER_MODEL.panelAreaM2 *
      DEFAULT_POWER_MODEL.panelEfficiency *
      DEFAULT_POWER_MODEL.systemDerate
    // A vertical panel tracking the azimuth sees cos(el) ≈ 1 at the horizon.
    expect(panelPowerW({ az: 0, el: 0 }, model)).toBeCloseTo(expected, 3)
    expect(panelPowerW({ az: 90, el: 0 }, model)).toBeCloseTo(expected, 3)
  })

  it('models horizontal and fixed-orientation panels', () => {
    const horizontal = normalizePowerModel({ panelNormalElevationDeg: 90 })
    expect(panelPowerW({ az: 0, el: 0 }, horizontal)).toBeCloseTo(0, 6)
    expect(panelPowerW({ az: 0, el: 90 }, horizontal)).toBeCloseTo(
      DEFAULT_POWER_MODEL.solarConstantWm2 *
        DEFAULT_POWER_MODEL.panelAreaM2 *
        DEFAULT_POWER_MODEL.panelEfficiency *
        DEFAULT_POWER_MODEL.systemDerate,
      3,
    )
    const fixed = normalizePowerModel({ trackingAzimuth: false, panelAzimuthDeg: 0, panelNormalElevationDeg: 0 })
    expect(panelPowerW({ az: 90, el: 0 }, fixed)).toBeCloseTo(0, 6)
  })

  it('returns zero for missing or hidden Sun data', () => {
    expect(panelPowerW(null)).toBe(0)
    const horizontal = normalizePowerModel({ panelNormalElevationDeg: 90 })
    expect(panelPowerW({ az: 0, el: -2 }, horizontal)).toBe(0)
  })
})

describe('solarPowerEstimate', () => {
  it('integrates a constant sunlit case', () => {
    const ephemeris = constantEphemeris({ sun: { az: 270, el: 1 } })
    const estimate = solarPowerEstimate(SITE, flatTerrain(), ephemeris, {
      missionDays: 2,
      startTime: START,
    })
    const expectedPanel = panelPowerW({ az: 270, el: 1 })
    expect(estimate.averageW).toBeCloseTo(expectedPanel, 0)
    expect(estimate.peakW).toBeCloseTo(expectedPanel, 0)
    expect(estimate.sunlitFraction).toBeCloseTo(1, 1)
    expect(estimate.dailyWh).toBeCloseTo(expectedPanel * 24, 0)
    expect(estimate.unavailable).toBeFalsy()
  })

  it('returns zero when the Sun stays below the horizon', () => {
    const ephemeris = constantEphemeris({ sun: { az: 270, el: -5 } })
    const estimate = solarPowerEstimate(SITE, flatTerrain(), ephemeris, { missionDays: 2, startTime: START })
    expect(estimate.averageW).toBe(0)
    expect(estimate.peakW).toBe(0)
    expect(estimate.sunlitFraction).toBe(0)
  })

  it('flags a missing ephemeris instead of throwing', () => {
    const estimate = solarPowerEstimate(SITE, flatTerrain(), null)
    expect(estimate.unavailable).toBe(true)
    expect(estimate.reason).toBe('missing-ephemeris')
    expect(estimate.averageW).toBe(0)
  })

  it('clamps the mission window to the dataset coverage', () => {
    const ephemeris = constantEphemeris({ sun: { az: 270, el: 1 }, hours: 48 })
    const estimate = solarPowerEstimate(SITE, flatTerrain(), ephemeris, { missionDays: 10, startTime: START })
    expect(estimate.clamped).toBe(true)
    expect(estimate.windowDays).toBeLessThan(3)
  })
})
