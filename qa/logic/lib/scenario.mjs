/**
 * Random scenario generation for the L-SEA Monte Carlo logic harness.
 *
 * Implements SPEC §3: site (uniform + 30 % curated POI + 10 % region edge +
 * poles + longitude wrap), date/time inside the ephemeris range (10 % exactly on
 * a 30-minute sample, otherwise deliberately off-grid), mission profile,
 * both LOLA regions, degraded data paths and edge cases.
 *
 * All sampling is driven by the per-case seeded RNG, so scenario `n` is
 * identical for the same `--seed` no matter how many cases are run or how the
 * workers split them.
 *
 * @module logic/lib/scenario
 */
import { caseSeedFor, makeRng } from './prng.mjs'

/** Ephemeris sample spacing in ms (30 min, see public/data/ephemeris/index.json). */
export const EPHEMERIS_STEP_MS = 30 * 60 * 1000

export const MISSION_DAY_CHOICES = [7, 14, 28]

/**
 * Build one deterministic scenario.
 *
 * @param {Object} params
 * @param {number} params.index Case index.
 * @param {number} params.seed Run seed.
 * @param {Object} params.core Imported `src/core/index.js` namespace.
 * @param {Array<Object>} params.terrainRegions Decoded terrain grids (high-res first).
 * @param {Array<Object>} params.pois Curated POIs from `public/data/pois.json`.
 * @param {{start: string, end: string}} params.ephemerisRange
 * @param {number} params.azCount Azimuth sample count (72 full / 36 quick).
 * @param {'both'|'hi'|'wide'} [params.region='both']
 * @returns {Object} Scenario record.
 */
