/**
 * Worker-boundary validation tests (audit SEC-04).
 *
 * The core engine and terrain functions clamp their own loop-driving options;
 * these tests cover the extra validation applied to messages the worker
 * receives, so hostile step/radius values never reach the heavy loops.
 */

import { describe, expect, it } from 'vitest'
import { createSyntheticTerrain, MAX_AREA_RADIUS_M } from '../core/terrain.js'
import {
  DEFAULT_MAX_DISTANCE_M,
  MAX_HORIZON_STEP_DEG,
  MAX_HORIZON_STEP_METERS,
  MIN_HORIZON_STEP_DEG,
  MIN_HORIZON_STEP_METERS,
} from '../core/engine.js'
import { runTask, sanitizeTaskOptions } from './tasks.js'

const SITE = { lat: -89.5, lon: 0, elevationM: 0 }

/** Small deterministic terrain used only to exercise the worker boundary. */
function makeTerrain() {
  return createSyntheticTerrain({ width: 65, height: 65, boundsM: 32000, noiseM: 0 })
}

describe('worker task option sanitization (SEC-04)', () => {
  it('clamps stepDeg to the documented azimuth range', () => {
    expect(sanitizeTaskOptions({ stepDeg: 1e-9 }).stepDeg).toBe(MIN_HORIZON_STEP_DEG)
    expect(sanitizeTaskOptions({ stepDeg: 1e9 }).stepDeg).toBe(MAX_HORIZON_STEP_DEG)
    expect(sanitizeTaskOptions({ stepDeg: Number.NaN }).stepDeg).toBe(1)
    expect(sanitizeTaskOptions({ stepDeg: 2 }).stepDeg).toBe(2)
  })

  it('clamps maxDistanceM to the documented range', () => {
    expect(sanitizeTaskOptions({ maxDistanceM: 1 }).maxDistanceM).toBe(1000)
    expect(sanitizeTaskOptions({ maxDistanceM: 1e12 }).maxDistanceM).toBe(
      DEFAULT_MAX_DISTANCE_M,
    )
    expect(sanitizeTaskOptions({ maxDistanceM: Number.POSITIVE_INFINITY }).maxDistanceM).toBe(
      DEFAULT_MAX_DISTANCE_M,
    )
  })

  it('clamps radiusM to the documented range', () => {
    expect(sanitizeTaskOptions({ radiusM: 1e12 }).radiusM).toBe(MAX_AREA_RADIUS_M)
    expect(sanitizeTaskOptions({ radiusM: 0 }).radiusM).toBe(200)
    expect(sanitizeTaskOptions({ radiusM: 42 }).radiusM).toBe(42)
  })

  it('clamps or drops stepMeters', () => {
    expect(sanitizeTaskOptions({ stepMeters: 1e-9 }).stepMeters).toBe(MIN_HORIZON_STEP_METERS)
    expect(sanitizeTaskOptions({ stepMeters: 1e9 }).stepMeters).toBe(MAX_HORIZON_STEP_METERS)
    expect('stepMeters' in sanitizeTaskOptions({ stepMeters: 0 })).toBe(false)
    expect('stepMeters' in sanitizeTaskOptions({ stepMeters: 'not-a-number' })).toBe(false)
  })

  it('does not mutate the payload options and tolerates non-objects', () => {
    const options = { stepDeg: 1e-9, radiusM: 1e12, stepMeters: 1e-9 }
    const sanitized = sanitizeTaskOptions(options)
    expect(options).toEqual({ stepDeg: 1e-9, radiusM: 1e12, stepMeters: 1e-9 })
    expect(sanitized).not.toBe(options)
    expect(sanitizeTaskOptions(undefined)).toEqual({})
    expect(sanitizeTaskOptions(null)).toEqual({})
  })

  it('runs horizonProfile with hostile options through runTask', async () => {
    const result = await runTask('horizonProfile', {
      terrain: makeTerrain(),
      site: SITE,
      options: { stepDeg: 10, stepMeters: 1e-9, maxDistanceM: 100 },
    })

    expect(result.profile.count).toBe(36)
    expect(result.profile.maxDistanceM).toBe(1000)
    expect(result.profile.angles.every(Number.isFinite)).toBe(true)
  })

  it('runs terrainStats with a hostile radius through runTask', async () => {
    const result = await runTask('terrainStats', {
      terrain: makeTerrain(),
      site: SITE,
      options: { radiusM: 1e12 },
    })

    expect(result.stats.radiusM).toBe(MAX_AREA_RADIUS_M)
    expect(result.stats.sampleCount).toBeGreaterThan(0)
    expect(result.stats.sampleCount).toBeLessThan(1000000)
  })
})
