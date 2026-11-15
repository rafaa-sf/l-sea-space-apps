/**
 * Pick the closest curated POI for a custom latitude/longitude.
 *
 * Custom sites have no precomputed JPL Horizons file of their own. Sun/Earth
 * directions vary slowly across the south-pole DEM, so the nearest curated
 * site's ephemeris is a much better input for the 2-week cycle bands than the
 * synthetic fallback (which only models the longitude phase).
 *
 * @param {Array<Object>} sites Known sites (curated + custom).
 * @param {number} lat Custom latitude in degrees.
 * @param {number} lon Custom longitude in degrees.
 * @returns {Object|null} Closest curated site, or null when none is usable.
 */
export function nearestCuratedSite(sites, lat, lon) {
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null
  const targetLat = Number(lat)
  const targetLon = Number(lon)
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null
  const cosLat = Math.cos((targetLat * Math.PI) / 180)
  let best = null
  let bestDistance = Infinity
  for (const site of Array.isArray(sites) ? sites : []) {
    if (!site || site.source === 'custom' || site.source === 'pointer') continue
    const siteLat = Number(site.lat)
    const siteLon = Number(site.lon)
    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLon)) continue
    const dLat = siteLat - targetLat
    const rawLon = ((siteLon - targetLon + 540) % 360) - 180
    const dLon = rawLon * cosLat
    const distance = dLat * dLat + dLon * dLon
    if (distance < bestDistance) {
      bestDistance = distance
      best = site
    }
  }
  return best
}
