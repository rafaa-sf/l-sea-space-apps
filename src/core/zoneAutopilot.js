/**
 * Zone-based mission autopilot: rank flat landing zones (detected from the DEM)
 * instead of named points of interest.
 *
 * The scientific point: a lander lands on an area, not on a crater rim or a
 * massif crest. `rankLandingZones` therefore:
 *
 * 1. detects flat zones with {@link module:core/zones.detectLandingZones} on the
 *    *currently loaded* DEM region (the same terrain the user sees),
 * 2. for every zone picks the nearest curated site and reuses that site's
 *    precomputed Sun/Earth ephemeris (topocentric difference across ≤100 km is
 *    negligible at the lunar south pole — reported as an
 *    `ephemeris-nearest-site` warning),
 * 3. scores the zone with the regular `scoreSite` mission model, using the zone
 *    coordinates and the terrain horizon at the zone,
 * 4. returns the ranked entries plus metadata describing the approximation.
 *
 * @module core/zoneAutopilot
 */

import { clamp, greatCircleDistanceM } from './geometry.js'
import { terrainReferenceRadiusM } from './terrain.js'
import {
  normalizeMission,
  normalizeSiteForScoring,
  resolveEphemerisForSite,
  scoreSite,
} from './autopilot.js'
import { detectLandingZones } from './zones.js'

/**
 * Documented approximation used when a zone borrows the ephemeris of the
 * nearest curated site.
 */
export const ZONE_EPHEMERIS_APPROXIMATION =
  'Sun/Earth ephemeris is taken from the nearest curated reference site. The topocentric Earth ' +
  'parallax difference is below 0.1 degrees even across the 608 km wide south-pole DEM (the Sun is ' +
  'effectively unaffected), so the borrowed ephemeris is well within the terrain-horizon uncertainty.'

/**
 * Find the nearest curated site to a zone centroid.
 *
 * @param {{lat: number, lon: number}} zone Zone centroid.
 * @param {Array<Object>} sites Curated sites (POI list).
 * @param {number} [referenceRadiusM] Lunar reference radius in meters.
 * @returns {{site: Object, distanceM: number}|null} Nearest site or `null`
 *   when the list is empty/invalid.
 */
export function nearestCuratedSite(zone, sites, referenceRadiusM = 1737400) {
  if (!zone || !Array.isArray(sites) || sites.length === 0) return null
  let best = null
  for (const rawSite of sites) {
    if (!rawSite) continue
    const site = normalizeSiteForScoring(rawSite)
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue
    const distanceM = greatCircleDistanceM(zone.lat, zone.lon, site.lat, site.lon, referenceRadiusM)
    if (!Number.isFinite(distanceM)) continue
    if (!best || distanceM < best.distanceM) best = { site, distanceM }
  }
  return best
}

/**
 * Build a scoring site record from a detected zone.
 *
 * The zone area is converted into an equivalent circular perimeter so the
 * regular mission logistics component sees how much room the zone offers; the
 * antenna mast height comes from the mission profile (the lander carries it).
 *
 * @param {Object} zone Detected zone.
 * @param {{mastM?: number|null, source?: string}} [extras]
 * @returns {Object} Site in the documented `Site` shape (plus zone metadata).
 */
export function landingZoneToSite(zone, extras = {}) {
  const areaM2 = Math.max(0, Number(zone?.areaKm2) || 0) * 1e6
  return {
    id: zone?.id ?? 'zone',
    name: zone?.name ?? 'Landing zone',
    lat: Number(zone?.lat),
    lon: Number(zone?.lon),
    elevationM: Number.isFinite(Number(zone?.elevationM)) ? Number(zone.elevationM) : null,
    perimeterM: 2 * Math.sqrt(Math.PI * areaM2),
    mastM: Number.isFinite(Number(extras.mastM)) ? Number(extras.mastM) : null,
    source: extras.source ?? 'zone',
    zoneId: zone?.id ?? null,
    areaKm2: Number(zone?.areaKm2) || null,
    meanSlopeDeg: Number(zone?.meanSlopeDeg) || null,
  }
}

/**
 * Rank landing zones for a mission profile.
 *
 * @param {{
 *   terrain: import('./terrain.js').Terrain|null,
 *   ephemeris: *, // single dataset, Map/object keyed by curated site id, or function
 *   sites: Array<Object>, // curated POIs used as ephemeris anchors
 *   mission?: Object,
 *   options?: Object, // detection options, plus `maxZones`
 * }} input
 * @returns {{
 *   zones: Array<{
 *     zone: Object,
 *     rank: number|null,
 *     siteId: string,
 *     siteName: string,
 *     score: number|null,
 *     grade: string,
 *     gradeCode: string,
 *     confidence: number,
 *     components: Object,
 *     metrics: Object,
 *     reasons: Array<Object>,
 *     warnings: Array<Object>,
 *     ephemerisSiteId: string|null,
 *     nearestSiteId: string|null,
 *     nearestSiteDistanceM: number|null,
 *   }>,
 *   meta: Object,
 * }} Ranked zone entries plus approximation metadata.
 */
