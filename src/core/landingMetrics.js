/**
 * Full mission-feasibility metrics for landing zones.
 *
 * This module turns a detected landing zone plus the loaded DEM, the precomputed
 * Sun/Earth ephemeris and the mission profile into an explicit, auditable set of
 * engineering variables (Watts, Wh, °C, %, metres) and a documented weighted
 * score. It is the precision layer behind the zone autopilot: nothing is hidden
 * behind a single "slope" number, and every call recomputes all variables from
 * the current inputs (there is no metric caching) so a new terrain region, a
 * changed mission field or a new start time always produces fresh numbers and a
 * new `inputSignature`.
 *
 * ## Variables (units in brackets)
 *
 * - Safety: mean/max/std slope [deg], roughness [m], relief [m], flat fraction
 *   [0..1], landing-ellipse fit [0..1, m], crater-hazard clearance [m, 0..1].
 * - Illumination: sunlit fraction [0..1], sunlit hours [h], continuous sun days
 *   [d], longest eclipse [h], sun elevation min/max/mean [deg], sun set/rise and
 *   eclipse counts.
 * - Power: average/max/min solar power [W], eclipse deficit [Wh], required
 *   battery energy [Wh], heater energy [Wh], margin vs `powerNeedW` [W].
 * - Thermal: day/night/PSR surface temperatures [°C], cycling [°C], heater [W/Wh].
 * - Comms: Earth visibility fraction [0..1], longest line-of-sight gap [h],
 *   data budget [Mb] vs need, relay and mast benefit.
 * - Logistics: nearest curated site [m], nearest flat pad [m], traverse index.
 * - Science: nearest crater distance [m], crater proximity score, PSR proximity.
 *
 * ## Documented approximations
 *
 * - Surface temperatures use a single-layer Stefan-Boltzmann balance with
 *   `T = [ (1 − A)·S·sin(el) / (ε·σ) ]^(1/4)` for sunlit terrain, a fixed
 *   night-temperature approximation (local albedo/heat-conduction ignored) and a
 *   fixed PSR temperature; this is a planning estimate, not a thermal model.
 * - The landing ellipse is treated as a circle `π·r²` from
 *   `mission.landingEllipseRadiusM`.
 * - Crater hazards come from the DEM crater detector; PSR proximity is inferred
 *   from the illumination fraction (a dedicated PSR raster is not shipped).
 * - Battery sizing uses `(powerNeedW + heaterPowerW)·eclipseHours`, divided by
 *   `batteryRoundTripEfficiency · batteryDepthOfDischarge`.
 * - The ephemeris of the nearest curated site is reused (topocentric Earth
 *   parallax error < 0.1° across the 608 km DEM; the Sun is unaffected).
 *
 * @module core/landingMetrics
 */

import { DEG, RAD, clamp, greatCircleDistanceM } from './geometry.js'
import { areaStatistics } from './terrain.js'
import { horizonProfile, evaluateBodyVisibility } from './engine.js'
import {
  normalizeEphemerisDataset,
  sampleAt,
  visibilityWindows,
  toTimestamp,
} from './ephemeris.js'
import { panelPowerW, powerModelFromMission, missionWindow } from './power.js'
import { commsModelFromMission, commWindows, dataBudget } from './comms.js'
import { gradeForScore, normalizeMission } from './autopilot.js'

/** Model identifier written into every result (part of the input signature). */
export const LANDING_MODEL_VERSION = 'landing-metrics/1'

/** Default component weights (sum = 1). */
export const LANDING_SCORE_WEIGHTS = Object.freeze({
  power: 0.25,
  sun: 0.2,
  comms: 0.2,
  safety: 0.15,
  thermal: 0.1,
  logistics: 0.05,
  science: 0.05,
})

/** Stefan-Boltzmann constant [W·m⁻²·K⁻⁴]. */
export const STEFAN_BOLTZMANN = 5.670374419e-8

/** Kelvin offset used by the temperature model. */
const KELVIN_OFFSET = 273.15

/**
 * Merge partial weights with the defaults and normalize them to sum to 1.
 *
 * @param {Object|null|undefined} weights Partial weights `{power, sun, comms, safety, thermal, logistics, science}`.
 * @returns {{power: number, sun: number, comms: number, safety: number, thermal: number, logistics: number, science: number}}
 */
export function normalizeLandingWeights(weights) {
  const merged = { ...LANDING_SCORE_WEIGHTS }
  if (weights && typeof weights === 'object') {
    for (const key of Object.keys(merged)) {
      const value = Number(weights[key])
      if (Number.isFinite(value) && value >= 0) merged[key] = value
    }
  }
  const sum = Object.values(merged).reduce((total, value) => total + value, 0)
  if (!(sum > 0)) return { ...LANDING_SCORE_WEIGHTS }
  for (const key of Object.keys(merged)) merged[key] = merged[key] / sum
  return merged
}

/**
 * Equilibrium surface temperature for one-layer radiative balance.
 *
 * `T = [ (1 − A)·S·sin(el) / (ε·σ) ]^(1/4) − 273.15` for a positive Sun
 * elevation, or `null` when the surface is not sunlit.
 *
 * @param {{albedo: number, emissivity: number, solarConstantWm2: number, solarElevationDeg: number}} input
 * @returns {number|null} Temperature in °C, or `null` when `el <= 0`.
 */
export function surfaceEquilibriumTemperatureC(input) {
  const albedo = clamp(Number(input?.albedo) || 0, 0, 1)
  const emissivity = clamp(Number(input?.emissivity) || 0.95, 0.01, 1)
  const solarConstant = Math.max(0, Number(input?.solarConstantWm2) || 1361)
  const elevationDeg = Number(input?.solarElevationDeg)
  if (!Number.isFinite(elevationDeg) || elevationDeg <= 0) return null
  const incidence = Math.max(0, Math.sin(elevationDeg * DEG))
  if (incidence <= 0) return null
  const kelvin = Math.pow(((1 - albedo) * solarConstant * incidence) / (emissivity * STEFAN_BOLTZMANN), 0.25)
  return clamp(kelvin - KELVIN_OFFSET, -273, 400)
}

/**
 * Complement gaps between visibility windows (the eclipse / line-of-sight gaps).
 *
 * @param {Array<{from: string, to: string, durationSeconds?: number}>} windows Visibility windows (ISO strings).
 * @param {number} fromMs Window start (ms).
 * @param {number} toMs Window end (ms).
 * @returns {Array<{from: number, to: number, durationSeconds: number}>} Gaps in ms/seconds.
 */
export function windowsToGaps(windows, fromMs, toMs) {
  const gaps = []
  const sorted = (Array.isArray(windows) ? windows : [])
    .map((window) => ({ from: toTimestamp(window.from), to: toTimestamp(window.to) }))
    .filter((window) => Number.isFinite(window.from) && Number.isFinite(window.to))
    .sort((a, b) => a.from - b.from)
  let cursor = fromMs
  for (const window of sorted) {
    if (window.from > cursor) {
      gaps.push({ from: cursor, to: window.from, durationSeconds: (window.from - cursor) / 1000 })
    }
    cursor = Math.max(cursor, window.to)
  }
  if (toMs > cursor) gaps.push({ from: cursor, to: toMs, durationSeconds: (toMs - cursor) / 1000 })
  return gaps
}

/**
 * Window-gap statistics (longest gap and gap count above a threshold).
 *
 * @param {Array<{from: number, to: number, durationSeconds: number}>} gaps
 * @returns {{longestGapHours: number, longestGapStart: string|null, gapCount: number, totalGapHours: number}}
 */
export function gapStatistics(gaps) {
  let longest = { durationSeconds: 0, from: null }
  let total = 0
  for (const gap of gaps) {
    total += gap.durationSeconds
    if (gap.durationSeconds > longest.durationSeconds) longest = gap
  }
  return {
    longestGapHours: longest.durationSeconds / 3600,
    longestGapStart: longest.from != null ? new Date(longest.from).toISOString() : null,
    gapCount: gaps.length,
    totalGapHours: total / 3600,
  }
}

/**
 * Illumination metrics from the terrain horizon and the Sun ephemeris.
 *
 * @param {{terrain: Object, site: Object, ephemeris: Object, mission: Object, window: Object, profile: Object}} input
 * @returns {Object} Illumination metrics.
 */
