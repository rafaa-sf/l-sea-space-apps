/**
 * Unit tests for landing-zone detection and zone-based autopilot ranking.
 *
 * Fixtures are synthetic analytic planar grids (meters, pixel-centre
 * georeferencing) so the expected slopes, areas and centroids are known
 * exactly; no dependency on `public/data`.
 */

import { describe, expect, it } from 'vitest'
import { DEG, MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain, lonLatToXY } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import {
  DEFAULT_ZONE_OPTIONS,
  chooseDownsample,
  detectLandingZones,
  normalizeZoneOptions,
  zoneSuitability,
} from './zones.js'
import {
  ZONE_EPHEMERIS_APPROXIMATION,
  landingZoneToSite,
  nearestCuratedSite,
  rankLandingZones,
  sortZoneEntriesByFeasibility,
} from './zoneAutopilot.js'

/**
 * Build a planar DEM whose sample node (col, row) sits at the sampler position.
 *
 * @param {{
 *   width: number,
 *   height: number,
 *   minX?: number,
 *   maxX?: number,
 *   minY?: number,
 *   maxY?: number,
 *   elevationFn: (x: number, y: number) => number,
 * }} options
 * @returns {import('./terrain.js').Terrain}
 */
function makePlane({ width, height, minX = -2400, maxX = 2400, minY = -2400, maxY = 2400, elevationFn }) {
  const pixelSizeM = (maxX - minX) / width
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = minX + (col + 0.5) * pixelSizeM
      const y = maxY - (row + 0.5) * pixelSizeM
      data[row * width + col] = elevationFn(x, y)
    }
  }
  return createProjectedTerrain(
    {
      id: 'zone-test',
      referenceRadiusM: MOON_RADIUS_M,
      width,
      height,
      pixelSizeM,
      minX,
      maxX,
      minY,
      maxY,
      dtype: 'float32',
      attribution: 'test',
      synthetic: true,
    },
    data,
  )
}

/**
 * Build a reduced latitude/longitude terrain grid.
 *
 * @param {{width: number, height: number, elevationFn: (lat: number, lon: number) => number}} options
 * @returns {Object}
 */
function makeLatLon({ width, height, elevationFn }) {
  const lat0 = -90
  const lat1 = -84
  const lon0 = 0
  const lon1 = 360
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    const lat = lat0 + ((lat1 - lat0) * row) / (height - 1)
    for (let col = 0; col < width; col += 1) {
      data[row * width + col] = elevationFn(lat, lon0 + ((lon1 - lon0) * col) / (width - 1))
    }
  }
  return { width, height, lat0, lon0, lat1, lon1, datum: MOON_RADIUS_M, data }
}

/**
 * Synthetic 24-hour ephemeris with constant Sun/Earth positions.
 *
 * @param {{sun?: {az: number, el: number}, earth?: {az: number, el: number}}} [options]
 * @returns {import('./ephemeris.js').EphemerisDataset}
 */
function makeEphemeris({ sun = { az: 270, el: 1.5 }, earth = { az: 90, el: 3 } } = {}) {
  const start = Date.parse('2026-11-01T00:00:00Z')
  const samples = []
  for (let index = 0; index <= 48; index += 1) {
    samples.push({
      time: new Date(start + index * 30 * 60 * 1000).toISOString(),
      sun,
      earth,
    })
  }
  return normalizeEphemerisDataset({ siteId: 'zone-ephemeris', samples })
}

const MISSION = {
  missionDays: 1,
  powerNeedW: 120,
  sunDaysNeeded: 0.5,
  perimeterM: 200,
  mastM: 10,
  startTime: '2026-11-01T00:00:00Z',
}

describe('zone options', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_ZONE_OPTIONS.maxSlopeDeg).toBe(8)
    expect(DEFAULT_ZONE_OPTIONS.minAreaKm2).toBe(1)
    expect(DEFAULT_ZONE_OPTIONS.maxZones).toBe(12)
  })

  it('clamps and normalizes options', () => {
    const options = normalizeZoneOptions({ maxSlopeDeg: -3, minAreaKm2: -1, maxZones: 0, maxRoughnessM: 0 })
    expect(options.maxSlopeDeg).toBeGreaterThan(0)
    expect(options.minAreaKm2).toBe(0)
    expect(options.maxZones).toBeGreaterThanOrEqual(1)
    expect(options.maxRoughnessM).toBeNull()
  })

  it('chooses a downsample stride for large grids', () => {
    expect(chooseDownsample(512, 512, 1100000)).toBe(1)
    expect(chooseDownsample(2048, 2048, 1100000)).toBe(2)
    expect(chooseDownsample(100, 100, 100)).toBeGreaterThan(1)
  })
})

