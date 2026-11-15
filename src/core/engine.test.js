/**
 * Unit tests for the line-of-sight engine: horizon geometry with lunar
 * curvature, ray/terrain intersection, Sun/Earth visibility and the cached
 * horizon profiles. Fixtures are synthetic analytic terrains.
 */

import { describe, expect, it } from 'vitest'
import {
  MOON_RADIUS_M,
  DEG,
  elevationAngleDeg,
  curvatureDropM,
  destinationPoint,
} from './geometry.js'
import { createProjectedTerrain, createSyntheticTerrain, lonLatToXY, sampleElevation } from './terrain.js'
import {
  horizonAngle,
  horizonProfile,
  horizonAngleAt,
  clearHorizonCache,
  evaluateBodyVisibility,
  isSunVisible,
  isEarthVisible,
  rayTerrainIntersection,
} from './engine.js'

/**
 * Planar grid with pixel-centre georeferencing.
 *
 * @param {{width: number, height: number, boundsM: number, elevationFn: (x: number, y: number) => number}} options
 * @returns {import('./terrain.js').Terrain}
 */
function makePlanarGrid({ width, height, boundsM, elevationFn }) {
  const pixelSizeM = (2 * boundsM) / width
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      data[row * width + col] = elevationFn(-boundsM + (col + 0.5) * pixelSizeM, boundsM - (row + 0.5) * pixelSizeM)
    }
  }
  return createProjectedTerrain(
    {
      id: 'test-planar',
      referenceRadiusM: MOON_RADIUS_M,
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

const SITE = { lat: -89.5, lon: 90 }

describe('elevation-angle geometry', () => {
  it('includes the lunar curvature drop for a level target', () => {
    const distance = 100000
    const angle = elevationAngleDeg(0, 0, distance)
    expect(angle).toBeCloseTo(-((distance / (2 * MOON_RADIUS_M)) * (180 / Math.PI)), 2)
    // Curvature drop at 100 km is about 2.88 km.
    expect(curvatureDropM(distance)).toBeCloseTo(2878, 0)
  })

  it('returns the expected angle for a raised target', () => {
    const angle = elevationAngleDeg(0, 500, 3000)
    expect(angle).toBeCloseTo((Math.atan2(500, 3000) * 180) / Math.PI, 0)
  })
})

describe('horizonAngle', () => {
  it('reports a clear (slightly negative) horizon on flat terrain', () => {
    const terrain = makePlanarGrid({ width: 65, height: 65, boundsM: 40000, elevationFn: () => 0 })
    for (const azimuth of [0, 90, 180, 270]) {
      const angle = horizonAngle(terrain, SITE, azimuth)
      expect(angle).toBeGreaterThan(-0.1)
      expect(angle).toBeLessThan(0.05)
    }
  })

  it('is blocked by a ridge only in the ridge direction', () => {
    const terrain = makePlanarGrid({
      width: 129,
      height: 129,
      boundsM: 40000,
      elevationFn: (x, y) => {
        const center = lonLatToXY(SITE.lat, SITE.lon)
        return Math.abs(y) < 2000 && x > center.x + 2500 && x < center.x + 4500 ? 600 : 0
      },
    })
    const north = horizonAngle(terrain, SITE, 0)
    const south = horizonAngle(terrain, SITE, 180)
    expect(north).toBeGreaterThan(5)
    expect(south).toBeLessThan(1)
  })

  it('works on the reduced latitude/longitude grid shape', () => {
    const width = 91
    const height = 91
    const data = new Float32Array(width * height).fill(0)
    const latlon = {
      width,
      height,
      lat0: -90,
      lon0: 0,
      lat1: -80,
      lon1: 360,
      datum: MOON_RADIUS_M,
      data,
    }
    const angle = horizonAngle(latlon, SITE, 45)
    expect(Number.isFinite(angle)).toBe(true)
    expect(angle).toBeGreaterThan(-0.5)
    expect(angle).toBeLessThan(0.5)
  })
})

describe('horizon profiles', () => {
  it('builds a full-azimuth profile and indexes it with interpolation', () => {
    const terrain = makePlanarGrid({
      width: 129,
      height: 129,
      boundsM: 40000,
      elevationFn: (x, y) => {
        const center = lonLatToXY(SITE.lat, SITE.lon)
        return Math.abs(y) < 2000 && x > center.x + 2500 && x < center.x + 4500 ? 600 : 0
      },
    })
    const profile = horizonProfile(terrain, SITE, { stepDeg: 2 })
    expect(profile.count).toBe(180)
    expect(profile.angles.length).toBe(180)
    const north = horizonAngleAt(profile, 0)
    expect(north).toBeGreaterThan(5)
    expect(horizonAngleAt(profile, 359)).toBeCloseTo(horizonAngleAt(profile, 1), 1)
  })

  it('caches profiles per terrain and site', () => {
    const terrain = createSyntheticTerrain({ width: 48, height: 48 })
    const first = horizonProfile(terrain, SITE, { stepDeg: 4 })
    const second = horizonProfile(terrain, SITE, { stepDeg: 4 })
    expect(second).toBe(first)
  })

  it('replaces the cache when clearHorizonCache is called', () => {
    const terrain = createSyntheticTerrain({ width: 48, height: 48 })
    const first = horizonProfile(terrain, SITE, { stepDeg: 4 })
    expect(horizonProfile(terrain, SITE, { stepDeg: 4 })).toBe(first)
    clearHorizonCache()
    const rebuilt = horizonProfile(terrain, SITE, { stepDeg: 4 })
    expect(rebuilt).not.toBe(first)
    expect(Array.from(rebuilt.angles)).toEqual(Array.from(first.angles))
  })
})

describe('body visibility', () => {
  const terrain = makePlanarGrid({
    width: 129,
    height: 129,
    boundsM: 40000,
    elevationFn: (x, y) => {
      const center = lonLatToXY(SITE.lat, SITE.lon)
      return Math.abs(y) < 2000 && x > center.x + 2500 && x < center.x + 4500 ? 600 : 0
    },
  })

  it('evaluates Sun visibility against the horizon', () => {
    expect(isSunVisible(terrain, SITE, { az: 0, el: 8 })).toBe(false)
    expect(isSunVisible(terrain, SITE, { az: 0, el: 20 })).toBe(true)
    expect(isSunVisible(terrain, SITE, { az: 180, el: 2 })).toBe(true)
    expect(isSunVisible(terrain, SITE, null)).toBe(false)
  })

  it('returns the horizon margin for the UI', () => {
    const evaluation = evaluateBodyVisibility(terrain, SITE, { az: 0, el: 20 })
    expect(evaluation.visible).toBe(true)
    expect(evaluation.marginDeg).toBeGreaterThan(0)
    expect(evaluation.horizonDeg).toBeGreaterThan(5)
  })

  it('lets the Earth limb radius affect visibility at grazing angles', () => {
    const horizon = horizonAngle(terrain, SITE, 0)
    const grazing = { az: 0, el: horizon - 0.4 }
    expect(isEarthVisible(terrain, SITE, grazing)).toBe(false)
    expect(isEarthVisible(terrain, SITE, grazing, { limbRadiusDeg: 0.95 })).toBe(true)
    expect(isEarthVisible(terrain, SITE, { az: 180, el: 0.01 })).toBe(true)
  })
})

describe('rayTerrainIntersection', () => {
  it('returns null when a horizontal ray escapes over flat terrain', () => {
    const terrain = makePlanarGrid({ width: 129, height: 129, boundsM: 40000, elevationFn: () => 0 })
    expect(rayTerrainIntersection(terrain, SITE, 0, 0.5)).toBeNull()
  })

  it('intersects a terrain wall', () => {
    const terrain = makePlanarGrid({
      width: 129,
      height: 129,
      boundsM: 40000,
      elevationFn: (x, y) => {
        const center = lonLatToXY(SITE.lat, SITE.lon)
        const distance = Math.hypot(x - center.x, y - center.y)
        return distance > 2500 && distance < 4000 ? 400 : 0
      },
    })
    const hit = rayTerrainIntersection(terrain, SITE, 0, 1)
    expect(hit).not.toBeNull()
    expect(hit.distanceM).toBeGreaterThan(2000)
    expect(hit.distanceM).toBeLessThan(3200)
    expect(hit.lat).toBeGreaterThan(SITE.lat)
  })

  it('returns null without terrain', () => {
    expect(rayTerrainIntersection(null, SITE, 0, 0)).toBeNull()
  })
})

describe('sampleElevation sanity in the engine fixtures', () => {
  it('samples the ridge elevation', () => {
    const terrain = makePlanarGrid({
      width: 129,
      height: 129,
      boundsM: 40000,
      elevationFn: (x, y) => (y > 2500 ? 600 : 0),
    })
    const point = lonLatToXY(-89.8, 0)
    expect(point.y).toBeGreaterThan(2500)
    expect(sampleElevation(terrain, -89.8, 0)).toBeCloseTo(600, 0)
    expect(DEG).toBeCloseTo(Math.PI / 180, 12)
  })
})
