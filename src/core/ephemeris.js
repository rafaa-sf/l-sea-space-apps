/**
 * Ephemeris handling: precomputed JPL Horizons datasets, interpolation, and
 * Sun/Earth rise and set events.
 *
 * The deployed application is static, so topocentric Sun/Earth positions for
 * every point of interest are precomputed by the data pipeline into
 * `public/data/ephemeris/<site-id>.json`. This module is responsible for:
 *
 * - normalizing those files into a canonical sample list,
 * - interpolating azimuth/elevation at any Date (linear interpolation, with the
 *   azimuth interpolated along the shortest angular path across 0°/360°),
 * - finding the next set/rise transition and the remaining time until it,
 * - listing visibility windows between two dates,
 * - supporting orbital variation (datasets sampled for several lunar orbital
 *   epochs, or a single cycle replayed with an `orbitPeriodDays` parameter).
 *
 * Expected precomputed shape (extra fields are preserved in metadata):
 *
 * ```js
 * {
 *   siteId: 'shackleton-rim',
 *   site: { lat: -89.45, lon: 129.2 },
 *   moonRadiusM: 1737400,
 *   source: 'JPL Horizons (DE441) topocentric',
 *   range: { start: '2026-11-01T00:00:00Z', end: '2026-12-31T23:30:00Z' },
 *   stepMinutes: 30,
 *   samples: [{ time: '...Z', sun: { az: 0, el: 0 }, earth: { az: 0, el: 0 } }],
 *   // optional orbital variation:
 *   variants: [{ id, label, validFrom, validTo, samples: [...] }],
 * }
 * ```
 *
 * Tolerant input shapes: a plain array of samples, columnar data
 * (`{ times, sun: { az: [], el: [] }, earth: {...} }`), or a map of site ids to
 * datasets (`{ sites: { 'site-id': {...} } }`) via
 * {@link normalizeEphemerisCatalog}.
 *
 * @module core/ephemeris
 */

import {
  normalizeLongitude,
  wrapLongitudeDelta,
} from './geometry.js'
import {
  evaluateBodyVisibility,
  horizonProfile as buildEngineHorizonProfile,
} from './engine.js'

/** Supported celestial body keys. */
export const BODIES = Object.freeze(['sun', 'earth'])

/** Marker used to make normalization idempotent. */
const CANONICAL_FLAG = '__lseaEphemeris'

/**
 * Cache of normalized datasets keyed by the raw input object, so repeated
 * `sampleAt` calls on the same (large) precomputed dataset do not re-normalize
 * thousands of samples on every call. The UI keeps the raw dataset object stable
 * in its reactive state, so this cache is effective during animation/scrubbing.
 * @type {WeakMap<Object, EphemerisDataset>}
 */
const normalizedCache = new WeakMap()

/**
 * @typedef {Object} EphemerisSample
 * @property {string} time ISO-8601 UTC timestamp.
 * @property {{az: number, el: number}} sun Sun azimuth/elevation in degrees.
 * @property {{az: number, el: number}} earth Earth azimuth/elevation in degrees.
 */

/**
 * @typedef {Object} EphemerisDataset
 * @property {string} [siteId] Site identifier.
 * @property {{lat: number, lon: number}|null} site Site coordinates.
 * @property {number} moonRadiusM Reference radius in meters.
 * @property {string} [source] Data provenance.
 * @property {Array<{t: number, time: string, sun: Object|null, earth: Object|null}>} samples
 *   Canonical, time-sorted samples with numeric `t` (milliseconds since epoch).
 * @property {number} startMs First sample timestamp.
 * @property {number} endMs Last sample timestamp.
 * @property {number} stepSeconds Median sample spacing in seconds.
 * @property {number|null} [orbitPeriodDays] Lunar orbit period in days used to
 *   replay the covered window periodically, or `null` when not declared.
 */

/**
 * Convert a date-like value to a millisecond timestamp.
 *
 * Accepts `Date`, numeric Unix timestamps (seconds or milliseconds, detected by
 * magnitude), ISO-8601 strings and `YYYY-MM-DD` strings.
 *
 * @param {Date|number|string} value Date-like value.
 * @returns {number} Milliseconds since the Unix epoch, or `NaN`.
 */
export function toTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11) return value
    if (value > 1e8) return value * 1000
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}

