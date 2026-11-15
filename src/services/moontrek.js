/**
 * Moon Trek service: layer catalogue and tile/WMS URL builders.
 *
 * `public/data/layers.json` is produced by the data pipeline from the NASA Moon
 * Trek WMTS API. Every layer is south-polar-stereographic WMTS (IAU2000:30120,
 * not a latitude/longitude grid): the tiles are served by `trek.nasa.gov` and can
 * be displayed directly by the browser (CORS is enabled). This module keeps the
 * catalogue tolerant and exposes the URL builders used by the UI layer panel and
 * the JSON brief export.
 *
 * The Moon Trek API is documented at
 * <https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon>.
 *
 * @module services/moontrek
 */

import { dataUrl } from './dataUrl.js'

/** Path of the layer catalogue inside `public/data/`. */
export const LAYERS_PATH = 'layers.json'

/** Base viewer URL of NASA Moon Trek. */
export const MOON_TREK_URL = 'https://trek.nasa.gov/moon/'

/**
 * Base URL of LROC QuickMap. The legacy `quickmap.lroc.asu.edu` host redirects
 * here; the current app ignores lon/lat `extent` and uses `prjExtent` in the
 * display projection instead (see {@link buildQuickMapUrl}).
 */
export const QUICK_MAP_URL = 'https://quickmap.lroc.im-ldi.com/'

/** Reference radius and QuickMap half-span used for the projected extent. */
const QUICK_MAP_REFERENCE_RADIUS_M = 1737400
const QUICK_MAP_HALF_SPAN_M = 25000
const QUICK_MAP_SOUTH_POLAR_PROJECTION = 10

/** Attribution required by the Moon Trek/LOLA/LROC data. */
export const MOON_TREK_ATTRIBUTION =
  'NASA/GSFC/ASU — Moon Trek (trek.nasa.gov) and LRO/LOLA/LROC teams'

/** In-memory cache of the parsed layer catalogue. */
let cataloguePromise = null

/**
 * Load and cache `public/data/layers.json`. Never throws. A successful
 * catalogue (even an empty one) stays cached; a catalogue that could only be
 * built from a fetch error is evicted so the next call retries.
 *
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch, force?: boolean}} [options]
 * @returns {Promise<{
 *   layers: Array<Object>,
 *   projection: Object|null,
 *   attribution: string,
 *   source: string|null,
 *   generated: string|null,
 * }>}
 */
export async function loadLayerCatalogue(options = {}) {
  if (cataloguePromise && !options.force) return cataloguePromise
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const url = dataUrl(LAYERS_PATH, options.dataRoot)
  const state = { failed: false }
  const promise = (async () => {
    const empty = { layers: [], projection: null, attribution: MOON_TREK_ATTRIBUTION, source: null, generated: null }
    if (typeof fetchImpl !== 'function') return empty
    try {
      const response = await fetchImpl(url, { cache: 'no-cache' })
      if (!response || !response.ok) {
        console.warn(`[moontrek] could not load ${url}: HTTP ${response?.status ?? 'error'}`)
        state.failed = true
        return empty
      }
      const payload = await response.json()
      const layers = Array.isArray(payload) ? payload : payload?.layers ?? payload?.items ?? []
      return {
        layers: Array.isArray(layers) ? layers : [],
        projection: payload?.projection ?? null,
        attribution: payload?.attribution ?? MOON_TREK_ATTRIBUTION,
        source: payload?.source ?? null,
        generated: payload?.generated ?? null,
      }
    } catch (error) {
      console.warn(`[moontrek] could not load ${url}: ${error instanceof Error ? error.message : String(error)}`)
      state.failed = true
      return empty
    }
  })()
  cataloguePromise = promise
  promise.then(
    () => {
      if (state.failed && cataloguePromise === promise) cataloguePromise = null
    },
    () => {
      if (cataloguePromise === promise) cataloguePromise = null
    },
  )
  return promise
}

/**
 * Load the layer catalogue and return just the layer list.
 *
 * @param {Object} [options] See {@link loadLayerCatalogue}.
 * @returns {Promise<Array<Object>>}
 */
export async function loadLayers(options = {}) {
  const catalogue = await loadLayerCatalogue(options)
  return catalogue.layers
}

/**
 * Find a layer by id.
 *
 * @param {Array<Object>} layers
 * @param {string} id
 * @returns {Object|null}
 */
export function getLayerById(layers, id) {
  if (!Array.isArray(layers)) return null
  return layers.find((layer) => layer?.id === id) ?? null
}

/**
 * Build a tile URL for a WMTS/XYZ layer.
 *
 * Supports both placeholder conventions found in the catalogue:
 * `{z}/{x}/{y}` and the OGC `{TileMatrix}/{TileCol}/{TileRow}` form (plus the
 * `{s}` subdomain token used by XYZ services).
 *
 * @param {Object} layer Layer entry.
 * @param {{z: number, x: number, y: number, s?: string}} tile Tile coordinates.
 * @returns {string|null} Tile URL, or `null` when the layer has no template.
 */
export function buildTileUrl(layer, tile) {
  if (!layer || !tile) return null
  const z = Number(tile.z)
  const x = Number(tile.x)
  const y = Number(tile.y)
  if (![z, x, y].every(Number.isFinite)) return null
  const template = layer.url ?? layer.template ?? null
  if (typeof template !== 'string' || template.length === 0) return null
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{TileMatrix\}/g, String(z))
    .replace(/\{TileCol\}/g, String(x))
    .replace(/\{TileRow\}/g, String(y))
    .replace(/\{s\}/g, tile.s ?? 'a')
}

