/**
 * Terrain (real LOLA DEM subset) handling: polar-stereographic transforms,
 * bilinear sampling, slope/aspect, area statistics, crater detection and a
 * documented synthetic fallback used only when no real DEM can be loaded.
 *
 * ## Grid contract (see docs/architecture.md)
 *
 * The real LOLA polar DEMs are stored in **polar stereographic projection**
 * with the south pole at the origin, the central meridian 0° along `+y` and a
 * spherical reference radius of `R = 1737400 m`:
 *
 * ```text
 * lonLatToXY: rho = 2·R·tan(π/4 + lat/2);  x = rho·sin(lon);  y = rho·cos(lon)
 * xyToLonLat: rho = hypot(x, y);          lon = atan2(x, y);  lat = 2·atan(rho/(2R)) − π/2
 * grid:       col = (x − minX) / pixelSizeM;  row = (maxY − y) / pixelSizeM
 * ```
 *
 * Row 0 is the `maxY` (northern) edge, column 0 is the `minX` (western) edge.
 * Elevations are meters relative to the reference radius. The runtime terrain
 * object carries the raw integer payload (usually `Int16Array`) plus the
 * projection parameters; all helpers work in latitude/longitude and convert
 * internally.
 *
 * Note on the half-pixel convention: the metadata bounds are pixel *edges*, so
 * pixel centres sit half a pixel inside them. The sampler therefore uses
 * `col = (x − minX)/pixelSizeM − 0.5` (same for rows, from the `maxY` edge),
 * which is the georeferencing of the LOLA raster; the documented
 * `col = (x − minX)/pixelSizeM` formula is the equivalent edge-index form and
 * differs by only half a pixel (37 m for the 20 m product). The outer half pixel
 * is edge-clamped so every point inside the declared bounds samples cleanly.
 *
 * ## Coordinate frames
 *
 * All azimuths are measured clockwise from true (selenodetic) north in the
 * local horizontal frame, matching JPL Horizons output. In the stereographic
 * plane the local north/east unit vectors at longitude `L` are:
 *
 * ```text
 * north = (sin L, cos L)      east = (cos L, −sin L)     (x, y components)
 * ```
 *
 * Polar stereographic is conformal, so local slope angles computed from the
 * projected gradient are true angles: the scale factor cancels.
 *
 * @module core/terrain
 */

import {
  MOON_RADIUS_M,
  DEG,
  RAD,
  clamp,
  normalizeLongitude,
  wrapLongitudeDelta,
  destinationPoint,
  greatCircleDistanceM,
  offsetLatLon,
} from './geometry.js'

/** Reference radius of the Moon used by the LOLA products, in meters. */
export const DEFAULT_REFERENCE_RADIUS_M = MOON_RADIUS_M

/** Projection identifier carried by every terrain grid. */
export const POLAR_STEREOGRAPHIC = 'polar_stereographic'

/**
 * True for the real LOLA grid: a polar-stereographic metric raster with
 * `pixelSizeM`/`minX`/`maxY` bounds.
 *
 * @param {*} terrain
 * @returns {boolean}
 */
export function isPlanarTerrain(terrain) {
  return Boolean(
    terrain &&
      typeof terrain === 'object' &&
      Number.isFinite(Number(terrain.pixelSizeM)) &&
      Number.isFinite(Number(terrain.minX)) &&
      Number.isFinite(Number(terrain.maxY)) &&
      Number.isFinite(Number(terrain.width)) &&
      Number.isFinite(Number(terrain.height)) &&
      terrain.data,
  )
}

/**
 * True for a regular latitude/longitude grid (`lat0/lon0/lat1/lon1` bounds).
 *
 * The UI renderer reduces the full LOLA raster into this cheaper shape for
 * canvas/Three.js use; the scientific core accepts both shapes so the same
 * functions work on full-resolution and reduced terrain.
 *
 * @param {*} terrain
 * @returns {boolean}
 */
export function isLatLonTerrain(terrain) {
  return Boolean(
    terrain &&
      typeof terrain === 'object' &&
      terrain.data &&
      Number.isFinite(Number(terrain.width)) &&
      Number.isFinite(Number(terrain.height)) &&
      Number.isFinite(Number(terrain.lat0)) &&
      Number.isFinite(Number(terrain.lon0)) &&
      Number.isFinite(Number(terrain.lat1)) &&
      Number.isFinite(Number(terrain.lon1)),
  )
}

/**
 * Classify a terrain object.
 *
 * @param {*} terrain
 * @returns {'planar'|'latlon'|'unknown'}
 */
export function terrainKind(terrain) {
  if (isPlanarTerrain(terrain)) return 'planar'
  if (isLatLonTerrain(terrain)) return 'latlon'
  return 'unknown'
}

/**
 * Reference radius of a terrain grid in meters.
 *
 * @param {Object} terrain
 * @returns {number}
 */
export function terrainReferenceRadiusM(terrain) {
  return Number(terrain?.referenceRadiusM ?? terrain?.datum ?? MOON_RADIUS_M)
}

/**
 * @typedef {Object} Terrain
 * @property {string} [id] Region identifier (e.g. `'south-pole-875s-20m'`).
 * @property {string} [role] `'high-resolution'` or `'wide-area'`.
 * @property {'polar_stereographic'} projection Projection identifier.
 * @property {number} referenceRadiusM Reference radius/datum in meters.
 * @property {number} width Grid width in samples (columns, along x).
 * @property {number} height Grid height in samples (rows, along y).
 * @property {number} pixelSizeM Pixel size in projected meters.
 * @property {number} minX Western bound in projected meters.
 * @property {number} maxX Eastern bound in projected meters.
 * @property {number} minY Southern bound in projected meters.
 * @property {number} maxY Northern bound in projected meters.
 * @property {Int16Array|Float32Array} data Elevations in meters, row-major.
 * @property {[number, number]|null} [elevationRangeM] Declared min/max elevation.
 * @property {boolean} synthetic True only for the generated fallback grid.
 * @property {string} [source] Provenance string.
 * @property {string} [attribution] Data attribution string.
 */

/**
 * Convert latitude/longitude to south polar stereographic x/y in meters.
 *
 * Formula: `rho = 2·R·tan(π/4 + lat/2)`, `x = rho·sin(lon)`, `y = rho·cos(lon)`.
 * The pole maps to the origin; `y` grows toward longitude 0° and `x` toward
 * longitude 90°E.
 *
 * @param {number} latDeg Latitude in degrees (negative in the southern hemisphere).
 * @param {number} lonDeg Longitude in degrees east.
 * @param {number} [referenceRadiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {{x: number, y: number}} Projected coordinates in meters.
 */