describe('detectLandingZones', () => {
  it('finds one flat zone on a flat plane with the right area and centroid', () => {
    // Off-pole region so the centroid has non-degenerate latitude/longitude.
    const terrain = makePlane({
      width: 31,
      height: 31,
      minX: 50000,
      maxX: 53000,
      minY: -2000,
      maxY: 1000,
      elevationFn: () => 1234,
    })
    const dimensions = { minX: 50000, maxX: 53000, minY: -2000, maxY: 1000, width: 31, height: 31 }
    const pixel = (dimensions.maxX - dimensions.minX) / dimensions.width
    const result = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: null })
    expect(result.zones.length).toBe(1)
    const zone = result.zones[0]
    const interiorCells = 29 * 29
    const expectedAreaKm2 = (interiorCells * pixel * pixel) / 1e6
    expect(zone.areaKm2).toBeCloseTo(expectedAreaKm2, 3)
    expect(zone.cellCount).toBe(interiorCells)
    expect(zone.meanSlopeDeg).toBeCloseTo(0, 6)
    expect(zone.maxSlopeDeg).toBeCloseTo(0, 6)
    expect(zone.elevationM).toBeCloseTo(1234, 3)
    expect(zone.reliefM).toBeCloseTo(0, 3)
    // Centroid of the symmetric interior (cols/rows 1..29) is the mean node.
    expect(zone.xMeters).toBeCloseTo(51500, 1)
    expect(zone.yMeters).toBeCloseTo(-500, 1)
    // lat/lon round-trips to the projected centroid.
    const roundTrip = lonLatToXY(zone.lat, zone.lon)
    expect(roundTrip.x).toBeCloseTo(zone.xMeters, 0)
    expect(roundTrip.y).toBeCloseTo(zone.yMeters, 0)
    expect(result.meta.terrainKind).toBe('planar')
    expect(result.meta.zoneCount).toBe(1)
  })

  it('returns no zones on a uniformly steep gradient', () => {
    const terrain = makePlane({
      width: 64,
      height: 64,
      elevationFn: (x) => Math.tan(15 * DEG) * x,
    })
    const result = detectLandingZones(terrain, { minAreaKm2: 0.01 })
    expect(result.zones).toEqual([])
    expect(result.meta.candidateZones).toBe(0)
  })

  it('keeps only the flat half of a mixed terrain', () => {
    const terrain = makePlane({
      width: 64,
      height: 64,
      elevationFn: (x) => (x < 0 ? 0 : Math.tan(15 * DEG) * x),
    })
    const result = detectLandingZones(terrain, { minAreaKm2: 0.1 })
    expect(result.zones.length).toBe(1)
    expect(result.zones[0].xMeters).toBeLessThan(0)
  })

  it('applies the minimum area filter', () => {
    const terrain = makePlane({
      width: 64,
      height: 64,
      elevationFn: (x, y) => {
        const inPatch = Math.abs(x) < 250 && Math.abs(y) < 250
        return inPatch ? 0 : Math.tan(15 * DEG) * x + 2000
      },
    })
    const filtered = detectLandingZones(terrain, { minAreaKm2: 1, maxRoughnessM: 1e9 })
    expect(filtered.zones).toEqual([])

    const accepted = detectLandingZones(terrain, { minAreaKm2: 0, maxRoughnessM: 1e9 })
    expect(accepted.zones.length).toBe(1)
    expect(accepted.zones[0].areaKm2).toBeGreaterThan(0)
    expect(accepted.zones[0].areaKm2).toBeLessThan(1)
  })

  it('sorts zones largest/flattest first and respects maxZones', () => {
    const patches = [
      { centerX: -4000, halfWidth: 400 },
      { centerX: 0, halfWidth: 900 },
      { centerX: 4000, halfWidth: 650 },
    ]
    const terrain = makePlane({
      width: 161,
      height: 161,
      minX: -8000,
      maxX: 8000,
      minY: -8000,
      maxY: 8000,
      elevationFn: (x, y) => {
        for (const patch of patches) {
          if (Math.abs(x - patch.centerX) <= patch.halfWidth && Math.abs(y) <= 1500) return 0
        }
        return Math.tan(15 * DEG) * x
      },
    })
    const result = detectLandingZones(terrain, { minAreaKm2: 0.05, maxRoughnessM: null, maxZones: 2 })
    expect(result.meta.candidateZones).toBe(3)
    expect(result.zones.length).toBe(2)
    expect(result.zones[0].areaKm2).toBeGreaterThan(result.zones[1].areaKm2)
    // Zone ids are assigned in the safety order.
    expect(result.zones[0].id).toBe('zone-01')
    expect(result.zones[1].id).toBe('zone-02')
  })

  it('flags the area reduction caused by the roughness gate', () => {
    const terrain = makePlane({
      width: 64,
      height: 64,
      elevationFn: (x, y) => (Math.abs(x) < 50 && Math.abs(y) < 50 ? 100 : 0),
    })
    const withRoughness = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: 12 })
    const withoutRoughness = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: 1e9 })
    expect(withRoughness.zones.length).toBe(1)
    expect(withoutRoughness.zones.length).toBe(1)
    expect(withRoughness.zones[0].areaKm2).toBeLessThan(withoutRoughness.zones[0].areaKm2)
  })

  it('works on reduced latitude/longitude grids', () => {
    const terrain = makeLatLon({ width: 64, height: 64, elevationFn: () => -500 })
    const result = detectLandingZones(terrain, { minAreaKm2: 1, maxRoughnessM: null })
    expect(result.meta.terrainKind).toBe('latlon')
    expect(result.zones.length).toBeGreaterThan(0)
    const zone = result.zones[0]
    expect(zone.lat).toBeLessThanOrEqual(-84)
    expect(zone.lat).toBeGreaterThanOrEqual(-90)
    expect(Number.isFinite(zone.xMeters)).toBe(true)
    expect(Number.isFinite(zone.yMeters)).toBe(true)
  })

  it('downsamples large grids and reports the processing settings', () => {
    const terrain = makePlane({ width: 220, height: 220, elevationFn: () => 0 })
    const result = detectLandingZones(terrain, { minAreaKm2: 1, maxRoughnessM: null, maxCells: 6000 })
    expect(result.meta.stride).toBeGreaterThan(1)
    expect(result.meta.processedCells).toBeLessThanOrEqual(6000 + 220)
    expect(result.zones.length).toBeGreaterThan(0)
  })

  it('is tolerant of missing or tiny terrain', () => {
    expect(detectLandingZones(null).zones).toEqual([])
    expect(detectLandingZones({ width: 2, height: 2, data: new Float32Array(4) }).zones).toEqual([])
  })

  it('is deterministic for identical inputs', () => {
    const terrain = makePlane({ width: 64, height: 64, elevationFn: () => 0 })
    const first = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: null })
    const second = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: null })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('zoneSuitability', () => {
  it('prefers larger and flatter zones', () => {
    const largeFlat = zoneSuitability({ areaKm2: 100, meanSlopeDeg: 0.5, maxSlopeDeg: 1 }, 8)
    const smallFlat = zoneSuitability({ areaKm2: 2, meanSlopeDeg: 0.5, maxSlopeDeg: 1 }, 8)
    const largeSteep = zoneSuitability({ areaKm2: 100, meanSlopeDeg: 7, maxSlopeDeg: 8 }, 8)
    expect(largeFlat).toBeGreaterThan(smallFlat)
    expect(largeFlat).toBeGreaterThan(largeSteep)
  })
})

