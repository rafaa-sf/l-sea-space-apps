/**
 * Spherical geometry helpers for the Moon.
 *
 * L-SEA works with a spherical lunar model: the Moon is approximated by a
 * sphere of radius {@link MOON_RADIUS_M}. Every helper in this module is pure
 * (no DOM, no framework imports) and uses the units:
 *
 * - distances and radii: **meters**
 * - angles and geographic coordinates: **degrees**
 * - latitude is negative on the southern hemisphere, longitude is degrees east
 *   in `0..360` by convention (helpers also accept other values and normalize).
 *
 * The lunar south pole is close enough to the sphere's axis that a naive
 * "flat plane" model over hundreds of kilometres would be wrong: the surface
 * curvature drop at `d = 300 km` is `d² / (2R) ≈ 25.9 km`, which completely
 * changes which horizon blocks a low Sun. All elevation-angle helpers here
 * therefore use the exact spherical relation instead of a tangent plane.
 *
 * @module core/geometry
 */

/** Reference radius of the Moon in meters (IAU mean radius). */
export const MOON_RADIUS_M = 1737400

/** Degrees to radians multiplier. */
export const DEG = Math.PI / 180

/** Radians to degrees multiplier. */
export const RAD = 180 / Math.PI

/**
 * Clamp a number into an inclusive range.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Normalize a longitude to the `[0, 360)` range used by the domain model.
 *
 * @param {number} lon Longitude in degrees (any range).
 * @returns {number} Longitude in `[0, 360)`.
 */
export function normalizeLongitude(lon) {
  if (!Number.isFinite(lon)) return Number.NaN
  const wrapped = lon % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/**
 * Wrap a longitude difference to `[-180, 180)`.
 *
 * Used to interpolate azimuths and longitudes across the 0/360 seam.
 *
 * @param {number} delta Difference in degrees.
 * @returns {number} Wrapped difference in `[-180, 180)`.
 */
export function wrapLongitudeDelta(delta) {
  if (!Number.isFinite(delta)) return Number.NaN
  return ((delta + 180) % 360 + 360) % 360 - 180
}

/**
 * Destination point on a sphere given an initial point, bearing and distance.
 *
 * Uses the standard great-circle destination formula. Azimuth/bearing is
 * measured clockwise from local north (`0` = north, `90` = east).
 *
 * @param {number} latDeg Starting latitude in degrees.
 * @param {number} lonDeg Starting longitude in degrees.
 * @param {number} bearingDeg Bearing in degrees clockwise from north.
 * @param {number} distanceM Distance along the surface in meters.
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {{lat: number, lon: number}} Destination coordinates in degrees
 *   (longitude normalized to `[0, 360)`).
 */
export function destinationPoint(latDeg, lonDeg, bearingDeg, distanceM, radiusM = MOON_RADIUS_M) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return { lat: Number.NaN, lon: Number.NaN }
  }
  const angular = distanceM / radiusM
  const lat1 = latDeg * DEG
  const lon1 = lonDeg * DEG
  const bearing = bearingDeg * DEG

  const sinLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)
  const sinAngular = Math.sin(angular)
  const cosAngular = Math.cos(angular)

  const sinLat2 = sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing)
  const lat2 = Math.asin(clamp(sinLat2, -1, 1))
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinAngular * cosLat1,
      cosAngular - sinLat1 * Math.sin(lat2),
    )

  return {
    lat: lat2 * RAD,
    lon: normalizeLongitude(lon2 * RAD),
  }
}

/**
 * Great-circle (surface arc) distance between two points on the Moon.
 *
 * @param {number} lat1Deg First latitude in degrees.
 * @param {number} lon1Deg First longitude in degrees.
 * @param {number} lat2Deg Second latitude in degrees.
 * @param {number} lon2Deg Second longitude in degrees.
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {number} Distance in meters.
 */
export function greatCircleDistanceM(lat1Deg, lon1Deg, lat2Deg, lon2Deg, radiusM = MOON_RADIUS_M) {
  if (![lat1Deg, lon1Deg, lat2Deg, lon2Deg].every(Number.isFinite)) return Number.NaN
  const lat1 = lat1Deg * DEG
  const lat2 = lat2Deg * DEG
  const dLon = wrapLongitudeDelta(lon2Deg - lon1Deg) * DEG
  const sinLat = Math.sin((lat2 - lat1) / 2)
  const sinLon = Math.sin(dLon / 2)
  const haversine = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  return 2 * radiusM * Math.asin(Math.sqrt(clamp(haversine, 0, 1)))
}

/**
 * Initial bearing (forward azimuth) from point 1 to point 2.
 *
 * @param {number} lat1Deg First latitude in degrees.
 * @param {number} lon1Deg First longitude in degrees.
 * @param {number} lat2Deg Second latitude in degrees.
 * @param {number} lon2Deg Second longitude in degrees.
 * @returns {number} Bearing in degrees `[0, 360)`, clockwise from north.
 */
export function initialBearing(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  if (![lat1Deg, lon1Deg, lat2Deg, lon2Deg].every(Number.isFinite)) return Number.NaN
  const lat1 = lat1Deg * DEG
  const lat2 = lat2Deg * DEG
  const dLon = wrapLongitudeDelta(lon2Deg - lon1Deg) * DEG
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return normalizeLongitude(Math.atan2(y, x) * RAD)
}

/**
 * Curvature drop of the lunar surface at a given surface distance.
 *
 * `drop ≈ d² / (2R)`, the vertical distance between the tangent plane at the
 * observer and the sphere at arc length `d`. Useful for display and as a sanity
 * check; the exact angle helpers below do not rely on this approximation.
 *
 * @param {number} distanceM Surface distance in meters.
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {number} Drop in meters.
 */
