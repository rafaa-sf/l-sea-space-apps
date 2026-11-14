/**
 * Unit tests for the autopilot scoring and ranking: component formulas,
 * human-readable reasons, data-quality warnings and deterministic ordering.
 *
 * Two synthetic sites are compared:
 * - `crater-floor`: inside a ring wall, so the Sun and Earth are always blocked,
 * - `flat-ridge`: on flat terrain with a clear horizon.
 */

import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_M } from './geometry.js'
import { lonLatToXY } from './terrain.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import {
  DEFAULT_MISSION,
  SCORE_WEIGHTS,
  normalizeMission,
  normalizeSiteForScoring,
  resolveEphemerisForSite,
  resolveTerrainForSite,
  scoreSite,
  rankSites,
  rankingSummary,
  gradeForScore,
} from './autopilot.js'

const START = '2026-11-01T00:00:00Z'
const START_MS = Date.parse(START)

const SITE_A = { id: 'crater-floor', name: 'Crater floor', lat: -89.5, lon: 90, elevationM: 0, perimeterM: 200, mastM: 10 }
const SITE_B = { id: 'flat-ridge', name: 'Flat ridge', lat: -89.5, lon: 270, elevationM: 0, perimeterM: 200, mastM: 10 }
const SITE_A_XY = lonLatToXY(SITE_A.lat, SITE_A.lon)
const SITE_B_XY = lonLatToXY(SITE_B.lat, SITE_B.lon)

/**
 * Terrain with a ring wall around site A and flat ground elsewhere.
 *
 * @returns {import('./terrain.js').Terrain}
 */
function pitTerrain() {
  const width = 321
  const height = 321
  const boundsM = 40000
  const pixelSizeM = (2 * boundsM) / width
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = -boundsM + (col + 0.5) * pixelSizeM
      const y = boundsM - (row + 0.5) * pixelSizeM
      const distanceFromA = Math.hypot(x - SITE_A_XY.x, y - SITE_A_XY.y)
      if (distanceFromA > 2000 && distanceFromA < 4000) data[row * width + col] = 1500
      else data[row * width + col] = 0
    }
  }
  return createProjectedTerrain(
    {
      referenceRadiusM: MOON_RADIUS_M,
      id: 'pit-test',
      width,
      height,
      pixelSizeM,
      minX: -boundsM,
      maxX: boundsM,
      minY: -boundsM,
      maxY: boundsM,
      dtype: 'float32',
      attribution: 'test',
    },
    data,
  )
}

/**
 * 48-hour synthetic ephemeris: Sun and Earth fixed in the sky.
 *
 * @returns {import('./ephemeris.js').EphemerisDataset}
 */
function makeEphemeris() {
  const samples = []
  for (let index = 0; index <= 96; index += 1) {
    samples.push({
      time: new Date(START_MS + index * 30 * 60 * 1000).toISOString(),
      sun: { az: 270, el: 1.5 },
      earth: { az: 90, el: 5 },
    })
  }
  return normalizeEphemerisDataset({ siteId: 'autopilot-test', samples })
}

const MISSION = {
  missionDays: 2,
  powerNeedW: 120,
  relayInOrbit: false,
  sunDaysNeeded: 2,
  perimeterM: 200,
  mastM: 10,
  startTime: START,
}