export function computeIlluminationMetrics({ terrain, site, ephemeris, mission, window, profile }) {
  const dataset = normalizeEphemerisDataset(ephemeris)
  const stepSeconds = clamp(Number(mission.stepSeconds) || 120, 60, 600)
  const windows = visibilityWindows(dataset, site, terrain, 'sun', window.startMs, window.endMs, {
    stepSeconds,
    profile,
  })
  const gaps = windowsToGaps(windows, window.startMs, window.endMs)
  const windowSeconds = Math.max((window.endMs - window.startMs) / 1000, 1)
  const sunlitSeconds = windows.reduce((sum, current) => sum + (current.durationSeconds ?? 0), 0)
  let longestSunWindowSeconds = 0
  for (const current of windows) longestSunWindowSeconds = Math.max(longestSunWindowSeconds, current.durationSeconds ?? 0)
  const gapStats = gapStatistics(gaps)

  // Sun elevation stats from the precomputed samples inside the window.
  let minEl = Infinity
  let maxEl = -Infinity
  let sumEl = 0
  let countEl = 0
  let sumSunlitEl = 0
  let countSunlitEl = 0
  const elevationSamples = []
  for (const sample of dataset.samples) {
    if (sample.t < window.startMs || sample.t > window.endMs) continue
    if (!sample.sun) continue
    elevationSamples.push(sample)
    if (sample.sun.el < minEl) minEl = sample.sun.el
    if (sample.sun.el > maxEl) maxEl = sample.sun.el
    sumEl += sample.sun.el
    countEl += 1
  }
  // Sunlit mean elevation (used by the thermal day-temperature model).
  const stride = Math.max(1, Math.ceil(elevationSamples.length / 220))
  for (let index = 0; index < elevationSamples.length; index += stride) {
    const sample = elevationSamples[index]
    const visibility = evaluateBodyVisibility(terrain, site, sample.sun, { profile })
    if (visibility.visible) {
      sumSunlitEl += sample.sun.el
      countSunlitEl += 1
    }
  }

  const windowHours = windowSeconds / 3600
  const totalEclipseHours = Math.max(0, windowHours - sunlitSeconds / 3600)
  const sunElevationMeanWindowDeg = countEl > 0 ? sumEl / countEl : null
  return {
    sunlitFraction: clamp(sunlitSeconds / windowSeconds, 0, 1),
    sunlitHours: sunlitSeconds / 3600,
    continuousSunDays: longestSunWindowSeconds / 86400,
    // Total dark time over the whole window vs the single longest dark gap.
    totalEclipseHours,
    longestEclipseHours: gapStats.longestGapHours,
    longestEclipseStart: gapStats.longestGapStart,
    eclipseCount: gaps.filter((gap) => gap.durationSeconds > 60).length,
    // Legacy alias (deprecated): use totalEclipseHours.
    eclipseHours: totalEclipseHours,
    sunElevationMinDeg: countEl > 0 ? minEl : null,
    sunElevationMaxDeg: countEl > 0 ? maxEl : null,
    // Window mean vs mean while sunlit (different physics).
    sunElevationMeanWindowDeg,
    sunElevationMeanSunlitDeg: countSunlitEl > 0 ? sumSunlitEl / countSunlitEl : null,
    // Legacy alias (deprecated): use sunElevationMeanWindowDeg.
    sunElevationMeanDeg: sunElevationMeanWindowDeg,
    sunsetCount: windows.length,
    sunriseCount: windows.length,
    windowHours,
    sunWindows: windows,
    eclipseGaps: gaps,
  }
}

/**
 * Thermal metrics (single-layer radiative balance + fixed night/PSR floors).
 *
 * @param {{illumination: Object, mission: Object}} input
 * @returns {Object} Thermal metrics.
 */
export function computeThermalMetrics({ illumination, mission }) {
  const thermalModel = mission.thermal
  const isPsr = illumination.sunlitFraction <= 1e-6
  const dayTempC = isPsr
    ? null
    : surfaceEquilibriumTemperatureC({
        albedo: thermalModel.albedo,
        emissivity: thermalModel.emissivity,
        solarConstantWm2: thermalModel.solarConstantWm2,
        solarElevationDeg: illumination.sunElevationMeanSunlitDeg ?? illumination.sunElevationMeanDeg ?? 0,
      })
  const nightTempC = isPsr ? thermalModel.psrTemperatureC : thermalModel.nightTemperatureC
  const maxTempC = dayTempC == null ? thermalModel.psrTemperatureC : dayTempC
  const minTempC = Math.min(nightTempC, maxTempC)
  const cyclingDeltaTC = Math.max(0, maxTempC - minTempC)
  const operatingDeficit = Math.max(0, thermalModel.minOperatingC - minTempC)
  // Heater rating needed during eclipse (capped by the mission heater).
  const heaterPowerSizedW = clamp(operatingDeficit * thermalModel.heaterWPerK, 0, thermalModel.heaterMaxW)
  const totalEclipseHours = Number.isFinite(illumination.totalEclipseHours)
    ? illumination.totalEclipseHours
    : illumination.eclipseHours
  const heaterWh = heaterPowerSizedW * totalEclipseHours
  const heaterAveragePowerW =
    illumination.windowHours > 0 ? heaterWh / illumination.windowHours : 0
  // Temperature reached with the heater running at its sized power.
  const heatedMinTempC =
    minTempC + heaterPowerSizedW / Math.max(thermalModel.heaterWPerK, 1e-9)
  const withinUnheatedOperatingRange =
    minTempC >= thermalModel.minOperatingC && maxTempC <= thermalModel.maxOperatingC
  const withinOperatingRange =
    heatedMinTempC >= thermalModel.minOperatingC - 1e-9 && maxTempC <= thermalModel.maxOperatingC
  return {
    dayTempC,
    nightTempC,
    psrTempC: thermalModel.psrTemperatureC,
    minTempC,
    maxTempC,
    heatedMinTempC,
    thermalCyclingDeltaTC: cyclingDeltaC(cyclingDeltaTC),
    thermalCycleCount: illumination.eclipseCount,
    isPsr,
    // Sized heater power (during eclipse) [W] vs window-average heater load [W].
    heaterPowerSizedW: round2(heaterPowerSizedW),
    heaterAveragePowerW: round2(heaterAveragePowerW),
    // Legacy aliases (deprecated).
    heaterPowerW: round2(heaterPowerSizedW),
    averageHeaterPowerW: round2(heaterAveragePowerW),
    heaterWh: round2(heaterWh),
    minOperatingC: thermalModel.minOperatingC,
    maxOperatingC: thermalModel.maxOperatingC,
    withinOperatingRange,
    withinUnheatedOperatingRange,
    model: {
      albedo: thermalModel.albedo,
      emissivity: thermalModel.emissivity,
      solarConstantWm2: thermalModel.solarConstantWm2,
    },
  }
}

/**
 * Pretty rounding helper for temperature cycling.
 *
 * @param {number} value
 * @returns {number}
 */
function cyclingDeltaC(value) {
  return round2(value)
}

/**
 * Solar-power metrics in Watts and watt-hours over the mission window.
 *
 * @param {{terrain: Object, site: Object, ephemeris: Object, mission: Object, window: Object, profile: Object, illumination: Object, thermal: Object}} input
 * @returns {Object} Power metrics.
 */