export function lonLatToXY(latDeg, lonDeg, referenceRadiusM = MOON_RADIUS_M) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return { x: Number.NaN, y: Number.NaN }
  }
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const rho = 2 * referenceRadiusM * Math.tan(Math.PI / 4 + lat / 2)
  return {
    x: rho * Math.sin(lon),
    y: rho * Math.cos(lon),
  }
}

/**
 * Convert south polar stereographic x/y back to latitude/longitude.
 *
 * Formula: `rho = hypot(x, y)`, `lon = atan2(x, y)`,
 * `lat = 2·atan(rho/(2R)) − π/2`.
 *
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * @param {number} [referenceRadiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {{latDeg: number, lonDeg: number}} Geographic coordinates in degrees.
 */
export function xyToLonLat(x, y, referenceRadiusM = MOON_RADIUS_M) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { latDeg: Number.NaN, lonDeg: Number.NaN }
  }
  const rho = Math.hypot(x, y)
  const lonDeg = normalizeLongitude(Math.atan2(x, y) * RAD)
  const latDeg = (2 * Math.atan(rho / (2 * referenceRadiusM)) - Math.PI / 2) * RAD
  return { latDeg, lonDeg }
}

/**
 * Scale factor of the spherical polar stereographic projection at radius rho.
 *
 * Derived from `k = 2/(1 + sin|lat|)` with the stereographic relation
 * `tan(π/4 + lat/2) = rho/(2R)`, which simplifies to `k = 1 + rho²/(4R²)`.
 * Confirms that at the pole `k = 1` and at 80°S `k ≈ 1.0077`.
 *
 * @param {number} rhoM Radial distance from the pole in meters.
 * @param {number} [referenceRadiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {number} Dimensionless scale factor.
 */
export function stereographicScaleFactor(rhoM, referenceRadiusM = MOON_RADIUS_M) {
  return 1 + (rhoM * rhoM) / (4 * referenceRadiusM * referenceRadiusM)
}

/**
 * Decode a base64 payload to bytes (browser and Node compatible).
 *
 * @param {string} text Base64 text.
 * @returns {Uint8Array}
 */
function decodeBase64(text) {
  const cleaned = String(text).replace(/\s+/g, '')
  if (typeof atob === 'function') {
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(cleaned, 'base64'))
  }
  throw new Error('Base64 payload cannot be decoded in this environment')
}

/**
 * Normalize the raw elevation payload of a terrain grid.
 *
 * @param {*} input ArrayBuffer, typed array, plain number array or base64 string.
 * @param {'int16'|'float32'|'float64'|string} [dtype='int16'] Declared sample type.
 * @param {number} [expectedLength] Expected number of samples.
 * @returns {Int16Array|Float32Array}
 */
function toTerrainData(input, dtype = 'int16', expectedLength = 0) {
  const type = String(dtype || 'int16').toLowerCase()

  if (input instanceof ArrayBuffer) {
    if (type === 'float32') return new Float32Array(input)
    if (type === 'float64') return Float32Array.from(new Float64Array(input))
    return new Int16Array(input)
  }
  if (ArrayBuffer.isView(input)) {
    if (input instanceof Int16Array || input instanceof Float32Array) return input
    return Float32Array.from(input)
  }
  if (Array.isArray(input)) {
    return Float32Array.from(input, Number)
  }
  if (typeof input === 'string') {
    const bytes = decodeBase64(input)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (type === 'float32') {
      const out = new Float32Array(Math.floor(bytes.byteLength / 4))
      for (let index = 0; index < out.length; index += 1) out[index] = view.getFloat32(index * 4, true)
      return out
    }
    const out = new Int16Array(Math.floor(bytes.byteLength / 2))
    for (let index = 0; index < out.length; index += 1) out[index] = view.getInt16(index * 2, true)
    return out
  }
  throw new TypeError(`Terrain data must be an ArrayBuffer, typed array or array (got ${typeof input})`)
}

/**
 * Build a terrain grid from a region metadata document (or the equivalent flat
 * fields) plus an optional elevation payload.
 *
 * Accepts both the nested metadata shape produced by the data pipeline
 * (`{ grid: { width, height, pixelSizeM, minX, maxX, ... } }`) and flat fields.
 * When `data` is omitted the caller can pass the binary payload as the second
 * argument.
 *
 * @param {Object} metadata Region metadata (see `public/data/terrain/*.json`).
 * @param {*} [data] Optional elevation payload replacing `metadata.data`.
 * @returns {Terrain} Normalized terrain grid.
 * @throws {TypeError} When bounds/size/data are missing or inconsistent.
 */
export function createProjectedTerrain(metadata, data) {
  if (!metadata || typeof metadata !== 'object') {
    throw new TypeError('createProjectedTerrain expects a metadata object')
  }
  const grid = metadata.grid && typeof metadata.grid === 'object' ? metadata.grid : metadata
  const width = Math.round(Number(grid.width))
  const height = Math.round(Number(grid.height))
  const pixelSizeM = Number(grid.pixelSizeM)
  const minX = Number(grid.minX)
  const maxX = Number(grid.maxX)
  const minY = Number(grid.minY)
  const maxY = Number(grid.maxY)
  const referenceRadiusM = Number(
    metadata.referenceRadiusM ?? grid.referenceRadiusM ?? DEFAULT_REFERENCE_RADIUS_M,
  )

  if (!(width > 1) || !(height > 1)) {
    throw new TypeError('Terrain grid needs width and height greater than 1')
  }
  if (![pixelSizeM, minX, maxX, minY, maxY, referenceRadiusM].every(Number.isFinite)) {
    throw new TypeError('Terrain grid needs finite pixelSizeM, minX/maxX, minY/maxY and referenceRadiusM')
  }
  if (!(pixelSizeM > 0) || !(maxX > minX) || !(maxY > minY)) {
    throw new TypeError('Terrain grid bounds are inconsistent')
  }

  const payload = data ?? metadata.data ?? grid.data
  if (payload === undefined || payload === null) {
    throw new TypeError('Terrain grid is missing its elevation payload')
  }
  const typed = toTerrainData(payload, metadata.dtype ?? metadata.grid?.dtype ?? grid.dtype, width * height)
  if (typed.length !== width * height) {
    throw new TypeError(
      `Terrain payload has ${typed.length} samples, expected ${width * height} (width * height)`,
    )
  }

  const terrain = {
    id: metadata.id ?? null,
    name: metadata.name ?? null,
    role: metadata.role ?? null,
    projection: POLAR_STEREOGRAPHIC,
    referenceRadiusM,
    width,
    height,
    pixelSizeM,
    minX,
    maxX,
    minY,
    maxY,
    widthM: maxX - minX,
    heightM: maxY - minY,
    data: typed,
    dtype: typed instanceof Int16Array ? 'int16' : 'float32',
    elevationRangeM: Array.isArray(metadata.elevationRangeM) ? metadata.elevationRangeM : null,
    source: metadata.source ?? metadata.provenance ?? 'unknown',
    attribution: metadata.attribution ?? 'NASA/GSFC/LOLA (PDS Geosciences Node)',
    synthetic: metadata.synthetic === true,
    meta: metadata,
  }
  return terrain
}