/**
 * Normalize an optional dataset-level lunar orbit period in days.
 *
 * @param {*} value Raw value (number or numeric string).
 * @returns {number|null} Positive finite period in days, otherwise `null`.
 */
function normalizeOrbitPeriodDays(value) {
  if (value == null || value === '') return null
  const days = Number(value)
  return Number.isFinite(days) && days > 0 ? days : null
}

/**
 * Format a date-like value as an ISO-8601 string, or `null` when unusable.
 *
 * @param {*} value Raw date-like value.
 * @returns {string|null}
 */
function isoOrNull(value) {
  if (!value) return null
  const timestampMs = toTimestamp(value)
  if (!Number.isFinite(timestampMs)) return null
  const date = new Date(timestampMs)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Normalize one body entry (Sun or Earth) to `{ az, el }` degrees.
 *
 * @param {*} body Raw body object.
 * @returns {{az: number, el: number, distanceM: number|null}|null}
 */
function normalizeBody(body) {
  if (!body || typeof body !== 'object') return null
  const az = Number(body.az ?? body.azimuth ?? body.azDeg ?? body.az_deg)
  const el = Number(body.el ?? body.elevation ?? body.elevDeg ?? body.elevationDeg ?? body.alt)
  if (!Number.isFinite(az) || !Number.isFinite(el)) return null
  const distanceRaw = body.distanceM ?? body.distM ?? body.distanceKm ?? body.distKm
  let distanceM = null
  if (Number.isFinite(Number(distanceRaw))) {
    distanceM = body.distanceKm !== undefined || body.distKm !== undefined
      ? Number(distanceRaw) * 1000
      : Number(distanceRaw)
  }
  return { az: normalizeLongitude(az), el, distanceM }
}

/**
 * Normalize a raw sample into the canonical internal representation.
 *
 * @param {Object} sample Raw sample.
 * @returns {{t: number, time: string, sun: Object|null, earth: Object|null}|null}
 */
function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') return null
  const t = toTimestamp(sample.time ?? sample.t ?? sample.date ?? sample.timestamp)
  if (!Number.isFinite(t)) return null

  const sun =
    normalizeBody(sample.sun) ??
    normalizeBody({
      az: sample.sunAz ?? sample.sun_az,
      el: sample.sunEl ?? sample.sun_el ?? sample.sunElevationDeg,
    })
  const earth =
    normalizeBody(sample.earth) ??
    normalizeBody({
      az: sample.earthAz ?? sample.earth_az,
      el: sample.earthEl ?? sample.earth_el ?? sample.earthElevationDeg,
    })

  if (!sun && !earth) return null
  return {
    t,
    time: new Date(t).toISOString(),
    sun,
    earth,
  }
}

/**
 * Normalize a raw sample list into canonical, time-sorted samples.
 *
 * @param {Array<Object>} rawSamples Raw samples.
 * @returns {Array<Object>} Canonical samples (may be empty).
 */
function normalizeSampleList(rawSamples) {
  if (!Array.isArray(rawSamples)) return []
  const samples = []
  for (const raw of rawSamples) {
    const sample = normalizeSample(raw)
    if (sample) samples.push(sample)
  }
  samples.sort((a, b) => a.t - b.t)
  return samples
}

/**
 * Build a canonical sample list from a columnar dataset.
 *
 * @param {Object} raw Columnar dataset with `times` plus `sun`/`earth` arrays.
 * @returns {Array<Object>|null} Canonical samples, or `null` when not columnar.
 */
function samplesFromColumns(raw) {
  const times = raw.times ?? raw.time
  if (!Array.isArray(times) || times.length === 0) return null
  const samples = []
  for (let index = 0; index < times.length; index += 1) {
    const t = toTimestamp(times[index])
    if (!Number.isFinite(t)) continue
    const sample = { time: new Date(t).toISOString(), sun: null, earth: null }
    for (const bodyKey of BODIES) {
      const columns = raw[bodyKey]
      if (columns && Array.isArray(columns.az) && Array.isArray(columns.el)) {
        sample[bodyKey] = { az: Number(columns.az[index]), el: Number(columns.el[index]) }
      }
    }
    if (sample.sun || sample.earth) samples.push(normalizeSample(sample))
  }
  return samples.filter(Boolean)
}

/**
 * Normalize a precomputed Horizons dataset into the canonical shape.
 *
 * Idempotent: passing an already normalized dataset returns it unchanged.
 *
 * @param {Object|Array} raw Raw dataset (see module documentation).
 * @param {{ siteId?: string }} [options]
 * @returns {EphemerisDataset}
 * @throws {TypeError} When no usable samples are found.
 */
