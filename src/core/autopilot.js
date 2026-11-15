/**
 * Autopilot: score and rank candidate landing sites for a mission profile.
 *
 * The score is a transparent weighted combination of five components, each in
 * `0..100`, computed from the scientific core (terrain + ray-traced horizon,
 * precomputed Sun/Earth ephemeris, solar power and communications models):
 *
 * | Component | Weight | What it measures |
 * | --- | --- | --- |
 * | Sun | 0.30 | continuous Sun window vs `sunDaysNeeded`, plus sunlight abundance |
 * | Power | 0.20 | average solar power vs `powerNeedW` |
 * | Comms | 0.25 | Earth line-of-sight (or relay) availability, data budget, mast help |
 * | Terrain | 0.15 | slope/roughness inside the perimeter (landing safety) |
 * | Logistics | 0.10 | site perimeter and mast vs the mission requirements |
 *
 * Every score carries human-readable `reasons` (`{ code, params, severity, text }`):
 * `text` is English, `code` is a stable i18n-friendly identifier and `params`
 * carries the numbers so the UI can translate without re-deriving anything.
 * Missing data never throws: the score is reduced and flagged through
 * `warnings` and `confidence`.
 *
 * @module core/autopilot
 */

import { clamp } from './geometry.js'
import { areaStatistics, isInsideTerrain } from './terrain.js'
import { horizonProfile as buildHorizonProfile } from './engine.js'
import { normalizeEphemerisDataset, visibilityStatistics } from './ephemeris.js'
import {
  DEFAULT_POWER_MODEL,
  missionWindow,
  normalizePowerModel,
  solarPowerEstimate,
} from './power.js'
import {
  DEFAULT_COMMS_MODEL,
  commWindows,
  dataBudget,
  normalizeCommsModel,
} from './comms.js'

/** Default thermal/energy model (simple, documented surface energy balance). */
export const DEFAULT_THERMAL_MODEL = Object.freeze({
  albedo: 0.12,
  emissivity: 0.95,
  solarConstantWm2: 1361,
  nightTemperatureC: -180,
  psrTemperatureC: -200,
  minOperatingC: -40,
  maxOperatingC: 50,
  heaterWPerK: 2,
  heaterMaxW: 400,
})

/** Default mission profile (see docs/architecture.md). */
export const DEFAULT_MISSION = Object.freeze({
  missionDays: 14,
  powerNeedW: 120,
  relayInOrbit: false,
  sunDaysNeeded: 10,
  perimeterM: 200,
  mastM: 10,
  startTime: null,
  dataNeedMb: null,
  stepSeconds: 300,
  profileStepDeg: 1,
  power: DEFAULT_POWER_MODEL,
  comms: DEFAULT_COMMS_MODEL,
  // Mission-feasibility fields added for the landing-zone autopilot (optional,
  // backward compatible: older mission objects simply get these defaults).
  // Documented default battery class for this lander (40 kWh). Missions can
  // override it; when the value is not specified the default is used and the
  // feasibility gate reports `feasibility.batteryNotSpecified` as a warning.
  batteryCapacityWh: 40000,
  batteryRoundTripEfficiency: 0.9,
  batteryDepthOfDischarge: 0.8,
  heaterMaxW: DEFAULT_THERMAL_MODEL.heaterMaxW,
  heaterWPerK: DEFAULT_THERMAL_MODEL.heaterWPerK,
  minOperatingTemperatureC: DEFAULT_THERMAL_MODEL.minOperatingC,
  maxOperatingTemperatureC: DEFAULT_THERMAL_MODEL.maxOperatingC,
  landingEllipseRadiusM: 500,
  craterHazardMinDiameterM: 500,
  craterHazardReachM: 5000,
  scienceReachM: 5000,
  thermal: DEFAULT_THERMAL_MODEL,
  weights: null,
  // Power source: 'solar' (default, eclipse/battery/continuous-sun gated) or
  // 'rtg' (constant power, unaffected by eclipses; needs rtgPowerW).
  powerSource: 'solar',
  rtgPowerW: null,
})

/** Component weights, summing to 1. */
export const SCORE_WEIGHTS = Object.freeze({
  sun: 0.3,
  power: 0.2,
  comms: 0.25,
  terrain: 0.15,
  logistics: 0.1,
})

/** Grade thresholds (inclusive lower bound) for the total score. */
export const SCORE_GRADES = Object.freeze([
  { grade: 'excellent', min: 80, code: 'grade.excellent' },
  { grade: 'good', min: 65, code: 'grade.good' },
  { grade: 'fair', min: 45, code: 'grade.fair' },
  { grade: 'poor', min: 0, code: 'grade.poor' },
])

/**
 * Merge a partial mission profile with the defaults.
 *
 * @param {Object} [mission] Partial mission profile.
 * @returns {Object} Normalized mission profile.
 */
