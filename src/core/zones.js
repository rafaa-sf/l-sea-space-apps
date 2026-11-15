/**
 * Landing-zone detection from the LOLA DEM.
 *
 * The mission autopilot must not rank named points of interest: a spacecraft
 * lands on a *flat area*, not on a crater rim or a massif crest. This module
 * derives candidate landing zones directly from the loaded DEM:
 *
 * 1. compute the local slope from central differences (meters per pixel),
 * 2. mask cells that are too steep (`maxSlopeDeg`, default 8°) and optionally too
 *    rough (local max−min elevation inside a small window, `maxRoughnessM`),
 * 3. grow 4-neighbour connected components of the pass mask,
 * 4. filter components by area (`minAreaKm2`, default 1 km²),
 * 5. compute the statistics of each component (centroid, area, mean/max slope,
 *    mean elevation, relief),
 * 6. keep the `maxZones` safest zones, sorted largest-and-flattest first.
 *
 * Large DEMs (the 2048 × 2048 high-resolution region) are downsampled for
 * detection (`maxCells`, default ~1.1 M processed cells → stride 2 for 2048²),
 * which keeps the worker task well below the UI's latency budget. The resulting
 * zone metrics are therefore expressed at the processed resolution
 * (`meta.resolutionM`), and the area/slope values are projected-grid metrics
 * (the polar stereographic scale factor is within 0.8 % across the covered
 * region).
 *
 * All functions are pure, framework-agnostic and accept both real LOLA planar
 * rasters and the reduced latitude/longitude grids used by the UI renderer.
 *
 * @module core/zones
 */

import {
  DEG,
  RAD,
  clamp,
  normalizeLongitude,
} from './geometry.js'
import {
  isPlanarTerrain,
  isLatLonTerrain,
  lonLatToXY,
  xyToLonLat,
  terrainReferenceRadiusM,
} from './terrain.js'

/** Default detection options. */
export const DEFAULT_ZONE_OPTIONS = Object.freeze({
  maxSlopeDeg: 8,
  maxRoughnessM: 12,
  roughnessRadiusCells: 1,
  minAreaKm2: 1,
  maxZones: 12,
  maxCells: 1100000,
  downsample: null,
})

/**
 * Merge partial options with the defaults and clamp them to usable ranges.
 *
 * @param {{
 *   maxSlopeDeg?: number,
 *   maxRoughnessM?: number|null,
 *   roughnessRadiusCells?: number,
 *   minAreaKm2?: number,
 *   maxZones?: number,
 *   maxCells?: number,
 *   downsample?: number|null,
 * }} [options]
 * @returns {typeof DEFAULT_ZONE_OPTIONS}
 */
export function normalizeZoneOptions(options = {}) {
  const merged = { ...DEFAULT_ZONE_OPTIONS, ...(options && typeof options === 'object' ? options : {}) }
  const maxRoughnessM = Number(merged.maxRoughnessM)
  return {
    maxSlopeDeg: clamp(Number(merged.maxSlopeDeg) || DEFAULT_ZONE_OPTIONS.maxSlopeDeg, 0.5, 45),
    maxRoughnessM: Number.isFinite(maxRoughnessM) && maxRoughnessM > 0 ? maxRoughnessM : null,
    roughnessRadiusCells: Math.max(0, Math.round(Number(merged.roughnessRadiusCells) || 1)),
    minAreaKm2: Math.max(0, Number(merged.minAreaKm2) || 0),
    maxZones: Math.max(1, Math.round(Number(merged.maxZones) || DEFAULT_ZONE_OPTIONS.maxZones)),
    maxCells: Math.max(10000, Math.round(Number(merged.maxCells) || DEFAULT_ZONE_OPTIONS.maxCells)),
    downsample:
      Number.isFinite(Number(merged.downsample)) && Number(merged.downsample) >= 1
        ? Math.round(Number(merged.downsample))
        : null,
  }
}

/**
 * Pick the detection stride that keeps the processed grid below `maxCells`.
 *
 * @param {number} width Grid width in samples.
 * @param {number} height Grid height in samples.
 * @param {number} maxCells Maximum processed cells.
 * @returns {number} Positive integer stride.
 */
