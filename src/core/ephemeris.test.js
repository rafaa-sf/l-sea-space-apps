/**
 * Unit tests for the ephemeris core: normalization, interpolation, rise/set
 * events, visibility windows, orbital variants and the catalogue shape.
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeEphemerisDataset,
  normalizeEphemerisCatalog,
  sampleAt,
  nextSetEvent,
  nextRiseEvent,
  visibilityWindows,
  visibilityStatistics,
  datasetRange,
  listVariants,
  ephemerisMetadata,
  toTimestamp,
} from './ephemeris.js'
import { MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'

const START = Date.parse('2026-11-01T00:00:00Z')
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * Build a synthetic ephemeris dataset.
 *
 * @param {{
 *   startMs?: number,
 *   stepMinutes?: number,
 *   count?: number,
 *   sun?: (index: number, timeMs: number) => {az: number, el: number},
 *   earth?: (index: number, timeMs: number) => {az: number, el: number},
 * }} [options]
 * @returns {import('./ephemeris.js').EphemerisDataset}
 */
function makeDataset(options = {}) {
  const startMs = options.startMs ?? START
  const stepMinutes = options.stepMinutes ?? 30
  const count = options.count ?? 96 // 48 hours at 30 min
  const samples = []
  for (let index = 0; index < count; index += 1) {
    const timeMs = startMs + index * stepMinutes * MINUTE
    const sun = options.sun ? options.sun(index, timeMs) : { az: 0, el: 2 }
    const earth = options.earth ? options.earth(index, timeMs) : { az: 180, el: 2 }
    samples.push({ time: new Date(timeMs).toISOString(), sun, earth })
  }
  return normalizeEphemerisDataset({ siteId: 'test-site', samples })
}

/**
 * Flat synthetic terrain used to make the horizon ≈ 0.
 *
 * @returns {import('./terrain.js').Terrain}
 */
function flatTerrain() {
  const width = 65
  const height = 65
  const boundsM = 40000
  return createProjectedTerrain(
    {
      referenceRadiusM: MOON_RADIUS_M,
      width,
      height,
      pixelSizeM: (2 * boundsM) / width,
      minX: -boundsM,
      maxX: boundsM,
      minY: -boundsM,
      maxY: boundsM,
      dtype: 'float32',
    },
    new Float32Array(width * height),
  )
}

describe('normalizeEphemerisDataset', () => {
  it('normalizes, sorts and computes the range', () => {
    const dataset = makeDataset()
    expect(dataset.samples.length).toBe(96)
    expect(dataset.startMs).toBe(START)
    expect(dataset.endMs).toBe(START + 95 * 30 * MINUTE)
    expect(dataset.stepSeconds).toBe(1800)
    expect(dataset.samples[0].time).toBe('2026-11-01T00:00:00.000Z')
    expect(dataset.siteId).toBe('test-site')
  })

  it('is idempotent', () => {
    const dataset = makeDataset()
    expect(normalizeEphemerisDataset(dataset)).toBe(dataset)
  })

  it('accepts a plain array and columnar data', () => {
    const samples = [
      { time: '2026-11-01T00:00:00Z', sun: { az: 0, el: 1 }, earth: { az: 180, el: 2 } },
      { time: '2026-11-01T00:30:00Z', sun: { az: 1, el: 1.5 }, earth: { az: 181, el: 2.5 } },
    ]
    expect(normalizeEphemerisDataset(samples).samples.length).toBe(2)
    expect(normalizeEphemerisDataset(Array.from(samples)).samples.length).toBe(2)

    const columnar = normalizeEphemerisDataset({
      times: ['2026-11-01T00:00:00Z', '2026-11-01T00:30:00Z'],
      sun: { az: [0, 1], el: [1, 1.5] },
      earth: { az: [180, 181], el: [2, 2.5] },
    })
    expect(columnar.samples.length).toBe(2)
    expect(columnar.samples[1].sun.el).toBeCloseTo(1.5, 6)
  })

  it('rejects datasets without usable samples', () => {
    expect(() => normalizeEphemerisDataset({ samples: [] })).toThrow(TypeError)
    expect(() => normalizeEphemerisDataset(null)).toThrow(TypeError)
  })

  it('builds a catalogue keyed by site id', () => {
    const catalog = normalizeEphemerisCatalog({
      sites: {
        a: { siteId: 'a', samples: [{ time: '2026-11-01T00:00:00Z', sun: { az: 0, el: 1 }, earth: { az: 0, el: 1 } }] },
        b: { siteId: 'b', samples: [{ time: '2026-11-01T00:00:00Z', sun: { az: 0, el: 1 }, earth: { az: 0, el: 1 } }] },
      },
    })
    expect(catalog.size).toBe(2)
    expect(catalog.has('a')).toBe(true)
  })
})