export function normalizeMission(mission = {}) {
  const merged = { ...DEFAULT_MISSION, ...(mission && typeof mission === 'object' ? mission : {}) }
  // The UI mission profile uses flat fields (`panelAreaM2`, `bitrateMbps`);
  // accept them alongside the nested `power`/`comms` objects the core documents.
  const powerOverrides = {}
  if (Number.isFinite(Number(merged.panelAreaM2))) powerOverrides.panelAreaM2 = Number(merged.panelAreaM2)
  if (Number.isFinite(Number(merged.panelEfficiency))) {
    powerOverrides.panelEfficiency = Number(merged.panelEfficiency)
  }
  Object.assign(powerOverrides, (mission && typeof mission === 'object' ? mission.power : null) ?? {})
  const commsOverrides = {}
  if (Number.isFinite(Number(merged.bitrateMbps))) commsOverrides.dataRateMbps = Number(merged.bitrateMbps)
  Object.assign(commsOverrides, (mission && typeof mission === 'object' ? mission.comms : null) ?? {})

  // Thermal model: nested `mission.thermal` plus documented flat aliases.
  const thermalOverrides = { ...DEFAULT_THERMAL_MODEL, ...(mission?.thermal ?? {}) }
  for (const [flat, nested] of [
    ['albedo', 'albedo'],
    ['emissivity', 'emissivity'],
    ['solarConstantWm2', 'solarConstantWm2'],
    ['nightTemperatureC', 'nightTemperatureC'],
    ['psrTemperatureC', 'psrTemperatureC'],
  ]) {
    if (Number.isFinite(Number(merged[flat]))) thermalOverrides[nested] = Number(merged[flat])
  }
  const minOperatingC = Number.isFinite(Number(merged.minOperatingTemperatureC))
    ? Number(merged.minOperatingTemperatureC)
    : Number(thermalOverrides.minOperatingC)
  const maxOperatingC = Number.isFinite(Number(merged.maxOperatingTemperatureC))
    ? Number(merged.maxOperatingTemperatureC)
    : Number(thermalOverrides.maxOperatingC)
  const heaterWPerK = Number.isFinite(Number(merged.heaterWPerK))
    ? Number(merged.heaterWPerK)
    : Number(thermalOverrides.heaterWPerK)
  const heaterMaxW = Number.isFinite(Number(merged.heaterMaxW))
    ? Number(merged.heaterMaxW)
    : Number(thermalOverrides.heaterMaxW)
  const thermal = {
    albedo: clamp(Number(thermalOverrides.albedo) || 0, 0, 1),
    emissivity: clamp(Number(thermalOverrides.emissivity) || 0.95, 0.01, 1),
    solarConstantWm2: Math.max(0, Number(thermalOverrides.solarConstantWm2) || DEFAULT_THERMAL_MODEL.solarConstantWm2),
    nightTemperatureC: clamp(Number(thermalOverrides.nightTemperatureC) || -180, -273, 200),
    psrTemperatureC: clamp(Number(thermalOverrides.psrTemperatureC) || -200, -273, 200),
    minOperatingC: clamp(Number.isFinite(minOperatingC) ? minOperatingC : -40, -273, 200),
    maxOperatingC: clamp(Number.isFinite(maxOperatingC) ? maxOperatingC : 50, -273, 400),
    heaterWPerK: Math.max(0, Number.isFinite(heaterWPerK) ? heaterWPerK : 2),
    heaterMaxW: Math.max(0, Number.isFinite(heaterMaxW) ? heaterMaxW : 400),
  }
  const missionInput = mission && typeof mission === 'object' ? mission : {}
  // Idempotent normalisation: an already-normalized mission carries
  // `batterySpecified`, which must survive re-normalisation (otherwise the
  // documented default battery would look like a user-specified value).
  const batterySpecified =
    missionInput.batterySpecified === true
      ? true
      : missionInput.batterySpecified === false
        ? false
        : missionInput.batteryCapacityWh != null && Number.isFinite(Number(missionInput.batteryCapacityWh))
  const batteryCapacityWh = batterySpecified
    ? Math.max(0, Number(missionInput.batteryCapacityWh))
    : DEFAULT_MISSION.batteryCapacityWh
  const powerSource = missionInput.powerSource === 'rtg' ? 'rtg' : 'solar'
  const rtgPowerW = Number.isFinite(Number(missionInput.rtgPowerW))
    ? Math.max(0, Number(missionInput.rtgPowerW))
    : null
  return {
    missionDays: clamp(Number(merged.missionDays) || DEFAULT_MISSION.missionDays, 1 / 24, 365),
    powerNeedW: Math.max(0, Number(merged.powerNeedW) || 0),
    relayInOrbit: merged.relayInOrbit === true,
    sunDaysNeeded: Math.max(0, Number(merged.sunDaysNeeded) || 0),
    perimeterM: Math.max(0, Number(merged.perimeterM) || 0),
    mastM: Math.max(0, Number(merged.mastM) || 0),
    startTime: merged.startTime ?? null,
    dataNeedMb:
      merged.dataNeedMb != null && Number.isFinite(Number(merged.dataNeedMb))
        ? Number(merged.dataNeedMb)
        : null,
    stepSeconds: Math.max(10, Number(merged.stepSeconds) || DEFAULT_MISSION.stepSeconds),
    profileStepDeg: Math.max(0.25, Number(merged.profileStepDeg) || 1),
    power: normalizePowerModel(powerOverrides),
    comms: normalizeCommsModel(commsOverrides),
    batteryCapacityWh,
    batterySpecified,
    powerSource,
    rtgPowerW,
    batteryRoundTripEfficiency: clamp(Number(merged.batteryRoundTripEfficiency) || 0.9, 0.1, 1),
    batteryDepthOfDischarge: clamp(Number(merged.batteryDepthOfDischarge) || 0.8, 0.05, 1),
    heaterMaxW: thermal.heaterMaxW,
    heaterWPerK: thermal.heaterWPerK,
    minOperatingTemperatureC: thermal.minOperatingC,
    maxOperatingTemperatureC: thermal.maxOperatingC,
    landingEllipseRadiusM: Math.max(1, Number(merged.landingEllipseRadiusM) || 500),
    craterHazardMinDiameterM: Math.max(0, Number(merged.craterHazardMinDiameterM) || 500),
    craterHazardReachM: Math.max(0, Number(merged.craterHazardReachM) || 5000),
    scienceReachM: Math.max(0, Number(merged.scienceReachM) || 5000),
    thermal,
    weights: merged.weights && typeof merged.weights === 'object' ? merged.weights : null,
  }
}

