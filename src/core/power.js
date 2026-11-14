/**
 * Solar power estimation for a lunar south-pole site.
 *
 * At the lunar south pole the Sun stays within roughly ±1.6° of the horizon
 * (plus libration), so the real limiting factor for a solar array is not the
 * solar elevation alone but **terrain shadowing**: a ridge on the horizon hides
 * the Sun for part of the lunar day. The estimate therefore:
 *
 * 1. walks the mission window,
 * 2. interpolates the topocentric Sun position from the precomputed ephemeris,
 * 3. tests the Sun against the terrain horizon profile (ray-traced, with lunar
 *    curvature — the `engine` module),
 * 4. applies the incidence factor of the panel orientation and the array
 *    efficiency, and integrates instantaneous power into an average, a peak and
 *    a daily energy figure.
 *
 * The panel model is deliberately explicit so the assumptions are auditable:
 *
 * ```text
 * cos(incidence) = sin(el)·sin(normalEl) + cos(el)·cos(normalEl)·cos(az − normalAz)
 * P(t)           = S0 · cos(incidence) · A · η · derate      when the Sun is visible
 * P(t)           = 0                                         otherwise
 * ```
 *
 * where `S0` is the solar constant at 1 AU (1361 W/m²), `A` the array area, `η`
 * the cell efficiency and `derate` the wiring/dust/temperature derate. A vertical
 * panel (`normalEl = 0`) with single-axis azimuth tracking is the realistic
 * design for polar sites: it captures `cos(el) ≈ 1` whenever the Sun is visible
 * instead of the useless `sin(el)` of a horizontal panel.
 *
 * @module core/power
 */

import { DEG, clamp } from './geometry.js'
import { resolveSiteElevation } from './terrain.js'
import { horizonProfile as buildHorizonProfile, evaluateBodyVisibility } from './engine.js'
import { normalizeEphemerisDataset, sampleAt, toTimestamp } from './ephemeris.js'

/**
 * Default panel and mission power assumptions.
 *
 * @type {Readonly<{
 *   solarConstantWm2: number,
 *   panelAreaM2: number,
 *   panelEfficiency: number,
 *   systemDerate: number,
 *   panelNormalElevationDeg: number,
 *   panelAzimuthDeg: number,
 *   trackingAzimuth: boolean,
 * }>}
 */
export const DEFAULT_POWER_MODEL = Object.freeze({
  solarConstantWm2: 1361,
  panelAreaM2: 2,
  panelEfficiency: 0.28,
  systemDerate: 0.9,
  panelNormalElevationDeg: 0,
  panelAzimuthDeg: 0,
  trackingAzimuth: true,
})

/**
 * Merge a partial power model with the defaults and clamp to physical ranges.
 *
 * @param {Object} [model] Partial model (`mission.power`).
 * @returns {Object} Normalized power model.
 */
export function normalizePowerModel(model = {}) {
  const merged = { ...DEFAULT_POWER_MODEL, ...(model && typeof model === 'object' ? model : {}) }
  return {
    solarConstantWm2: Math.max(0, Number(merged.solarConstantWm2) || DEFAULT_POWER_MODEL.solarConstantWm2),
    panelAreaM2: Math.max(0, Number(merged.panelAreaM2) || 0),
    panelEfficiency: clamp(Number(merged.panelEfficiency) || 0, 0, 1),
    systemDerate: clamp(Number(merged.systemDerate) || 0, 0, 1),
    panelNormalElevationDeg: Number(merged.panelNormalElevationDeg) || 0,
    panelAzimuthDeg: Number(merged.panelAzimuthDeg) || 0,
    trackingAzimuth: merged.trackingAzimuth !== false,
  }
}

/**
 * Resolve the power model from a mission profile.
 *
 * Supports both the nested `mission.power` object and the flat UI fields
 * `mission.panelAreaM2` / `mission.panelEfficiency`; explicit nested values win.
 *
 * @param {Object} [mission] Mission profile.
 * @returns {Object} Normalized power model.
 */
export function powerModelFromMission(mission = {}) {
  const overrides = {}
  if (Number.isFinite(Number(mission.panelAreaM2))) overrides.panelAreaM2 = Number(mission.panelAreaM2)
  if (Number.isFinite(Number(mission.panelEfficiency))) {
    overrides.panelEfficiency = Number(mission.panelEfficiency)
  }
  if (mission.power && typeof mission.power === 'object') Object.assign(overrides, mission.power)
  return normalizePowerModel(overrides)
}

/**
 * Instantaneous electrical power from one solar array for a Sun position.
 *
 * Pure helper, independent of the terrain: it only applies the panel
 * orientation and efficiency. Visibility/shadowing is handled by
 * {@link solarPowerEstimate}.
 *
 * @param {{az: number, el: number}|null} sun Sun azimuth/elevation in degrees.
 * @param {Object} [model] Power model (see {@link DEFAULT_POWER_MODEL}).
 * @returns {number} Electrical power in watts (0 when the Sun is behind the panel).
 */
export function panelPowerW(sun, model = {}) {
  if (!sun || !Number.isFinite(sun.el) || !Number.isFinite(sun.az)) return 0
  const resolved = normalizePowerModel(model)
  const sunAz = sun.az * DEG
  const sunEl = sun.el * DEG
  const normalEl = resolved.panelNormalElevationDeg * DEG
  const normalAz = (resolved.trackingAzimuth ? sun.az : resolved.panelAzimuthDeg) * DEG
  const cosIncidence =
    Math.sin(sunEl) * Math.sin(normalEl) +
    Math.cos(sunEl) * Math.cos(normalEl) * Math.cos(sunAz - normalAz)
  if (!(cosIncidence > 0)) return 0
  return (
    resolved.solarConstantWm2 *
    cosIncidence *
    resolved.panelAreaM2 *
    resolved.panelEfficiency *
    resolved.systemDerate
  )
}

