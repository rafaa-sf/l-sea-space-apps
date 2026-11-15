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
 * Optionally (`avoidCraters`, `craterClearanceM`), cells inside craters detected
 * on the same DEM (`findCraters`) are removed from the pass mask before the
 * components are grown, so the caller can request flat zones outside craters.
 * The option defaults to off and leaves the crater-free pipeline unchanged.
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
  findCraters,
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
  avoidCraters: false,
  craterClearanceM: 0,
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
 *   avoidCraters?: boolean,
 *   craterClearanceM?: number,
 * }} [options]
 * @returns {typeof DEFAULT_ZONE_OPTIONS}
 */
export function normalizeZoneOptions(options = {}) {
  const merged = { ...DEFAULT_ZONE_OPTIONS, ...(options && typeof options === 'object' ? options : {}) }
  const maxRoughnessM = Number(merged.maxRoughnessM)
  const craterClearanceM = Number(merged.craterClearanceM)
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
    avoidCraters: merged.avoidCraters === true,
    craterClearanceM: Number.isFinite(craterClearanceM) && craterClearanceM >= 0 ? craterClearanceM : 0,
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
 * @param {Object} [options] See {@link DEFAULT_ZONE_OPTIONS}; `avoidCraters` and
 *   `craterClearanceM` enable the optional crater exclusion, and
 *   `craterMinDiameterM` (default 500 m) is forwarded to `findCraters`.
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
 * When `avoidCraters` is enabled, `meta.cratersConsidered` counts the detected
 * craters that fall on the terrain and `meta.craterCellsExcluded` counts the
 * pass cells removed from the mask. The option defaults off.
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

  // Optional crater exclusion: drop pass cells that fall inside craters
  // detected on the same DEM, so the caller can request flat zones outside
  // craters. Cells are tested at their centre, in the same projected-grid
  // geometry used for the zone centroids, and only inside each crater's
  // bounding box (the distance check is a strict `< radius` test with
  // `radius = diameterM / 2 + craterClearanceM`).
  let cratersConsidered = 0
  let craterCellsExcluded = 0
  if (opts.avoidCraters) {
    const requestedMinDiameterM = Number(options.craterMinDiameterM)
    const minCraterDiameterM =
      Number.isFinite(requestedMinDiameterM) && requestedMinDiameterM > 0 ? requestedMinDiameterM : 500
    const craters = findCraters(terrain, { minDiameterM: minCraterDiameterM })
    const clearanceM = opts.craterClearanceM
    const basePixelM = Math.max(Number(terrain.pixelSizeM) || 0, 1e-6)
    const lat0 = Number(terrain.lat0)
    const lon0 = Number(terrain.lon0)
    const stepLat = kind === 'latlon' ? (terrain.lat1 - terrain.lat0) / (height - 1) : 0
    const stepLon = kind === 'latlon' ? (terrain.lon1 - terrain.lon0) / (width - 1) : 0

    for (const crater of craters) {
      const lat = Number(crater?.lat)
      const lon = Number(crater?.lon)
      const diameterM = Number(crater?.diameterM)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const radiusM = diameterM / 2 + clearanceM
      if (!(Number.isFinite(radiusM) && radiusM > 0)) continue

      let centreX
      let centreY
      let rowMin
      let rowMax
      let colMin
      let colMax
      if (kind === 'planar') {
        const projected = lonLatToXY(lat, lon, referenceRadiusM)
        centreX = projected.x
        centreY = projected.y
        if (
          centreX < Number(terrain.minX) ||
          centreX > Number(terrain.maxX) ||
          centreY < Number(terrain.minY) ||
          centreY > Number(terrain.maxY)
        ) {
          continue
        }
        colMin = Math.ceil(((centreX - radiusM - Number(terrain.minX)) / basePixelM - 0.5) / stride)
        colMax = Math.floor(((centreX + radiusM - Number(terrain.minX)) / basePixelM - 0.5) / stride)
        rowMin = Math.ceil(((Number(terrain.maxY) - (centreY + radiusM)) / basePixelM - 0.5) / stride)
        rowMax = Math.floor(((Number(terrain.maxY) - (centreY - radiusM)) / basePixelM - 0.5) / stride)
      } else {
        const rowAt = (lat - lat0) / stepLat
        let deltaLon = normalizeLongitude(lon - lon0)
        if (stepLon < 0 && deltaLon > 0) deltaLon -= 360
        const colAt = deltaLon / stepLon
        if (rowAt < 0 || rowAt > height - 1 || colAt < 0 || colAt > width - 1) continue
        const latSpanDeg = radiusM / (DEG * referenceRadiusM)
        const lonSpanDeg = latSpanDeg / Math.max(Math.cos(lat * DEG), 1e-6)
        const halfCols = Math.abs(lonSpanDeg / (stepLon * stride))
        const halfRows = Math.abs(latSpanDeg / (stepLat * stride))
        rowMin = Math.ceil(rowAt / stride - halfRows)
        rowMax = Math.floor(rowAt / stride + halfRows)
        colMin = Math.ceil(colAt / stride - halfCols)
        colMax = Math.floor(colAt / stride + halfCols)
      }

      colMin = Math.max(1, colMin)
      colMax = Math.min(cols - 2, colMax)
      rowMin = Math.max(1, rowMin)
      rowMax = Math.min(rows - 2, rowMax)
      if (colMax < colMin || rowMax < rowMin) continue
      cratersConsidered += 1

      if (kind === 'planar') {
        for (let row = rowMin; row <= rowMax; row += 1) {
          const dy = Number(terrain.maxY) - (row * stride + 0.5) * basePixelM - centreY
          for (let col = colMin; col <= colMax; col += 1) {
            const index = row * cols + col
            if (!passMask[index]) continue
            const dx = Number(terrain.minX) + (col * stride + 0.5) * basePixelM - centreX
            if (Math.hypot(dx, dy) < radiusM) {
              passMask[index] = 0
              craterCellsExcluded += 1
            }
          }
        }
      } else {
        for (let row = rowMin; row <= rowMax; row += 1) {
          const cellLat = lat0 + stepLat * row * stride
          const dy = (cellLat - lat) * DEG * referenceRadiusM
          for (let col = colMin; col <= colMax; col += 1) {
            const index = row * cols + col
            if (!passMask[index]) continue
            const cellLon = normalizeLongitude(lon0 + stepLon * col * stride)
            const dx =
              normalizeLongitude(cellLon - lon) * DEG * referenceRadiusM * Math.max(Math.cos(cellLat * DEG), 1e-6)
            if (Math.hypot(dx, dy) < radiusM) {
              passMask[index] = 0
              craterCellsExcluded += 1
            }
          }
        }
      }
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
    ...(opts.avoidCraters ? { cratersConsidered, craterCellsExcluded } : {}),
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
