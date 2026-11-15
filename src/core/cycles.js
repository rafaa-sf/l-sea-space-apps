/**
 * Mission cycles: weekly sunlight/eclipse and Earth-link/no-link intervals over
 * the mission window, including the relay-in-orbit option.
 *
 * The user-facing question is "which weeks of the mission have sunlight/shadow,
 * and when do we have an Earth link — with or without a relay?" This module
 * answers it by sampling the same ray-traced terrain horizon and precomputed
 * Sun/Earth ephemeris used by the rest of the core:
 *
 * - the mission window comes from `mission.startTime` + `mission.missionDays`,
 *   clipped to the precomputed ephemeris coverage;
 * - Sun and Earth visibility are computed with the terrain horizon profile
 *   (lunar curvature included) at a sampling step of at most 30 minutes, with
 *   bisection-refined interval boundaries;
 * - contiguous visible samples are merged into intervals and complement gaps are
 *   filled, so every row is a complete `sun|eclipse` or `link|gap` partition of
 *   the window clipped at both ends;
 * - the relay row unions the documented relay coverage windows
 *   (`relayCoverage` per `relayPeriodMinutes`) with the direct line-of-sight
 *   windows; `benefitHours` is the extra connected time the relay provides;
 * - weeks are 7-day blocks measured from the mission start (partial first/last
 *   weeks allowed), each with its own hour summaries.
 *
 * Documented simplifications: the relay is a time-fraction coverage model, not
 * an orbit propagation; the horizon is the cached ray-traced profile at the
 * configured azimuth step; weeks are Earth 7-day blocks, not lunar days.
 *
 * @module core/cycles
 */

import { clamp } from './geometry.js'
import { horizonProfile } from './engine.js'
import { normalizeEphemerisDataset, toTimestamp, visibilityWindows } from './ephemeris.js'
import { commWindows, normalizeCommsModel } from './comms.js'
import { missionWindow } from './power.js'
import { normalizeMission } from './autopilot.js'

/** Model identifier written into every result (part of the input signature). */
export const MISSION_CYCLES_MODEL_VERSION = 'mission-cycles/1'

/** Default options for the cycle computation. */
export const DEFAULT_CYCLES_OPTIONS = Object.freeze({
  stepSeconds: 600, // 10 min sampling (the contract allows up to 30 min)
  profileStepDeg: 2,
})

const MS_PER_HOUR = 3600 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * Merge overlapping or touching time windows and clip them to a window.
 *
 * @param {Array<{from: string|number, to: string|number}>} windows Raw windows (ISO or ms).
 * @param {number} fromMs Clip start (ms).
 * @param {number} toMs Clip end (ms).
 * @returns {Array<{fromMs: number, toMs: number}>} Sorted, merged windows.
 */
export function mergeWindows(windows, fromMs, toMs) {
  const normalized = []
  for (const window of Array.isArray(windows) ? windows : []) {
    const start = Math.max(
      fromMs,
      window?.fromMs ?? toTimestamp(window?.from ?? window?.startMs ?? window?.start),
    )
    const end = Math.min(
      toMs,
      window?.toMs ?? toTimestamp(window?.to ?? window?.endMs ?? window?.end),
    )
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      normalized.push({ fromMs: start, toMs: end })
    }
  }
  normalized.sort((a, b) => a.fromMs - b.fromMs)
  const merged = []
  for (const window of normalized) {
    const last = merged[merged.length - 1]
    if (last && window.fromMs <= last.toMs + 1) {
      last.toMs = Math.max(last.toMs, window.toMs)
    } else {
      merged.push({ ...window })
    }
  }
  return merged
}

/**
 * Build a complete interval partition of `[fromMs, toMs]` from visible windows.
 *
 * @param {Array<{from: string|number, to: string|number}>} windows Visible windows.
 * @param {number} fromMs Window start (ms).
 * @param {number} toMs Window end (ms).
 * @param {string} visibleKind Kind for visible intervals (`'sun'`, `'link'`).
 * @param {string} hiddenKind Kind for the complement (`'eclipse'`, `'gap'`).
 * @returns {Array<{startMs: number, endMs: number, start: string, end: string, kind: string, hours: number}>}
 */
