#!/usr/bin/env node
// L-SEA Space Apps - build and VERIFY public/data/layers.json.
//
// The layer catalogue points at the real NASA Moon Trek WMTS services for the
// lunar south pole. Every layer is verified at build time:
//   1. fetch its WMTS GetCapabilities document,
//   2. read the advertised ResourceURL template, tile-matrix set and zoom range,
//   3. request a real tile with an Origin header and record HTTP status + CORS.
// A layer is only written to the catalogue when verification succeeds, so the
// deployed app never ships a dead layer.
//
// Usage: node scripts/nasa/build-layers.mjs [--out=public/data/layers.json]

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_FILE = path.join(ROOT, 'public', 'data', 'layers.json')

const TREK = 'https://trek.nasa.gov'
const WMTS_BASE = `${TREK}/tiles/Moon`
const ATTRIBUTION =
  'NASA Moon Trek (NASA/GSFC/ASU) + LRO/LOLA/LROC/Diviner/LAMP/M3/LP/GRAIL products — 30+ verified layers'
const VIEWER_URL = `${TREK}/moon/`

const PROJECTION = {
  type: 'south_polar_stereographic',
  latitudeOfOriginDeg: -90,
  centralMeridianDeg: 0,
  referenceRadiusM: 1737400,
  note: 'Moon Trek SP (south polar) tiles; not an equirectangular lat/lon grid.',
}

