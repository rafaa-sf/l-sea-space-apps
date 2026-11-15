/**
 * Sites service: loads the point-of-interest catalogue from
 * `public/data/pois.json`, normalizes site records and creates custom/pointer
 * sites.
 *
 * The catalogue is produced by the data pipeline; this module is tolerant of
 * missing or malformed data and never throws on load (the UI has its own
 * fallback catalogue and the worker can still score whatever sites it receives).
 *
 * @module services/sites
 */

import { normalizeLongitude } from '../core/geometry.js'
import { dataUrl } from './dataUrl.js'

/** Path of the POI catalogue inside `public/data/`. */
export const POIS_PATH = 'pois.json'

/** @type {import('../core/terrain.js').Site|null} */
export const SITE_SOURCES = Object.freeze(['poi', 'custom', 'pointer', 'fallback'])

/**
 * Slugify a site name into a stable identifier.
 *
 * @param {string} value Raw value.
 * @param {string} [fallback='site'] Fallback when the result would be empty.
 * @returns {string}
 */
export function slugify(value, fallback = 'site') {
  return (
    String(value ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  )
}

/**
 * Normalize one POI record into the documented `Site` shape.
 *
 * Accepts the field names used by the data pipeline (`lat`, `lon`,
 * `elevationM`, `perimeterM`, `mastM`, `provenance`, ...) as well as common
 * aliases (`latitude`, `longitude`, `elevation`, `elev`).
 *
 * @param {Object} raw Raw site record.
 * @param {number} [index=0] Position used for id generation.
 * @returns {{
 *   id: string,
 *   name: string,
 *   lat: number,
 *   lon: number,
 *   elevationM: number|null,
 *   perimeterM: number|null,
 *   mastM: number|null,
 *   source: string,
 *   provenance?: string,
 *   sourceUrl?: string|null,
 *   description?: string|null,
 * }|null} Normalized site or `null` when coordinates are invalid.
 */
export function normalizeSite(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const lat = Number(raw.lat ?? raw.latitude)
  const lon = Number(raw.lon ?? raw.longitude ?? raw.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90) return null

  const elevation = raw.elevationM ?? raw.elevation ?? raw.elev ?? raw.altitudeM ?? raw.altitude
  const perimeter = raw.perimeterM ?? raw.perimeter ?? raw.siteRadiusM
  const mast = raw.mastM ?? raw.mast ?? raw.mastHeightM

  return {
    id: slugify(raw.id ?? raw.slug ?? raw.name ?? `site-${index + 1}`),
    name: String(raw.name ?? raw.label ?? raw.id ?? `Site ${index + 1}`),
    lat,
    lon: normalizeLongitude(lon),
    elevationM: Number.isFinite(Number(elevation)) ? Number(elevation) : null,
    perimeterM: Number.isFinite(Number(perimeter)) ? Number(perimeter) : null,
    mastM: Number.isFinite(Number(mast)) ? Number(mast) : null,
    source: String(raw.source ?? 'poi'),
    provenance: raw.provenance ?? raw.citation ?? null,
    sourceUrl: raw.sourceUrl ?? raw.url ?? null,
    elevationSource: raw.elevationSource ?? null,
    terrainRegion: raw.terrainRegion ?? raw.region ?? null,
    description: raw.description ?? raw.note ?? null,
  }
}

/**
 * Parse a POI payload into a site list.
 *
 * Accepts a plain array, `{ sites }`, `{ pois }`, `{ points }`, a keyed object,
 * or a GeoJSON `FeatureCollection` of `Point` features.
 *
 * @param {*} payload Raw JSON payload.
 * @returns {Array<Object>} Normalized sites (possibly empty).
 */
export function parseSitesPayload(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) {
    return payload.map(normalizeSite).filter(Boolean)
  }
  if (typeof payload !== 'object') return []

  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features
      .map((feature, index) => {
        const coordinates = feature?.geometry?.coordinates
        if (!Array.isArray(coordinates)) return null
        const properties = feature.properties ?? {}
        return normalizeSite(
          {
            ...properties,
            id: properties.id ?? feature.id ?? `feature-${index + 1}`,
            lat: properties.lat ?? coordinates[1],
            lon: properties.lon ?? coordinates[0],
          },
          index,
        )
      })
      .filter(Boolean)
  }

  const list = payload.sites ?? payload.pois ?? payload.points ?? payload.items ?? payload.data
  if (Array.isArray(list)) return list.map(normalizeSite).filter(Boolean)
  return []
}