/**
 * Normalize a terrain document into the runtime {@link Terrain} shape.
 *
 * Thin wrapper over {@link createProjectedTerrain} kept for the architecture
 * contract; idempotent when a normalized grid is passed in.
 *
 * @param {Object} raw Region metadata with embedded `data`, or a normalized grid.
 * @returns {Terrain}
 */
export function normalizeTerrain(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('normalizeTerrain expects an object')
  if (
    raw.data &&
    (raw.data instanceof Int16Array || raw.data instanceof Float32Array) &&
    Number.isFinite(raw.pixelSizeM) &&
    Number.isFinite(raw.minX)
  ) {
    return raw
  }
  if ('lat0' in raw && !('pixelSizeM' in raw) && !(raw.grid && 'pixelSizeM' in raw.grid)) {
    throw new TypeError(
      'Legacy latitude/longitude terrain grids are not supported: LOLA products use polar stereographic (see docs/architecture.md)',
    )
  }
  return createProjectedTerrain(raw)
}

/**
 * Axis-aligned projected bounds of a terrain grid.
 *
 * @param {Terrain} terrain
 * @returns {{minX: number, maxX: number, minY: number, maxY: number, pixelSizeM: number, width: number, height: number, referenceRadiusM: number}}
 */
export function terrainBounds(terrain) {
  if (isLatLonTerrain(terrain)) {
    return {
      south: Math.min(terrain.lat0, terrain.lat1),
      north: Math.max(terrain.lat0, terrain.lat1),
      west: Math.min(terrain.lon0, terrain.lon1),
      east: Math.max(terrain.lon0, terrain.lon1),
      referenceRadiusM: terrainReferenceRadiusM(terrain),
    }
  }
  return {
    minX: terrain.minX,
    maxX: terrain.maxX,
    minY: terrain.minY,
    maxY: terrain.maxY,
    pixelSizeM: terrain.pixelSizeM,
    width: terrain.width,
    height: terrain.height,
    referenceRadiusM: terrainReferenceRadiusM(terrain),
  }
}

/**
 * Approximate geographic bounds of a terrain region, for UI extents and export.
 *
 * Samples the four corners, the four edge midpoints and the centre, and derives
 * the latitude interval. The longitude interval is the full `0..360` range when
 * the region contains the pole, otherwise the circular span of the sampled
 * boundary longitudes.
 *
 * @param {Terrain} terrain
 * @returns {{minLat: number, maxLat: number, minLon: number, maxLon: number, containsPole: boolean}}
 */
export function terrainLatLonBounds(terrain) {
  if (isLatLonTerrain(terrain)) {
    const minLat = Math.min(terrain.lat0, terrain.lat1)
    const maxLat = Math.max(terrain.lat0, terrain.lat1)
    const lonSpan = Math.abs(terrain.lon1 - terrain.lon0)
    const containsPole = lonSpan >= 359.999 ? minLat <= -90 + 1e-9 : false
    return {
      minLat,
      maxLat,
      minLon: containsPole ? 0 : normalizeLongitude(Math.min(terrain.lon0, terrain.lon1)),
      maxLon: containsPole ? 360 : normalizeLongitude(Math.max(terrain.lon0, terrain.lon1)),
      containsPole: minLat <= -89.999 || (containsPole && lonSpan >= 359.999),
    }
  }
  const xs = [terrain.minX, (terrain.minX + terrain.maxX) / 2, terrain.maxX]
  const ys = [terrain.minY, (terrain.minY + terrain.maxY) / 2, terrain.maxY]
  const radius = terrainReferenceRadiusM(terrain)
  let minLat = 90
  let maxLat = -90
  const lons = []
  for (const x of xs) {
    for (const y of ys) {
      const { latDeg, lonDeg } = xyToLonLat(x, y, radius)
      if (Number.isFinite(latDeg)) {
        minLat = Math.min(minLat, latDeg)
        maxLat = Math.max(maxLat, latDeg)
      }
      if (Number.isFinite(lonDeg)) lons.push(lonDeg)
    }
  }
  const containsPole = terrain.minX <= 0 && terrain.maxX >= 0 && terrain.minY <= 0 && terrain.maxY >= 0
  if (containsPole) return { minLat, maxLat, minLon: 0, maxLon: 360, containsPole: true }
  const sorted = [...lons].sort((a, b) => a - b)
  let gapStart = 0
  let gapSize = -1
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    const next = index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1]
    if (next - current > gapSize) {
      gapSize = next - current
      gapStart = next
    }
  }
  return {
    minLat,
    maxLat,
    minLon: normalizeLongitude(gapStart),
    maxLon: normalizeLongitude(gapStart + (360 - gapSize)),
    containsPole: false,
  }
}

/**
 * Check whether a geographic point lies inside the terrain coverage.
 *
 * @param {Terrain} terrain
 * @param {number} latDeg Latitude in degrees.
 * @param {number} lonDeg Longitude in degrees.
 * @returns {boolean}
 */
