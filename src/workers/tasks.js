/**
 * Task implementations shared by the background worker and its inline fallback.
 *
 * Keeping the heavy logic in this plain module (no `self`, no DOM) means the
 * exact same code runs in the worker thread and, when `Worker` is unavailable,
 * on the main thread — the UI gets identical results either way.
 *
 * The worker is loaded by the UI as `src/workers/compute.worker.js`; the
 * documented message protocol is:
 *
 * ```js
 * // request  { id, type: 'autopilot', payload: { sites, mission, region } }
 * // response { id, type: 'result', payload: { scores } }
 * // error    { id, type: 'error', payload: { message } }
 * ```
 *
 * @module workers/tasks
 */

import {
  normalizeTerrain,
  findCraters,
  areaStatistics,
  MAX_AREA_RADIUS_M,
} from '../core/terrain.js'
import {
  horizonProfile,
  evaluateBodyVisibility,
  DEFAULT_MAX_DISTANCE_M,
  MIN_HORIZON_STEP_DEG,
  MAX_HORIZON_STEP_DEG,
  MIN_HORIZON_STEP_METERS,
  MAX_HORIZON_STEP_METERS,
} from '../core/engine.js'
import {
  normalizeEphemerisDataset,
  visibilityWindows,
  nextSetEvent,
  sampleAt,
  toTimestamp,
} from '../core/ephemeris.js'
import { solarPowerEstimate } from '../core/power.js'
import { commWindows, dataBudget } from '../core/comms.js'
import { normalizeMission, rankSites, scoreSite } from '../core/autopilot.js'
import { rankLandingZones } from '../core/zoneAutopilot.js'
import { computeMissionCycles } from '../core/cycles.js'
import { loadSites } from '../services/sites.js'
import { loadEphemeris, loadEphemerisMap } from '../services/horizons.js'
import { loadTerrain, loadTerrainForSite, loadTerrainRegions } from '../services/lola.js'

/** Smallest horizon distance accepted from a worker payload, in meters. */
const MIN_TASK_DISTANCE_M = 1000

/** Area-statistics defaults and floor, mirroring the core function. */
const DEFAULT_AREA_RADIUS_M = 200
const MIN_AREA_RADIUS_M = 1

/**
 * Clamp the worker options that drive core sampling loops (audit SEC-04).
 *
 * The core functions clamp too; validating at the worker boundary keeps a
 * malformed or hostile message from reaching the heavy loops at all. Values
 * that are missing or non-finite fall back to the documented defaults.
 *
 * @param {unknown} options Raw `payload.options`.
 * @returns {Record<string, unknown>} A new, clamped options object.
 */
export function sanitizeTaskOptions(options) {
  const input = options && typeof options === 'object' ? options : {}
  const out = { ...input }

  if ('stepDeg' in out) {
    const value = Number(out.stepDeg)
    out.stepDeg =
      Number.isFinite(value) && value > 0
        ? Math.min(MAX_HORIZON_STEP_DEG, Math.max(MIN_HORIZON_STEP_DEG, value))
        : 1
  }

  if ('maxDistanceM' in out) {
    const value = Number(out.maxDistanceM)
    out.maxDistanceM =
      Number.isFinite(value) && value > 0
        ? Math.min(DEFAULT_MAX_DISTANCE_M, Math.max(MIN_TASK_DISTANCE_M, value))
        : DEFAULT_MAX_DISTANCE_M
  }

  if ('radiusM' in out) {
    const value = Number(out.radiusM)
    out.radiusM =
      Number.isFinite(value) && value > 0
        ? Math.min(MAX_AREA_RADIUS_M, Math.max(MIN_AREA_RADIUS_M, value))
        : DEFAULT_AREA_RADIUS_M
  }

  if ('stepMeters' in out) {
    const value = Number(out.stepMeters)
    if (Number.isFinite(value) && value > 0) {
      out.stepMeters = Math.min(
        MAX_HORIZON_STEP_METERS,
        Math.max(MIN_HORIZON_STEP_METERS, value),
      )
    } else {
      delete out.stepMeters
    }
  }

  return out
}

