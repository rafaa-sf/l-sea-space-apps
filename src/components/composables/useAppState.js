/**
 * Shared application state and actions for the L-SEA UI.
 *
 * The module is a singleton store: the shell and every panel import `state`
 * plus the actions they need. Data loading is tolerant (see `useData.js`), so
 * the app boots even before `public/data`, `src/core` and `src/services` are
 * complete; the status panels report which source is being used.
 */

import { computed, markRaw, reactive, watch } from 'vue'
import i18n from '../../i18n/index.js'
import { getCompute } from './useCompute.js'
import { lonLatToPlanarMeters } from '../../render/geo.js'
import { getLandingZonesApi, zoneToSite } from './landingZones.js'
import { hasWorker, runInWorker } from './moduleBridge.js'
import {
  createCustomSite,
  exportBrief,
  getTerrainIndexRegions,
  loadEphemeris,
  loadLayers,
  loadSites,
  loadTerrain,
} from './useData.js'
import { toTimestamp } from './format.js'
import { createPlaybackClock } from './playbackClock.js'

const STORAGE_MISSION = 'lsea.mission'
const STORAGE_SITE = 'lsea.selectedSite'
const STORAGE_REGION = 'lsea.terrainRegion'

export const MAX_COMPARE = 3

export const DEFAULT_MISSION = Object.freeze({
  missionDays: 14,
  powerNeedW: 120,
  relayInOrbit: false,
  sunDaysNeeded: 10,
  perimeterM: 200,
  mastM: 10,
  bitrateMbps: 2,
  panelAreaM2: 2.4,
  batteryCapacityWh: 40000,
  powerSource: 'solar',
  rtgPowerW: null,
  batteryRoundTripEfficiency: 0.9,
  batteryDepthOfDischarge: 0.8,
  heaterMaxW: 400,
  heaterWPerK: 2,
  minOperatingTemperatureC: -40,
  maxOperatingTemperatureC: 50,
  landingEllipseRadiusM: 500,
  craterHazardMinDiameterM: 500,
  craterHazardReachM: 5000,
  scienceReachM: 5000,
  dataNeedMb: 1200,
})

/** View mode requested through `?mode=2d|3d|auto` (handy for demos/tests). */
function initialViewMode() {
  try {
    const requested = new URLSearchParams(window.location.search).get('mode')
    return ['auto', '3d', '2d'].includes(requested) ? requested : 'auto'
  } catch {
    return 'auto'
  }
}

function defaultTime() {
  const now = Date.now()
  const rounded = Math.ceil(now / (10 * 60 * 1000)) * 10 * 60 * 1000
  return new Date(rounded).toISOString()
}

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

function loadStoredMission() {
  const stored = readStorage(STORAGE_MISSION)
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_MISSION }
  const mission = { ...DEFAULT_MISSION }
  for (const key of Object.keys(DEFAULT_MISSION)) {
    const value = stored[key]
    if (typeof DEFAULT_MISSION[key] === 'boolean') {
      mission[key] = Boolean(value)
    } else if (Number.isFinite(Number(value))) {
      mission[key] = Number(value)
    }
  }
  return mission
}

export const state = reactive({
  booted: false,
  loading: {
    sites: true,
    terrain: true,
    layers: true,
    ephemeris: false,
    analysis: false,
  },
  data: {
    sitesSource: 'pending',
    sitesUrl: null,
    sitesCount: 0,
    terrainSource: 'pending',
    terrainOrigin: null,
    terrainUrl: null,
    layersSource: 'pending',
    layersUrl: null,
    ephemerisSource: 'pending',
    ephemerisOrigin: null,
    ephemerisUrl: null,
    terrainStats: null,
    terrainRegionId: null,
    terrainRegionName: null,
    terrainAttribution: null,
    terrainIndex: [],
    craters: [],
    detected: { core: [], services: [], workers: [] },
  },
  sites: [],
  selectedSiteId: null,
  compareSiteIds: [],
  mission: loadStoredMission(),
  time: defaultTime(),
  terrain: null,
  viewTerrain: null,
  layers: [],
  layerEnabled: {},
  layerStatus: {},
  ephemeris: null,
  sample: null,
  analysis: {
    ready: false,
    stale: false,
    updatedAt: null,
    sun: { az: 0, el: 0 },
    earth: { az: 0, el: 0 },
    horizonSun: 0,
    horizonEarth: 0,
    sunVisible: false,
    earthVisible: false,
    sunMargin: 0,
    earthMargin: 0,
    ray: null,
    slope: { slopeDeg: 0, aspectDeg: 0 },
    siteElevationM: 0,
    sunSet: null,
    earthSet: null,
    power: null,
    commWindows: [],
    commBudget: null,
  },
  scores: [],
  autopilot: { status: 'idle', source: null, error: null, ranAt: null, durationMs: null },
  landingZones: [],
  landingZonesMeta: null,
  landingZonesStatus: { status: 'idle', source: null, error: null, ranAt: null, durationMs: null, unavailable: false },
  landingZoneEntry: null,
  landingZoneSite: null,
  worker: { available: hasWorker(), status: hasWorker() ? 'idle' : 'unavailable', source: null, error: null, lastRunAt: null },
  system: { webgl: null, viewMode: initialViewMode(), renderer: null, note: null },
  export: { status: 'idle', error: null, lastAt: null, source: null },
  playback: { playing: false, speedMinutes: 20 },
  pointer: { lat: -89.5, lon: 0, at: null },
  errors: [],
})

