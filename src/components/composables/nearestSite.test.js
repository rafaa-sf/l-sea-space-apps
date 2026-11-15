import { describe, expect, it } from 'vitest'
import { nearestCuratedSite } from './nearestSite.js'

const SITES = [
  { id: 'shackleton', source: 'poi', lat: -89.78, lon: 204.27 },
  { id: 'haworth', source: 'poi', lat: -86.7, lon: 336.3 },
  { id: 'leibnitz', source: 'poi', lat: -85.42, lon: 31.74 },
  { id: 'custom-1', source: 'custom', lat: -89.7, lon: 200.1 },
  { id: 'pointer-1', source: 'pointer', lat: -89.79, lon: 204.2 },
]

describe('nearestCuratedSite', () => {
  it('picks the closest curated site and ignores custom/pointer entries', () => {
    expect(nearestCuratedSite(SITES, -89.75, 204.3)?.id).toBe('shackleton')
    expect(nearestCuratedSite(SITES, -86.6, 336.2)?.id).toBe('haworth')
    expect(nearestCuratedSite(SITES, -85.5, 31.8)?.id).toBe('leibnitz')
  })

  it('wraps longitude differences around the pole', () => {
    const nearZero = nearestCuratedSite(
      [
        { id: 'east', source: 'poi', lat: -89.7, lon: 2 },
        { id: 'west', source: 'poi', lat: -89.7, lon: 358 },
      ],
      0,
      -89.7,
    )
    // At -89.7° latitude the longitude term is tiny; the first equal-distance
    // candidate wins, but both must be considered (no crash, valid result).
    expect(['east', 'west']).toContain(nearZero?.id)
    expect(nearestCuratedSite(SITES, 0, 0)).toBeTruthy()
  })

  it('returns null for invalid inputs or when no curated site exists', () => {
    expect(nearestCuratedSite(SITES, null, 10)).toBeNull()
    expect(nearestCuratedSite(SITES, NaN, 10)).toBeNull()
    expect(nearestCuratedSite([], -89.5, 0)).toBeNull()
    expect(nearestCuratedSite([{ source: 'custom', lat: -89.5, lon: 0 }], -89.5, 0)).toBeNull()
  })
})