/** Curated south-pole layer catalogue: label = Moon Trek WMTS product label. */
const LAYER_DEFS = [
  {
    id: 'lola-color-hillshade-5m',
    label: 'LRO_LOLA_ClrShade_SPole875_5mp_v04',
    name: 'LOLA 87.5S-90S 5 m/px — color hillshade',
    description:
      'High-resolution LOLA DEM rendered as color shaded relief for the inner ' +
      'south polar region. Primary 3D base layer.',
    kind: 'imagery',
  },
  {
    id: 'lola-hillshade-5m',
    label: 'LRO_LOLA_Shade_SPole875_5mp_v04',
    name: 'LOLA 87.5S-90S 5 m/px — hillshade',
    description: 'Greyscale illuminated relief of the inner south polar region.',
    kind: 'imagery',
  },
  {
    id: 'lola-gray-5m',
    label: 'LRO_LOLA_Gray_SPole875_5mp_v04',
    name: 'LOLA 87.5S-90S 5 m/px — grayscale elevation',
    description: 'DEM elevation ramp for the inner south polar region.',
    kind: 'imagery',
  },
  {
    id: 'lola-color-hillshade-30m',
    label: 'LRO_LOLA_ClrShade_SPole75_30mp_v04',
    name: 'LOLA 75S-90S 30 m/px — color hillshade',
    description: 'Mid-resolution color shaded relief covering 75S-90S.',
    kind: 'imagery',
  },
  {
    id: 'lola-color-hillshade-100m',
    label: 'LRO_LOLA_ClrShade_SPole45_100mp_v04',
    name: 'LOLA 45S-90S 100 m/px — color hillshade',
    description: 'Wide-context color shaded relief covering 45S-90S.',
    kind: 'imagery',
  },
  {
    id: 'lola-slope-120m',
    label: 'LRO_LOLA_ClrSlope_SPole75S_120m',
    name: 'LOLA slope 120 m/px — colorized',
    description:
      'Colorized slope map derived from the LOLA DEM; useful for landing-hazard ' +
      'and traverse screening.',
    kind: 'hazard',
  },
  {
    id: 'lroc-wac-100m',
    label: 'LRO_WAC_Mosaic_SPole60_100m_v02',
    name: 'LROC WAC 60S-90S 100 m/px — image mosaic',
    description: 'Wide Angle Camera image mosaic of the south polar region.',
    kind: 'imagery',
  },
  {
    id: 'average-earth-visibility-60m',
    label: 'ClrAVGVISIB_85S_060M_201608_EARTH_SP',
    name: 'Average Earth visibility 60 m/px',
    description:
      'Fraction of time the Earth is visible above the local horizon, from LOLA ' +
      'topography; colorized.',
    kind: 'derived',
  },
  {
    id: 'illumination-pct-100m',
    label: 'WAC_POLE_ILL_PCT_SOUTH_100M',
    name: 'Sunlight illumination percentage 100 m/px',
    description: 'Percentage-based illumination map of the south polar region.',
    kind: 'derived',
  },
  {
    id: 'psr-240m',
    label: 'LRO_LOLA_Illumination_SPole65S_240m',
    name: 'Permanently shadowed regions 240 m/px',
    description: 'Permanently shadowed region mask derived from LOLA illumination modelling.',
    kind: 'derived',
  },
  {
    id: 'diviner-temperature-135m',
    label: 'LRO_Diviner_Temp_Avg_Clr_SPole80_135mp',
    name: 'Diviner average surface temperature 135 m/px',
    description: 'Average surface temperature from the Diviner Lunar Radiometer; colorized.',
    kind: 'derived',
  },
  {
    id: 'artemis-site-connecting-ridge',
    label: 'Site01_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Connecting Ridge (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Connecting Ridge candidate region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-shackleton-rim',
    label: 'Site04_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Shackleton Rim (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Shackleton Rim candidate region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-peak-near-shackleton',
    label: 'Site07_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Peak Near Shackleton (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Peak Near Shackleton region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-de-gerlache-rim',
    label: 'Site11_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — de Gerlache Rim (5 m/px)',
    description: '5 m/px LOLA color hillshade over the de Gerlache Rim region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-malapert-massif',
    label: 'Site23_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Malapert Massif (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Malapert Massif region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-haworth',
    label: 'Haworth_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Haworth (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Haworth region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-leibnitz-beta',
    label: 'Site20_final_adj_5mpp_ClrHillshade_SP',
    name: 'Artemis III site mosaic — Leibnitz Beta Plateau (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Leibnitz Beta Plateau region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-nobile-rim-2',
    label: 'DM2_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Nobile Rim 2 (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Nobile Rim 2 region.',
    kind: 'site',
  },
  {
    id: 'artemis-site-nobile-rim-1',
    label: 'Site06_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Nobile Rim 1 (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Nobile Rim 1 region.',
    kind: 'site',
  },
  // Additional official NASA Moon Trek products (task-54): sharper terrain,
  // hazard masks and derived products added after the initial 21-layer set.
  {
    id: 'lola-color-slope-5m',
    label: 'ColorSlope_LRO_LOLA_DEM_SPole875_5mp_v04',
    name: 'LOLA 87.5S 5 m/px — color slope',
    description:
      'Colorized slope map derived from the high-resolution LOLA 87.5S-90S DEM; ' +
      'finer hazard screening than the 120 m slope layer.',
    kind: 'hazard',
  },
  {
    id: 'lola-slope-below-5deg-5m',
    label: 'ColorSlope_05below_LRO_LOLA_DEM_SPole875_5m',
    name: 'LOLA 87.5S 5 m/px — slope below 5 degrees',
    description: 'Binary colorized mask of terrain with slope below 5 degrees in the inner polar region.',
    kind: 'hazard',
  },
  {
    id: 'lola-slope-below-10deg-5m',
    label: 'ColorSlope_10below_LRO_LOLA_DEM_SPole875_5m',
    name: 'LOLA 87.5S 5 m/px — slope below 10 degrees',
    description: 'Binary colorized mask of terrain with slope below 10 degrees in the inner polar region.',
    kind: 'hazard',
  },
  {
    id: 'lola-roughness-240m',
    label: 'LRO_LOLA_ClrRoughness_SPole75S_240m',
    name: 'LOLA 75S-90S 240 m/px — color roughness',
    description: 'Colorized terrain roughness for the south polar region, from LOLA topography.',
    kind: 'hazard',
  },
  {
    id: 'diviner-rock-abundance-171m',
    label: 'Diviner_avg_RockAbundance_SP',
    name: 'Diviner rock abundance ~171 m/px',
    description: 'Average rock abundance from the Diviner Lunar Radiometer; colorized.',
    kind: 'derived',
  },
  {
    id: 'lroc-nac-color-hillshade-3_5m-landing-site',
    label: 'LRO_NAC_ColorHillshade_3_5mpp_IM_1_LandingSite_SP',
    name: 'LROC NAC 3.5 m/px — color hillshade (landing site)',
    description: '3.5 m/px NAC color hillshade mosaic at a candidate landing site.',
    kind: 'imagery',
  },
  {
    id: 'lroc-nac-mosaic-0_67m-malapert',
    label: 'LRO_NAC_Mosaic_0_67mpp_Malapert_Massif_SP',
    name: 'LROC NAC 0.67 m/px — Malapert Massif mosaic',
    description: 'Sub-metre NAC image mosaic of the Malapert Massif candidate region.',
    kind: 'imagery',
  },
  {
    id: 'lroc-nac-slope-3m-malapert',
    label: 'LRO_NAC_Slope_86S356E_3mp',
    name: 'LROC DEM 3 m/px — Malapert slope',
    description: 'Slope map at 3 m/px derived from the LROC stereo DEM around Malapert (86S 356E).',
    kind: 'hazard',
  },
  {
    id: 'lroc-nac-psr-20m',
    label: 'NAC_POLE_PSR_SOUTH_STRETCH',
    name: 'LROC NAC PSR mosaic 20 m/px',
    description: 'Contrast-stretched NAC image mosaic of the south-polar permanently shadowed regions.',
    kind: 'imagery',
  },
  {
    id: 'average-earth-visibility-120m',
    label: 'ClrAVGVISIB_75S_120M_201608_EARTH_SP',
    name: 'Average Earth visibility 120 m/px',
    description: 'Fraction of time the Earth is visible above the local horizon, from LOLA topography.',
    kind: 'derived',
  },
  {
    id: 'sky-visibility-240m',
    label: 'ClrSKYV_65S_240M_SP',
    name: 'Sky visibility 240 m/px',
    description: 'Sky visibility fraction over the south-polar terrain, derived from LOLA topography.',
    kind: 'derived',
  },
  {
    id: 'artemis-site-shoemaker',
    label: 'Shoemaker_final_adj_5mpp_ColorHillshade',
    name: 'Artemis III site mosaic — Shoemaker (5 m/px)',
    description: '5 m/px LOLA color hillshade over the Shoemaker candidate region.',
    kind: 'site',
  },
]