export function normalizeEphemerisDataset(raw, options = {}) {
  if (!raw) throw new TypeError('normalizeEphemerisDataset expects a dataset')
  if (raw[CANONICAL_FLAG] === true) return raw
  if (typeof raw === 'object' && normalizedCache.has(raw)) {
    const cached = normalizedCache.get(raw)
    if (!options.siteId || cached.siteId) return cached
  }

  let source = raw
  if (Array.isArray(raw)) source = { samples: raw }

  const variantsRaw = Array.isArray(source.variants)
    ? source.variants
    : Array.isArray(source.epochs)
      ? source.epochs
      : Array.isArray(source.orbits)
        ? source.orbits
        : []

  let samples = normalizeSampleList(source.samples ?? source.data ?? source.ephemeris)
  if (samples.length === 0) {
    const columnar = samplesFromColumns(source)
    if (columnar) samples = columnar
  }
  if (samples.length === 0 && source.sites && typeof source.sites === 'object') {
    const first = Object.values(source.sites)[0]
    if (first) {
      const nested = normalizeEphemerisDataset(first, options)
      return normalizeEphemerisDataset({ ...source, ...nested, variants: nested.variants }, options)
    }
  }

  const variants = variantsRaw.map((variant, index) => {
    const variantSamples = normalizeSampleList(
      variant.samples ?? variant.data ?? variant.ephemeris,
    )
    return {
      id: String(variant.id ?? variant.name ?? `variant-${index + 1}`),
      label: String(variant.label ?? variant.name ?? `Variant ${index + 1}`),
      validFrom: isoOrNull(variant.validFrom),
      validTo: isoOrNull(variant.validTo),
      startMs: variantSamples.length ? variantSamples[0].t : Number.NaN,
      endMs: variantSamples.length ? variantSamples[variantSamples.length - 1].t : Number.NaN,
      samples: variantSamples,
    }
  })

  if (samples.length === 0 && variants.length > 0) samples = variants[0].samples
  if (samples.length === 0) {
    throw new TypeError('Ephemeris dataset has no usable samples')
  }

  const startMs = samples[0].t
  const endMs = samples[samples.length - 1].t
  let stepSeconds = 1800
  if (samples.length > 1) {
    const intervals = []
    for (let index = 1; index < Math.min(samples.length, 60); index += 1) {
      const interval = samples[index].t - samples[index - 1].t
      if (interval > 0) intervals.push(interval)
    }
    intervals.sort((a, b) => a - b)
    if (intervals.length > 0) stepSeconds = intervals[Math.floor(intervals.length / 2)] / 1000
  }

  const dataset = {
    siteId: String(source.siteId ?? source.site_id ?? source.id ?? options.siteId ?? ''),
    site: source.site ?? (Number.isFinite(source.lat) && Number.isFinite(source.lon) ? { lat: source.lat, lon: source.lon } : null),
    moonRadiusM: Number(source.moonRadiusM ?? source.referenceRadiusM ?? 1737400),
    source: source.source ?? source.provenance ?? 'unknown',
    generated: source.generated ?? source.generatedAt ?? null,
    range: source.range ?? null,
    stepMinutes: source.stepMinutes ?? null,
    orbitPeriodDays: normalizeOrbitPeriodDays(source.orbitPeriodDays),
    samples,
    variants,
    startMs,
    endMs,
    stepSeconds,
    synthetic: source.synthetic === true,
    meta: source.meta ?? null,
    [CANONICAL_FLAG]: true,
  }
  if (typeof raw === 'object') normalizedCache.set(raw, dataset)
  return dataset
}

/**
 * Normalize a catalogue of site datasets keyed by site id.
 *
 * Accepts `{ sites: {...} }`, `{ 'site-id': {...} }` or an array of datasets.
 *
 * @param {Object|Array} raw Catalogue.
 * @returns {Map<string, EphemerisDataset>} Datasets keyed by site id.
 */
export function normalizeEphemerisCatalog(raw) {
  const result = new Map()
  if (!raw) return result
  const entries = Array.isArray(raw)
    ? raw.map((dataset) => [dataset?.siteId ?? dataset?.id ?? '', dataset])
    : Object.entries(raw.sites ?? raw)

  for (const [key, value] of entries) {
    if (!value) continue
    try {
      const dataset = normalizeEphemerisDataset(value, { siteId: key })
      const id = dataset.siteId || key
      if (id) result.set(String(id), dataset)
    } catch {
      /* skip malformed datasets */
    }
  }
  return result
}

