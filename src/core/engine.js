/**
 * Line-of-sight engine: terrain horizon with lunar curvature, ray/terrain
 * intersection and Sun/Earth visibility.
 *
 * The engine is the scientific core of L-SEA. At the lunar south pole the Sun
 * and the Earth stay within a few degrees of the horizon, so whether a site is
 * lit or has a communications link is decided by the *terrain horizon* at the
 * body's azimuth. A naive flat-horizon test would be badly wrong, and so would
 * a horizon scan that ignores the lunar curvature: at `d = 200 km` the surface
 * drops `d²/(2R) ≈ 11.5 km` below the tangent plane.
 *
 * The engine accepts both supported terrain shapes:
 *
 * - the full-resolution LOLA polar-stereographic raster (`pixelSizeM`, `minX`,
 *   `maxY`, int16 payload) — used by the background worker and the services,
 * - the reduced latitude/longitude grid produced by the UI adapter for rendering
 *   — the functions detect the shape automatically via `terrainKind`.
 *
 * All functions are pure, framework-agnostic and accept the terrain produced by
 * {@link module:core/terrain}. Azimuths are degrees clockwise from true north;
 * elevations are degrees above the local horizontal.
 *
 * @module core/engine
 */

import {
  MOON_RADIUS_M,
  clamp,
  normalizeLongitude,
  destinationPoint,
  elevationAngleDeg,
  projectRayPoint,
} from './geometry.js'
import {
  sampleElevation,
  resolveSiteElevation,
  terrainExtentM,
  terrainCellSizeM,
  isInsideTerrain,
  terrainReferenceRadiusM,
} from './terrain.js'

/** Default maximum horizon search distance in meters. */
export const DEFAULT_MAX_DISTANCE_M = 350000

/** Safe azimuth sampling range for a horizon profile (audit SEC-04). */
export const MIN_HORIZON_STEP_DEG = 0.5
export const MAX_HORIZON_STEP_DEG = 10

/**
 * Safe range for the horizontal sampling step of a horizon scan, in meters.
 * A tiny step would make the range-walk loop effectively unbounded.
 */
export const MIN_HORIZON_STEP_METERS = 1
export const MAX_HORIZON_STEP_METERS = 50000

/** Horizon profile cache keyed by terrain object, then by site/options signature. */
let horizonProfileCache = new WeakMap()

/**
 * Resolve a requested horizontal sampling step to a finite, bounded value.
 *
 * @param {unknown} value Requested step in meters.
 * @param {number} fallback Step used when the request is missing or invalid.
 * @returns {number} Step in meters, within the SEC-04 safety range.
 */
function resolveHorizonStepMeters(value, fallback) {
  const step = Number(value)
  if (!Number.isFinite(step) || step <= 0) return fallback
  return clamp(step, MIN_HORIZON_STEP_METERS, MAX_HORIZON_STEP_METERS)
}

/**
 * Geometric state of a site used by the horizon scanner.
 *
 * @param {Object|null} terrain Terrain grid (planar or latitude/longitude).
 * @param {{lat: number, lon: number, elevationM?: number|null}} site Site.
 * @returns {{
 *   lat: number,
 *   lon: number,
 *   elevationM: number,
 *   inside: boolean,
 *   referenceRadiusM: number,
 * }|null}
 */
export function siteGeometry(terrain, site) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return null
  return {
    lat: site.lat,
    lon: normalizeLongitude(site.lon),
    elevationM: resolveSiteElevation(terrain, site),
    inside: terrain ? isInsideTerrain(terrain, site.lat, site.lon) : false,
    referenceRadiusM: terrainReferenceRadiusM(terrain),
  }
}