/**
 * Resolve the ephemeris dataset that applies to a site.
 *
 * Accepted forms: a single dataset (applied to every site — flagged as shared),
 * a `Map` keyed by site id, a plain object keyed by site id, an array of
 * datasets matched by `siteId`, or a function `(site) => dataset`.
 *
 * @param {*} ephemeris Ephemeris input.
 * @param {{id?: string}} site Site.
 * @returns {{dataset: Object|null, shared: boolean}}
 */
export function resolveEphemerisForSite(ephemeris, site) {
  if (!ephemeris) return { dataset: null, shared: false }
  if (typeof ephemeris === 'function') {
    const resolved = ephemeris(site)
    return { dataset: resolved ? normalizeEphemerisDataset(resolved, { siteId: site?.id }) : null, shared: false }
  }
  if (ephemeris instanceof Map) {
    const resolved = ephemeris.get(site?.id)
    return { dataset: resolved ? normalizeEphemerisDataset(resolved, { siteId: site?.id }) : null, shared: false }
  }
  if (Array.isArray(ephemeris)) {
    if (ephemeris.length === 0) return { dataset: null, shared: false }
    if (Array.isArray(ephemeris[0]?.samples) || ephemeris[0]?.time) {
      // Array of samples, not of datasets.
      return { dataset: normalizeEphemerisDataset(ephemeris), shared: true }
    }
    const match = ephemeris.find((candidate) => candidate?.siteId === site?.id)
    return { dataset: match ? normalizeEphemerisDataset(match, { siteId: site?.id }) : null, shared: false }
  }
  if (typeof ephemeris === 'object') {
    if (Array.isArray(ephemeris.samples)) {
      return { dataset: normalizeEphemerisDataset(ephemeris, { siteId: site?.id }), shared: true }
    }
    const byId = ephemeris[site?.id]
    if (byId) return { dataset: normalizeEphemerisDataset(byId, { siteId: site?.id }), shared: false }
    const catalog = ephemeris.sites ?? ephemeris.ephemeris ?? ephemeris.datasets
    if (catalog && typeof catalog === 'object') {
      const resolved = catalog[site?.id]
      if (resolved) return { dataset: normalizeEphemerisDataset(resolved, { siteId: site?.id }), shared: false }
    }
  }
  return { dataset: null, shared: false }
}

/**
 * Resolve the terrain grid that covers a site.
 *
 * Accepted forms: a single terrain (used for every site), an array of terrains
 * (the first one containing the site is used — pass them high-resolution
 * first), a `Map` keyed by site id, or a function `(site) => terrain`.
 *
 * @param {*} terrain Terrain input.
 * @param {{id?: string, lat: number, lon: number}} site Site.
 * @returns {{terrain: Object|null, outside: boolean}}
 */
