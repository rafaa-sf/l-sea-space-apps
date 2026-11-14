/**
 * Mission-start date search for the landing-zone autopilot.
 *
 * For every zone the autopilot can search the precomputed ephemeris window for
 * the earliest mission start that satisfies the full feasibility gate, instead
 * of judging only the current mission date. The search uses a fast screening
 * evaluation (ray-traced horizon cached per zone, coarse sampling) and the
 * winning date is then re-evaluated with the full `computeLandingMetrics`.
 *
 * Window limit: the shipped ephemeris covers 2026-11-01..2026-12-31. Candidate
 * starts are clipped so the mission duration fits inside that coverage; if the
 * mission is longer than the coverage the search window degenerates to the
 * coverage start and the mission window is clipped (documented/warned).
 *
 * @module core/dateSearch
 */

import { clamp } from './geometry.js'
import { horizonProfile, evaluateBodyVisibility } from './engine.js'
import { normalizeEphemerisDataset, sampleAt, toTimestamp } from './ephemeris.js'
import { missionWindow, panelPowerW, powerModelFromMission } from './power.js'
import { commsModelFromMission } from './comms.js'
import { normalizeMission } from './autopilot.js'
import { computeThermalMetrics, evaluateZoneFeasibility } from './landingMetrics.js'

/** Default date-search options. */
export const DEFAULT_DATE_SEARCH_OPTIONS = Object.freeze({
  enabled: true,
  stepHours: 12,
  evaluationStepSeconds: 1800,
  maxCandidates: 140,
  profileStepDeg: 2,
})

const MS_PER_HOUR = 3600 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Merge partial options with the date-search defaults.
 *
 * @param {Object} [options]
 * @returns {Object}
 */
export function normalizeDateSearchOptions(options = {}) {
  const merged = { ...DEFAULT_DATE_SEARCH_OPTIONS, ...(options && typeof options === 'object' ? options : {}) }
  return {
    enabled: merged.enabled !== false,
    stepHours: clamp(Number(merged.stepHours) || 12, 1, 72),
    evaluationStepSeconds: clamp(Number(merged.evaluationStepSeconds) || 1800, 300, 3600),
    maxCandidates: Math.max(1, Math.round(Number(merged.maxCandidates) || 140)),
    profileStepDeg: clamp(Number(merged.profileStepDeg) || 2, 0.5, 5),
  }
}

/**
 * Candidate mission-start window clipped to the ephemeris coverage.
 *
 * @param {Object} dataset Normalized ephemeris dataset.
 * @param {Object} mission Normalized mission profile.
 * @param {Object} options Normalized date-search options.
 * @returns {{startMs: number, endMs: number, latestStartMs: number, missionDays: number, coverageDays: number, clipped: boolean, stepMs: number, candidatesMs: number[]}}
 */
export function getDateSearchWindow(dataset, mission, options) {
  const opts = normalizeDateSearchOptions(options)
  const stepMs = opts.stepHours * MS_PER_HOUR
  const coverageDays = Math.max(0, (dataset.endMs - dataset.startMs) / MS_PER_DAY)
  const missionDays = Math.max(1 / 24, Math.min(Number(mission.missionDays) || 14, coverageDays || 14))
  const durationMs = missionDays * MS_PER_DAY
  const startMs = dataset.startMs
  const latestStartMs = Math.max(startMs, dataset.endMs - durationMs)
  const candidatesMs = []
  for (let timestampMs = startMs; timestampMs <= latestStartMs + 1 && candidatesMs.length < opts.maxCandidates; timestampMs += stepMs) {
    candidatesMs.push(Math.round(timestampMs))
  }
  return {
    startMs,
    endMs: dataset.endMs,
    latestStartMs,
    missionDays,
    coverageDays,
    clipped: Number(mission.missionDays) > coverageDays,
    stepMs,
    candidatesMs,
  }
}

/**
 * Fast screening evaluation of a mission start date.
 *
 * Samples Sun/Earth visibility through the cached ray-traced horizon at
 * `evaluationStepSeconds`, derives the illumination/thermal/power/comms metrics
 * needed by the feasibility gate and calls the authoritative
 * `evaluateZoneFeasibility`. The winning date is re-scored with the full metric
 * model; this fast path is only a screening filter.
 *
 * @param {{terrain: Object|null, site: Object, ephemeris: Object, mission: Object, startMs: number, profile: Object|null, options?: Object}} input
 * @returns {{feasible: boolean, feasibility: Object, window: Object}}
 */
