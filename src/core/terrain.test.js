/**
 * Unit tests for the terrain core: polar-stereographic transforms, bilinear
 * sampling (both planar and latitude/longitude grids), slope/aspect and crater
 * detection.
 *
 * All fixtures are synthetic and analytically known, so the tests do not depend
 * on the generated `public/data` datasets.
 */

import { describe, expect, it } from 'vitest'
import {
  MOON_RADIUS_M,
  lonLatToXY,
  xyToLonLat,
  createProjectedTerrain,
  createSyntheticTerrain,
  sampleElevation,
  slopeAt,
  findCraters,
  areaStatistics,
  terrainKind,
  terrainCellSizeM,
  terrainExtentM,
  terrainLatLonBounds,
  isInsideTerrain,
  stereographicScaleFactor,
} from './terrain.js'

/**
 * Build a planar polar-stereographic grid whose sample node (col, row) sits at
 * the analytic position used by the sampler (pixel-centre georeferencing).
 *
 * @param {Object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.boundsM Half width/height in projected meters.
 * @param {(x: number, y: number) => number} elevationFn Analytic elevation.
 * @returns {import('./terrain.js').Terrain}
 */
function makePlanarGrid({ width, height, boundsM, elevationFn }) {
  const pixelSizeM = (2 * boundsM) / width
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = -boundsM + (col + 0.5) * pixelSizeM
      const y = boundsM - (row + 0.5) * pixelSizeM
      data[row * width + col] = elevationFn(x, y)
    }
  }
  return createProjectedTerrain({
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
    synthetic: true,
  }, data)
}

/**
 * Build a regular latitude/longitude grid (the shape the UI renderer uses).
 *
 * @param {Object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {(lat: number, lon: number) => number} elevationFn
 * @returns {Object}
 */
function makeLatLonGrid({ width, height, elevationFn }) {
  const lat0 = -90
  const lat1 = -80
  const lon0 = 0
  const lon1 = 360
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    const lat = lat0 + ((lat1 - lat0) * row) / (height - 1)
    for (let col = 0; col < width; col += 1) {
      const lon = lon0 + ((lon1 - lon0) * col) / (width - 1)
      data[row * width + col] = elevationFn(lat, lon)
    }
  }
  return {
    width,
    height,
    lat0,
    lon0,
    lat1,
    lon1,
    datum: MOON_RADIUS_M,
    data,
    rowZeroIsSouth: true,
  }
}

describe('polar stereographic transforms', () => {
  it('matches the pyproj-verified reference vectors', () => {
    const a = lonLatToXY(-87.5, 0)
    expect(a.x).toBeCloseTo(0, 3)
    expect(a.y).toBeCloseTo(75820.4, 0)
    const b = lonLatToXY(-89.0, 129.2)
    expect(b.x).toBeCloseTo(23499.5, 0)
    expect(b.y).toBeCloseTo(-19165.7, 0)
  })

  it('round-trips through the inverse transform', () => {
    for (const [lat, lon] of [[-89, 129.2], [-86, 2.9], [-90, 0], [-88.4, 272.9]]) {
      const { x, y } = lonLatToXY(lat, lon)
      const inverse = xyToLonLat(x, y)
      expect(inverse.latDeg).toBeCloseTo(lat, 6)
      expect(inverse.lonDeg).toBeCloseTo(lon, 6)
    }
  })

  it('maps the pole to the origin', () => {
    const pole = lonLatToXY(-90, 0)
    expect(pole.x).toBeCloseTo(0, 6)
    expect(pole.y).toBeCloseTo(0, 6)
    const inverse = xyToLonLat(0, 0)
    expect(inverse.latDeg).toBeCloseTo(-90, 6)
  })

  it('scale factor is 1 at the pole and about 1.008 at 80°S', () => {
    expect(stereographicScaleFactor(0)).toBe(1)
    const rho80 = lonLatToXY(-80, 0).y
    expect(stereographicScaleFactor(rho80)).toBeCloseTo(1.0077, 3)
  })
})

describe('planar DEM sampling', () => {
  it('reproduces a linear ramp exactly with bilinear interpolation', () => {
    const grid = makePlanarGrid({
      width: 65,
      height: 65,
      boundsM: 32000,
      elevationFn: (x, y) => 0.001 * x + 0.002 * y,
    })
    for (const [lat, lon] of [[-89.5, 0], [-89.1, 90], [-89.0, 220], [-89.6, 300]]) {
      const { x, y } = lonLatToXY(lat, lon)
      const expected = 0.001 * x + 0.002 * y
      expect(sampleElevation(grid, lat, lon)).toBeCloseTo(expected, 2)
    }
  })

  it('detects the planar terrain shape and cell size', () => {
    const grid = makePlanarGrid({ width: 33, height: 33, boundsM: 3200, elevationFn: () => 0 })
    expect(terrainKind(grid)).toBe('planar')
    expect(grid.pixelSizeM).toBeCloseTo(grid.widthM / grid.width, 6)
    expect(terrainCellSizeM(grid, -89).eastM).toBeCloseTo(grid.pixelSizeM, 6)
    expect(isInsideTerrain(grid, -89.9, 0)).toBe(true)
    expect(Number.isNaN(sampleElevation(grid, -80, 0))).toBe(true)
    expect(sampleElevation(grid, -89.9, 0, { clampToGrid: true })).toBe(0)
  })

  it('computes slope and aspect from the projected gradient', () => {
    const dEast = 0.001 // 0.1 m per 100 m
    const dNorth = 0.002
    const grid = makePlanarGrid({
      width: 65,
      height: 65,
      boundsM: 32000,
      elevationFn: (x, y) => dEast * x + dNorth * y,
    })
    const slope = slopeAt(grid, -89.5, 0)
    expect(slope.slopeDeg).toBeCloseTo((Math.atan(Math.hypot(dEast, dNorth)) * 180) / Math.PI, 2)
    const expectedAspect = ((Math.atan2(-dEast, -dNorth) * 180) / Math.PI + 360) % 360
    expect(slope.aspectDeg).toBeCloseTo(expectedAspect, 2)
  })
})

