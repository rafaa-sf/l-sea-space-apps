/**
 * LOLA service: loads the real lunar south-pole DEM regions from
 * `public/data/terrain/`.
 *
 * The shipped products are two polar-stereographic LOLA rasters (int16
 * little-endian `.bin` files plus JSON metadata, listed in `terrain/index.json`):
 *
 * - `south-pole-875s-20m` — 2048 × 2048, 74.06 m/px, the inner 87.5°S–90°S area,
 * - `south-pole-80s-80m` — 1024 × 1024, 593.75 m/px, the wide 80°S–90°S area.
 *
 * This service fetches the index, picks the best region for a site or a
 * bounding box (highest resolution that contains it), fetches the binary payload
 * and builds the normalized terrain object consumed by `src/core/`.
 *
 * A synthetic grid is returned **only** as an explicit error path when the real
 * files cannot be loaded, and it is flagged with `synthetic: true` so the UI and
 * the JSON brief label it as approximate.
 *
 * @module services/lola
 */

import { createProjectedTerrain, createSyntheticTerrain, sampleElevation } from '../core/terrain.js'
import { lonLatToXY, xyToLonLat } from '../core/terrain.js'
import { dataUrl } from './dataUrl.js'

/** Path of the terrain index inside `public/data/`. */
export const TERRAIN_INDEX_PATH = 'terrain/index.json'

/** Attribution required by the LOLA data products. */
export const LOLA_ATTRIBUTION = 'NASA/GSFC/LOLA (PDS Geosciences Node)'

/** Cache for the terrain index payload. */
let indexPromise = null

/** Cache of loaded terrain regions keyed by region id. */
const regionCache = new Map()

/**
 * Load and cache `terrain/index.json`.
 *
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{referenceRadiusM: number, defaultRegionId: string|null, regions: Array<Object>, attribution: string}|null>}
 */