export function evaluateDateCandidate({ terrain, site, ephemeris, mission, startMs, profile, options } = {}) {
  const dataset = normalizeEphemerisDataset(ephemeris)
  const normalizedMission = normalizeMission({ ...mission, startTime: new Date(startMs).toISOString() })
  const window = missionWindow(dataset, normalizedMission)
  const opts = normalizeDateSearchOptions(options)
  const stepMs = opts.evaluationStepSeconds * 1000
  const windowHours = Math.max((window.endMs - window.startMs) / MS_PER_HOUR, 1e-6)
  const powerModel = powerModelFromMission(normalizedMission)
  const commsModel = commsModelFromMission(normalizedMission)

  let samples = 0
  let sunlitSamples = 0
  let earthVisibleSamples = 0
  let currentSunMs = 0
  let longestSunMs = 0
  let currentDarkMs = 0
  let longestDarkMs = 0
  let sunWindows = 0
  let wasSunlit = false
  let sumPowerW = 0
  let maxPowerW = 0
  let energyWh = 0
  let sumSunElevation = 0
  let countSunElevation = 0
  let sumSunlitElevation = 0
  let countSunlitElevation = 0

  for (let timestampMs = window.startMs; timestampMs <= window.endMs; timestampMs += stepMs) {
    const sample = sampleAt(dataset, timestampMs)
    const sunVisible = evaluateBodyVisibility(terrain, site, sample.sun, { profile }).visible
    const earthVisible = evaluateBodyVisibility(terrain, site, sample.earth, { profile }).visible
    const deltaMs = Math.min(stepMs, Math.max(0, window.endMs - timestampMs))
    samples += 1
    if (sample.sun && Number.isFinite(sample.sun.el)) {
      sumSunElevation += sample.sun.el
      countSunElevation += 1
    }
    if (earthVisible) earthVisibleSamples += 1
    if (sunVisible) {
      sunlitSamples += 1
      if (sample.sun) { sumSunlitElevation += sample.sun.el; countSunlitElevation += 1 }
      currentSunMs += deltaMs
      longestSunMs = Math.max(longestSunMs, currentSunMs)
      currentDarkMs = 0
      if (!wasSunlit) sunWindows += 1
      const powerW = panelPowerW(sample.sun, powerModel)
      sumPowerW += powerW
      if (powerW > maxPowerW) maxPowerW = powerW
      energyWh += powerW * (deltaMs / MS_PER_HOUR)
    } else {
      currentDarkMs += deltaMs
      longestDarkMs = Math.max(longestDarkMs, currentDarkMs)
      currentSunMs = 0
    }
    wasSunlit = sunVisible
  }

  const sunlitFraction = samples > 0 ? sunlitSamples / samples : 0
  const sunlitHours = (sunlitSamples / Math.max(samples, 1)) * windowHours
  const eclipseHours = Math.max(0, windowHours - sunlitHours)
  const eclipseCount = sunWindows === 0 ? 1 : sunWindows
  const illumination = {
    sunlitFraction,
    sunlitHours,
    continuousSunDays: longestSunMs / MS_PER_DAY,
    longestEclipseHours: longestDarkMs / MS_PER_HOUR,
    longestEclipseStart: null,
    eclipseCount,
    eclipseHours,
    totalEclipseHours: eclipseHours,
    sunElevationMinDeg: countSunElevation > 0 ? null : null,
    sunElevationMaxDeg: null,
    sunElevationMeanWindowDeg: countSunElevation > 0 ? sumSunElevation / countSunElevation : null,
    sunElevationMeanSunlitDeg: countSunlitElevation > 0 ? sumSunlitElevation / countSunlitElevation : null,
    sunsetCount: sunWindows,
    sunriseCount: sunWindows,
    windowHours,
    monthlySunFraction: null,
  }
  const thermal = computeThermalMetrics({ illumination, mission: normalizedMission })
  const averageW = samples > 0 ? sumPowerW / samples : 0
  const powerNeedW = Math.max(0, Number(normalizedMission.powerNeedW) || 0)
  const heaterPowerSizedW = thermal.heaterPowerSizedW ?? thermal.heaterPowerW ?? 0
  const heaterAveragePowerW = thermal.heaterAveragePowerW ?? 0
  const demandW = Math.max(powerNeedW + heaterAveragePowerW, 1e-6)
  const powerSource = normalizedMission.powerSource === 'rtg' ? 'rtg' : 'solar'
  let power
  if (powerSource === 'rtg') {
    const rtgPowerW = Math.max(0, Number(normalizedMission.rtgPowerW) || 0)
    power = {
      source: 'rtg',
      rtgPowerW,
      rtgMarginW: rtgPowerW - demandW,
      averageW: rtgPowerW,
      maxW: rtgPowerW,
      minW: rtgPowerW,
      peakW: rtgPowerW,
      powerNeedW,
      heaterAveragePowerW,
      powerMarginW: rtgPowerW - demandW,
      requiredBatteryWh: 0,
      eclipseDeficitWh: 0,
      totalEclipseEnergyWh: 0,
      longestEclipseHours: illumination.longestEclipseHours,
      totalEclipseHours: eclipseHours,
      batteryCapacityWh: Math.max(0, Number(normalizedMission.batteryCapacityWh) || 0),
      batteryCoverage: 1,
      meetsPowerNeed: rtgPowerW >= demandW,
    }
  } else {
    const eclipseDeficitWh = (powerNeedW + heaterPowerSizedW) * illumination.longestEclipseHours
    const totalEclipseEnergyWh = (powerNeedW + heaterPowerSizedW) * eclipseHours
    const requiredBatteryWh = eclipseDeficitWh /
      Math.max(normalizedMission.batteryRoundTripEfficiency * normalizedMission.batteryDepthOfDischarge, 1e-6)
    const batteryCapacityWh = Math.max(0, Number(normalizedMission.batteryCapacityWh) || 0)
    const powerMarginW = averageW - powerNeedW - heaterAveragePowerW
    power = {
      source: 'solar',
      averageW,
      maxW: maxPowerW,
      minW: 0,
      peakW: maxPowerW,
      powerNeedW,
      heaterAveragePowerW,
      heaterPowerSizedW,
      powerMarginW,
      requiredBatteryWh,
      eclipseDeficitWh,
      totalEclipseEnergyWh,
      longestEclipseHours: illumination.longestEclipseHours,
      totalEclipseHours: eclipseHours,
      batteryCapacityWh,
      batteryCoverage: clamp(batteryCapacityWh / Math.max(requiredBatteryWh, 1e-9), 0, 1),
      meetsPowerNeed: powerMarginW >= 0 && requiredBatteryWh <= batteryCapacityWh + 1e-9,
    }
  }
  const directFraction = samples > 0 ? earthVisibleSamples / samples : 0
  const relayCoverage = commsModel.relayCoverage
  const effectiveFraction = normalizedMission.relayInOrbit
    ? Math.max(directFraction, relayCoverage)
    : directFraction
  const availableHours = effectiveFraction * windowHours
  const rateMbps = normalizedMission.relayInOrbit ? commsModel.relayDataRateMbps : commsModel.dataRateMbps
  // Full model (comms.dataBudget) uses durationSeconds × rateMbps; keep units.
  const dataBudgetMb = availableHours * 3600 * rateMbps
  const dataNeedMb = normalizedMission.dataNeedMb
  const comms = {
    directEarthVisibleFraction: directFraction,
    earthVisibleFraction: effectiveFraction,
    maxLosGapHours: 0,
    directMaxLosGapHours: 0,
    availableHours,
    dataBudgetMb,
    dataNeedMb,
    dataBudgetRatio: dataNeedMb != null && dataNeedMb > 0 ? dataBudgetMb / dataNeedMb : null,
    dataBudgetCoverage: dataNeedMb != null && dataNeedMb > 0 ? clamp(dataBudgetMb / dataNeedMb, 0, 1) : null,
    meetsDataNeed: dataNeedMb != null && dataNeedMb > 0 ? dataBudgetMb >= dataNeedMb : null,
    relayInOrbit: normalizedMission.relayInOrbit,
    relayCoverage,
  }
  const feasibility = evaluateZoneFeasibility({
    power,
    thermal,
    comms,
    illumination,
    safety: null,
    mission: normalizedMission,
    ephemerisAvailable: true,
    terrainAvailable: Boolean(terrain),
  })
  return { feasible: feasibility.feasible, feasibility, window }
}