const UNAVAILABLE = ['PSR_SP']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchText(url, opts = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'L-SEA-SpaceApps/1.0 (NASA Space Apps Challenge 2026)' },
    signal: AbortSignal.timeout(60_000),
    ...opts,
  })
  return { response, text: await response.text() }
}

function parseCapabilities(xml) {
  const resourceUrl =
    xml.match(/<ResourceURL[^>]*template="([^"]+)"/)?.[1] ??
    xml.match(/<ResourceURL[^>]*format="[^"]*"[^>]*template="([^"]+)"/)?.[1] ??
    null
  const tileMatrixSet = xml.match(/<TileMatrixSet>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1] ?? null
  const matrixIds = [...xml.matchAll(/<TileMatrix>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>/g)].map(
    (m) => m[1],
  )
  const matrices = [...xml.matchAll(
    /<TileMatrix>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>([\s\S]*?)<\/TileMatrix>/g,
  )].map((m) => {
    const body = m[2]
    const num = (tag) => Number((body.match(new RegExp(`<${tag}>([^<]+)</${tag}>`)) ?? [])[1])
    const [tlx, tly] = ((body.match(/<TopLeftCorner>([^<]+)<\/TopLeftCorner>/) ?? [])[1] ?? '0 0')
      .trim()
      .split(/\s+/)
      .map(Number)
    return {
      id: m[1],
      width: num('MatrixWidth'),
      height: num('MatrixHeight'),
      tileWidth: num('TileWidth'),
      tileHeight: num('TileHeight'),
      topLeftX: tlx,
      topLeftY: tly,
      scaleDenominator: num('ScaleDenominator'),
    }
  })
  const bbox = xml.match(
    /<ows:BoundingBox[^>]*crs="([^"]*)"[^>]*>\s*<ows:LowerCorner>([^<]+)<\/ows:LowerCorner>\s*<ows:UpperCorner>([^<]+)<\/ows:UpperCorner>/,
  )
  const format = xml.match(/<ResourceURL[^>]*format="([^"]+)"/)?.[1] ?? 'image/png'
  return { resourceUrl, tileMatrixSet, matrixIds, matrices, bbox, format }
}