/**
 * Metadata summary of a dataset (safe to serialize into the JSON brief).
 *
 * @param {EphemerisDataset} dataset
 * @returns {Object}
 */
export function ephemerisMetadata(dataset) {
  const ds = normalizeEphemerisDataset(dataset)
  return {
    siteId: ds.siteId,
    site: ds.site,
    source: ds.source,
    generated: ds.generated,
    startTime: new Date(ds.startMs).toISOString(),
    endTime: new Date(ds.endMs).toISOString(),
    sampleCount: ds.samples.length,
    stepSeconds: ds.stepSeconds,
    variants: listVariants(ds),
    synthetic: ds.synthetic,
  }
}

/**
 * List the orbital variants available in a dataset.
 *
 * Variants support the "orbital variation" feature: the data pipeline can ship
 * the same site sampled for different lunar orbital epochs (different libration
 * and Earth position), and the UI can let the user compare them.
 *
 * @param {EphemerisDataset} dataset
 * @returns {Array<{id: string, label: string, validFrom: string|null, validTo: string|null, sampleCount: number}>}
 */
export function listVariants(dataset) {
  const ds = normalizeEphemerisDataset(dataset)
  return ds.variants.map((variant) => ({
    id: variant.id,
    label: variant.label,
    validFrom: variant.validFrom,
    validTo: variant.validTo,
    sampleCount: variant.samples.length,
  }))
}

/**
 * Select the sample array to interpolate for a given date and variant request.
 *
 * @param {EphemerisDataset} dataset
 * @param {number} timestampMs Query timestamp.
 * @param {{variantId?: string, orbitIndex?: number}} [options]
 * @returns {{samples: Array<Object>, variantId: string|null}}
 */
function selectSamples(dataset, timestampMs, options = {}) {
  if (options.variantId) {
    const variant = dataset.variants.find((candidate) => candidate.id === String(options.variantId))
    if (variant && variant.samples.length > 0) return { samples: variant.samples, variantId: variant.id }
  }
  if (Number.isInteger(options.orbitIndex)) {
    const variant = dataset.variants[options.orbitIndex]
    if (variant && variant.samples.length > 0) return { samples: variant.samples, variantId: variant.id }
  }
  // Fall back to a variant that explicitly covers the requested date and is not
  // covered by the main sample list.
  const covered = timestampMs >= dataset.startMs && timestampMs <= dataset.endMs
  if (!covered) {
    for (const variant of dataset.variants) {
      if (variant.samples.length === 0) continue
      const fromMs = variant.validFrom ? toTimestamp(variant.validFrom) : variant.startMs
      const toMs = variant.validTo ? toTimestamp(variant.validTo) : variant.endMs
      if (timestampMs >= fromMs && timestampMs <= toMs) {
        return { samples: variant.samples, variantId: variant.id }
      }
    }
  }
  return { samples: dataset.samples, variantId: null }
}

/**
 * Interpolate a body state between two samples.
 *
 * @param {{az: number, el: number}|null} a Earlier body sample.
 * @param {{az: number, el: number}|null} b Later body sample.
 * @param {number} fraction Interpolation fraction in `[0, 1]`.
 * @returns {{az: number, el: number}|null}
 */
function interpolateBody(a, b, fraction) {
  if (!a && !b) return null
  if (!a) return { ...b }
  if (!b) return { ...a }
  const az = normalizeLongitude(a.az + wrapLongitudeDelta(b.az - a.az) * fraction)
  const el = a.el + (b.el - a.el) * fraction
  const result = { az, el }
  if (a.distanceM != null && b.distanceM != null) {
    result.distanceM = a.distanceM + (b.distanceM - a.distanceM) * fraction
  }
  return result
}

