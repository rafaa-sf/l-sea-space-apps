/**
 * Shared geometry helpers for the 3D scene and the 2D fallback map.
 *
 * The lunar south pole is rendered as a polar cap with a muted, professional
 * cartographic style: a hypsometric elevation tint multiplied by a Sun-driven
 * hillshade computed from the DEM gradients. Lighting therefore follows the
 * selected mission date/time (Sun azimuth/elevation) and animates with it.
 */

export const MOON_RADIUS_M = 1737400

/* -------------------------------------------------------------------------- */
/* Hypsometric palette                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Muted six-stop hypsometric ramp (deep basins -> highlands).
 *
 * Values are normalised elevation positions in [0, 1] mapped over the terrain's
 * minimum..maximum elevation, with sRGB colours. The ramp is deliberately
 * desaturated: dark slate-blue basins, neutral mid tones, light warm-grey
 * highlands. No neon or saturated hues.
 */
export const HYPSOMETRIC_STOPS = Object.freeze([
  { t: 0.0, color: [0.14, 0.17, 0.21] }, // deep basin: dark slate blue
  { t: 0.2, color: [0.23, 0.27, 0.31] }, // basin floor: blue-grey
  { t: 0.42, color: [0.38, 0.4, 0.42] }, // low plains: neutral grey
  { t: 0.64, color: [0.51, 0.51, 0.49] }, // plateau: warm neutral grey
  { t: 0.82, color: [0.64, 0.62, 0.57] }, // highlands: light warm grey
  { t: 1.0, color: [0.78, 0.75, 0.69] }, // peaks: pale warm grey
])

/** Normalised elevation position in [0, 1] for a value inside min..max. */
export function elevationFraction(elevation, min, max) {
  const span = Math.max(1e-6, max - min)
  return Math.min(1, Math.max(0, (Number(elevation) - min) / span))
}

/** Interpolate the hypsometric ramp; returns sRGB `[r, g, b]` in 0..1. */
export function terrainColor(elevation, min, max) {
  const t = elevationFraction(elevation, min, max)
  const stops = HYPSOMETRIC_STOPS
  if (t <= stops[0].t) return [...stops[0].color]
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1]
    const next = stops[index]
    if (t <= next.t) {
      const span = Math.max(1e-6, next.t - previous.t)
      const local = (t - previous.t) / span
      return [
        previous.color[0] + (next.color[0] - previous.color[0]) * local,
        previous.color[1] + (next.color[1] - previous.color[1]) * local,
        previous.color[2] + (next.color[2] - previous.color[2]) * local,
      ]
    }
  }
  return [...stops[stops.length - 1].color]
}

/** CSS gradient stops for the elevation legend overlay (bottom = min). */
export function hypsometricCssGradient() {
  const stops = HYPSOMETRIC_STOPS.map((stop) => {
    const [r, g, b] = stop.color.map((value) => Math.round(value * 255))
    return `rgb(${r}, ${g}, ${b}) ${(stop.t * 100).toFixed(1)}%`
  })
  return `linear-gradient(to top, ${stops.join(', ')})`
}

/** Convert an sRGB component (0..1) to the linear space used by Three.js. */
export function sRGBToLinear(value) {
  const c = Math.min(1, Math.max(0, Number(value) || 0))
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/* -------------------------------------------------------------------------- */
/* Smoothing and shading                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Separable box blur for a terrain grid (radius 1-2, `passes` repeats).
 * Used to remove the high-frequency speckle of the raw DEM before colour and
 * hillshade computations. Edges are clamped.
 */
export function boxBlurGrid(data, width, height, radius = 1, passes = 2) {
  const r = Math.max(1, Math.round(radius))
  const passCount = Math.max(1, Math.round(passes))
  let source = Float32Array.from(data)
  let target = new Float32Array(source.length)
  const diameter = r * 2 + 1
  for (let pass = 0; pass < passCount; pass += 1) {
    // Horizontal
    for (let row = 0; row < height; row += 1) {
      const base = row * width
      for (let col = 0; col < width; col += 1) {
        let sum = 0
        for (let offset = -r; offset <= r; offset += 1) {
          const sample = Math.min(width - 1, Math.max(0, col + offset))
          sum += source[base + sample]
        }
        target[base + col] = sum / diameter
      }
    }
    // Vertical (source and target swap)
    const swapped = source
    source = target
    target = swapped
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        let sum = 0
        for (let offset = -r; offset <= r; offset += 1) {
          const sample = Math.min(height - 1, Math.max(0, row + offset))
          sum += source[sample * width + col]
        }
        target[row * width + col] = sum / diameter
      }
    }
    const swappedBack = source
    source = target
    target = swappedBack
  }
  return source
}