describe('nearestCuratedSite', () => {
  it('finds the closest site and its distance', () => {
    const sites = [
      { id: 'near', lat: -89.0, lon: 10 },
      { id: 'far', lat: -86.0, lon: 200 },
    ]
    const nearest = nearestCuratedSite({ lat: -89.01, lon: 10.5 }, sites)
    expect(nearest.site.id).toBe('near')
    expect(nearest.distanceM).toBeGreaterThan(0)
    expect(nearest.distanceM).toBeLessThan(50000)
    expect(nearestCuratedSite({ lat: -89, lon: 0 }, [])).toBeNull()
  })
})

describe('landingZoneToSite', () => {
  it('creates a scoring site with an equivalent circular perimeter', () => {
    const zone = {
      id: 'zone-01',
      name: 'Landing zone 01',
      lat: -89.5,
      lon: 120,
      areaKm2: 4,
      elevationM: -1200,
      meanSlopeDeg: 1.2,
    }
    const site = landingZoneToSite(zone, { mastM: 10 })
    expect(site.id).toBe('zone-01')
    expect(site.source).toBe('zone')
    expect(site.elevationM).toBe(-1200)
    expect(site.mastM).toBe(10)
    expect(site.perimeterM).toBeCloseTo(2 * Math.sqrt(Math.PI * 4e6), 0)
  })
})