/**
 * Interpolate the Sun/Earth azimuth and elevation at any date.
 *
 * Linear interpolation in time, with the azimuth interpolated along the
 * shortest path across 0°/360° and the elevation linearly. Dates outside the
 * dataset range are clamped to the first/last sample and flagged with
 * `extrapolated: true`; when `options.orbitPeriodDays` (or the dataset's own
 * `orbitPeriodDays`) is set, out-of-range dates are wrapped periodically into
 * the covered window instead of clamped.
 *
 * @param {EphemerisDataset} dataset Normalized or raw dataset.
 * @param {Date|number|string} date Query date.
 * @param {{variantId?: string, orbitIndex?: number, orbitPeriodDays?: number}} [options]
 * @returns {EphemerisSample & {extrapolated: boolean, variantId: string|null, timestampMs: number}}
 * @throws {TypeError} When the dataset has no samples.
 */
export function sampleAt(dataset, date, options = {}) {
  const ds = normalizeEphemerisDataset(dataset)
  let timestampMs = toTimestamp(date)
  if (!Number.isFinite(timestampMs)) throw new TypeError('sampleAt expects a valid date')

  const periodDays = Number(options.orbitPeriodDays ?? ds.orbitPeriodDays)
  if (Number.isFinite(periodDays) && periodDays > 0 && !(timestampMs >= ds.startMs && timestampMs <= ds.endMs)) {
    const periodMs = periodDays * 86400 * 1000
    timestampMs = ds.startMs + (((timestampMs - ds.startMs) % periodMs) + periodMs) % periodMs
  }

  const { samples, variantId } = selectSamples(ds, timestampMs, options)
  let extrapolated = false
  if (timestampMs <= samples[0].t) {
    extrapolated = timestampMs < samples[0].t
    const sample = samples[0]
    return {
      time: sample.time,
      sun: sample.sun ? { ...sample.sun } : null,
      earth: sample.earth ? { ...sample.earth } : null,
      extrapolated,
      variantId,
      timestampMs: sample.t,
    }
  }
  if (timestampMs >= samples[samples.length - 1].t) {
    extrapolated = timestampMs > samples[samples.length - 1].t
    const sample = samples[samples.length - 1]
    return {
      time: sample.time,
      sun: sample.sun ? { ...sample.sun } : null,
      earth: sample.earth ? { ...sample.earth } : null,
      extrapolated,
      variantId,
      timestampMs: sample.t,
    }
  }

  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (samples[mid].t <= timestampMs) low = mid
    else high = mid
  }
  const a = samples[low]
  const b = samples[high]
  const span = b.t - a.t
  const fraction = span > 0 ? (timestampMs - a.t) / span : 0
  return {
    time: new Date(timestampMs).toISOString(),
    sun: interpolateBody(a.sun, b.sun, fraction),
    earth: interpolateBody(a.earth, b.earth, fraction),
    extrapolated,
    variantId,
    timestampMs,
  }
}

/**
 * First and last covered timestamps plus spacing.
 *
 * @param {EphemerisDataset} dataset
 * @returns {{startMs: number, endMs: number, startTime: string, endTime: string, sampleCount: number, stepSeconds: number}}
 */
export function datasetRange(dataset) {
  const ds = normalizeEphemerisDataset(dataset)
  return {
    startMs: ds.startMs,
    endMs: ds.endMs,
    startTime: new Date(ds.startMs).toISOString(),
    endTime: new Date(ds.endMs).toISOString(),
    sampleCount: ds.samples.length,
    stepSeconds: ds.stepSeconds,
  }
}

/**
 * Build (or reuse) the terrain horizon profile used by the event finders.
 *
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {{lat: number, lon: number}} site
 * @param {Object} options
 * @returns {import('./engine.js').HorizonProfile|null}
 */
function resolveProfile(terrain, site, options) {
  if (options.profile) return options.profile
  if (!terrain || !site) return null
  return buildEngineHorizonProfile(terrain, site, { stepDeg: options.profileStepDeg ?? 1 })
}

/**
 * Margin (elevation − horizon) of a body at a timestamp.
 *
 * @param {EphemerisDataset} dataset
 * @param {Object} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {number} timestampMs
 * @param {Object} options
 * @returns {number} Margin in degrees (`NaN` when the body is missing).
 */
function marginAt(dataset, site, terrain, body, timestampMs, options) {
  const sample = sampleAt(dataset, timestampMs, options)
  const state = sample[body]
  if (!state) return Number.NaN
  return evaluateBodyVisibility(terrain, site, state, {
    profile: options.profile,
    limbRadiusDeg: options.limbRadiusDeg,
    thresholdDeg: options.thresholdDeg,
  }).marginDeg
}