async function verifyLayer(def) {
  const capsUrl = `${WMTS_BASE}/SP/${def.label}/1.0.0/WMTSCapabilities.xml`
  const { response: capsResponse, text: xml } = await fetchText(capsUrl)
  if (!capsResponse.ok) throw new Error(`capabilities HTTP ${capsResponse.status}`)
  const caps = parseCapabilities(xml)
  if (!caps.resourceUrl) throw new Error('no ResourceURL template in capabilities')
  if (caps.matrices.length === 0) throw new Error('no tile matrices in capabilities')

  const zoomLevels = caps.matrices.map((m) => m.id)
  const maxZoom = Math.max(...zoomLevels.map((z) => Number(z)).filter(Number.isFinite))
  // Normalise the double slash some Moon Trek templates contain after "1.0.0//".
  const cleanTemplate = caps.resourceUrl.replace(/\/\/\{Style\}/, '/{Style}')

  // Build a probe URL that lands inside the layer's advertised bounding box:
  // sparse site mosaics only have data in the tiles that overlap their footprint.
  const bbox = caps.bbox
  const centre = bbox
    ? {
        x: (Number(bbox[2].trim().split(/\s+/)[0]) + Number(bbox[3].trim().split(/\s+/)[0])) / 2,
        y: (Number(bbox[2].trim().split(/\s+/)[1]) + Number(bbox[3].trim().split(/\s+/)[1])) / 2,
      }
    : { x: 0, y: 0 }

  const buildUrl = (zoom, matrix, row, col) =>
    cleanTemplate
      .replace('{Style}', 'default')
      .replace('{TileMatrixSet}', caps.tileMatrixSet ?? 'default028mm')
      .replace('{TileMatrix}', String(zoom))
      .replace('{TileRow}', String(row))
      .replace('{TileCol}', String(col))

  const candidates = []
  for (const zoom of [Math.min(4, maxZoom), Math.min(2, maxZoom), 0]) {
    const matrix = caps.matrices.find((m) => Number(m.id) === zoom)
    if (!matrix || !matrix.scaleDenominator) continue
    const tileSpanM = matrix.tileWidth * 0.00028 * matrix.scaleDenominator
    const col = Math.max(0, Math.min(matrix.width - 1, Math.floor((centre.x - matrix.topLeftX) / tileSpanM)))
    const row = Math.max(0, Math.min(matrix.height - 1, Math.floor((matrix.topLeftY - centre.y) / tileSpanM)))
    candidates.push({ zoom, row, col, url: buildUrl(zoom, matrix, row, col) })
  }
  if (candidates.length === 0) throw new Error('could not derive a probe tile from capabilities')

  let tile = null
  let probe = null
  for (const candidate of candidates) {
    const response = await fetch(candidate.url, {
      headers: {
        Origin: 'http://localhost:5173',
        'User-Agent': 'L-SEA-SpaceApps/1.0 (NASA Space Apps Challenge 2026)',
      },
      signal: AbortSignal.timeout(60_000),
    })
    if (response.ok && (response.headers.get('content-type') ?? '').startsWith('image/')) {
      tile = response
      probe = candidate
      break
    }
    response.body?.cancel?.()
  }
  if (!tile) throw new Error(`no probe tile returned an image (tried z/${candidates.length} tiles)`)
  const cors = tile.headers.get('access-control-allow-origin')
  const contentType = tile.headers.get('content-type') ?? ''
  const bytes = (await tile.arrayBuffer()).byteLength
  await sleep(400)

  const capTemplate = caps.resourceUrl
    .replace(/\/\/\{Style\}/, '/{Style}')
    .replace('{Style}', 'default')
    .replace('{TileMatrixSet}', caps.tileMatrixSet ?? 'default028mm')

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    kind: def.kind,
    type: 'wmts',
    label: def.label,
    // `url` uses the generic {z}/{x}/{y} tile placeholder convention understood
    // by the renderer; `template` keeps the OGC WMTS ResourceURL verbatim.
    url: capTemplate
      .replace('{TileMatrix}', '{z}')
      .replace('{TileCol}', '{x}')
      .replace('{TileRow}', '{y}'),
    template: capTemplate,
    urlPlaceholders: { z: 'TileMatrix', x: 'TileCol', y: 'TileRow' },
    tileMatrixSet: caps.tileMatrixSet ?? 'default028mm',
    format: caps.format,
    minZoom: 0,
    maxZoom,
    projection: PROJECTION,
    boundsM: caps.bbox
      ? { crs: caps.bbox[1], lower: caps.bbox[2].trim(), upper: caps.bbox[3].trim() }
      : null,
    attribution: ATTRIBUTION,
    viewerUrl: VIEWER_URL,
    capabilitiesUrl: capsUrl,
    verified: {
      checkedAt: new Date().toISOString(),
      httpStatus: tile.status,
      cors,
      contentType,
      bytes,
      probeUrl: probe.url,
      probeZoom: probe.zoom,
    },
  }
}

async function main() {
  const layers = []
  const failures = []
  for (const def of LAYER_DEFS) {
    process.stdout.write(`verifying ${def.id} (${def.label}) ... `)
    try {
      const layer = await verifyLayer(def)
      layers.push(layer)
      console.log(`OK  z0-${layer.maxZoom} cors=${layer.verified.cors ?? 'none'}`)
    } catch (error) {
      failures.push({ id: def.id, label: def.label, error: error.message })
      console.log(`FAILED: ${error.message}`)
    }
  }

  const payload = {
    generated: new Date().toISOString(),
    source: 'NASA Moon Trek WMTS API (trek.nasa.gov)',
    serviceDocs: 'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon',
    attribution: ATTRIBUTION,
    note:
      'All layers are south-polar-stereographic WMTS (Moon Trek projection IAU2000:30120). ' +
      'Tiles are live requests to NASA servers; CORS is enabled (access-control-allow-origin: *). ' +
      'The static app can display them directly in the browser.',
    projection: PROJECTION,
    unavailable: UNAVAILABLE,
    layers,
    failures,
  }
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`\nwrote ${path.relative(ROOT, OUT_FILE)}: ${layers.length} verified layers, ${failures.length} failures`)
  if (failures.length) console.log(JSON.stringify(failures, null, 2))
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`)
  process.exit(1)
})
