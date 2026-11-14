/**
 * Mission brief export: builds a self-contained JSON document with the selected
 * sites, mission profile, computed analysis, attribution and external links
 * (LROC QuickMap and NASA Moon Trek), and triggers the browser download.
 *
 * The brief is intentionally explicit about provenance and limitations: NASA
 * Space Apps judging asks for the data sources and the real development status
 * of the solution, so the export carries both.
 *
 * @module services/export
 */

import { MOON_RADIUS_M } from '../core/geometry.js'
import { buildQuickMapUrl, buildMoonTrekViewerUrl, MOON_TREK_URL, QUICK_MAP_URL } from './moontrek.js'

/** Schema identifier written into every brief. */
export const BRIEF_SCHEMA = 'lsea.mission-brief/1'

/** Application metadata embedded in the brief. */
export const APP_INFO = Object.freeze({
  name: 'L-SEA Space Apps',
  summary:
    'Lunar south-pole site selection and mission briefing tool for the NASA International Space Apps Challenge Málaga 2026.',
  event: 'NASA International Space Apps Challenge Málaga 2026',
})

/** Data sources and their role in the analysis. */
export const DATA_SOURCES = Object.freeze([
  {
    name: 'JPL Horizons',
    role: 'Topocentric Sun and Earth azimuth/elevation for each candidate site',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    license: 'NASA/JPL — public domain (NASA data policy)',
  },
  {
    name: 'LRO LOLA (PDS Geosciences Node)',
    role: 'Lunar south-pole digital elevation model used for horizon, slope and shadow analysis',
    url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm',
    license: 'NASA/GSFC — PDS data policy',
  },
  {
    name: 'NASA Moon Trek',
    role: 'Background layers and south-polar stereographic imagery',
    url: MOON_TREK_URL,
    license: 'NASA/GSFC/ASU — Moon Trek terms of use',
  },
  {
    name: 'LROC QuickMap',
    role: 'Visual cross-check of the candidate sites',
    url: QUICK_MAP_URL,
    license: 'NASA/GSFC/ASU — LROC terms of use',
  },
])

/** Known limitations documented in the export. */
export const BRIEF_LIMITATIONS = Object.freeze([
  'Spherical lunar model with radius 1737400 m; no high-order gravity, tides or libration beyond the precomputed Horizons samples.',
  'Terrain horizon is computed on the available LOLA DEM subset; areas outside the covered regions are reported as unknown rather than assumed flat.',
  'Solar power uses a simple panel model (solar constant, incidence, area, efficiency, system derate); no temperature, dust or battery model.',
  'Communications with a relay in orbit are modelled as a coverage fraction, not as a propagated orbit.',
  'Scores are a decision aid, not a flight-qualified analysis: the weights and thresholds are documented in the app and in the brief.',
])

/**
 * Normalize a site for the brief (keeps the data pipeline fields).
 *
 * @param {Object} site
 * @returns {Object|null}
 */
function normalizeBriefSite(site) {
  if (!site || !Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.lon))) return null
  return {
    id: site.id ?? null,
    name: site.name ?? site.id ?? null,
    lat: Number(site.lat),
    lon: Number(site.lon),
    elevationM: Number.isFinite(Number(site.elevationM)) ? Number(site.elevationM) : null,
    perimeterM: Number.isFinite(Number(site.perimeterM)) ? Number(site.perimeterM) : null,
    mastM: Number.isFinite(Number(site.mastM)) ? Number(site.mastM) : null,
    source: site.source ?? 'poi',
    provenance: site.provenance ?? null,
    sourceUrl: site.sourceUrl ?? null,
    description: site.description ?? null,
    links: {
      quickMap: buildQuickMapUrl(site),
      moonTrek: buildMoonTrekViewerUrl(),
    },
  }
}

/**
 * Normalize a score entry for the brief (keeps reasons and metrics).
 *
 * @param {Object|null} score
 * @returns {Object|null}
 */