export function computePowerMetrics({ terrain, site, ephemeris, mission, window, profile, illumination, thermal }) {
  const dataset = normalizeEphemerisDataset(ephemeris)
  const model = powerModelFromMission(mission)
  const stepMs = clamp(Number(mission.stepSeconds) || 300, 30, 900) * 1000
  const windowHours = Math.max((window.endMs - window.startMs) / 3600000, 1e-6)

  let sumW = 0
  let maxW = 0
  let minW = Infinity
  let count = 0
  let energyWh = 0
  let sunlitEnergyWh = 0
  for (let timestampMs = window.startMs; timestampMs <= window.endMs; timestampMs += stepMs) {
    const sample = sampleAt(dataset, timestampMs)
    const visible = evaluateBodyVisibility(terrain, site, sample.sun, { profile }).visible
    const powerW = visible ? panelPowerW(sample.sun, model) : 0
    sumW += powerW
    if (powerW > maxW) maxW = powerW
    if (powerW < minW) minW = powerW
    const deltaHours = Math.min(stepMs, Math.max(0, window.endMs - timestampMs)) / 3600000
    energyWh += powerW * deltaHours
    if (visible) sunlitEnergyWh += powerW * deltaHours
    count += 1
  }
  if (count === 0) {
    minW = 0
    count = 1
  }

  const averageW = sumW / count
  const powerNeedW = mission.powerNeedW
  const heaterPowerSizedW = thermal.heaterPowerSizedW ?? thermal.heaterPowerW
  // Battery must survive the LONGEST continuous eclipse; the total eclipse time
  // is reported separately as an energy figure (not used for battery sizing).
  const longestEclipseHours = Number.isFinite(illumination.longestEclipseHours)
    ? Math.max(0, illumination.longestEclipseHours)
    : 0
  const totalEclipseHours = Number.isFinite(illumination.totalEclipseHours)
    ? illumination.totalEclipseHours
    : illumination.eclipseHours
  const heaterAveragePowerW = thermal.heaterAveragePowerW ?? thermal.averageHeaterPowerW
  const demandW = Math.max(powerNeedW + heaterAveragePowerW, 1e-6)
  const roundTrip = mission.batteryRoundTripEfficiency
  const depthOfDischarge = mission.batteryDepthOfDischarge
  const batteryCapacityWh = Math.max(0, Number(mission.batteryCapacityWh) || 0)

  const base = {
    powerNeedW: round2(powerNeedW),
    heaterWh: round2(thermal.heaterWh),
    // Sized heater power (during eclipse) vs window-average heater load.
    heaterPowerW: round2(heaterPowerSizedW),
    averageHeaterPowerW: round2(heaterAveragePowerW),
    heaterPowerSizedW: round2(heaterPowerSizedW),
    heaterAveragePowerW: round2(heaterAveragePowerW),
    longestEclipseHours: round2(longestEclipseHours),
    totalEclipseHours: round2(totalEclipseHours),
    eclipseHours: round2(totalEclipseHours), // deprecated alias
    model: {
      panelAreaM2: model.panelAreaM2,
      panelEfficiency: model.panelEfficiency,
      systemDerate: model.systemDerate,
    },
  }

  // RTG: constant power source, unaffected by eclipses. No solar/battery sizing;
  // the requirement is rtgPowerW >= powerNeedW + average heater load.
  if (mission.powerSource === 'rtg') {
    const rtgPowerW = Math.max(0, Number(mission.rtgPowerW) || 0)
    const rtgMarginW = rtgPowerW - powerNeedW - heaterAveragePowerW
    const meetsPowerNeed = rtgMarginW >= 0
    return {
      source: 'rtg',
      rtgPowerW: round2(rtgPowerW),
      rtgMarginW: round2(rtgMarginW),
      ...base,
      averageW: round2(rtgPowerW),
      maxW: round2(rtgPowerW),
      minW: round2(rtgPowerW),
      peakW: round2(rtgPowerW),
      eclipseAverageW: round2(rtgPowerW),
      eclipseDeficitWh: 0,
      totalEclipseEnergyWh: 0,
      requiredBatteryWh: 0,
      heaterLongestEclipseWh: 0,
      powerMarginW: round2(rtgMarginW),
      powerMarginFraction: round4(rtgMarginW / demandW),
      batteryCapacityWh: round2(batteryCapacityWh),
      batteryCoverage: 1,
      meetsPowerNeed,
      dailyWh: round2(rtgPowerW * 24),
      totalEnergyWh: round2(rtgPowerW * windowHours),
      sunlitEnergyWh: round2(sunlitEnergyWh),
    }
  }

  const eclipseDeficitWh = (powerNeedW + heaterPowerSizedW) * longestEclipseHours
  const totalEclipseEnergyWh = (powerNeedW + heaterPowerSizedW) * totalEclipseHours
  const heaterLongestEclipseWh = heaterPowerSizedW * longestEclipseHours
  const requiredBatteryWh = eclipseDeficitWh / Math.max(roundTrip * depthOfDischarge, 1e-6)
  const powerMarginW = averageW - powerNeedW - heaterAveragePowerW
  const batteryCoverage = clamp(batteryCapacityWh / Math.max(requiredBatteryWh, 1e-9), 0, 1)
  const meetsPowerNeed = powerMarginW >= 0 && requiredBatteryWh <= batteryCapacityWh + 1e-9

  return {
    source: 'solar',
    rtgPowerW: null,
    ...base,
    averageW: round2(averageW),
    maxW: round2(maxW),
    minW: round2(Number.isFinite(minW) ? minW : 0),
    peakW: round2(maxW),
    eclipseAverageW: 0,
    // Energy required for the LONGEST continuous eclipse (battery sizing basis).
    eclipseDeficitWh: round2(eclipseDeficitWh),
    // Total energy deficit summed over all eclipses in the window (informational).
    totalEclipseEnergyWh: round2(totalEclipseEnergyWh),
    requiredBatteryWh: round2(requiredBatteryWh),
    heaterLongestEclipseWh: round2(heaterLongestEclipseWh),
    powerMarginW: round2(powerMarginW),
    powerMarginFraction: round4(powerMarginW / demandW),
    batteryCapacityWh: round2(batteryCapacityWh),
    batteryCoverage: round4(batteryCoverage),
    meetsPowerNeed,
    dailyWh: round2(energyWh / Math.max(windowHours / 24, 1e-6)),
    totalEnergyWh: round2(energyWh),
    sunlitEnergyWh: round2(sunlitEnergyWh),
  }
}

/**
 * Communications metrics (direct Earth line of sight, gaps, data budget, relay).
 *
 * @param {{terrain: Object, site: Object, ephemeris: Object, mission: Object, window: Object, profile: Object}} input
 * @returns {Object} Communications metrics.
 */
export function computeCommsMetrics({ terrain, site, ephemeris, mission, window, profile }) {
  const dataset = normalizeEphemerisDataset(ephemeris)
  const model = commsModelFromMission(mission)
  const stepSeconds = clamp(Number(mission.stepSeconds) || 120, 60, 600)
  const windowSeconds = Math.max((window.endMs - window.startMs) / 1000, 1)
  const windowHours = windowSeconds / 3600

  const directWindows = visibilityWindows(dataset, site, terrain, 'earth', window.startMs, window.endMs, {
    stepSeconds,
    profile,
    limbRadiusDeg: model.earthLimbRadiusDeg,
  })
  const directVisibleSeconds = directWindows.reduce((sum, current) => sum + (current.durationSeconds ?? 0), 0)
  const directEarthVisibleFraction = clamp(directVisibleSeconds / windowSeconds, 0, 1)
  const directGaps = windowsToGaps(directWindows, window.startMs, window.endMs)
  const directGapStats = gapStatistics(directGaps)

  // Windows used for the data budget and effective availability: direct LOS or
  // relay coverage (commWindows applies the documented relay-in-orbit model).
  const budgetWindows = commWindows(site, terrain, dataset, mission, window.startMs, window.endMs)
  const budget = dataBudget(budgetWindows, mission)
  const relayInOrbit = mission.relayInOrbit === true
  const relayCoverage = relayInOrbit ? model.relayCoverage : 0
  const effectiveFraction = relayInOrbit ? Math.max(directEarthVisibleFraction, relayCoverage) : directEarthVisibleFraction
  const relayBenefitFraction = relayInOrbit ? Math.max(0, relayCoverage - directEarthVisibleFraction) : 0
  const availableHours = effectiveFraction * windowHours
  const dataBudgetRatio =
    mission.dataNeedMb != null && mission.dataNeedMb > 0 ? budget.estimatedMb / mission.dataNeedMb : null
  const dataBudgetCoverage = dataBudgetRatio == null ? null : clamp(dataBudgetRatio, 0, 1)
  // Effective availability gaps (with relay) vs direct-LOS gaps.
  const effectiveGaps = windowsToGaps(budgetWindows, window.startMs, window.endMs)
  const effectiveGapStats = gapStatistics(
    effectiveFraction >= 0.999 ? [] : effectiveGaps,
  )

  return {
    earthVisibleFraction: round4(effectiveFraction),
    directEarthVisibleFraction: round4(directEarthVisibleFraction),
    // Effective availability gaps (with relay if enabled).
    maxLosGapHours: round2(effectiveGapStats.longestGapHours),
    maxLosGapStart: effectiveGapStats.longestGapStart,
    directMaxLosGapHours: round2(directGapStats.longestGapHours),
    directMaxLosGapStart: directGapStats.longestGapStart,
    windowHours: round2(windowHours),
    availableHours: round2(availableHours),
    relayInOrbit,
    relayCoverage: round4(relayCoverage),
    relayBenefitHours: round2(relayBenefitFraction * windowHours),
    relayBenefitFraction: round4(relayBenefitFraction),
    dataBudgetMb: round2(budget.estimatedMb),
    dataNeedMb: mission.dataNeedMb,
    // Ratios, not percentages: ratio = budget / need (may exceed 1).
    dataBudgetRatio: dataBudgetRatio == null ? null : round4(dataBudgetRatio),
    dataBudgetCoverage,
    // Legacy alias (deprecated): use dataBudgetRatio.
    dataBudgetFraction: dataBudgetRatio == null ? null : round4(dataBudgetRatio),
    meetsDataNeed: budget.meetsDataNeed,
    dataRateMbps: model.dataRateMbps,
    relayDataRateMbps: model.relayDataRateMbps,
    mastM: mission.mastM,
    // Heuristic: raising the antenna by mastM improves clearance of a close
    // horizon obstruction (documented approximation, obstruction at 1 km).
    mastBenefitDeg: round3((Math.atan(mission.mastM / 1000) * RAD)),
    windowCount: budget.windowCount,
    gaps: effectiveGaps,
  }
}

/**
 * Safety/landing metrics: slope statistics, roughness, ellipse fit and crater
 * hazard.
 *
 * @param {{terrain: Object, zone: Object, mission: Object, craters: Array<Object>, cratersAvailable: boolean, slopeGateDeg: number}} input
 * @returns {Object} Safety metrics.
 */