export const selectedSite = computed(() => {
  if (state.landingZoneSite && state.selectedSiteId === state.landingZoneSite.id) return state.landingZoneSite
  return state.sites.find((site) => site.id === state.selectedSiteId) ?? null
})

export const compareSites = computed(() =>
  state.compareSiteIds.map((id) => state.sites.find((site) => site.id === id)).filter(Boolean),
)

export const terrainRegion = computed(() =>
  state.terrain
    ? {
        lat0: state.terrain.lat0,
        lon0: state.terrain.lon0,
        lat1: state.terrain.lat1,
        lon1: state.terrain.lon1,
        width: state.terrain.width,
        height: state.terrain.height,
      }
    : null,
)

export const ephemerisRange = computed(() =>
  state.ephemeris ? { start: state.ephemeris.start, end: state.ephemeris.end } : null,
)

/**
 * Single source of truth for the background-worker badge. Keeps the timeline
 * pill and the worker panel consistent: a successful worker run always wins
 * over a stale earlier failure, and an error is only reported when the worker
 * itself is currently failing.
 */
export const workerSummary = computed(() => {
  if (!state.worker.available) return 'main-thread'
  if (state.autopilot.status === 'running' || state.worker.status === 'running') return 'running'
  const workerSucceeded = state.autopilot.status === 'done' && state.autopilot.source === 'worker'
  if (workerSucceeded) return 'ok'
  if (state.worker.status === 'error') return 'error'
  if (state.worker.status === 'done') return 'ok'
  return 'ready'
})

let computeEngine = null
let bootPromise = null
let ephemerisToken = 0
let instantToken = 0
let instantTimer = null
let missionTimer = null
let persistTimer = null

function reportError(scope, error) {
  const message = error instanceof Error ? error.message : String(error)
  state.errors.push({ scope, message, at: new Date().toISOString() })
  if (state.errors.length > 20) state.errors.shift()
  console.warn(`[lsea] ${scope}:`, error)
}