/** Unit Sun direction vector in scene space for a topocentric az/el pair. */
export function sunDirectionVector(azimuthDeg, elevationDeg) {
  const az = (Number(azimuthDeg) * Math.PI) / 180
  const el = (Number(elevationDeg) * Math.PI) / 180
  const cosEl = Math.cos(el)
  return {
    x: Math.sin(az) * cosEl,
    y: Math.sin(el),
    z: Math.cos(az) * cosEl,
  }
}

/**
 * Scene-space offset of a ray cast at a topocentric az/el, in the same frame
 * used by {@link sunDirectionVector} and the polar projection: **+Z is north,
 * +X is east, +Y is up**. The horizontal direction therefore matches the
 * Sun/Earth arrows exactly (issue: the 3D line previously used the opposite
 * north sign while the arrows used +Z).
 *
 * @param {{azimuthDeg?: number, elevationDeg?: number, distanceM?: number,
 *   unitsPerMeter: number, elevationScale: number, radiusM?: number}} options
 * @returns {{x: number, y: number, z: number}} Scene-space offset in scene units.
 */
export function azElRayOffset({
  azimuthDeg = 0,
  elevationDeg = 0,
  distanceM = 240000,
  unitsPerMeter = 1,
  elevationScale = 1,
  radiusM = MOON_RADIUS_M,
} = {}) {
  const az = (Number(azimuthDeg) * Math.PI) / 180
  const el = (Number(elevationDeg) * Math.PI) / 180
  const horizontalM = distanceM * Math.cos(el)
  const verticalM = distanceM * Math.sin(el) - (distanceM * distanceM) / (2 * radiusM)
  return {
    x: Math.sin(az) * horizontalM * unitsPerMeter,
    y: verticalM * elevationScale,
    z: Math.cos(az) * horizontalM * unitsPerMeter,
  }
}

/**
 * Cartographic hillshade multiplier for a surface normal.
 *
 * Standard slope illumination: `N . L` where `L` is the Sun vector. The result
 * is `ambient + diffuse * max(0, N . L)`, clamped to a sane display range:
 *   - ambient floor 0.32 keeps shaded slopes readable;
 *   - diffuse 1.25 gives a full range up to ~1.4 for sun-facing slopes;
 *   - when the Sun is below the local horizon the surface is flat/dim
 *     (`flatShade`, no directional term), as there is no direct sunlight.
 *
 * @param {{x: number, y: number, z: number}} normal Surface normal (unit).
 * @param {{x: number, y: number, z: number}} sun Sun direction (unit).
 * @param {boolean} visible Whether the Sun is above the local terrain horizon.
 * @param {{ambient?: number, diffuse?: number, flatShade?: number}} [options]
 * @returns {number} Per-channel shade multiplier.
 */
export function hillshadeShade(normal, sun, visible, options = {}) {
  if (!visible) return options.flatShade ?? 0.4
  const ambient = options.ambient ?? 0.3
  const diffuse = options.diffuse ?? 1.35
  const dot = normal.x * sun.x + normal.y * sun.y + normal.z * sun.z
  return Math.min(1.45, Math.max(0.2, ambient + diffuse * Math.max(0, dot)))
}

/** Grid extents of a terrain object in degrees and meters. */
export function terrainExtent(terrain) {
  if (!terrain) return null
  const maxColat = Math.max(90 + terrain.lat0, 90 + terrain.lat1)
  const minColat = Math.min(90 + terrain.lat0, 90 + terrain.lat1)
  return {
    maxColat: Math.max(0.5, maxColat),
    minColat: Math.max(0, minColat),
    spanMeters: (Math.max(0.5, maxColat) * Math.PI * MOON_RADIUS_M) / 180,
    lonSpan: Math.abs(terrain.lon1 - terrain.lon0),
  }
}