export function resolveTerrainForSite(terrain, site) {
  if (!terrain) return { terrain: null, outside: false }
  if (typeof terrain === 'function') {
    const resolved = terrain(site)
    return { terrain: resolved ?? null, outside: false }
  }
  if (terrain instanceof Map) {
    const resolved = terrain.get(site?.id) ?? null
    if (resolved) return { terrain: resolved, outside: false }
    for (const candidate of terrain.values()) {
      if (candidate && isInsideTerrain(candidate, site.lat, site.lon)) {
        return { terrain: candidate, outside: false }
      }
    }
    return { terrain: null, outside: false }
  }
  if (Array.isArray(terrain)) {
    for (const candidate of terrain) {
      if (candidate && isInsideTerrain(candidate, site.lat, site.lon)) {
        return { terrain: candidate, outside: false }
      }
    }
    return { terrain: null, outside: false }
  }
  if (typeof terrain === 'object' && terrain.data) {
    return { terrain, outside: !isInsideTerrain(terrain, site.lat, site.lon) }
  }
  return { terrain: null, outside: false }
}

/**
 * Normalize a site entry so scoring works with partial POI records.
 *
 * @param {Object} site Raw site.
 * @returns {{id: string, name: string, lat: number, lon: number, elevationM: number|null, perimeterM: number|null, mastM: number|null, source: string}}
 */
export function normalizeSiteForScoring(site) {
  const id = String(site?.id ?? site?.name ?? 'site')
  const lat = Number(site?.lat)
  const lon = Number(site?.lon)
  return {
    ...site,
    id,
    name: String(site?.name ?? id),
    lat,
    lon,
    elevationM: Number.isFinite(Number(site?.elevationM)) ? Number(site.elevationM) : null,
    perimeterM: Number.isFinite(Number(site?.perimeterM)) ? Number(site.perimeterM) : null,
    mastM: Number.isFinite(Number(site?.mastM)) ? Number(site.mastM) : null,
    source: String(site?.source ?? 'poi'),
  }
}

/**
 * Build a reason record.
 *
 * @param {string} code Stable reason identifier (i18n-friendly).
 * @param {'good'|'warn'|'bad'} severity Reason severity.
 * @param {Object} params Numeric/value parameters for translation.
 * @param {string} text English human-readable text.
 * @returns {{code: string, severity: 'good'|'warn'|'bad', params: Object, text: string}}
 */
function reason(code, severity, params, text) {
  return { code, severity, params, text }
}

/**
 * Choose a grade descriptor for a total score.
 *
 * @param {number} score Total score in `0..100`.
 * @returns {{grade: string, code: string}}
 */
export function gradeForScore(score) {
  const entry = SCORE_GRADES.find((candidate) => score >= candidate.min) ?? SCORE_GRADES[SCORE_GRADES.length - 1]
  return { grade: entry.grade, code: entry.code }
}

/**
 * Score one candidate site for a mission profile.
 *
 * @param {{
 *   site: Object,
 *   terrain: *,
 *   ephemeris: *,
 *   mission?: Object,
 * }} input
 * @returns {Object} `SiteScore` with components, metrics, reasons and warnings.
 */