export function generateScenario({
  index,
  seed,
  core,
  terrainRegions,
  pois,
  ephemerisRange,
  azCount,
  region = 'both',
}) {
  const caseSeed = caseSeedFor(seed, index)
  const rng = makeRng(caseSeed)
  const edgeTags = []
  const hi = terrainRegions.find((terrain) => terrain.id === 'south-pole-875s-20m') ?? terrainRegions[0]
  const wide = terrainRegions.find((terrain) => terrain.id === 'south-pole-80s-80m') ?? terrainRegions[terrainRegions.length - 1]
  const rangeStartMs = Date.parse(ephemerisRange.start)
  const rangeEndMs = Date.parse(ephemerisRange.end)

  /** Pick a random point inside a region (rejection sampling with fallback). */
  const pointInside = (terrain, maxTries = 200) => {
    const halfW = terrain.widthM / 2
    const halfH = terrain.heightM / 2
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const x = rng.range(-halfW * 0.98, halfW * 0.98)
      const y = rng.range(-halfH * 0.98, halfH * 0.98)
      const { latDeg, lonDeg } = core.xyToLonLat(x, y, terrain.referenceRadiusM)
      const site = { lat: latDeg, lon: lonDeg }
      if (core.isInsideTerrain(terrain, latDeg, lonDeg)) return site
    }
    return { lat: -90, lon: 0 }
  }

  /** Uniform site inside the requested region mode. */
  const uniformSite = () => {
    if (region === 'hi' && hi) return pointInside(hi)
    if (region === 'wide' && wide) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const candidate = pointInside(wide)
        if (!hi || !core.isInsideTerrain(hi, candidate.lat, candidate.lon)) return candidate
        // Fall back to a point outside the high-res square but inside the wide one.
        const half = hi.widthM / 2
        const x = rng.range(-wide.widthM / 2 * 0.98, wide.widthM / 2 * 0.98)
        const y = rng.range(-wide.heightM / 2 * 0.98, wide.heightM / 2 * 0.98)
        if (Math.abs(x) > half || Math.abs(y) > half) {
          const { latDeg, lonDeg } = core.xyToLonLat(x, y, wide.referenceRadiusM)
          if (core.isInsideTerrain(wide, latDeg, lonDeg)) return { lat: latDeg, lon: lonDeg }
        }
      }
      return pointInside(wide)
    }
    return { lat: rng.range(-90, -80), lon: rng.range(0, 360) }
  }

  /** Point exactly on a region boundary (projected rectangle edge). */
  const edgeSite = () => {
    const terrain = rng.weightedPick([hi, wide].filter(Boolean), (t) => (t === hi ? 1 : 4))
    const side = rng.int(0, 3)
    const halfW = terrain.widthM / 2
    const halfH = terrain.heightM / 2
    const x = side === 0 ? -halfW : side === 1 ? halfW : rng.range(-halfW, halfW)
    const y = side === 2 ? -halfH : side === 3 ? halfH : rng.range(-halfH, halfH)
    const { latDeg, lonDeg } = core.xyToLonLat(x, y, terrain.referenceRadiusM)
    return { lat: latDeg, lon: lonDeg, terrain }
  }

  // ------------------------------------------------------------------ site
  let site = null
  let poiId = null
  let degraded = 'none'
  const degradedRoll = rng.next()
  if (degradedRoll < 0.015) degraded = 'no-terrain'
  else if (degradedRoll < 0.03) degraded = 'no-ephemeris'
  else if (degradedRoll < 0.04) degraded = 'both'

  const modeRoll = rng.next()
  let chosenTerrain = null
  if (modeRoll < 0.1) {
    // 10 % exactly on a region edge/boundary.
    const edge = edgeSite()
    site = { id: `edge-${index}`, name: `Edge site ${index}`, lat: edge.lat, lon: edge.lon, source: 'custom' }
    chosenTerrain = edge.terrain
    edgeTags.push('region-edge')
  } else if (modeRoll < 0.15) {
    // 5 % exactly at the south pole.
    site = { id: `pole-${index}`, name: `South pole ${index}`, lat: -90, lon: rng.range(0, 360), source: 'custom' }
    edgeTags.push('pole', 'lon-wrap')
  } else if (modeRoll < 0.2) {
    // 5 % longitude wrap: lon 0 or just below 360, incl. an explicit 360 input.
    const lon = rng.chance(0.5) ? 0 : rng.chance(0.5) ? 359.999999 : 360
    site = { id: `wrap-${index}`, name: `Wrap site ${index}`, lat: rng.range(-90, -80), lon, source: 'custom' }
    edgeTags.push('lon-wrap')
    if (lon === 360) edgeTags.push('lon-360-input')
  } else if (modeRoll < 0.5 && pois.length > 0) {
    // 30 % forced inside a curated POI (small jitter inside its region).
    const poi = rng.pick(pois)
    const poiTerrain =
      terrainRegions.find((terrain) => core.isInsideTerrain(terrain, poi.lat, poi.lon)) ?? hi ?? wide
    let lat = poi.lat
    let lon = poi.lon
    for (let attempt = 0; attempt < 25; attempt++) {
      const candidateLat = poi.lat + rng.range(-0.03, 0.03)
      const candidateLon = poi.lon + rng.range(-0.03, 0.03)
      if (poiTerrain && core.isInsideTerrain(poiTerrain, candidateLat, candidateLon)) {
        lat = candidateLat
        lon = candidateLon
        break
      }
    }
    poiId = poi.id
    chosenTerrain = poiTerrain
    site = {
      id: `poi-${poi.id}-${index}`,
      name: poi.name,
      lat,
      lon,
      elevationM: poi.elevationM,
      perimeterM: poi.perimeterM,
      mastM: poi.mastM,
      source: 'poi',
    }
    edgeTags.push('inside-poi')
  } else {
    site = { id: `rnd-${index}`, name: `Random site ${index}`, ...uniformSite(), source: 'custom' }
  }

  if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) {
    site = { ...site, lat: -89.5, lon: 180 }
  }
  const lonInput = site.lon
  // Normalize only for internal comparisons; keep the raw input for core calls.
  const normalizedLon = ((site.lon % 360) + 360) % 360

  // Pick terrain region (high-resolution first), unless degraded.
  const coveringTerrain =
    chosenTerrain ??
    terrainRegions.find((terrain) => core.isInsideTerrain(terrain, site.lat, site.lon)) ??
    null
  const regionId = coveringTerrain ? coveringTerrain.id : null
  if (regionId === null) edgeTags.push('outside-terrain')
  else if (regionId === 'south-pole-875s-20m') edgeTags.push('region-high-res')
  else edgeTags.push('region-wide')

  // ---------------------------------------------------------- date and time
  let dateMs = rangeStartMs + rng.next() * (rangeEndMs - rangeStartMs)
  const onSample = rng.chance(0.1)
  if (onSample) {
    dateMs = rangeStartMs + Math.round((dateMs - rangeStartMs) / EPHEMERIS_STEP_MS) * EPHEMERIS_STEP_MS
    edgeTags.push('date-on-sample')
  } else {
    edgeTags.push('date-off-grid')
  }
  if (dateMs < rangeStartMs) dateMs = rangeStartMs
  if (dateMs > rangeEndMs) dateMs = rangeEndMs
  const dateISO = new Date(dateMs).toISOString()

  // ---------------------------------------------------------------- mission
  const mission = {
    missionDays: MISSION_DAY_CHOICES[rng.int(0, MISSION_DAY_CHOICES.length - 1)],
    powerNeedW: rng.range(40, 320),
    sunDaysNeeded: rng.range(0, 14),
    perimeterM: rng.range(50, 500),
    mastM: rng.range(0, 20),
    relayInOrbit: rng.chance(0.5),
    startTime: new Date(dateMs).toISOString(),
    dataNeedMb: rng.chance(0.5) ? rng.range(100, 5000) : null,
    // The app default; the harness keeps it explicit for reproducibility.
    stepSeconds: 300,
  }

  // -------------------------------------------------------- ephemeris source
  // Every scenario gets a real, pre-computed topocentric dataset: the POI's own
  // dataset for curated sites, otherwise the nearest POI dataset (documented
  // approximation; the static app has exactly ten per-site ephemerides).
  let datasetSiteId = poiId ?? null
  if (!datasetSiteId && pois.length > 0) {
    let best = null
    let bestDistance = Infinity
    for (const poi of pois) {
      const distance = core.greatCircleDistanceM(site.lat, normalizedLon, poi.lat, poi.lon)
      if (distance < bestDistance) {
        bestDistance = distance
        best = poi
      }
    }
    datasetSiteId = best?.id ?? null
  }

  // ---------------------------------------------------------------- speed tag
  const expectedSlow =
    mission.missionDays === 28 || (azCount >= 72 && regionId === 'south-pole-875s-20m')

  return {
    index,
    caseSeed,
    seed,
    edgeTags,
    tags: [
      '@level/logic',
      '@mc',
      '@invariant',
      '@speed/' + (expectedSlow ? 'slow' : 'fast'),
    ],
    degraded,
    site: {
      id: site.id,
      name: site.name,
      lat: site.lat,
      lon: lonInput,
      source: site.source,
      elevationM: site.elevationM ?? null,
      perimeterM: site.perimeterM ?? null,
      mastM: site.mastM ?? null,
    },
    inputLon: lonInput,
    normalizedLon,
    poiId,
    regionId,
    datasetSiteId,
    dateMs,
    dateISO,
    offGrid: !onSample,
    mission,
    azCount,
    profileStepDeg: 360 / azCount,
  }
}
