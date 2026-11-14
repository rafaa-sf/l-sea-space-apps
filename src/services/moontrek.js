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

/** Base URL of LROC QuickMap. */
export const QUICK_MAP_URL = 'https://quickmap.lroc.asu.edu/'

/** Attribution required by the Moon Trek/LOLA/LROC data. */
export const MOON_TREK_ATTRIBUTION =
  'NASA/GSFC/ASU — Moon Trek (trek.nasa.gov) and LRO/LOLA/LROC teams'

/** In-memory cache of the parsed layer catalogue. */
let cataloguePromise = null

/**
 * Load and cache `public/data/layers.json`. Never throws.
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
  cataloguePromise = (async () => {
    const empty = { layers: [], projection: null, attribution: MOON_TREK_ATTRIBUTION, source: null, generated: null }
    if (typeof fetchImpl !== 'function') return empty
    try {
      const response = await fetchImpl(url, { cache: 'no-cache' })
      if (!response || !response.ok) {
        console.warn(`[moontrek] could not load ${url}: HTTP ${response?.status ?? 'error'}`)
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
      return empty
    }
  })()
  return cataloguePromise
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
export function buildMoonTrekViewerUrl(options = {}) {
  return options.layer?.viewerUrl ?? MOON_TREK_URL
}

/**
 * Build an LROC QuickMap link for a site.
 *
 * QuickMap accepts an `extent` query parameter (`west,south,east,north`, degrees)
 * plus a projection code; `proj=10` is the south polar stereographic view. The
 * window is widened in longitude as the site approaches the pole, where a fixed
 * longitude span covers almost no ground.
 *
 * @param {{lat: number, lon: number, zoom?: number, spanDeg?: number}} site
 * @returns {string}
 */
export function buildQuickMapUrl(site) {
  const lat = Number(site?.lat)
  const lon = Number(site?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return QUICK_MAP_URL
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const latSpan = Math.min(2, Math.max(0.2, 2 / 64))
  const lonSpan = Math.min(180, Math.max(1, latSpan / Math.max(cosLat, 0.01)))
  const west = (((lon - lonSpan) % 360) + 360) % 360
  const east = (((lon + lonSpan) % 360) + 360) % 360
  const south = Math.max(-90, lat - latSpan)
  const north = Math.min(90, lat + latSpan)
  const params = new URLSearchParams({
    extent: `${west.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${north.toFixed(3)}`,
    proj: '10',
  })
  return `${QUICK_MAP_URL}?${params.toString()}`
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