describe('rankLandingZones', () => {
  const flatTerrain = () =>
    makePlane({ width: 64, height: 64, elevationFn: () => 0 })

  it('scores detected zones (not curated POIs) with the nearest-site ephemeris', () => {
    const terrain = flatTerrain()
    const zone = detectLandingZones(terrain, { minAreaKm2: 0.1, maxRoughnessM: null }).zones[0]
    const sites = [
      { id: 'anchor-near', name: 'Anchor near', lat: zone.lat, lon: zone.lon },
      { id: 'anchor-far', name: 'Anchor far', lat: zone.lat + 2, lon: zone.lon },
    ]
    const ephemeris = new Map([
      ['anchor-near', makeEphemeris()],
      ['anchor-far', makeEphemeris({ sun: { az: 270, el: -2 } })],
    ])
    const result = rankLandingZones({ terrain, ephemeris, sites, mission: MISSION })
    expect(result.zones.length).toBe(1)
    const entry = result.zones[0]
    expect(entry.zone.id).toBe(zone.id)
    expect(entry.rank).toBe(1)
    expect(entry.score).toBeGreaterThan(0)
    expect(entry.grade).toBeTruthy()
    expect(entry.ephemerisSiteId).toBe('anchor-near')
    expect(entry.nearestSiteId).toBe('anchor-near')
    expect(entry.warnings.map((warning) => warning.code)).toContain('ephemeris-nearest-site')
    expect(entry.reasons[0].code).toBe('zone.flatArea')
    expect(result.meta.zoneCount).toBe(1)
    expect(result.meta.scoredCount).toBe(1)
    expect(result.meta.ephemerisMode).toBe('nearest-curated-site')
    expect(result.meta.approximation).toBe(ZONE_EPHEMERIS_APPROXIMATION)
    expect(result.meta.ephemerisApproxMaxErrorDeg).toBe(0.1)
  })

  it('ranks multiple zones best-first and only reports warnings per zone', () => {
    const patches = [
      { centerX: -3000, halfWidth: 300 },
      { centerX: 3000, halfWidth: 900 },
    ]
    const terrain = makePlane({
      width: 129,
      height: 129,
      minX: -6000,
      maxX: 6000,
      minY: -6000,
      maxY: 6000,
      elevationFn: (x, y) => {
        for (const patch of patches) {
          if (Math.abs(x - patch.centerX) <= patch.halfWidth && Math.abs(y) <= 1200) return 0
        }
        return Math.tan(15 * DEG) * x
      },
    })
    const result = rankLandingZones({
      terrain,
      ephemeris: makeEphemeris(),
      sites: [{ id: 'anchor', name: 'Anchor', lat: -89.9, lon: 0 }],
      mission: MISSION,
      options: { minAreaKm2: 0.1, maxRoughnessM: null },
    })
    expect(result.zones.length).toBe(2)
    expect(result.zones[0].rank).toBe(1)
    expect(result.zones[1].rank).toBe(2)
    expect(result.zones[0].score).toBeGreaterThanOrEqual(result.zones[1].score)
    for (const entry of result.zones) {
      expect(entry.zone.id).toMatch(/^zone-\d{2}$/)
      expect(entry.zone.areaKm2).toBeGreaterThan(0)
      expect(Array.isArray(entry.components) || typeof entry.components.sun === 'number').toBe(true)
    }
  })

  it('degrades gracefully without terrain, sites or ephemeris', () => {
    const empty = rankLandingZones({ terrain: null, ephemeris: null, sites: [], mission: MISSION })
    expect(empty.zones).toEqual([])
    expect(empty.meta.zoneCount).toBe(0)

    const terrain = flatTerrain()
    const noData = rankLandingZones({ terrain, ephemeris: null, sites: [], mission: MISSION })
    expect(noData.zones.length).toBe(1)
    const warnings = noData.zones[0].warnings.map((warning) => warning.code)
    expect(warnings).toContain('data.ephemerisMissing')
    expect(warnings).toContain('no-nearest-site')
    expect(noData.zones[0].ephemerisSiteId).toBeNull()
  })

  it('is deterministic for identical inputs', () => {
    const terrain = flatTerrain()
    const ephemeris = makeEphemeris()
    const sites = [{ id: 'anchor', name: 'Anchor', lat: -89.9, lon: 0 }]
    const first = rankLandingZones({ terrain, ephemeris, sites, mission: MISSION })
    const second = rankLandingZones({ terrain, ephemeris, sites, mission: MISSION })
    expect(second.zones.map((entry) => [entry.zone.id, entry.score])).toEqual(
      first.zones.map((entry) => [entry.zone.id, entry.score]),
    )
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})


describe('feasibility-first ranking', () => {
  const flatTerrain = () => makePlane({ width: 64, height: 64, elevationFn: () => 0 })

  it('sorts feasible zones before infeasible ones, then by score', () => {
    const entries = [
      { feasible: false, score: 90, zone: { id: 'infeasible-high' } },
      { feasible: true, score: 50, zone: { id: 'feasible-low' } },
      { feasible: false, score: 60, zone: { id: 'infeasible-low' } },
      { feasible: true, score: 70, zone: { id: 'feasible-high' } },
    ]
    sortZoneEntriesByFeasibility(entries)
    expect(entries.map((entry) => entry.zone.id)).toEqual([
      'feasible-high',
      'feasible-low',
      'infeasible-high',
      'infeasible-low',
    ])
  })

  it('reports no feasible zones and caps scores when the mission is under-powered', () => {
    const result = rankLandingZones({
      terrain: flatTerrain(),
      ephemeris: makeEphemeris(),
      sites: [{ id: 'anchor', name: 'Anchor', lat: -89.9, lon: 0 }],
      mission: { ...MISSION, powerNeedW: 5000 },
      options: { minAreaKm2: 0.1, maxRoughnessM: null },
    })
    expect(result.zones.length).toBeGreaterThan(0)
    expect(result.meta.feasibleZones).toBe(0)
    expect(result.meta.hasFeasibleZones).toBe(false)
    expect(result.meta.feasibility.message).toBe('no-feasible-zone')
    expect(result.meta.recommendedZoneId).toBeNull()
    expect(result.meta.rankingRule).toBe('feasible-first-then-score')
    for (const entry of result.zones) {
      expect(entry.feasible).toBe(false)
      expect(entry.score).toBeLessThanOrEqual(55)
      expect(['conditional', 'poor']).toContain(entry.grade)
      expect(entry.feasibility.violations.length).toBeGreaterThan(0)
    }
  })

  it('recommends the best feasible zone and ranks it first', () => {
    const result = rankLandingZones({
      terrain: flatTerrain(),
      ephemeris: makeEphemeris(),
      sites: [{ id: 'anchor', name: 'Anchor', lat: -89.9, lon: 0 }],
      mission: MISSION,
      options: { minAreaKm2: 0.1, maxRoughnessM: null },
    })
    if (result.meta.hasFeasibleZones) {
      expect(result.zones[0].feasible).toBe(true)
      expect(result.meta.recommendedZoneId).toBe(result.zones[0].zone.id)
      expect(result.meta.feasibleZones).toBeGreaterThan(0)
    } else {
      expect(result.meta.recommendedZoneId).toBeNull()
    }
  })
})

const CRATER_CENTRE_X = -1500

/**
 * Flat plain (≈22 km²) with one crater-like depression whose interior floor is
 * flat enough to pass the slope gate, so `findCraters` detects it and crater
 * avoidance visibly removes its footprint from the candidate zones.
 *
 * @returns {import('./terrain.js').Terrain}
 */
function makeCraterTerrain() {
  const elevationFn = (x, y) => {
    const r = Math.hypot(x - CRATER_CENTRE_X, y)
    if (r <= 100) return -100 + 20 * (r / 100) ** 2
    if (r <= 500) return -80
    if (r <= 600) return -80 + 100 * ((r - 500) / 100)
    if (r <= 750) return 20 - 20 * ((r - 600) / 150)
    return 0
  }
  return makePlane({
    width: 100,
    height: 100,
    minX: -2500,
    maxX: 2500,
    minY: -2500,
    maxY: 2500,
    elevationFn,
  })
}

/**
 * Planar distance from a zone centroid to the synthetic crater centre.
 *
 * @param {{xMeters: number, yMeters: number}} zone
 * @returns {number} Distance in metres.
 */
function distanceToCrater(zone) {
  return Math.hypot(zone.xMeters - CRATER_CENTRE_X, zone.yMeters)
}

describe('crater-aware zone detection', () => {
  const baseOptions = { minAreaKm2: 0.1, maxRoughnessM: null }

  it('defaults to the crater-free pipeline', () => {
    const result = detectLandingZones(makeCraterTerrain(), baseOptions)
    expect(normalizeZoneOptions({}).avoidCraters).toBe(false)
    expect(normalizeZoneOptions({}).craterClearanceM).toBe(0)
    expect(result.meta.options.avoidCraters).toBe(false)
    expect(result.meta.options.craterClearanceM).toBe(0)
    expect('cratersConsidered' in result.meta).toBe(false)
    expect('craterCellsExcluded' in result.meta).toBe(false)
    expect(result.zones.length).toBeGreaterThanOrEqual(2)
    expect(result.zones.some((zone) => distanceToCrater(zone) < 200)).toBe(true)
  })

  it('excludes the crater footprint and keeps the remaining flat zones', () => {
    const reference = detectLandingZones(makeCraterTerrain(), baseOptions)
    const result = detectLandingZones(makeCraterTerrain(), {
      ...baseOptions,
      avoidCraters: true,
      craterMinDiameterM: 500,
    })
    expect(result.meta.options.avoidCraters).toBe(true)
    expect(result.meta.cratersConsidered).toBeGreaterThanOrEqual(1)
    expect(result.meta.craterCellsExcluded).toBeGreaterThan(0)
    expect(result.meta.zoneCount).toBeLessThan(reference.meta.zoneCount)
    expect(result.zones.length).toBeGreaterThanOrEqual(1)
    expect(result.zones.every((zone) => distanceToCrater(zone) > 600)).toBe(true)
  })

  it('enlarges the exclusion with craterClearanceM', () => {
    const defaultClearance = detectLandingZones(makeCraterTerrain(), {
      ...baseOptions,
      avoidCraters: true,
    })
    const wideClearance = detectLandingZones(makeCraterTerrain(), {
      ...baseOptions,
      avoidCraters: true,
      craterClearanceM: 400,
    })
    expect(wideClearance.meta.options.craterClearanceM).toBe(400)
    expect(wideClearance.meta.craterCellsExcluded).toBeGreaterThan(defaultClearance.meta.craterCellsExcluded)
    expect(wideClearance.zones.length).toBeGreaterThanOrEqual(1)
  })

  it('stays safe without a usable terrain', () => {
    const missing = detectLandingZones(null, { avoidCraters: true })
    expect(missing.zones).toEqual([])
    expect(missing.meta.error).toBe('missing-terrain')

    const tiny = detectLandingZones(
      makePlane({ width: 2, height: 2, elevationFn: () => 0 }),
      { avoidCraters: true },
    )
    expect(tiny.zones).toEqual([])
    expect(tiny.meta.error).toBe('terrain-too-small')
  })

  it('is deterministic for identical inputs', () => {
    const options = { ...baseOptions, avoidCraters: true, craterClearanceM: 200 }
    const first = detectLandingZones(makeCraterTerrain(), options)
    const second = detectLandingZones(makeCraterTerrain(), options)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
