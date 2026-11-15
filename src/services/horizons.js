/**
 * Horizons service: loads the precomputed JPL Horizons ephemeris datasets from
 * `public/data/ephemeris/` and (development only) can query the live Horizons
 * API through the Vite proxy.
 *
 * Production is static, therefore the live query is a development convenience
 * only: JPL Horizons does not send CORS headers and cannot be called directly by
 * the deployed browser app. The precomputed files are the source of truth.
 *
 * @module services/horizons
 */

import {
  loadEphemeris as loadEphemerisCore,
  normalizeEphemerisDataset,
  ephemerisMetadata,
  sampleAt,
  nextSetEvent,
  nextRiseEvent,
  visibilityWindows,
  visibilityStatistics,
  datasetRange,
  toTimestamp,
} from '../core/ephemeris.js'
import { dataUrl } from './dataUrl.js'

/** Path of the ephemeris index inside `public/data/`. */
export const EPHEMERIS_INDEX_PATH = 'ephemeris/index.json'

/** Dev-only proxy endpoint configured in `vite.config.js`. */
export const HORIZONS_PROXY_PATH = '/nasa/horizons'

/** Cache of in-flight/loaded datasets, keyed by site id. */
const ephemerisCache = new Map()

/** Cache of the ephemeris index payload. */
let indexPromise = null

/**
 * Load the ephemeris index (`ephemeris/index.json`), if present.
 *
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<Object|null>} Index payload or `null`.
 */