/**
 * Terrain horizon angle along an azimuth, including lunar curvature.
 *
 * Marches a great circle from the site at the requested bearing, samples the DEM
 * every ≈ one terrain cell and keeps the maximum elevation angle of the line of
 * sight. The elevation angle of each terrain sample uses the exact spherical
 * relation (see `geometry.elevationAngleDeg`), so the curvature drop is
 * naturally included:
 *
 * ```text
 * tan(angle) = ((R + zTarget)·cos(d/R) − (R + zSite)) / ((R + zTarget)·sin(d/R))
 * ```
 *
 * The scan stops at the DEM boundary or at `options.maxDistanceM`. When no
 * terrain is available (or the site is outside the covered region) the horizon
 * is reported as `-90` (no known obstruction); callers should surface a data
 * warning. A horizon computed from the reduced UI grid is coarser than one from
 * the full-resolution LOLA raster; the functions are the same.
 *
 * @param {Object|null} terrain Terrain grid (see module docs).
 * @param {{lat: number, lon: number, elevationM?: number|null}} site Site.
 * @param {number} azimuthDeg Azimuth in degrees clockwise from north.
 * @param {{stepMeters?: number, maxDistanceM?: number, startDistanceM?: number}} [options]
 * @returns {number} Maximum horizon elevation angle in degrees (can be negative).
 */
export function horizonAngle(terrain, site, azimuthDeg, options = {}) {
  if (!terrain || !site) return -90
  const geometry = siteGeometry(terrain, site)
  if (!geometry || !geometry.inside) return -90
  const azimuth = normalizeLongitude(azimuthDeg)
  if (!Number.isFinite(azimuth)) return -90

  const opts = options && typeof options === 'object' ? options : {}
  const radius = geometry.referenceRadiusM
  const cell = terrainCellSizeM(terrain, site.lat)
  const stepMeters = resolveHorizonStepMeters(
    opts.stepMeters,
    Math.max(Math.max(cell.eastM, cell.northM), 20),
  )
  const extent = terrainExtentM(terrain, site)
  const maxDistance = Math.min(
    Number(opts.maxDistanceM) > 0 ? Number(opts.maxDistanceM) : DEFAULT_MAX_DISTANCE_M,
    extent > 0 ? extent : DEFAULT_MAX_DISTANCE_M,
  )
  const start = Number(opts.startDistanceM) > 0 ? Number(opts.startDistanceM) : stepMeters

  let maxAngle = -90
  let distance = start
  while (distance <= maxDistance) {
    const point = destinationPoint(site.lat, site.lon, azimuth, distance, radius)
    const targetElevation = sampleElevation(terrain, point.lat, point.lon)
    if (!Number.isFinite(targetElevation)) break
    const angle = elevationAngleDeg(geometry.elevationM, targetElevation, distance, radius)
    if (angle > maxAngle) maxAngle = angle
    distance += stepMeters
  }
  return maxAngle
}

/**
 * @typedef {Object} HorizonProfile
 * @property {number} stepDeg Azimuth step in degrees.
 * @property {number} count Number of sampled azimuths.
 * @property {Float32Array} angles Horizon angle per azimuth in degrees.
 * @property {{lat: number, lon: number, elevationM: number}|null} site Profile site.
 * @property {number} maxDistanceM Maximum search distance in meters.
 * @property {string} [terrainId] Terrain identifier.
 * @property {boolean} synthetic Whether the profile comes from synthetic terrain.
 */

/**
 * Horizon profile of a site for every azimuth (360° / `stepDeg` samples).
 *
 * Profiles are cached per terrain object (WeakMap) because they are reused by
 * the power, communications and autopilot modules; repeated calls with the same
 * site and options are nearly free. Use {@link clearHorizonCache} to replace the
 * cache after swapping the DEM.
 *
 * @param {Object|null} terrain Terrain grid (see module docs).
 * @param {{lat: number, lon: number, elevationM?: number|null}} site Site.
 * @param {{stepDeg?: number, stepMeters?: number, maxDistanceM?: number}} [options]
 * @returns {HorizonProfile} Profile (`angles` all `-90` when no terrain).
 */
