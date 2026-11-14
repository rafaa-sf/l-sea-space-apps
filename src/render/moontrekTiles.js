/**
 * Moon Trek south-polar WMTS tile loader.
 *
 * `public/data/layers.json` lists Moon Trek layers served as south
 * polar-stereographic tiles (`default028mm` tile matrix set). Browsers can fetch
 * these directly (the service sends `access-control-allow-origin: *`), so the
 * renderers stitch a small mosaic for the visible terrain region and drape it
 * over the DEM.
 *
 * Tile matrix set (from the published WMTS capabilities):
 *   TopLeftCorner = (-1 095 930 m, 1 095 930 m), 256 px tiles,
 *   zoom 0 scale denominator 3.0578404017857101e7 → 8 561.95 m/px.
 *   matrix width = 2 · 2^zoom, matrix height = 2^zoom.
 */

export const NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX = Object.freeze({
  topLeftX: -1095930,
  topLeftY: 1095930,
  tileSize: 256,
  metersPerPixelAtZoom0: 8561.953125,
  matrixWidthAtZoom0: 2,
  matrixHeightAtZoom0: 1,
})

/** Fill the WMTS URL template placeholders for one tile. */
export function tileUrl(template, zoom, row, col) {
  if (!template) return null
  return template
    .replaceAll('{TileMatrixSet}', 'default028mm')
    .replaceAll('{TileMatrix}', String(zoom))
    .replaceAll('{TileRow}', String(row))
    .replaceAll('{TileCol}', String(col))
    .replaceAll('{z}', String(zoom))
    .replaceAll('{y}', String(row))
    .replaceAll('{x}', String(col))
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function zoomLayout(zoom, boundsM, tileSize) {
  const metersPerPixel = NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.metersPerPixelAtZoom0 / 2 ** zoom
  const tileMeters = metersPerPixel * tileSize
  const matrixWidth = NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.matrixWidthAtZoom0 * 2 ** zoom
  const matrixHeight = NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.matrixHeightAtZoom0 * 2 ** zoom
  const { topLeftX, topLeftY } = NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX
  const col0 = Math.floor((boundsM.minX - topLeftX) / tileMeters)
  const col1 = Math.floor((boundsM.maxX - topLeftX) / tileMeters)
  const row0 = Math.floor((topLeftY - boundsM.maxY) / tileMeters)
  const row1 = Math.floor((topLeftY - boundsM.minY) / tileMeters)
  const clamped = {
    col0: Math.max(0, col0),
    col1: Math.min(matrixWidth - 1, col1),
    row0: Math.max(0, row0),
    row1: Math.min(matrixHeight - 1, row1),
  }
  if (clamped.col1 < clamped.col0 || clamped.row1 < clamped.row0) return null
  return {
    zoom,
    metersPerPixel,
    tileMeters,
    matrixWidth,
    matrixHeight,
    ...clamped,
    cols: clamped.col1 - clamped.col0 + 1,
    rows: clamped.row1 - clamped.row0 + 1,
    count: (clamped.col1 - clamped.col0 + 1) * (clamped.row1 - clamped.row0 + 1),
  }
}

/**
 * Parse the `boundsM` block of a layer catalogue entry into planar metres.
 * Accepts the `{ lower, upper }` string form used by `public/data/layers.json`
 * as well as explicit min/max fields.
 */
export function parseLayerBounds(layer) {
  const bounds = layer?.boundsM
  if (!bounds) return null
  const parsePair = (value) => {
    if (Array.isArray(value)) {
      const [a, b] = value.map(Number)
      return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
    }
    if (typeof value === 'string') {
      const parts = value.trim().split(/[\s,]+/).map(Number)
      return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? [parts[0], parts[1]] : null
    }
    return null
  }
  const lower = parsePair(bounds.lower ?? bounds.min)
  const upper = parsePair(bounds.upper ?? bounds.max)
  if (!lower || !upper) return null
  const minX = Math.min(lower[0], upper[0])
  const maxX = Math.max(lower[0], upper[0])
  const minY = Math.min(lower[1], upper[1])
  const maxY = Math.max(lower[1], upper[1])
  if (!(maxX > minX) || !(maxY > minY)) return null
  return { minX, maxX, minY, maxY }
}

/** Overlap of two planar bounds, or null when they do not intersect. */
export function intersectBounds(a, b) {
  if (!a || !b) return null
  const minX = Math.max(a.minX, b.minX)
  const maxX = Math.min(a.maxX, b.maxX)
  const minY = Math.max(a.minY, b.minY)
  const maxY = Math.min(a.maxY, b.maxY)
  if (!(maxX > minX) || !(maxY > minY)) return null
  return { minX, maxX, minY, maxY }
}

/** Rounded coverage in km for a planar bounds rectangle. */
export function coverageKm(bounds) {
  if (!bounds) return null
  return {
    width: Math.max(1, Math.round((bounds.maxX - bounds.minX) / 1000)),
    height: Math.max(1, Math.round((bounds.maxY - bounds.minY) / 1000)),
  }
}

/**
 * Stitch a mosaic of Moon Trek WMTS tiles covering `boundsM`.
 *
 * @param {{url?: string, template?: string, maxZoom?: number}} layer
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} boundsM
 * @param {{maxTiles?: number, maxCanvasSize?: number}} [options]
 * @returns {Promise<{canvas: HTMLCanvasElement, boundsM: Object, zoom: number, loaded: number, total: number, template: string}|null>}
 */
export async function loadMoonTrekMosaic(layer, boundsM, options = {}) {
  const template = layer?.url ?? layer?.template
  if (!template || typeof document === 'undefined' || !boundsM) return null
  const maxTiles = options.maxTiles ?? 64
  const maxCanvasSize = options.maxCanvasSize ?? 2048
  const maxZoom = Math.min(Number(options.maxZoom ?? layer?.maxZoom ?? 9), 12)
  const tileSize = NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.tileSize

  // Only the portion of the layer that intersects the rendered region is
  // fetched, and the zoom is chosen from that footprint. A limited-coverage
  // layer (e.g. LOLA 87.5S-90S) therefore gets a much sharper zoom than when
  // the whole 608 km terrain region was used as the tile-layout extent.
  const layerBounds = parseLayerBounds(layer)
  const visibleBounds = layerBounds ? intersectBounds(layerBounds, boundsM) : boundsM
  if (!visibleBounds) return null

  let layout = null
  for (let zoom = maxZoom; zoom >= 0; zoom -= 1) {
    const candidate = zoomLayout(zoom, visibleBounds, tileSize)
    if (!candidate) continue
    if (candidate.cols * tileSize > maxCanvasSize || candidate.rows * tileSize > maxCanvasSize) continue
    layout = candidate
    if (candidate.count <= maxTiles) break
  }
  if (!layout || layout.count > maxTiles) return null

  const canvas = document.createElement('canvas')
  canvas.width = layout.cols * tileSize
  canvas.height = layout.rows * tileSize
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true

  const tasks = []
  for (let row = layout.row0; row <= layout.row1; row += 1) {
    for (let col = layout.col0; col <= layout.col1; col += 1) {
      const url = tileUrl(template, layout.zoom, row, col)
      tasks.push(
        loadImage(url).then((image) => {
          if (!image) return false
          context.drawImage(image, (col - layout.col0) * tileSize, (row - layout.row0) * tileSize)
          return true
        }),
      )
    }
  }
  const results = await Promise.all(tasks)
  const loaded = results.filter(Boolean).length
  if (!loaded) return null

  const mosaicBounds = {
    minX: NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.topLeftX + layout.col0 * layout.tileMeters,
    maxX: NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.topLeftX + (layout.col1 + 1) * layout.tileMeters,
    maxY: NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.topLeftY - layout.row0 * layout.tileMeters,
    minY: NORTH_POLE_STEREOGRAPHIC_TILE_MATRIX.topLeftY - (layout.row1 + 1) * layout.tileMeters,
  }

  return {
    canvas,
    boundsM: mosaicBounds,
    footprintBounds: layerBounds,
    coverageKm: coverageKm(visibleBounds),
    zoom: layout.zoom,
    loaded,
    total: layout.count,
    template,
  }
}