export async function loadEphemerisIndex(options = {}) {
  if (indexPromise) return indexPromise
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const url = dataUrl(EPHEMERIS_INDEX_PATH, options.dataRoot)
  indexPromise = (async () => {
    try {
      const response = await fetchImpl(url, { cache: 'no-cache' })
      if (!response || !response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  })()
  return indexPromise
}

/**
 * Load the precomputed ephemeris for one site. Successful results are cached;
 * failed loads (`null`, e.g. a network error or HTTP failure) are evicted so the
 * next call retries instead of caching the failure for the whole session.
 *
 * @param {string} siteId Site identifier / file name.
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch, signal?: AbortSignal, force?: boolean}} [options]
 * @returns {Promise<import('../core/ephemeris.js').EphemerisDataset|null>}
 */
export function loadEphemeris(siteId, options = {}) {
  if (!siteId) return Promise.resolve(null)
  const key = String(siteId)
  if (!options.force && ephemerisCache.has(key)) return ephemerisCache.get(key)

  const promise = (async () => {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000
    const attempts = Math.max(1, Math.min(3, Number.isFinite(Number(options.retries)) ? Number(options.retries) : 2))
    let dataset = null
    for (let attempt = 1; attempt <= attempts && !dataset; attempt += 1) {
      const controller = options.signal ? null : new AbortController()
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        dataset = await loadEphemerisCore(key, {
          baseUrl: options.dataRoot,
          fetchImpl: options.fetchImpl,
          signal: options.signal ?? controller?.signal,
        })
      } catch {
        dataset = null
      } finally {
        if (timer) clearTimeout(timer)
      }
      if (!dataset && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      }
    }
    if (!dataset) return null
    // Keep the canonical site id stable even if the file omitted it.
    if (!dataset.siteId) dataset.siteId = key
    return dataset
  })()

  ephemerisCache.set(key, promise)
  promise.then(
    (dataset) => {
      if (!dataset && ephemerisCache.get(key) === promise) ephemerisCache.delete(key)
    },
    () => {
      if (ephemerisCache.get(key) === promise) ephemerisCache.delete(key)
    },
  )
  return promise
}

/**
 * Load several site ephemerides at once.
 *
 * @param {Array<string>} siteIds Site identifiers.
 * @param {Object} [options] See {@link loadEphemeris}.
 * @returns {Promise<Map<string, import('../core/ephemeris.js').EphemerisDataset>>}
 */
export async function loadEphemerisMap(siteIds, options = {}) {
  const ids = Array.isArray(siteIds) ? siteIds.filter(Boolean) : []
  const entries = await Promise.all(
    ids.map(async (siteId) => {
      const dataset = await loadEphemeris(siteId, options)
      return dataset ? [String(siteId), dataset] : null
    }),
  )
  return new Map(entries.filter(Boolean))
}

/**
 * Get an already loaded dataset without triggering a request.
 *
 * @param {string} siteId
 * @returns {Promise<import('../core/ephemeris.js').EphemerisDataset|null>|null}
 */
export function getCachedEphemeris(siteId) {
  return ephemerisCache.get(String(siteId)) ?? null
}

/**
 * Drop the ephemeris cache (e.g. after regenerating the dataset).
 *
 * @returns {void}
 */
export function clearEphemerisCache() {
  ephemerisCache.clear()
  indexPromise = null
}

/**
 * Convert a Date to the Horizons `START_TIME`/`STOP_TIME` format.
 *
 * @param {Date|number|string} date
 * @returns {string} `YYYY-MM-DD HH:MM` in UTC.
 */
export function toHorizonsDate(date) {
  const timestamp = toTimestamp(date)
  if (!Number.isFinite(timestamp)) throw new TypeError('toHorizonsDate expects a valid date')
  const iso = new Date(timestamp).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/**
 * Build a JPL Horizons observer query for a topocentric lunar site.
 *
 * The site is supplied as selenodetic coordinates in the Moon-fixed frame
 * (`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`) and the requested quantity is
 * apparent azimuth/elevation (`QUANTITIES='4'`), matching the precomputed data.
 *
 * @param {{
 *   target?: string,
 *   site?: {lat: number, lon: number, elevationM?: number|null},
 *   start?: Date|number|string,
 *   stop?: Date|number|string,
 *   step?: string,
 *   quantities?: string,
 *   endpoint?: string,
 *   extraParams?: Record<string, string>,
 * }} [options]
 * @returns {string} Full URL (proxy endpoint + query string).
 */
export function buildHorizonsQuery(options = {}) {
  const target = String(options.target ?? '10') // 10 = Sun, 399 = Earth
  const site = options.site ?? { lat: -90, lon: 0, elevationM: 0 }
  const elevationM = Number(site.elevationM ?? 0)
  const siteCoord = `${Number(site.lon).toFixed(5)},${Number(site.lat).toFixed(5)},${elevationM.toFixed(0)}`
  const start = toHorizonsDate(options.start ?? Date.now())
  const stop = toHorizonsDate(options.stop ?? Date.now() + 2 * 86400 * 1000)
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: target,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: siteCoord,
    START_TIME: start,
    STOP_TIME: stop,
    STEP_SIZE: options.step ?? '30 m',
    QUANTITIES: options.quantities ?? '4',
    ANG_FORMAT: 'DEG',
    EXTRA_PREC: 'YES',
    ...(options.extraParams ?? {}),
  })
  return `${options.endpoint ?? HORIZONS_PROXY_PATH}?${params.toString()}`
}

/**
 * Parse the CSV observer table returned by Horizons.
 *
 * @param {string} text Horizons `$$SOE`-delimited table.
 * @returns {Array<{time: string, az: number, el: number}>} Parsed rows.
 */
export function parseHorizonsTable(text) {
  if (typeof text !== 'string') return []
  const start = text.indexOf('$$SOE')
  const end = text.indexOf('$$EOE')
  const body = start >= 0 && end > start ? text.slice(start + 5, end) : text
  const rows = []
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/(\d{4})-([A-Za-z]{3})-(\d{2})[ T](\d{2}):(\d{2})/)
    if (!match) continue
    const month = monthNames.indexOf(match[2].toLowerCase())
    if (month < 0) continue
    const iso = `${match[1]}-${String(month + 1).padStart(2, '0')}-${match[3]}T${match[4]}:${match[5]}:00Z`

    const numbers = []
    for (const token of line.split(',')) {
      const value = Number(token.trim())
      if (Number.isFinite(value)) numbers.push(value)
    }
    if (numbers.length < 2) continue
    rows.push({ time: iso, az: numbers[numbers.length - 2], el: numbers[numbers.length - 1] })
  }
  return rows
}