async function ensureCompute() {
  if (!computeEngine) computeEngine = await getCompute()
  return computeEngine
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

/** Load every dataset and initialise the first site selection. Resolves once. */
export function boot() {
  if (!bootPromise) bootPromise = doBoot()
  return bootPromise
}

async function doBoot() {
  const compute = await ensureCompute()
  state.data.detected = compute.modules
  state.worker.available = hasWorker()
  state.worker.status = hasWorker() ? 'idle' : 'unavailable'

  const [sitesResult, terrainResult, layersResult] = await Promise.all([
    loadSites().catch((error) => {
      reportError('sites', error)
      return { sites: [], source: 'error' }
    }),
    loadTerrain().catch((error) => {
      reportError('terrain', error)
      return { terrain: null, source: 'error', origin: 'error' }
    }),
    loadLayers().catch((error) => {
      reportError('layers', error)
      return { layers: [], source: 'error' }
    }),
  ])

  state.sites = sitesResult.sites
  state.data.sitesSource = sitesResult.source
  state.data.sitesUrl = sitesResult.url ?? null
  state.data.sitesCount = sitesResult.sites.length
  state.loading.sites = false

  state.layers = layersResult.layers
  state.data.layersSource = layersResult.source
  state.data.layersUrl = layersResult.url ?? null
  state.loading.layers = false
  for (const layer of state.layers) state.layerEnabled[layer.id] = false
  // `?layers=id1,id2` pre-enables catalogue entries (useful for demos/tests).
  try {
    const requested = new URLSearchParams(window.location.search).get('layers')
    if (requested) {
      for (const id of requested.split(',').map((entry) => entry.trim()).filter(Boolean)) {
        if (state.layers.some((layer) => layer.id === id)) state.layerEnabled[id] = true
      }
    }
  } catch {
    /* no URL search params available */
  }

  if (terrainResult.terrain) {
    state.terrain = markRaw(terrainResult.terrain)
    state.viewTerrain = markRaw(terrainResult.viewTerrain ?? terrainResult.terrain)
    state.data.terrainSource = terrainResult.source
    state.data.terrainOrigin = terrainResult.origin ?? null
    state.data.terrainUrl = terrainResult.url ?? null
    state.data.terrainRegionId = terrainResult.regionId ?? null
    state.data.terrainRegionName = terrainResult.regionName ?? terrainResult.terrain.name ?? null
    state.data.terrainAttribution = terrainResult.attribution ?? terrainResult.terrain.attribution ?? null
    state.data.terrainStats = compute.terrainStats(terrainResult.terrain)
    state.data.terrainIndex = getTerrainIndexRegions() ?? []
    try {
      state.data.craters = compute.findCraters(terrainResult.terrain, { limit: 8 }) ?? []
    } catch (error) {
      reportError('craters', error)
      state.data.craters = []
    }
  }
  state.loading.terrain = false
  state.loading.analysis = true

  const storedSite = readStorage(STORAGE_SITE)
  const initialSite = state.sites.find((site) => site.id === storedSite) ?? state.sites[0] ?? null

  state.booted = true
  if (initialSite) await selectSite(initialSite.id)
  else state.loading.analysis = false

  runAutopilot().catch((error) => reportError('autopilot', error))
}

/* -------------------------------------------------------------------------- */
/* Selection and mutations                                                    */
/* -------------------------------------------------------------------------- */

/** Select a site by id and load its ephemeris dataset. */
export async function selectSite(id) {
  if (state.landingZoneSite && state.landingZoneSite.id === id) return
  const site = state.sites.find((entry) => entry.id === id)
  if (!site) return
  state.landingZoneSite = null
  state.landingZoneEntry = null
  state.selectedSiteId = site.id
  writeStorage(STORAGE_SITE, site.id)
  const token = (ephemerisToken += 1)

  state.loading.ephemeris = true
  try {
    const result = await loadEphemeris(site)
    if (token !== ephemerisToken) return
    state.ephemeris = result.dataset ? markRaw(result.dataset) : null
    state.data.ephemerisSource = result.source
    state.data.ephemerisOrigin = result.origin ?? null
    state.data.ephemerisUrl = result.url ?? null
    if (result.dataset) {
      const start = toTimestamp(result.dataset.start)
      const end = toTimestamp(result.dataset.end)
      const current = toTimestamp(state.time)
      if (Number.isFinite(start) && Number.isFinite(end) && (current < start || current > end)) {
        state.time = new Date(Math.min(Math.max(current, start), end)).toISOString()
      }
    }
  } catch (error) {
    if (token === ephemerisToken) {
      reportError('ephemeris', error)
      state.data.ephemerisSource = 'error'
    }
  } finally {
    if (token === ephemerisToken) {
      state.loading.ephemeris = false
      scheduleInstant(0)
      scheduleMission(0)
    }
  }
}

/** Create a custom site from map coordinates and select it. */
export function addCustomSite(coordinates) {
  const lat = Number(coordinates?.lat)
  const lon = Number(coordinates?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const site = createCustomSite({ lat, lon })
  const duplicate = state.sites.find(
    (entry) => entry.source === 'custom' && Math.abs(entry.lat - site.lat) < 0.002 && Math.abs(entry.lon - site.lon) < 0.002,
  )
  if (duplicate) {
    selectSite(duplicate.id)
    return duplicate
  }
  state.sites = [...state.sites, site]
  state.data.sitesCount = state.sites.length
  selectSite(site.id)
  return site
}

/** Update mutable site fields (perimeter, mast, name) and recompute. */
export function updateSite(id, patch) {
  const site = state.sites.find((entry) => entry.id === id)
  if (!site) return
  Object.assign(site, patch)
  state.sites = [...state.sites]
  if (id === state.selectedSiteId) scheduleMission(150)
  if (state.autopilot.status === 'done') state.autopilot.status = 'stale'
}

/** Store the last map-pointer coordinates (click on the viewport terrain). */
export function setPointerLocation(coordinates) {
  const lat = Number(coordinates?.lat)
  const lon = Number(coordinates?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  state.pointer = { lat, lon, at: new Date().toISOString() }
}

/**
 * Reload the terrain from another LOLA DEM region ("high detail" vs "wide
 * area"), keeping a valid selected site and refreshing every derived view.
 */
export async function setTerrainRegion(regionId) {
  if (!regionId || regionId === state.data.terrainRegionId) return
  const compute = await ensureCompute()
  state.loading.terrain = true
  try {
    const result = await loadTerrain({ regionId })
    if (!result.terrain) return
    state.terrain = markRaw(result.terrain)
    state.viewTerrain = markRaw(result.viewTerrain ?? result.terrain)
    state.data.terrainSource = result.source
    state.data.terrainOrigin = result.origin ?? null
    state.data.terrainRegionId = result.regionId ?? regionId
    state.data.terrainRegionName = result.regionName ?? result.terrain.name ?? null
    state.data.terrainAttribution = result.attribution ?? result.terrain.attribution ?? null
    state.data.terrainStats = compute.terrainStats(result.terrain)
    state.data.terrainIndex = getTerrainIndexRegions() ?? state.data.terrainIndex
    try {
      state.data.craters = compute.findCraters(result.terrain, { limit: 8 }) ?? []
    } catch (error) {
      reportError('craters', error)
      state.data.craters = []
    }
    state.layerStatus = {}
    state.autopilot.status = 'stale'
    try {
      localStorage.setItem(STORAGE_REGION, state.data.terrainRegionId)
    } catch {
      /* storage unavailable */
    }
    // Keep the selected site if it lies inside the new extent, else pick the
    // nearest site that does.
    const terrain = state.terrain
    if (Number.isFinite(Number(terrain.minX)) && state.selectedSiteId) {
      const inside = (site) => {
        const point = lonLatToPlanarMeters(site.lat, site.lon, Number(terrain.datum ?? terrain.referenceRadiusM ?? 1737400))
        return point.x >= terrain.minX && point.x <= terrain.maxX && point.y >= terrain.minY && point.y <= terrain.maxY
      }
      if (!state.sites.some((site) => site.id === state.selectedSiteId && inside(site))) {
        const selected = state.sites.find((site) => site.id === state.selectedSiteId)
        const candidates = state.sites.filter(inside)
        if (candidates.length) {
          const reference = selected ?? candidates[0]
          const referencePoint = lonLatToPlanarMeters(reference.lat, reference.lon, Number(terrain.datum ?? 1737400))
          candidates.sort((a, b) => {
            const pa = lonLatToPlanarMeters(a.lat, a.lon, Number(terrain.datum ?? 1737400))
            const pb = lonLatToPlanarMeters(b.lat, b.lon, Number(terrain.datum ?? 1737400))
            return Math.hypot(pa.x - referencePoint.x, pa.y - referencePoint.y) - Math.hypot(pb.x - referencePoint.x, pb.y - referencePoint.y)
          })
          await selectSite(candidates[0].id)
        }
      }
    }
    scheduleInstant(0)
    scheduleMission(0)
  } catch (error) {
    reportError('terrain-region', error)
  } finally {
    state.loading.terrain = false
  }
}

/** Add/remove a site from the comparator. Returns the resulting ids. */
export function toggleCompare(id) {
  if (!state.sites.some((site) => site.id === id)) return state.compareSiteIds
  if (state.compareSiteIds.includes(id)) {
    state.compareSiteIds = state.compareSiteIds.filter((entry) => entry !== id)
  } else if (state.compareSiteIds.length < MAX_COMPARE) {
    state.compareSiteIds = [...state.compareSiteIds, id]
  }
  return state.compareSiteIds
}

export function clearCompare() {
  state.compareSiteIds = []
}

export function setTime(value) {
  const ms = toTimestamp(value)
  if (!Number.isFinite(ms)) return
  // A manual time change always stops playback: otherwise a running timer keeps
  // advancing the clock while the transport button already shows "play".
  if (state.playback.playing) stopPlayback()
  state.time = new Date(ms).toISOString()
}

export function shiftTime(minutes) {
  const ms = toTimestamp(state.time)
  if (!Number.isFinite(ms)) return
  setTime(ms + Number(minutes) * 60 * 1000)
}

export function setNow() {
  // setTime() stops playback; the transport button returns to "Play".
  setTime(Date.now())
}

/** Jump to the next set/rise event time, when one exists. */
export function jumpToEvent(kind) {
  const event = kind === 'earth' ? state.analysis.earthSet : state.analysis.sunSet
  if (!event?.time) return
  setTime(event.time)
}

export function updateMission(patch) {
  Object.assign(state.mission, patch)
  if (state.autopilot.status === 'done') state.autopilot.status = 'stale'
}

export function setLayerEnabled(id, enabled) {
  state.layerEnabled[id] = Boolean(enabled)
}

/** Store the renderer's load status for a Moon Trek layer overlay. */
export function setLayerStatus(id, status) {
  state.layerStatus = { ...state.layerStatus, [id]: { ...(status ?? {}), at: new Date().toISOString() } }
}

export function setWebglStatus(status) {
  state.system.webgl = status
}

export function setViewMode(mode) {
  state.system.viewMode = ['auto', '3d', '2d'].includes(mode) ? mode : 'auto'
}

export function setRenderer(kind) {
  state.system.renderer = kind
}

/* -------------------------------------------------------------------------- */
/* Playback                                                                   */
/* -------------------------------------------------------------------------- */

function advancePlayback() {
  const current = toTimestamp(state.time)
  const range = ephemerisRange.value
  let next = current + state.playback.speedMinutes * 60 * 1000
  if (range) {
    const end = toTimestamp(range.end)
    if (next >= end) next = toTimestamp(range.start)
  }
  state.time = new Date(next).toISOString()
}

const playbackClock = createPlaybackClock({ onTick: advancePlayback, intervalMs: 220 })

export function startPlayback() {
  if (state.playback.playing) return
  playbackClock.start()
  state.playback.playing = true
}

export function stopPlayback() {
  playbackClock.stop()
  state.playback.playing = false
}

export function togglePlayback() {
  if (state.playback.playing) stopPlayback()
  else startPlayback()
}

/* -------------------------------------------------------------------------- */
/* Analysis                                                                   */
/* -------------------------------------------------------------------------- */

function scheduleInstant(delay = 0) {
  if (instantTimer) clearTimeout(instantTimer)
  state.analysis.stale = true
  instantTimer = setTimeout(() => {
    instantTimer = null
    runInstantAnalysis()
  }, delay)
}

function scheduleMission(delay = 300) {
  if (missionTimer) clearTimeout(missionTimer)
  missionTimer = setTimeout(() => {
    missionTimer = null
    runMissionAnalysis()
  }, delay)
}

async function runInstantAnalysis() {
  const site = selectedSite.value
  if (!site || !state.terrain) return
  const token = (instantToken += 1)
  const compute = await ensureCompute()
  try {
    const ephemeris = state.ephemeris
    const sample = ephemeris
      ? compute.sampleAt(ephemeris, state.time)
      : { time: state.time, sun: { az: 0, el: 0 }, earth: { az: 0, el: 0 } }
    const horizonSun = compute.horizonAngle(state.terrain, site, sample.sun.az)
    const horizonEarth = compute.horizonAngle(state.terrain, site, sample.earth.az)
    const ray = compute.rayTerrainIntersection(state.terrain, site, sample.sun.az, sample.sun.el)
    const slope = compute.slopeAt(state.terrain, site.lat, site.lon)
    const siteElevationM = compute.sampleElevation(state.terrain, site.lat, site.lon)
    if (token !== instantToken) return

    state.sample = sample
    Object.assign(state.analysis, {
      ready: true,
      stale: false,
      updatedAt: new Date().toISOString(),
      sun: sample.sun,
      earth: sample.earth,
      horizonSun,
      horizonEarth,
      sunVisible: sample.sun.el > horizonSun,
      earthVisible: sample.earth.el > horizonEarth,
      sunMargin: sample.sun.el - horizonSun,
      earthMargin: sample.earth.el - horizonEarth,
      ray: ray ? { ...ray, azimuth: sample.sun.az, elevation: sample.sun.el } : null,
      slope,
      siteElevationM,
    })
  } catch (error) {
    if (token === instantToken) reportError('instant-analysis', error)
  }
}

/**
 * Adapt the power result from either the coder module (which exposes
 * `sunlitFraction` and model details) or the local fallback to one UI shape.
 */
function normalizePowerResult(power, mission) {
  if (!power) return null
  const needW = Number(power.needW ?? mission.powerNeedW ?? 120)
  const averageW = Number(power.averageW) || 0
  const peakW = Number(power.peakW) || 0
  const sunlitFraction = Number(power.sunlitFraction ?? power.illuminatedFraction ?? 0)
  return {
    ...power,
    averageW,
    peakW,
    dailyWh: Number(power.dailyWh) || 0,
    needW,
    marginW: averageW - needW,
    illuminatedFraction: Number.isFinite(sunlitFraction) ? sunlitFraction : 0,
    panelAreaM2: Number(power.model?.panelAreaM2 ?? power.panelAreaM2 ?? mission.panelAreaM2 ?? 2.4),
    efficiency: Number(power.model?.panelEfficiency ?? power.efficiency ?? 0.28),
    unavailable: Boolean(power.unavailable),
  }
}

async function runMissionAnalysis() {
  const site = selectedSite.value
  if (!site || !state.terrain || !state.ephemeris) return
  const compute = await ensureCompute()
  state.loading.analysis = true
  try {
    const missionStart = state.time
    const missionEnd = new Date(
      toTimestamp(missionStart) + state.mission.missionDays * 24 * 3600 * 1000,
    ).toISOString()
    const power = normalizePowerResult(
      compute.solarPowerEstimate(site, state.terrain, state.ephemeris, state.mission),
      state.mission,
    )
    const windows = compute.commWindows(site, state.terrain, state.ephemeris, state.mission, missionStart, missionEnd)
    const budget = compute.dataBudget(windows, state.mission)
    const sunSet = compute.nextSetEvent(state.ephemeris, site, state.terrain, 'sun', missionStart)
    const earthSet = compute.nextSetEvent(state.ephemeris, site, state.terrain, 'earth', missionStart)
    Object.assign(state.analysis, {
      power,
      commWindows: Array.isArray(windows) ? windows : [],
      commBudget: budget,
      sunSet: sunSet ?? null,
      earthSet: earthSet ?? null,
    })
  } catch (error) {
    reportError('mission-analysis', error)
  } finally {
    state.loading.analysis = false
  }
}

/* -------------------------------------------------------------------------- */
/* Autopilot and export                                                       */
/* -------------------------------------------------------------------------- */

function normalizeRankEntry(entry, index) {
  const metrics = entry?.metrics ?? {}
  const site =
    entry?.site ??
    state.sites.find((candidate) => candidate.id === (entry?.siteId ?? entry?.id)) ??
    null
  const reasons = Array.isArray(entry?.reasons)
    ? entry.reasons.map((reason) =>
        typeof reason === 'string' || typeof reason === 'number'
          ? { code: String(reason), params: null, severity: null, text: null }
          : {
              code: reason?.code ?? reason?.key ?? 'unknown',
              params: reason?.params ?? null,
              severity: reason?.severity ?? null,
              text: reason?.text ?? null,
            },
      )
    : []
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return {
    rank: Number(entry?.rank ?? index + 1),
    site,
    siteId: site?.id ?? entry?.siteId ?? entry?.id ?? null,
    score: number(entry?.score ?? 0),
    grade: entry?.grade ?? null,
    gradeCode: entry?.gradeCode ?? null,
    confidence: number(entry?.confidence ?? Number.NaN),
    sunlightDays: number(entry?.sunlightDays ?? metrics.sunlitDays),
    averageW: number(entry?.averageW ?? entry?.averagePowerW ?? metrics.averageW),
    peakW: number(entry?.peakW ?? entry?.peakPowerW ?? metrics.peakW),
    commsWindows: number(entry?.commsWindows ?? entry?.windowCount ?? metrics.commWindows),
    commsHours: number(entry?.commsHours ?? metrics.commHours),
    estimatedMb: number(entry?.estimatedMb ?? metrics.estimatedMb),
    slopeDeg: number(entry?.slopeDeg ?? metrics.meanSlopeDeg),
    reasons,
  }
}

let landingZonesTimer = null

/** Recompute landing zones after a settle delay (time/mission changes). */
function scheduleLandingZonesRefresh(delay = 1800) {
  if (landingZonesTimer) clearTimeout(landingZonesTimer)
  landingZonesTimer = setTimeout(() => {
    landingZonesTimer = null
    if (state.terrain && !state.landingZonesStatus.unavailable) {
      runLandingZones().catch((error) => reportError('landing-zones', error))
    }
  }, delay)
}

/** Feature-detect coder's landing-zone support; updates the status flag. */
export async function detectLandingZoneSupport() {
  const api = await getLandingZonesApi()
  if (!api.available) {
    state.landingZonesStatus = { ...state.landingZonesStatus, status: 'unavailable', unavailable: true, error: null }
  }
  return api
}

/** Rank flat landing zones for the mission profile (worker, then local core). */
export async function runLandingZones() {
  if (state.landingZonesStatus.status === 'running') return state.landingZones
  const api = await detectLandingZoneSupport()
  if (!api.available) {
    state.landingZonesStatus = {
      status: 'unavailable',
      source: null,
      error: null,
      ranAt: new Date().toISOString(),
      durationMs: null,
      unavailable: true,
    }
    return state.landingZones
  }
  if (!state.terrain) return state.landingZones
  state.landingZonesStatus = { ...state.landingZonesStatus, status: 'running', error: null }
  const started = Date.now()
  const autopilotMission = { ...state.mission, startTime: new Date(state.time).toISOString() }
  const terrain = state.terrain
    ? {
        id: state.terrain.regionId ?? state.terrain.id ?? 'terrain',
        name: state.terrain.name ?? null,
        width: state.terrain.width,
        height: state.terrain.height,
        pixelSizeM: state.terrain.pixelSizeM,
        minX: state.terrain.minX,
        maxX: state.terrain.maxX,
        minY: state.terrain.minY,
        maxY: state.terrain.maxY,
        referenceRadiusM: state.terrain.datum ?? state.terrain.referenceRadiusM ?? 1737400,
        dtype: state.terrain.data instanceof Float32Array ? 'float32' : 'int16',
        attribution: state.terrain.attribution ?? null,
        synthetic: state.data.terrainSource === 'synthetic',
        data: state.terrain.data,
      }
    : null
  const payload = {
    terrain,
    sites: state.sites.map((site) => ({ ...site })),
    mission: autopilotMission,
    maxZones: 8,
    ephemeris: state.ephemeris
      ? {
          siteId: state.ephemeris.siteId,
          source: state.ephemeris.source,
          start: state.ephemeris.start,
          end: state.ephemeris.end,
          samples: state.ephemeris.samples.map((sample) => ({
            time: sample.time,
            sun: { ...sample.sun },
            earth: { ...sample.earth },
          })),
        }
      : undefined,
  }
  let zones = null
  let source = null
  let error = null
  if (state.worker.available) {
    const worker = await runInWorker('landingZones', payload, 30000)
    if (worker.ok && Array.isArray(worker.payload?.zones)) {
      zones = worker.payload.zones
      state.landingZonesMeta = worker.payload.meta ?? null
      source = 'worker'
    } else {
      error = worker.error ?? 'worker-empty'
    }
  }
  if (!zones && typeof api.rankLandingZones === 'function') {
    try {
      const result = api.rankLandingZones({
        terrain: state.terrain,
        ephemeris: state.ephemeris,
        sites: state.sites,
        mission: autopilotMission,
        options: { maxZones: 8 },
      })
      zones = Array.isArray(result) ? result : result?.zones ?? null
      state.landingZonesMeta = Array.isArray(result) ? null : result?.meta ?? null
      source = 'main'
    } catch (rankError) {
      error = rankError instanceof Error ? rankError.message : String(rankError)
    }
  }
  if (!zones) {
    state.landingZonesStatus = {
      status: 'error',
      source: null,
      error: error ?? 'landing-zones-unavailable',
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      unavailable: false,
    }
    return state.landingZones
  }
  state.landingZones = zones.filter((entry) => entry && entry.zone)
  state.landingZonesStatus = {
    status: 'done',
    source,
    error: source === 'worker' ? null : error,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    unavailable: false,
  }
  return state.landingZones
}

/** Select a ranked landing zone as a transient analysis site. */
export async function selectLandingZone(entry) {
  const zone = entry?.zone ?? entry
  if (!zone || !Number.isFinite(Number(zone.lat)) || !Number.isFinite(Number(zone.lon))) return
  const site = await zoneToSite(zone, { mastM: state.mission.mastM })
  const displayRank = entry?.rank ?? zone.rank ?? null
  site.id = `zone-${zone.id}`
  site.name = displayRank ? `Landing zone ${displayRank}` : zone.name ?? `Landing zone ${zone.id}`
  site.zoneRank = displayRank
  site.zoneLabel = entry?.zoneLabel ?? (displayRank ? `Zone ${displayRank}` : null)
  site.ephemerisSiteId = entry?.ephemerisSiteId ?? entry?.nearestSiteId ?? null
  state.landingZoneSite = markRaw(site)
  state.landingZoneEntry = entry
  state.selectedSiteId = site.id
  const token = (ephemerisToken += 1)
  state.loading.ephemeris = true
  try {
    const sourceSite = site.ephemerisSiteId ? { ...site, id: site.ephemerisSiteId } : site
    const result = await loadEphemeris(sourceSite)
    if (token !== ephemerisToken) return
    state.ephemeris = result.dataset ? markRaw(result.dataset) : null
    state.data.ephemerisSource = result.source
    state.data.ephemerisOrigin = result.origin ?? null
    state.data.ephemerisUrl = result.url ?? null
  } catch (selectionError) {
    reportError('landing-zone-ephemeris', selectionError)
  } finally {
    if (token === ephemerisToken) {
      state.loading.ephemeris = false
      scheduleInstant(0)
      scheduleMission(0)
    }
  }
}

/** Run the autopilot ranking, preferring the background worker. */
export async function runAutopilot() {
  if (state.autopilot.status === 'running') return state.scores
  state.autopilot.status = 'running'
  state.worker.status = 'running'
  const started = Date.now()
  try {
    const compute = await ensureCompute()
    // Rank over the window the timeline/analysis panels display.
    const autopilotMission = { ...state.mission, startTime: new Date(state.time).toISOString() }
    let scores = null
    let source = 'main'
    let workerError = null
    if (state.worker.available) {
      // Structured clone: Vue reactive proxies cannot be posted to a worker, so
      // send plain copies (terrain data stays a typed array, which is cloneable).
      const terrain = state.terrain
        ? {
            id: state.terrain.regionId ?? state.terrain.id ?? 'terrain',
            name: state.terrain.name ?? null,
            width: state.terrain.width,
            height: state.terrain.height,
            pixelSizeM: state.terrain.pixelSizeM,
            minX: state.terrain.minX,
            maxX: state.terrain.maxX,
            minY: state.terrain.minY,
            maxY: state.terrain.maxY,
            referenceRadiusM: state.terrain.datum ?? state.terrain.referenceRadiusM ?? 1737400,
            dtype: state.terrain.data instanceof Float32Array ? 'float32' : 'int16',
            attribution: state.terrain.attribution ?? null,
            synthetic: state.data.terrainSource === 'synthetic',
            data: state.terrain.data,
          }
        : null
      const result = await runInWorker(
        'autopilot',
        {
          sites: state.sites.map((site) => ({ ...site })),
          mission: autopilotMission,
          region: terrainRegion.value ? { ...terrainRegion.value } : null,
          terrain,
          ephemeris: state.ephemeris
            ? {
                siteId: state.ephemeris.siteId,
                source: state.ephemeris.source,
                start: state.ephemeris.start,
                end: state.ephemeris.end,
                samples: state.ephemeris.samples.map((sample) => ({
                  time: sample.time,
                  sun: { ...sample.sun },
                  earth: { ...sample.earth },
                })),
              }
            : undefined,
        },
        20000,
      )
      const payloadScores = result.ok ? result.payload?.scores ?? result.payload?.results ?? null : null
      if (Array.isArray(payloadScores) && payloadScores.length) {
        scores = payloadScores.map(normalizeRankEntry)
        source = 'worker'
      } else {
        workerError = result.error ?? 'worker-empty'
      }
    }
    if (!scores) {
      const localScores = compute.rankSites({
        sites: state.sites,
        terrain: state.terrain,
        ephemeris: state.ephemeris,
        mission: autopilotMission,
      })
      scores = (Array.isArray(localScores) ? localScores : []).map(normalizeRankEntry)
    }
    scores = scores
      .filter((entry) => entry.site)
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }))
    state.scores = scores
    state.autopilot = {
      status: 'done',
      source,
      error: workerError,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    }
    state.worker = {
      available: state.worker.available,
      status: source === 'worker' ? 'done' : state.worker.available ? 'error' : 'unavailable',
      source,
      error: workerError,
      lastRunAt: new Date().toISOString(),
    }
  } catch (error) {
    reportError('autopilot', error)
    state.autopilot = {
      status: 'error',
      source: null,
      error: error instanceof Error ? error.message : String(error),
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    }
    state.worker.status = 'error'
    state.worker.error = state.autopilot.error
  }
  return state.scores
}