export async function loadTerrainIndex(options = {}) {
  if (indexPromise) return indexPromise
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const url = dataUrl(TERRAIN_INDEX_PATH, options.dataRoot)

  indexPromise = (async () => {
    try {
      const response = await fetchImpl(url, { cache: 'no-cache' })
      if (!response || !response.ok) {
        console.warn(`[lola] could not load ${url}: HTTP ${response?.status ?? 'error'}`)
        return null
      }
      const payload = await response.json()
      const regions = Array.isArray(payload?.regions) ? payload.regions : []
      if (regions.length === 0) {
        console.warn(`[lola] ${url} lists no terrain regions`)
        return null
      }
      return {
        referenceRadiusM: Number(payload.referenceRadiusM ?? 1737400),
        defaultRegionId: payload.defaultRegionId ?? regions[0].id,
        attribution: payload.attribution ?? LOLA_ATTRIBUTION,
        regions,
      }
    } catch (error) {
      console.warn(`[lola] could not load ${url}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  })()
  return indexPromise
}

/**
 * Build the metadata object accepted by `core/terrain#createProjectedTerrain`
 * from an index entry plus the optional per-region metadata JSON.
 *
 * @param {Object} entry Index region entry.
 * @param {Object|null} metadata Per-region metadata JSON.
 * @param {number} referenceRadiusM Index-level reference radius.
 * @param {string} attribution Index-level attribution.
 * @returns {Object}
 */
function buildRegionMetadata(entry, metadata, referenceRadiusM, attribution) {
  const bounds = entry.boundsM ?? metadata?.grid ?? {}
  return {
    ...(metadata ?? {}),
    id: entry.id ?? metadata?.id ?? null,
    name: entry.name ?? metadata?.name ?? entry.id ?? null,
    role: entry.role ?? metadata?.role ?? null,
    referenceRadiusM: Number(
      metadata?.referenceRadiusM ?? entry.referenceRadiusM ?? referenceRadiusM ?? 1737400,
    ),
    width: Number(metadata?.grid?.width ?? entry.width ?? metadata?.width),
    height: Number(metadata?.grid?.height ?? entry.height ?? metadata?.height),
    pixelSizeM: Number(metadata?.grid?.pixelSizeM ?? entry.pixelSizeM ?? metadata?.pixelSizeM),
    minX: Number(metadata?.grid?.minX ?? bounds.minX),
    maxX: Number(metadata?.grid?.maxX ?? bounds.maxX),
    minY: Number(metadata?.grid?.minY ?? bounds.minY),
    maxY: Number(metadata?.grid?.maxY ?? bounds.maxY),
    dtype: String(metadata?.grid?.dtype ?? entry.dtype ?? 'int16').toLowerCase(),
    elevationRangeM: entry.elevationRangeM ?? metadata?.elevationRangeM ?? null,
    source: metadata?.source ?? entry.source ?? null,
    attribution: metadata?.attribution ?? attribution ?? LOLA_ATTRIBUTION,
    meta: metadata ?? null,
  }
}

/**
 * Fetch one region (metadata + binary payload) and build its terrain grid.
 *
 * @param {Object} entry Region entry from `terrain/index.json`.
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch, referenceRadiusM?: number, attribution?: string, timeoutMs?: number}} [options]
 * @returns {Promise<import('../core/terrain.js').Terrain|null>}
 */
async function fetchRegion(entry, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null
  const base = options.dataRoot

  // Region file names are relative to `public/data/terrain/`; absolute paths in
  // the index are honoured as-is.
  const regionFile = (name, fallback) => {
    const file = String(name ?? fallback ?? '')
    return file.includes('/') ? file : `terrain/${file}`
  }
  const metaUrl = dataUrl(regionFile(entry.meta, `${entry.id}.json`), base)
  const binUrl = dataUrl(regionFile(entry.bin, `${entry.id}.bin`), base)

  let metadata = null
  try {
    const metaResponse = await fetchImpl(metaUrl, { cache: 'no-cache' })
    if (metaResponse?.ok) metadata = await metaResponse.json()
  } catch {
    /* metadata is optional; the index entry carries the essential fields */
  }

  let buffer = null
  try {
    const binResponse = await fetchImpl(binUrl, { cache: 'force-cache' })
    if (!binResponse?.ok) {
      console.warn(`[lola] could not load ${binUrl}: HTTP ${binResponse?.status ?? 'error'}`)
      return null
    }
    buffer = await binResponse.arrayBuffer()
  } catch (error) {
    console.warn(`[lola] could not load ${binUrl}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  try {
    const regionMetadata = buildRegionMetadata(
      entry,
      metadata,
      options.referenceRadiusM ?? 1737400,
      options.attribution ?? LOLA_ATTRIBUTION,
    )
    return createProjectedTerrain(regionMetadata, buffer)
  } catch (error) {
    console.warn(`[lola] terrain region ${entry.id} could not be decoded: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Load one terrain region by id (cached).
 *
 * @param {string} regionId Region id from `terrain/index.json`.
 * @param {Object} [options] See {@link fetchRegion}.
 * @returns {Promise<import('../core/terrain.js').Terrain|null>}
 */
export function loadRegion(regionId, options = {}) {
  const key = String(regionId ?? '')
  if (!key) return Promise.resolve(null)
  if (!options.force && regionCache.has(key)) return regionCache.get(key)

  const promise = (async () => {
    const index = await loadTerrainIndex(options)
    const entry = index?.regions.find((region) => region.id === key)
    if (!entry) return null
    return fetchRegion(entry, {
      ...options,
      referenceRadiusM: index.referenceRadiusM,
      attribution: index.attribution,
    })
  })()
  regionCache.set(key, promise)
  return promise
}

/**
 * Load every terrain region listed in the index.
 *
 * Used by the background worker to pick the best DEM per site (high resolution
 * for the inner pole, wide area for the outer POIs).
 *
 * @param {Object} [options]
 * @returns {Promise<Array<import('../core/terrain.js').Terrain>>}
 */
export async function loadTerrainRegions(options = {}) {
  const index = await loadTerrainIndex(options)
  if (!index) return []
  const regions = await Promise.all(index.regions.map((entry) => loadRegion(entry.id, options)))
  return regions.filter(Boolean)
}

/**
 * Sample points describing a latitude/longitude bounding box in projected space.
 *
 * @param {{lat0: number, lat1: number, lon0: number, lon1: number}} bounds
 * @param {number} referenceRadiusM
 * @returns {Array<{x: number, y: number}>}
 */
function boundsSamplePoints(bounds, referenceRadiusM) {
  const lat0 = Math.min(bounds.lat0 ?? -90, bounds.lat1 ?? -90)
  const lat1 = Math.max(bounds.lat0 ?? -90, bounds.lat1 ?? -90)
  const lon0 = bounds.lon0 ?? 0
  const lon1 = bounds.lon1 ?? 360
  const points = []
  for (const lat of [lat0, (lat0 + lat1) / 2, lat1]) {
    for (const lon of [lon0, (lon0 + lon1) / 2, lon1]) {
      points.push(lonLatToXY(lat, lon, referenceRadiusM))
    }
  }
  if (lat0 <= -90 + 1e-9) points.push({ x: 0, y: 0 })
  return points
}

/**
 * Check whether a terrain region covers a latitude/longitude bounding box.
 *
 * @param {Object} region Region entry/metadata with `boundsM` or flat min/max.
 * @param {Array<{x: number, y: number}>} points Projected sample points.
 * @returns {boolean}
 */
function regionContainsPoints(region, points) {
  const bounds = region.boundsM ?? region
  const minX = Number(bounds.minX ?? region.minX)
  const maxX = Number(bounds.maxX ?? region.maxX)
  const minY = Number(bounds.minY ?? region.minY)
  const maxY = Number(bounds.maxY ?? region.maxY)
  const pixel = Number(region.pixelSizeM ?? 1)
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return false
  const tolerance = pixel
  return points.every(
    (point) =>
      point.x >= minX - tolerance &&
      point.x <= maxX + tolerance &&
      point.y >= minY - tolerance &&
      point.y <= maxY + tolerance,
  )
}

/**
 * Choose the best region for a latitude/longitude bounding box.
 *
 * Prefers the highest-resolution region that contains the whole box; falls back
 * to the widest one.
 *
 * @param {Array<Object>} regions Region entries (with flat bounds or `boundsM`).
 * @param {{lat0: number, lat1: number, lon0: number, lon1: number}} bounds
 * @param {number} [referenceRadiusM=1737400]
 * @returns {Object|null}
 */
export function selectRegionForBounds(regions, bounds, referenceRadiusM = 1737400) {
  if (!Array.isArray(regions) || regions.length === 0) return null
  const points = boundsSamplePoints(bounds, referenceRadiusM)
  const containing = regions.filter((region) => regionContainsPoints(region, points))
  const pool = containing.length > 0 ? containing : regions
  return [...pool].sort((a, b) => Number(a.pixelSizeM) - Number(b.pixelSizeM))[0] ?? null
}

/**
 * Choose the best region for a point site (highest resolution containing it).
 *
 * @param {Array<Object>} regions Region entries (with flat bounds or `boundsM`).
 * @param {{lat: number, lon: number}} site
 * @param {number} [referenceRadiusM=1737400]
 * @returns {Object|null}
 */
export function selectRegionForSite(regions, site, referenceRadiusM = 1737400) {
  if (!Array.isArray(regions) || regions.length === 0 || !site) return null
  const point = lonLatToXY(site.lat, site.lon, referenceRadiusM)
  const containing = regions.filter((region) => regionContainsPoints(region, [point]))
  const pool = containing.length > 0 ? containing : []
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => Number(a.pixelSizeM) - Number(b.pixelSizeM))[0]
}

/**
 * Load the best terrain region for a site, or `null` when no region covers it.
 *
 * @param {{lat: number, lon: number}} site
 * @param {Object} [options]
 * @returns {Promise<import('../core/terrain.js').Terrain|null>}
 */
export async function loadTerrainForSite(site, options = {}) {
  if (!site || !Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.lon))) return null
  const index = await loadTerrainIndex(options)
  if (!index) return options.fallback === true ? createSyntheticTerrain() : null
  const entry = selectRegionForSite(index.regions, site, index.referenceRadiusM)
  if (!entry) return null
  return loadRegion(entry.id, options)
}

/**
 * Load a terrain grid.
 *
 * Signature per `docs/architecture.md`: the first argument may be a region id,
 * `'default'`/`'auto'`, or an options object carrying a latitude/longitude
 * bounding box (`{ lat0, lat1, lon0, lon1 }`), as used by the UI loader.
 *
 * @param {string|{id?: string, regionId?: string, lat0?: number, lat1?: number, lon0?: number, lon1?: number, dataRoot?: string, fetchImpl?: typeof fetch, fallback?: boolean}} [region='default']
 * @param {{dataRoot?: string, fetchImpl?: typeof fetch, fallback?: boolean, force?: boolean}} [options]
 * @returns {Promise<import('../core/terrain.js').Terrain|null>} Terrain grid, or
 *   a synthetic grid when `fallback !== false` and nothing real could be loaded.
 */
export async function loadTerrain(region = 'default', options = {}) {
  let request = region
  let resolvedOptions = options
  if (region && typeof region === 'object') {
    request = region.id ?? region.regionId ?? 'default'
    resolvedOptions = { ...region, ...options }
  }

  const index = await loadTerrainIndex(resolvedOptions)
  if (!index) {
    if (resolvedOptions.fallback === false) return null
    console.warn('[lola] terrain index unavailable; using synthetic fallback DEM')
    return createSyntheticTerrain()
  }

  let entry = null
  if (typeof request === 'string' && request !== 'default' && request !== 'auto') {
    entry = index.regions.find((candidate) => candidate.id === request) ?? null
  }
  if (!entry && Number.isFinite(resolvedOptions.lat0)) {
    entry = selectRegionForBounds(
      index.regions,
      {
        lat0: resolvedOptions.lat0,
        lat1: resolvedOptions.lat1,
        lon0: resolvedOptions.lon0,
        lon1: resolvedOptions.lon1,
      },
      index.referenceRadiusM,
    )
  }
  if (!entry) {
    entry =
      index.regions.find((candidate) => candidate.id === index.defaultRegionId) ??
      [...index.regions].sort((a, b) => Number(a.pixelSizeM) - Number(b.pixelSizeM))[0] ??
      null
  }
  if (!entry) return resolvedOptions.fallback === false ? null : createSyntheticTerrain()

  const terrain = await loadRegion(entry.id, resolvedOptions)
  if (terrain) return terrain
  if (resolvedOptions.fallback === false) return null
  console.warn(`[lola] terrain region '${entry.id}' unavailable; using synthetic fallback DEM`)
  return createSyntheticTerrain()
}

/**
 * DEM lookup helper: elevation in meters at a latitude/longitude.
 *
 * @param {import('../core/terrain.js').Terrain|null} terrain
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number} Elevation in meters or `NaN` outside the grid.
 */
export function lookupElevation(terrain, latDeg, lonDeg) {
  return sampleElevation(terrain, latDeg, lonDeg)
}

/**
 * Metadata summary of a terrain grid for the UI status panel and JSON brief.
 *
 * @param {import('../core/terrain.js').Terrain|null} terrain
 * @returns {Object|null}
 */
export function terrainMetadata(terrain) {
  if (!terrain) return null
  let geographic = null
  try {
    geographic = {
      minLat: xyToLonLat(terrain.minX, terrain.minY, terrain.referenceRadiusM).latDeg,
      maxLat: xyToLonLat(terrain.maxX, terrain.maxY, terrain.referenceRadiusM).latDeg,
    }
  } catch {
    /* ignore */
  }
  return {
    id: terrain.id,
    role: terrain.role,
    width: terrain.width,
    height: terrain.height,
    pixelSizeM: terrain.pixelSizeM,
    boundsM: {
      minX: terrain.minX,
      maxX: terrain.maxX,
      minY: terrain.minY,
      maxY: terrain.maxY,
    },
    referenceRadiusM: terrain.referenceRadiusM,
    elevationRangeM: terrain.elevationRangeM,
    synthetic: terrain.synthetic === true,
    source: terrain.source,
    attribution: terrain.attribution,
    geographic,
  }
}

/**
 * Drop the terrain caches (index and regions).
 *
 * @returns {void}
 */
export function clearTerrainCache() {
  regionCache.clear()
  indexPromise = null
}