function normalizeBriefScore(score) {
  if (!score) return null
  // The UI flattens some metric fields for its own table; accept both shapes so
  // the brief always carries the numbers reported on screen.
  const flatMetrics = {
    sunlitDays: score.sunlightDays ?? null,
    averageW: score.averageW ?? null,
    peakW: score.peakW ?? null,
    commsHours: score.commsHours ?? null,
    estimatedMb: score.estimatedMb ?? null,
    meanSlopeDeg: score.slopeDeg ?? null,
  }
  return {
    siteId: score.siteId ?? null,
    siteName: score.siteName ?? score.site?.name ?? null,
    rank: score.rank ?? null,
    score: score.score ?? null,
    grade: score.grade ?? null,
    confidence: score.confidence ?? null,
    components: score.components ?? null,
    metrics: { ...flatMetrics, ...(score.metrics ?? {}) },
    reasons: Array.isArray(score.reasons) ? score.reasons : [],
    warnings: Array.isArray(score.warnings) ? score.warnings : [],
  }
}

/**
 * Build the mission brief object.
 *
 * @param {{
 *   sites?: Array<Object>,
 *   mission?: Object,
 *   computation?: {analysis?: Object, selectedSite?: Object|null, scores?: Array<Object>},
 *   selectedSite?: Object|null,
 *   locale?: string,
 *   generatedAt?: Date|string,
 *   appUrl?: string|null,
 * }} input
 * @returns {Object} JSON-serializable mission brief.
 */

/** Compact a zone-autopilot entry for the mission brief. */
function normalizeBriefZone(entry, index) {
  if (!entry || typeof entry !== 'object') return null
  const zone = entry.zone ?? entry
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)
  return {
    rank: Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : index + 1,
    id: zone.id ?? null,
    name: zone.name ?? null,
    lat: num(zone.lat),
    lon: num(zone.lon),
    areaKm2: num(zone.areaKm2),
    meanSlopeDeg: num(zone.meanSlopeDeg),
    maxSlopeDeg: num(zone.maxSlopeDeg),
    elevationM: num(zone.elevationM),
    reliefM: num(zone.reliefM),
    score: num(entry.score),
    grade: entry.grade ?? null,
    confidence: num(entry.confidence),
    feasible: entry.feasible ?? null,
    feasibility: entry.feasibility ?? null,
    rawScore: num(entry.rawScore),
    scoreCapApplied: entry.scoreCapApplied ?? null,
    components: entry.components ?? null,
    metrics: entry.metrics ?? null,
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
    inputSignature: entry.inputSignature ?? null,
    ephemerisSiteId: entry.ephemerisSiteId ?? entry.nearestSiteId ?? null,
    nearestSiteDistanceM: num(entry.nearestSiteDistanceM),
  }
}

export function buildBrief(input = {}) {
  const generatedAt = input.generatedAt ? new Date(input.generatedAt) : new Date()
  const sites = (Array.isArray(input.sites) ? input.sites : [])
    .map(normalizeBriefSite)
    .filter(Boolean)
  const scores = Array.isArray(input.computation?.scores) ? input.computation.scores : []
  const scoreById = new Map(scores.filter(Boolean).map((score) => [score.siteId, score]))
  const rankedSites = sites
    .map((site) => normalizeBriefScore(scoreById.get(site.id)))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank
      if (a.rank != null) return -1
      if (b.rank != null) return 1
      return (b.score ?? -1) - (a.score ?? -1)
    })
  const selectedSite =
    normalizeBriefSite(input.computation?.selectedSite ?? input.selectedSite ?? null) ??
    sites[0] ??
    null
  const landingZones = Array.isArray(input.computation?.landingZones) ? input.computation.landingZones : []
  const rankedLandingZones = landingZones
    .map((entry, index) => normalizeBriefZone(entry, index))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)

  return {
    schema: BRIEF_SCHEMA,
    generatedAt: Number.isNaN(generatedAt.getTime()) ? new Date().toISOString() : generatedAt.toISOString(),
    application: {
      ...APP_INFO,
      url: input.appUrl ?? null,
      locale: input.locale ?? 'en',
      referenceRadiusM: MOON_RADIUS_M,
    },
    mission: input.mission ?? null,
    selectedSite,
    sites,
    rankedSites,
    rankedLandingZones,
    landingZonesMeta: input.computation?.landingZonesMeta ?? null,
    cycles: input.computation?.cycles ?? null,
    analysis: input.computation?.analysis ?? null,
    links: {
      quickMap: selectedSite?.links.quickMap ?? buildQuickMapUrl(selectedSite ?? {}),
      moonTrek: MOON_TREK_URL,
      layers: {
        moonTrek: MOON_TREK_URL,
        quickMap: QUICK_MAP_URL,
      },
      siteCoordinates: selectedSite
        ? { lat: selectedSite.lat, lon: selectedSite.lon }
        : null,
    },
    dataSources: DATA_SOURCES,
    limitations: BRIEF_LIMITATIONS,
    attribution:
      'Data: NASA/JPL Horizons, NASA/GSFC LOLA (PDS Geosciences Node), NASA Moon Trek, LROC QuickMap. ' +
      'Generated by L-SEA Space Apps for the NASA International Space Apps Challenge Málaga 2026.',
  }
}

