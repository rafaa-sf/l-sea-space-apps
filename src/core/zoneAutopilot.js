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
 *    precomputed Sun/Earth ephemeris (topocentric difference across the south
 *    pole is negligible — reported as an `ephemeris-nearest-site` warning),
 * 3. computes the full mission-feasibility variables with
 *    {@link module:core/landingMetrics.computeLandingMetrics}: safety, illumination,
 *    power in Watts/Wh (battery + heater sizing), thermal, communications,
 *    logistics and science proximity,
 * 4. returns the ranked entries and metadata including a deterministic
 *    `inputSignature` proving that everything was recomputed for the current
 *    terrain region, mission profile and time window.
 *
 * @module core/zoneAutopilot
 */

import { clamp, greatCircleDistanceM } from './geometry.js'
import { findCraters, terrainReferenceRadiusM } from './terrain.js'
import {
  normalizeMission,
  normalizeSiteForScoring,
  resolveEphemerisForSite,
} from './autopilot.js'
import { detectLandingZones, normalizeZoneOptions } from './zones.js'
import { normalizeDateSearchOptions, searchFeasibleDate } from './dateSearch.js'
import {
  LANDING_MODEL_VERSION,
  computeInputSignature,
  computeLandingMetrics,
  normalizeLandingWeights,
} from './landingMetrics.js'

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
 * @returns {{site: Object, distanceM: number}|null} Nearest site or `null`.
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
 * landing/safety metrics see how much room the zone offers.
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
 * Detect crater hazards once for the whole ranking run.
 *
 * @param {Object|null} terrain
 * @param {Object} mission Normalized mission.
 * @param {Object} options Detection options (may contain `detectCraterHazards`).
 * @returns {{craters: Array<Object>, cratersAvailable: boolean}}
 */
function detectCraterHazards(terrain, mission, options) {
  if (!terrain || options?.detectCraterHazards === false) return { craters: [], cratersAvailable: false }
  try {
    const craters = findCraters(terrain, {
      minDiameterM: mission.craterHazardMinDiameterM,
      maxDiameterM: Math.max(60000, mission.craterHazardReachM * 4),
      minDepthM: 30,
      maxCraters: 40,
      maxCandidates: 600,
    })
    return { craters, cratersAvailable: true }
  } catch (error) {
    console.warn(`[landingZones] crater hazard detection failed: ${error instanceof Error ? error.message : String(error)}`)
    return { craters: [], cratersAvailable: false }
  }
}

/**
 * Ranking order: fully feasible zones first, then infeasible/undetermined ones,
 * each group sorted by score (best first). Ties keep the deterministic detection
 * order (Array.prototype.sort is stable).
 *
 * @param {Object} a Ranked zone entry.
 * @param {Object} b Ranked zone entry.
 * @returns {number} Negative when `a` must rank before `b`.
 */
export function compareZoneEntries(a, b) {
  const aFeasible = a?.feasible === true ? 0 : 1
  const bFeasible = b?.feasible === true ? 0 : 1
  if (aFeasible !== bFeasible) return aFeasible - bFeasible
  if (a.score == null && b.score == null) return 0
  if (a.score == null) return 1
  if (b.score == null) return -1
  return b.score - a.score
}

/**
 * Sort ranked zone entries in place with the documented feasibility-first order.
 *
 * @param {Array<Object>} entries
 * @returns {Array<Object>} The same array (sorted).
 */
export function sortZoneEntriesByFeasibility(entries) {
  if (!Array.isArray(entries)) return []
  return entries.sort(compareZoneEntries)
}

/**
 * Rank landing zones for a mission profile.
 *
 * Every call recomputes all metrics from the current terrain, mission profile
 * (including battery/thermal fields), ephemeris datasets and mission time
 * window; nothing is cached at this level. `meta.inputSignature` changes
 * whenever any of those inputs change.
 *
 * @param {{
 *   terrain: import('./terrain.js').Terrain|null,
 *   ephemeris: *,
 *   sites: Array<Object>,
 *   mission?: Object,
 *   options?: Object,
 * }} input
 * @returns {{
 *   zones: Array<{
 *     zone: Object,
 *     rank: number|null,
 *     siteId: string,
 *     siteName: string,
 *     site: Object,
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
 *     zoneLabel: string,
 *     inputSignature: string,
 *   }>,
 *   meta: Object,
 * }}
 */
