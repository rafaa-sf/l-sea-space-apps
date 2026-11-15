import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION,
  MISSION_PERIMETER_BOUNDS,
  isLandingZoneSite,
  landingZoneDetectionOptions,
  sanitizeStoredMission,
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

  it('keeps the stored crater-avoidance flag and defaults it to false', () => {
    expect(DEFAULT_MISSION.avoidCraters).toBe(false)
    expect(sanitizeStoredMission({ avoidCraters: true }).avoidCraters).toBe(true)
    expect(sanitizeStoredMission({ avoidCraters: false }).avoidCraters).toBe(false)
    expect(sanitizeStoredMission({}).avoidCraters).toBe(false)
    expect(sanitizeStoredMission({ avoidCraters: undefined }).avoidCraters).toBe(false)
    expect(sanitizeStoredMission({ avoidCraters: null }).avoidCraters).toBe(false)
  })
})

describe('landing-zone detection options', () => {
  it('forwards only a real mission crater-avoidance flag', () => {
    expect(landingZoneDetectionOptions({ avoidCraters: true })).toEqual({ avoidCraters: true })
    expect(landingZoneDetectionOptions({ avoidCraters: false })).toEqual({ avoidCraters: false })
    expect(landingZoneDetectionOptions({})).toEqual({ avoidCraters: false })
    expect(landingZoneDetectionOptions(undefined)).toEqual({ avoidCraters: false })
    expect(landingZoneDetectionOptions(null)).toEqual({ avoidCraters: false })
    expect(landingZoneDetectionOptions({ avoidCraters: 'yes' })).toEqual({ avoidCraters: false })
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