export function partitionIntervals(windows, fromMs, toMs, visibleKind, hiddenKind) {
  const merged = mergeWindows(windows, fromMs, toMs)
  const intervals = []
  let cursor = fromMs
  const push = (startMs, endMs, kind) => {
    intervals.push({
      startMs,
      endMs,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      kind,
      hours: (endMs - startMs) / MS_PER_HOUR,
    })
  }
  for (const window of merged) {
    if (window.fromMs > cursor) push(cursor, window.fromMs, hiddenKind)
    push(window.fromMs, window.toMs, visibleKind)
    cursor = Math.max(cursor, window.toMs)
  }
  if (cursor < toMs) push(cursor, toMs, hiddenKind)
  return intervals
}

/**
 * Sum interval hours by kind.
 *
 * @param {Array<{endMs: number, startMs: number, kind: string}>} intervals
 * @returns {Record<string, number>} Hours per kind.
 */
export function hoursByKind(intervals) {
  const hours = {}
  for (const interval of Array.isArray(intervals) ? intervals : []) {
    hours[interval.kind] = (hours[interval.kind] ?? 0) + (interval.endMs - interval.startMs) / MS_PER_HOUR
  }
  return hours
}

/**
 * Count intervals per kind.
 *
 * @param {Array<{kind: string}>} intervals
 * @returns {Record<string, number>} Count per kind.
 */
export function countByKind(intervals) {
  const counts = {}
  for (const interval of Array.isArray(intervals) ? intervals : []) {
    counts[interval.kind] = (counts[interval.kind] ?? 0) + 1
  }
  return counts
}

/**
 * Split the window into 7-day blocks measured from the mission start.
 *
 * @param {number} startMs Window start (ms).
 * @param {number} endMs Window end (ms).
 * @returns {Array<{index: number, startMs: number, endMs: number, start: string, end: string, days: number}>}
 */
export function splitWeeks(startMs, endMs) {
  const weeks = []
  let cursor = startMs
  let index = 1
  while (cursor < endMs) {
    const weekEnd = Math.min(endMs, cursor + MS_PER_WEEK)
    weeks.push({
      index,
      startMs: cursor,
      endMs: weekEnd,
      start: new Date(cursor).toISOString(),
      end: new Date(weekEnd).toISOString(),
      days: (weekEnd - cursor) / MS_PER_DAY,
    })
    cursor = weekEnd
    index += 1
  }
  return weeks
}

/**
 * Clip a full interval partition to a sub-window.
 *
 * @param {Array<{startMs: number, endMs: number, kind: string}>} intervals
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Array<{startMs: number, endMs: number, start: string, end: string, kind: string, hours: number}>}
 */
function clipIntervals(intervals, fromMs, toMs) {
  const clipped = []
  for (const interval of Array.isArray(intervals) ? intervals : []) {
    const startMs = Math.max(fromMs, interval.startMs)
    const endMs = Math.min(toMs, interval.endMs)
    if (endMs > startMs) {
      clipped.push({
        startMs,
        endMs,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        kind: interval.kind,
        hours: (endMs - startMs) / MS_PER_HOUR,
      })
    }
  }
  return clipped
}

/**
 * Count intervals that overlap a sub-window and sum their clipped hours.
 *
 * @param {Array<{startMs: number, endMs: number, kind: string}>} intervals Full partition.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {{hours: Record<string, number>, counts: Record<string, number>, intervals: Array<Object>}}
 */