export function curvatureDropM(distanceM, radiusM = MOON_RADIUS_M) {
  return (distanceM * distanceM) / (2 * radiusM)
}

/**
 * Elevation angle (altitude above the local horizontal) of a target point.
 *
 * Exact spherical geometry: the observer sits at radius `R + observerElevM`,
 * the target at radius `R + targetElevM`, separated by the surface arc
 * `distanceM`, which corresponds to the central angle `θ = distanceM / R`.
 * With the observer's local horizontal as the reference plane:
 *
 * ```text
 * tan(angle) = ((R + hTarget)·cos θ − (R + hObserver)) / ((R + hTarget)·sin θ)
 * ```
 *
 * For small distances this reduces to `(hTarget − hObserver − d²/2R) / d`,
 * i.e. the flat-terrain formula minus the curvature drop. The angle is
 * negative when the target is below the observer's horizontal plane (the case
 * of most of the surface when looking across hundreds of kilometres).
 *
 * @param {number} observerElevM Observer elevation above the datum in meters.
 * @param {number} targetElevM Target elevation above the datum in meters.
 * @param {number} distanceM Surface arc distance between both points in meters.
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {number} Elevation angle in degrees (can be negative).
 */
export function elevationAngleDeg(
  observerElevM,
  targetElevM,
  distanceM,
  radiusM = MOON_RADIUS_M,
) {
  if (!Number.isFinite(observerElevM) || !Number.isFinite(targetElevM) || !Number.isFinite(distanceM)) {
    return Number.NaN
  }
  if (distanceM <= 0) return 0
  const radiusObserver = radiusM + observerElevM
  const radiusTarget = radiusM + targetElevM
  const theta = distanceM / radiusM
  const numerator = radiusTarget * Math.cos(theta) - radiusObserver
  const denominator = radiusTarget * Math.sin(theta)
  return Math.atan2(numerator, denominator) * RAD
}

/**
 * A point along a straight line of sight from a surface site.
 *
 * The ray leaves the observer at a given elevation angle above the local
 * horizontal and is straight in space (no atmosphere, no refraction). The
 * returned point is the position of the ray after `distanceM` metres of slant
 * range, projected onto the spherical lunar surface for its latitude/longitude
 * and expressed as height above the reference datum.
 *
 * Derivation in the plane containing the ray and the Moon centre:
 * the observer is at radius `r0 = R + h0`; the ray has radial component
 * `t·sin(e)` and horizontal component `t·cos(e)` (`e` = elevation angle), so
 *
 * ```text
 * r(t)        = sqrt(r0² + 2·r0·t·sin e + t²)
 * θ(t)        = atan2(t·cos e, r0 + t·sin e)      // central angle
 * elevation(t)= r(t) − R
 * ```
 *
 * The surface point is `θ(t)` radians from the site along the given azimuth.
 *
 * @param {number} latDeg Observer latitude in degrees.
 * @param {number} lonDeg Observer longitude in degrees.
 * @param {number} observerElevM Observer elevation above datum in meters.
 * @param {number} azimuthDeg Ray azimuth in degrees clockwise from north.
 * @param {number} elevationDeg Ray elevation angle above local horizontal in degrees.
 * @param {number} slantDistanceM Slant range along the ray in meters.
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {{lat: number, lon: number, elevationM: number, surfaceDistanceM: number}|null}
 *   Position of the ray point (latitude, longitude, height above datum) and the
 *   surface arc distance below it, or `null` when the ray crosses the Moon
 *   centre (invalid, only possible for very steep downward rays).
 */
export function projectRayPoint(
  latDeg,
  lonDeg,
  observerElevM,
  azimuthDeg,
  elevationDeg,
  slantDistanceM,
  radiusM = MOON_RADIUS_M,
) {
  const elevation = elevationDeg * DEG
  const radius0 = radiusM + observerElevM
  const sinE = Math.sin(elevation)
  const cosE = Math.cos(elevation)

  const radial = radius0 + slantDistanceM * sinE
  const horizontal = slantDistanceM * cosE
  const radius = Math.sqrt(radial * radial + horizontal * horizontal)
  if (!(radius > 0)) return null

  const centralAngle = Math.atan2(horizontal, radial)
  const surfaceDistanceM = centralAngle * radiusM
  const destination = destinationPoint(latDeg, lonDeg, azimuthDeg, surfaceDistanceM, radiusM)
  return {
    lat: destination.lat,
    lon: destination.lon,
    elevationM: radius - radiusM,
    surfaceDistanceM,
  }
}

/**
 * Convert a local north/east offset in meters to a latitude/longitude.
 *
 * Uses the exact destination formula in two steps (north then east), which is
 * accurate for the local scales used by the terrain sampling code.
 *
 * @param {number} latDeg Reference latitude in degrees.
 * @param {number} lonDeg Reference longitude in degrees.
 * @param {number} northM Offset towards north in meters (negative = south).
 * @param {number} eastM Offset towards east in meters (negative = west).
 * @param {number} [radiusM=MOON_RADIUS_M] Sphere radius in meters.
 * @returns {{lat: number, lon: number}}
 */
export function offsetLatLon(latDeg, lonDeg, northM, eastM, radiusM = MOON_RADIUS_M) {
  const afterNorth = destinationPoint(latDeg, lonDeg, northM >= 0 ? 0 : 180, Math.abs(northM), radiusM)
  const bearing = eastM >= 0 ? 90 : 270
  return destinationPoint(afterNorth.lat, afterNorth.lon, bearing, Math.abs(eastM), radiusM)
}