export function isInsideTerrain(terrain, latDeg, lonDeg) {
  if (!terrain || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return false
  if (isLatLonTerrain(terrain) && !isPlanarTerrain(terrain)) {
    const minLat = Math.min(terrain.lat0, terrain.lat1)
    const maxLat = Math.max(terrain.lat0, terrain.lat1)
    if (latDeg < minLat - 1e-6 || latDeg > maxLat + 1e-6) return false
    const lonSpan = Math.abs(terrain.lon1 - terrain.lon0)
    if (lonSpan >= 359.999) return true
    const delta = normalizeLongitude(lonDeg - Math.min(terrain.lon0, terrain.lon1))
    return delta <= lonSpan + 1e-6 || normalizeLongitude(-lonDeg + Math.min(terrain.lon0, terrain.lon1)) <= 1e-6
  }
  const { x, y } = lonLatToXY(latDeg, lonDeg, terrainReferenceRadiusM(terrain))
  return pointInsideBounds(terrain, x, y)
}

/**
 * Check whether projected x/y lies inside the terrain grid (half-pixel tolerant).
 *
 * @param {Terrain} terrain
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * @returns {boolean}
 */
export function pointInsideBounds(terrain, x, y) {
  if (!isPlanarTerrain(terrain) || !Number.isFinite(x) || !Number.isFinite(y)) return false
  const half = terrain.pixelSizeM / 2
  return x >= terrain.minX - half && x <= terrain.maxX + half && y >= terrain.minY - half && y <= terrain.maxY + half
}

/**
 * Bilinear elevation sampling at projected coordinates.
 *
 * @param {Terrain|null} terrain
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * Accepts the same half-pixel margin as {@link pointInsideBounds} and
 * edge-clamps it, so every point reported inside the terrain has a finite
 * sample.
 *
 * @param {{clampToGrid?: boolean}} [options] Snap out-of-range points to the
 *   nearest grid cell instead of returning `NaN`.
 * @returns {number} Elevation in meters relative to the reference radius, or
 *   `NaN` outside the grid.
 */
export function sampleElevationXY(terrain, x, y, options = {}) {
  if (!isPlanarTerrain(terrain) || !Number.isFinite(x) || !Number.isFinite(y)) return Number.NaN
  const { clampToGrid = false } = options

  // Pixel-centre georeferencing: bounds are pixel edges, so subtract half a
  // pixel from the edge-index formula. `pointInsideBounds()` accepts points up
  // to half a pixel *outside* those bounds, so sampling must accept the same
  // band and edge-clamp it. Otherwise a point reported inside the terrain can
  // yield NaN elevation/slope/aspect/horizon (issue #4).
  let col = (x - terrain.minX) / terrain.pixelSizeM - 0.5
  let row = (terrain.maxY - y) / terrain.pixelSizeM - 0.5
  const lastCol = terrain.width - 1
  const lastRow = terrain.height - 1
  const tolerance = 1.0 + 1e-6
  const outside = col < -tolerance || col > lastCol + tolerance || row < -tolerance || row > lastRow + tolerance
  if (outside) {
    if (!clampToGrid) return Number.NaN
  }
  col = clamp(col, 0, lastCol)
  row = clamp(row, 0, lastRow)

  const col0 = Math.floor(col)
  const row0 = Math.floor(row)
  const col1 = Math.min(col0 + 1, lastCol)
  const row1 = Math.min(row0 + 1, lastRow)
  const tx = col - col0
  const ty = row - row0
  const width = terrain.width
  const data = terrain.data

  const z00 = data[row0 * width + col0]
  const z10 = data[row0 * width + col1]
  const z01 = data[row1 * width + col0]
  const z11 = data[row1 * width + col1]
  const top = z00 + (z10 - z00) * tx
  const bottom = z01 + (z11 - z01) * tx
  return top + (bottom - top) * ty
}

/**
 * Bilinear sampling on a reduced latitude/longitude grid.
 *
 * @param {Object} terrain Latitude/longitude terrain grid.
 * @param {number} latDeg Latitude in degrees.
 * @param {number} lonDeg Longitude in degrees east.
 * @param {{clampToGrid?: boolean}} [options]
 * @returns {number} Elevation in meters, or `NaN` outside the grid.
 */
function sampleLatLonElevation(terrain, latDeg, lonDeg, options = {}) {
  const { clampToGrid = false } = options
  const width = Number(terrain.width)
  const height = Number(terrain.height)
  if (!(width > 1) || !(height > 1)) return Number.NaN
  const latSpan = terrain.lat1 - terrain.lat0
  const lonSpan = terrain.lon1 - terrain.lon0
  if (!Number.isFinite(latSpan) || latSpan === 0 || !Number.isFinite(lonSpan) || lonSpan === 0) {
    return Number.NaN
  }

  let fy = ((latDeg - terrain.lat0) / latSpan) * (height - 1)
  let fx
  if (Math.abs(lonSpan) >= 359.999) {
    fx = (normalizeLongitude(lonDeg - terrain.lon0) / 360) * (width - 1)
  } else {
    fx = ((lonDeg - terrain.lon0) / lonSpan) * (width - 1)
    if (fx < -0.5 || fx > width - 0.5) {
      fx = ((wrapLongitudeDelta(lonDeg - terrain.lon0) / lonSpan)) * (width - 1)
    }
  }

  const tolerance = 0.5 + 1e-6
  const outside = fx < -tolerance || fx > width - 1 + tolerance || fy < -tolerance || fy > height - 1 + tolerance
  if (outside) {
    if (!clampToGrid) return Number.NaN
  }
  fx = clamp(fx, 0, width - 1)
  fy = clamp(fy, 0, height - 1)

  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0
  const data = terrain.data
  const z00 = data[y0 * width + x0]
  const z10 = data[y0 * width + x1]
  const z01 = data[y1 * width + x0]
  const z11 = data[y1 * width + x1]
  const top = z00 + (z10 - z00) * tx
  const bottom = z01 + (z11 - z01) * tx
  return top + (bottom - top) * ty
}

/**
 * Bilinear elevation sampling at a latitude/longitude (architecture contract).
 *
 * Converts to south polar stereographic coordinates internally. Values outside
 * the DEM coverage return `NaN` (the UI can show an explicit "outside dataset"
 * state); `options.clampToGrid = true` snaps to the nearest covered cell.
 *
 * @param {Terrain|null} terrain Normalized terrain grid.
 * @param {number} latDeg Latitude in degrees.
 * @param {number} lonDeg Longitude in degrees east.
 * @param {{clampToGrid?: boolean}} [options]
 * @returns {number} Elevation in meters relative to the reference radius, or
 *   `NaN` outside the grid.
 */
export function sampleElevation(terrain, latDeg, lonDeg, options = {}) {
  if (!terrain || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return Number.NaN
  if (isPlanarTerrain(terrain)) {
    const { x, y } = lonLatToXY(latDeg, lonDeg, terrainReferenceRadiusM(terrain))
    return sampleElevationXY(terrain, x, y, options)
  }
  if (isLatLonTerrain(terrain)) return sampleLatLonElevation(terrain, latDeg, lonDeg, options)
  return Number.NaN
}

/**
 * Elevation of a site, preferring the DEM sample and falling back to the
 * catalogue elevation when the site is outside the covered region.
 *
 * @param {Terrain|null} terrain
 * @param {{lat: number, lon: number, elevationM?: number|null}} site
 * @returns {number} Elevation in meters (0 when nothing is known).
 */
export function resolveSiteElevation(terrain, site) {
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return 0
  const sampled = sampleElevation(terrain, site.lat, site.lon)
  if (Number.isFinite(sampled)) return sampled
  return Number.isFinite(site.elevationM) ? Number(site.elevationM) : 0
}

/**
 * Local unit vectors of geographic north and east in the stereographic plane.
 *
 * At longitude `L`: `north = (sin L, cos L)` (outward from the south pole),
 * `east = (cos L, −sin L)`.
 *
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * @returns {{northX: number, northY: number, eastX: number, eastY: number}}
 */
export function localFrameAt(x, y) {
  const rho = Math.hypot(x, y)
  if (!(rho > 0)) return { northX: 0, northY: 1, eastX: 1, eastY: 0 }
  const sinLon = x / rho
  const cosLon = y / rho
  // Increasing latitude means increasing rho (away from the south pole), so
  // geographic north is the outward radial direction; east is +90° clockwise.
  return {
    northX: sinLon,
    northY: cosLon,
    eastX: cosLon,
    eastY: -sinLon,
  }
}

/**
 * Elevation gradient at projected coordinates, returned as geographic
 * east/north components (meters per meter).
 *
 * Central differences in the conformal stereographic plane; the projection's
 * local scale factor is isotropic, so the slope angle is unaffected.
 *
 * @param {Terrain} terrain
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * @param {{stepMeters?: number}} [options]
 * @returns {{dEast: number, dNorth: number}|null} Gradient or `null` without data.
 */
export function gradientAtXY(terrain, x, y, options = {}) {
  if (!terrain) return null
  const step = Number(options.stepMeters) > 0 ? Number(options.stepMeters) : Math.max(terrain.pixelSizeM, 1)
  const center = sampleElevationXY(terrain, x, y)
  if (!Number.isFinite(center)) return null

  const zEast = sampleElevationXY(terrain, x + step, y)
  const zWest = sampleElevationXY(terrain, x - step, y)
  const zNorth = sampleElevationXY(terrain, x, y + step)
  const zSouth = sampleElevationXY(terrain, x, y - step)

  let dX
  let dY
  if (Number.isFinite(zEast) && Number.isFinite(zWest)) dX = (zEast - zWest) / (2 * step)
  else if (Number.isFinite(zEast)) dX = (zEast - center) / step
  else if (Number.isFinite(zWest)) dX = (center - zWest) / step
  else return null

  if (Number.isFinite(zNorth) && Number.isFinite(zSouth)) dY = (zNorth - zSouth) / (2 * step)
  else if (Number.isFinite(zNorth)) dY = (zNorth - center) / step
  else if (Number.isFinite(zSouth)) dY = (center - zSouth) / step
  else return null

  const frame = localFrameAt(x, y)
  return {
    dEast: dX * frame.eastX + dY * frame.eastY,
    dNorth: dX * frame.northX + dY * frame.northY,
  }
}

/**
 * Terrain slope and aspect at projected coordinates.
 *
 * `slope = atan(|∇z|)`; `aspect = atan2(−∂z/∂east, −∂z/∂north)` (downslope
 * azimuth clockwise from north).
 *
 * @param {Terrain} terrain
 * @param {number} x Projected easting in meters.
 * @param {number} y Projected northing in meters.
 * @param {{stepMeters?: number}} [options]
 * @returns {{slopeDeg: number, aspectDeg: number}}
 */
export function slopeAtXY(terrain, x, y, options = {}) {
  const gradient = gradientAtXY(terrain, x, y, options)
  if (!gradient) return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }
  const slopeDeg = Math.atan(Math.hypot(gradient.dEast, gradient.dNorth)) * RAD
  const aspectDeg = normalizeLongitude(Math.atan2(-gradient.dEast, -gradient.dNorth) * RAD)
  return { slopeDeg, aspectDeg }
}

/**
 * Terrain slope and aspect at a latitude/longitude (architecture contract).
 *
 * @param {Terrain} terrain
 * @param {number} latDeg Latitude in degrees.
 * @param {number} lonDeg Longitude in degrees east.
 * @param {{stepMeters?: number}} [options]
 * @returns {{slopeDeg: number, aspectDeg: number}} `NaN` values outside the DEM.
 */
export function slopeAt(terrain, latDeg, lonDeg, options = {}) {
  if (!terrain || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }
  }
  if (isPlanarTerrain(terrain)) {
    const { x, y } = lonLatToXY(latDeg, lonDeg, terrainReferenceRadiusM(terrain))
    return slopeAtXY(terrain, x, y, options)
  }
  if (!isLatLonTerrain(terrain)) return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }

  const radius = terrainReferenceRadiusM(terrain)
  const cell = terrainCellSizeM(terrain, latDeg)
  const step = Number(options.stepMeters) > 0 ? Number(options.stepMeters) : Math.max(cell.northM, cell.eastM, 5)
  const center = sampleElevation(terrain, latDeg, lonDeg)
  if (!Number.isFinite(center)) return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }
  const east = destinationPoint(latDeg, lonDeg, 90, step, radius)
  const west = destinationPoint(latDeg, lonDeg, 270, step, radius)
  const north = destinationPoint(latDeg, lonDeg, 0, step, radius)
  const south = destinationPoint(latDeg, lonDeg, 180, step, radius)
  const zEast = sampleElevation(terrain, east.lat, east.lon)
  const zWest = sampleElevation(terrain, west.lat, west.lon)
  const zNorth = sampleElevation(terrain, north.lat, north.lon)
  const zSouth = sampleElevation(terrain, south.lat, south.lon)

  let dEast
  let dNorth
  if (Number.isFinite(zEast) && Number.isFinite(zWest)) dEast = (zEast - zWest) / (2 * step)
  else if (Number.isFinite(zEast)) dEast = (zEast - center) / step
  else if (Number.isFinite(zWest)) dEast = (center - zWest) / step
  else return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }
  if (Number.isFinite(zNorth) && Number.isFinite(zSouth)) dNorth = (zNorth - zSouth) / (2 * step)
  else if (Number.isFinite(zNorth)) dNorth = (zNorth - center) / step
  else if (Number.isFinite(zSouth)) dNorth = (center - zSouth) / step
  else return { slopeDeg: Number.NaN, aspectDeg: Number.NaN }

  const slopeDeg = Math.atan(Math.hypot(dEast, dNorth)) * RAD
  const aspectDeg = normalizeLongitude(Math.atan2(-dEast, -dNorth) * RAD)
  return { slopeDeg, aspectDeg }
}

