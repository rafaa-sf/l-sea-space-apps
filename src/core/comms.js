/**
 * Communications: Earth line-of-sight windows, relay-in-orbit coverage and data
 * budget.
 *
 * Direct-to-Earth communications from the lunar south pole are the same kind of
 * problem as sunlight: the Earth stays close to the horizon, so the terrain
 * decides whether a link is possible. The Earth also has an apparent angular
 * radius of about 0.95° seen from the Moon, which matters when the disk grazes a
 * ridge — that is exposed through `earthLimbRadiusDeg`.
 *
 * The relay option models a communications asset in lunar orbit. It is a
 * documented simplification: the relay is assumed to be available for
 * `relayCoverage` of each `relayPeriodMinutes` orbit period (default: fully
 * available), and it provides `relayDataRateMbps` instead of the direct-to-Earth
 * rate. This keeps the mission-scoring logic honest about the assumption instead
 * of hiding an orbital propagator that the app does not have.
 *
 * @module core/comms
 */

import { clamp } from './geometry.js'
import { normalizeEphemerisDataset, visibilityWindows, toTimestamp } from './ephemeris.js'

/**
 * Default communications model assumptions.
 *
 * @type {Readonly<{
 *   dataRateMbps: number,
 *   relayDataRateMbps: number,
 *   relayCoverage: number,
 *   relayPeriodMinutes: number,
 *   earthLimbRadiusDeg: number,
 * }>}
 */
export const DEFAULT_COMMS_MODEL = Object.freeze({
  dataRateMbps: 1,
  relayDataRateMbps: 2,
  relayCoverage: 1,
  relayPeriodMinutes: 120,
  earthLimbRadiusDeg: 0,
})

/**
 * Merge a partial communications model with the defaults and clamp it.
 *
 * @param {Object} [model] Partial model (`mission.comms`).
 * @returns {Object} Normalized communications model.
 */
export function normalizeCommsModel(model = {}) {
  const merged = { ...DEFAULT_COMMS_MODEL, ...(model && typeof model === 'object' ? model : {}) }
  return {
    dataRateMbps: Math.max(0, Number(merged.dataRateMbps) || 0),
    relayDataRateMbps: Math.max(0, Number(merged.relayDataRateMbps) || 0),
    relayCoverage: clamp(Number(merged.relayCoverage) || 0, 0, 1),
    relayPeriodMinutes: Math.max(1, Number(merged.relayPeriodMinutes) || DEFAULT_COMMS_MODEL.relayPeriodMinutes),
    earthLimbRadiusDeg: Number(merged.earthLimbRadiusDeg) || 0,
  }
}

/**
 * Communications windows between two dates.
 *
 * With `mission.relayInOrbit` the windows describe relay availability
 * (`source: 'relay'`); otherwise they are direct Earth line-of-sight windows
 * computed with the terrain horizon (`source: 'earth'`).
 *
 * @param {{lat: number, lon: number, elevationM?: number|null}} site Site.
 * @param {import('./terrain.js').Terrain|null} terrain DEM grid covering the site.
 * @param {import('./ephemeris.js').EphemerisDataset} ephemeris Precomputed ephemeris.
 * @param {Object} [mission] Mission profile (`relayInOrbit`, `startTime`, `missionDays`, `comms`).
 * @param {Date|number|string} [from] Window start (defaults to dataset start / mission start).
 * @param {Date|number|string} [to] Window end (defaults to mission end / dataset end).
 * @returns {Array<{from: string, to: string, durationSeconds: number, source: 'earth'|'relay'}>}
 */
export function commWindows(site, terrain, ephemeris, mission = {}, from, to) {
  const model = normalizeCommsModel(mission.comms)
  if (!ephemeris) return []
  const dataset = normalizeEphemerisDataset(ephemeris)

  const missionDays = Number(mission.missionDays) > 0 ? Number(mission.missionDays) : 14
  let fromMs = Number.isFinite(toTimestamp(from))
    ? toTimestamp(from)
    : Number.isFinite(toTimestamp(mission.startTime))
      ? toTimestamp(mission.startTime)
      : dataset.startMs
  let toMs = Number.isFinite(toTimestamp(to)) ? toTimestamp(to) : fromMs + missionDays * 86400 * 1000

  if (mission.relayInOrbit) {
    fromMs = Math.max(fromMs, dataset.startMs)
    toMs = Math.min(toMs, dataset.endMs)
    if (toMs <= fromMs) return []
    return relayWindows(fromMs, toMs, model)
  }

  const windows = visibilityWindows(dataset, site, terrain, 'earth', fromMs, toMs, {
    stepSeconds: Number(mission.stepSeconds) || 120,
    limbRadiusDeg: model.earthLimbRadiusDeg,
    profileStepDeg: mission.profileStepDeg,
  })
  return windows.map((window) => ({ ...window, source: 'earth' }))
}