export function chooseDownsample(width, height, maxCells) {
  const cells = width * height
  if (cells <= maxCells) return 1
  return Math.max(1, Math.ceil(Math.sqrt(cells / maxCells)))
}

/**
 * Safety-first ordering score for a candidate zone (larger is better).
 *
 * Combines area (the main driver: a lander needs room) with mean and maximum
 * slope (flatter is safer), so a huge gentle basin beats a small perfectly flat
 * patch only when its mean slope is still low.
 *
 * @param {{areaKm2: number, meanSlopeDeg: number, maxSlopeDeg: number}} zone
 * @param {number} maxSlopeDeg Slope gate used for detection.
 * @returns {number} Suitability score (arbitrary units, larger = safer).
 */
export function zoneSuitability(zone, maxSlopeDeg) {
  const gate = Math.max(Number(maxSlopeDeg) || 1, 1e-6)
  const meanScore = 1 - clamp(zone.meanSlopeDeg / gate, 0, 1)
  const maxScore = 1 - clamp(zone.maxSlopeDeg / (gate * 1.5), 0, 1)
  return zone.areaKm2 * (0.55 + 0.30 * meanScore + 0.15 * maxScore)
}

/**
 * Detect flat landing zones on a DEM.
 *
 * @param {import('./terrain.js').Terrain|null} terrain Loaded DEM region.
 * @param {Object} [options] See {@link DEFAULT_ZONE_OPTIONS}.
 * @returns {{
 *   zones: Array<{
 *     id: string,
 *     name: string,
 *     lat: number,
 *     lon: number,
 *     xMeters: number,
 *     yMeters: number,
 *     areaKm2: number,
 *     meanSlopeDeg: number,
 *     maxSlopeDeg: number,
 *     elevationM: number,
 *     reliefM: number,
 *     cellCount: number,
 *     suitability: number,
 *   }>,
 *   meta: Object,
 * }} Detected zones (empty when no DEM or no flat area passes the filters).
 */