/**
 * Parse a Horizons JSON response (or its `result` string) into observer rows.
 *
 * @param {Object|string} payload JSON response or raw text.
 * @returns {Array<{time: string, az: number, el: number}>}
 */
export function parseHorizonsJson(payload) {
  if (typeof payload === 'string') return parseHorizonsTable(payload)
  if (!payload || typeof payload !== 'object') return []
  const text = payload.result ?? payload.output ?? payload.text ?? payload.data
  return typeof text === 'string' ? parseHorizonsTable(text) : []
}

/**
 * Merge Sun and Earth observer rows into an ephemeris dataset.
 *
 * @param {Array<{time: string, az: number, el: number}>} sunRows
 * @param {Array<{time: string, az: number, el: number}>} earthRows
 * @param {{siteId?: string, site?: Object, source?: string}} [meta]
 * @returns {import('../core/ephemeris.js').EphemerisDataset}
 */
export function mergeLiveBodies(sunRows, earthRows, meta = {}) {
  const earthByTime = new Map((earthRows ?? []).map((row) => [row.time, row]))
  const sunByTime = new Map((sunRows ?? []).map((row) => [row.time, row]))
  const times = [...new Set([...sunByTime.keys(), ...earthByTime.keys()])].sort()
  const samples = times.map((time) => {
    const sun = sunByTime.get(time)
    const earth = earthByTime.get(time)
    return {
      time,
      sun: sun ? { az: sun.az, el: sun.el } : null,
      earth: earth ? { az: earth.az, el: earth.el } : null,
    }
  })
  return normalizeEphemerisDataset({
    siteId: meta.siteId ?? 'live',
    site: meta.site ?? null,
    source: meta.source ?? 'JPL Horizons API (development proxy)',
    synthetic: false,
    samples,
  })
}

/**
 * Query the live JPL Horizons API for Sun and Earth positions. **Development
 * only**: the production build cannot reach Horizons because of CORS.
 *
 * @param {{site: Object, start: Date|number|string, stop: Date|number|string, step?: string, endpoint?: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<import('../core/ephemeris.js').EphemerisDataset>}
 */
export async function fetchLiveHorizons(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available')
  const site = options.site
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) {
    throw new TypeError('fetchLiveHorizons expects a site with lat/lon')
  }

  const query = (target) =>
    buildHorizonsQuery({
      target,
      site,
      start: options.start,
      stop: options.stop,
      step: options.step ?? '30 m',
      endpoint: options.endpoint,
    })

  const [sunResponse, earthResponse] = await Promise.all([
    fetchImpl(query('10'), { cache: 'no-cache' }),
    fetchImpl(query('399'), { cache: 'no-cache' }),
  ])
  if (!sunResponse.ok || !earthResponse.ok) {
    throw new Error(`Horizons request failed (${sunResponse.status}/${earthResponse.status})`)
  }
  const sunRows = parseHorizonsJson(await sunResponse.json())
  const earthRows = parseHorizonsJson(await earthResponse.json())
  if (earthRows.length === 0 && sunRows.length > 0) {
    console.warn('[horizons] live Earth query returned no rows; dataset has Sun only')
  }
  return mergeLiveBodies(sunRows, earthRows, {
    siteId: site.id ?? 'live',
    site: { lat: Number(site.lat), lon: Number(site.lon) },
  })
}

/**
 * Re-export the core ephemeris helpers used by the UI/worker so the service is a
 * single import point for ephemeris data and computation.
 */
export {
  normalizeEphemerisDataset,
  ephemerisMetadata,
  sampleAt,
  nextSetEvent,
  nextRiseEvent,
  visibilityWindows,
  visibilityStatistics,
  datasetRange,
}