export function rankLandingZones({ terrain, ephemeris, sites, mission, options } = {}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const normalizedMission = normalizeMission(mission ?? {})
  const curatedSites = Array.isArray(sites) ? sites : []
  const detection = detectLandingZones(terrain, options ?? {})
  const referenceRadiusM = terrainReferenceRadiusM(terrain)
  const terrainId = terrain?.id ?? null

  const entries = detection.zones.map((zone) => {
    const zoneSite = landingZoneToSite(zone, {
      mastM: normalizedMission.mastM,
      source: 'zone',
    })
    const nearest = nearestCuratedSite(zone, curatedSites, referenceRadiusM)
    const ephemerisSource = nearest ? nearest.site : zoneSite
    const resolution = resolveEphemerisForSite(ephemeris, ephemerisSource)
    const score = scoreSite({
      site: zoneSite,
      terrain,
      ephemeris: resolution.dataset,
      mission: normalizedMission,
    })

    // The regular scoreSite flags a single dataset as "shared"; for zones the
    // per-zone nearest-site ephemeris is an explicit, documented approximation
    // (reported below), so drop the generic warning to avoid double reporting.
    const warnings = (score.warnings ?? []).filter((warning) => warning.code !== 'data.sharedEphemeris')
    if (nearest) {
      warnings.push({
        code: 'ephemeris-nearest-site',
        severity: 'info',
        params: {
          zoneId: zone.id,
          ephemerisSiteId: nearest.site.id,
          distanceM: Math.round(nearest.distanceM),
        },
        text:
          `Sun/Earth ephemeris comes from the nearest curated site '${nearest.site.id}' ` +
          `(${Math.round(nearest.distanceM / 1000)} km away); topocentric parallax error is <0.1 degrees.`,
      })
    } else {
      warnings.push({
        code: 'no-nearest-site',
        severity: 'warn',
        params: { zoneId: zone.id },
        text: 'No curated site is available to anchor the Sun/Earth ephemeris for this zone.',
      })
    }
    if (resolution.shared) {
      warnings.push({
        code: 'data.sharedEphemeris',
        severity: 'info',
        params: { zoneId: zone.id },
        text: 'A single ephemeris dataset is shared by all zones; topocentric differences are ignored.',
      })
    }

    const reasons = [
      {
        code: 'zone.flatArea',
        severity: 'good',
        params: {
          areaKm2: round2(zone.areaKm2),
          meanSlopeDeg: round2(zone.meanSlopeDeg),
          maxSlopeDeg: round2(zone.maxSlopeDeg),
        },
        text:
          `Flat landing zone of ${round1(zone.areaKm2)} km² ` +
          `(mean slope ${round2(zone.meanSlopeDeg)}°, max ${round2(zone.maxSlopeDeg)}°).`,
      },
      ...(score.reasons ?? []),
    ]

    return {
      zone,
      rank: null,
      siteId: zone.id,
      siteName: zone.name,
      site: zoneSite,
      score: score.score,
      grade: score.grade,
      gradeCode: score.gradeCode,
      confidence: score.confidence,
      components: score.components,
      metrics: {
        ...score.metrics,
        zoneAreaKm2: round2(zone.areaKm2),
        zoneMeanSlopeDeg: round2(zone.meanSlopeDeg),
        zoneMaxSlopeDeg: round2(zone.maxSlopeDeg),
        zoneReliefM: round1(zone.reliefM),
        zoneCellCount: zone.cellCount,
        zoneSuitability: round2(zone.suitability),
      },
      reasons,
      warnings,
      ephemerisSiteId: nearest?.site.id ?? resolution.dataset?.siteId ?? null,
      nearestSiteId: nearest?.site.id ?? null,
      nearestSiteDistanceM: nearest ? round1(nearest.distanceM) : null,
    }
  })

  entries.sort((a, b) => {
    if (a.score == null && b.score == null) return 0
    if (a.score == null) return 1
    if (b.score == null) return -1
    return b.score - a.score
  })
  let rank = 0
  for (const entry of entries) {
    if (entry.score != null) {
      entry.rank = ++rank
      entry.zoneLabel = `Zone ${entry.rank}`
    }
  }

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const scoredEntries = entries.filter((entry) => entry.score != null)
  return {
    zones: entries,
    meta: {
      terrainId,
      terrainKind: detection.meta.terrainKind,
      syntheticTerrain: detection.meta.synthetic === true,
      zoneCount: entries.length,
      scoredCount: scoredEntries.length,
      detection: detection.meta,
      approximation: ZONE_EPHEMERIS_APPROXIMATION,
      ephemerisApproxMaxErrorDeg: 0.1,
      ephemerisMode: curatedSites.length > 0 ? 'nearest-curated-site' : 'unavailable',
      mission: {
        missionDays: normalizedMission.missionDays,
        powerNeedW: normalizedMission.powerNeedW,
        sunDaysNeeded: normalizedMission.sunDaysNeeded,
        relayInOrbit: normalizedMission.relayInOrbit,
        startTime: normalizedMission.startTime,
      },
      rankingMs: Math.round((finishedAt - startedAt) * 100) / 100,
    },
  }
}

/**
 * Round to one decimal place.
 *
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(Number(value) * 10) / 10
}

/**
 * Round to two decimal places.
 *
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Math.round(Number(value) * 100) / 100
}

/**
 * Clamp helper re-exported for adapters that need the same slope gate.
 *
 * @type {typeof clamp}
 */
export { clamp }