/**
 * Bisection refinement of a visibility transition timestamp.
 *
 * @param {(timestampMs: number) => number} marginFn
 * @param {number} beforeMs Timestamp with the "before" sign.
 * @param {number} afterMs Timestamp with the "after" sign.
 * @param {boolean} visibleBefore Margin sign before the transition.
 * @returns {number} Transition timestamp in milliseconds.
 */
function refineTransition(marginFn, beforeMs, afterMs, visibleBefore) {
  let low = beforeMs
  let high = afterMs
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const mid = (low + high) / 2
    const margin = marginFn(mid)
    if (!Number.isFinite(margin)) break
    const visible = margin > 0
    if (visible === visibleBefore) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/**
 * Find the next visibility transition (set or rise) of a body.
 *
 * @param {EphemerisDataset} dataset
 * @param {Object} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} from Start of the search.
 * @param {boolean} targetVisible Transition target: `false` = set, `true` = rise.
 * @param {Object} [options]
 * @returns {{time: string, remainingSeconds: number, type: 'set'|'rise', marginDeg: number, elevationDeg: number, horizonDeg: number}|null}
 */
function findNextTransition(dataset, site, terrain, body, from, targetVisible, options = {}) {
  const ds = normalizeEphemerisDataset(dataset)
  const bodyKey = String(body).toLowerCase()
  if (!BODIES.includes(bodyKey)) throw new TypeError(`Unsupported body '${body}' (use 'sun' or 'earth')`)

  const profile = resolveProfile(terrain, site, options)
  const searchOptions = { ...options, profile }
  const marginFn = (timestampMs) => marginAt(ds, site, terrain, bodyKey, timestampMs, searchOptions)

  let fromMs = toTimestamp(from ?? ds.startMs)
  if (!Number.isFinite(fromMs)) throw new TypeError('nextSetEvent expects a valid start date')
  if (fromMs < ds.startMs) fromMs = ds.startMs
  if (fromMs > ds.endMs) return null

  const stepMs = Math.max(1, Number(options.stepSeconds) || 120) * 1000
  const maxSearchMs = Math.min(
    ds.endMs - fromMs,
    (Number(options.maxSearchDays) || 40) * 86400 * 1000,
  )

  const initialMargin = marginFn(fromMs)
  if (!Number.isFinite(initialMargin)) return null
  let previousVisible = initialMargin > 0
  let previousTime = fromMs

  for (let offset = stepMs; offset <= maxSearchMs + stepMs; offset += stepMs) {
    const timestampMs = Math.min(fromMs + offset, ds.endMs)
    const margin = marginFn(timestampMs)
    if (!Number.isFinite(margin)) {
      previousTime = timestampMs
      continue
    }
    const visible = margin > 0
    if (visible !== previousVisible && visible === targetVisible) {
      const transitionMs = refineTransition(marginFn, previousTime, timestampMs, previousVisible)
      const sample = sampleAt(ds, transitionMs, options)
      const state = sample[bodyKey] ?? { az: Number.NaN, el: Number.NaN }
      const evaluation = evaluateBodyVisibility(terrain, site, state, {
        profile,
        limbRadiusDeg: options.limbRadiusDeg,
        thresholdDeg: options.thresholdDeg,
      })
      return {
        time: new Date(transitionMs).toISOString(),
        remainingSeconds: Math.max(0, (transitionMs - fromMs) / 1000),
        type: targetVisible ? 'rise' : 'set',
        marginDeg: evaluation.marginDeg,
        elevationDeg: evaluation.bodyElevationDeg,
        horizonDeg: evaluation.horizonDeg,
      }
    }
    previousVisible = visible
    previousTime = timestampMs
    if (timestampMs >= ds.endMs) break
  }
  return null
}

/**
 * Next time a body sets below the terrain horizon, and the time remaining.
 *
 * Scans forward at `options.stepSeconds` (default 120 s) and refines the
 * crossing by bisection. If the body is already below the horizon, the search
 * continues through the next rise until the following set, so the returned
 * `time` is always a sunset/earthset.
 *
 * @param {EphemerisDataset} dataset
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} from Start of the search (defaults to dataset start).
 * @param {{stepSeconds?: number, maxSearchDays?: number, profile?: Object, profileStepDeg?: number, limbRadiusDeg?: number}} [options]
 * @returns {{time: string, remainingSeconds: number, type: 'set', marginDeg: number, elevationDeg: number, horizonDeg: number}|null}
 */
export function nextSetEvent(dataset, site, terrain, body, from, options = {}) {
  return findNextTransition(dataset, site, terrain, body, from, false, options)
}

/**
 * Next time a body rises above the terrain horizon (complement of
 * {@link nextSetEvent}).
 *
 * @param {EphemerisDataset} dataset
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} from Start of the search.
 * @param {Object} [options] See {@link nextSetEvent}.
 * @returns {{time: string, remainingSeconds: number, type: 'rise', marginDeg: number, elevationDeg: number, horizonDeg: number}|null}
 */
export function nextRiseEvent(dataset, site, terrain, body, from, options = {}) {
  return findNextTransition(dataset, site, terrain, body, from, true, options)
}

/**
 * Visibility windows of a body between two dates.
 *
 * Scans at `options.stepSeconds` (default 120 s), refines each boundary by
 * bisection of the elevation-minus-horizon margin, and returns ISO-8601 windows
 * clipped to the requested interval. A window open at the start of the interval
 * starts at `from`; a window still open at the end is closed at `to`.
 *
 * @param {EphemerisDataset} dataset
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} from Interval start.
 * @param {Date|number|string} to Interval end.
 * @param {{stepSeconds?: number, profile?: Object, profileStepDeg?: number, limbRadiusDeg?: number, clampToData?: boolean}} [options]
 * @returns {Array<{from: string, to: string, durationSeconds: number}>}
 */
export function visibilityWindows(dataset, site, terrain, body, from, to, options = {}) {
  const ds = normalizeEphemerisDataset(dataset)
  const bodyKey = String(body).toLowerCase()
  if (!BODIES.includes(bodyKey)) throw new TypeError(`Unsupported body '${body}' (use 'sun' or 'earth')`)

  let fromMs = toTimestamp(from ?? ds.startMs)
  let toMs = toTimestamp(to ?? ds.endMs)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return []

  const clampToData = options.clampToData !== false
  if (clampToData) {
    fromMs = Math.max(fromMs, ds.startMs)
    toMs = Math.min(toMs, ds.endMs)
    if (toMs <= fromMs) return []
  }

  const profile = resolveProfile(terrain, site, options)
  const searchOptions = { ...options, profile }
  const marginFn = (timestampMs) => marginAt(ds, site, terrain, bodyKey, timestampMs, searchOptions)
  const stepMs = Math.max(1, Number(options.stepSeconds) || 120) * 1000

  const windows = []
  let windowStart = null
  let previousMargin = marginFn(fromMs)
  if (!Number.isFinite(previousMargin)) return []
  let previousVisible = previousMargin > 0
  if (previousVisible) windowStart = fromMs
  let previousTime = fromMs

  for (let timestampMs = Math.min(fromMs + stepMs, toMs); ; timestampMs += stepMs) {
    const currentMs = Math.min(timestampMs, toMs)
    const margin = marginFn(currentMs)
    if (Number.isFinite(margin)) {
      const visible = margin > 0
      if (visible !== previousVisible) {
        const transitionMs = refineTransition(marginFn, previousTime, currentMs, previousVisible)
        if (visible) {
          windowStart = transitionMs
        } else if (windowStart != null) {
          windows.push({
            from: new Date(windowStart).toISOString(),
            to: new Date(transitionMs).toISOString(),
            durationSeconds: (transitionMs - windowStart) / 1000,
          })
          windowStart = null
        }
      }
      previousVisible = visible
      previousMargin = margin
    }
    previousTime = currentMs
    if (currentMs >= toMs) break
  }

  if (previousVisible && windowStart != null && toMs - windowStart > 1000) {
    windows.push({
      from: new Date(windowStart).toISOString(),
      to: new Date(toMs).toISOString(),
      durationSeconds: (toMs - windowStart) / 1000,
    })
  }
  return windows
}

/**
 * Aggregate visibility statistics for a body over an interval.
 *
 * Convenience wrapper used by the power, communications and autopilot modules:
 * total visible time, visible fraction and the longest continuous window.
 *
 * @param {EphemerisDataset} dataset
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} from Interval start.
 * @param {Date|number|string} to Interval end.
 * @param {Object} [options] See {@link visibilityWindows}.
 * @returns {{
 *   windows: Array<{from: string, to: string, durationSeconds: number}>,
 *   visibleSeconds: number,
 *   totalSeconds: number,
 *   fraction: number,
 *   longestWindowSeconds: number,
 *   longestWindow: {from: string, to: string, durationSeconds: number}|null,
 *   longestWindowDays: number,
 * }}
 */
export function visibilityStatistics(dataset, site, terrain, body, from, to, options = {}) {
  const windows = visibilityWindows(dataset, site, terrain, body, from, to, options)
  const fromMs = toTimestamp(from)
  const toMs = toTimestamp(to)
  const totalSeconds = Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, (toMs - fromMs) / 1000) : 0
  let visibleSeconds = 0
  let longestWindow = null
  for (const window of windows) {
    visibleSeconds += window.durationSeconds
    if (!longestWindow || window.durationSeconds > longestWindow.durationSeconds) longestWindow = window
  }
  return {
    windows,
    visibleSeconds,
    totalSeconds,
    fraction: totalSeconds > 0 ? Math.min(1, visibleSeconds / totalSeconds) : 0,
    longestWindowSeconds: longestWindow ? longestWindow.durationSeconds : 0,
    longestWindow,
    longestWindowDays: longestWindow ? longestWindow.durationSeconds / 86400 : 0,
  }
}