/**
 * Approximate size of one cell in meters at a given latitude.
 *
 * For planar LOLA rasters the pixel size is the projected cell size; for
 * reduced latitude/longitude grids the east-west size shrinks with
 * `cos(latitude)` while the north-south size is constant.
 *
 * @param {Object} terrain Terrain grid (planar or latitude/longitude).
 * @param {number} latDeg Latitude in degrees.
 * @returns {{eastM: number, northM: number}}
 */
export function terrainCellSizeM(terrain, latDeg) {
  const radius = terrainReferenceRadiusM(terrain)
  const cosLat = Math.max(Math.cos(clamp(latDeg, -90, 90) * DEG), 1e-6)
  if (isPlanarTerrain(terrain)) {
    return { eastM: terrain.pixelSizeM, northM: terrain.pixelSizeM }
  }
  const stepLat = terrain.height > 1 ? (terrain.lat1 - terrain.lat0) / (terrain.height - 1) : 0
  const stepLon = terrain.width > 1 ? (terrain.lon1 - terrain.lon0) / (terrain.width - 1) : 0
  return {
    eastM: Math.abs(stepLon) * DEG * radius * cosLat,
    northM: Math.abs(stepLat) * DEG * radius,
  }
}

/**
 * Maximum surface distance from a site to the terrain boundary, in meters.
 *
 * Used to bound horizon ray marching. Computed with the exact great-circle
 * distance to the four projected corners.
 *
 * @param {Terrain} terrain
 * @param {{lat: number, lon: number}} site
 * @returns {number} Distance in meters (0 for degenerate grids).
 */
