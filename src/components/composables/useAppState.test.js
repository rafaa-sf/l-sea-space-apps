import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION,
  MISSION_PERIMETER_BOUNDS,
  distanceFromSouthPoleKm,
  isLandingZoneSite,
  landingZoneDetectionOptions,
  missionAtStart,
  normalizeCustomCoordinates,
  sanitizeStoredMission,
  siteCoverage,
} from './useAppState.js'

/**
 * Regression tests for issue "perimeter shows an absurd value on tool entry":
 * a stored `lsea.mission` must never surface a perimeter outside the mission
 * input bounds, and a ranked landing-zone site must be recognisable as a
 * derived (read-only) perimeter instead of a mission requirement.
 */
describe('stored mission sanitisation', () => {
  it('falls back to the defaults for a missing or malformed payload', () => {
    expect(sanitizeStoredMission(null)).toEqual({ ...DEFAULT_MISSION })
    expect(sanitizeStoredMission(undefined)).toEqual({ ...DEFAULT_MISSION })
    expect(sanitizeStoredMission('not-an-object')).toEqual({ ...DEFAULT_MISSION })
    expect(sanitizeStoredMission(42)).toEqual({ ...DEFAULT_MISSION })
    expect(DEFAULT_MISSION.perimeterM).toBe(200)
    expect(MISSION_PERIMETER_BOUNDS).toEqual({ minM: 10, maxM: 5000 })
  })

  it('keeps a valid stored mission, coercing booleans and numeric strings', () => {
    const mission = sanitizeStoredMission({ missionDays: 30, perimeterM: '850', relayInOrbit: 1 })
    expect(mission.missionDays).toBe(30)
    expect(mission.perimeterM).toBe(850)
    expect(mission.relayInOrbit).toBe(true)
  })

  it('rejects a stored perimeter outside the mission input bounds', () => {
    const bad = [1e9, 35213, 5001, 9, 0, -5, 'abc', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]
    for (const value of bad) {
      expect(sanitizeStoredMission({ perimeterM: value }).perimeterM, String(value)).toBe(DEFAULT_MISSION.perimeterM)
    }
    const good = [MISSION_PERIMETER_BOUNDS.minM, 200, MISSION_PERIMETER_BOUNDS.maxM]
    for (const value of good) {
      expect(sanitizeStoredMission({ perimeterM: value }).perimeterM, String(value)).toBe(value)
    }
  })

  it('ignores non-numeric values for the remaining numeric inputs', () => {
    expect(sanitizeStoredMission({ powerNeedW: 'abc' }).powerNeedW).toBe(DEFAULT_MISSION.powerNeedW)
    expect(sanitizeStoredMission({ missionDays: 'abc' }).missionDays).toBe(DEFAULT_MISSION.missionDays)
  })

  it('drops the removed crater-avoidance flag from stored missions', () => {
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_MISSION, 'avoidCraters')).toBe(false)
    expect('avoidCraters' in sanitizeStoredMission({ avoidCraters: true })).toBe(false)
    expect('avoidCraters' in sanitizeStoredMission({ avoidCraters: false })).toBe(false)
    expect('avoidCraters' in sanitizeStoredMission({})).toBe(false)
    expect('avoidCraters' in sanitizeStoredMission({ avoidCraters: undefined })).toBe(false)
    expect('avoidCraters' in sanitizeStoredMission({ avoidCraters: null })).toBe(false)
  })
})

describe('landing-zone detection options', () => {
  it('ignores the removed mission crater-avoidance flag', () => {
    expect(landingZoneDetectionOptions({ avoidCraters: true })).toEqual({})
    expect(landingZoneDetectionOptions({ avoidCraters: false })).toEqual({})
    expect(landingZoneDetectionOptions({})).toEqual({})
    expect(landingZoneDetectionOptions(undefined)).toEqual({})
    expect(landingZoneDetectionOptions(null)).toEqual({})
    expect(landingZoneDetectionOptions({ avoidCraters: 'yes' })).toEqual({})
  })
})

describe('landing-zone derived site', () => {
  it('recognises the transient site created from a ranked landing zone', () => {
    expect(isLandingZoneSite({ id: 'zone-42', zoneId: 42, perimeterM: 46781.27 })).toBe(true)
    expect(isLandingZoneSite({ id: 'zone-42', zoneId: 0 })).toBe(true)
  })

  it('does not flag curated or custom sites', () => {
    expect(isLandingZoneSite({ id: 'shackleton-rim', perimeterM: 200 })).toBe(false)
    expect(isLandingZoneSite({ id: 'custom-1', source: 'custom', perimeterM: 200 })).toBe(false)
    expect(isLandingZoneSite(null)).toBe(false)
    expect(isLandingZoneSite(undefined)).toBe(false)
  })
})


describe('task-59 correctness guards', () => {
  it('rejects empty or out-of-range custom coordinates (BH-13/BH-05)', () => {
    expect(normalizeCustomCoordinates({ lat: '', lon: '0' })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: '0', lon: '' })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: null, lon: 0 })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: Number.NaN, lon: 0 })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: 91, lon: 0 })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: -91, lon: 0 })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: -89.5, lon: 361 })).toBeNull()
    expect(normalizeCustomCoordinates({ lat: -89.5, lon: 200 })).toEqual({ lat: -89.5, lon: -160 })
    expect(normalizeCustomCoordinates({ lat: ' -89.5 ', lon: '0' })).toEqual({ lat: -89.5, lon: 0 })
  })

  it('pins the selected date into the mission passed to analysis (BH-07)', () => {
    const start = '2026-12-01T18:00:00.000Z'
    const mission = missionAtStart({ missionDays: 14, powerNeedW: 120 }, start)
    expect(mission.startTime).toBe(start)
    expect(mission.missionDays).toBe(14)
    expect(missionAtStart({ missionDays: 2 }, 'not-a-date').startTime).toBeUndefined()
  })

  it('marks a site outside the DEM as uncovered (BH-04)', () => {
    const terrain = {
      minX: -304000,
      maxX: 304000,
      minY: -304000,
      maxY: 304000,
      datum: 1737400,
      width: 2048,
      height: 2048,
    }
    expect(siteCoverage({ lat: -89.5, lon: 0 }, terrain).covered).toBe(true)
    const outside = siteCoverage({ lat: -70, lon: 0 }, terrain)
    expect(outside.covered).toBe(false)
    expect(outside.reason).toBe('site-outside-dem')
    expect(siteCoverage({ lat: -89.5, lon: 0 }, null).reason).toBe('no-terrain')
  })

  it('computes a finite distance from the pole at both poles (BH-05)', () => {
    expect(distanceFromSouthPoleKm(-90)).toBeCloseTo(0, 3)
    const north = distanceFromSouthPoleKm(90)
    expect(Number.isFinite(north)).toBe(true)
    expect(north).toBeGreaterThan(5000)
    expect(distanceFromSouthPoleKm(91)).toBeNull()
    expect(distanceFromSouthPoleKm(Number.NaN)).toBeNull()
  })
})