/** Supported task types. */
export const TASK_TYPES = Object.freeze([
  'ping',
  'autopilot',
  'landingZones',
  'missionCycles',
  'scoreSite',
  'horizonProfile',
  'craters',
  'terrainStats',
  'power',
  'comms',
  'visibilityWindows',
  'nextSetEvent',
  'sampleAt',
])

/**
 * Ensure a terrain payload is in a shape the core understands.
 *
 * @param {*} terrain
 * @returns {Object|null}
 */
function ensureTerrain(terrain) {
  if (!terrain || typeof terrain !== 'object') return null
  if (typeof terrain.pixelSizeM === 'number' && terrain.data) return terrain
  if (terrain.lat0 !== undefined && terrain.data) return terrain
  try {
    return normalizeTerrain(terrain)
  } catch (error) {
    console.warn(`[worker] could not normalize terrain: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Ensure an ephemeris payload is normalized.
 *
 * @param {*} ephemeris
 * @returns {Object|null}
 */
function ensureEphemeris(ephemeris) {
  if (!ephemeris) return null
  try {
    return normalizeEphemerisDataset(ephemeris)
  } catch (error) {
    console.warn(`[worker] could not normalize ephemeris: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Load or accept the terrain used by an autopilot run.
 *
 * Preference order: explicit `terrains`/`terrain` payload, all real LOLA regions
 * (so each site picks its best DEM), the region requested by the UI, and finally
 * the tolerant loader fallback.
 *
 * @param {Object} payload Task payload.
 * @returns {Promise<Array<Object>>}
 */
async function resolveTerrains(payload) {
  // An explicit terrain array is authoritative (e.g. a caller that already
  // loaded both LOLA regions). Otherwise prefer the real region files over a
  // single payload terrain, so each site is scored on its best DEM (high
  // resolution inside 87.5°S, wide area outside).
  if (Array.isArray(payload.terrains) && payload.terrains.length > 0) {
    return payload.terrains.map(ensureTerrain).filter(Boolean)
  }
  try {
    const regions = await loadTerrainRegions()
    if (regions.length > 0) return regions
  } catch (error) {
    console.warn(`[worker] could not load terrain regions: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (payload.terrain) {
    const terrain = ensureTerrain(payload.terrain)
    if (terrain) return [terrain]
  }
  try {
    const terrain = await loadTerrain(payload.region ?? 'default')
    if (terrain) return [terrain]
  } catch (error) {
    console.warn(`[worker] could not load a terrain grid: ${error instanceof Error ? error.message : String(error)}`)
  }
  return []
}

/**
 * Resolve ephemeris datasets for a list of sites.
 *
 * @param {Object} payload Task payload.
 * @param {Array<Object>} sites
 * @returns {Promise<Map|Object|null>}
 */
async function resolveEphemerides(payload, sites) {
  const ids = sites.map((site) => site?.id).filter(Boolean)
  const provided = payload.ephemeris

  // Explicit multi-site maps and arrays of datasets are authoritative.
  if (provided instanceof Map) return provided
  if (
    Array.isArray(provided) &&
    provided.length > 0 &&
    provided[0] &&
    typeof provided[0] === 'object' &&
    Array.isArray(provided[0].samples)
  ) {
    const map = new Map()
    for (const dataset of provided) {
      const normalized = ensureEphemeris(dataset)
      if (normalized?.siteId) map.set(normalized.siteId, normalized)
    }
    if (map.size > 0) return map
  }
  if (provided && typeof provided === 'object' && !Array.isArray(provided)) {
    const looksLikeSingleDataset =
      Array.isArray(provided.samples) ||
      (provided.siteId !== undefined && !Array.isArray(provided[provided.siteId]) && typeof provided[provided.siteId] !== 'object')
    if (!looksLikeSingleDataset) {
      const map = new Map()
      for (const [siteId, dataset] of Object.entries(provided)) {
        const normalized = ensureEphemeris(dataset)
        if (normalized) map.set(siteId, normalized)
      }
      if (map.size > 0) return map
    }
  }

  // Prefer the per-site precomputed files: a single dataset passed by a caller
  // (usually the currently selected site) is not topocentric for the others.
  const singleDataset =
    provided && typeof provided === 'object' && Array.isArray(provided.samples)
      ? ensureEphemeris(provided)
      : null
  try {
    const map = await loadEphemerisMap(ids)
    if (map.size > 0) {
      if (singleDataset?.siteId && !map.has(singleDataset.siteId)) map.set(singleDataset.siteId, singleDataset)
      return map
    }
  } catch (error) {
    console.warn(`[worker] could not load ephemerides: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (singleDataset) return singleDataset
  return new Map()
}

/**
 * Run one task.
 *
 * @param {string} type Task type (see {@link TASK_TYPES}).
 * @param {Object} [payload] Task payload.
 * @returns {Promise<Object>} Task result, posted as `payload` in the response.
 */
export async function runTask(type, payload = {}) {
  switch (type) {
    case 'ping':
      return { pong: true, timestamp: new Date().toISOString() }

    case 'autopilot': {
      let sites = Array.isArray(payload.sites) ? payload.sites : []
      if (sites.length === 0) sites = await loadSites()
      const mission = normalizeMission(payload.mission ?? {})
      const terrains = await resolveTerrains(payload)
      const ephemeris = await resolveEphemerides(payload, sites)
      const scores = rankSites({ sites, terrain: terrains, ephemeris, mission })
      return {
        scores,
        meta: {
          siteCount: sites.length,
          terrainCount: terrains.length,
          terrainIds: terrains.map((terrain) => terrain.id ?? null),
          generation: 'background-worker',
        },
      }
    }

    case 'landingZones': {
      // Flat landing zones from the DEM region the user is currently viewing
      // (not all regions): the payload terrain is preferred and a single region
      // is loaded as a fallback.
      let sites = Array.isArray(payload.sites) ? payload.sites : []
      if (sites.length === 0) sites = await loadSites()
      const terrain =
        ensureTerrain(payload.terrain) ??
        (await loadTerrain(payload.region ?? 'default'))
      const ephemeris = await resolveEphemerides(payload, sites)
      const options = { ...(payload.options ?? {}) }
      if (payload.maxZones != null) options.maxZones = payload.maxZones
      // Task-28: the zone autopilot searches mission-start dates by default;
      // callers can opt out with `searchDates: false` or pass `dateSearch` options.
      if (payload.searchDates !== false) options.searchDates = true
      if (payload.dateSearch && typeof payload.dateSearch === 'object') {
        options.dateSearch = { ...(payload.dateSearch ?? {}) }
      }
      const result = rankLandingZones({
        terrain,
        ephemeris,
        sites,
        mission: payload.mission ?? {},
        options,
      })
      return result
    }

    case 'missionCycles': {
      // Weekly sunlight/eclipse and Earth-link/relay cycles for the selected
      // site or landing zone over the mission window.
      const site = payload.site ?? null
      if (!site) throw new Error('missionCycles requires a site')
      let terrain = ensureTerrain(payload.terrain)
      if (!terrain) {
        try {
          terrain = await loadTerrainForSite(site)
        } catch {
          /* fall through */
        }
      }
      if (!terrain) {
        try {
          terrain = await loadTerrain(payload.region ?? 'default')
        } catch {
          /* keep null; cycles warns about a missing terrain */
        }
      }
      let ephemeris = ensureEphemeris(payload.ephemeris)
      if (!ephemeris) {
        const ephemerisSiteId = site.ephemerisSiteId ?? payload.ephemerisSiteId ?? site.id
        if (ephemerisSiteId) ephemeris = await loadEphemeris(ephemerisSiteId)
      }
      if (!ephemeris) throw new Error('missionCycles requires an ephemeris dataset')
      return computeMissionCycles({
        terrain,
        site,
        ephemeris,
        mission: payload.mission ?? {},
        options: payload.options ?? {},
      })
    }

    case 'scoreSite': {
      const site = payload.site ?? null
      const terrain = ensureTerrain(payload.terrain)
      const ephemeris = ensureEphemeris(payload.ephemeris)
      return { score: scoreSite({ site, terrain, ephemeris, mission: payload.mission ?? {} }) }
    }

    case 'horizonProfile': {
      const terrain = ensureTerrain(payload.terrain)
      const profile = horizonProfile(terrain, payload.site, sanitizeTaskOptions(payload.options))
      return {
        profile: {
          stepDeg: profile.stepDeg,
          count: profile.count,
          angles: Array.from(profile.angles),
          site: profile.site,
          maxDistanceM: profile.maxDistanceM,
          terrainId: profile.terrainId,
          synthetic: profile.synthetic,
        },
      }
    }

    case 'craters': {
      const terrain = ensureTerrain(payload.terrain)
      return { craters: findCraters(terrain, payload.options ?? {}) }
    }

    case 'terrainStats': {
      const terrain = ensureTerrain(payload.terrain)
      return { stats: areaStatistics(terrain, payload.site, sanitizeTaskOptions(payload.options)) }
    }

    case 'power': {
      const terrain = ensureTerrain(payload.terrain)
      const ephemeris = ensureEphemeris(payload.ephemeris)
      return {
        power: solarPowerEstimate(payload.site, terrain, ephemeris, payload.mission ?? {}),
      }
    }

    case 'comms': {
      const terrain = ensureTerrain(payload.terrain)
      const ephemeris = ensureEphemeris(payload.ephemeris)
      const windows = commWindows(
        payload.site,
        terrain,
        ephemeris,
        payload.mission ?? {},
        payload.from,
        payload.to,
      )
      return { windows, budget: dataBudget(windows, payload.mission ?? {}) }
    }

    case 'visibilityWindows': {
      const terrain = ensureTerrain(payload.terrain)
      const ephemeris = ensureEphemeris(payload.ephemeris)
      return {
        windows: visibilityWindows(
          ephemeris,
          payload.site,
          terrain,
          payload.body ?? 'sun',
          payload.from,
          payload.to,
          payload.options ?? {},
        ),
      }
    }

    case 'nextSetEvent': {
      const terrain = ensureTerrain(payload.terrain)
      const ephemeris = ensureEphemeris(payload.ephemeris)
      return {
        event: nextSetEvent(
          ephemeris,
          payload.site,
          terrain,
          payload.body ?? 'sun',
          payload.from,
          payload.options ?? {},
        ),
      }
    }

    case 'sampleAt': {
      const ephemeris = ensureEphemeris(payload.ephemeris)
      if (!ephemeris) throw new Error('sampleAt requires an ephemeris dataset')
      const sample = sampleAt(ephemeris, payload.date, payload.options ?? {})
      return { sample }
    }

    default:
      throw new Error(`Unknown task type '${type}'`)
  }
}

/**
 * Task helper re-export so both the worker and the inline client use identical
 * terrain normalization.
 */
export { ensureTerrain, ensureEphemeris }

/**
 * Convert a date-like payload field to milliseconds (used by callers/tests).
 *
 * @param {Date|number|string} value
 * @returns {number}
 */
export function timestampOf(value) {
  return toTimestamp(value)
}

/**
 * Evaluate a body against the terrain horizon (small convenience task used by
 * adapters that do not want to load the whole engine).
 *
 * @param {Object|null} terrain
 * @param {Object} site
 * @param {{az: number, el: number}} body
 * @param {Object} [options]
 * @returns {Object}
 */
export function visibilityAt(terrain, site, body, options = {}) {
  return evaluateBodyVisibility(terrain, site, body, options)
}

/** Re-export the ephemeris loader for worker-side use. */
export { loadEphemeris, loadTerrainForSite }
