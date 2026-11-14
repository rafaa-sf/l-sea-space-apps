/**
 * Tolerant data access for the UI. The authoritative producers of
 * `public/data/` are the acquisition scripts; these loaders accept the
 * documented shapes plus small variations so a partially generated dataset
 * never breaks the app. When a dataset is missing the UI gets a clearly marked
 * placeholder (synthetic terrain / synthetic ephemeris / fallback POI list) and
 * the status panels show the degradation.
 */

import {
  canonicalizeTerrain,
  createFallbackTerrain,
  createSyntheticEphemeris,
  MOON_RADIUS_M,
  normalizeEphemeris,
  normalizePlanarTerrain,
} from './localCore.js'
import { loadService } from './moduleBridge.js'

const DATA_ROOT = '/data'

export const DATA_SOURCES = {
  horizons: {
    label: 'JPL Horizons',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
  },
  lola: {
    label: 'LOLA / PDS Geosciences',
    url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm',
  },
  moonTrek: {
    label: 'NASA Moon Trek',
    url: 'https://trek.nasa.gov/moon/',
  },
  quickMap: {
    label: 'LROC QuickMap',
    url: 'https://quickmap.lroc.asu.edu/',
  },
}

export const APP_LINKS = {
  aiUsage: '/data/ai-usage.md',
  moonTrek: 'https://trek.nasa.gov/moon/',
  quickMap: 'https://quickmap.lroc.asu.edu/',
  lola: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm',
  horizons: 'https://ssd.jpl.nasa.gov/horizons/',
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFirst(candidates, timeoutMs) {
  for (const url of candidates) {
    const data = await fetchJson(url, timeoutMs)
    if (data) return { url, data }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Fallback catalogues                                                        */
/* -------------------------------------------------------------------------- */

/** Placeholder POIs used when `public/data/pois.json` is missing. */
export function fallbackSites() {
  return [
    { id: 'shackleton-rim', nameKey: 'data.fallbackSites.shackletonRim', lat: -89.66, lon: 129.2, elevationM: 1200, source: 'poi', perimeterM: 200, mastM: 10 },
    { id: 'connecting-ridge', nameKey: 'data.fallbackSites.connectingRidge', lat: -89.45, lon: 222.7, elevationM: 1600, source: 'poi', perimeterM: 250, mastM: 12 },
    { id: 'de-gerlache-rim', nameKey: 'data.fallbackSites.deGerlacheRim', lat: -88.5, lon: 88.1, elevationM: 900, source: 'poi', perimeterM: 200, mastM: 10 },
    { id: 'malapert-massif', nameKey: 'data.fallbackSites.malapertMassif', lat: -86.0, lon: 3.0, elevationM: 5000, source: 'poi', perimeterM: 300, mastM: 15 },
    { id: 'leibnitz-beta', nameKey: 'data.fallbackSites.leibnitzBeta', lat: -85.3, lon: 30.0, elevationM: 3000, source: 'poi', perimeterM: 250, mastM: 12 },
    { id: 'cabeus', nameKey: 'data.fallbackSites.cabeus', lat: -85.3, lon: 317.9, elevationM: -2500, source: 'poi', perimeterM: 200, mastM: 8 },
    { id: 'amundsen', nameKey: 'data.fallbackSites.amundsen', lat: -84.5, lon: 82.8, elevationM: -1200, source: 'poi', perimeterM: 200, mastM: 8 },
    { id: 'nobile', nameKey: 'data.fallbackSites.nobile', lat: -85.2, lon: 53.5, elevationM: 400, source: 'poi', perimeterM: 200, mastM: 10 },
  ]
}

/** Placeholder layer catalogue when `public/data/layers.json` is missing. */
export function fallbackLayers() {
  return [
    {
      id: 'lola-shaded-relief',
      name: 'LOLA shaded relief',
      nameKey: 'layers.catalog.lolaShaded',
      type: 'link',
      attribution: 'NASA / GSFC LOLA, PDS',
      url: APP_LINKS.moonTrek,
      available: false,
    },
    {
      id: 'lro-nac-mosaic',
      name: 'LROC NAC mosaic',
      nameKey: 'layers.catalog.lrocNac',
      type: 'link',
      attribution: 'NASA / ASU LROC',
      url: APP_LINKS.quickMap,
      available: false,
    },
    {
      id: 'south-pole-dem',
      name: 'South pole DEM',
      nameKey: 'layers.catalog.southPoleDem',
      type: 'link',
      attribution: 'NASA / GSFC LOLA, PDS',
      url: APP_LINKS.lola,
      available: false,
    },
    {
      id: 'trek-basemap',
      name: 'Moon Trek basemap',
      nameKey: 'layers.catalog.trekBasemap',
      type: 'link',
      attribution: 'NASA / JPL Moon Trek',
      url: APP_LINKS.moonTrek,
      available: false,
    },
  ]
}

function slugify(value, fallback = 'site') {
  return (
    String(value ?? fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  )
}

/* -------------------------------------------------------------------------- */
/* Sites                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeSite(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const lat = Number(raw.lat ?? raw.latitude)
  const lon = Number(raw.lon ?? raw.longitude ?? raw.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat > 90 || lat < -90) return null
  const id = slugify(raw.id ?? raw.slug ?? raw.name ?? `site-${index + 1}`)
  return {
    id,
    name: raw.name ?? raw.label ?? id,
    nameKey: raw.nameKey ?? raw.i18nKey ?? null,
    lat,
    lon: ((lon % 360) + 360) % 360,
    elevationM: Number.isFinite(Number(raw.elevationM ?? raw.elevation ?? raw.altitude))
      ? Number(raw.elevationM ?? raw.elevation ?? raw.altitude)
      : null,
    source: raw.source ?? 'poi',
    perimeterM: Number.isFinite(Number(raw.perimeterM)) ? Number(raw.perimeterM) : 200,
    mastM: Number.isFinite(Number(raw.mastM)) ? Number(raw.mastM) : 10,
    description: raw.description ?? null,
    region: raw.region ?? null,
  }
}

function normalizeSites(raw) {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : raw.sites ?? raw.pois ?? raw.points ?? raw.items
  if (!Array.isArray(list)) return []
  return list.map(normalizeSite).filter(Boolean)
}

/** Load the POI catalogue. Never throws. */
export async function loadSites() {
  const service = await loadService('sites')
  if (service && typeof service.loadSites === 'function') {
    try {
      const sites = normalizeSites(await service.loadSites())
      if (sites.length) return { sites, source: 'service' }
    } catch (error) {
      console.warn('[lsea] services/sites.loadSites failed, using direct fetch', error)
    }
  }

  const found = await fetchFirst([`${DATA_ROOT}/pois.json`, `${DATA_ROOT}/sites.json`, `${DATA_ROOT}/pois/pois.json`])
  const sites = normalizeSites(found?.data)
  if (sites.length) return { sites, source: 'dataset', url: found.url }
  return { sites: fallbackSites(), source: 'fallback' }
}

/** Create a custom site from a latitude/longitude pair. */
export function createCustomSite({ lat, lon, name = null, elevationM = null } = {}) {
  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  const safeLat = Number.isFinite(parsedLat) ? Math.min(90, Math.max(-90, parsedLat)) : -89.5
  const safeLon = Number.isFinite(parsedLon) ? ((parsedLon % 360) + 360) % 360 : 0
  const latTag = `${Math.abs(safeLat).toFixed(3)}${safeLat < 0 ? 's' : 'n'}`
  const lonTag = `${safeLon.toFixed(3)}e`
  return {
    id: `custom-${latTag}-${lonTag}`,
    name,
    nameKey: null,
    lat: safeLat,
    lon: safeLon,
    elevationM: Number.isFinite(Number(elevationM)) ? Number(elevationM) : null,
    source: 'custom',
    perimeterM: 200,
    mastM: 10,
    description: null,
    region: null,
  }
}

/* -------------------------------------------------------------------------- */
/* Terrain                                                                    */
/* -------------------------------------------------------------------------- */

async function fetchBinary(url, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.arrayBuffer()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve a region-relative URL against `/data/terrain/`. */
function terrainUrl(file) {
  if (!file) return null
  return new URL(file, new URL(`${DATA_ROOT}/terrain/`, window.location.origin)).href.replace(window.location.origin, '')
}

/**
 * Load the LOLA south-pole DEM.
 *
 * Terrain is kept in the polar-stereographic form produced by the acquisition
 * scripts (`index.json` + int16 `.bin`), so it can be handed directly to the
 * coder's `src/core` modules; a lat/lon resample is derived for the renderers.
 *
 * Preferred order:
 *  1. `src/services/lola.js` (coder's loader) when present.
 *  2. `public/data/terrain/index.json` + a region `.bin`. The wide-area region
 *     is preferred because the POI list spans the whole south-pole cap; the
 *     default high-resolution region is used when no wide region exists.
 *  3. Synthetic terrain, only as an explicit error path (reported in the UI).
 */
let lastTerrainRegions = []

/** Regions discovered in public/data/terrain/index.json by the last load. */
export function getTerrainIndexRegions() {
  return lastTerrainRegions
}

/** Fallback catalogue; the live list comes from the terrain index. */
export const DEM_REGIONS = Object.freeze([
  { id: 'south-pole-875s-20m', labelKey: 'dem.highDetail', extentKm: 152, pixelSizeM: 74 },
  { id: 'south-pole-80s-80m', labelKey: 'dem.wide', extentKm: 608, pixelSizeM: 594 },
])

export async function loadTerrain(options = {}) {
  // Pick the analysis region from the terrain index: an explicit region id wins,
  // otherwise the wide area (the POI list spans the whole south-pole cap).
  const index = await fetchJson(`${DATA_ROOT}/terrain/index.json`, 20000)
  const regions = Array.isArray(index?.regions) ? index.regions : []
  lastTerrainRegions = regions
  const explicitRegion = Boolean(options.regionId)
  const preferred =
    (options.regionId ? regions.find((entry) => entry.id === options.regionId) : null) ??
    regions.find((entry) => entry.role === 'wide-area') ??
    regions.find((entry) => entry.id === index?.defaultRegionId) ??
    regions[0] ??
    null

  // 1. The coder's service loader is preferred when it returns a real grid.
  const service = await loadService('lola')
  if (service && typeof service.loadTerrain === 'function') {
    try {
      const raw = await service.loadTerrain({
        id: preferred?.id,
        role: preferred?.role,
        fallback: false,
      })
      const planar = raw ? normalizePlanarTerrain(raw) : null
      const coversWideArea =
        planar && 2 * Math.max(Math.abs(planar.minX), Math.abs(planar.maxX), Math.abs(planar.minY), Math.abs(planar.maxY)) >= 250000
      if (planar && raw.synthetic !== true && (explicitRegion || coversWideArea)) {
        return {
          terrain: planar,
          viewTerrain: canonicalizeTerrain(planar, { maxSize: 256 }),
          source: 'lola',
          origin: 'service',
          regionId: planar.regionId,
          regionName: planar.name,
          attribution: planar.attribution ?? 'NASA/GSFC/LOLA (PDS Geosciences Node)',
        }
      }
      if (raw) {
        console.warn('[lsea] services/lola returned an unusable terrain payload; reading the .bin directly')
      }
    } catch (error) {
      console.warn('[lsea] services/lola.loadTerrain failed, reading the .bin directly', error)
    }
  }

  // 2. Direct read of the region listed in the index.
  if (preferred) {
    const binUrl = terrainUrl(preferred.bin ?? preferred.file)
    const buffer = binUrl ? await fetchBinary(binUrl, 60000) : null
    if (buffer) {
      const dtype = String(preferred.dtype ?? preferred.grid?.dtype ?? 'int16').toLowerCase()
      const data = dtype === 'float32' ? new Float32Array(buffer) : new Int16Array(buffer)
      const planar = normalizePlanarTerrain({
        ...preferred,
        ...(preferred.grid ?? {}),
        data,
        dtype,
        referenceRadiusM: index.referenceRadiusM ?? 1737400,
        id: preferred.id,
        name: preferred.name ?? preferred.id,
        attribution: preferred.attribution ?? 'NASA/GSFC/LOLA (PDS Geosciences Node)',
        elevationRangeM: preferred.elevationRangeM,
      })
      if (planar) {
        return {
          terrain: planar,
          viewTerrain: canonicalizeTerrain(planar, { maxSize: 256 }),
          source: 'lola',
          origin: 'dataset',
          url: binUrl,
          regionId: preferred.id,
          regionName: preferred.name ?? preferred.id,
          attribution: preferred.attribution ?? 'NASA/GSFC/LOLA (PDS Geosciences Node)',
        }
      }
    }
  }

  const fallback = createFallbackTerrain(180, 180)
  return {
    terrain: fallback,
    viewTerrain: fallback,
    source: 'synthetic',
    origin: 'fallback',
    attribution: null,
  }
}

/* -------------------------------------------------------------------------- */
/* Ephemeris                                                                  */
/* -------------------------------------------------------------------------- */

/** Load the pre-computed Horizons ephemeris for a site. Never throws. */
export async function loadEphemeris(site) {
  if (!site) return { dataset: null, source: 'none' }
  const service = await loadService('horizons')
  if (service && typeof service.loadEphemeris === 'function') {
    try {
      const raw = await service.loadEphemeris(site.id)
      const dataset = normalizeEphemeris(raw, site.id)
      if (dataset) return { dataset, source: 'service', origin: 'dataset' }
    } catch (error) {
      console.warn('[lsea] services/horizons.loadEphemeris failed, using direct fetch', error)
    }
  }

  const slug = slugify(site.id)
  const found = await fetchFirst([
    `${DATA_ROOT}/ephemeris/${slug}.json`,
    `${DATA_ROOT}/ephemeris/${encodeURIComponent(site.id)}.json`,
    `${DATA_ROOT}/ephemeris/index.json`,
  ])
  let raw = found?.data
  if (raw && raw.sites && typeof raw.sites === 'object' && !Array.isArray(raw.sites)) {
    raw = raw.sites[slug] ?? raw.sites[site.id] ?? null
  }
  const dataset = normalizeEphemeris(raw, site.id)
  if (dataset) return { dataset, source: 'dataset', origin: 'dataset', url: found.url }
  return { dataset: createSyntheticEphemeris(site), source: 'synthetic', origin: 'synthetic' }
}

/* -------------------------------------------------------------------------- */
/* Moon Trek layers                                                           */
/* -------------------------------------------------------------------------- */

function normalizeLayer(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id ?? raw.key ?? slugify(raw.name, `layer-${index + 1}`)
  const type = String(raw.type ?? raw.serviceType ?? (raw.wms ? 'wms' : raw.url ? 'link' : 'link')).toLowerCase()
  const url = raw.url ?? raw.href ?? raw.wmsUrl ?? raw.tileUrl ?? null
  return {
    id,
    name: raw.name ?? raw.title ?? id,
    nameKey: raw.nameKey ?? null,
    type: ['wms', 'xyz', 'wmts', 'link', 'image'].includes(type) ? type : 'link',
    url,
    wmsLayer: raw.wmsLayer ?? raw.layer ?? raw.layers ?? null,
    attribution: raw.attribution ?? raw.provider ?? 'NASA',
    attributionUrl: raw.attributionUrl ?? raw.viewerUrl ?? raw.homepage ?? null,
    description: raw.description ?? null,
    kind: raw.kind ?? null,
    bounds: raw.bounds ?? null,
    // Layer georeferencing: the renderer needs the real coverage and the WMTS
    // zoom range to pick a per-layer zoom (otherwise limited-coverage layers
    // are fetched at the whole-region zoom and look mis-scaled).
    boundsM: raw.boundsM ?? null,
    maxZoom: Number.isFinite(Number(raw.maxZoom)) ? Number(raw.maxZoom) : null,
    minZoom: Number.isFinite(Number(raw.minZoom)) ? Number(raw.minZoom) : null,
    template: raw.template ?? raw.url ?? null,
    tileMatrixSet: raw.tileMatrixSet ?? null,
    opacity: Number.isFinite(Number(raw.opacity)) ? Number(raw.opacity) : 0.65,
    available: raw.available ?? Boolean(url),
  }
}

/** Load the layer catalogue. Never throws. */
export async function loadLayers() {
  const found = await fetchFirst([`${DATA_ROOT}/layers.json`, `${DATA_ROOT}/layers/layers.json`])
  const raw = found?.data
  const list = Array.isArray(raw) ? raw : raw?.layers ?? raw?.items ?? null
  if (Array.isArray(list)) {
    const layers = list.map(normalizeLayer).filter(Boolean)
    if (layers.length) return { layers, source: 'dataset', url: found.url }
  }
  return { layers: fallbackLayers(), source: 'fallback' }
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/** URLs cited in the exported brief. */
export function briefLinks(site) {
  const links = {
    quickMap: APP_LINKS.quickMap,
    moonTrek: APP_LINKS.moonTrek,
    lola: APP_LINKS.lola,
    horizons: APP_LINKS.horizons,
  }
  if (site) {
    const lat = Number(site.lat).toFixed(4)
    const lon = ((Number(site.lon) % 360) + 360) % 360
    links.quickMap = `https://quickmap.lroc.asu.edu/layers?extent=-${Math.abs(Number(lat)) - 1},-1,${Number(lat) + 1},1&proj=10&secondaryProj=0`
    links.moonTrek = `https://trek.nasa.gov/moon/#/v1/115/0.5/0/${lon.toFixed(3)}/${lat}/-170.000/0.000/90.000/0/0/0`
    links.horizons = `https://ssd.jpl.nasa.gov/horizons/app.html#/`
    links.siteCoordinates = { lat: Number(site.lat), lon: Number(site.lon) }
  }
  return links
}

/** Build the mission brief object (used when services/export.js is missing). */
export function buildLocalBrief({ sites = [], selectedSite = null, mission = {}, analysis = {}, scores = [], landingZones = [], landingZonesMeta = null, locale = 'en' } = {}) {
  return {
    schema: 'lsea.mission-brief/1',
    generatedAt: new Date().toISOString(),
    application: {
      name: 'L-SEA Space Apps',
      event: 'NASA International Space Apps Challenge Málaga 2026',
      url: typeof window !== 'undefined' ? window.location.href : null,
      locale,
    },
    referenceRadiusM: MOON_RADIUS_M,
    selectedSite,
    sites,
    mission,
    analysis,
    rankedSites: scores,
    rankedLandingZones: Array.isArray(landingZones) ? landingZones : [],
    landingZonesMeta,
    links: briefLinks(selectedSite),
    dataSources: [
      { name: 'JPL Horizons', role: 'Topocentric Sun and Earth azimuth/elevation', url: DATA_SOURCES.horizons.url },
      { name: 'LOLA / PDS Geosciences', role: 'Lunar south-pole digitial elevation model', url: DATA_SOURCES.lola.url },
      { name: 'NASA Moon Trek', role: 'Basemaps and layer catalogue', url: DATA_SOURCES.moonTrek.url },
      { name: 'LROC QuickMap', role: 'Visual cross-check and site links', url: DATA_SOURCES.quickMap.url },
    ],
  }
}

/** Trigger a browser download of a JSON object. */
export function downloadJson(data, filename) {
  if (typeof document === 'undefined') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Build and download the brief, preferring the coder's export service. */
export async function exportBrief({ sites, selectedSite, mission, analysis, scores, landingZones = [], landingZonesMeta = null, locale }) {
  const service = await loadService('export')
  if (service) {
    try {
      if (typeof service.buildBrief === 'function') {
        const brief = await service.buildBrief({ sites, mission, computation: { analysis, selectedSite, scores, landingZones, landingZonesMeta } })
        if (brief) {
          if (typeof service.downloadBrief === 'function') service.downloadBrief(brief)
          else if (typeof service.downloadJson === 'function') service.downloadJson(brief)
          else downloadJson(brief, `lsea-brief-${Date.now()}.json`)
          return { brief, source: 'service' }
        }
      }
      if (typeof service.downloadBrief === 'function') {
        const brief = buildLocalBrief({ sites, selectedSite, mission, analysis, scores, landingZones, landingZonesMeta, locale })
        service.downloadBrief(brief)
        return { brief, source: 'service' }
      }
    } catch (error) {
      console.warn('[lsea] services/export failed, using local brief builder', error)
    }
  }
  const brief = buildLocalBrief({ sites, selectedSite, mission, analysis, scores, landingZones, landingZonesMeta, locale })
  downloadJson(brief, `lsea-brief-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)
  return { brief, source: 'local' }
}