export function scoreSite({ site, terrain, ephemeris, mission } = {}) {
  const normalizedSite = normalizeSiteForScoring(site)
  if (!Number.isFinite(normalizedSite.lat) || !Number.isFinite(normalizedSite.lon)) {
    throw new TypeError('scoreSite requires a site with finite lat/lon')
  }
  const normalizedMission = normalizeMission(mission)
  const { dataset, shared } = resolveEphemerisForSite(ephemeris, normalizedSite)
  const resolvedTerrain = resolveTerrainForSite(terrain, normalizedSite)
  // A site outside every DEM must not be scored as if it had a clear horizon:
  // treat it as "no terrain" (reduced confidence) instead of an optimistic -90°
  // horizon. The warning below explains why the score is degraded.
  const terrainGrid = resolvedTerrain.outside ? null : resolvedTerrain.terrain

  const warnings = []
  if (resolvedTerrain.outside) {
    warnings.push({
      code: 'data.terrainOutside',
      text: 'The site is outside the coverage of the available DEM; horizon results are unreliable.',
    })
  } else if (!resolvedTerrain.terrain) {
    warnings.push({
      code: 'data.terrainMissing',
      text: 'No DEM covers this site; terrain-dependent metrics are unavailable.',
    })
  } else if (terrainGrid.synthetic) {
    warnings.push({
      code: 'data.syntheticTerrain',
      text: 'A synthetic fallback terrain is in use; results are approximate and not real NASA data.',
    })
  }
  if (!dataset) {
    warnings.push({
      code: 'data.ephemerisMissing',
      text: 'No precomputed ephemeris is available for this site; Sun/Earth metrics are unavailable.',
    })
  } else if (shared) {
    warnings.push({
      code: 'data.sharedEphemeris',
      text: 'A single ephemeris dataset is shared by all sites; topocentric differences between sites are ignored.',
    })
  }

  const profile = terrainGrid
    ? buildHorizonProfile(terrainGrid, normalizedSite, { stepDeg: normalizedMission.profileStepDeg })
    : null

  let window = null
  let sunStats = null
  let earthStats = null
  let power = null
  let commWindowsList = []
  let budget = null

  if (dataset) {
    window = missionWindow(dataset, {
      missionDays: normalizedMission.missionDays,
      startTime: normalizedMission.startTime,
    })
    if (window.clamped) {
      warnings.push({
        code: 'data.windowClamped',
        text: 'The requested mission window extends beyond the ephemeris coverage and was clipped to the available data.',
      })
    }
    const resolvedMission = {
      ...normalizedMission,
      startTime: new Date(window.startMs).toISOString(),
      missionDays: window.days,
    }
    sunStats = visibilityStatistics(dataset, normalizedSite, terrainGrid, 'sun', window.startMs, window.endMs, {
      profile,
    })
    earthStats = visibilityStatistics(dataset, normalizedSite, terrainGrid, 'earth', window.startMs, window.endMs, {
      profile,
      limbRadiusDeg: normalizedMission.comms.earthLimbRadiusDeg,
    })
    power = solarPowerEstimate(normalizedSite, terrainGrid, dataset, resolvedMission)
    commWindowsList = commWindows(normalizedSite, terrainGrid, dataset, resolvedMission, window.startMs, window.endMs)
    budget = dataBudget(commWindowsList, resolvedMission)
  } else {
    // Without an ephemeris we cannot know the Sun/Earth geometry; keep the
    // structure complete but zero the dependent metrics.
    sunStats = {
      windows: [],
      visibleSeconds: 0,
      totalSeconds: 0,
      fraction: 0,
      longestWindowSeconds: 0,
      longestWindow: null,
      longestWindowDays: 0,
    }
    earthStats = { ...sunStats }
    power = solarPowerEstimate(normalizedSite, terrainGrid, null, normalizedMission)
    commWindowsList = []
    budget = dataBudget([], normalizedMission)
  }

  const terrainStats = terrainGrid
    ? areaStatistics(terrainGrid, normalizedSite, { radiusM: normalizedMission.perimeterM })
    : null

  // --- Sun component -------------------------------------------------------
  const sunDaysNeeded = normalizedMission.sunDaysNeeded
  const consecutiveFactor =
    sunDaysNeeded > 0 ? clamp(sunStats.longestWindowDays / sunDaysNeeded, 0, 1) : 1
  const abundanceFactor = clamp(sunStats.fraction / 0.5, 0, 1)
  const sunScore = 100 * (0.7 * consecutiveFactor + 0.3 * abundanceFactor)

  // --- Power component -----------------------------------------------------
  const powerRatio =
    normalizedMission.powerNeedW > 0 ? power.averageW / normalizedMission.powerNeedW : power.averageW > 0 ? 1.5 : 0
  const powerScore = 100 * clamp(powerRatio / 1.5, 0, 1)

  // --- Communications component -------------------------------------------
  const commsModel = normalizedMission.comms
  const directFraction = earthStats.fraction
  const relayCoverage = commsModel.relayCoverage
  const effectiveFraction = normalizedMission.relayInOrbit
    ? Math.max(directFraction, relayCoverage)
    : directFraction
  const mastM = normalizedMission.mastM > 0 ? normalizedMission.mastM : normalizedSite.mastM ?? 0
  // 80% availability already counts as excellent direct-to-Earth coverage at the
  // lunar south pole; the mast factor rewards antennas raised above the surface.
  const fractionScore = clamp(effectiveFraction / 0.8, 0, 1)
  const dataScore =
    normalizedMission.dataNeedMb != null && normalizedMission.dataNeedMb > 0
      ? clamp(budget.estimatedMb / normalizedMission.dataNeedMb, 0, 1)
      : fractionScore
  const antennaMastFactor = clamp(mastM / 10, 0, 1)
  const commsScore = 100 * clamp(0.6 * fractionScore + 0.3 * dataScore + 0.1 * antennaMastFactor, 0, 1)

  // --- Terrain component ---------------------------------------------------
  let terrainScore = 0
  if (terrainStats) {
    const slopeScore = clamp(1 - terrainStats.meanSlopeDeg / 12, 0, 1)
    const maxSlopeScore = clamp(1 - terrainStats.maxSlopeDeg / 25, 0, 1)
    const roughnessScore = clamp(1 - terrainStats.elevationStdM / 150, 0, 1)
    terrainScore = 100 * (0.5 * slopeScore + 0.3 * maxSlopeScore + 0.2 * roughnessScore)
  }

  // --- Logistics component -------------------------------------------------
  const sitePerimeter = normalizedSite.perimeterM ?? normalizedMission.perimeterM
  const siteMast = normalizedSite.mastM ?? normalizedMission.mastM
  const perimeterFactor =
    normalizedMission.perimeterM > 0 ? clamp(sitePerimeter / normalizedMission.perimeterM, 0, 1) : 1
  const mastFactor = normalizedMission.mastM > 0 ? clamp(siteMast / normalizedMission.mastM, 0, 1) : 1
  const logisticsScore = 100 * (0.6 * perimeterFactor + 0.4 * mastFactor)

  const components = {
    sun: round1(sunScore),
    power: round1(powerScore),
    comms: round1(commsScore),
    terrain: round1(terrainScore),
    logistics: round1(logisticsScore),
  }
  const weighted =
    components.sun * SCORE_WEIGHTS.sun +
    components.power * SCORE_WEIGHTS.power +
    components.comms * SCORE_WEIGHTS.comms +
    components.terrain * SCORE_WEIGHTS.terrain +
    components.logistics * SCORE_WEIGHTS.logistics

  let confidence = 1
  if (!dataset) confidence -= 0.5
  if (!terrainGrid) confidence -= 0.3
  if (resolvedTerrain.outside) confidence -= 0.2
  if (shared) confidence -= 0.1
  if (window?.clamped) confidence -= 0.05
  confidence = clamp(confidence, 0, 1)

  const score = round1(clamp(weighted, 0, 100))
  const { grade, code: gradeCode } = gradeForScore(score)

  const reasons = buildReasons({
    normalizedSite,
    normalizedMission,
    sunStats,
    earthStats,
    power,
    budget,
    terrainStats,
    mastM,
    sunDaysNeeded,
    effectiveFraction,
    directFraction,
  })

  return {
    siteId: normalizedSite.id,
    siteName: normalizedSite.name,
    site: normalizedSite,
    score,
    grade,
    gradeCode,
    confidence: round2(confidence),
    components,
    metrics: {
      sunlitFraction: round4(sunStats.fraction),
      sunlitDays: round2(sunStats.visibleSeconds / 86400),
      longestSunWindowDays: round2(sunStats.longestWindowDays),
      sunDaysNeeded,
      averageW: round2(power.averageW),
      peakW: round2(power.peakW),
      dailyWh: round2(power.dailyWh),
      powerNeedW: normalizedMission.powerNeedW,
      powerMarginW: round2(power.averageW - normalizedMission.powerNeedW),
      earthVisibleFraction: round4(directFraction),
      effectiveCommsFraction: round4(effectiveFraction),
      relayInOrbit: normalizedMission.relayInOrbit,
      commHours: round2(budget.totalHours),
      commWindows: budget.windowCount,
      estimatedMb: round2(budget.estimatedMb),
      dataNeedMb: normalizedMission.dataNeedMb,
      meetsDataNeed: budget.meetsDataNeed,
      meanSlopeDeg: terrainStats ? round2(terrainStats.meanSlopeDeg) : null,
      maxSlopeDeg: terrainStats ? round2(terrainStats.maxSlopeDeg) : null,
      meanElevationM: terrainStats ? round1(terrainStats.meanElevationM) : null,
      elevationRangeM: terrainStats ? round1(terrainStats.elevationRangeM) : null,
      perimeterM: normalizedSite.perimeterM,
      mastM: normalizedSite.mastM,
      missionDays: round2(window ? window.days : 0),
      windowStart: window ? new Date(window.startMs).toISOString() : null,
      windowEnd: window ? new Date(window.endMs).toISOString() : null,
      terrainId: terrainGrid?.id ?? null,
      syntheticTerrain: terrainGrid?.synthetic === true,
      ephemerisSiteId: dataset?.siteId ?? null,
    },
    reasons,
    warnings,
    window: window
      ? {
          start: new Date(window.startMs).toISOString(),
          end: new Date(window.endMs).toISOString(),
          days: round2(window.days),
          clamped: window.clamped,
        }
      : null,
    commWindows: commWindowsList,
  }
}