describe('latitude/longitude DEM sampling', () => {
  it('samples a latitude/longitude grid linearly', () => {
    const grid = makeLatLonGrid({
      width: 73,
      height: 73,
      elevationFn: (lat) => -1000 - 100 * (lat + 90),
    })
    expect(sampleElevation(grid, -90, 0)).toBeCloseTo(-1000, 1)
    expect(sampleElevation(grid, -85, 180)).toBeCloseTo(-1500, 1)
    expect(sampleElevation(grid, -87.5, 45)).toBeCloseTo(-1250, 1)
  })

  it('detects the latitude/longitude terrain shape', () => {
    const grid = makeLatLonGrid({ width: 37, height: 37, elevationFn: () => 0 })
    expect(terrainKind(grid)).toBe('latlon')
    expect(terrainLatLonBounds(grid).maxLat).toBeCloseTo(-80, 6)
    expect(Number(terrainExtentM(grid, { lat: -89, lon: 0 }))).toBeGreaterThan(50000)
  })
})

describe('crater detection', () => {
  it('finds a synthetic bowl-and-rim crater', () => {
    const craterCenter = { lat: -89.8, lon: 45 }
    const radiusM = 1500
    const grid = makePlanarGrid({
      width: 129,
      height: 129,
      boundsM: 8000,
      elevationFn: (x, y) => {
        const center = lonLatToXY(craterCenter.lat, craterCenter.lon)
        const distance = Math.hypot(x - center.x, y - center.y)
        if (distance >= radiusM * 1.35) return 0
        if (distance <= radiusM) {
          const t = distance / radiusM
          return -250 * (1 - t * t)
        }
        const rimDistance = distance - radiusM
        return 120 * Math.exp(-((rimDistance / (radiusM * 0.12)) ** 2))
      },
    })

    const craters = findCraters(grid, {
      minDiameterM: 800,
      maxDiameterM: 8000,
      minDepthM: 40,
      maxCraters: 5,
    })
    expect(craters.length).toBeGreaterThan(0)

    const detected = craters[0]
    expect(detected.depthM).toBeGreaterThan(100)
    expect(detected.diameterM).toBeGreaterThan(1800)
    expect(detected.diameterM).toBeLessThan(4500)
    expect(detected.lat).toBeCloseTo(craterCenter.lat, 0)
    expect(Math.abs(detected.lon - craterCenter.lon)).toBeLessThan(3)
  })

  it('returns [] without a usable terrain', () => {
    expect(findCraters(null)).toEqual([])
    expect(findCraters({ width: 2, height: 2, data: new Float32Array(4) })).toEqual([])
  })

  it('finds craters on the latitude/longitude grid shape too', () => {
    const center = { lat: -89.0, lon: 120 }
    const radiusM = 2500
    const grid = makeLatLonGrid({
      width: 129,
      height: 129,
      elevationFn: (lat, lon) => {
        const { x, y } = lonLatToXY(lat, lon)
        const crater = lonLatToXY(center.lat, center.lon)
        const distance = Math.hypot(x - crater.x, y - crater.y)
        if (distance >= radiusM * 1.4) return 0
        if (distance <= radiusM) return -300 * (1 - (distance / radiusM) ** 2)
        return 100
      },
    })
    const craters = findCraters(grid, { minDiameterM: 1000, maxDiameterM: 10000, minDepthM: 50, limit: 3 })
    expect(craters.length).toBeGreaterThan(0)
    expect(craters[0].depthM).toBeGreaterThan(100)
  })
})

describe('terrain statistics and synthetic fallback', () => {
  it('computes area statistics for a tilted plane', () => {
    const grid = makePlanarGrid({
      width: 65,
      height: 65,
      boundsM: 32000,
      elevationFn: (x) => 0.001 * x,
    })
    const stats = areaStatistics(grid, { lat: -89.5, lon: 0 }, { radiusM: 200 })
    expect(stats).not.toBeNull()
    expect(stats.meanSlopeDeg).toBeCloseTo((Math.atan(0.001) * 180) / Math.PI, 1)
    expect(stats.validCount).toBeGreaterThan(0)
  })

  it('creates a deterministic synthetic fallback grid', () => {
    const a = createSyntheticTerrain({ width: 64, height: 64 })
    const b = createSyntheticTerrain({ width: 64, height: 64 })
    expect(a.synthetic).toBe(true)
    expect(a.kind ?? 'planar').toBeDefined()
    expect(a.data.length).toBe(64 * 64)
    expect(a.data[0]).toBe(b.data[0])
    expect(a.data[100]).toBe(b.data[100])
    expect(Number.isFinite(sampleElevation(a, -89.5, 120))).toBe(true)
  })
})