/**
 * Generate relay availability windows for a circular-orbit coverage model.
 *
 * @param {number} fromMs Start timestamp.
 * @param {number} toMs End timestamp.
 * @param {Object} model Normalized communications model.
 * @returns {Array<{from: string, to: string, durationSeconds: number, source: 'relay'}>}
 */
function relayWindows(fromMs, toMs, model) {
  const periodMs = model.relayPeriodMinutes * 60 * 1000
  const visibleMs = periodMs * model.relayCoverage
  const windows = []
  if (visibleMs <= 0 || toMs <= fromMs) return windows
  // Continuous coverage is represented as a single window.
  if (model.relayCoverage >= 0.999) {
    return [
      {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        durationSeconds: (toMs - fromMs) / 1000,
        source: 'relay',
      },
    ]
  }

  for (let startMs = fromMs; startMs < toMs; startMs += periodMs) {
    const endMs = Math.min(startMs + visibleMs, toMs)
    if (endMs <= startMs) continue
    windows.push({
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
      durationSeconds: (endMs - startMs) / 1000,
      source: 'relay',
    })
  }
  return windows
}

/**
 * Data budget for a set of communications windows.
 *
 * `estimatedMb` is in **megabits** (`Mbps × seconds`), the usual link-budget
 * unit; `estimatedMB` is the same value in megabytes. When the mission declares
 * a `dataNeedMb`, the function also reports whether the need is covered.
 *
 * @param {Array<{from: string, to: string, durationSeconds?: number, source?: string}>} commWindows
 * @param {Object} [mission] Mission profile (`comms`, `dataNeedMb`).
 * @returns {{
 *   totalSeconds: number,
 *   totalHours: number,
 *   windowCount: number,
 *   estimatedMb: number,
 *   estimatedMB: number,
 *   averageMbps: number,
 *   dataNeedMb: number|null,
 *   meetsDataNeed: boolean|null,
 *   marginMb: number|null,
 *   model: Object,
 * }}
 */
export function dataBudget(commWindows, mission = {}) {
  const model = normalizeCommsModel(mission.comms)
  let totalSeconds = 0
  let estimatedMb = 0

  for (const window of commWindows ?? []) {
    const fromMs = toTimestamp(window.from)
    const toMs = toTimestamp(window.to)
    const durationSeconds =
      Number.isFinite(window.durationSeconds) && window.durationSeconds >= 0
        ? window.durationSeconds
        : Number.isFinite(fromMs) && Number.isFinite(toMs)
          ? Math.max(0, (toMs - fromMs) / 1000)
          : 0
    const rateMbps = window.source === 'relay' ? model.relayDataRateMbps : model.dataRateMbps
    totalSeconds += durationSeconds
    estimatedMb += durationSeconds * rateMbps
  }

  const dataNeedMb = Number.isFinite(Number(mission.dataNeedMb)) ? Number(mission.dataNeedMb) : null
  return {
    totalSeconds,
    totalHours: totalSeconds / 3600,
    windowCount: Array.isArray(commWindows) ? commWindows.length : 0,
    estimatedMb,
    estimatedMB: estimatedMb / 8,
    averageMbps: totalSeconds > 0 ? estimatedMb / totalSeconds : 0,
    dataNeedMb,
    meetsDataNeed: dataNeedMb != null ? estimatedMb >= dataNeedMb : null,
    marginMb: dataNeedMb != null ? estimatedMb - dataNeedMb : null,
    model,
  }
}

/**
 * Convenience helper combining communications windows and their data budget.
 *
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @param {import('./terrain.js').Terrain|null} terrain
 * @param {import('./ephemeris.js').EphemerisDataset} ephemeris
 * @param {Object} [mission]
 * @param {Date|number|string} [from]
 * @param {Date|number|string} [to]
 * @returns {{
 *   windows: Array<Object>,
 *   budget: Object,
 *   model: Object,
 *   availableSeconds: number,
 *   availabilityFraction: number,
 * }}
 */
export function commSummary(site, terrain, ephemeris, mission = {}, from, to) {
  const windows = commWindows(site, terrain, ephemeris, mission, from, to)
  const budget = dataBudget(windows, mission)
  const model = normalizeCommsModel(mission.comms)
  const fromMs = Number.isFinite(toTimestamp(from))
    ? toTimestamp(from)
    : Number.isFinite(toTimestamp(mission.startTime))
      ? toTimestamp(mission.startTime)
      : ephemeris
        ? normalizeEphemerisDataset(ephemeris).startMs
        : Number.NaN
  const toMs = Number.isFinite(toTimestamp(to))
    ? toTimestamp(to)
    : Number.isFinite(fromMs)
      ? fromMs + (Number(mission.missionDays) > 0 ? Number(mission.missionDays) : 14) * 86400 * 1000
      : Number.NaN
  const totalSeconds = Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, (toMs - fromMs) / 1000) : 0
  return {
    windows,
    budget,
    model,
    availableSeconds: budget.totalSeconds,
    availabilityFraction: totalSeconds > 0 ? clamp(budget.totalSeconds / totalSeconds, 0, 1) : 0,
  }
}