/**
 * Load the POI catalogue. Never throws.
 *
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number}} [options]
 * @returns {Promise<Array<Object>>} Normalized sites (empty when unavailable).
 */
export async function loadSites(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return []
  const url = dataUrl(POIS_PATH, options.dataRoot)
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000
  const attempts = Math.max(1, Math.min(3, Number.isFinite(Number(options.retries)) ? Number(options.retries) : 2))
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = options.signal ? null : new AbortController()
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const response = await fetchImpl(url, {
        signal: options.signal ?? controller?.signal,
        cache: 'no-cache',
      })
      if (!response || !response.ok) {
        console.warn(`[sites] could not load ${url}: HTTP ${response?.status ?? 'error'}`)
        // 4xx is authoritative (e.g. POI catalogue genuinely missing).
        if (response && response.status >= 400 && response.status < 500) return []
        continue
      }
      const payload = await response.json()
      const sites = parseSitesPayload(payload)
      if (sites.length === 0) console.warn(`[sites] ${url} contains no usable sites`)
      return sites
    } catch (error) {
      console.warn(`[sites] could not load ${url}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
  }
  return []
}

/**
 * Create a site from custom coordinates.
 *
 * @param {{lat: number, lon: number, name?: string|null, elevationM?: number|null, perimeterM?: number|null, mastM?: number|null, source?: string}} input
 * @returns {Object} Site in the documented shape.
 * @throws {TypeError} When latitude/longitude are invalid.
 */
export function createCustomSite(input = {}) {
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new TypeError('createCustomSite expects a latitude between -90 and 90')
  }
  if (!Number.isFinite(lon)) throw new TypeError('createCustomSite expects a finite longitude')

  const safeLon = normalizeLongitude(lon)
  const id = slugify(
    input.id ?? input.name ?? `custom-${lat.toFixed(3)}-${safeLon.toFixed(3)}`,
    'custom-site',
  )
  return {
    id,
    name: String(input.name ?? `Custom site ${lat.toFixed(3)}°, ${safeLon.toFixed(3)}°E`),
    lat,
    lon: safeLon,
    elevationM: Number.isFinite(Number(input.elevationM)) ? Number(input.elevationM) : null,
    perimeterM: Number.isFinite(Number(input.perimeterM)) ? Number(input.perimeterM) : null,
    mastM: Number.isFinite(Number(input.mastM)) ? Number(input.mastM) : null,
    source: input.source === 'pointer' ? 'pointer' : 'custom',
    provenance: 'User-defined site',
    sourceUrl: null,
    description: null,
  }
}

/**
 * Create a site from a map pointer click (same data as a custom site, but with
 * `source: 'pointer'`).
 *
 * @param {{lat: number, lon: number, elevationM?: number|null, name?: string|null}} input
 * @returns {Object}
 */
export function createPointerSite(input = {}) {
  return createCustomSite({ ...input, source: 'pointer' })
}

/**
 * Find a site by id.
 *
 * @param {Array<Object>} sites
 * @param {string} id
 * @returns {Object|null}
 */
export function getSiteById(sites, id) {
  if (!Array.isArray(sites)) return null
  return sites.find((site) => site?.id === id) ?? null
}

/**
 * Normalize a list of sites (deduplicating ids).
 *
 * @param {Array<Object>} sites
 * @returns {Array<Object>}
 */
export function normalizeSites(sites) {
  if (!Array.isArray(sites)) return []
  const seen = new Set()
  const result = []
  sites.forEach((site, index) => {
    const normalized = normalizeSite(site, index)
    if (!normalized) return
    if (seen.has(normalized.id)) return
    seen.add(normalized.id)
    result.push(normalized)
  })
  return result
}