/**
 * Create a polar-cap projection for a terrain object.
 * Uses the same polar-stereographic mapping as the LOLA acquisition scripts:
 * `rho = 2R tan(pi/4 + lat/2)`, `x = rho sin(lon)`, `z = rho cos(lon)`.
 * Returns `{ project, unproject, radius, unitsPerMeter, elevationScale }`.
 */
export function createPolarProjection(terrain, options = {}) {
  const extent = terrainExtent(terrain)
  const radius = options.radius ?? 10
  const exaggeration = options.exaggeration ?? 3.5
  const maxColatRad = ((extent?.maxColat ?? 5.5) * Math.PI) / 180
  const rhoMaxM = 2 * MOON_RADIUS_M * Math.tan(maxColatRad / 2)
  const unitsPerMeter = radius / Math.max(1, rhoMaxM)
  const elevationScale = unitsPerMeter * exaggeration

  function project(lat, lon, elevationM = 0) {
    const latRad = (Number(lat) * Math.PI) / 180
    const rhoM = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + latRad / 2)
    const r = Math.min(radius, (rhoM / Math.max(1, rhoMaxM)) * radius)
    const lonRad = (Number(lon) * Math.PI) / 180
    return {
      x: r * Math.sin(lonRad),
      y: Number(elevationM) * elevationScale,
      z: r * Math.cos(lonRad),
    }
  }

  function unproject(x, z) {
    const r = Math.hypot(x, z)
    const rhoM = (Math.min(r, radius) / radius) * rhoMaxM
    const latRad = 2 * Math.atan(rhoM / (2 * MOON_RADIUS_M)) - Math.PI / 2
    const lon = (Math.atan2(x, z) * 180) / Math.PI
    return {
      lat: (latRad * 180) / Math.PI,
      lon: ((lon % 360) + 360) % 360,
    }
  }

  return {
    project,
    unproject,
    radius,
    maxColat: extent?.maxColat ?? 5.5,
    unitsPerMeter,
    elevationScale,
    exaggeration,
  }
}


/* -------------------------------------------------------------------------- */
/* Rectangular planar terrain (LOLA DEM extents, no polar-cap mask)           */
/* -------------------------------------------------------------------------- */

/** Topocentric lat/lon -> planar polar-stereographic metres (same as LOLA). */
export function lonLatToPlanarMeters(latDeg, lonDeg, radiusM = MOON_RADIUS_M) {
  const latRad = (Number(latDeg) * Math.PI) / 180
  const lonRad = (Number(lonDeg) * Math.PI) / 180
  const rho = 2 * radiusM * Math.tan(Math.PI / 4 + latRad / 2)
  return { x: rho * Math.sin(lonRad), y: rho * Math.cos(lonRad) }
}

/** Inverse of {@link lonLatToPlanarMeters}. */
export function planarToLonLat(xMeters, yMeters, radiusM = MOON_RADIUS_M) {
  const rho = Math.hypot(Number(xMeters), Number(yMeters))
  const latRad = 2 * Math.atan(rho / (2 * radiusM)) - Math.PI / 2
  return {
    lat: (latRad * 180) / Math.PI,
    lon: ((Math.atan2(xMeters, yMeters) * 180) / Math.PI + 360) % 360,
  }
}

function sampleLatLonGrid(terrain, latDeg, lonDeg) {
  const { width, height, lat0, lon0, lat1, lon1, data } = terrain
  const latSpan = lat1 - lat0
  const lonSpan = lon1 - lon0
  const wrap = lonSpan >= 359.5
  let lonNorm = ((Number(lonDeg) - lon0) % 360 + 360) % 360
  if (!wrap && lonNorm > lonSpan) lonNorm = lonSpan
  const fx = Math.min(width - 1, Math.max(0, (lonNorm / Math.max(1e-9, lonSpan)) * (width - 1)))
  const fy = Math.min(height - 1, Math.max(0, ((Number(latDeg) - lat0) / Math.max(1e-9, latSpan)) * (height - 1)))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0
  const top = data[y0 * width + x0] + (data[y0 * width + x1] - data[y0 * width + x0]) * tx
  const bottom = data[y1 * width + x0] + (data[y1 * width + x1] - data[y1 * width + x0]) * tx
  return top + (bottom - top) * ty
}