export function terrainExtentM(terrain, site) {
  if (!terrain || !site) return 0
  const radius = terrainReferenceRadiusM(terrain)
  let candidates = []
  if (isPlanarTerrain(terrain)) {
    candidates = [
      { x: terrain.minX, y: terrain.minY },
      { x: terrain.minX, y: terrain.maxY },
      { x: terrain.maxX, y: terrain.minY },
      { x: terrain.maxX, y: terrain.maxY },
    ].map((corner) => xyToLonLat(corner.x, corner.y, radius))
  } else {
    const minLat = Math.min(terrain.lat0, terrain.lat1)
    const maxLat = Math.max(terrain.lat0, terrain.lat1)
    const minLon = Math.min(terrain.lon0, terrain.lon1)
    const maxLon = Math.max(terrain.lon0, terrain.lon1)
    const oppositeLon = normalizeLongitude((minLon + maxLon) / 2 + 180)
    candidates = [
      { lat: minLat, lon: minLon },
      { lat: minLat, lon: maxLon },
      { lat: maxLat, lon: minLon },
      { lat: maxLat, lon: maxLon },
      { lat: minLat, lon: oppositeLon },
      { lat: maxLat, lon: oppositeLon },
    ]
  }
  let maxDistance = 0
  for (const candidate of candidates) {
    const targetLat = Number.isFinite(candidate.lat) ? candidate.lat : candidate.latDeg
    const targetLon = Number.isFinite(candidate.lon) ? candidate.lon : candidate.lonDeg
    const distance = greatCircleDistanceM(site.lat, site.lon, targetLat, targetLon, radius)
    if (Number.isFinite(distance) && distance > maxDistance) maxDistance = distance
  }
  return maxDistance
}

/**
 * Statistics of the terrain inside a site perimeter or sampling radius.
 *
 * Samples a local north/east grid around the site in the projected plane (the
 * conformal projection keeps local shapes). When the requested radius is below
 * a few pixels the sampling radius is expanded (reported as `sampledRadiusM`)
 * so the slope is not dominated by bilinear interpolation.
 *
 * @param {Terrain|null} terrain
 * @param {{lat: number, lon: number}} site
 * @param {{radiusM?: number, stepMeters?: number}} [options]
 * @returns {{
 *   radiusM: number,
 *   sampledRadiusM: number,
 *   sampleCount: number,
 *   validCount: number,
 *   meanElevationM: number,
 *   minElevationM: number,
 *   maxElevationM: number,
 *   elevationRangeM: number,
 *   elevationStdM: number,
 *   meanSlopeDeg: number,
 *   maxSlopeDeg: number,
 * } | null} Statistics, or `null` without terrain.
 */
