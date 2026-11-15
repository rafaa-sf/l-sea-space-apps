/**
 * Unit tests for the service adapters that are pure enough to test without a
 * browser: data URLs, site parsing, Moon Trek URL builders, the JSON brief and
 * the storage fallback.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { appBaseUrl, dataRootUrl, dataUrl } from './dataUrl.js'
import {
  parseSitesPayload,
  normalizeSite,
  createCustomSite,
  createPointerSite,
  getSiteById,
  slugify,
} from './sites.js'
import {
  buildTileUrl,
  buildWmtsKvpUrl,
  buildWmsUrl,
  buildQuickMapUrl,
  buildMoonTrekViewerUrl,
  getLayerById,
  layerAttribution,
  loadLayerCatalogue,
  clearLayersCache,
  MOON_TREK_URL,
} from './moontrek.js'
import { buildBrief, briefToJson, briefFilename, downloadBrief, briefSummaryText, BRIEF_SCHEMA } from './export.js'
import { MOON_RADIUS_M } from '../core/geometry.js'
import { createProjectedTerrain } from '../core/terrain.js'
import { normalizeEphemerisDataset } from '../core/ephemeris.js'
import { solarPowerEstimate } from '../core/power.js'
import {
  readStorage,
  writeStorage,
  loadState,
  saveState,
  clearState,
  isStorageAvailable,
} from './storage.js'
import {
  buildHorizonsQuery,
  parseHorizonsTable,
  parseHorizonsJson,
  mergeLiveBodies,
  toHorizonsDate,
  loadEphemeris,
  clearEphemerisCache,
} from './horizons.js'
import { loadTerrainIndex, clearTerrainCache } from './lola.js'
import { createComputeClient } from './computeClient.js'

const LAYER = {
  id: 'lola-color-hillshade-5m',
  name: 'LOLA 87.5S-90S 5 m/px — color hillshade',
  type: 'wmts',
  label: 'LRO_LOLA_ClrShade_SPole875_5mp_v04',
  url: 'https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/1.0.0/default/default028mm/{z}/{y}/{x}.png',
  template:
    'https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png',
  tileMatrixSet: 'default028mm',
  format: 'image/png',
  minZoom: 0,
  maxZoom: 9,
  attribution: 'NASA/GSFC/ASU',
  capabilitiesUrl:
    'https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/1.0.0/WMTSCapabilities.xml',
  viewerUrl: 'https://trek.nasa.gov/moon/',
}

describe('dataUrl', () => {
  it('builds base and data URLs', () => {
    expect(appBaseUrl()).toMatch(/\/$/)
    expect(dataRootUrl()).toMatch(/\/data\/$/)
    expect(dataUrl('pois.json')).toMatch(/\/data\/pois\.json$/)
    expect(dataUrl('/terrain/index.json')).toMatch(/\/data\/terrain\/index\.json$/)
    expect(dataUrl('pois.json', 'https://example.test/custom/data')).toBe(
      'https://example.test/custom/data/pois.json',
    )
  })
})

describe('sites service', () => {
  const poiPayload = [
    {
      id: 'shackleton-rim',
      name: 'Shackleton crater rim',
      lat: -89.78,
      lon: 204.27,
      elevationM: 1734,
      perimeterM: 200,
      mastM: 10,
      source: 'poi',
      provenance: 'Orrery Space landing-site catalogue',
    },
  ]

  it('parses the data-pipeline POI shape', () => {
    const sites = parseSitesPayload(poiPayload)
    expect(sites.length).toBe(1)
    expect(sites[0].id).toBe('shackleton-rim')
    expect(sites[0].elevationM).toBe(1734)
    expect(sites[0].provenance).toContain('Orrery')
  })

  it('parses GeoJSON feature collections', () => {
    const sites = parseSitesPayload({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [222.69, -89.45] },
          properties: { name: 'Connecting Ridge' },
        },
      ],
    })
    expect(sites.length).toBe(1)
    expect(sites[0].lon).toBeCloseTo(222.69, 6)
    expect(sites[0].lat).toBeCloseTo(-89.45, 6)
  })

  it('normalizes aliases and rejects invalid coordinates', () => {
    const site = normalizeSite({ name: 'Test', latitude: -88, longitude: -10, elevation: 42 })
    expect(site.lat).toBe(-88)
    expect(site.lon).toBe(350)
    expect(site.elevationM).toBe(42)
    expect(normalizeSite({ lat: 'x', lon: 0 })).toBeNull()
    expect(normalizeSite({ lat: 95, lon: 0 })).toBeNull()
  })

  it('creates custom and pointer sites', () => {
    const custom = createCustomSite({ lat: -89.5, lon: 200 })
    expect(custom.source).toBe('custom')
    expect(custom.id.startsWith('custom-')).toBe(true)
    expect(createPointerSite({ lat: -89.5, lon: 200 }).source).toBe('pointer')
    expect(() => createCustomSite({ lat: 91, lon: 0 })).toThrow(TypeError)
  })

  it('finds sites by id and slugifies', () => {
    const sites = parseSitesPayload(poiPayload)
    expect(getSiteById(sites, 'shackleton-rim').name).toContain('Shackleton')
    expect(getSiteById(sites, 'missing')).toBeNull()
    expect(slugify('Peak near Shackleton!')).toBe('peak-near-shackleton')
  })
})

describe('Moon Trek service', () => {
  it('builds XYZ and WMTS tile URLs', () => {
    expect(buildTileUrl(LAYER, { z: 4, x: 8, y: 9 })).toBe(
      'https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_ClrShade_SPole875_5mp_v04/1.0.0/default/default028mm/4/9/8.png',
    )
    expect(buildTileUrl(LAYER, { z: 4, x: 8, y: 9 })).toContain('/4/9/8.png')
    expect(buildTileUrl(null, { z: 0, x: 0, y: 0 })).toBeNull()
  })

  it('builds WMTS KVP and WMS URLs', () => {
    const kvp = buildWmtsKvpUrl(LAYER, { z: 3, x: 4, y: 5 })
    expect(kvp).toContain('SERVICE=WMTS')
    expect(kvp).toContain('TILEMATRIX=3')
    expect(kvp).toContain('TILEROW=5')
    expect(kvp).toContain('TILECOL=4')

    const wms = buildWmsUrl(
      { url: 'https://example.test/wms', wmsLayer: 'layer' },
      { bbox: [-1, -90, 1, -89], width: 256, height: 256 },
    )
    expect(wms).toContain('REQUEST=GetMap')
    expect(wms).toContain('LAYERS=layer')
  })

  it('builds QuickMap and Moon Trek viewer links', () => {
    const quickMap = buildQuickMapUrl({ lat: -89.78, lon: 204.27 })
    expect(quickMap.startsWith('https://quickmap.lroc.asu.edu/?')).toBe(true)
    expect(quickMap).toContain('proj=10')
    expect(quickMap).toContain('extent=')
    expect(buildQuickMapUrl({ lat: 'x' })).toBe('https://quickmap.lroc.asu.edu/')
    expect(buildMoonTrekViewerUrl({ layer: LAYER })).toBe(MOON_TREK_URL)
  })

  it('looks up layers and attribution', () => {
    const layers = [LAYER]
    expect(getLayerById(layers, LAYER.id)).toBe(LAYER)
    expect(layerAttribution(LAYER)).toBe('NASA/GSFC/ASU')
  })
})

describe('export service', () => {
  const sites = [
    {
      id: 'connecting-ridge',
      name: 'Connecting Ridge',
      lat: -89.45,
      lon: 222.69,
      elevationM: 1954,
      perimeterM: 200,
      mastM: 10,
      source: 'poi',
    },
  ]
  const mission = { missionDays: 14, powerNeedW: 120 }
  const scores = [
    {
      siteId: 'connecting-ridge',
      rank: 1,
      score: 96,
      grade: 'excellent',
      confidence: 1,
      components: { sun: 100, power: 100, comms: 94, terrain: 82, logistics: 100 },
      metrics: { averageW: 685 },
      reasons: [{ code: 'sun.continuous', severity: 'good', params: { days: 14 }, text: 'Continuous sunlight.' }],
      warnings: [],
    },
  ]

  it('builds a JSON-serializable brief with links and attribution', () => {
    const brief = buildBrief({ sites, mission, computation: { scores } })
    expect(brief.schema).toBe(BRIEF_SCHEMA)
    expect(brief.sites.length).toBe(1)
    expect(brief.rankedSites.length).toBe(1)
    expect(brief.rankedSites[0].score).toBe(96)
    expect(brief.links.quickMap).toContain('quickmap.lroc.asu.edu')
    expect(brief.links.moonTrek).toBe(MOON_TREK_URL)
    expect(brief.dataSources.length).toBeGreaterThanOrEqual(4)
    expect(brief.limitations.length).toBeGreaterThan(0)
    expect(brief.sites[0].links.quickMap).toContain('extent=')
    expect(JSON.parse(briefToJson(brief)).schema).toBe(BRIEF_SCHEMA)
  })

  it('includes ranked landing zones from the zone autopilot', () => {
    const landingZones = [
      {
        rank: 1,
        zone: {
          id: 'zone-02',
          lat: 84.71,
          lon: 96.13,
          areaKm2: 174.2,
          meanSlopeDeg: 0.3,
          maxSlopeDeg: 0.6,
          elevationM: -3720,
          reliefM: 79,
        },
        score: 99.1,
        grade: 'excellent',
        ephemerisSiteId: 'nobile-rim-2',
        nearestSiteDistanceM: 113100,
        confidence: 0.9,
        feasible: false,
        feasibility: { feasible: false, status: 'infeasible', violations: [{ code: 'feasibility.powerDeficit' }] },
        rawScore: 78.3,
        scoreCapApplied: true,
        inputSignature: 'abcd1234',
        components: { power: 80, sun: 90, comms: 70, safety: 95, thermal: 60, logistics: 50, science: 40 },
        metrics: {
          power: { averageW: 546, requiredBatteryWh: 37085, heaterWh: 18691 },
          thermal: { nightC: -180, dayC: -52.5 },
          comms: { earthVisibilityFraction: 0.73 },
          illumination: { sunlitFraction: 0.801, continuousSunDays: 11.2 },
        },
        warnings: [{ code: 'ephemeris-nearest-site' }],
      },
    ]
    const brief = buildBrief({ sites, mission, computation: { scores, landingZones } })
    expect(brief.rankedLandingZones).toHaveLength(1)
    expect(brief.rankedLandingZones[0].areaKm2).toBe(174.2)
    expect(brief.rankedLandingZones[0].meanSlopeDeg).toBe(0.3)
    expect(brief.rankedLandingZones[0].ephemerisSiteId).toBe('nobile-rim-2')
    expect(brief.rankedLandingZones[0].metrics.power.averageW).toBe(546)
    expect(brief.rankedLandingZones[0].metrics.thermal.nightC).toBe(-180)
    expect(brief.rankedLandingZones[0].components.power).toBe(80)
    expect(brief.rankedLandingZones[0].inputSignature).toBe('abcd1234')
    expect(brief.rankedLandingZones[0].feasible).toBe(false)
    expect(brief.rankedLandingZones[0].feasibility.violations[0].code).toBe('feasibility.powerDeficit')
    expect(brief.rankedLandingZones[0].rawScore).toBe(78.3)
    expect(brief.rankedLandingZones[0].scoreCapApplied).toBe(true)
    expect(JSON.parse(briefToJson(brief)).rankedLandingZones).toHaveLength(1)
  })

  it('handles empty input', () => {
    const brief = buildBrief({})
    expect(brief.sites).toEqual([])
    expect(brief.rankedSites).toEqual([])
    expect(brief.selectedSite).toBeNull()
    expect(brief.links.moonTrek).toBe(MOON_TREK_URL)
  })

  it('names the file with a UTC timestamp and is a no-op outside the browser', () => {
    const filename = briefFilename(new Date('2026-11-14T12:30:00Z'))
    expect(filename).toBe('lsea-brief-2026-11-14-12-30-00Z.json')
    expect(downloadBrief({ schema: BRIEF_SCHEMA })).toBeNull()
  })

  it('renders a plain-text summary', () => {
    const brief = buildBrief({ sites, mission, computation: { scores } })
    const text = briefSummaryText(brief)
    expect(text).toContain('mission brief')
    expect(text).toContain('Connecting Ridge')
  })
})


describe('brief analysis completeness (task-59 BH-08)', () => {
  const readyAnalysis = {
    ready: true,
    unavailable: false,
    coverageReason: null,
    timeWarning: null,
    power: { averageW: 100 },
  }

  it('marks a ready analysis as complete with no extra limitation', () => {
    const brief = buildBrief({
      sites: [],
      mission: { missionDays: 14, powerNeedW: 120 },
      computation: { analysis: readyAnalysis },
    })
    expect(brief.analysisComplete).toBe(true)
    expect(brief.analysisIncomplete).toBe(false)
    expect(brief.analysisLimitations).toEqual([])
    expect(brief.limitations).not.toEqual(
      expect.arrayContaining([expect.stringContaining('no analysis snapshot')]),
    )
  })

  it('marks a missing analysis as incomplete and adds explicit limitations', () => {
    const brief = buildBrief({ sites: [], mission: {}, computation: { analysis: null } })
    expect(brief.analysisComplete).toBe(false)
    expect(brief.analysisIncomplete).toBe(true)
    expect(brief.analysisLimitations.join(' ')).toMatch(/no analysis snapshot/i)
    expect(brief.limitations.join(' ')).toMatch(/Analysis incomplete/i)
  })

  it('surfaces coverage and out-of-window warnings in the brief', () => {
    const brief = buildBrief({
      sites: [],
      mission: {},
      computation: {
        analysis: {
          ready: false,
          unavailable: true,
          coverageReason: 'site-outside-dem',
          timeWarning: {
            code: 'ephemeris-window-clamped',
            start: '2026-11-01T00:00:00.000Z',
            end: '2026-12-31T23:30:00.000Z',
            clampedTo: '2026-11-01T00:00:00.000Z',
          },
        },
      },
    })
    expect(brief.analysisIncomplete).toBe(true)
    expect(brief.analysisLimitations.join(' ')).toMatch(/outside the loaded LOLA DEM/i)
    expect(brief.analysisLimitations.join(' ')).toMatch(/outside the precomputed ephemeris window/i)
  })
})

describe('solar power uses the selected mission date (task-59 BH-07)', () => {
  function makeTerrain() {
    const width = 64
    const height = 64
    const bounds = 3200
    return createProjectedTerrain(
      {
        id: 'bh07',
        referenceRadiusM: MOON_RADIUS_M,
        width,
        height,
        pixelSizeM: (2 * bounds) / width,
        minX: -bounds,
        maxX: bounds,
        minY: -bounds,
        maxY: bounds,
        dtype: 'float32',
      },
      new Float32Array(width * height),
    )
  }

  it('produces different power for a sunlit and a shadowed start date', () => {
    const start = Date.parse('2026-11-01T00:00:00Z')
    const samples = []
    for (let index = 0; index <= 48 * 2; index += 1) {
      const hour = index * 0.5
      samples.push({
        time: new Date(start + index * 30 * 60 * 1000).toISOString(),
        sun: { az: 270, el: hour < 24 ? 2 : -2 },
        earth: { az: 90, el: 2 },
      })
    }
    const ephemeris = normalizeEphemerisDataset({ siteId: 'bh07-ephemeris', samples })
    const terrain = makeTerrain()
    const site = { lat: -90, lon: 0, elevationM: 0 }
    const day0 = solarPowerEstimate(site, terrain, ephemeris, {
      missionDays: 1,
      powerNeedW: 120,
      startTime: new Date(start).toISOString(),
    })
    const day1 = solarPowerEstimate(site, terrain, ephemeris, {
      missionDays: 1,
      powerNeedW: 120,
      startTime: new Date(start + 24 * 3600 * 1000).toISOString(),
    })
    expect(day0.averageW).toBeGreaterThan(0)
    expect(day1.averageW).toBe(0)
    expect(day0.averageW).toBeGreaterThan(day1.averageW)
  })
})

describe('storage service', () => {
  it('works through the in-memory fallback when localStorage is unavailable', () => {
    clearState()
    expect(isStorageAvailable()).toBe(false)
    expect(writeStorage('lsea.v1.test', { a: 1 })).toBe(false)
    expect(readStorage('lsea.v1.test')).toEqual({ a: 1 })
    expect(readStorage('lsea.v1.missing', 'fallback')).toBe('fallback')
  })

  it('reads the in-memory fallback after a failed localStorage write (quota)', () => {
    const fakeLocalStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    vi.stubGlobal('localStorage', fakeLocalStorage)
    try {
      clearState()
      expect(writeStorage('lsea.v1.test-quota', { a: 1 })).toBe(false)
      expect(readStorage('lsea.v1.test-quota')).toEqual({ a: 1 })
      expect(readStorage('lsea.v1.missing', 'fallback')).toBe('fallback')
    } finally {
      clearState()
      vi.unstubAllGlobals()
    }
  })

  it('round-trips the application state', () => {
    clearState()
    saveState({
      sites: [{ id: 'a', lat: -89, lon: 0 }],
      mission: { missionDays: 7 },
      locale: 'es',
      selectedSiteId: 'a',
    })
    const state = loadState()
    expect(state.sites.length).toBe(1)
    expect(state.mission.missionDays).toBe(7)
    expect(state.locale).toBe('es')
    expect(state.selectedSiteId).toBe('a')
    clearState()
    expect(loadState().sites).toEqual([])
  })
})

describe('compute client', () => {
  it('falls back to inline execution when no Worker is available', async () => {
    const client = createComputeClient({ workerFactory: () => null })
    expect(client.mode()).toBe('inline')
    expect(client.isWorkerSupported()).toBe(false)
    expect(client.status()).toBe('inline')
    const result = await client.request('ping')
    expect(result.pong).toBe(true)
    expect(client.lastError()).toBeNull()
    client.terminate()
    expect(client.status()).toBe('terminated')
  })

  it('rejects a request when the abort signal fires', async () => {
    const client = createComputeClient({ workerFactory: () => null })
    const controller = new AbortController()
    const promise = client.request('ping', {}, { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
    client.terminate()
  })

  it('rejects requests after termination', async () => {
    const client = createComputeClient({ workerFactory: () => null })
    client.terminate()
    await expect(client.request('ping')).rejects.toThrow(/terminated/i)
  })
})

describe('Horizons helpers', () => {
  it('formats Horizons dates', () => {
    expect(toHorizonsDate('2026-11-14T12:30:00Z')).toBe('2026-11-14 12:30')
  })

  it('builds a dev-only observer query', () => {
    const url = buildHorizonsQuery({
      target: '10',
      site: { lat: -89.78, lon: 204.27, elevationM: 1734 },
      start: '2026-11-14T00:00:00Z',
      stop: '2026-11-15T00:00:00Z',
      step: '1 h',
    })
    expect(url.startsWith('/nasa/horizons?')).toBe(true)
    expect(url).toContain('COMMAND=10')
    expect(url).toContain('EPHEM_TYPE=OBSERVER')
    expect(url).toContain('CENTER=coord%40301')
    expect(url).toContain('QUANTITIES=4')
    expect(url).toContain('START_TIME=2026-11-14+00%3A00')
  })

  it('parses a Horizons observer table', () => {
    const text = [
      ' Date__(UT)__HR:MN  Azimuth Elevation',
      '$$SOE',
      ' 2026-Nov-14 00:00,  276.248,  1.581',
      ' 2026-Nov-14 00:30,  276.000,  1.585',
      '$$EOE',
    ].join('\n')
    const rows = parseHorizonsTable(text)
    expect(rows.length).toBe(2)
    expect(rows[0].time).toBe('2026-11-14T00:00:00Z')
    expect(rows[0].az).toBeCloseTo(276.248, 3)
    expect(rows[0].el).toBeCloseTo(1.581, 3)
    expect(parseHorizonsJson({ result: text }).length).toBe(2)
    expect(parseHorizonsTable('no table here')).toEqual([])
  })

  it('merges Sun and Earth rows into an ephemeris dataset', () => {
    const dataset = mergeLiveBodies(
      [{ time: '2026-11-14T00:00:00Z', az: 270, el: 1 }],
      [{ time: '2026-11-14T00:00:00Z', az: 180, el: 2 }],
      { siteId: 'live', site: { lat: -89.5, lon: 90 } },
    )
    expect(dataset.samples.length).toBe(1)
    expect(dataset.samples[0].sun.el).toBe(1)
    expect(dataset.samples[0].earth.el).toBe(2)
  })
})

describe('service load retries', () => {
  let warnSpy

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    clearEphemerisCache()
    clearTerrainCache()
    clearLayersCache()
    warnSpy.mockRestore()
  })

  it('retries the ephemeris load after a transient fetch failure and caches the success', async () => {
    const payload = {
      site: { lat: -89.9, lon: 0 },
      samples: [
        { time: '2026-11-01T00:00:00Z', sun: { az: 10, el: 1 }, earth: { az: 20, el: 2 } },
        { time: '2026-11-01T00:30:00Z', sun: { az: 11, el: 1.5 }, earth: { az: 21, el: 2.5 } },
      ],
    }
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('transient network error')
      return { ok: true, status: 200, json: async () => payload }
    }

    expect(await loadEphemeris('demo', { fetchImpl })).toBeNull()
    const dataset = await loadEphemeris('demo', { fetchImpl })
    expect(dataset).not.toBeNull()
    expect(dataset.siteId).toBe('demo')
    expect(dataset.samples.length).toBe(2)
    expect(calls).toBe(2)

    // The successful retry is cached: no third request.
    expect(await loadEphemeris('demo', { fetchImpl })).toBe(dataset)
    expect(calls).toBe(2)
  })

  it('retries the terrain index after a transient fetch failure and caches the success', async () => {
    const payload = {
      referenceRadiusM: 1737400,
      regions: [
        { id: 'r1', boundsM: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, pixelSizeM: 1, width: 2, height: 2 },
      ],
    }
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('transient network error')
      return { ok: true, status: 200, json: async () => payload }
    }

    expect(await loadTerrainIndex({ fetchImpl })).toBeNull()
    const index = await loadTerrainIndex({ fetchImpl })
    expect(index).not.toBeNull()
    expect(index.regions.map((region) => region.id)).toEqual(['r1'])
    expect(calls).toBe(2)

    expect(await loadTerrainIndex({ fetchImpl })).toBe(index)
    expect(calls).toBe(2)
  })

  it('retries the layer catalogue after a transient fetch failure and caches the success', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('transient network error')
      return { ok: true, status: 200, json: async () => ({ layers: [{ id: 'l1' }] }) }
    }

    expect((await loadLayerCatalogue({ fetchImpl })).layers).toEqual([])
    const catalogue = await loadLayerCatalogue({ fetchImpl })
    expect(catalogue.layers.map((layer) => layer.id)).toEqual(['l1'])
    expect(calls).toBe(2)

    expect(await loadLayerCatalogue({ fetchImpl })).toBe(catalogue)
    expect(calls).toBe(2)
  })
})