/** Snapshot of the analysis block used by the JSON brief export. */
export function analysisSnapshot() {
  return {
    time: state.time,
    site: selectedSite.value,
    terrain: {
      source: state.data.terrainSource,
      origin: state.data.terrainOrigin,
      region: terrainRegion.value,
      stats: state.data.terrainStats,
    },
    ephemeris: {
      source: state.data.ephemerisSource,
      origin: state.data.ephemerisOrigin,
      range: ephemerisRange.value,
    },
    sun: state.analysis.sun,
    earth: state.analysis.earth,
    horizon: {
      sun: state.analysis.horizonSun,
      earth: state.analysis.horizonEarth,
      sunVisible: state.analysis.sunVisible,
      earthVisible: state.analysis.earthVisible,
      ray: state.analysis.ray,
    },
    sunSet: state.analysis.sunSet,
    earthSet: state.analysis.earthSet,
    power: state.analysis.power,
    commWindows: state.analysis.commWindows,
    commBudget: state.analysis.commBudget,
    slope: state.analysis.slope,
    siteElevationM: state.analysis.siteElevationM,
    craters: state.data.craters,
  }
}

/** Build and download the JSON mission brief. */
export async function runExport() {
  state.export.status = 'busy'
  state.export.error = null
  try {
    let cycles = null
    try {
      const compute = await ensureCompute()
      const site = selectedSite.value
      if (compute && typeof compute.missionCycles === 'function' && site && state.terrain && state.ephemeris) {
        const startTime = state.mission.startTime ?? state.time
        const raw = compute.missionCycles({
          terrain: state.terrain,
          site,
          ephemeris: state.ephemeris,
          mission: { ...state.mission, startTime: new Date(startTime).toISOString() },
        })
        if (raw) {
          cycles = {
            window: raw.window ?? null,
            weekCount: Array.isArray(raw.weeks) ? raw.weeks.length : null,
            sunlight: {
              sunHours: raw.sunlight?.sunHours ?? null,
              eclipseHours: raw.sunlight?.eclipseHours ?? null,
              eclipseCount: raw.sunlight?.eclipseCount ?? null,
            },
            direct: {
              linkHours: raw.direct?.linkHours ?? null,
              gapHours: raw.direct?.gapHours ?? null,
              gapCount: raw.direct?.gapCount ?? null,
            },
            relay: {
              enabled: Boolean(raw.relay?.enabled),
              benefitHours: raw.relay?.benefitHours ?? 0,
              gapHours: raw.relay?.gapHours ?? null,
            },
            inputSignature: raw.meta?.inputSignature ?? null,
          }
        }
      }
    } catch (cyclesError) {
      cycles = null
    }
    const result = await exportBrief({
      sites: state.sites,
      selectedSite: selectedSite.value,
      mission: state.mission,
      analysis: analysisSnapshot(),
      scores: state.scores,
      landingZones: state.landingZones,
      landingZonesMeta: state.landingZonesMeta,
      cycles,
      locale: i18n.global.locale.value,
    })
    state.export.status = 'done'
    state.export.lastAt = new Date().toISOString()
    state.export.source = result.source
  } catch (error) {
    reportError('export', error)
    state.export.status = 'error'
    state.export.error = error instanceof Error ? error.message : String(error)
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence and watchers                                                   */
/* -------------------------------------------------------------------------- */

function persistMissionSoon() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeStorage(STORAGE_MISSION, state.mission)
  }, 400)
}