export function areaStatistics(terrain, site, options = {}) {
  if (!terrain || !site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return null
  const radius = terrainReferenceRadiusM(terrain)
  const cell = terrainCellSizeM(terrain, site.lat)
  const requestedRadius = Number(options.radiusM) > 0 ? Number(options.radiusM) : 200
  const sampledRadius = Math.max(requestedRadius, 3 * Math.max(cell.eastM, cell.northM, 1))
  const step = Number(options.stepMeters) > 0 ? Number(options.stepMeters) : Math.max(10, sampledRadius / 6)

  const elevations = []
  const slopes = []
  for (let north = -sampledRadius; north <= sampledRadius + 1e-6; north += step) {
    for (let east = -sampledRadius; east <= sampledRadius + 1e-6; east += step) {
      if (Math.hypot(north, east) > sampledRadius) continue
      const point = offsetLatLon(site.lat, site.lon, north, east, radius)
      const elevation = sampleElevation(terrain, point.lat, point.lon)
      if (!Number.isFinite(elevation)) continue
      elevations.push(elevation)
      const slope = slopeAt(terrain, point.lat, point.lon)
      if (Number.isFinite(slope.slopeDeg)) slopes.push(slope.slopeDeg)
    }
  }

  if (elevations.length === 0) return null
  const mean = elevations.reduce((sum, value) => sum + value, 0) / elevations.length
  const variance =
    elevations.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / elevations.length
  let min = Infinity
  let max = -Infinity
  for (const value of elevations) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const meanSlope = slopes.length ? slopes.reduce((sum, value) => sum + value, 0) / slopes.length : 0
  let maxSlope = 0
  for (const value of slopes) if (value > maxSlope) maxSlope = value

  return {
    radiusM: requestedRadius,
    sampledRadiusM: sampledRadius,
    sampleCount: elevations.length + slopes.length,
    validCount: elevations.length,
    meanElevationM: mean,
    minElevationM: min,
    maxElevationM: max,
    elevationRangeM: max - min,
    elevationStdM: Math.sqrt(variance),
    meanSlopeDeg: meanSlope,
    maxSlopeDeg: maxSlope,
  }
}

/**
 * Deterministic synthetic lunar south-pole grid used only as an explicit
 * fallback when the real LOLA DEM cannot be loaded.
 *
 * The generated grid uses the same polar-stereographic metric layout as the
 * real products, so every computation and the renderers keep working. It is
 * flagged with `synthetic: true`; the app and the JSON export must label it as
 * approximate. It contains bowl-shaped craters and a broad ridge so horizons,
 * shadows and power estimates are not degenerate.
 *
 * @param {{
 *   width?: number,
 *   height?: number,
 *   boundsM?: number,
 *   referenceRadiusM?: number,
 *   craters?: Array<{lat: number, lon: number, radiusM: number, depthM: number}>,
 *   noiseM?: number,
 * }} [options]
 * @returns {Terrain}
 */
export function createSyntheticTerrain(options = {}) {
  const width = Math.max(8, Math.round(Number(options.width) || 192))
  const height = Math.max(8, Math.round(Number(options.height) || 192))
  const bounds = Number(options.boundsM) > 0 ? Number(options.boundsM) : 75840
  const referenceRadiusM = Number.isFinite(Number(options.referenceRadiusM))
    ? Number(options.referenceRadiusM)
    : DEFAULT_REFERENCE_RADIUS_M
  const noiseM = Number.isFinite(Number(options.noiseM)) ? Number(options.noiseM) : 1

  const craters =
    Array.isArray(options.craters) && options.craters.length > 0
      ? options.craters
      : [
          { lat: -89.9, lon: 0, radiusM: 12000, depthM: 3200 }, // Shackleton-like
          { lat: -88.6, lon: 272, radiusM: 17000, depthM: 1400 }, // de Gerlache-like
          { lat: -89.2, lon: 200, radiusM: 6000, depthM: 700 },
          { lat: -88.9, lon: 44, radiusM: 5000, depthM: 600 },
          { lat: -88.4, lon: 130, radiusM: 8000, depthM: 900 },
        ]

  const pixelSizeM = (2 * bounds) / (width - 1)
  const data = new Float32Array(width * height)
  const craterXY = craters.map((crater) => ({
    ...crater,
    ...lonLatToXY(crater.lat, crater.lon, referenceRadiusM),
  }))

  for (let row = 0; row < height; row += 1) {
    const y = bounds - row * pixelSizeM
    for (let col = 0; col < width; col += 1) {
      const x = -bounds + col * pixelSizeM
      const rho = Math.hypot(x, y)
      // Broad polar relief plus deterministic long-wavelength noise.
      let elevation = 220 * Math.sin(rho / 18000) + 90 * Math.cos(x / 9100) * noiseM
      elevation += 60 * Math.sin(y / 12345 + 1.7) * noiseM

      // Ridge near longitude 130°, roughly radial from the pole.
      const lonDeg = Math.atan2(x, y) * RAD
      const ridgeDelta = Math.abs(normalizeLongitude(lonDeg - 130 + 180) - 180)
      elevation += 1100 * Math.exp(-(ridgeDelta * ridgeDelta) / (2 * 7 * 7))

      for (const crater of craterXY) {
        const distance = Math.hypot(x - crater.x, y - crater.y)
        if (distance >= crater.radiusM) continue
        const t = distance / crater.radiusM
        elevation -= crater.depthM * (1 - t * t)
        const rimDistance = Math.abs(distance - crater.radiusM * 0.92)
        elevation += crater.depthM * 0.3 * Math.exp(-((rimDistance / (crater.radiusM * 0.12)) ** 2))
      }
      data[row * width + col] = elevation
    }
  }

  return {
    id: 'synthetic-south-pole',
    name: 'Synthetic fallback DEM (not real data)',
    role: 'fallback',
    projection: POLAR_STEREOGRAPHIC,
    referenceRadiusM,
    width,
    height,
    pixelSizeM,
    minX: -bounds,
    maxX: bounds,
    minY: -bounds,
    maxY: bounds,
    widthM: 2 * bounds,
    heightM: 2 * bounds,
    data,
    dtype: 'float32',
    elevationRangeM: null,
    source: 'synthetic-fallback',
    attribution: 'Synthetic fallback — no NASA data',
    synthetic: true,
    meta: null,
  }
}

/**
 * Detect probable impact craters as local depressions with raised rims.
 *
 * The detector is deterministic and operates in the projected plane (the
 * projection is conformal, so local directions and distances are preserved):
 *
 * 1. Find local minima over a small window of DEM cells and drop candidates
 *    whose surrounding ring is not at least a fraction of `minDepthM` higher.
 * 2. March in `directions` evenly spaced azimuths from each candidate and record
 *    where the elevation reaches its first local maximum (the rim).
 * 3. `diameterM` is twice the mean rim distance and `depthM` is rim elevation
 *    minus centre elevation.
 * 4. Discard candidates outside `[minDiameterM, maxDiameterM]` or too shallow,
 *    then suppress duplicates within `0.6 ×` the larger crater's diameter.
 *
 * @param {Terrain|null} terrain
 * @param {{
 *   minDiameterM?: number,
 *   maxDiameterM?: number,
 *   minDepthM?: number,
 *   maxCraters?: number,
 *   windowCells?: number,
 *   directions?: number,
 *   prominenceRatio?: number,
 *   maxCandidates?: number,
 * }} [options]
 * @returns {Array<{
 *   lat: number,
 *   lon: number,
 *   diameterM: number,
 *   depthM: number,
 *   rimElevationM: number,
 *   centerElevationM: number,
 *   confidence: number,
 * }>} Detected craters (degrees and meters).
 */
export function findCraters(terrain, options = {}) {
  if (!terrain || !terrain.data || terrain.width < 3 || terrain.height < 3) return []
  const kind = terrainKind(terrain)
  if (kind === 'unknown') return []

  const minDiameterM = Number(options.minDiameterM) > 0 ? Number(options.minDiameterM) : 800
  const maxDiameterM = Number(options.maxDiameterM) > 0 ? Number(options.maxDiameterM) : 60000
  const minDepthM = Number(options.minDepthM) > 0 ? Number(options.minDepthM) : 40
  const maxCraters = Number(options.limit ?? options.maxCraters) > 0
    ? Number(options.limit ?? options.maxCraters)
    : 120
  const windowCells = Math.max(1, Math.round(Number(options.windowCells) || 2))
  const directions = Math.max(4, Math.round(Number(options.directions) || 8))
  const prominenceRatio = Number.isFinite(Number(options.prominenceRatio))
    ? Number(options.prominenceRatio)
    : 0.35
  const maxCandidates = Math.max(1, Math.round(Number(options.maxCandidates) || 1200))
  const radiusM = terrainReferenceRadiusM(terrain)

  const { width, height, data } = terrain
  const cell = (col, row) => {
    if (col < 0 || col >= width || row < 0 || row >= height) return Number.NaN
    return data[row * width + col]
  }
  const geographicAt = (col, row) => {
    if (kind === 'planar') {
      return xyToLonLat(terrain.minX + col * terrain.pixelSizeM, terrain.maxY - row * terrain.pixelSizeM, radiusM)
    }
    const stepLat = (terrain.lat1 - terrain.lat0) / (height - 1)
    const stepLon = (terrain.lon1 - terrain.lon0) / (width - 1)
    return { latDeg: terrain.lat0 + stepLat * row, lonDeg: normalizeLongitude(terrain.lon0 + stepLon * col) }
  }
  const cellMetersAt = (row) => {
    const geo = geographicAt(0, row)
    const size = terrainCellSizeM(terrain, geo.latDeg)
    return Math.max(size.eastM, size.northM, 1)
  }

  const candidates = []
  for (let row = windowCells; row < height - windowCells; row += 1) {
    const stepM = cellMetersAt(row)
    for (let col = windowCells; col < width - windowCells; col += 1) {
      const center = cell(col, row)
      if (!Number.isFinite(center)) continue

      let isMinimum = true
      for (let dy = -windowCells; dy <= windowCells && isMinimum; dy += 1) {
        for (let dx = -windowCells; dx <= windowCells; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const neighbour = cell(col + dx, row + dy)
          if (!Number.isFinite(neighbour)) continue
          if (neighbour < center - 1e-3) {
            isMinimum = false
            break
          }
        }
      }
      if (!isMinimum) continue

      let ringSum = 0
      let ringCount = 0
      for (let direction = 0; direction < 8; direction += 1) {
        const angle = (direction / 8) * 2 * Math.PI
        const neighbour = cell(
          col + Math.round(Math.cos(angle) * (windowCells + 1)),
          row + Math.round(Math.sin(angle) * (windowCells + 1)),
        )
        if (Number.isFinite(neighbour)) {
          ringSum += neighbour
          ringCount += 1
        }
      }
      if (ringCount === 0) continue
      const proxy = ringSum / ringCount - center
      if (proxy < minDepthM * 0.25) continue

      const geo = geographicAt(col, row)
      candidates.push({ col, row, center, proxy, lat: geo.latDeg, lon: geo.lonDeg, stepM })
    }
  }

  candidates.sort((a, b) => b.proxy - a.proxy)
  const shortlist = candidates.slice(0, maxCandidates)
  const maxRadiusM = maxDiameterM / 2

  const craters = []
  for (const candidate of shortlist) {
    const stepM = candidate.stepM
    const maxSteps = Math.min(4000, Math.ceil(maxRadiusM / stepM))
    const rimDistances = []
    const rimElevations = []

    for (let direction = 0; direction < directions; direction += 1) {
      const azimuth = (direction / directions) * 360
      let maxElevation = candidate.center
      let maxDistance = 0
      let found = false

      for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
        const distance = stepIndex * stepM
        const point = destinationPoint(candidate.lat, candidate.lon, azimuth, distance, radiusM)
        const elevation = sampleElevation(terrain, point.lat, point.lon)
        if (!Number.isFinite(elevation)) break
        if (elevation > maxElevation) {
          maxElevation = elevation
          maxDistance = distance
          found = true
        } else if (found && distance > maxDistance * 2.5 && elevation < maxElevation - minDepthM) {
          break
        }
      }
      if (found && maxElevation - candidate.center >= minDepthM * prominenceRatio) {
        rimDistances.push(maxDistance)
        rimElevations.push(maxElevation)
      }
    }

    if (rimDistances.length < Math.ceil(directions / 2)) continue
    const meanRimDistance = rimDistances.reduce((sum, value) => sum + value, 0) / rimDistances.length
    const meanRimElevation = rimElevations.reduce((sum, value) => sum + value, 0) / rimElevations.length
    const diameterM = meanRimDistance * 2
    const depthM = meanRimElevation - candidate.center
    if (depthM < minDepthM) continue
    if (diameterM < minDiameterM || diameterM > maxDiameterM) continue

    const confidence = clamp(
      (rimDistances.length / directions) * clamp(depthM / (minDepthM * 3), 0, 1),
      0,
      1,
    )
    craters.push({
      lat: candidate.lat,
      lon: candidate.lon,
      diameterM,
      depthM,
      rimElevationM: meanRimElevation,
      centerElevationM: candidate.center,
      confidence,
    })
  }

  craters.sort((a, b) => b.depthM * b.diameterM - a.depthM * a.diameterM)

  const kept = []
  for (const crater of craters) {
    if (kept.length >= maxCraters) break
    const overlaps = kept.some(
      (existing) =>
        greatCircleDistanceM(crater.lat, crater.lon, existing.lat, existing.lon, radiusM) <
        0.6 * existing.diameterM,
    )
    if (!overlaps) kept.push(crater)
  }

  return kept
}
