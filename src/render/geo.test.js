import { describe, expect, it } from 'vitest'
import { azElRayOffset, createPolarProjection, sunDirectionVector } from './geo.js'

describe('scene direction convention (Sun/Earth arrows)', () => {
  it('azimuth is clockwise from north: +Z north, +X east, -Z south, -X west', () => {
    const north = sunDirectionVector(0, 0)
    const east = sunDirectionVector(90, 0)
    const south = sunDirectionVector(180, 0)
    const west = sunDirectionVector(270, 0)
    expect(north.x).toBeCloseTo(0, 12)
    expect(north.z).toBeCloseTo(1, 12)
    expect(east.x).toBeCloseTo(1, 12)
    expect(east.z).toBeCloseTo(0, 12)
    expect(south.z).toBeCloseTo(-1, 12)
    expect(west.x).toBeCloseTo(-1, 12)
  })

  it('elevation maps to +Y and below-horizon values stay negative (no clamp)', () => {
    expect(sunDirectionVector(30, 90).y).toBeCloseTo(1, 12)
    expect(sunDirectionVector(30, -10).y).toBeLessThan(0)
    expect(sunDirectionVector(30, -90).y).toBeCloseTo(-1, 12)
  })

  it('is always a unit vector', () => {
    for (const az of [0, 37, 90, 143, 180, 221, 270, 314, 359]) {
      for (const el of [-80, -10, 0, 12, 45, 89]) {
        const v = sunDirectionVector(az, el)
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 10)
      }
    }
  })

  it('ray horizontal direction matches the arrow direction for every azimuth', () => {
    for (const az of [0, 37, 90, 143, 180, 221, 270, 314, 359]) {
      const arrow = sunDirectionVector(az, 0)
      const ray = azElRayOffset({ azimuthDeg: az, elevationDeg: 0, distanceM: 100000, unitsPerMeter: 1, elevationScale: 1 })
      expect(ray.x).toBeCloseTo(arrow.x * 100000, 6)
      expect(ray.z).toBeCloseTo(arrow.z * 100000, 6)
    }
  })

  it('ray below the horizon points down, never above it', () => {
    const ray = azElRayOffset({ azimuthDeg: 0, elevationDeg: -20, distanceM: 200000, unitsPerMeter: 1, elevationScale: 1 })
    expect(ray.y).toBeLessThan(0)
    expect(ray.z).toBeGreaterThan(0) // north, same sign as the arrow
  })
})

describe('polar projection orientation matches the direction convention', () => {
  const terrain = { lat0: -90, lat1: -85, lon0: 0, lon1: 360 }
  const projection = createPolarProjection(terrain, { radius: 10 })

  it('projects longitude 0 along +Z and longitude 90 along +X', () => {
    const at0 = projection.project(-89, 0)
    const at90 = projection.project(-89, 90)
    expect(Math.abs(at0.x)).toBeLessThan(1e-9)
    expect(at0.z).toBeGreaterThan(0)
    expect(at90.x).toBeGreaterThan(0)
    expect(Math.abs(at90.z)).toBeLessThan(1e-9)
  })

  it('north (less negative latitude) projects towards +Z at longitude 0', () => {
    expect(projection.project(-88, 0).z).toBeGreaterThan(projection.project(-89, 0).z)
  })

  it('arrow azimuth 0 and ray azimuth 0 agree with the projection north (+Z)', () => {
    const northArrow = sunDirectionVector(0, 0)
    const northRay = azElRayOffset({ azimuthDeg: 0, elevationDeg: 0, distanceM: 1000, unitsPerMeter: 1, elevationScale: 1 })
    expect(northArrow.z).toBeGreaterThan(0)
    expect(northRay.z).toBeGreaterThan(0)
    expect(projection.project(-89, 0).z).toBeGreaterThan(0)
  })
})