export function computeSafetyMetrics({ terrain, zone, mission, craters, cratersAvailable, slopeGateDeg }) {
  const equivalentRadiusM = Math.sqrt((Math.max(0, zone.areaKm2) * 1e6) / Math.PI)
  const stats = terrain
    ? areaStatistics(terrain, { lat: zone.lat, lon: zone.lon }, {
        radiusM: Math.max(equivalentRadiusM, 50),
        flatSlopeDeg: slopeGateDeg,
      })
    : null
  const requiredRadiusM = mission.landingEllipseRadiusM
  const requiredAreaKm2 = (Math.PI * requiredRadiusM * requiredRadiusM) / 1e6
  const availableAreaKm2 = Math.max(0, zone.areaKm2)
  const fitRatio = clamp(availableAreaKm2 / Math.max(requiredAreaKm2, 1e-9), 0, 1)
  const marginM = equivalentRadiusM - requiredRadiusM

  const reachM = mission.craterHazardReachM
  let nearest = null
  let cratersWithinReach = 0
  for (const crater of craters ?? []) {
    if (!Number.isFinite(crater?.lat) || !Number.isFinite(crater?.lon)) continue
    const distanceM = greatCircleDistanceM(zone.lat, zone.lon, crater.lat, crater.lon)
    if (!Number.isFinite(distanceM)) continue
    if (!nearest || distanceM < nearest.distanceM) nearest = { crater, distanceM }
    const reach = reachM + (Number(crater.diameterM) || 0) / 2
    if (distanceM <= reach) cratersWithinReach += 1
  }
  const nearestCraterDistanceM = nearest?.distanceM ?? null
  const clearanceM =
    nearestCraterDistanceM == null
      ? reachM
      : nearestCraterDistanceM - (Number(nearest.crater.diameterM) || 0) / 2 - equivalentRadiusM
  const craterHazard = clamp(clearanceM / Math.max(reachM, 1), 0, 1)

  return {
    meanSlopeDeg: round2(stats?.meanSlopeDeg ?? zone.meanSlopeDeg ?? 0),
    maxSlopeDeg: round2(stats?.maxSlopeDeg ?? zone.maxSlopeDeg ?? 0),
    stdSlopeDeg: round2(stats?.slopeStdDeg ?? 0),
    roughnessM: round2(stats?.elevationStdM ?? 0),
    reliefM: round2(stats?.elevationRangeM ?? zone.reliefM ?? 0),
    flatFraction: round4(stats?.flatFraction ?? 1),
    slopeGateDeg,
    meanElevationM: round2(stats?.meanElevationM ?? zone.elevationM ?? 0),
    ellipse: {
      fitRatio: round4(fitRatio),
      requiredAreaKm2: round3(requiredAreaKm2),
      availableAreaKm2: round3(availableAreaKm2),
      requiredAreaM2: Math.round(requiredAreaKm2 * 1e6),
      availableAreaM2: Math.round(availableAreaKm2 * 1e6),
      requiredRadiusM: round1(requiredRadiusM),
      equivalentRadiusM: round1(equivalentRadiusM),
      marginM: round1(marginM),
    },
    hazard: {
      nearestCraterDistanceM: nearestCraterDistanceM == null ? null : round1(nearestCraterDistanceM),
      nearestCraterDiameterM: nearest ? round1(nearest.crater.diameterM) : null,
      nearestCraterDepthM: nearest ? round1(nearest.crater.depthM) : null,
      craterHazard: round4(craterHazard),
      cratersWithinReach,
      reachM,
      cratersAvailable,
    },
  }
}

/**
 * Logistics metrics: distance to the nearest curated site and to the nearest
 * flat pad, plus a documented traverse-difficulty index.
 *
 * @param {{zone: Object, zones: Array<Object>, nearestSite: Object|null, mission: Object}} input
 * @returns {Object} Logistics metrics.
 */
export function computeLogisticsMetrics({ zone, zones, nearestSite, mission }) {
  let nearestPad = null
  for (const other of zones ?? []) {
    if (!other || other.id === zone.id) continue
    const distanceM = greatCircleDistanceM(zone.lat, zone.lon, other.lat, other.lon)
    if (!Number.isFinite(distanceM)) continue
    if (!nearestPad || distanceM < nearestPad.distanceM) nearestPad = { zone: other, distanceM }
  }
  const curatedDistanceM = nearestSite?.distanceM ?? null
  const equivalentRadiusM = Math.sqrt((Math.max(0, zone.areaKm2) * 1e6) / Math.PI)
  const traverseDifficulty = clamp(
    (1 - clamp((curatedDistanceM ?? 0) / 100000, 0, 1) * 0.5) *
      (1 - clamp((zone.meanSlopeDeg ?? 0) / 8, 0, 1) * 0.3),
    0,
    1,
  )
  return {
    nearestCuratedSiteId: nearestSite?.site?.id ?? null,
    nearestCuratedSiteDistanceM: curatedDistanceM == null ? null : round1(curatedDistanceM),
    nearestFlatPadZoneId: nearestPad?.zone?.id ?? null,
    nearestFlatPadDistanceM: nearestPad ? round1(nearestPad.distanceM) : null,
    nearestFlatPadAreaKm2: nearestPad ? round2(nearestPad.zone.areaKm2) : null,
    traverseDistanceM: curatedDistanceM == null ? null : round1(curatedDistanceM),
    traverseDifficulty: round4(traverseDifficulty),
    equivalentPerimeterM: round1(2 * Math.PI * equivalentRadiusM),
    _mission: mission,
  }
}

/**
 * Science-proximity metrics (DEM-only approximation).
 *
 * @param {{zone: Object, safety: Object, illumination: Object, mission: Object}} input
 * @returns {Object} Science metrics.
 */
export function computeScienceMetrics({ zone, safety, illumination, mission }) {
  const distanceM = safety.hazard.nearestCraterDistanceM
  const craterProximityScore =
    distanceM == null ? 0 : clamp(1 - Math.abs(distanceM - 5000) / 20000, 0, 1)
  const isPsr = illumination.sunlitFraction <= 1e-6
  return {
    nearestCraterDistanceM: distanceM,
    nearestCraterDiameterM: safety.hazard.nearestCraterDiameterM,
    nearestCraterDepthM: safety.hazard.nearestCraterDepthM,
    cratersWithinReach: safety.hazard.cratersWithinReach,
    reachM: mission.scienceReachM,
    craterProximityScore: round4(craterProximityScore),
    psrProximityScore: isPsr ? 1 : null,
    scienceDistanceM: distanceM,
    targetKind: distanceM == null ? null : 'crater',
    zoneAreaKm2: round2(zone.areaKm2),
  }
}

/**
 * Hash a JSON-serializable object deterministically (FNV-1a, 32 bits, hex).
 *
 * @param {*} value
 * @returns {string}
 */