export function detectLandingZones(terrain, options = {}) {
  const opts = normalizeZoneOptions(options)
  const kind = isPlanarTerrain(terrain) ? 'planar' : isLatLonTerrain(terrain) ? 'latlon' : 'unknown'
  const finish = (zones, extraMeta = {}) => {
    return {
      zones,
      meta: {
        terrainId: terrain?.id ?? null,
        terrainKind: kind,
        synthetic: terrain?.synthetic === true,
        zoneCount: zones.length,
        options: { ...opts },
        approximation:
          'Zones are detected on the loaded DEM at the reported processed resolution; ' +
          'area/slope are projected-grid metrics and the zone centroid is a cell-weighted centroid.',
        ...extraMeta,
      },
    }
  }

  if (!terrain || !terrain.data || kind === 'unknown') {
    return finish([], { processedCells: 0, candidateZones: 0, resolutionM: null, error: 'missing-terrain' })
  }

  const width = Math.round(Number(terrain.width))
  const height = Math.round(Number(terrain.height))
  if (!(width > 2) || !(height > 2)) {
    return finish([], { processedCells: 0, candidateZones: 0, resolutionM: null, error: 'terrain-too-small' })
  }

  const stride = opts.downsample ?? chooseDownsample(width, height, opts.maxCells)
  const cols = Math.ceil(width / stride)
  const rows = Math.ceil(height / stride)
  const data = terrain.data
  const referenceRadiusM = terrainReferenceRadiusM(terrain)

  // Per-row projected cell sizes (constant for planar grids, latitude-dependent
  // for reduced latitude/longitude grids).
  const cellWidthM = new Float64Array(rows)
  const cellHeightM = new Float64Array(rows)
  const cellAreaM2 = new Float64Array(rows)
  const rowLatDeg = new Float64Array(rows)
  let resolutionM

  if (kind === 'planar') {
    const pixel = Math.max(Number(terrain.pixelSizeM) || 0, 1e-6) * stride
    for (let row = 0; row < rows; row += 1) {
      cellWidthM[row] = pixel
      cellHeightM[row] = pixel
      cellAreaM2[row] = pixel * pixel
    }
    resolutionM = pixel
  } else {
    const stepLat = (terrain.lat1 - terrain.lat0) / (height - 1)
    const stepLon = (terrain.lon1 - terrain.lon0) / (width - 1)
    const eastStep = Math.abs(stepLon) * stride * DEG * referenceRadiusM
    const northStep = Math.abs(stepLat) * stride * DEG * referenceRadiusM
    for (let row = 0; row < rows; row += 1) {
      const lat = terrain.lat0 + stepLat * row * stride
      rowLatDeg[row] = lat
      cellWidthM[row] = eastStep * Math.max(Math.cos(lat * DEG), 1e-6)
      cellHeightM[row] = northStep
      cellAreaM2[row] = cellWidthM[row] * cellHeightM[row]
    }
    resolutionM = Math.sqrt(cellWidthM[Math.floor(rows / 2)] * cellHeightM[Math.floor(rows / 2)])
  }

  // Subsample elevations into the processed grid.
  const elevations = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = Math.min(height - 1, row * stride) * width
    for (let col = 0; col < cols; col += 1) {
      elevations[row * cols + col] = data[sourceRow + Math.min(width - 1, col * stride)]
    }
  }

  const passMask = new Uint8Array(cols * rows)
  const slopeDeg = new Float32Array(cols * rows)
  const maxSlopeDeg = opts.maxSlopeDeg
  const radius = opts.roughnessRadiusCells
  const checkRoughness = Number.isFinite(opts.maxRoughnessM) && opts.maxRoughnessM > 0

  for (let row = 1; row < rows - 1; row += 1) {
    const dx2 = 2 * cellWidthM[row]
    const dy2 = 2 * cellHeightM[row]
    for (let col = 1; col < cols - 1; col += 1) {
      const index = row * cols + col
      const center = elevations[index]
      if (!Number.isFinite(center)) continue

      const eastWest = (elevations[index + 1] - elevations[index - 1]) / dx2
      const northSouth = (elevations[index + cols] - elevations[index - cols]) / dy2
      const slope = Math.atan(Math.hypot(eastWest, northSouth)) * RAD
      slopeDeg[index] = slope
      if (slope > maxSlopeDeg) continue

      if (checkRoughness) {
        let min = center
        let max = center
        for (let dy = -radius; dy <= radius; dy += 1) {
          const r = row + dy
          if (r < 0 || r >= rows) continue
          for (let dx = -radius; dx <= radius; dx += 1) {
            const c = col + dx
            if (c < 0 || c >= cols) continue
            const value = elevations[r * cols + c]
            if (!Number.isFinite(value)) continue
            if (value < min) min = value
            if (value > max) max = value
          }
        }
        if (max - min > opts.maxRoughnessM) continue
      }

      passMask[index] = 1
    }
  }

  // 4-neighbour connected components.
  const labels = new Int32Array(cols * rows).fill(-1)
  const stack = new Int32Array(cols * rows)
  const candidates = []
  let nextLabel = 0

  for (let start = 0; start < passMask.length; start += 1) {
    if (!passMask[start] || labels[start] !== -1) continue
    const label = nextLabel
    nextLabel += 1
    let stackSize = 0
    stack[stackSize++] = start
    labels[start] = label

    let count = 0
    let sumElevation = 0
    let minElevation = Infinity
    let maxElevation = -Infinity
    let sumSlope = 0
    let maxSlopeValue = 0
    let sumRow = 0
    let sumCol = 0
    let sumArea = 0

    while (stackSize > 0) {
      const index = stack[--stackSize]
      const row = (index / cols) | 0
      const col = index - row * cols
      const elevation = elevations[index]

      count += 1
      sumElevation += elevation
      if (elevation < minElevation) minElevation = elevation
      if (elevation > maxElevation) maxElevation = elevation
      const slope = slopeDeg[index]
      if (Number.isFinite(slope) && slope > 0) {
        sumSlope += slope
        if (slope > maxSlopeValue) maxSlopeValue = slope
      }
      sumRow += row
      sumCol += col
      sumArea += cellAreaM2[row]

      // 4 neighbours
      if (col > 0 && passMask[index - 1] && labels[index - 1] === -1) {
        labels[index - 1] = label
        stack[stackSize++] = index - 1
      }
      if (col < cols - 1 && passMask[index + 1] && labels[index + 1] === -1) {
        labels[index + 1] = label
        stack[stackSize++] = index + 1
      }
      if (row > 0 && passMask[index - cols] && labels[index - cols] === -1) {
        labels[index - cols] = label
        stack[stackSize++] = index - cols
      }
      if (row < rows - 1 && passMask[index + cols] && labels[index + cols] === -1) {
        labels[index + cols] = label
        stack[stackSize++] = index + cols
      }
    }

    const areaKm2 = sumArea / 1e6
    if (areaKm2 + 1e-9 < opts.minAreaKm2) continue

    const meanRow = sumRow / count
    const meanCol = sumCol / count
    const meanSlopeDeg = count > 0 ? sumSlope / count : 0
    const countWithSlope = count > 0 ? count : 1

    let lat
    let lon
    let xMeters
    let yMeters
    if (kind === 'planar') {
      const pixel = Math.max(Number(terrain.pixelSizeM) || 0, 1e-6)
      xMeters = round1(Number(terrain.minX) + (meanCol * stride + 0.5) * pixel)
      yMeters = round1(Number(terrain.maxY) - (meanRow * stride + 0.5) * pixel)
      const geographic = xyToLonLat(xMeters, yMeters, referenceRadiusM)
      lat = geographic.latDeg
      lon = normalizeLongitude(geographic.lonDeg)
    } else {
      const stepLat = (terrain.lat1 - terrain.lat0) / (height - 1)
      const stepLon = (terrain.lon1 - terrain.lon0) / (width - 1)
      lat = terrain.lat0 + stepLat * meanRow * stride
      lon = normalizeLongitude(terrain.lon0 + stepLon * meanCol * stride)
      const projected = lonLatToXY(lat, lon, referenceRadiusM)
      xMeters = round1(projected.x)
      yMeters = round1(projected.y)
    }

    candidates.push({
      id: '',
      name: '',
      lat,
      lon,
      xMeters,
      yMeters,
      areaKm2,
      meanSlopeDeg,
      maxSlopeDeg: maxSlopeValue,
      elevationM: sumElevation / countWithSlope,
      reliefM: maxElevation - minElevation,
      cellCount: count,
      suitability: 0,
      // internal diagnostics (removed from the returned objects below)
      _meanRow: meanRow,
      _meanCol: meanCol,
    })
  }

  for (const candidate of candidates) {
    candidate.suitability = zoneSuitability(candidate, maxSlopeDeg)
  }
  candidates.sort((a, b) => {
    if (b.suitability !== a.suitability) return b.suitability - a.suitability
    if (a.meanSlopeDeg !== b.meanSlopeDeg) return a.meanSlopeDeg - b.meanSlopeDeg
    return b.areaKm2 - a.areaKm2
  })

  const zones = candidates.slice(0, opts.maxZones).map((candidate, index) => {
    const ordinal = String(index + 1).padStart(2, '0')
    return {
      id: `zone-${ordinal}`,
      name: `Landing zone ${ordinal}`,
      lat: candidate.lat,
      lon: candidate.lon,
      xMeters: candidate.xMeters,
      yMeters: candidate.yMeters,
      areaKm2: candidate.areaKm2,
      meanSlopeDeg: candidate.meanSlopeDeg,
      maxSlopeDeg: candidate.maxSlopeDeg,
      elevationM: candidate.elevationM,
      reliefM: candidate.reliefM,
      cellCount: candidate.cellCount,
      suitability: candidate.suitability,
    }
  })

  return finish(zones, {
    width,
    height,
    stride,
    cols,
    rows,
    processedCells: cols * rows,
    candidateZones: candidates.length,
    resolutionM,
    minAreaKm2: opts.minAreaKm2,
    maxSlopeDeg: opts.maxSlopeDeg,
    maxRoughnessM: opts.maxRoughnessM,
  })
}

/**
 * Round to one decimal place.
 *
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(Number(value) * 10) / 10
}