export function horizonProfile(terrain, site, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  // Clamp the azimuth sampling step so a hostile/malformed option cannot
  // allocate a multi-billion-entry Float32Array (SEC-04). 0.5 deg = 720
  // samples maximum.
  const requestedStepDeg = Number(opts.stepDeg)
  const stepDeg =
    Number.isFinite(requestedStepDeg) && requestedStepDeg > 0
      ? clamp(requestedStepDeg, MIN_HORIZON_STEP_DEG, MAX_HORIZON_STEP_DEG)
      : 1
  const count = Math.max(1, Math.min(720, Math.round(360 / stepDeg)))
  // Clamp the horizontal step once as well: it drives the per-azimuth range
  // walk, where a tiny value would make the scan effectively unbounded.
  const effectiveOptions = { ...opts }
  const requestedStepMeters = Number(opts.stepMeters)
  if (Number.isFinite(requestedStepMeters) && requestedStepMeters > 0) {
    effectiveOptions.stepMeters = resolveHorizonStepMeters(
      requestedStepMeters,
      requestedStepMeters,
    )
  } else {
    delete effectiveOptions.stepMeters
  }
  const siteKey = site ? `${Number(site.lat).toFixed(5)},${Number(site.lon).toFixed(5)}` : 'none'
  const optionsKey = `${stepDeg}|${effectiveOptions.stepMeters ?? ''}|${effectiveOptions.maxDistanceM ?? ''}`
  const cacheKey = `${siteKey}|${optionsKey}`

  const terrainKey = terrain && typeof terrain === 'object' ? terrain : null
  if (terrainKey) {
    const cache = horizonProfileCache.get(terrainKey)
    const cached = cache?.get(cacheKey)
    if (cached) return cached
  }

  const geometry = terrain ? siteGeometry(terrain, site) : null
  const angles = new Float32Array(count)
  const extent = terrain && geometry ? terrainExtentM(terrain, site) : 0
  const maxDistanceM = Math.min(
    Number(effectiveOptions.maxDistanceM) > 0
      ? Number(effectiveOptions.maxDistanceM)
      : DEFAULT_MAX_DISTANCE_M,
    extent > 0 ? extent : DEFAULT_MAX_DISTANCE_M,
  )

  if (!terrain || !geometry || !geometry.inside) {
    angles.fill(-90)
  } else {
    for (let index = 0; index < count; index += 1) {
      angles[index] = horizonAngle(terrain, site, index * stepDeg, effectiveOptions)
    }
  }

  const profile = {
    stepDeg,
    count,
    angles,
    site: site
      ? {
          lat: site.lat,
          lon: normalizeLongitude(site.lon),
          elevationM: geometry ? geometry.elevationM : resolveSiteElevation(terrain, site),
        }
      : null,
    maxDistanceM,
    terrainId: terrain?.id ?? null,
    synthetic: terrain?.synthetic === true,
  }

  if (terrainKey) {
    let cache = horizonProfileCache.get(terrainKey)
    if (!cache) {
      cache = new Map()
      horizonProfileCache.set(terrainKey, cache)
    }
    cache.set(cacheKey, profile)
  }
  return profile
}

/** Alias of {@link horizonProfile} for readability in UI code. */
export const buildHorizonProfile = horizonProfile

/**
 * Horizon angle at an arbitrary azimuth from a precomputed profile.
 *
 * Linear interpolation between profile samples, wrapping across 0/360°.
 *
 * @param {HorizonProfile|null} profile
 * @param {number} azimuthDeg Azimuth in degrees clockwise from north.
 * @returns {number} Horizon angle in degrees (`-90` without a profile).
 */
export function horizonAngleAt(profile, azimuthDeg) {
  if (!profile || !profile.angles || profile.count < 1 || !Number.isFinite(azimuthDeg)) return -90
  const normalized = normalizeLongitude(azimuthDeg)
  const position = normalized / profile.stepDeg
  const index0 = Math.floor(position) % profile.count
  const index1 = (index0 + 1) % profile.count
  const fraction = position - Math.floor(position)
  const a = profile.angles[index0]
  const b = profile.angles[index1]
  return a + (b - a) * fraction
}

/**
 * Drop cached horizon profiles.
 *
 * The cache is a WeakMap keyed by terrain objects, so entries disappear with the
 * terrain. This helper also replaces the module-level cache map itself, which is
 * useful after swapping the DEM and for test isolation.
 *
 * @returns {void}
 */
export function clearHorizonCache() {
  horizonProfileCache = new WeakMap()
}