describe('mission profile normalization', () => {
  it('merges defaults and nested models', () => {
    const mission = normalizeMission({ missionDays: 7, powerNeedW: 200 })
    expect(mission.missionDays).toBe(7)
    expect(mission.powerNeedW).toBe(200)
    expect(mission.sunDaysNeeded).toBe(DEFAULT_MISSION.sunDaysNeeded)
    expect(mission.power.panelAreaM2).toBe(DEFAULT_MISSION.power.panelAreaM2)
    expect(mission.comms.dataRateMbps).toBe(DEFAULT_MISSION.comms.dataRateMbps)
  })

  it('clamps invalid values', () => {
    const mission = normalizeMission({ missionDays: -4, sunDaysNeeded: -1, powerNeedW: -10 })
    expect(mission.missionDays).toBeGreaterThan(0)
    expect(mission.sunDaysNeeded).toBe(0)
    expect(mission.powerNeedW).toBe(0)
  })

  it('weights sum to one', () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((total, weight) => total + weight, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('maps scores to grades', () => {
    expect(gradeForScore(92).grade).toBe('excellent')
    expect(gradeForScore(70).grade).toBe('good')
    expect(gradeForScore(50).grade).toBe('fair')
    expect(gradeForScore(10).grade).toBe('poor')
  })
})

describe('ephemeris and terrain resolution', () => {
  it('resolves a shared dataset, a map and a function', () => {
    const dataset = makeEphemeris()
    expect(resolveEphemerisForSite(dataset, SITE_A).shared).toBe(true)
    expect(resolveEphemerisForSite(new Map([[SITE_A.id, dataset]]), SITE_A).dataset).toBeTruthy()
    expect(resolveEphemerisForSite((site) => (site.id === SITE_A.id ? dataset : null), SITE_A).dataset).toBeTruthy()
    expect(resolveEphemerisForSite(null, SITE_A).dataset).toBeNull()
  })

  it('resolves terrain by coverage', () => {
    const terrain = pitTerrain()
    const resolved = resolveTerrainForSite([terrain], SITE_A)
    expect(resolved.terrain).toBe(terrain)
    expect(resolved.outside).toBe(false)
    expect(resolveTerrainForSite(null, SITE_A).terrain).toBeNull()
  })

  it('normalizes partial site records', () => {
    const site = normalizeSiteForScoring({ id: 'x', lat: -89, lon: 12 })
    expect(site.name).toBe('x')
    expect(site.source).toBe('poi')
    expect(site.elevationM).toBeNull()
  })
})

describe('scoreSite', () => {
  const terrain = pitTerrain()
  const ephemeris = makeEphemeris()

  it('ranks a flat illuminated site above a crater floor', () => {
    const flat = scoreSite({ site: SITE_B, terrain, ephemeris, mission: MISSION })
    const pit = scoreSite({ site: SITE_A, terrain, ephemeris, mission: MISSION })
    expect(flat.score).toBeGreaterThan(pit.score)
    expect(flat.components.sun).toBeGreaterThan(pit.components.sun)
    expect(pit.components.sun).toBe(0)
  })

  it('returns the documented score structure', () => {
    const score = scoreSite({ site: SITE_B, terrain, ephemeris, mission: MISSION })
    expect(score.siteId).toBe('flat-ridge')
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.score).toBeLessThanOrEqual(100)
    expect(score.rank ?? null).toBeNull()
    expect(score.grade).toBeTruthy()
    expect(score.components).toEqual({
      sun: expect.any(Number),
      power: expect.any(Number),
      comms: expect.any(Number),
      terrain: expect.any(Number),
      logistics: expect.any(Number),
    })
    expect(score.metrics.averageW).toBeGreaterThan(0)
    expect(score.metrics.meanSlopeDeg).toBeGreaterThanOrEqual(0)
    expect(score.metrics.terrainId).toBe('pit-test')
  })

  it('produces human-readable reasons with codes, severities and text', () => {
    const flat = scoreSite({ site: SITE_B, terrain, ephemeris, mission: MISSION })
    expect(flat.reasons.length).toBeGreaterThan(3)
    for (const reason of flat.reasons) {
      expect(typeof reason.code).toBe('string')
      expect(['good', 'warn', 'bad']).toContain(reason.severity)
      expect(typeof reason.text).toBe('string')
      expect(reason.text.length).toBeGreaterThan(3)
      expect(reason.params).toBeTypeOf('object')
    }
    const codes = flat.reasons.map((reason) => reason.code)
    expect(codes).toContain('sun.continuous')
    expect(codes).toContain('power.margin')
    expect(codes).toContain('comms.directGood')

    const pit = scoreSite({ site: SITE_A, terrain, ephemeris, mission: MISSION })
    expect(pit.reasons.map((reason) => reason.code)).toContain('sun.continuousInsufficient')
  })

  it('degrades gracefully without an ephemeris', () => {
    const score = scoreSite({ site: SITE_B, terrain, ephemeris: null, mission: MISSION })
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.warnings.map((warning) => warning.code)).toContain('data.ephemerisMissing')
    expect(score.confidence).toBeLessThan(1)
    expect(score.components.sun).toBe(0)
  })

  it('degrades gracefully without terrain', () => {
    const score = scoreSite({ site: SITE_B, terrain: null, ephemeris, mission: MISSION })
    expect(score.warnings.map((warning) => warning.code)).toContain('data.terrainMissing')
    expect(score.confidence).toBeLessThan(1)
  })

  it('flags a shared ephemeris approximation', () => {
    const score = scoreSite({ site: SITE_B, terrain, ephemeris, mission: MISSION })
    expect(score.warnings.map((warning) => warning.code)).toContain('data.sharedEphemeris')
  })
})

describe('rankSites', () => {
  const terrain = pitTerrain()
  const ephemeris = makeEphemeris()

  it('orders sites best-first and assigns ranks', () => {
    const scores = rankSites({ sites: [SITE_A, SITE_B], terrain, ephemeris, mission: MISSION })
    expect(scores.length).toBe(2)
    expect(scores[0].siteId).toBe('flat-ridge')
    expect(scores[0].rank).toBe(1)
    expect(scores[1].rank).toBe(2)
    expect(scores[0].score).toBeGreaterThanOrEqual(scores[1].score)
  })

  it('is deterministic across runs', () => {
    const first = rankSites({ sites: [SITE_A, SITE_B], terrain, ephemeris, mission: MISSION })
    const second = rankSites({ sites: [SITE_A, SITE_B], terrain, ephemeris, mission: MISSION })
    expect(second.map((entry) => [entry.siteId, entry.score])).toEqual(
      first.map((entry) => [entry.siteId, entry.score]),
    )
  })

  it('survives invalid site entries', () => {
    const scores = rankSites({
      sites: [SITE_B, { id: 'broken', name: 'Broken', lat: 'nope', lon: 0 }],
      terrain,
      ephemeris,
      mission: MISSION,
    })
    expect(scores.length).toBe(2)
    expect(scores[0].siteId).toBe('flat-ridge')
    expect(scores[1].score).toBeNull()
    expect(scores[1].rank).toBeNull()
  })

  it('summarizes the ranking', () => {
    const scores = rankSites({ sites: [SITE_A, SITE_B], terrain, ephemeris, mission: MISSION })
    const summary = rankingSummary(scores)
    expect(summary.count).toBe(2)
    expect(summary.scoredCount).toBe(2)
    expect(summary.recommended).toBe('flat-ridge')
    expect(summary.averageScore).toBeGreaterThan(0)
  })
})
