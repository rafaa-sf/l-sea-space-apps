/**
 * Unit tests for the historical mission presets used by the site comparator.
 */

import { describe, expect, it } from 'vitest'
import { MISSION_PRESETS, getMissionPreset } from './missionPresets.js'

describe('mission presets', () => {
  it('ships a frozen, non-empty preset list with unique ids', () => {
    expect(Array.isArray(MISSION_PRESETS)).toBe(true)
    expect(MISSION_PRESETS.length).toBeGreaterThan(0)
    expect(Object.isFrozen(MISSION_PRESETS)).toBe(true)
    const ids = MISSION_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every preset the fields the comparator consumes', () => {
    for (const preset of MISSION_PRESETS) {
      expect(typeof preset.id).toBe('string')
      expect(preset.id.length).toBeGreaterThan(0)
      expect(typeof preset.year).toBe('number')
      expect(Number.isFinite(preset.year)).toBe(true)
      expect(typeof preset.source).toBe('string')
      expect(preset.source.length).toBeGreaterThan(0)
      expect(preset.mission).toBeTypeOf('object')
      expect(typeof preset.mission.missionDays).toBe('number')
      expect(Number.isFinite(preset.mission.missionDays)).toBe(true)
      expect(typeof preset.mission.powerNeedW).toBe('number')
      expect(Number.isFinite(preset.mission.powerNeedW)).toBe(true)
    }
  })

  it('looks presets up by id and returns null for unknown ids', () => {
    const apollo11 = MISSION_PRESETS.find((preset) => preset.id === 'apollo11')
    expect(apollo11).toBeTruthy()
    expect(getMissionPreset('apollo11')).toBe(apollo11)
    expect(getMissionPreset('nope')).toBeNull()
    expect(getMissionPreset(undefined)).toBeNull()
  })
})