/**
 * Evaluate visibility of a celestial body against the terrain horizon.
 *
 * The body is visible when its elevation exceeds the terrain horizon angle at
 * its azimuth (plus `options.thresholdDeg`, default 0). The returned margin is
 * positive when visible; its magnitude is a useful "how close to the horizon"
 * metric for the UI and for mission scoring.
 *
 * @param {Object|null} terrain Terrain grid (see module docs).
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {{az: number, el: number}|null} body Body azimuth/elevation in degrees.
 * @param {{
 *   profile?: HorizonProfile|null,
 *   thresholdDeg?: number,
 *   limbRadiusDeg?: number,
 *   stepMeters?: number,
 *   maxDistanceM?: number,
 * }} [options]
 * @returns {{visible: boolean, marginDeg: number, horizonDeg: number, bodyElevationDeg: number, bodyAzimuthDeg: number}}
 */
export function evaluateBodyVisibility(terrain, site, body, options = {}) {
  const bodyElevationDeg = body && Number.isFinite(body.el) ? Number(body.el) : Number.NaN
  const bodyAzimuthDeg = body && Number.isFinite(body.az) ? normalizeLongitude(body.az) : Number.NaN
  if (!Number.isFinite(bodyElevationDeg) || !Number.isFinite(bodyAzimuthDeg)) {
    return {
      visible: false,
      marginDeg: Number.NaN,
      horizonDeg: Number.NaN,
      bodyElevationDeg,
      bodyAzimuthDeg,
    }
  }
  const horizonDeg = options.profile
    ? horizonAngleAt(options.profile, bodyAzimuthDeg)
    : horizonAngle(terrain, site, bodyAzimuthDeg, options)
  const thresholdDeg = Number(options.thresholdDeg) || 0
  const marginDeg = bodyElevationDeg - horizonDeg
  const limbRadiusDeg = Number(options.limbRadiusDeg) || 0
  const visible = marginDeg - thresholdDeg + limbRadiusDeg > 0
  return {
    visible,
    marginDeg,
    horizonDeg,
    bodyElevationDeg,
    bodyAzimuthDeg,
  }
}

/**
 * Is the Sun above the terrain horizon at this site?
 *
 * The solar disk has a radius of about 0.266° seen from the Moon; by default the
 * centre of the disk is used (standard sunrise/sunset convention for power),
 * pass `options.sunRadiusDeg = 0.266` to accept partial illumination.
 *
 * @param {Object|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {{az: number, el: number}|null} sun Sun azimuth/elevation in degrees.
 * @param {{profile?: HorizonProfile|null, thresholdDeg?: number, sunRadiusDeg?: number}} [options]
 * @returns {boolean}
 */
export function isSunVisible(terrain, site, sun, options = {}) {
  return evaluateBodyVisibility(terrain, site, sun, {
    ...options,
    limbRadiusDeg: options.sunRadiusDeg ?? 0,
  }).visible
}

/**
 * Is the Earth above the terrain horizon at this site?
 *
 * The Earth has an apparent angular radius of about 0.95° seen from the Moon.
 * By default the Earth centre is tested (line of sight to the sub-Earth point);
 * pass `options.limbRadiusDeg = 0.95` to accept a link as soon as any part of the
 * disk clears the horizon, or `-0.95` to require the full disk.
 *
 * @param {Object|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {{az: number, el: number}|null} earth Earth azimuth/elevation in degrees.
 * @param {{profile?: HorizonProfile|null, thresholdDeg?: number, limbRadiusDeg?: number}} [options]
 * @returns {boolean}
 */
export function isEarthVisible(terrain, site, earth, options = {}) {
  return evaluateBodyVisibility(terrain, site, earth, {
    ...options,
    limbRadiusDeg: options.limbRadiusDeg ?? 0,
  }).visible
}

/**
 * Find where a line of sight intersects the terrain.
 *
 * Marches the straight ray from the site in steps that grow geometrically
 * (cheap for high grazing angles) and returns the first point where the ray
 * height drops to or below the sampled terrain elevation. The ray follows
 * `geometry.projectRayPoint`: the lunar surface curves away below it, exactly
 * like in the horizon computation. Works on both planar and latitude/longitude
 * terrain because it only relies on `sampleElevation`.
 *
 * Returns `null` when the ray escapes the DEM coverage without intersecting the
 * terrain (i.e. the body is not blocked by terrain within the data).
 *
 * @param {Object|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {number} azimuthDeg Ray azimuth in degrees clockwise from north.
 * @param {number} elevationDeg Ray elevation angle in degrees.
 * @param {{maxDistanceM?: number, startDistanceM?: number, growth?: number, surfaceOffsetM?: number, maxSteps?: number}} [options]
 * @returns {{distanceM: number, lat: number, lon: number, elevationM: number, terrainElevationM: number}|null}
 */