function samplePlanarGrid(terrain, xMeters, yMeters) {
  const { width, height, pixelSizeM, minX, maxY, data } = terrain
  const fx = Math.min(width - 1, Math.max(0, (Number(xMeters) - minX) / pixelSizeM))
  const fy = Math.min(height - 1, Math.max(0, (maxY - Number(yMeters)) / pixelSizeM))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0
  const top = data[y0 * width + x0] + (data[y0 * width + x1] - data[y0 * width + x0]) * tx
  const bottom = data[y1 * width + x0] + (data[y1 * width + x1] - data[y1 * width + x0]) * tx
  return top + (bottom - top) * ty
}

/**
 * Build a uniform rectangular elevation grid for rendering, from either the
 * planar LOLA DEM (real data) or the legacy lat/lon fallback grid. The full
 * rectangular extent is preserved (no polar-cap mask), so 3D and 2D share the
 * same horizontal scale.
 *
 * @param {Object} terrain Planar LOLA terrain or lat/lon fallback grid.
 * @param {{maxSamples?: number}} [options]
 * @returns {{bounds: {minX:number,maxX:number,minY:number,maxY:number}, widthM:number, heightM:number, cols:number, rows:number, data:Float32Array, cellWidthM:number, cellHeightM:number, pixelSizeM:number, datum:number}}
 */
export function createPlanarTerrain(terrain, options = {}) {
  if (!terrain || !terrain.data) return null
  const maxSamples = Math.max(1024, options.maxSamples ?? 65536)
  const isPlanar =
    Number.isFinite(Number(terrain.minX)) &&
    Number.isFinite(Number(terrain.maxY)) &&
    Number.isFinite(Number(terrain.pixelSizeM))
  let bounds
  let datum = Number(terrain.datum ?? terrain.referenceRadiusM ?? MOON_RADIUS_M)
  let sampler

  if (isPlanar) {
    bounds = {
      minX: Number(terrain.minX),
      maxX: Number(terrain.maxX),
      minY: Number(terrain.minY),
      maxY: Number(terrain.maxY),
    }
    sampler = (x, y) => samplePlanarGrid(terrain, x, y)
  } else {
    const maxColat = Math.max(90 + Number(terrain.lat0), 90 + Number(terrain.lat1))
    const rhoMax = 2 * datum * Math.tan(((maxColat * Math.PI) / 180) / 2)
    bounds = { minX: -rhoMax, maxX: rhoMax, minY: -rhoMax, maxY: rhoMax }
    sampler = (x, y) => {
      const geo = planarToLonLat(x, y, datum)
      return sampleLatLonGrid(terrain, geo.lat, geo.lon)
    }
  }

  const widthM = bounds.maxX - bounds.minX
  const heightM = bounds.maxY - bounds.minY
  if (!(widthM > 0) || !(heightM > 0)) return null
  const ratio = widthM / heightM
  let cols = Math.round(Math.sqrt(maxSamples * ratio))
  let rows = Math.round(maxSamples / Math.max(1, cols))
  cols = Math.max(8, Math.min(600, cols))
  rows = Math.max(8, Math.min(600, rows))

  const data = new Float32Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    const y = bounds.maxY - (heightM * row) / (rows - 1)
    for (let col = 0; col < cols; col += 1) {
      const x = bounds.minX + (widthM * col) / (cols - 1)
      data[row * cols + col] = sampler(x, y)
    }
  }

  return {
    bounds,
    widthM,
    heightM,
    cols,
    rows,
    data,
    cellWidthM: widthM / Math.max(1, cols - 1),
    cellHeightM: heightM / Math.max(1, rows - 1),
    pixelSizeM: widthM / Math.max(1, cols - 1),
    datum,
  }
}