function summarizeWindow(intervals, fromMs, toMs) {
  const clipped = clipIntervals(intervals, fromMs, toMs)
  const hours = {}
  const counts = {}
  for (const interval of clipped) {
    hours[interval.kind] = (hours[interval.kind] ?? 0) + interval.hours
    counts[interval.kind] = (counts[interval.kind] ?? 0) + 1
  }
  return { hours, counts, intervals: clipped }
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
 * FNV-1a 32-bit hash of a deterministic JSON serialization (8 hex chars).
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
 * Deterministic input signature for a cycle computation. Changes whenever the
 * terrain region, site, mission window/relay option or sampling settings change.
 *
 * @param {{terrain: Object|null, site: Object|null, mission: Object, ephemeris: Object|null, options: Object}} input
 * @returns {string}
 */
export function computeCyclesSignature({ terrain, site, mission, ephemeris, options }) {
  return fnv1a({
    model: MISSION_CYCLES_MODEL_VERSION,
    terrain: terrain
      ? {
          id: terrain.id ?? null,
          width: terrain.width ?? null,
          height: terrain.height ?? null,
          pixelSizeM: terrain.pixelSizeM ?? null,
          minX: terrain.minX ?? terrain.lon0 ?? null,
          maxY: terrain.maxY ?? terrain.lat1 ?? null,
          synthetic: terrain.synthetic === true,
        }
      : null,
    site: site
      ? { id: site.id ?? null, lat: site.lat, lon: site.lon, elevationM: site.elevationM ?? null, ephemerisSiteId: site.ephemerisSiteId ?? null }
      : null,
    mission: {
      startTime: mission.startTime ?? null,
      missionDays: mission.missionDays,
      relayInOrbit: mission.relayInOrbit,
      relayCoverage: mission.comms?.relayCoverage ?? null,
      relayPeriodMinutes: mission.comms?.relayPeriodMinutes ?? null,
      stepSeconds: mission.stepSeconds ?? null,
    },
    ephemeris: ephemeris
      ? { siteId: ephemeris.siteId ?? null, startMs: ephemeris.startMs ?? null, endMs: ephemeris.endMs ?? null, samples: ephemeris.samples?.length ?? null }
      : null,
    options,
  })
}

/**
 * Compute weekly sunlight/eclipse and Earth-link/relay cycles over the mission
 * window for one site or landing zone.
 *
 * @param {{
 *   terrain: import('./terrain.js').Terrain|null,
 *   site: {lat: number, lon: number, elevationM?: number|null, id?: string, ephemerisSiteId?: string|null},
 *   ephemeris: import('./ephemeris.js').EphemerisDataset,
 *   mission?: Object,
 *   options?: {stepSeconds?: number, profileStepDeg?: number},
 * }} input
 * @returns {Object} Cycles result (see module documentation).
 * @throws {TypeError} When no ephemeris dataset is provided.
 */
export function computeMissionCycles({ terrain, site, ephemeris, mission, options } = {}) {
  if (!ephemeris) throw new TypeError('computeMissionCycles requires an ephemeris dataset')
  if (!site || !Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.lon))) {
    throw new TypeError('computeMissionCycles requires a site with finite lat/lon')
  }
  const normalizedMission = normalizeMission(mission ?? {})
  const dataset = normalizeEphemerisDataset(ephemeris)
  const mergedOptions = { ...DEFAULT_CYCLES_OPTIONS, ...(options ?? {}) }
  // Contract: sampling must not be coarser than 30 minutes.
  const stepSeconds = clamp(Number(mergedOptions.stepSeconds) || 600, 60, 1800)
  const profileStepDeg = clamp(Number(mergedOptions.profileStepDeg) || 2, 0.5, 5)
  const commsModel = normalizeCommsModel(normalizedMission.comms)

  const resolvedWindow = missionWindow(dataset, normalizedMission)
  const fromMs = resolvedWindow.startMs
  const toMs = resolvedWindow.endMs
  const days = Math.max(0, (toMs - fromMs) / MS_PER_DAY)
  const windowHours = (toMs - fromMs) / MS_PER_HOUR
  const warnings = []
  if (!terrain) warnings.push('no-terrain: horizon assumed clear; Sun/Earth visibility may be optimistic')
  if (resolvedWindow.clamped) warnings.push('window-clamped: the mission window was clipped to the ephemeris coverage')

  // One ray-traced horizon profile for the whole run (engine caches it per
  // terrain+site, so other panels share it too).
  const profile = terrain
    ? horizonProfile(terrain, site, { stepDeg: profileStepDeg })
    : null
  const visibilityOptions = { stepSeconds, profile }

  // Intervals shorter than the ephemeris resolution cannot be resolved by the
  // 30-minute dataset: drop them as sampling slivers (e.g. a window created only
  // because the dataset ends exactly on a transition).
  const minIntervalSeconds = Math.max(
    stepSeconds,
    Math.min(Number(dataset.stepSeconds) || 1800, 1800),
  )
  const minIntervalMs = minIntervalSeconds * 1000
  const filterResolvable = (windows) =>
    (Array.isArray(windows) ? windows : []).filter((window) => {
      const start = Math.max(fromMs, toTimestamp(window.from))
      const end = Math.min(toMs, toTimestamp(window.to))
      return Number.isFinite(start) && Number.isFinite(end) && end - start >= minIntervalMs
    })

  const sunWindows = filterResolvable(
    visibilityWindows(dataset, site, terrain, 'sun', fromMs, toMs, visibilityOptions),
  )
  const directWindows = filterResolvable(
    visibilityWindows(dataset, site, terrain, 'earth', fromMs, toMs, {
      ...visibilityOptions,
      limbRadiusDeg: commsModel.earthLimbRadiusDeg,
    }),
  )

  const sunlightIntervals = partitionIntervals(sunWindows, fromMs, toMs, 'sun', 'eclipse')
  const directIntervals = partitionIntervals(directWindows, fromMs, toMs, 'link', 'gap')
  const sunHours = hoursByKind(sunlightIntervals)
  const directHours = hoursByKind(directIntervals)
  const sunCounts = countByKind(sunlightIntervals)
  const directCounts = countByKind(directIntervals)

  // Relay-in-orbit: union of direct line-of-sight and relay coverage windows.
  const relayEnabled = normalizedMission.relayInOrbit === true
  let relayIntervals = []
  let relayOnlyWindows = []
  let relayHours = { link: 0, gap: windowHours }
  let relayCounts = { gap: 1 }
  if (relayEnabled) {
    const relayMission = { ...normalizedMission, relayInOrbit: true }
    const relayWindows = commWindows(site, terrain, dataset, relayMission, fromMs, toMs)
    const unionWindows = mergeWindows(
      [...directWindows, ...relayWindows],
      fromMs,
      toMs,
    )
    relayIntervals = partitionIntervals(unionWindows, fromMs, toMs, 'link', 'gap')
    // Relay-only windows (availability the relay adds on top of direct LOS).
    relayOnlyWindows = relayWindows
      .map((window) => ({
        from: Math.max(fromMs, toTimestamp(window.from)),
        to: Math.min(toMs, toTimestamp(window.to)),
      }))
      .filter((window) => window.to > window.from)
      .flatMap((window) => {
        // Subtract direct coverage by walking the direct windows.
        const pieces = []
        let cursor = window.from
        for (const direct of mergeWindows(directWindows, fromMs, toMs)) {
          if (direct.toMs <= cursor) continue
          if (direct.fromMs >= window.to) break
          if (direct.fromMs > cursor) pieces.push({ from: cursor, to: Math.min(direct.fromMs, window.to) })
          cursor = Math.max(cursor, direct.toMs)
          if (cursor >= window.to) break
        }
        if (cursor < window.to) pieces.push({ from: cursor, to: window.to })
        return pieces.filter((piece) => piece.to > piece.from)
      })
    relayHours = hoursByKind(relayIntervals)
    relayCounts = countByKind(relayIntervals)
  }
  const directLinkHours = directHours.link ?? 0
  const relayLinkHours = relayEnabled ? relayHours.link ?? 0 : directLinkHours
  const relayGapHours = relayEnabled ? relayHours.gap ?? 0 : directHours.gap ?? 0
  const benefitHours = Math.max(0, relayLinkHours - directLinkHours)

  // Per-week summaries + clipped intervals for rendering.
  const weeks = splitWeeks(fromMs, toMs).map((week) => {
    const sunlightSummary = summarizeWindow(sunlightIntervals, week.startMs, week.endMs)
    const directSummary = summarizeWindow(directIntervals, week.startMs, week.endMs)
    const relaySummary = relayEnabled
      ? summarizeWindow(relayIntervals, week.startMs, week.endMs)
      : { hours: directSummary.hours, counts: directSummary.counts, intervals: directSummary.intervals }
    const sunH = sunlightSummary.hours.sun ?? 0
    const eclipseH = sunlightSummary.hours.eclipse ?? 0
    const linkH = directSummary.hours.link ?? 0
    const gapH = directSummary.hours.gap ?? 0
    const relayLinkH = relaySummary.hours.link ?? 0
    const relayGapH = relaySummary.hours.gap ?? 0
    return {
      index: week.index,
      startMs: week.startMs,
      endMs: week.endMs,
      start: week.start,
      end: week.end,
      days: week.days,
      sunHours: round2(sunH),
      eclipseHours: round2(eclipseH),
      sunPeriods: sunlightSummary.counts.sun ?? 0,
      eclipsePeriods: sunlightSummary.counts.eclipse ?? 0,
      sunlitFraction: week.endMs > week.startMs ? round4(sunH / ((week.endMs - week.startMs) / MS_PER_HOUR)) : 0,
      linkHours: round2(linkH),
      gapHours: round2(gapH),
      linkPeriods: directSummary.counts.link ?? 0,
      gapPeriods: directSummary.counts.gap ?? 0,
      linkFraction: week.endMs > week.startMs ? round4(linkH / ((week.endMs - week.startMs) / MS_PER_HOUR)) : 0,
      relayEnabled,
      relayLinkHours: round2(relayLinkH),
      relayGapHours: round2(relayGapH),
      relayLinkPeriods: relaySummary.counts.link ?? 0,
      relayGapPeriods: relaySummary.counts.gap ?? 0,
      relayBenefitHours: round2(Math.max(0, relayLinkH - linkH)),
      relayLinkFraction: week.endMs > week.startMs ? round4(relayLinkH / ((week.endMs - week.startMs) / MS_PER_HOUR)) : 0,
      sunlightIntervals: sunlightSummary.intervals,
      directIntervals: directSummary.intervals,
      relayIntervals: relayEnabled ? relaySummary.intervals : directSummary.intervals,
    }
  })

  const signature = computeCyclesSignature({
    terrain,
    site,
    mission: normalizedMission,
    ephemeris: dataset,
    options: { stepSeconds, profileStepDeg },
  })
  const direct = {
    intervals: directIntervals,
    linkHours: round2(directLinkHours),
    gapHours: round2(directHours.gap ?? 0),
    gapCount: directCounts.gap ?? 0,
    linkPeriods: directCounts.link ?? 0,
    linkFraction: windowHours > 0 ? round4(directLinkHours / windowHours) : 0,
  }
  const relay = {
    enabled: relayEnabled,
    coverage: round4(commsModel.relayCoverage),
    periodMinutes: commsModel.relayPeriodMinutes,
    intervals: relayEnabled ? relayIntervals : [],
    linkHours: round2(relayLinkHours),
    gapHours: round2(relayGapHours),
    gapCount: relayEnabled ? relayCounts.gap ?? 0 : directCounts.gap ?? 0,
    linkPeriods: relayEnabled ? relayCounts.link ?? 0 : directCounts.link ?? 0,
    linkFraction: windowHours > 0 ? round4(relayLinkHours / windowHours) : 0,
    benefitHours: round2(benefitHours),
    benefitFraction: windowHours > 0 ? round4(benefitHours / windowHours) : 0,
    filledGapCount: countFilledGaps(relayOnlyWindows),
    relayOnlyIntervals: relayOnlyWindows.map((window) => ({
      startMs: window.from,
      endMs: window.to,
      start: new Date(window.from).toISOString(),
      end: new Date(window.to).toISOString(),
      hours: (window.to - window.from) / MS_PER_HOUR,
    })),
  }
  const effective = relayEnabled
    ? {
        enabled: true,
        source: 'relay',
        intervals: relayIntervals,
        linkHours: relay.linkHours,
        gapHours: relay.gapHours,
        gapCount: relay.gapCount,
        linkPeriods: relay.linkPeriods,
        linkFraction: relay.linkFraction,
      }
    : {
        enabled: false,
        source: 'direct',
        intervals: directIntervals,
        linkHours: direct.linkHours,
        gapHours: direct.gapHours,
        gapCount: direct.gapCount,
        linkPeriods: direct.linkPeriods,
        linkFraction: direct.linkFraction,
      }

  return {
    window: {
      startMs: fromMs,
      endMs: toMs,
      start: new Date(fromMs).toISOString(),
      end: new Date(toMs).toISOString(),
      days: round2(days),
      weeks: weeks.length,
      clamped: resolvedWindow.clamped,
    },
    weeks,
    sunlight: {
      intervals: sunlightIntervals,
      sunHours: round2(sunHours.sun ?? 0),
      eclipseHours: round2(sunHours.eclipse ?? 0),
      eclipseCount: sunCounts.eclipse ?? 0,
      sunPeriods: sunCounts.sun ?? 0,
      sunFraction: windowHours > 0 ? round4((sunHours.sun ?? 0) / windowHours) : 0,
    },
    direct,
    relay,
    effective,
    meta: {
      modelVersion: MISSION_CYCLES_MODEL_VERSION,
      inputSignature: signature,
      site: {
        id: site.id ?? null,
        lat: Number(site.lat),
        lon: Number(site.lon),
        elevationM: Number.isFinite(Number(site.elevationM)) ? Number(site.elevationM) : null,
        ephemerisSiteId: site.ephemerisSiteId ?? dataset.siteId ?? null,
      },
      terrainId: terrain?.id ?? null,
      terrainSynthetic: terrain?.synthetic === true,
      ephemerisSiteId: dataset.siteId ?? null,
      samplingSeconds: stepSeconds,
      minIntervalSeconds,
      profileStepDeg,
      weekCount: weeks.length,
      warnings,
      assumptions: [
        'Sun and Earth visibility use the ray-traced terrain horizon (lunar curvature included) at the selected site.',
        'Sampling step is capped at 30 minutes; interval boundaries are refined by bisection.',
        'Visibility intervals shorter than the ephemeris resolution (<= 30 minutes) are dropped as unresolvable sampling slivers.',
        'Relay availability uses the documented time-fraction coverage model (relayCoverage per relayPeriodMinutes), unioned with direct line-of-sight; it is not an orbit propagation.',
        'Weeks are 7-day blocks measured from the mission start; the first/last week can be partial.',
      ],
    },
  }
}

/**
 * Count direct-link gaps that the relay partially or fully fills.
 *
 * @param {Array<{from: number, to: number}>} relayOnly Relay-only availability windows (ms).
 * @returns {number}
 */
function countFilledGaps(relayOnly) {
  if (!Array.isArray(relayOnly) || relayOnly.length === 0) return 0
  // Contiguous relay-only windows are merged into gap fills; each merged block
  // corresponds to one filled direct gap.
  const merged = []
  for (const window of relayOnly) {
    const last = merged[merged.length - 1]
    if (last && window.from <= last.to + 1) last.to = Math.max(last.to, window.to)
    else merged.push({ from: window.from, to: window.to })
  }
  return merged.length
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