function fnv1a(value) {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Deterministic JSON stringify with sorted keys.
 *
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/**
 * Build the deterministic input signature for a ranking run.
 *
 * It covers the terrain grid identity/dimensions, every normalized mission
 * field that can change the result, the ephemeris site ids and sample count and
 * the detection options. Any change to terrain/region, mission or time window
 * therefore produces a different signature, which the UI can show to prove the
 * numbers were recomputed.
 *
 * @param {{terrain?: Object|null, mission?: Object, ephemeris?: Object|null, options?: Object}} input
 * @returns {string} 8-character hex signature.
 */
export function computeInputSignature({ terrain, mission, ephemeris, options } = {}) {
  const missionSnapshot = mission && typeof mission === 'object'
    ? {
        missionDays: mission.missionDays,
        powerNeedW: mission.powerNeedW,
        sunDaysNeeded: mission.sunDaysNeeded,
        relayInOrbit: mission.relayInOrbit,
        startTime: mission.startTime,
        dataNeedMb: mission.dataNeedMb,
        stepSeconds: mission.stepSeconds,
        perimeterM: mission.perimeterM,
        mastM: mission.mastM,
        batteryCapacityWh: mission.batteryCapacityWh,
        batterySpecified: mission.batterySpecified,
        powerSource: mission.powerSource,
        rtgPowerW: mission.rtgPowerW,
        batteryRoundTripEfficiency: mission.batteryRoundTripEfficiency,
        batteryDepthOfDischarge: mission.batteryDepthOfDischarge,
        heaterMaxW: mission.heaterMaxW,
        heaterWPerK: mission.heaterWPerK,
        minOperatingTemperatureC: mission.minOperatingTemperatureC,
        maxOperatingTemperatureC: mission.maxOperatingTemperatureC,
        landingEllipseRadiusM: mission.landingEllipseRadiusM,
        craterHazardMinDiameterM: mission.craterHazardMinDiameterM,
        craterHazardReachM: mission.craterHazardReachM,
        scienceReachM: mission.scienceReachM,
        thermal: mission.thermal,
        weights: mission.weights ?? null,
        power: mission.power,
        comms: mission.comms,
      }
    : null
  return fnv1a({
    model: LANDING_MODEL_VERSION,
    terrain: terrain
      ? {
          id: terrain.id ?? null,
          width: terrain.width,
          height: terrain.height,
          pixelSizeM: terrain.pixelSizeM ?? null,
          minX: terrain.minX ?? terrain.lon0 ?? null,
          maxX: terrain.maxX ?? terrain.lon1 ?? null,
          minY: terrain.minY ?? terrain.lat0 ?? null,
          maxY: terrain.maxY ?? terrain.lat1 ?? null,
          synthetic: terrain.synthetic === true,
        }
      : null,
    mission: missionSnapshot,
    ephemeris: ephemeris
      ? {
          siteId: ephemeris.siteId ?? null,
          startMs: ephemeris.startMs ?? null,
          endMs: ephemeris.endMs ?? null,
          sampleCount: ephemeris.samples?.length ?? null,
        }
      : null,
    options: options
      ? {
          maxSlopeDeg: options.maxSlopeDeg,
          minAreaKm2: options.minAreaKm2,
          maxRoughnessM: options.maxRoughnessM ?? null,
          maxZones: options.maxZones,
          downsample: options.downsample ?? null,
          maxCells: options.maxCells,
          avoidCraters: options.avoidCraters ?? null,
          craterClearanceM: options.craterClearanceM ?? null,
          craterMinDiameterM: options.craterMinDiameterM ?? null,
          searchDates: options.searchDates ?? null,
          dateSearch: options.dateSearch ?? null,
        }
      : null,
  })
}

/**
 * Evaluate the hard mission-feasibility gate for one zone.
 *
 * A zone is **not feasible** when any of these hard constraints fails:
 *
 * - power: `powerMarginW < 0` (average solar power below load + average heater);
 * - battery: a mission battery capacity is specified and
 *   `requiredBatteryWh > batteryCapacityWh`;
 * - thermal: the surface cannot be kept within the operating temperature range
 *   even with the heater at its maximum power (`heatedMinTempC <
 *   minOperatingTemperatureC`), or the day temperature exceeds
 *   `maxOperatingTemperatureC`;
 * - data: the mission specifies a data need and the estimated downlink budget
 *   does not cover it;
 * - undetermined: there is no terrain or ephemeris data to verify the mission.
 *
 * Infeasible/undetermined zones get their score capped (55) and a grade of at
 * most `conditional`; the ranking sorts feasible zones first.
 *
 * @param {{
 *   power: Object,
 *   thermal: Object,
 *   comms: Object,
 *   illumination: Object,
 *   mission: Object,
 *   ephemerisAvailable?: boolean,
 *   terrainAvailable?: boolean,
 * }} input
 * @returns {{
 *   status: 'feasible'|'infeasible'|'undetermined',
 *   feasible: boolean,
 *   violations: Array<{code: string, severity: 'bad'|'warn', params: Object, text: string}>,
 *   powerFeasible: boolean,
 *   batteryFeasible: boolean,
 *   thermalFeasible: boolean,
 *   dataFeasible: boolean,
 *   illuminationMeetsRequirement: boolean,
 *   scoreCap: number|null,
 * }}
 */
export function evaluateZoneFeasibility({
  power,
  thermal,
  comms,
  illumination,
  mission,
  ephemerisAvailable = true,
  terrainAvailable = true,
}) {
  const violations = []
  const powerSource = mission?.powerSource === 'rtg' ? 'rtg' : 'solar'
  const batterySpecified = mission?.batterySpecified === true
  if (!terrainAvailable || !ephemerisAvailable) {
    violations.push({
      code: 'feasibility.undetermined',
      severity: 'warn',
      params: { terrainAvailable, ephemerisAvailable },
      text:
        'No terrain or ephemeris data is available to verify this zone: the score is capped and the ' +
        'zone is treated as not feasible until the data is loaded.',
    })
    return {
      status: 'undetermined',
      feasible: false,
      violations,
      powerSource,
      batterySpecified,
      powerFeasible: false,
      batteryFeasible: false,
      thermalFeasible: false,
      dataFeasible: false,
      illuminationFeasible: false,
      illuminationMeetsRequirement: false,
      rtgFeasible: powerSource === 'rtg' ? false : null,
      scoreCap: 55,
    }
  }

  const sunDaysNeeded = Math.max(0, Number(mission.sunDaysNeeded) || 0)
  const continuousSunDays = Math.max(0, Number(illumination?.continuousSunDays) || 0)
  let powerFeasible = false
  let batteryFeasible = false
  let illuminationFeasible = false
  let rtgFeasible = null

  if (powerSource === 'rtg') {
    // RTG: unaffected by eclipses; no battery or continuous-sun requirement. The
    // only power constraint is that the RTG output covers the load + heater.
    const rtgPowerW = Math.max(0, Number(power?.rtgPowerW ?? mission.rtgPowerW) || 0)
    const heaterAveragePowerW = Math.max(0, Number(power?.heaterAveragePowerW) || 0)
    const demandW = Math.max(0, Number(mission.powerNeedW) || 0) + heaterAveragePowerW
    rtgFeasible = rtgPowerW >= demandW - 1e-9
    powerFeasible = rtgFeasible
    batteryFeasible = true
    illuminationFeasible = true // RTG does not need sunlight
    if (!rtgFeasible) {
      violations.push({
        code: 'feasibility.rtgInsufficient',
        severity: 'bad',
        params: {
          rtgPowerW: round2(rtgPowerW),
          demandW: round2(demandW),
          powerNeedW: round2(mission.powerNeedW),
          heaterAveragePowerW: round2(heaterAveragePowerW),
        },
        text:
          `RTG output is insufficient: ${round2(rtgPowerW)} W against a ${round2(demandW)} W demand ` +
          `(${round2(mission.powerNeedW)} W load + ${round2(heaterAveragePowerW)} W average heater).`,
      })
    }
  } else {
    // Solar + battery power source.
    const powerMarginW = Number(power?.powerMarginW)
    powerFeasible = Number.isFinite(powerMarginW) && powerMarginW >= 0
    if (!powerFeasible) {
      violations.push({
        code: 'feasibility.powerDeficit',
        severity: 'bad',
        params: {
          powerNeedW: round2(mission.powerNeedW),
          heaterAveragePowerW: round2(power?.heaterAveragePowerW ?? 0),
          averageW: round2(power?.averageW ?? 0),
          powerMarginW: round2(powerMarginW),
        },
        text:
          `Power margin is ${round2(powerMarginW)} W: average solar power ${round2(power?.averageW ?? 0)} W ` +
          `cannot cover the ${round2(mission.powerNeedW)} W load plus the ${round2(power?.heaterAveragePowerW ?? 0)} W ` +
          'average heater demand.',
      })
    }

    const batteryCapacityWh = Math.max(0, Number(mission.batteryCapacityWh) || 0)
    const requiredBatteryWh = Math.max(0, Number(power?.requiredBatteryWh) || 0)
    batteryFeasible = requiredBatteryWh <= batteryCapacityWh + 1e-9
    if (!batteryFeasible) {
      violations.push({
        code: 'feasibility.batteryInsufficient',
        severity: 'bad',
        params: {
          requiredBatteryWh: round1(requiredBatteryWh),
          batteryCapacityWh: round1(batteryCapacityWh),
          batteryCoverage: round4(power?.batteryCoverage ?? 0),
          longestEclipseHours: round2(power?.longestEclipseHours ?? 0),
          totalEclipseHours: round2(power?.totalEclipseHours ?? 0),
          eclipseDeficitWh: round1(power?.eclipseDeficitWh ?? 0),
        },
        text:
          `Battery is insufficient for the longest continuous eclipse: ${round1(requiredBatteryWh)} Wh are ` +
          `required (${round1(power?.eclipseDeficitWh ?? 0)} Wh deficit over ` +
          `${round2(power?.longestEclipseHours ?? 0)} h) but only ${round1(batteryCapacityWh)} Wh are ` +
          `available (coverage ${round1((power?.batteryCoverage ?? 0) * 100)}%).`,
      })
    }
    if (!batterySpecified) {
      violations.push({
        code: 'feasibility.batteryNotSpecified',
        severity: 'warn',
        params: {
          defaultBatteryCapacityWh: round1(batteryCapacityWh),
          requiredBatteryWh: round1(requiredBatteryWh),
        },
        text:
          `No battery capacity was specified: the documented default of ${round1(batteryCapacityWh)} Wh is ` +
          `used for feasibility (required: ${round1(requiredBatteryWh)} Wh for the longest eclipse).`,
      })
    }

    illuminationFeasible = sunDaysNeeded <= 0 || continuousSunDays >= sunDaysNeeded - 1e-9
    if (!illuminationFeasible) {
      violations.push({
        code: 'feasibility.illuminationInsufficient',
        severity: 'bad',
        params: {
          continuousSunDays: round2(continuousSunDays),
          sunDaysNeeded: round2(sunDaysNeeded),
          deficitDays: round2(sunDaysNeeded - continuousSunDays),
        },
        text:
          `Continuous sunlight requirement not met: the longest continuous sunlit period is ` +
          `${round2(continuousSunDays)} days against the required ${round2(sunDaysNeeded)} days.`,
      })
    }
  }

  // Thermal: can the heater keep the electronics inside the operating range?
  const heatedMinTempC = Number(thermal?.heatedMinTempC)
  const maxTempC = Number(thermal?.maxTempC)
  const thermalCold = !(heatedMinTempC >= mission.minOperatingTemperatureC - 1e-9)
  const thermalHot = !(maxTempC <= mission.maxOperatingTemperatureC + 1e-9)
  if (thermalCold) {
    violations.push({
      code: 'feasibility.thermalCold',
      severity: 'bad',
      params: {
        heatedMinTempC: round1(heatedMinTempC),
        minOperatingC: round1(mission.minOperatingTemperatureC),
        heaterPowerSizedW: round2(thermal?.heaterPowerSizedW ?? 0),
        heaterMaxW: round1(mission.heaterMaxW),
      },
      text:
        `Thermal cold limit exceeded: even with the heater at its maximum (` +
        `${round1(mission.heaterMaxW)} W) the minimum temperature reaches ` +
        `${round1(heatedMinTempC)} °C, below the ${round1(mission.minOperatingTemperatureC)} °C limit.`,
    })
  }
  if (thermalHot) {
    violations.push({
      code: 'feasibility.thermalHot',
      severity: 'bad',
      params: {
        maxTempC: round1(maxTempC),
        maxOperatingC: round1(mission.maxOperatingTemperatureC),
      },
      text:
        `Thermal hot limit exceeded: the day-time surface reaches ${round1(maxTempC)} °C, above the ` +
        `${round1(mission.maxOperatingTemperatureC)} °C limit.`,
    })
  }
  const thermalFeasible = !thermalCold && !thermalHot

  // Data downlink is a hard constraint only when the mission demands data.
  let dataFeasible = true
  if (
    mission.dataNeedMb != null &&
    mission.dataNeedMb > 0 &&
    comms?.dataBudgetCoverage != null &&
    comms.dataBudgetCoverage < 1 - 1e-9
  ) {
    dataFeasible = false
    violations.push({
      code: 'feasibility.dataInsufficient',
      severity: 'bad',
      params: {
        dataBudgetMb: round1(comms.dataBudgetMb ?? 0),
        dataNeedMb: round1(mission.dataNeedMb),
        dataBudgetCoverage: round4(comms.dataBudgetCoverage),
      },
      text:
        `Data downlink is insufficient: ${round1(comms.dataBudgetMb ?? 0)} Mb of budget against a ` +
        `${round1(mission.dataNeedMb)} Mb mission need.`,
    })
  }

  const feasible =
    powerFeasible && batteryFeasible && thermalFeasible && dataFeasible && illuminationFeasible
  return {
    status: feasible ? 'feasible' : 'infeasible',
    feasible,
    violations,
    powerSource,
    batterySpecified,
    powerFeasible,
    batteryFeasible,
    thermalFeasible,
    dataFeasible,
    illuminationFeasible,
    illuminationMeetsRequirement: illuminationFeasible,
    rtgFeasible,
    scoreCap: feasible ? null : 55,
  }
}

/**
 * Compute every mission-feasibility metric for one landing zone plus the
 * documented weighted score.
 *
 * All inputs are read on every call (no caching of metrics): the DEM, the
 * mission profile (including the battery/thermal fields), the ephemeris dataset
 * and the mission time window.
 *
 * @param {{
 *   terrain: Object|null,
 *   zone: Object,
 *   zones?: Array<Object>,
 *   ephemeris: Object|null,
 *   site?: Object|null,
 *   mission?: Object,
 *   nearestSite?: {site: Object, distanceM: number}|null,
 *   craters?: Array<Object>,
 *   cratersAvailable?: boolean,
 *   options?: Object,
 *   ephemerisSiteId?: string|null,
 * }} input
 * @returns {{
 *   score: number,
 *   grade: string,
 *   gradeCode: string,
 *   confidence: number,
 *   components: Object,
 *   metrics: Object,
 *   reasons: Array<Object>,
 *   warnings: Array<Object>,
 *   inputSignature: string,
 *   weights: Object,
 *   window: Object|null,
 * }}
 */
export function computeLandingMetrics(input = {}) {
  const {
    terrain,
    zone,
    zones = [],
    ephemeris,
    site,
    mission,
    nearestSite = null,
    craters = [],
    cratersAvailable = false,
    options = {},
    ephemerisSiteId = null,
  } = input

  const normalizedMission = normalizeMission(mission ?? {})
  const weights = normalizeLandingWeights(normalizedMission.weights ?? options.weights)
  const zoneSite = site ?? {
    id: zone?.id ?? 'zone',
    name: zone?.name ?? 'Landing zone',
    lat: Number(zone?.lat),
    lon: Number(zone?.lon),
    elevationM: Number(zone?.elevationM),
  }
  const warnings = []
  const reasons = []

  if (!terrain) {
    warnings.push({ code: 'data.terrainMissing', severity: 'warn', params: {}, text: 'No DEM terrain is available; safety and horizon metrics are unavailable.' })
  } else if (terrain.synthetic === true) {
    warnings.push({ code: 'data.syntheticTerrain', severity: 'warn', params: {}, text: 'A synthetic fallback terrain is in use; metrics are approximate and not real NASA data.' })
  }
  if (!ephemeris) {
    warnings.push({ code: 'data.ephemerisMissing', severity: 'warn', params: {}, text: 'No ephemeris is available for this zone; Sun/Earth metrics are unavailable.' })
  }
  if (!cratersAvailable) {
    warnings.push({ code: 'no-crater-hazard-data', severity: 'info', params: {}, text: 'Crater hazard detection did not run for this terrain; hazard metrics are conservative.' })
  }
  if (normalizedMission.batteryCapacityWh == null) {
    warnings.push({ code: 'battery-capacity-not-specified', severity: 'info', params: {}, text: 'No battery capacity was specified; the required battery energy is a sizing recommendation.' })
  }
  if (!Number.isFinite(Number(zone?.lat)) || !Number.isFinite(Number(zone?.lon))) {
    warnings.push({ code: 'zone.invalid', severity: 'bad', params: {}, text: 'The landing zone has no valid coordinates.' })
  }

  const signature = computeInputSignature({
    terrain,
    mission: normalizedMission,
    ephemeris: ephemeris ? normalizeEphemerisDataset(ephemeris) : null,
    options,
  })

  // Without an ephemeris we still return the safety/logistics picture but with
  // zeroed illumination/power/comms and reduced confidence.
  let window = null
  let illumination
  let thermal
  let power
  let comms
  if (ephemeris && terrain) {
    const dataset = normalizeEphemerisDataset(ephemeris)
    window = missionWindow(dataset, normalizedMission)
    const profile = horizonProfile(terrain, zoneSite, {
      stepDeg: clamp(Number(options.profileStepDeg ?? normalizedMission.profileStepDeg) || 1, 0.5, 5),
    })
    illumination = computeIlluminationMetrics({ terrain, site: zoneSite, ephemeris: dataset, mission: normalizedMission, window, profile })
    thermal = computeThermalMetrics({ illumination, mission: normalizedMission })
    power = computePowerMetrics({ terrain, site: zoneSite, ephemeris: dataset, mission: normalizedMission, window, profile, illumination, thermal })
    comms = computeCommsMetrics({ terrain, site: zoneSite, ephemeris: dataset, mission: normalizedMission, window, profile })
  } else {
    const windowHours = normalizedMission.missionDays * 24
    illumination = {
      sunlitFraction: 0,
      sunlitHours: 0,
      continuousSunDays: 0,
      longestEclipseHours: windowHours,
      longestEclipseStart: null,
      eclipseCount: 1,
      eclipseHours: windowHours,
      sunElevationMinDeg: null,
      sunElevationMaxDeg: null,
      sunElevationMeanDeg: null,
      sunElevationMeanSunlitDeg: null,
      sunsetCount: 0,
      sunriseCount: 0,
      windowHours,
      sunWindows: [],
      eclipseGaps: [],
      unavailable: true,
    }
    thermal = computeThermalMetrics({ illumination, mission: normalizedMission })
    power = {
      averageW: 0, maxW: 0, minW: 0, peakW: 0, eclipseAverageW: 0,
      eclipseHours: windowHours, eclipseDeficitWh: 0, requiredBatteryWh: 0,
      heaterWh: thermal.heaterWh, heaterPowerW: thermal.heaterPowerW,
      averageHeaterPowerW: thermal.averageHeaterPowerW,
      powerNeedW: normalizedMission.powerNeedW, powerMarginW: -normalizedMission.powerNeedW - thermal.averageHeaterPowerW,
      powerMarginFraction: -1, batteryCapacityWh: normalizedMission.batteryCapacityWh,
      batteryCoverage: 0, meetsPowerNeed: false, dailyWh: 0, totalEnergyWh: 0, sunlitEnergyWh: 0,
      model: { panelAreaM2: normalizedMission.power.panelAreaM2, panelEfficiency: normalizedMission.power.panelEfficiency, systemDerate: normalizedMission.power.systemDerate },
      unavailable: true,
    }
    comms = {
      earthVisibleFraction: 0, directEarthVisibleFraction: 0, maxLosGapHours: windowHours,
      maxLosGapStart: null, windowHours, availableHours: 0, relayInOrbit: normalizedMission.relayInOrbit,
      relayCoverage: 0, relayBenefitHours: 0, relayBenefitFraction: 0, dataBudgetMb: 0,
      dataNeedMb: normalizedMission.dataNeedMb, dataBudgetFraction: null, meetsDataNeed: null,
      dataRateMbps: normalizedMission.comms.dataRateMbps, relayDataRateMbps: normalizedMission.comms.relayDataRateMbps,
      mastM: normalizedMission.mastM, mastBenefitDeg: 0, windowCount: 0, gaps: [], unavailable: true,
    }
  }

  const slopeGateDeg = Number(options.maxSlopeDeg ?? normalizedMission.maxSlopeDeg ?? 8)
  const safety = computeSafetyMetrics({
    terrain,
    zone,
    mission: normalizedMission,
    craters,
    cratersAvailable,
    slopeGateDeg,
  })
  const logistics = computeLogisticsMetrics({ zone, zones, nearestSite, mission: normalizedMission })
  delete logistics._mission
  const science = computeScienceMetrics({ zone, safety, illumination, mission: normalizedMission })

  if (illumination.sunlitFraction <= 1e-6) {
    warnings.push({ code: 'zone.is-psr', severity: 'warn', params: {}, text: 'This zone is never sunlit during the mission window (permanently shadowed): power is zero and thermal loads are extreme.' })
  }
  if (science.psrProximityScore == null) {
    warnings.push({ code: 'psr-map-unavailable', severity: 'info', params: {}, text: 'No PSR raster is shipped; PSR proximity is inferred only for zones that are never sunlit during the window.' })
  }
  if (window?.clamped) {
    warnings.push({ code: 'data.windowClamped', severity: 'info', params: {}, text: 'The mission window extends beyond the ephemeris coverage and was clipped to the available data.' })
  }

  // ---------------------------------------------------------------------
  // Component scores (0..100), documented formulas.
  // ---------------------------------------------------------------------
  const sunDaysNeeded = normalizedMission.sunDaysNeeded
  const consecutiveFactor = sunDaysNeeded > 0 ? clamp(illumination.continuousSunDays / sunDaysNeeded, 0, 1) : 1
  const abundanceFactor = clamp(illumination.sunlitFraction / 0.5, 0, 1)
  const eclipseFactor = 1 - clamp(illumination.longestEclipseHours / Math.max(illumination.windowHours, 1), 0, 1)
  const sunScore = 100 * clamp(0.45 * consecutiveFactor + 0.3 * abundanceFactor + 0.25 * eclipseFactor, 0, 1)

  const demandW = Math.max(normalizedMission.powerNeedW + power.averageHeaterPowerW, 1e-6)
  const ratioScore = clamp(power.averageW / demandW / 1.5, 0, 1)
  const eclipsePenaltyScore = 1 - clamp(power.eclipseHours / Math.max(illumination.windowHours, 1), 0, 1)
  const powerScore = 100 * clamp(0.45 * ratioScore + 0.25 * eclipsePenaltyScore + 0.3 * power.batteryCoverage, 0, 1)

  const commsFractionScore = clamp(comms.earthVisibleFraction / 0.8, 0, 1)
  const dataScore =
    normalizedMission.dataNeedMb != null && normalizedMission.dataNeedMb > 0
      ? clamp((comms.dataBudgetMb ?? 0) / normalizedMission.dataNeedMb, 0, 1)
      : commsFractionScore
  const gapScore = 1 - clamp(comms.maxLosGapHours / Math.max(illumination.windowHours * 0.5, 1), 0, 1)
  const commsScore = 100 * clamp(0.55 * commsFractionScore + 0.25 * dataScore + 0.2 * gapScore, 0, 1)

  const meanSlopeScore = clamp(1 - safety.meanSlopeDeg / Math.max(slopeGateDeg, 1e-6), 0, 1)
  const maxSlopeScore = clamp(1 - safety.maxSlopeDeg / Math.max(slopeGateDeg * 1.5, 1e-6), 0, 1)
  const roughnessScore = clamp(1 - safety.roughnessM / 200, 0, 1)
  const safetyScore = 100 * clamp(
    0.35 * meanSlopeScore +
      0.2 * maxSlopeScore +
      0.15 * roughnessScore +
      0.15 * safety.ellipse.fitRatio +
      0.15 * safety.hazard.craterHazard,
    0,
    1,
  )

  const operatingDeficit = Math.max(0, thermal.minOperatingC - thermal.minTempC)
  const hotViolation = Math.max(0, thermal.maxTempC - thermal.maxOperatingC)
  const rangeScore = clamp(1 - operatingDeficit / 150 - hotViolation / 100, 0, 1)
  const heaterScore = clamp(1 - thermal.heaterPowerW / Math.max(normalizedMission.heaterMaxW, 1e-6), 0, 1)
  // Every eclipse is a day/night thermal cycle; cap the penalty at 50%.
  const cycleScore = 1 - clamp(thermal.thermalCycleCount * 0.1, 0, 0.5)
  const thermalScore = 100 * clamp(
    0.45 * rangeScore + 0.2 * heaterScore + 0.15 * cycleScore + 0.2 * (thermal.isPsr ? 0 : 1),
    0,
    1,
  )

  const curatedDistanceScore = commsDistanceScore(logistics.nearestCuratedSiteDistanceM)
  const flatPadScore = commsDistanceScore(logistics.nearestFlatPadDistanceM)
  const logisticsScore = 100 * clamp(0.5 * curatedDistanceScore + 0.3 * flatPadScore + 0.2 * logistics.traverseDifficulty, 0, 1)

  const scienceScore = 100 * clamp(0.6 * science.craterProximityScore + 0.4 * (science.psrProximityScore ?? 0), 0, 1)

  const components = {
    sun: round1(sunScore),
    power: round1(powerScore),
    comms: round1(commsScore),
    safety: round1(safetyScore),
    thermal: round1(thermalScore),
    logistics: round1(logisticsScore),
    science: round1(scienceScore),
  }
  // Backward-compatible alias: the old zone UI read `components.terrain`.
  components.terrain = components.safety

  const weighted =
    components.sun * weights.sun +
    components.power * weights.power +
    components.comms * weights.comms +
    components.safety * weights.safety +
    components.thermal * weights.thermal +
    components.logistics * weights.logistics +
    components.science * weights.science
  const rawScore = round1(clamp(weighted, 0, 100))

  // Hard feasibility gate: an infeasible zone can never be presented as a good
  // landing site, regardless of how well it scores on the soft criteria.
  const feasibility = evaluateZoneFeasibility({
    power,
    thermal,
    comms,
    illumination,
    mission: normalizedMission,
    ephemerisAvailable: Boolean(ephemeris),
    terrainAvailable: Boolean(terrain),
  })
  let score = rawScore
  let gradeInfo = gradeForScore(rawScore)
  if (!feasibility.feasible) {
    score = Math.min(rawScore, feasibility.scoreCap ?? 55)
    gradeInfo =
      score >= 45
        ? { grade: 'conditional', code: 'grade.conditional' }
        : gradeForScore(score)
  }
  const { grade, code: gradeCode } = gradeInfo
  const scoreCapApplied = score < rawScore

  let confidence = 1
  if (!terrain) confidence -= 0.35
  if (terrain?.synthetic === true) confidence -= 0.2
  if (!ephemeris) confidence -= 0.5
  if (!cratersAvailable) confidence -= 0.1
  if (normalizedMission.batteryCapacityWh == null) confidence -= 0.03
  if (window?.clamped) confidence -= 0.05
  confidence = round2(clamp(confidence, 0, 1))

  // ---------------------------------------------------------------------
  // Reasons (human-readable, i18n-friendly codes + English text + params).
  // ---------------------------------------------------------------------
  for (const violation of feasibility.violations) {
    reasons.push(reason(violation.code, violation.severity, violation.params, violation.text))
  }
  reasons.push(
    reason('illumination.sunlit', illumination.sunlitFraction >= 0.5 ? 'good' : illumination.sunlitFraction > 0 ? 'warn' : 'bad', {
      sunlitFraction: round4(illumination.sunlitFraction),
      continuousSunDays: round2(illumination.continuousSunDays),
      longestEclipseHours: round2(illumination.longestEclipseHours),
    }, `${round1(illumination.sunlitFraction * 100)}% sunlit; longest continuous sun ${round2(illumination.continuousSunDays)} days; longest eclipse ${round1(illumination.longestEclipseHours)} h.`),
  )
  reasons.push(
    reason(power.meetsPowerNeed ? 'power.margin' : 'power.shortfall', power.meetsPowerNeed ? 'good' : 'bad', {
      averageW: round1(power.averageW),
      needW: normalizedMission.powerNeedW,
      marginW: round1(power.powerMarginW),
      requiredBatteryWh: round1(power.requiredBatteryWh),
    }, `Average solar power ${round1(power.averageW)} W vs ${round1(normalizedMission.powerNeedW)} W load (margin ${round1(power.powerMarginW)} W); battery for the eclipse needs ${round1(power.requiredBatteryWh)} Wh.`),
  )
  reasons.push(
    reason('thermal.operating', thermal.withinOperatingRange ? 'good' : 'warn', {
      minTempC: round1(thermal.minTempC),
      maxTempC: round1(thermal.maxTempC),
      heaterWh: round1(thermal.heaterWh),
    }, `Surface temperature range ${round1(thermal.minTempC)} °C to ${round1(thermal.maxTempC)} °C; heater ${round1(thermal.heaterPowerW)} W / ${round1(thermal.heaterWh)} Wh.`),
  )
  reasons.push(
    reason(comms.earthVisibleFraction >= 0.4 ? 'comms.directGood' : comms.earthVisibleFraction >= 0.15 ? 'comms.directLimited' : 'comms.directPoor', comms.earthVisibleFraction >= 0.4 ? 'good' : comms.earthVisibleFraction >= 0.15 ? 'warn' : 'bad', {
      earthVisibleFraction: round4(comms.earthVisibleFraction),
      maxLosGapHours: round2(comms.maxLosGapHours),
      dataBudgetMb: round1(comms.dataBudgetMb),
    }, `Earth visibility ${round1(comms.earthVisibleFraction * 100)}%; longest LOS gap ${round2(comms.maxLosGapHours)} h; data budget ${round1(comms.dataBudgetMb)} Mb.`),
  )
  reasons.push(
    reason('safety.slope', safety.meanSlopeDeg <= 3 ? 'good' : safety.meanSlopeDeg <= 6 ? 'warn' : 'bad', {
      meanSlopeDeg: round2(safety.meanSlopeDeg),
      maxSlopeDeg: round2(safety.maxSlopeDeg),
      flatFraction: round4(safety.flatFraction),
    }, `Landing area mean slope ${round2(safety.meanSlopeDeg)}° (max ${round2(safety.maxSlopeDeg)}°), flat fraction ${round1(safety.flatFraction * 100)}%.`),
  )
  reasons.push(
    reason('safety.ellipse', safety.ellipse.fitRatio >= 1 ? 'good' : 'warn', {
      fitRatio: round4(safety.ellipse.fitRatio),
      requiredRadiusM: round1(safety.ellipse.requiredRadiusM),
      equivalentRadiusM: round1(safety.ellipse.equivalentRadiusM),
    }, `Landing ellipse ${round1(safety.ellipse.requiredRadiusM)} m radius fits at ${round1(Math.min(1, safety.ellipse.fitRatio) * 100)}% (zone equivalent radius ${round1(safety.ellipse.equivalentRadiusM)} m).`),
  )
  reasons.push(
    reason('safety.hazard', safety.hazard.craterHazard >= 0.5 ? 'good' : 'warn', {
      nearestCraterDistanceM: safety.hazard.nearestCraterDistanceM,
      cratersWithinReach: safety.hazard.cratersWithinReach,
      craterHazard: round4(safety.hazard.craterHazard),
    }, safety.hazard.nearestCraterDistanceM == null ? 'No crater hazard data available.' : `Nearest detected crater ${round1((safety.hazard.nearestCraterDistanceM ?? 0) / 1000)} km away; ${safety.hazard.cratersWithinReach} crater(s) within reach.`),
  )
  reasons.push(
    reason('logistics.access', curatedDistanceScore >= 0.5 ? 'good' : 'warn', {
      nearestCuratedSiteId: logistics.nearestCuratedSiteId,
      nearestCuratedSiteDistanceM: logistics.nearestCuratedSiteDistanceM,
      nearestFlatPadZoneId: logistics.nearestFlatPadZoneId,
      nearestFlatPadDistanceM: logistics.nearestFlatPadDistanceM,
    }, logistics.nearestCuratedSiteDistanceM == null ? 'No curated site is available as an access reference.' : `Nearest curated site ${round1((logistics.nearestCuratedSiteDistanceM ?? 0) / 1000)} km; nearest flat pad ${logistics.nearestFlatPadDistanceM == null ? 'none' : `${round1((logistics.nearestFlatPadDistanceM ?? 0) / 1000)} km`}.`),
  )
  reasons.push(
    reason('science.proximity', science.craterProximityScore >= 0.5 ? 'good' : 'warn', {
      nearestCraterDistanceM: science.nearestCraterDistanceM,
      craterProximityScore: round4(science.craterProximityScore),
      psrProximityScore: science.psrProximityScore,
    }, science.nearestCraterDistanceM == null ? 'No science target identified from the DEM.' : `Nearest science target (crater) ${round1((science.nearestCraterDistanceM ?? 0) / 1000)} km away.`),
  )

  // ---------------------------------------------------------------------
  // Legacy flat metric fields (kept for backward compatibility) + groups.
  // ---------------------------------------------------------------------
  const windowStartIso = window ? new Date(window.startMs).toISOString() : null
  const windowEndIso = window ? new Date(window.endMs).toISOString() : null
  const metrics = {
    // legacy flat fields
    sunlitFraction: round4(illumination.sunlitFraction),
    sunlitDays: round2(illumination.sunlitHours / 24),
    longestSunWindowDays: round2(illumination.continuousSunDays),
    sunDaysNeeded: normalizedMission.sunDaysNeeded,
    averageW: power.averageW,
    peakW: power.peakW,
    dailyWh: power.dailyWh,
    powerNeedW: normalizedMission.powerNeedW,
    powerMarginW: power.powerMarginW,
    earthVisibleFraction: comms.directEarthVisibleFraction,
    effectiveCommsFraction: comms.earthVisibleFraction,
    relayInOrbit: normalizedMission.relayInOrbit,
    commHours: comms.availableHours,
    commWindows: comms.windowCount,
    estimatedMb: comms.dataBudgetMb,
    dataNeedMb: normalizedMission.dataNeedMb,
    meetsDataNeed: comms.meetsDataNeed,
    meanSlopeDeg: safety.meanSlopeDeg,
    maxSlopeDeg: safety.maxSlopeDeg,
    meanElevationM: safety.meanElevationM,
    elevationRangeM: safety.reliefM,
    perimeterM: logistics.equivalentPerimeterM,
    mastM: normalizedMission.mastM,
    missionDays: window ? round2(window.days) : round2(normalizedMission.missionDays),
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    terrainId: terrain?.id ?? null,
    syntheticTerrain: terrain?.synthetic === true,
    ephemerisSiteId,
    zoneAreaKm2: round2(zone?.areaKm2 ?? 0),
    zoneMeanSlopeDeg: round2(zone?.meanSlopeDeg ?? 0),
    zoneMaxSlopeDeg: round2(zone?.maxSlopeDeg ?? 0),
    zoneReliefM: round1(zone?.reliefM ?? 0),
    zoneCellCount: zone?.cellCount ?? 0,
    zoneSuitability: round2(zone?.suitability ?? 0),
    // Exact mission inputs used for this scoring run (so the UI can prove the
    // displayed controls are the scored values).
    missionInputs: {
      powerNeedW: normalizedMission.powerNeedW,
      batteryCapacityWh: normalizedMission.batteryCapacityWh,
      batterySpecified: normalizedMission.batterySpecified === true,
      powerSource: normalizedMission.powerSource,
      rtgPowerW: normalizedMission.rtgPowerW,
      heaterMaxW: normalizedMission.heaterMaxW,
      heaterWPerK: normalizedMission.heaterWPerK,
      minOperatingC: normalizedMission.minOperatingC,
      maxOperatingC: normalizedMission.maxOperatingC,
      missionDays: round2(normalizedMission.missionDays),
      startTime: normalizedMission.startTime,
      dataNeedMb: normalizedMission.dataNeedMb,
      mastM: normalizedMission.mastM,
      relayInOrbit: normalizedMission.relayInOrbit,
    },
    // new convenient flat duplicates
    requiredBatteryWh: power.requiredBatteryWh,
    heaterWh: thermal.heaterWh,
    minTempC: thermal.minTempC,
    maxTempC: thermal.maxTempC,
    maxLosGapHours: comms.maxLosGapHours,
    nearestCraterDistanceM: safety.hazard.nearestCraterDistanceM,
    landingEllipseFit: safety.ellipse.fitRatio,
    // grouped mission variables
    safety,
    illumination,
    power,
    thermal,
    comms,
    logistics,
    science,
  }
  // Remove grouped helper arrays that the UI does not need and that bloat the
  // serialized response; keep compact stats.
  delete metrics.illumination.sunWindows
  delete metrics.illumination.eclipseGaps
  delete metrics.comms.gaps

  return {
    score,
    rawScore,
    scoreCapApplied,
    feasible: feasibility.feasible,
    feasibility,
    grade,
    gradeCode,
    confidence,
    components,
    metrics,
    reasons,
    warnings,
    inputSignature: signature,
    weights,
    window: window
      ? { start: windowStartIso, end: windowEndIso, days: round2(window.days), clamped: window.clamped }
      : null,
    modelVersion: LANDING_MODEL_VERSION,
  }
}

/**
 * Documented distance score used by logistics (1 at 0 km, 0 at 100 km).
 *
 * @param {number|null} distanceM
 * @returns {number} 0..1
 */
function commsDistanceScore(distanceM) {
  if (distanceM == null || !Number.isFinite(distanceM)) return 0.5
  return clamp(1 - distanceM / 100000, 0, 1)
}

/**
 * Build a reason record.
 *
 * @param {string} code
 * @param {'good'|'warn'|'bad'|'info'} severity
 * @param {Object} params
 * @param {string} text
 * @returns {{code: string, severity: string, params: Object, text: string}}
 */
function reason(code, severity, params, text) {
  return { code, severity, params, text }
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
 * Round to three decimal places.
 *
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(Number(value) * 1000) / 1000
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