export function rankLandingZones({ terrain, ephemeris, sites, mission, options } = {}) {
  const normalizedMission = normalizeMission(mission ?? {})
  const curatedSites = Array.isArray(sites) ? sites : []
  const zoneOptions = options ?? {}
  const detection = detectLandingZones(terrain, zoneOptions)
  const referenceRadiusM = terrainReferenceRadiusM(terrain)
  const cratersInfo = detectCraterHazards(terrain, normalizedMission, zoneOptions)
  const detectionOptions = normalizeZoneOptions(zoneOptions)
  const weights = normalizeLandingWeights(normalizedMission.weights ?? zoneOptions.weights)
  const ephemerisSiteIds = new Set()

  let dateSearchWindow = null
  const entries = detection.zones.map((zone) => {
    const zoneSite = landingZoneToSite(zone, { mastM: normalizedMission.mastM, source: 'zone' })
    const nearest = nearestCuratedSite(zone, curatedSites, referenceRadiusM)
    const ephemerisSource = nearest ? nearest.site : zoneSite
    const resolution = resolveEphemerisForSite(ephemeris, ephemerisSource)
    const ephemerisSiteId = nearest?.site.id ?? resolution.dataset?.siteId ?? null
    if (ephemerisSiteId) ephemerisSiteIds.add(ephemerisSiteId)

    // Optional mission-start date search (task-28): find the earliest feasible
    // start inside the ephemeris coverage and score the zone at that date.
    const dateSearchRequested = zoneOptions.searchDates === true || zoneOptions.dateSearch?.enabled === true
    let dateSearchResult = null
    if (dateSearchRequested && resolution.dataset) {
      dateSearchResult = searchFeasibleDate({
        terrain,
        zone: zoneSite,
        ephemeris: resolution.dataset,
        mission: normalizedMission,
        options: { ...(zoneOptions.dateSearch ?? {}), enabled: true },
      })
      if (dateSearchResult.searchWindow) dateSearchWindow = dateSearchResult.searchWindow
    }
    const effectiveMission = dateSearchResult?.hasFeasibleDate
      ? { ...normalizedMission, startTime: dateSearchResult.feasibleDate }
      : normalizedMission

    const metricsResult = computeLandingMetrics({
      terrain,
      zone,
      zones: detection.zones,
      ephemeris: resolution.dataset,
      site: zoneSite,
      mission: effectiveMission,
      nearestSite: nearest,
      craters: cratersInfo.craters,
      cratersAvailable: cratersInfo.cratersAvailable,
      options: {
        ...zoneOptions,
        maxSlopeDeg: zoneOptions.maxSlopeDeg ?? detection.meta.maxSlopeDeg,
      },
      ephemerisSiteId,
    })

    const warnings = [...metricsResult.warnings]
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
      ...metricsResult.reasons,
    ]

    return {
      zone,
      rank: null,
      siteId: zone.id,
      siteName: zone.name,
      site: zoneSite,
      score: metricsResult.score,
      rawScore: metricsResult.rawScore,
      scoreCapApplied: metricsResult.scoreCapApplied,
      feasible: metricsResult.feasible,
      feasibility: metricsResult.feasibility,
      grade: metricsResult.grade,
      gradeCode: metricsResult.gradeCode,
      confidence: metricsResult.confidence,
      components: metricsResult.components,
      metrics: metricsResult.metrics,
      reasons,
      warnings,
      ephemerisSiteId,
      nearestSiteId: nearest?.site.id ?? null,
      nearestSiteDistanceM: nearest ? round1(nearest.distanceM) : null,
      zoneLabel: null,
      // Date-search results (task-28). When a feasible date was found, score and
      // metrics above are evaluated at that mission start.
      feasibleDate: dateSearchResult?.hasFeasibleDate ? dateSearchResult.feasibleDate : null,
      feasibleDateScore: dateSearchResult?.hasFeasibleDate ? metricsResult.score : null,
      feasibleDatesSearched: dateSearchResult?.feasibleDatesSearched ?? 0,
      hasFeasibleDate: dateSearchResult?.hasFeasibleDate === true,
      missionStartUsed: effectiveMission.startTime ?? null,
      inputSignature: metricsResult.inputSignature,
    }
  })

  entries.sort((a, b) => {
    const aDated = a.hasFeasibleDate ? 0 : 1
    const bDated = b.hasFeasibleDate ? 0 : 1
    if (aDated !== bDated) return aDated - bDated
    return compareZoneEntries(a, b)
  })
  let rank = 0
  for (const entry of entries) {
    if (entry.score != null) {
      entry.rank = ++rank
      entry.zoneLabel = `Zone ${entry.rank}`
    }
  }

  // One run-wide signature: covers the terrain, the normalized mission, the
  // detection options and every ephemeris dataset actually used.
  const signature = computeInputSignature({
    terrain,
    mission: normalizedMission,
    ephemeris: {
      sites: [...ephemerisSiteIds].sort(),
      sampleCount: detection.zones.length > 0 ? (ephemeris && typeof ephemeris === 'object' && typeof ephemeris.samples?.length === 'number' ? ephemeris.samples.length : null) : null,
    },
    options: {
      ...detectionOptions,
      dateSearch: normalizeDateSearchOptions(zoneOptions.dateSearch ?? {}),
    },
  })
  for (const entry of entries) entry.inputSignature = signature

  const scoredEntries = entries.filter((entry) => entry.score != null)
  const feasibleEntries = entries.filter((entry) => entry.feasible === true)
  const undeterminedEntries = entries.filter((entry) => entry.feasibility?.status === 'undetermined')
  const infeasibleEntries = entries.filter(
    (entry) => entry.feasible !== true && entry.feasibility?.status !== 'undetermined',
  )
  return {
    zones: entries,
    meta: {
      terrainId: terrain?.id ?? null,
      terrainKind: detection.meta.terrainKind,
      syntheticTerrain: detection.meta.synthetic === true,
      zoneCount: entries.length,
      scoredCount: scoredEntries.length,
      // Hard feasibility gate summary (see docs/architecture.md).
      feasibleZones: feasibleEntries.length,
      infeasibleZones: infeasibleEntries.length,
      undeterminedZones: undeterminedEntries.length,
      hasFeasibleZones: feasibleEntries.length > 0,
      recommendedZoneId: feasibleEntries[0]?.zone?.id ?? null,
      rankingRule:
        zoneOptions.searchDates === true || zoneOptions.dateSearch?.enabled === true
          ? 'feasible-date-first-then-score'
          : 'feasible-first-then-score',
      dateSearch: (() => {
        const dated = entries.filter((entry) => entry.hasFeasibleDate)
        const requested = zoneOptions.searchDates === true || zoneOptions.dateSearch?.enabled === true
        const opts = normalizeDateSearchOptions(zoneOptions.dateSearch ?? {})
        const firstSearch = entries.find((entry) => entry.feasibleDatesSearched > 0)
        const windowInfo = firstSearch?.missionStartUsed ?? null
        void windowInfo
        return {
          enabled: requested,
          stepHours: opts.stepHours,
          evaluationStepSeconds: opts.evaluationStepSeconds,
          zonesSearched: requested ? entries.length : 0,
          zonesWithFeasibleDate: dated.length,
          zonesWithoutFeasibleDate: requested ? entries.length - dated.length : 0,
          totalCandidates: entries.reduce((total, entry) => total + (entry.feasibleDatesSearched ?? 0), 0),
          rangeStart: dateSearchWindow ? new Date(dateSearchWindow.startMs).toISOString() : null,
          rangeEnd: dateSearchWindow ? new Date(dateSearchWindow.endMs).toISOString() : null,
          noFeasibleDate: requested && dated.length === 0,
          message: requested ? (dated.length > 0 ? 'ok' : 'no-feasible-date') : 'disabled',
          searchWindow: dateSearchWindow,
        }
      })(),
      feasibility: {
        feasibleZones: feasibleEntries.length,
        infeasibleZones: infeasibleEntries.length,
        undeterminedZones: undeterminedEntries.length,
        hasFeasibleZones: feasibleEntries.length > 0,
        message: feasibleEntries.length > 0 ? 'ok' : 'no-feasible-zone',
      },
      detection: detection.meta,
      approximation: ZONE_EPHEMERIS_APPROXIMATION,
      ephemerisApproxMaxErrorDeg: 0.1,
      ephemerisMode: curatedSites.length > 0 ? 'nearest-curated-site' : 'unavailable',
      weights,
      modelVersion: LANDING_MODEL_VERSION,
      inputSignature: signature,
      inputs: {
        terrainId: terrain?.id ?? null,
        terrainWidth: terrain?.width ?? null,
        terrainHeight: terrain?.height ?? null,
        terrainSynthetic: terrain?.synthetic === true,
        missionStart: normalizedMission.startTime,
        missionDays: normalizedMission.missionDays,
        powerNeedW: normalizedMission.powerNeedW,
        batteryCapacityWh: normalizedMission.batteryCapacityWh,
        heaterMaxW: normalizedMission.heaterMaxW,
        thermalLimitsC: [normalizedMission.minOperatingTemperatureC, normalizedMission.maxOperatingTemperatureC],
        maxSlopeDeg: detectionOptions.maxSlopeDeg,
        minAreaKm2: detectionOptions.minAreaKm2,
        maxZones: detectionOptions.maxZones,
        ephemerisSiteIds: [...ephemerisSiteIds].sort(),
      },
      mission: {
        missionDays: normalizedMission.missionDays,
        powerNeedW: normalizedMission.powerNeedW,
        sunDaysNeeded: normalizedMission.sunDaysNeeded,
        relayInOrbit: normalizedMission.relayInOrbit,
        startTime: normalizedMission.startTime,
        batteryCapacityWh: normalizedMission.batteryCapacityWh,
        heaterMaxW: normalizedMission.heaterMaxW,
        minOperatingTemperatureC: normalizedMission.minOperatingTemperatureC,
        maxOperatingTemperatureC: normalizedMission.maxOperatingTemperatureC,
        landingEllipseRadiusM: normalizedMission.landingEllipseRadiusM,
      },
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