/**
 * Serialize a brief to pretty JSON.
 *
 * @param {Object} brief
 * @returns {string}
 */
export function briefToJson(brief) {
  return JSON.stringify(brief, null, 2)
}

/**
 * Build the default brief file name.
 *
 * @param {Date|string} [date=new Date()]
 * @returns {string} e.g. `lsea-brief-2026-11-14T12-30-00Z.json`.
 */
export function briefFilename(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date)
  const stamp = (Number.isNaN(parsed.getTime()) ? new Date() : parsed)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')
  return `lsea-brief-${stamp}Z.json`
}

/**
 * Trigger a browser download of the brief JSON.
 *
 * Returns `null` outside a browser (SSR/tests) instead of throwing, so callers
 * can still obtain the object from {@link buildBrief} in non-browser contexts.
 *
 * @param {Object} brief
 * @param {string} [filename]
 * @returns {string|null} Downloaded file name, or `null` when unavailable.
 */
export function downloadBrief(brief, filename = briefFilename()) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  if (typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null
  try {
    const blob = new Blob([briefToJson(brief)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return filename
  } catch (error) {
    console.warn(`[export] could not download the brief: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Convenience helper: build the brief and download it in one call.
 *
 * @param {Object} input See {@link buildBrief}.
 * @param {string} [filename]
 * @returns {{brief: Object, filename: string|null}}
 */
export function exportBriefFile(input = {}, filename) {
  const brief = buildBrief(input)
  const downloaded = downloadBrief(brief, filename ?? briefFilename())
  return { brief, filename: downloaded }
}

/**
 * Build a downloadable brief summary as plain text (used for quick sharing).
 *
 * @param {Object} brief
 * @returns {string}
 */
export function briefSummaryText(brief) {
  if (!brief) return ''
  const lines = [
    `${APP_INFO.name} — mission brief`,
    `Generated: ${brief.generatedAt}`,
    '',
    `Mission: ${brief.mission?.missionDays ?? '?'} days, power need ${brief.mission?.powerNeedW ?? '?'} W, sun days needed ${brief.mission?.sunDaysNeeded ?? '?'}, relay in orbit: ${brief.mission?.relayInOrbit ? 'yes' : 'no'}`,
    '',
  ]
  const ranked = Array.isArray(brief.rankedSites) ? brief.rankedSites : []
  const nameById = new Map(
    (Array.isArray(brief.sites) ? brief.sites : []).map((site) => [site.id, site.name]),
  )
  if (ranked.length > 0) {
    lines.push('Ranked sites:')
    for (const entry of ranked) {
      const label = nameById.get(entry.siteId) ?? entry.siteId
      lines.push(`  ${entry.rank ?? '-'}. ${label}: score ${entry.score ?? '-'} (${entry.grade ?? '-'})`)
    }
  }
  if (brief.links?.quickMap) lines.push('', `QuickMap: ${brief.links.quickMap}`)
  if (brief.links?.moonTrek) lines.push(`Moon Trek: ${brief.links.moonTrek}`)
  return lines.join('\n')
}
