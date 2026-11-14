/**
 * Shared geometry helpers for the 3D scene and the 2D fallback map.
 *
 * The lunar south pole is rendered as a polar cap: the horizontal plane is
 * parameterised by colatitude (distance from the pole) and longitude. Elevation
 * is exaggerated vertically so multi-kilometre relief is readable at the scale
 * of a 150 km cap.
 */

export const MOON_RADIUS_M = 1737400

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
  const exaggeration = options.exaggeration ?? 6
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

/** Lunar surface palette: dark maria to bright highland, slightly warm. */
export function terrainColor(elevation, min, max) {
  const span = Math.max(1, max - min)
  let t = (elevation - min) / span
  t = Math.min(1, Math.max(0, t))
  // Two-stop ramp with a cool shadow tint in the deep basins.
  const low = [0.13, 0.14, 0.17]
  const mid = [0.42, 0.41, 0.4]
  const high = [0.82, 0.79, 0.72]
  const a = t < 0.55 ? low : mid
  const b = t < 0.55 ? mid : high
  const local = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ]
}

/** Stable pseudo-random number generator (for star fields and noise). */
export function createRandom(seed = 1234567) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}