watch(() => state.time, () => {
  scheduleInstant(0)
  scheduleMission(400)
  if (state.landingZonesStatus.status === 'done') {
    state.landingZonesStatus = { ...state.landingZonesStatus, status: 'stale' }
    scheduleLandingZonesRefresh(2200)
  }
})

watch(
  () => state.terrain,
  () => {
    scheduleInstant(0)
    scheduleMission(200)
    if (state.landingZones.length || state.landingZonesStatus.status === 'done') {
      state.landingZones = []
      state.landingZoneEntry = null
      state.landingZoneSite = null
      state.landingZonesStatus = { ...state.landingZonesStatus, status: 'stale' }
      scheduleLandingZonesRefresh(600)
    }
  },
)

watch(
  () => state.mission,
  () => {
    if (state.autopilot.status === 'done') state.autopilot.status = 'stale'
    if (state.landingZonesStatus.status === 'done') {
      state.landingZonesStatus = { ...state.landingZonesStatus, status: 'stale' }
      scheduleLandingZonesRefresh(2200)
    }
    persistMissionSoon()
    scheduleMission(400)
  },
  { deep: true },
)

watch(
  () => state.selectedSiteId,
  () => {
    scheduleInstant(0)
    scheduleMission(300)
  },
)

watch(
  () => state.compareSiteIds,
  () => {
    if (state.autopilot.status === 'done') state.autopilot.status = 'stale'
  },
  { deep: true },
)

/** Action namespace shared by the shell and the feature panels. */
export const actions = {
  boot,
  selectSite,
  addCustomSite,
  updateSite,
  setPointerLocation,
  setTerrainRegion,
  toggleCompare,
  clearCompare,
  setTime,
  shiftTime,
  setNow,
  jumpToEvent,
  updateMission,
  setLayerEnabled,
  setLayerStatus,
  setWebglStatus,
  setViewMode,
  setRenderer,
  startPlayback,
  stopPlayback,
  togglePlayback,
  runAutopilot,
  runLandingZones,
  selectLandingZone,
  detectLandingZoneSupport,
  runExport,
  analysisSnapshot,
}

/** Reactive facade for components. */
export function useAppState() {
  return {
    state,
    selectedSite,
    compareSites,
    terrainRegion,
    ephemerisRange,
    workerSummary,
    actions,
  }
}