/**
 * Build a WMTS KVP `GetTile` URL for a layer that exposes a `capabilitiesUrl`.
 *
 * @param {Object} layer Layer entry.
 * @param {{z: number, x: number, y: number, format?: string}} tile Tile coordinates.
 * @returns {string|null}
 */
export function buildWmtsKvpUrl(layer, tile) {
  if (!layer || !tile) return null
  const capabilities = layer.capabilitiesUrl ?? layer.url
  if (typeof capabilities !== 'string') return null
  const base = capabilities.split('?')[0].replace(/\/WMTSCapabilities\.xml$/i, '')
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: String(layer.label ?? layer.id ?? ''),
    STYLE: 'default',
    TILEMATRIXSET: String(layer.tileMatrixSet ?? 'default028mm'),
    TILEMATRIX: String(tile.z),
    TILEROW: String(tile.y),
    TILECOL: String(tile.x),
    FORMAT: String(layer.format ?? 'image/png'),
  })
  return `${base}?${params.toString()}`
}

/**
 * Build a WMS `GetMap` URL for a hypothetical WMS layer (kept for adapters).
 *
 * @param {Object} layer Layer entry with a WMS endpoint in `url`/`wmsUrl`.
 * @param {{bbox: [number, number, number, number], width: number, height: number, crs?: string, format?: string, transparent?: boolean}} request
 * @returns {string|null}
 */
export function buildWmsUrl(layer, request) {
  if (!layer || !request) return null
  const endpoint = layer.wmsUrl ?? layer.url
  if (typeof endpoint !== 'string' || !Array.isArray(request.bbox) || request.bbox.length !== 4) return null
  const base = endpoint.split('?')[0]
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: String(layer.wmsLayer ?? layer.label ?? layer.id ?? ''),
    STYLES: '',
    FORMAT: String(request.format ?? layer.format ?? 'image/png'),
    TRANSPARENT: request.transparent === false ? 'FALSE' : 'TRUE',
    SRS: String(request.crs ?? 'EPSG:30120'),
    BBOX: request.bbox.join(','),
    WIDTH: String(request.width ?? 512),
    HEIGHT: String(request.height ?? 512),
  })
  return `${base}?${params.toString()}`
}

/**
 * Build a Moon Trek viewer URL.
 *
 * Moon Trek does not document a stable per-site deep-link query format, so the
 * link points at the public viewer (optionally with the layer capabilities URL
 * preserved for reference in the brief metadata).
 *
 * @param {{layer?: Object|null, layerId?: string|null}} [options]
 * @returns {string}
 */
export function buildMoonTrekViewerUrl(site = {}) {
  // Documented Moon Trek deep link: v1/115/0.5/0/<lon>/<lat>/...
  // Layer/link callers may still pass `{ layer }` or `{ viewerUrl }`; those keep
  // their explicit viewer URL, otherwise a site-centred link is built.
  const explicit = site?.layer?.viewerUrl ?? site?.viewerUrl
  if (explicit) return explicit
  const lat = Number(site?.lat)
  const lon = Number(site?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return MOON_TREK_URL
  const lonDeg = ((lon % 360) + 360) % 360
  const latDeg = Math.max(-90, Math.min(90, lat))
  return `${MOON_TREK_URL}#/v1/115/0.5/0/${lonDeg.toFixed(3)}/${latDeg.toFixed(3)}/-170.000/0.000/90.000/0/0/0`
}

/** Round to one decimal place for the QuickMap projection extent. */
function roundProjectedMeters(value) {
  return Math.round(value * 10) / 10
}

/**
 * Build an LROC QuickMap link for a site.
 *
 * The current QuickMap app ignores the legacy lon/lat `extent` parameter and
 * opens in the south-polar stereographic projection (`proj=10`) using
 * `prjExtent=xMin,yMin,xMax,yMax` in that projection's metres. The extent is a
 * square of ±25 km around the site, projected with the same LOLA polar
 * stereographic formula as the DEM pipeline:
 *
 * `rho = 2·R·tan(π/4 + lat/2); x = rho·sin(lon); y = rho·cos(lon)`, R = 1737400 m.
 *
 * @param {{lat?: number, lon?: number}} site
 * @returns {string} QuickMap URL, or the bare catalogue base URL when the site is invalid.
 */
export function buildQuickMapUrl(site) {
  const latDeg = Number(site?.lat)
  const lonDeg = Number(site?.lon)
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return QUICK_MAP_URL
  const lat = Math.max(-90, Math.min(90, latDeg))
  const lon = (lonDeg * Math.PI) / 180
  const rho = 2 * QUICK_MAP_REFERENCE_RADIUS_M * Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)
  const x = rho * Math.sin(lon)
  const y = rho * Math.cos(lon)
  const extent = [
    roundProjectedMeters(x - QUICK_MAP_HALF_SPAN_M),
    roundProjectedMeters(y - QUICK_MAP_HALF_SPAN_M),
    roundProjectedMeters(x + QUICK_MAP_HALF_SPAN_M),
    roundProjectedMeters(y + QUICK_MAP_HALF_SPAN_M),
  ].join(',')
  return `${QUICK_MAP_URL}?proj=${QUICK_MAP_SOUTH_POLAR_PROJECTION}&prjExtent=${extent}`
}

/**
 * Attribution string for a layer (falls back to the catalogue attribution).
 *
 * @param {Object} layer
 * @returns {string}
 */
export function layerAttribution(layer) {
  return layer?.attribution ?? MOON_TREK_ATTRIBUTION
}

/**
 * Clear the cached layer catalogue.
 *
 * @returns {void}
 */
export function clearLayersCache() {
  cataloguePromise = null
}