/**
 * Find the earliest feasible mission start date for one zone.
 *
 * @param {{terrain: Object|null, zone: Object, ephemeris: Object, mission: Object, options?: Object}} input
 * @returns {{hasFeasibleDate: boolean, feasibleDate: string|null, feasibleDateMs: number|null, feasibleDatesSearched: number, searchWindow: Object, evaluation: Object|null, warnings: string[]}}
 */
export function searchFeasibleDate({ terrain, zone, ephemeris, mission, options } = {}) {
  const dataset = normalizeEphemerisDataset(ephemeris)
  const normalizedMission = normalizeMission(mission ?? {})
  const opts = normalizeDateSearchOptions(options)
  const searchWindow = getDateSearchWindow(dataset, normalizedMission, opts)
  const warnings = []
  if (searchWindow.clipped) warnings.push('mission-longer-than-ephemeris: mission window clipped to the available coverage')
  const profile = options?.profile ?? (terrain ? horizonProfile(terrain, zone, { stepDeg: opts.profileStepDeg }) : null)
  let searched = 0
  for (const candidateMs of searchWindow.candidatesMs) {
    searched += 1
    const evaluation = evaluateDateCandidate({
      terrain,
      site: zone,
      ephemeris: dataset,
      mission: normalizedMission,
      startMs: candidateMs,
      profile,
      options: opts,
    })
    if (evaluation.feasible) {
      return {
        hasFeasibleDate: true,
        feasibleDate: new Date(candidateMs).toISOString(),
        feasibleDateMs: candidateMs,
        feasibleDatesSearched: searched,
        searchWindow,
        evaluation,
        warnings,
      }
    }
  }
  return {
    hasFeasibleDate: false,
    feasibleDate: null,
    feasibleDateMs: null,
    feasibleDatesSearched: searched,
    searchWindow,
    evaluation: null,
    warnings,
  }
}