/**
 * Build the human-readable reasons for a score.
 *
 * @param {Object} context Scoring inputs/metrics.
 * @returns {Array<{code: string, severity: string, params: Object, text: string}>}
 */
function buildReasons(context) {
  const {
    normalizedMission,
    sunStats,
    earthStats,
    power,
    budget,
    terrainStats,
    mastM,
    sunDaysNeeded,
    effectiveFraction,
    directFraction,
  } = context
  const reasons = []

  // Sun
  if (sunDaysNeeded > 0) {
    if (sunStats.longestWindowDays >= sunDaysNeeded) {
      reasons.push(
        reason(
          'sun.continuous',
          'good',
          { days: round2(sunStats.longestWindowDays), needed: sunDaysNeeded },
          `Continuous sunlight for ${round2(sunStats.longestWindowDays)} days covers the ${sunDaysNeeded}-day requirement.`,
        ),
      )
    } else if (sunStats.longestWindowDays >= sunDaysNeeded * 0.6) {
      reasons.push(
        reason(
          'sun.continuousShort',
          'warn',
          { days: round2(sunStats.longestWindowDays), needed: sunDaysNeeded },
          `Longest continuous sunlight window is ${round2(sunStats.longestWindowDays)} days, below the ${sunDaysNeeded}-day requirement.`,
        ),
      )
    } else {
      reasons.push(
        reason(
          'sun.continuousInsufficient',
          'bad',
          { days: round2(sunStats.longestWindowDays), needed: sunDaysNeeded },
          `Only ${round2(sunStats.longestWindowDays)} days of continuous sunlight versus ${sunDaysNeeded} required.`,
        ),
      )
    }
  }
  if (sunStats.fraction >= 0.5) {
    reasons.push(
      reason(
        'sun.abundant',
        'good',
        { fraction: round4(sunStats.fraction) },
        `${round1(sunStats.fraction * 100)}% of the mission window is sunlit.`,
      ),
    )
  } else if (sunStats.fraction >= 0.25) {
    reasons.push(
      reason(
        'sun.moderate',
        'warn',
        { fraction: round4(sunStats.fraction) },
        `${round1(sunStats.fraction * 100)}% of the mission window is sunlit.`,
      ),
    )
  } else {
    reasons.push(
      reason(
        'sun.scarce',
        'bad',
        { fraction: round4(sunStats.fraction) },
        `Only ${round1(sunStats.fraction * 100)}% of the mission window is sunlit.`,
      ),
    )
  }

  // Power
  if (normalizedMission.powerNeedW > 0) {
    const marginW = power.averageW - normalizedMission.powerNeedW
    const params = { averageW: round1(power.averageW), needW: normalizedMission.powerNeedW, marginW: round1(marginW) }
    if (marginW >= 0) {
      reasons.push(
        reason(
          'power.margin',
          'good',
          params,
          `Average solar output ${round1(power.averageW)} W covers the ${round1(normalizedMission.powerNeedW)} W need (margin ${round1(marginW)} W).`,
        ),
      )
    } else if (marginW >= -0.25 * normalizedMission.powerNeedW) {
      reasons.push(
        reason(
          'power.tight',
          'warn',
          params,
          `Average solar output ${round1(power.averageW)} W is slightly below the ${round1(normalizedMission.powerNeedW)} W need.`,
        ),
      )
    } else {
      reasons.push(
        reason(
          'power.shortfall',
          'bad',
          params,
          `Average solar output ${round1(power.averageW)} W falls short of the ${round1(normalizedMission.powerNeedW)} W need.`,
        ),
      )
    }
  }

  // Communications
  if (normalizedMission.relayInOrbit) {
    reasons.push(
      reason(
        'comms.relay',
        effectiveFraction >= 0.75 ? 'good' : 'warn',
        { fraction: round4(effectiveFraction), coverage: round4(effectiveFraction) },
        `Relay-in-orbit provides ${round1(effectiveFraction * 100)}% communications availability.`,
      ),
    )
  } else {
    if (directFraction >= 0.4) {
      reasons.push(
        reason(
          'comms.directGood',
          'good',
          { fraction: round4(directFraction) },
          `Direct Earth line of sight is available ${round1(directFraction * 100)}% of the mission window.`,
        ),
      )
    } else if (directFraction >= 0.15) {
      reasons.push(
        reason(
          'comms.directLimited',
          'warn',
          { fraction: round4(directFraction) },
          `Direct Earth line of sight is limited to ${round1(directFraction * 100)}% of the mission window.`,
        ),
      )
    } else {
      reasons.push(
        reason(
          'comms.directPoor',
          'bad',
          { fraction: round4(directFraction) },
          `Direct Earth line of sight is available only ${round1(directFraction * 100)}% of the mission window.`,
        ),
      )
    }
  }
  if (normalizedMission.dataNeedMb != null && normalizedMission.dataNeedMb > 0) {
    const params = { estimatedMb: round1(budget.estimatedMb), needMb: normalizedMission.dataNeedMb }
    if (budget.estimatedMb >= normalizedMission.dataNeedMb) {
      reasons.push(
        reason(
          'comms.dataCovered',
          'good',
          params,
          `Estimated ${round1(budget.estimatedMb)} Mb of downlink covers the ${round1(normalizedMission.dataNeedMb)} Mb data need.`,
        ),
      )
    } else {
      reasons.push(
        reason(
          'comms.dataShort',
          'bad',
          params,
          `Estimated ${round1(budget.estimatedMb)} Mb of downlink is below the ${round1(normalizedMission.dataNeedMb)} Mb data need.`,
        ),
      )
    }
  }
  if (mastM > 0) {
    reasons.push(
      reason(
        'comms.mast',
        'good',
        { mastM: round1(mastM) },
        `A ${round1(mastM)} m antenna mast improves clearance of the low Earth elevation.`,
      ),
    )
  } else {
    reasons.push(
      reason(
        'comms.noMast',
        'warn',
        {},
        'No antenna mast: the antenna sits at ground level with a very low Earth elevation.',
      ),
    )
  }

  // Terrain
  if (terrainStats) {
    const params = {
      meanSlopeDeg: round2(terrainStats.meanSlopeDeg),
      maxSlopeDeg: round2(terrainStats.maxSlopeDeg),
      elevationRangeM: round1(terrainStats.elevationRangeM),
      roughnessM: round1(terrainStats.elevationStdM),
    }
    if (terrainStats.meanSlopeDeg <= 3) {
      reasons.push(
        reason(
          'terrain.flat',
          'good',
          params,
          `Landing area is flat (mean slope ${round2(terrainStats.meanSlopeDeg)}°).`,
        ),
      )
    } else if (terrainStats.meanSlopeDeg <= 8) {
      reasons.push(
        reason(
          'terrain.sloped',
          'warn',
          params,
          `Landing area is moderately sloped (mean slope ${round2(terrainStats.meanSlopeDeg)}°).`,
        ),
      )
    } else {
      reasons.push(
        reason(
          'terrain.steep',
          'bad',
          params,
          `Landing area is steep (mean slope ${round2(terrainStats.meanSlopeDeg)}°).`,
        ),
      )
    }
    if (terrainStats.elevationStdM > 120) {
      reasons.push(
        reason(
          'terrain.rough',
          'warn',
          params,
          `Rough terrain inside the perimeter (elevation spread ${round1(terrainStats.elevationRangeM)} m).`,
        ),
      )
    }
  }

  // Logistics
  if (normalizedMission.perimeterM > 0) {
    const sitePerimeter = context.normalizedSite.perimeterM ?? normalizedMission.perimeterM
    const ratio = clamp(sitePerimeter / normalizedMission.perimeterM, 0, 1)
    reasons.push(
      reason(
        ratio >= 1 ? 'logistics.perimeterOk' : 'logistics.perimeterTight',
        ratio >= 1 ? 'good' : 'warn',
        { perimeterM: sitePerimeter, requiredM: normalizedMission.perimeterM },
        ratio >= 1
          ? `Available perimeter of ${round1(sitePerimeter)} m meets the ${round1(normalizedMission.perimeterM)} m requirement.`
          : `Available perimeter of ${round1(sitePerimeter)} m is below the ${round1(normalizedMission.perimeterM)} m requirement.`,
      ),
    )
  }

  return reasons
}