/**
 * Evaluate a body at one instant without allocating a full scan.
 *
 * @param {EphemerisDataset} dataset
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {'sun'|'earth'} body
 * @param {Date|number|string} date Instant to evaluate.
 * @param {{profile?: Object, limbRadiusDeg?: number, variantId?: string}} [options]
 * @returns {{visible: boolean, marginDeg: number, horizonDeg: number, bodyElevationDeg: number, bodyAzimuthDeg: number, time: string}|null}
 */
export function bodyStateAt(dataset, site, terrain, body, date, options = {}) {
  const ds = normalizeEphemerisDataset(dataset)
  const bodyKey = String(body).toLowerCase()
  if (!BODIES.includes(bodyKey)) throw new TypeError(`Unsupported body '${body}' (use 'sun' or 'earth')`)
  const sample = sampleAt(ds, date, options)
  const state = sample[bodyKey]
  if (!state) return null
  const evaluation = evaluateBodyVisibility(terrain, site, state, {
    profile: options.profile,
    limbRadiusDeg: options.limbRadiusDeg,
    thresholdDeg: options.thresholdDeg,
  })
  return {
    ...evaluation,
    time: sample.time,
    extrapolated: sample.extrapolated,
    variantId: sample.variantId,
  }
}

/**
 * Build the default URL of a precomputed ephemeris file.
 *
 * Uses the Vite base URL (`import.meta.env.BASE_URL`) so a deployment under a
 * sub-path keeps working. Falls back to `/data/` in plain Node environments.
 *
 * @param {string} siteId Site identifier (file name without `.json`).
 * @param {string} [baseUrl] Override for the data base URL.
 * @returns {string}
 */