/**
 * Resolve the analysis window from the mission profile and dataset coverage.
 *
 * @param {Object} dataset Normalized ephemeris dataset.
 * @param {Object} mission Normalized mission profile.
 * @param {number} [fallbackDays=14] Window length when `missionDays` is missing.
 * @returns {{startMs: number, endMs: number, days: number, clamped: boolean}}
 */
export function missionWindow(dataset, mission = {}, fallbackDays = 14) {
  const requestedDays = Number(mission.missionDays) > 0 ? Number(mission.missionDays) : fallbackDays
  const startCandidate = Number.isFinite(toTimestamp(mission.startTime))
    ? toTimestamp(mission.startTime)
    : dataset.startMs
  let startMs = startCandidate
  let endMs = startMs + requestedDays * 86400 * 1000
  let clamped = false

  if (startMs < dataset.startMs) {
    startMs = dataset.startMs
    clamped = true
  }
  if (endMs > dataset.endMs) {
    endMs = dataset.endMs
    clamped = true
  }
  if (endMs - startMs < 3600 * 1000) {
    // The requested window is (almost) outside the dataset: analyse everything
    // that is available rather than returning an empty result.
    startMs = dataset.startMs
    endMs = dataset.endMs
    clamped = true
  }
  return {
    startMs,
    endMs,
    days: Math.max((endMs - startMs) / (86400 * 1000), 1 / 24),
    clamped,
  }
}

/**
 * Estimate solar power for a site over a mission window.
 *
 * Returns the instantaneous average over the whole window (`averageW`, night
 * included), the maximum instantaneous power (`peakW`, nominal array output) and
 * the energy per Earth day (`dailyWh`). `sunlitFraction` is the fraction of the
 * window with direct solar visibility (terrain and curvature included).
 *
 * @param {{lat: number, lon: number, elevationM?: number|null}} site Site.
 * @param {import('./terrain.js').Terrain|null} terrain DEM grid covering the site.
 * @param {import('./ephemeris.js').EphemerisDataset} ephemeris Precomputed ephemeris.
 * @param {Object} [mission] Mission profile (`missionDays`, `startTime`, `power`).
 * @returns {{
 *   averageW: number,
 *   peakW: number,
 *   dailyWh: number,
 *   sunlitFraction: number,
 *   sunlitSeconds: number,
 *   totalEnergyWh: number,
 *   windowDays: number,
 *   windowStart: string,
 *   windowEnd: string,
 *   clamped: boolean,
 *   model: Object,
 *   unavailable?: boolean,
 *   reason?: string,
 * }} Power estimate.
 */
export function solarPowerEstimate(site, terrain, ephemeris, mission = {}) {
  const model = powerModelFromMission(mission)
  if (!ephemeris) {
    return {
      averageW: 0,
      peakW: 0,
      dailyWh: 0,
      sunlitFraction: 0,
      sunlitSeconds: 0,
      totalEnergyWh: 0,
      windowDays: 0,
      windowStart: null,
      windowEnd: null,
      clamped: false,
      model,
      unavailable: true,
      reason: 'missing-ephemeris',
    }
  }

  const dataset = normalizeEphemerisDataset(ephemeris)
  const window = missionWindow(dataset, mission, 14)
  const stepMs = Math.max(1, Number(mission.stepSeconds) || 300) * 1000
  const profile = buildHorizonProfile(terrain, site, {
    stepDeg: Number(mission.profileStepDeg) > 0 ? Number(mission.profileStepDeg) : 1,
  })

  let totalEnergyWh = 0
  let peakW = 0
  let sunlitSeconds = 0
  let integratedSeconds = 0
  let previousPower = 0
  let previousTime = window.startMs

  const sampleCount = Math.floor((window.endMs - window.startMs) / stepMs)
  for (let index = 0; index <= sampleCount; index += 1) {
    const timestampMs = Math.min(window.startMs + index * stepMs, window.endMs)
    const sample = sampleAt(dataset, timestampMs)
    const visibility = evaluateBodyVisibility(terrain, site, sample.sun, { profile })
    const powerW = visibility.visible ? panelPowerW(sample.sun, model) : 0
    if (visibility.visible) sunlitSeconds += (timestampMs - previousTime) / 1000
    if (powerW > peakW) peakW = powerW

    // Trapezoidal integration between consecutive samples.
    const deltaHours = (timestampMs - previousTime) / 3600000
    if (deltaHours > 0) {
      totalEnergyWh += ((powerW + previousPower) / 2) * deltaHours
      integratedSeconds += deltaHours * 3600
    }
    previousPower = powerW
    previousTime = timestampMs
  }

  const windowSeconds = Math.max((window.endMs - window.startMs) / 1000, 1)
  return {
    averageW: integratedSeconds > 0 ? (totalEnergyWh / integratedSeconds) * 3600 : 0,
    peakW,
    dailyWh: totalEnergyWh / window.days,
    sunlitFraction: clamp(sunlitSeconds / windowSeconds, 0, 1),
    sunlitSeconds,
    totalEnergyWh,
    windowDays: window.days,
    windowStart: new Date(window.startMs).toISOString(),
    windowEnd: new Date(window.endMs).toISOString(),
    clamped: window.clamped,
    model,
    siteElevationM: resolveSiteElevation(terrain, site),
  }
}