/**
 * Score and rank candidate sites.
 *
 * @param {{
 *   sites: Array<Object>,
 *   terrain: *,
 *   ephemeris: *,
 *   mission?: Object,
 * }} input
 * @returns {Array<Object>} Scores sorted best-first with a `rank` field
 *   (`null` for entries that failed to score).
 */
export function rankSites({ sites, terrain, ephemeris, mission } = {}) {
  const list = Array.isArray(sites) ? sites : []
  const normalizedMission = normalizeMission(mission)
  const scores = []

  for (const site of list) {
    try {
      scores.push({
        ...scoreSite({ site, terrain, ephemeris, mission: normalizedMission }),
        rank: null,
      })
    } catch (error) {
      scores.push({
        siteId: String(site?.id ?? site?.name ?? 'site'),
        siteName: String(site?.name ?? site?.id ?? 'site'),
        site: normalizeSiteForScoring(site),
        score: null,
        grade: 'unknown',
        gradeCode: 'grade.unknown',
        confidence: 0,
        components: { sun: 0, power: 0, comms: 0, terrain: 0, logistics: 0 },
        metrics: {},
        reasons: [
          reason(
            'error.scoring',
            'bad',
            { message: error instanceof Error ? error.message : String(error) },
            'This site could not be scored because of a data error.',
          ),
        ],
        warnings: [{ code: 'error.scoring', text: error instanceof Error ? error.message : String(error) }],
        error: error instanceof Error ? error.message : String(error),
        window: null,
        commWindows: [],
        rank: null,
      })
    }
  }

  scores.sort((a, b) => {
    if (a.score == null && b.score == null) return 0
    if (a.score == null) return 1
    if (b.score == null) return -1
    return b.score - a.score
  })
  let rank = 0
  for (const entry of scores) {
    if (entry.score != null) entry.rank = ++rank
  }
  return scores
}

/**
 * Short summary of a ranking, useful for the JSON brief and the UI header.
 *
 * @param {Array<Object>} scores Result of {@link rankSites}.
 * @returns {{count: number, scoredCount: number, best: Object|null, averageScore: number|null, recommended: string|null}}
 */
export function rankingSummary(scores) {
  const list = Array.isArray(scores) ? scores : []
  const scored = list.filter((entry) => entry.score != null)
  const average =
    scored.length > 0 ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length : null
  const best = scored.length > 0 ? scored[0] : null
  return {
    count: list.length,
    scoredCount: scored.length,
    best,
    averageScore: average == null ? null : round1(average),
    recommended: best ? best.siteId : null,
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
 * Round to four decimal places.
 *
 * @param {number} value
 * @returns {number}
 */
function round4(value) {
  return Math.round(Number(value) * 10000) / 10000
}