export function ephemerisUrl(siteId, baseUrl) {
  let base = baseUrl
  if (!base) {
    base = '/data/'
    try {
      const viteBase = import.meta?.env?.BASE_URL
      if (typeof viteBase === 'string') {
        base = `${viteBase.endsWith('/') ? viteBase : `${viteBase}/`}data/`
      }
    } catch {
      /* import.meta.env is not available in every environment */
    }
  }
  if (!base.endsWith('/')) base += '/'
  return `${base}ephemeris/${encodeURIComponent(siteId)}.json`
}

/**
 * Load a precomputed ephemeris dataset from `public/data/ephemeris`.
 *
 * Tolerant by design: missing files, network errors and malformed JSON are
 * logged as warnings and result in `null` so the application never crashes when
 * the static data is not available (it can show a "no ephemeris" state).
 *
 * @param {string} siteId Site identifier.
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 * }} [options]
 * @returns {Promise<EphemerisDataset|null>}
 */
export async function loadEphemeris(siteId, options = {}) {
  if (!siteId) return null
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    console.warn('[ephemeris] fetch is not available in this environment')
    return null
  }
  const url = ephemerisUrl(siteId, options.baseUrl)
  try {
    const response = await fetchImpl(url, { signal: options.signal, cache: 'no-cache' })
    if (!response || !response.ok) {
      console.warn(`[ephemeris] Could not load ${url}: HTTP ${response ? response.status : 'error'}`)
      return null
    }
    const payload = await response.json()
    const dataset = normalizeEphemerisDataset(payload, { siteId })
    return dataset
  } catch (error) {
    console.warn(`[ephemeris] Could not load ${url}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