describe('sampleAt', () => {
  it('interpolates elevation linearly and azimuth across the seam', () => {
    const dataset = makeDataset({
      count: 3,
      stepMinutes: 60,
      sun: (index) => ({ az: index === 0 ? 350 : index === 1 ? 10 : 30, el: 1 + index * 2 }),
      earth: () => ({ az: 180, el: 2 }),
    })
    const midpoint = sampleAt(dataset, START + 30 * MINUTE)
    expect(midpoint.sun.el).toBeCloseTo(2, 6)
    expect(midpoint.sun.az).toBeCloseTo(0, 6)
    expect(midpoint.extrapolated).toBe(false)
  })

  it('clamps outside the covered range and flags extrapolation', () => {
    const dataset = makeDataset()
    const before = sampleAt(dataset, START - 5 * HOUR)
    expect(before.extrapolated).toBe(true)
    expect(before.sun.el).toBe(2)
    const after = sampleAt(dataset, dataset.endMs + HOUR)
    expect(after.extrapolated).toBe(true)
  })

  it('wraps out-of-range dates with an orbital period', () => {
    const dataset = makeDataset({ count: 96 }) // 48 hours
    const shifted = sampleAt(dataset, START + 2.5 * 24 * HOUR, { orbitPeriodDays: 2 })
    const direct = sampleAt(dataset, START + 0.5 * 24 * HOUR)
    expect(shifted.timestampMs).toBeCloseTo(direct.timestampMs, 0)
  })

  it('throws on an invalid date', () => {
    const dataset = makeDataset()
    expect(() => sampleAt(dataset, 'not-a-date')).toThrow(TypeError)
  })

  it('converts date formats', () => {
    expect(toTimestamp('2026-11-01T00:00:00Z')).toBe(START)
    expect(toTimestamp(START)).toBe(START)
    expect(toTimestamp(new Date(START))).toBe(START)
    expect(toTimestamp(START / 1000)).toBe(START)
  })
})

describe('nextSetEvent and nextRiseEvent', () => {
  it('finds the next sunset on flat terrain', () => {
    // Sun elevation goes from +2° to -2° over 48 hours, crossing 0° at 24 h.
    const dataset = makeDataset({
      sun: (index) => ({ az: 270, el: 2 - (4 * index) / 95 }),
    })
    const terrain = flatTerrain()
    const site = { lat: -89.5, lon: 90 }
    const event = nextSetEvent(dataset, site, terrain, 'sun', START)
    expect(event).not.toBeNull()
    expect(event.type).toBe('set')
    expect(event.remainingSeconds).toBeGreaterThan(23 * 3600)
    expect(event.remainingSeconds).toBeLessThan(25 * 3600)
  })

  it('finds the next sunrise', () => {
    const dataset = makeDataset({
      sun: (index) => ({ az: 270, el: -2 + (4 * index) / 95 }),
    })
    const event = nextRiseEvent(dataset, { lat: -89.5, lon: 90 }, flatTerrain(), 'sun', START)
    expect(event).not.toBeNull()
    expect(event.remainingSeconds).toBeGreaterThan(23 * 3600)
    expect(event.remainingSeconds).toBeLessThan(25 * 3600)
  })
})

describe('visibilityWindows and statistics', () => {
  it('returns the sunlit windows', () => {
    const dataset = makeDataset({
      sun: (index) => ({ az: 270, el: index < 48 ? 2 : -2 }),
    })
    const windows = visibilityWindows(dataset, { lat: -89.5, lon: 90 }, flatTerrain(), 'sun', START, dataset.endMs)
    expect(windows.length).toBe(1)
    expect(windows[0].from).toBe('2026-11-01T00:00:00.000Z')
    expect(windows[0].durationSeconds).toBeGreaterThan(23 * 3600)
    expect(windows[0].durationSeconds).toBeLessThan(25 * 3600)
  })

  it('returns multiple windows for alternating visibility', () => {
    const dataset = makeDataset({
      stepMinutes: 15,
      count: 192, // 48 hours, ends hidden
      sun: (index) => ({ az: 270, el: index % 96 < 48 ? 2 : -2 }),
    })
    const windows = visibilityWindows(dataset, { lat: -89.5, lon: 90 }, flatTerrain(), 'sun', START, dataset.endMs, {
      stepSeconds: 60,
    })
    expect(windows.length).toBe(2)
  })

  it('aggregates visibility statistics', () => {
    const dataset = makeDataset({ sun: (index) => ({ az: 270, el: 2 }) })
    const stats = visibilityStatistics(dataset, { lat: -89.5, lon: 90 }, flatTerrain(), 'sun', START, dataset.endMs)
    expect(stats.visibleSeconds).toBeGreaterThan(0)
    expect(stats.fraction).toBeCloseTo(1, 1)
    expect(stats.longestWindowDays).toBeGreaterThan(1.5)
  })
})

describe('orbital variants', () => {
  it('selects a variant covering the requested date', () => {
    const base = makeDataset({ count: 3, stepMinutes: 60 })
    const variantSamples = [
      { time: '2026-11-05T00:00:00Z', sun: { az: 10, el: 1 }, earth: { az: 190, el: 2 } },
      { time: '2026-11-05T01:00:00Z', sun: { az: 11, el: 1.1 }, earth: { az: 191, el: 2.1 } },
    ]
    const dataset = normalizeEphemerisDataset({
      siteId: 'variant-site',
      samples: base.samples,
      variants: [
        {
          id: 'epoch-b',
          label: 'Epoch B',
          validFrom: '2026-11-04T00:00:00Z',
          validTo: '2026-11-06T00:00:00Z',
          samples: variantSamples,
        },
      ],
    })
    expect(listVariants(dataset).length).toBe(1)
    expect(listVariants(dataset)[0].id).toBe('epoch-b')

    const sampled = sampleAt(dataset, '2026-11-05T00:30:00Z')
    expect(sampled.variantId).toBe('epoch-b')
    expect(sampled.sun.el).toBeCloseTo(1.05, 6)

    const explicit = sampleAt(dataset, '2026-11-05T00:30:00Z', { variantId: 'epoch-b' })
    expect(explicit.variantId).toBe('epoch-b')
  })
})

describe('metadata helpers', () => {
  it('summarizes the dataset range and metadata', () => {
    const dataset = makeDataset()
    const range = datasetRange(dataset)
    expect(range.sampleCount).toBe(96)
    expect(range.startTime).toBe('2026-11-01T00:00:00.000Z')
    const metadata = ephemerisMetadata(dataset)
    expect(metadata.siteId).toBe('test-site')
    expect(metadata.synthetic).toBe(false)
    expect(metadata.variants).toEqual([])
  })
})