export function rayTerrainIntersection(terrain, site, azimuthDeg, elevationDeg, options = {}) {
  if (!terrain || !site) return null
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) return null
  const geometry = siteGeometry(terrain, site)
  if (!geometry || !geometry.inside) return null

  const radius = geometry.referenceRadiusM
  const extent = terrainExtentM(terrain, site)
  const maxDistance = Math.min(
    Number(options.maxDistanceM) > 0 ? Number(options.maxDistanceM) : DEFAULT_MAX_DISTANCE_M,
    extent > 0 ? extent : DEFAULT_MAX_DISTANCE_M,
  )
  const surfaceOffsetM = Number(options.surfaceOffsetM) || 0
  const growth = Number(options.growth) > 1 ? Number(options.growth) : 1.06
  const maxSteps = Math.max(16, Math.round(Number(options.maxSteps) || 600))
  const cell = terrainCellSizeM(terrain, site.lat)
  const start =
    Number(options.startDistanceM) > 0
      ? Number(options.startDistanceM)
      : Math.max(5, Math.min(cell.eastM, cell.northM) / 4)

  let previousDistance = 0
  let distance = start
  for (let step = 0; step < maxSteps && distance <= maxDistance; step += 1) {
    const point = projectRayPoint(
      site.lat,
      site.lon,
      geometry.elevationM,
      azimuthDeg,
      elevationDeg,
      distance,
      radius,
    )
    if (!point) return null
    const terrainElevation = sampleElevation(terrain, point.lat, point.lon)
    if (!Number.isFinite(terrainElevation)) break

    if (terrainElevation + surfaceOffsetM >= point.elevationM) {
      let low = previousDistance
      let high = distance
      let highHeight = point.elevationM
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const mid = (low + high) / 2
        const midPoint = projectRayPoint(
          site.lat,
          site.lon,
          geometry.elevationM,
          azimuthDeg,
          elevationDeg,
          mid,
          radius,
        )
        if (!midPoint) break
        const midTerrain = sampleElevation(terrain, midPoint.lat, midPoint.lon)
        if (!Number.isFinite(midTerrain)) break
        if (midTerrain + surfaceOffsetM >= midPoint.elevationM) {
          high = mid
          highHeight = midPoint.elevationM
        } else {
          low = mid
        }
      }
      const intersection = projectRayPoint(
        site.lat,
        site.lon,
        geometry.elevationM,
        azimuthDeg,
        elevationDeg,
        high,
        radius,
      )
      if (!intersection) return null
      return {
        distanceM: high,
        lat: intersection.lat,
        lon: intersection.lon,
        elevationM: highHeight,
        terrainElevationM: sampleElevation(terrain, intersection.lat, intersection.lon),
      }
    }

    previousDistance = distance
    distance = distance * growth + start
    if (distance - previousDistance < 0.5) distance = previousDistance + 0.5
  }
  return null
}

/**
 * Convenience helper: Sun visibility plus horizon margin, ready for the UI.
 *
 * @param {Object|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {{az: number, el: number}|null} sun
 * @param {Object} [options] See {@link evaluateBodyVisibility}.
 * @returns {{visible: boolean, marginDeg: number, horizonDeg: number, bodyElevationDeg: number, bodyAzimuthDeg: number}}
 */
export function sunVisibility(terrain, site, sun, options = {}) {
  return evaluateBodyVisibility(terrain, site, sun, options)
}

/**
 * Convenience helper: Earth visibility plus horizon margin, ready for the UI.
 *
 * @param {Object|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {{az: number, el: number}|null} earth
 * @param {Object} [options] See {@link evaluateBodyVisibility}.
 * @returns {{visible: boolean, marginDeg: number, horizonDeg: number, bodyElevationDeg: number, bodyAzimuthDeg: number}}
 */
export function earthVisibility(terrain, site, earth, options = {}) {
  return evaluateBodyVisibility(terrain, site, earth, options)
}
